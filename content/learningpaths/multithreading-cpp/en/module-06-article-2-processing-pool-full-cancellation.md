---
title: "Capstone: persistent processing pool and full cooperative cancellation"
description: "Multithreading in C++ with Qt — Module 6 (Capstone)"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone: persistent processing pool and full cooperative cancellation

In the previous article you saw the first two stages of the capstone pipeline: a persistent capture worker (Module 1) producing frames into a bounded buffer (Module 2), with backpressure as a deliberate choice. This article tackles stages 3 and 4: how to process those frames in parallel, and — the hardest part of the whole course — how to correctly stop a pipeline in which several concurrent stages can be asleep at different points at the very same instant.

## Stage 3: parallel processing, and why QThreadPool beats QtConcurrent here

**Goal.** Apply a real CPU-bound filter to every frame — in Project H, a Sobel-style edge detector — distributing the work across multiple threads, so that total processing time scales with the number of available cores.

### The design decision that matters: persistent pool versus finite batch

Module 3 taught you `QtConcurrent::mapped`: give it a collection, give it a function, get back a `QFuture` that delivers results with observable progress via `QFutureWatcher`. It is the right tool whenever your problem has the shape "I have *N* items, all already available, and I want to process all of them." Project H, however, **does not have this shape**: frames arrive one at a time, at a pace you don't know in advance, for a duration that might not have a fixed end (a real camera never tells you in advance "I'm the last frame"). `QtConcurrent::mapped` needs to know the full collection before it starts — it isn't built for a continuous stream that grows while you're consuming it.

The solution adopted is a pool of **persistent tasks**: not one `QRunnable` per frame (which would pay the cost of creating and scheduling a new object for every single frame, an overhead that matters when frames arrive every 90 milliseconds), but a fixed number of `FrameWorkerTask` objects — typically 2, configurable by the user in the GUI — each of which stays running **for the entire lifetime of the pipeline**, pulling frames from the buffer one after another in its own internal loop:

```cpp
void FrameWorkerTask::run() {
    QImage frame;
    int frameNumber = -1;

    while (m_buffer->consume(frame, frameNumber)) {
        // ... process, measure, emit signals ...
        if (m_flag->requested()) break;
    }
}
```

Every `FrameWorkerTask` inherits from both `QObject` (to be able to emit signals to the GUI) and `QRunnable` (to be schedulable by `QThreadPool::start()`) — a double inheritance you had no reason to use back in Module 5, because your `QRunnable`s there were purely computational, with no need to communicate results via signals.

**Pitfall — the pool size has to be fixed *before* starting the tasks, not after.** `QThreadPool::setMaxThreadCount(N)` has to be called before `start()`, and with persistent tasks getting the order wrong isn't just suboptimal, it's a potential silent stall: if you start `N` tasks but the pool only has room for fewer than `N` concurrent threads, the excess tasks sit in the pool's internal queue, waiting for one of the already-running tasks to finish — which, for a task that loops until the buffer closes, doesn't happen until the very end of the pipeline. The result is a pool that looks "started" but where only some of the workers are actually consuming from the buffer, with reduced throughput and no error message pointing to it.

**When to choose one over the other, in your own work.** If your problem is "I have a batch of 200 images already on disk, process all of them and tell me when you're done," `QtConcurrent::mapped` with a `QFutureWatcher` remains the simplest, most readable choice — don't reinvent it with a persistent pool just because you saw one here. If your problem is "a continuous stream of incoming data, of unknown duration, that has to be processed with minimal delay while it keeps arriving," the Project H pattern — a persistent pool pulling from a shared buffer — is the natural shape for the problem.

## Stage 4: full cooperative cancellation — the hardest part of the course

If there's one passage in this module worth reading twice, sentence by sentence, this is it. Correctly stopping **one** worker, as in Module 4, requires discipline but is conceptually simple: a flag, a loop that checks it, a final `quit()` + `wait()`. Stopping **a pipeline with three concurrent stages passing data through a blocking buffer** is a qualitatively different problem, because now there are several ways a thread can be "busy" at the exact moment the stop request arrives, and each one requires someone else to physically wake it up — a flag alone is no longer enough.

### The mistake a naive version would make

Imagine writing this shutdown sequence off the top of your head:

```cpp
// NAIVE VERSION -- DO NOT DO THIS
void naiveShutdown() {
    m_flag.requestStop();        // (a)
    m_captureThread->quit();     // (b)
    m_captureThread->wait();     // (c)  <-- can hang here forever
    m_pool->waitForDone();       // (d)
}
```

