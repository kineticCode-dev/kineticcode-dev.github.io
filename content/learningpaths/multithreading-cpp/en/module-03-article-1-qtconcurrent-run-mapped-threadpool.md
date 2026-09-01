---
title: "QtConcurrent::run, mapped/filtered/reduced, and the QThreadPool behind the scenes"
description: "Multithreading in C++ with Qt — Module 3"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QtConcurrent::run, mapped/filtered/reduced, and the QThreadPool behind the scenes

In the three previous modules you built, piece by piece, the vocabulary and the tools with which Qt handles "manual" multithreading: `QThread`, `moveToThread`, signals and slots to let threads communicate without corrupting each other's state, and then `QMutex`, `QWaitCondition`, `QReadWriteLock` to protect and coordinate data that is genuinely shared. It's a deliberately slow path, because every piece of that vocabulary is what you need to understand *what really happens* underneath when things get complicated — a deadlock, a signal arriving on the wrong thread, a worker that never stops.

Today we change register completely, and we do it on purpose at exactly the point in the course where you can really appreciate the difference. If your first contact with multithreading in Qt was through `QtConcurrent`, used a bit "by feel" — copying an example, running it, moving on without really knowing why it worked — today we close that loop: you'll see exactly the same tools again, but this time knowing precisely what `QThreadPool` does under the hood, why `QFuture` doesn't block (unless you explicitly ask it to), and at what point the convenience of `QtConcurrent` stops being the right choice and the manual pattern from the previous modules comes back into play.

The question that guides the whole module is simple to state and subtler to apply well: **is the work I need to parallelize an independent transformation applied to many similar pieces of data, or is it state that lives over time and needs to be coordinated?** The producer-consumer from the previous module was clearly in the second category — two persistent threads, a shared buffer, fine-grained coordination with wait conditions. Today we work in the first category, the one `QtConcurrent` was designed to shine in: you have a collection of data (in your professional case, almost always frames or images from a vision system), and you want to apply the same operation to each element, as much in parallel as possible, without writing a single `QThread` by hand.

## QtConcurrent::run(): an asynchronous call, no ceremony

Start from the simplest possible case: you have a single function that takes some time, and you want to run it on another thread without blocking the caller. In the module dedicated to `QThread` this cost you, at minimum: a worker class derived from `QObject`, a slot that did the work, a dedicated `QThread`, a `moveToThread()`, the `started` → slot connection, and orderly shutdown handling in the destructor. Five or six lines of infrastructure, to run *one* function a single time.

`QtConcurrent::run()` does the same thing in one line:

```cpp
QFuture<int> future = QtConcurrent::run([]() {
    // time-consuming work, executed on another thread
    QThread::msleep(500);
    return 42;
});
```

That one line does three things together: it takes the function (here a lambda, but it can be a pointer to a free function, a member method, or a functor), queues it on a thread borrowed from a warehouse of already-ready threads (the global `QThreadPool` — the topic of the next section), and immediately returns a `QFuture<int>`: a handy object that represents "the result that will arrive", not the result itself. The `QtConcurrent::run(...)` line **does not block** — it returns right away, before the lambda has even started running, exactly like `m_thread->start()` didn't wait for the worker thread's job to finish.

The gain is obvious: zero new classes, zero manual management of a `QThread`'s life cycle, zero risk of forgetting `quit()`+`wait()` in the destructor. For "fire and forget" work — or "fire and collect the result later" — it's almost always the right choice.

What you've lost is just as important to recognize right away, because it's the thread running through the whole module: **you no longer have a persistent object to talk to while the work is going on**. The Producer from the previous module lived on its own thread for the entire duration of the program, received signals, emitted them, could be stopped in an orderly way. A call to `QtConcurrent::run()` is, conceptually, a pure function that starts, runs, and finishes — not an object you interact with in the middle. If your problem needs that kind of ongoing interaction (pause, fine-grained cancellation, granular progress notifications during execution), you're already glimpsing why *not everything* should go through `QtConcurrent` — we'll get to that calmly in the next article.

## mapped, filtered, reduced: parallelism over data

