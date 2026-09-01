---
title: "Capstone Project: near real-time frame processing pipeline"
description: "Multithreading in C++ with Qt — Module 6 — Final project"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone Project: near real-time frame processing pipeline

In the previous articles you saw the four "invisible" stages of the capstone pipeline: capture (Module 1), a bounded buffer with backpressure (Module 2), a persistent processing pool (Module 5, compared against `QtConcurrent` from Module 3), and the full cooperative cancellation sequence (Module 4). This article closes the loop with the fifth stage — GUI integration — and walks through the complete guided project: how it's put together, how to build it, and what to observe when you actually run it.

## Stage 5: the GUI, progress, and errors that never bring anything down

**Goal.** A window that shows, in real time and without ever freezing, buffer occupancy (backpressure made visible), the count of frames captured/processed, and a log that distinguishes normal events from errors — staying responsive at all times, even under the heaviest load the pipeline can generate.

Every `FrameWorkerTask` emits one of two signals for each frame it handles, never both:

```cpp
try {
    QImage result = processFrame(frame, frameNumber);
    emit frameProcessed(m_workerId, frameNumber, timer.elapsed());
} catch (const std::exception &e) {
    emit frameError(m_workerId, frameNumber, QString::fromStdString(e.what()));
}
```

![Per-frame errors and progress, without ever bringing the pipeline down](modulo-06/28-error-handling-progress-signals.png)

Project H deliberately simulates a "corrupted payload" every thirteen frames — think of a frame genuinely damaged by a transfer error on a real bus, a scenario that's anything but hypothetical in an industrial acquisition system — by throwing an exception inside `processFrame()`. The `try`/`catch` wrapped around it guarantees that **that one frame** fails without the worker, the pool, or the pipeline as a whole being affected: the `run()` loop immediately continues with the next frame. It's the same robustness philosophy you should bring to any production pipeline: a lost frame should never be a reason to stop the entire line, it should be one more data point to log and, if needed, investigate later.

**Pitfall — where the error count goes.** In the GUI, `onFrameError()` increments a counter that is visibly separate from the one for successfully processed frames, and writes a red-colored entry into the log — never silently ignored, never mixed into a single success count that would hide the problem. It's a tiny choice in the code but not a tiny one in the design: a system that reports "24 frames processed" when in fact 3 of them silently failed is a system that lies, in a particularly dangerous way, because the operator has no reason to doubt it.

**Why it's all safe without a single mutex in the GUI.** Every signal emitted by `CaptureWorker` or by a `FrameWorkerTask` — which live, respectively, on the capture thread and on a pool thread — arrives at a slot on `MainWindow`, which lives on the GUI thread. Qt compares the thread affinity of sender and receiver at the moment of emission and automatically chooses a queued connection (Module 4): the event is queued in the GUI thread's event loop and processed there, one at a time, with no concurrent write to any widget ever happening. It's the same principle Module 1 showed you with a single worker, verified today with four or more source threads all converging on the same destination thread without a single line of manual synchronization code written by you — as long as you never force a `Direct` connection across different threads.

## Setup & prerequisites

- C++17 compiler (verified with GCC 13.3 on Linux).
- CMake ≥ 3.16.
- Qt 6, **Widgets** and **Concurrent** components (the latter is only needed for the `QtConcurrent::run()` used in the asynchronous shutdown sequence — not for frame processing, which stays on plain `QThreadPool`).
- No external vision library: the edge-detection filter is implemented from scratch on the raw data of a grayscale `QImage`.

```bash
cd project-H-vision-pipeline-capstone
cmake -S . -B build
cmake --build build
./build/vision_pipeline_capstone
```

## The file layout

Six source files plus the shared cancellation-flag header:

- `pipelinestate.h` — `CancellationFlag`, a thin wrapper around `std::atomic<bool>` with `requestStop()`/`requested()`/`reset()`.
- `framebuffer.h/.cpp` — Stage 2: the bounded queue of `QImage`.
- `captureworker.h/.cpp` — Stage 1: synthetic frame generation.
- `frameworkertask.h/.cpp` — Stage 3: the Sobel filter and the persistent loop on the pool.
- `mainwindow.h/.cpp` — Stages 4 and 5: orchestration, shutdown sequence, widgets.
- `main.cpp` — eleven lines, no surprises: creates the `QApplication`, creates `MainWindow`, calls `exec()`.

In the interface you'll find two numeric controls — the number of frames to capture and the number of parallel workers — put there specifically so you can reproduce the backpressure experiment yourself: lower the worker count to 1 and watch the buffer fill up faster and stay full longer; raise it to 4 and watch backpressure nearly disappear.

## Empirical calibration: measure, don't guess

The course has repeated the same discipline in every single module — measure before you pick a constant, don't tune it by feel — and this project is no exception. Before settling on the final numbers, the real cost of a single pass of the Sobel filter on a synthetic frame, measured in isolation:

