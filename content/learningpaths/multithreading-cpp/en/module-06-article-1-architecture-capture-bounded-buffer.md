---
title: "Capstone: architecture of a vision pipeline — capture and bounded buffer"
description: "Multithreading in C++ with Qt — Module 6 (Capstone)"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone: architecture of a vision pipeline — capture and bounded buffer

You started, six modules ago, from a button that froze a window. One click, one heavy computation running in the wrong place, and the whole application stopped breathing for a few seconds — not because of some exotic bug, but because that is simply what happens when a single thread has to both do the work and answer the user. From there you built, one piece at a time, an entire vocabulary: `QThread` and the event-loop architecture (Module 1), `QMutex` and `QWaitCondition` to coordinate genuine shared state (Module 2), `QtConcurrent` and the Future/Promise model for coarse-grained work (Module 3), the precise rules of cross-thread connections and cooperative cancellation (Module 4), `QThreadPool`, atomics, and the hidden cost of the cache (Module 5). Each module solved one precise, isolated problem, with a guided project that demonstrated it on its own.

This capstone module doesn't introduce a new one. Its job is different and, to be honest, harder: take all those pieces and make them work **together**, in the same program, at the same time — because that is exactly the difference between "knowing a technique" and "knowing how to build a system." A thread pool that works beautifully on its own, in isolation, can hang forever if the order in which you shut it down relative to an upstream buffer is the wrong one. A cooperative cancellation scheme that's flawless with a single worker has to be rethought from scratch when the cooperating workers become three concurrent stages instead of one.

The guided project for these last few articles, **Project H — Near real-time frame processing pipeline**, is deliberately close to a real-world case: a capture thread that simulates a camera, a bounded buffer that decouples capture from processing, a worker pool that applies a real filter to every frame in parallel, a stop mechanism that has to bring everything down without losing data and without hanging, and a GUI that stays responsive from start to finish. Five stages, each built with the technique of one specific module.

## The big picture: five stages, one flow

![End-to-end architecture of the capstone pipeline](modulo-06/25-capstone-pipeline-architecture.png)

The flow is linear in the direction data travels — a frame is born in Stage 1, passes through Stage 2, gets consumed and processed in Stage 3, and its result reaches Stage 5 via signals — but it is **not** linear in terms of control: Stage 4, the cooperative cancellation flag, is not a fifth link in the chain, it is a line that touches *all* the other four at once, because stopping the pipeline is an operation that has to touch every stage, in the right order, explicitly.

Here is the complete map of which course module taught the technique behind each stage:

- **Stage 1 — Capture**: a persistent `QThread` with a worker moved over via `moveToThread()`, never a `QThread` subclass. Technique from **Module 1**.
- **Stage 2 — Shared buffer**: `QMutex` + two `QWaitCondition`s, a bounded queue, the same producer-consumer pattern seen before. Technique from **Module 2**.
- **Stage 3 — Parallel processing**: a pool of persistent tasks on `QThreadPool`, with a `QtConcurrent` alternative discussed and justified. Technique from **Module 5** (with an explicit comparison against **Module 3**).
- **Stage 4 — Cooperative cancellation**: a shared atomic flag, extended to correctly coordinate three concurrent stages instead of one. Technique from **Module 4**.
- **Stage 5 — GUI integration**: signals with a queued connection to the main thread, which is never blocked. Technique from **Module 0**, applied once more at whole-system scale.

## Stage 1: capture, a persistent worker that knows nothing about the rest

**Goal.** A separate thread that generates synthetic frames at a steady, controlled pace, exactly as a real camera driver would — never touching the GUI directly, knowing nothing about how the frames will be processed.

The pattern is the one from Module 1: no `QThread` subclass, a `QObject` worker (`CaptureWorker`) moved with `moveToThread()` onto a plain `QThread`, started when the thread emits `started`. What's new is what the worker does once it's started: it doesn't process anything itself, it just generates a synthetic `QImage` and hands it off to the next stage:

```cpp
void CaptureWorker::start() {
    int frameNumber = 0;

    while (!m_flag->requested() && frameNumber < m_targetFrameCount) {
        QThread::msleep(m_intervalMs);
        if (m_flag->requested()) break;   // re-check even after the sleep

        QImage frame = generateSyntheticFrame(frameNumber);
        if (!m_buffer->produce(frame, frameNumber)) break;

        emit frameCaptured(frameNumber);
        ++frameNumber;
    }

    emit captureFinished(frameNumber);
}
```