It looks reasonable, and it's exactly the kind of code that would pass a quick test done by pressing Stop while the pipeline is lightly loaded. The problem shows up in one specific but far from rare case: if, at the moment `naiveShutdown()` is called, the capture thread is blocked *inside* `m_buffer->produce()` because the buffer is full — which is exactly the backpressure scenario from the previous article, **normal, expected** pipeline behavior — then step (a) accomplishes nothing: `m_flag` is an atomic variable, but the capture thread isn't looking at it right now, it's asleep inside `QWaitCondition::wait()`, which only wakes up for an explicit `wakeOne()`/`wakeAll()` or a spurious wakeup. Step (b) queues up a quit request that the thread can never process, because it isn't in its event loop. Step (c), `wait()`, then blocks **forever** — not a slowdown, a genuine deadlock.

### The correct sequence, step by step

![Full shutdown: the deadlock-free stop ordering](modulo-06/27-full-pipeline-shutdown.png)

The step missing from the naive version is `FrameBuffer::close()`, and its position in the sequence is non-negotiable: it has to come **before** any blocking `wait()` on a thread or pool, because it's the only one of the four steps that **physically wakes up** whoever is asleep in a `QWaitCondition` — exactly the same lesson from Module 2, applied here to three concurrent stages instead of two:

```cpp
void MainWindow::startShutdownSequence(const QString &reason, bool earlyCancellation) {
    if (m_stopInProgress || !m_running) return;
    m_stopInProgress = true;

    if (earlyCancellation) {
        m_flag.requestStop();    // stop producing NEW frames
    }
    m_buffer->close();           // WAKES anyone blocked in wait() -- the step that matters

    // wait for real termination, but NEVER on the GUI thread (see below)
    QThread *captureThread = m_captureThread;
    QThreadPool *pool = m_pool;
    QFuture<void> future = QtConcurrent::run([captureThread, pool]() {
        captureThread->quit();
        captureThread->wait();
        pool->waitForDone();
    });
    // ... QFutureWatcher signals onPipelineFullyStopped() when done ...
}
```

With `close()` called first, the capture thread blocked in `produce()` wakes up immediately (`m_notFull.wakeAll()` inside `close()`), sees `m_closed == true`, and `produce()` returns `false` — its `start()` exits the loop and returns, the thread goes back to its own event loop, and only at this point does the previously-queued `quit()` actually take effect. The same holds, symmetrically, for any `FrameWorkerTask` that might be blocked in `consume()` on an empty buffer.

### Why the final wait can't sit on the GUI thread

There's a second pitfall, less dramatic than a deadlock but no less important: both `QThread::wait()` and `QThreadPool::waitForDone()` are **blocking** calls. Even once the deadlock problem is solved with `close()`, calling them directly from the slot connected to the Stop button would freeze the GUI thread for the whole duration of the drain — which, with workers potentially mid-way through a 200-millisecond frame, can be noticeable. It's the very same lesson from Module 0, the first chapter of the entire course ("never block the GUI thread"), returning here at the scale of a whole pipeline: the fix is to move the wait off the GUI thread with `QtConcurrent::run()` (Module 3, used here for a task different from the one you originally learned it for — not processing data, but *waiting* for other threads to finish) and a `QFutureWatcher` that calls `onPipelineFullyStopped()` once the drain is truly complete, via a queued connection to the GUI thread (Module 4).

### Early stop versus natural stop: they are not the same thing

One last distinction, subtle but real: when the user presses Stop halfway through the pipeline, the cooperative flag goes up, and each `FrameWorkerTask` checks it after finishing the frame it currently has in hand — that is, it stops pulling any more, even if the buffer still holds some. It's a responsiveness choice: the user asked to stop *now*, not "once you've finished all the work already queued up." When, on the other hand, capture ends on its own because it reached the requested frame count, there's no analogous urgency: the flag is **not** raised, and the workers keep draining `consume()` until the buffer is genuinely empty — every captured frame is guaranteed to reach processing. Two stop paths, the same `close()` → asynchronous wait → notification sequence, but one deliberate difference, and it's the difference between "stop right now" and "finish what you started": in vision-system work, this is almost always a distinction the machine operator expects to be able to control, not an implementation detail.

With parallel processing and full cooperative cancellation now clear, the last article of this module — and of the course — walks through the GUI integration and the complete guided project: how to build it, how to compile it, and what to observe when you actually run it.
