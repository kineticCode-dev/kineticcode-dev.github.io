---
title: "QRunnable and QThreadPool: a pool of tasks, not a thread per job"
description: "Multithreading in C++ with Qt — Module 5"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QRunnable and QThreadPool: a pool of tasks, not a thread per job

In Module 2 you learned to protect shared memory with `QMutex` and to coordinate threads with `QWaitCondition`. That whole module rested on an underlying idea that's worth making explicit now: a mutex is a *general* tool, one that protects whatever you put inside it, at the price of a mechanism that, every time it's acquired, potentially involves the operating system scheduler — and putting a waiting thread back into execution has a real cost, not a free one, as you saw in Module 0 when discussing context switches.

This module starts from an uncomfortable but honest question: is that cost always necessary? The answer, as is often the case in engineering, is "it depends" — and this first article tackles the more organizational level of the problem, before descending, in the next one, to the physical level of cache and the memory model.

## The problem that a persistent QThread doesn't solve well

Think back to the pattern used in Modules 1, 2, and 4: a `QThread` created, a worker moved onto it with `moveToThread()`, a lifecycle managed with care (`start()`, `quit()`, `wait()`). That's the right pattern when the work is *continuous* — a producer that runs for the entire life of the program, a worker that processes a constant stream of video frames. But what happens if your problem is different: you have a hundred images to process *once*, in parallel, and then that work is done? Creating a hundred `QThread` instances, one per image, would be absurd — creating an operating-system thread has a non-negligible cost (stack allocation, registration with the scheduler, typically several tens of microseconds even on a modern system), and a hundred threads each living for a few milliseconds would spend a huge fraction of their total time simply being born and dying, not working.

The classic solution, as old as concurrent programming itself, is the **thread pool**: a fixed number of worker threads, created once at startup, that stay alive and queue up to "pull" the next available piece of work from a shared queue, instead of being recreated every time.

![QRunnable + QThreadPool: queued tasks consumed by a fixed set of worker threads](modulo-05/21-qrunnable-qthreadpool.png)

## QRunnable: the task, not the thread

In Qt, a unit of work submitted to a pool is written by subclassing `QRunnable` and overriding a single method, `run()`:

```cpp
class ImageProcessingTask : public QRunnable {
public:
    explicit ImageProcessingTask(int imageId) : m_imageId(imageId) {}

    void run() override {
        // the actual work, executed on one of the pool's threads
        processImage(m_imageId);
    }

private:
    int m_imageId;
};
```

Notice the conceptual difference from a `QObject` worker moved with `moveToThread()`: a `QRunnable` **is not** a `QObject`, it has no signals of its own, and it has no thread affinity in the sense you know from Module 1. It's deliberately a leaner, lighter tool: it represents *the work to be done*, not *who does it*. The "who" is decided on the fly by the pool, based on which worker thread frees up first — and it might not be the same thread every time, something that wouldn't even make sense to ask about with a persistent `QThread`.

## Submitting the task: QThreadPool

```cpp
// Qt's shared global pool
QThreadPool *pool = QThreadPool::globalInstance();
pool->start(new ImageProcessingTask(imageId));
```

`QThreadPool::globalInstance()` returns a pool shared by the whole application, sized by default on the number of logical cores of the machine (`QThread::idealThreadCount()`) — the same physical metric as `std::thread::hardware_concurrency()`, which you'll see again in the next article's guided project. You can also build your own independent `QThreadPool` if you want to isolate a certain kind of work from the rest (for instance, to keep background image processing from competing with more urgent tasks going through the global pool):

```cpp
QThreadPool dedicatedPool;
dedicatedPool.setMaxThreadCount(4);
dedicatedPool.start(new ImageProcessingTask(imageId));
```

## Who destroys the QRunnable? setAutoDelete

Here's a memory-management detail that, if ignored, produces either a leak or a double-`delete` crash. By default, `QRunnable::autoDelete()` is `true`: once `run()` finishes, the pool destroys the object itself with `delete`. That's why in the example above we write `new ImageProcessingTask(...)` and never worry about it again — the pool takes care of it. If instead you need to reuse the same `QRunnable` multiple times, or keep it alive after execution to read a result from it, you must explicitly disable this behavior **before** submitting it:

```cpp
ImageProcessingTask *task = new ImageProcessingTask(imageId);
task->setAutoDelete(false);
pool->start(task);
pool->waitForDone();      // wait for all submitted tasks to finish
delete task;              // the responsibility is yours again now
```

`waitForDone()` blocks the caller until the pool has drained every queued task — useful in a batch context where you need a clean synchronization point, much less useful in a reactive context where you want the GUI to stay alive (in that case, as in Module 3 with `QFutureWatcher`, you'll prefer a notification-based mechanism over a blocking wait).

## The connection with QtConcurrent, now made explicit

In Module 3 you used `QtConcurrent::run()` and `QtConcurrent::mapped()` without ever seeing a `QRunnable` or a `QThreadPool` — and that's exactly the point: **you didn't see them because Qt creates them for you, behind the scenes**. Every call to `QtConcurrent::run(function)` internally packages `function` into an automatically generated `QRunnable` and submits it to `QThreadPool::globalInstance()` — the very same pool you just learned to use by hand in this article. `QtConcurrent::mapped()` does the same thing, multiplied over every element of the sequence being processed, with the added logistics of collecting the partial results into a `QFuture`. It's not a similar implementation — it's **the same engine**: when you write `pool->start(new ImageProcessingTask(...))`, you're doing by hand, explicitly, exactly what `QtConcurrent::run()` does for you implicitly.

Knowing this also tells you when it's worth dropping down to `QRunnable` directly instead of staying with `QtConcurrent`: when you need different priorities between tasks (`QThreadPool::start()` accepts an optional priority parameter), or a dedicated pool separate from the global one, or finer control over a single task's lifecycle — all things that the more convenient but more opaque `QtConcurrent` interface doesn't expose.

With `QRunnable` and `QThreadPool` framed, and their relationship to `QtConcurrent` finally made explicit, the next article goes one level lower: what does `std::atomic` actually guarantee, explained not as a list of keywords to memorize, but starting from what physically happens inside a multi-core processor.