**Pitfall 1 — the re-check after the sleep.** Notice the second `if (m_flag->requested()) break;`, right after `QThread::msleep()`. Without it, one "extra" frame could be produced right in the window of time between a stop request and waking up from the sleep — not a catastrophic bug, but a matter of discipline: every point where the thread regains control after a wait is a point where it's worth asking again "should I still be here?", exactly the spirit of the `while` (not `if`) that Module 2 taught you for `QWaitCondition`s.

**Pitfall 2 — two independent termination conditions.** The loop ends for two distinct reasons, and both of them matter: the cancellation flag (Module 4) or the target frame count being reached. A common mistake when integrating multiple stages is to think that just *one* of the two conditions is enough — but the case "capture simply finished its job" is not at all the same as the case "the user interrupted everything halfway through": we'll see further on that the correct shutdown sequence is different in the two cases.

**Pitfall 3 — what happens if `produce()` returns `false`.** The capture worker never checks the buffer's state directly: it relies entirely on the return value of `produce()`. If someone else has already closed the buffer while the worker was blocked waiting for free space, the call returns `false` and the loop exits cleanly. It's the same encapsulation principle from Module 2: the closing logic lives in one single place, not scattered across the threads that use it.

## Stage 2: the bounded buffer, and backpressure as a deliberate choice

**Goal.** Decouple the pace of capture from the pace of processing, so the two stages can proceed at different speeds without one having to wait for the other step by step — but with a hard limit on how much "distance" can grow between the two.

`FrameBuffer` is, deliberately, a rewrite of the same shared-buffer pattern built in Module 2, not copied but rethought to carry `QImage` instead of integers: same `QMutex`, same two `QWaitCondition`s (`m_notFull` for the producer, `m_notEmpty` for the consumers), same re-checking `while` loop, same RAII discipline with `QMutexLocker`.

```cpp
bool FrameBuffer::consume(QImage &frameOut, int &frameNumberOut) {
    QMutexLocker locker(&m_mutex);

    while (m_queue.isEmpty() && !m_closed) {
        m_notEmpty.wait(&m_mutex);
    }

    if (m_queue.isEmpty()) return false;   // closed AND empty: really done

    Entry e = m_queue.dequeue();
    frameOut = e.frame;
    frameNumberOut = e.number;
    emit occupancyChanged(m_queue.size(), m_capacity);

    m_notFull.wakeOne();
    return true;
}
```

**Pitfall — the return condition of `consume()` is not symmetric with that of `produce()`, and that's intentional.** Look closely at the line `if (m_queue.isEmpty()) return false;`: the test is only on the queue being empty, not also on `m_closed`. That means that once the buffer is closed, `consume()` **keeps returning `true`** as long as there are still frames in the queue — closing the buffer doesn't throw away anything that has already been produced. It's a design decision worth spelling out explicitly: the opposite choice (discard everything as soon as `close()` arrives) would have been just as easy to write and far more dangerous in a real vision system, where a discarded frame can mean an event that was never detected.

### Why the limit

![Backpressure: the bounded buffer fills up and the producer waits](modulo-06/26-backpressure-bounded-buffer.png)

With a fixed capacity and a capture pace faster than the aggregate processing pace, the buffer fills up regularly during the run of the project, and `CaptureWorker::start()` blocks inside `m_buffer->produce()` waiting for space, exactly as expected. This is the point worth pausing on and thinking about at the system level, not just the code level: backpressure is not a design flaw, it is **the deliberate and superior alternative** to an unbounded queue. With a queue that can grow without limit, a producer faster than the consumer would never wait — but the memory taken up by pending frames would grow without bound under sustained load, the delay between "frame captured" and "frame processed" would become arbitrarily large and, worse, invisible until something runs out of available resources. A bounded buffer converts a latent, silent problem into an immediate, measurable slowdown and — more importantly for a system that has to run around the clock on embedded hardware — into a memory ceiling known in advance.

With capture and the bounded buffer in place, the next article tackles the trickiest part of the whole module: how to process frames in parallel with a persistent pool, and how to correctly stop a pipeline in which three concurrent stages can be asleep at different points at the very same instant.
