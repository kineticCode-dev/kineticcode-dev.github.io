---
title: "QFuture, QFutureWatcher, and the question vibe coding always skips"
description: "Multithreading in C++ with Qt — Module 3"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QFuture, QFutureWatcher, and the question vibe coding always skips

In the previous article you saw how to launch parallel work with `QtConcurrent::run()` and the `mapped`/`filtered`/`reduced()` family, and how the global `QThreadPool` manages threads behind the scenes. Every `QtConcurrent` function you've seen so far (in its non-blocking form) returns a `QFuture<T>`. It's worth stopping to really understand what that is, because it's a different concept from anything you've seen in the previous modules.

## QFuture: a handle to the result, not the result

A `QFuture<T>` **is not** the result — it's a lightweight, copyable object that represents the *promise* of a result that might not be ready yet. You can query it at any time:

```cpp
QFuture<QImage> future = QtConcurrent::mapped(images, blurImage);

future.isRunning();      // is the work still running?
future.isFinished();     // has it finished (successfully or canceled)?
future.isCanceled();     // was it canceled?
future.resultCount();    // how many results are ready right now?
```

And you can, if you want, **wait** for it to finish, with `waitForFinished()`:

```cpp
future.waitForFinished();
QList<QImage> results = future.results();
```

Stop on this line, because it's exactly the kind of mistake this course has been dismantling since the very first practical project. Remember the window that froze because a long computation ran directly in a button's slot, on the GUI thread? `future.waitForFinished()` called on the GUI thread produces **exactly the same symptom**, for the exact same reason: you're blocking the thread that should stay free to process events (redraws, clicks, everything else) until the work on the other thread is done.

![Diagram of QFutureWatcher bridging QFuture signals to the GUI thread](modulo-03/14-qfuture-qfuturewatcher-bridge.png)

`waitForFinished()` has its legitimate place: on a thread that is **not** the GUI thread (for example inside another job already running on `QtConcurrent::run()`, or in a command-line script with no interface), or when you know for certain the work is already done or will finish in a negligible amount of time. On the GUI thread, for work lasting more than a few milliseconds, it should never be used this directly. The solution — the one you'll use throughout this module's practical project — is to **never wait**, and let Qt "knock" when the result is ready. The tool that does exactly this is `QFutureWatcher<T>`.

## QFutureWatcher: the future translated into Qt signals

`QFutureWatcher<T>` acts as a bridge between the world of `QFuture` (which by itself doesn't emit signals) and the world of signals and slots you already know well. A `QFutureWatcher` "observes" a `QFuture` via `setFuture()`, and translates every internal event of the future into a normal Qt signal, delivered — via a queued connection, exactly like the worker thread's signals — on the thread the watcher itself belongs to (almost always the GUI thread, if the watcher was created there).

```cpp
QFutureWatcher<QImage> *watcher = new QFutureWatcher<QImage>(this);

connect(watcher, &QFutureWatcher<QImage>::finished, this, [this, watcher]() {
    QList<QImage> results = watcher->future().results();
    // ... use the results, safely, on the GUI thread ...
});

QFuture<QImage> future = QtConcurrent::mapped(images, blurImage);
watcher->setFuture(future);   // the work has ALREADY started: setFuture() just observes it
```

No `QThread`, no `moveToThread()`, no mutex: the actual worker runs in the global `QThreadPool`, the `QFutureWatcher` lives quietly on the GUI thread, and the connection between the two goes entirely through signals that Qt delivers in a queue — the same event-delivery infrastructure you've already learned to trust.

`QFutureWatcher<T>` exposes a set of signals that mirrors, one to one, the kind of notifications that in the `QThread` module you had to build by hand inside your worker:

- **`started()`** — emitted when the connected future actually begins executing.
- **`finished()`** — emitted when all the work is done, whether it reached its natural end or was canceled. This is the point where it's safe to call `watcher->future().results()` to read all the results.
- **`canceled()`** — emitted (in addition to `finished()`, not instead of it) when the future was explicitly canceled via `watcher->cancel()`.
- **`progressRangeChanged(int minimum, int maximum)`** and **`progressValueChanged(int value)`** — report the overall progress of the work.
- **`resultReadyAt(int index)`** (and the `resultsReadyAt(int beginIndex, int endIndex)` variant for a range) — emitted every time a new result becomes available, indicating **which** index of the original collection is ready.

There's a detail the previous article already anticipated for final results, and it's worth repeating here for the *notifications*: `resultReadyAt(index)` tells you which element just became available, but it **does not guarantee the indices arrive in increasing order** — if two workers are working in parallel on different elements, whichever finishes first notifies first, regardless of which of the two had the lower index. What always remains true is that the underlying `QFuture` still keeps the results in the correct position — `resultAt(i)` (or `results()` as a whole) is always in the original order, even if the "ready" *notifications* arrived in a different order.

`watcher->cancel()` (equivalent to `watcher->future().cancel()`) requests that the remaining work be canceled — but, exactly like the cooperative flag you'll see formalized in the next module, **it does not interrupt midway** an element whose computation has already started on a worker: that element still finishes its single step, new ones simply aren't started after the cancellation request. `finished()` still fires at the end (together with `canceled()`), and `watcher->future().resultCount()` tells you how many results were actually collected before the interruption.

## QPromise: when you want to be the one producing the future

Everything you've seen so far starts from a `QFuture` that `QtConcurrent` builds for you. There's a case, more advanced and less frequent in everyday work, where you want the reverse relationship: writing your own custom asynchronous function that behaves like the `QtConcurrent` ones — returns a `QFuture`, supports cancellation and progress — without going through `mapped`/`filtered`/`reduced`. The tool, introduced in Qt 6, is `QPromise<T>`.

```cpp
QFuture<int> processWithProgress(const QList<int> &data) {
    return QtConcurrent::run([data](QPromise<int> &promise) {
        promise.setProgressRange(0, data.size());
        int accumulator = 0;

        for (int i = 0; i < data.size(); ++i) {
            if (promise.isCanceled()) break;   // cooperative cancellation, as always

            accumulator += processSingleItem(data[i]);
            promise.setProgressValue(i + 1);
        }

        promise.addResult(accumulator);
    });
}
```

`QtConcurrent::run()` recognizes that the lambda accepts a `QPromise<int>&` as its first parameter, and passes you an object already connected to the `QFuture<int>` that the function returns: inside the lambda you control the progress yourself (`setProgressValue`), the cooperative cancellation (`isCanceled()`, checked at every iteration — the same pattern as the `while` loop you saw for wait conditions, applied here to a loop), and the final result (`addResult`). From the outside, whoever calls `processWithProgress()` receives a `QFuture<int>` completely indistinguishable from one produced by `QtConcurrent::mapped()` — they can attach a `QFutureWatcher` to it exactly as you just learned.

We won't use `QPromise` in today's practical project — our use case (image blurring) fits perfectly into the ready-made `mapped()` pattern — but it's a tool worth knowing by name: the day you need to wrap a blocking third-party library (a camera SDK, for example, with its synchronous API) into something that integrates cleanly into the `QFuture`/`QFutureWatcher` ecosystem, `QPromise` is the right path.

## Exceptions across QFuture

One last thing to know before the practical project, because it's easy to forget about it and find out the hard way in production: what happens if the function you pass to `QtConcurrent::run()` or `mapped()` throws a C++ exception? It doesn't silently disappear, and it doesn't immediately crash the program from some arbitrary pool thread — Qt **catches** it on the worker thread and **rethrows** it when someone queries the future for the result:

```cpp
QFuture<int> future = QtConcurrent::run([]() -> int {
    if (errorCondition()) throw std::runtime_error("invalid data");
    return 42;
});

try {
    int value = future.result();   // or after waitForFinished()
} catch (const std::exception &e) {
    qWarning() << "Exception from worker:" << e.what();
}
```

The exception is rethrown at the point where you **read** the result (`result()`, `results()`, or the corresponding access after `waitForFinished()`) — not at the point where it was originally thrown. If instead you're using the `QFutureWatcher` pattern (the one in today's practical project), the natural place for the `try`/`catch` is inside the slot connected to `finished()`, right at the moment you access the results.