`QtConcurrent::run()` runs *one* function once. The much more common case in your work — processing N images from an inspection, N frames of an acquired sequence, N sensor readings — is applying the *same* function to *every element* of a collection, independently. This pattern has a precise name in parallel computing literature, **data parallelism** (as opposed to *task parallelism*, where it's different operations that run in parallel), and it's exactly the case `QtConcurrent::mapped()` covers.

```cpp
QList<QImage> blurredImages = QtConcurrent::blockingMapped(originalImages, blurImage);
```

![Visual diagram of map, filter and reduce data-parallel operations](modulo-03/15-map-filter-reduce-visual.png)

`mapped()` takes a collection (here a `QList<QImage>`) and a one-argument function (here `blurImage`, which takes a `QImage` and returns a new one), and applies that function to *every* element, distributing the work across the threads available in the pool. Each element is processed **independently** of the others — no shared state, no mutex needed, because by definition of the problem two computations never touch each other. This is precisely why this pattern lends itself so well to parallelism: the critical section from the previous module existed because multiple threads touched *the same* data; here every worker touches a different element, so the critical section simply doesn't exist.

A detail worth writing down explicitly, because it's easy to take for granted in the wrong way: workers complete elements **in whatever order**, depending on how long each one takes and which thread grabs it — but the collection of results you get at the end **always preserves the original order**. `result[i]` always corresponds to `f(element[i])`, no matter which worker computed it or in what order it was computed. For your work with frame sequences this is a valuable guarantee: frame number 10 in the results list is always the processing of source frame number 10, never that of some other frame that happened to arrive earlier by pure scheduling accident.

Alongside `mapped()`, `QtConcurrent` offers two variants of the same general scheme. **`filtered()`** applies a predicate (a function that returns `bool`) to each element, and returns a new collection containing only the elements for which the predicate is true — computed in parallel, with the relative order of the surviving elements always preserved:

```cpp
QList<QImage> darkImagesOnly = QtConcurrent::blockingFiltered(images, [](const QImage &img) {
    return averageBrightness(img) < DARK_THRESHOLD;
});
```

**`reduced()`** combines all the results of a `mapped()` into a single accumulated value, via an associative combining function — the sum, the maximum, concatenation, any operation for which the order in which you combine pairs doesn't change the final result:

```cpp
double totalBrightness = QtConcurrent::blockingMappedReduced(
    images,
    computeBrightness,                       // map: QImage -> double
    [](double &accumulator, double value) { accumulator += value; }  // reduce
);
```

Note `mappedReduced`: it's the fusion of map and reduce into a single pass, which avoids building and holding in memory the entire intermediate collection of mapped results before combining them — useful when that intermediate collection would be large and you never need it as such, only the final accumulated value.

There's also a pair of lowercase variants, `QtConcurrent::map()` and `QtConcurrent::filter()` (not to be confused with `mapped`/`filtered`), which modify the collection **in place** instead of returning a new one — useful when you don't need to keep the original data and want to save the memory of a copy. In this module's practical project we'll use the "non-mutating" form (`mapped`) because we want to keep both the original images and the processed ones, for a comparison — but know that the alternative exists, and it's the right choice when the only thing you care about is the final result in place.

You'll have noticed the examples above use `QtConcurrent::blockingMapped()`, not `QtConcurrent::mapped()`. The difference is exactly what the name suggests: the `blocking*` version runs the work in parallel on the other threads but **waits** (blocking the calling thread) until everything is done before directly returning the collection of results — handy for a command-line script or for code already running on a secondary thread, but **to be avoided on the GUI thread**, for the same exact reason the next article formalizes. The version without the prefix, `QtConcurrent::mapped()`, immediately returns a `QFuture<T>` without waiting for anything — and that's the one we'll use in the practical project.

## The global QThreadPool: the thread warehouse behind the scenes

Every call to `QtConcurrent::run()`, `mapped()`, `filtered()` or `reduced()` you've seen so far never explicitly specifies *on which threads* the work runs. It's not magic: behind it there's a `QThreadPool`, and by default it's the global one, shared across the whole application, accessible via `QThreadPool::globalInstance()`.

![Diagram of the implicit global QThreadPool shared by QtConcurrent operations](modulo-03/13-global-thread-pool.png)

In the model from the previous modules, every job you wanted to run on a separate thread meant creating a new `QThread` — an operating system object, with its own stack, its own identity, a non-negligible cost to create and destroy. That's perfectly fine for a worker that lives a long time (your Producer or Consumer, alive for the whole duration of the program), but it becomes an obvious waste if the "job" lasts a few milliseconds and hundreds of them show up: you'd be creating and destroying hundreds of operating-system threads, paying the full cost every time, for work that at best occupies a small fraction of that time.

`QThreadPool` solves the problem by keeping a fixed number of threads **already created and ready**, and recycling them: when you queue a job (via `QtConcurrent::run()` or one of the `mapped`/`filtered`/`reduced` algorithms), the pool assigns it to the first free worker thread; when that thread finishes, **it doesn't die** — it becomes available again for the next job in the queue. You pay the cost of creating the operating-system thread once, at startup, not for every single job.

The default pool size is `QThread::idealThreadCount()` — typically the number of logical cores available on the machine (on this course's development machine, measured with `qDebug() << QThread::idealThreadCount();`, the value is **2**: you'll see it referenced several times in the practical project, because it's one of the numbers that determines how long our image batch really takes). The idea is that, for genuinely CPU-bound work like our blur, having more active threads than physical cores available doesn't help — it only introduces context-switching overhead — so the pool sizes itself to exploit exactly the parallelism the hardware offers, no more and no less.

You can change this size with `QThreadPool::globalInstance()->setMaxThreadCount(n)`, and you can also create your own private `QThreadPool` (passing it as the first argument to `QtConcurrent::run()`/`mapped()` in dedicated overloads) if you want to isolate a certain kind of work from the rest of the application — useful, for example, if you have a low-priority subsystem that should never compete for threads with the main processing. In today's practical project we'll always use the default global pool: for an application with a single type of CPU-bound work like ours, there's no reason to complicate things with multiple pools.

From here on, a simple rule: if your work can be **split into short, numerous jobs**, let `QThreadPool` manage them — it's literally the problem it was designed for. If instead you need **a single worker that lives a long time and keeps state between one operation and the next** (again, the Producer/Consumer from the previous module), a dedicated `QThread` remains the right tool — not everything has to go through the global pool.

## What's left to understand

You now know how to launch parallel work with `QtConcurrent::run()` and `mapped()`/`filtered()`/`reduced()`, and what happens behind the scenes in the global `QThreadPool`. What's left is understanding how to get progress notifications without ever blocking the GUI thread — the role of `QFuture` and, above all, of `QFutureWatcher` — and exactly in which cases to go back to the manual pattern from the previous modules instead. That's the subject of the next article.