| Frame size | 1 pass | 3 passes | 5 passes |
|---|---|---|---|
| 128×96 | 0.05 ms | 0.15 ms | 0.25 ms |
| 256×192 | 0.20 ms | 0.65 ms | 1.25 ms |
| 1536×1152 | — | 28.8 ms | — |

The interesting figure is just how *fast* a directly-written Sobel filter is on a realistically sized frame for a cheap sensor: even at 1536×1152 (over 1.7 megapixels), three passes cost under 30 milliseconds. A real vision system, though, rarely stops at plain edge detection: feature extraction, classification, tracking all carry a cost we don't implement here (that would be outside the scope of a course on concurrency), but which is honest to simulate explicitly, in the same spirit in which the Consumer from Module 2 used `QThread::msleep()` to represent a realistic processing time. Project H uses 256×192 frames, three real Sobel passes (~0.65 ms, genuine, measured CPU-bound work) plus an explicit wait of 350–450 ms to represent the later, unimplemented stages.

With these numbers, and a capture interval of 90 ms/frame, production (≈11 frames/s) steadily outpaces the aggregate processing capacity of two workers (≈2 frames every ~400 ms ≈ 5 frames/s): the backpressure predicted by theory shows up right on schedule, verified experimentally, not just on paper.

## Run verification

Compiled with g++ 13.3 on Qt 6.4.2, run headless (`QT_QPA_PLATFORM=offscreen`) with a temporary instrumented copy to drive the GUI without a real display:

- **Natural completion** (24 target frames, 2 workers): 24 captured, 23 successfully processed, 1 failed (the simulated corrupted frame #13, as expected — one error every 13 frames). Peak buffer occupancy observed: 5/5 — backpressure visually confirmed. No frame lost: `23 + 1 = 24`. Full shutdown in about 5 seconds from launch, no hang, no crash, exit code 0.
- **Early stop** (Stop pressed at 900 ms from launch, buffer already saturated): 9 frames captured, 5 processed before shutdown — the rest abandoned by design (responsive shutdown). No hang, no crash, buffer never observed above its configured capacity.
- **Double cycle** (start → natural stop → restart → natural stop): identical, deterministic behavior across both cycles, no observable resource leak, no leftover state between cycles — the pipeline can be safely restarted from the same window.

No Qt runtime warnings appeared in any of the runs.

## Where to go from here

Project H is, deliberately, a toy system that behaves like a real one — and the distance between the two is shorter than it looks. Some concrete directions to take it further:

**Replace simulated capture with a real source.** `CaptureWorker::generateSyntheticFrame()` is the only point in the program that "fakes" anything: replace it with a call to a real acquisition library — an industrial frame grabber, a GenICam device, or even just a webcam via `QCamera` — and the rest of the pipeline, buffer, pool, cancellation, GUI, needs no changes at all. It's the practical proof that decoupling stages with a clean interface pays off exactly at this moment.

**Integrate OpenCV instead of the hand-written Sobel.** The filter written from scratch in this module served a teaching purpose, but in production you'd almost certainly use `cv::Sobel` or equivalent, often vectorized and internally multi-threaded. Watch out for a non-trivial detail in that case: if the vision library you're using already has its own internal parallelism, naively stacking it on top of your `QThreadPool`'s parallelism can produce more threads than you have cores — a concrete instance of the lesson on context-switch cost from Module 0, applied here at system scale.

**Retune the pool size against real hardware.** In production you'd probably want to start from `QThread::idealThreadCount()` and then measure — the same empirical-calibration discipline from this chapter, applied to the number of workers instead of processing time, perhaps with a small benchmark in the spirit of Project G from Module 5.

**Profile under sustained load, not just a demo lasting a few seconds.** A 24-frame test running for five seconds demonstrates the correctness of the design, not its staying power over hours of continuous operation. ThreadSanitizer, in particular, is worth rerunning on an extended version of this project, and long-run profiling is the only honest way to know whether the buffer capacity and pool size actually hold up under real load.

## Conclusions for the module — and for the course

Six modules ago the problem was a button that froze a window. Today you've built, verified with real measurements and not just intuition, a five-stage system with three categories of thread active at the same time — a persistent worker, a dynamic pool, the GUI thread — coordinated by a bounded buffer and a shutdown sequence that never leaves anything hanging, even in the trickiest case where a stage is asleep inside a wait condition at the very moment you ask it to stop. This is not a textbook exercise: architecturally, it is substantially the same kind of system you'll run into in industrial vision-system work.

What you take away from this journey isn't the syntax of `QThread` or `QMutex` — that you can look up in any documentation in thirty seconds. It's the mental model that lets you, faced with a new concurrent system, ask the right questions in the right order: which data is genuinely shared, and by whom; what shutdown order leaves no one asleep forever; where the GUI risks blocking, and how to move that risk onto a thread that can afford to pay it. Everything else — the specific class, the exact method name — is a detail you look up when you need it, not theory you carry around memorized.

---

*The complete source code for this project is available in the repository that accompanies this course, in the `project-H-vision-pipeline-capstone` folder.*