## QtConcurrent or manual QThread? The question vibe coding skips

We've reached the point that really closes the loop this module started with. `QtConcurrent` is convenient — convenient enough to be, historically, the first Qt multithreading tool many developers encounter, often without really knowing what they're choosing *not* to use by doing so.

![Comparison diagram of QtConcurrent versus manual QThread usage](modulo-03/16-qtconcurrent-vs-manual-qthread.png)

The right question to ask yourself, every time, before writing a line of concurrent code in Qt, is **"is my work a stateless transformation over a collection of data?"**

If the answer is yes — you have N elements, you apply the same operation to each, each computation is independent of the others, you don't need fine-grained coordination during execution, and once everything is done you just need the results — then `QtConcurrent::mapped`/`filtered`/`reduced` (or `run()` for a single job) is almost always the right choice. You get real parallelism, free thread pool management, no mutexes to write, no `QThread` life cycle to manage by hand. That's exactly today's practical project.

If instead your work has any of the following characteristics, `QtConcurrent` becomes the wrong tool, not because it "doesn't work", but because it forces something that is stateful by nature into a stateless box:

A **worker that lives a long time and keeps state between one operation and the next** — the Producer and the Consumer from the previous module weren't "transformations over a collection": they were objects with a life of their own, that kept working until the program stopped them. A **producer-consumer, a multi-stage pipeline** — when the output of one stage continuously feeds the next, and the coordination between the two (full/empty, backpressure) is the heart of the problem, not a detail. The **need for pause, stop, fine-grained cancellation during execution** (not just "cancel everything remaining", like `QFutureWatcher`'s cooperative `cancel()`, but "suspend now, resume later, with precise control over where you are") — this is exactly the topic of the next module. And **coordination via mutex/wait condition between threads that really need to talk to each other during the work**, not just exchange a final result.

In all of these cases, the `QThread` + worker object + `moveToThread()` + signals/slots pattern (with, if needed, `QMutex`/`QWaitCondition` for shared state) that you built in the previous modules remains the correct tool — not a "less modern" fallback. `QtConcurrent` doesn't replace that pattern: it *relieves* it of the cases where it would be needlessly heavy, which is exactly the data-transformation case you see today.

Holding onto this distinction — and being able to recognize it in thirty seconds when looking at a new problem, instead of reaching "by feel" for the tool you know best — is precisely the skill this module wanted to give you.

## From theory to hands on the keyboard

You now have the whole vocabulary to use `QtConcurrent` with full awareness: `QFuture` as a non-blocking handle, `QFutureWatcher` for safe notifications on the GUI thread, `QPromise` for advanced cases, exception handling, and — above all — the criterion for deciding when this tool is the right one and when it isn't. In the next article we put it all into practice with a real image-processing batch, with a measurement lesson that's worth the whole article on its own.
