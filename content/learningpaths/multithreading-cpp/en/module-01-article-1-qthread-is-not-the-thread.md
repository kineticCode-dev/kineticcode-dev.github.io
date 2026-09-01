---
title: "QThread is not the thread: it's a remote control (and why subclassing it is misleading)"
description: "Multithreading in C++ with Qt — Module 1"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QThread is not the thread: it's a remote control (and why subclassing it is misleading)

In the previous article you saw the problem with your own eyes: a button that, once clicked, stops the window's heartbeat for a few seconds, because the slot reacting to the click runs a heavy computation directly on the thread that owns the GUI's event loop. This article starts the cure, and it's worth being honest about one thing right from the start: `QThread` is probably the most misunderstood class in the entire Qt library, and not through the fault of the people using it, but because of a specific historical accident. For years, Qt's own official documentation and examples taught a way of using it that, in a 2010 article that became legendary in the Qt community, an engineer from the Qt team himself publicly titled *"You're doing it wrong"* — referring to the way even the framework's own official examples presented it up to that point. If you've read somewhere, or remember from some tutorial you saw years ago, that "to use QThread you need to subclass it and override `run()`", it's not your fault it looked like the natural way: it was, literally, what Qt itself taught.

## QThread is not "the thread": it's a remote control

Start from a misconception so common that it's worth taking apart right away, before writing a single line of code: when you create a `QThread` object, that object **is not** the operating-system thread. It's a `QObject` — a C++ class like any other, with its own constructor, its own methods, its own place in Qt's parent-child tree — that **represents and controls** an operating-system thread, a bit like the remote control for a TV set is not the TV itself: you turn it on, turn it off, change the channel, but the remote itself sits comfortably on your couch, not inside the appliance.

When you write `QThread *thread = new QThread(this);` inside, say, the constructor of your `MainWindow`, that `QThread` instance **is born and lives on the thread where you created it** — almost always the main GUI thread, exactly like any other `QObject` you construct there. It has a handful of methods that make up its "control panel": `start()` to launch the operating-system thread it manages, `quit()` to politely ask it to stop its own event loop, `wait()` to block until that thread has actually finished, `isRunning()` to query its status. Calling these methods is safe from the main thread precisely because the `QThread` object itself lives there.

![QThread is not the thread: it's a remote control](modulo-01/05-qthread-is-a-remote-control.png)

When you call `thread->start()`, something distinct and separate happens: Qt makes the system call that actually creates a new operating-system thread (the same underlying mechanism as `std::thread`, which you've already met), and on that new thread it starts executing the virtual method `QThread::run()`. If you haven't overridden it — and in the pattern we'll adopt in this article we never will — the default implementation of `run()` simply does one thing: it calls `exec()`, meaning it starts an **event loop** on that new thread, conceptually identical to the one the main thread starts with `QApplication::exec()` when the application launches. From this moment on, that operating-system thread exists for one precise purpose: to wait for events (in this case, almost always signals arriving from other threads) and process them one at a time, in order — just like the GUI thread, except that now this second event loop runs on a completely separate thread.

## The old pattern: subclassing QThread (and why it's misleading)

The natural instinct, when you want to run code on a separate thread using an object-oriented class like `QThread`, is this: create your own class that inherits from `QThread`, put the logic that needs to run on the separate thread inside it, maybe even a few slots to receive commands. In code:

```cpp
class MyThread : public QThread {
    Q_OBJECT
public:
    void run() override {
        // heavy work here
    }

public slots:
    void otherMethod() {
        // ... here comes the surprise
    }
};
```

This code compiles, and the part inside `run()` executes exactly where you'd expect: on the operating-system thread managed by this instance, because `run()` is precisely the method Qt invokes on that thread as soon as it starts. So far, everything matches intuition. The problem — the one that produced the "You're doing it wrong" article and years of confused bug reports on Qt forums — concerns `otherMethod()`: it's a slot declared in the same class, but it **does not execute on the thread managed by this instance at all**. It executes on the thread that **owns** the `MyThread` object itself — which is, almost always, the main thread that created it with `new MyThread()`. The reason is the same as before: a `QObject` (and `QThread` is still a `QObject`, with all the signal-and-slot infrastructure that implies) runs its own slots on the thread it **belongs to** — its thread affinity — not on the thread it happens to manage as the "content" of `run()`. `run()` is a special case, the one method Qt guarantees really does execute on the managed thread; every other slot in the same class follows the general rule, not that exception.

Historically, this has led developers to write code that seemed to work in the simple cases — when all you need is to run an isolated block of computation, without needing to receive further commands via signals — and to break silently the moment that thread also had to react to external events during execution, with race conditions or unexplainable behavior that nobody could diagnose without having read, precisely, that 2010 article.

## The recommended pattern: worker object and moveToThread()

The solution the Qt community (and today the official documentation itself) recommends turns the approach upside down: **never subclass `QThread`**. Always use it exactly as it is, identical in every project — the remote control from before, unmodified. The business logic, instead, goes into a separate class that inherits only from `QObject` — conventionally called the **worker** — and that knows nothing, and cares nothing, about threads or about `QThread`. It's a pure piece of logic. Then, a single method does all the magic:

```cpp
worker->moveToThread(thread);
```

`moveToThread()` changes the **thread affinity** of the `worker` object: from this moment on, that object "belongs" to `thread` instead of the thread that created it, and — this is the part that matters — **every one of its slots, called through a queued connection, will execute on the thread managed by `thread`**, no exceptions, no special cases to memorize.

![Thread affinity before and after moveToThread](modulo-01/08-thread-affinity-before-after.png)

There's a technical constraint you need to know, because you'll run into it in the hands-on project shortly: a `QObject` **with a parent** (in the sense of Qt's parent-child tree, `new Worker(this)`) **cannot be moved** with `moveToThread()` — the call fails silently with a runtime warning, not a compile error, which makes it an easy trap to miss. The reason makes sense once you think about it: Qt's parent-child tree assumes a parent and its children live on the same thread (that's how, for instance, cascading destruction works); moving a child to a different thread than its parent's would break that guarantee. The practical consequence is that your worker must be constructed **without a parent** — `new PrimeCalculator()`, not `new PrimeCalculator(this)` — with its lifetime managed explicitly by you, as we'll see in the next article about lifecycle.

![Comparing the two patterns: subclassing QThread versus worker plus moveToThread](modulo-01/07-subclass-vs-movetothread-comparison.png)

With this pattern, `QThread` stays an anonymous, never-customized object, reusable identically in every Qt project you'll write from now on; it's the worker, a perfectly ordinary `QObject` class with its own slots and signals, that carries all the logic — and **every one** of its slots, with no exceptions to remember, executes correctly on the managed thread. This is precisely the pattern we build together in this module's hands-on project.

## What's left to understand

You now know the difference between the `QThread` object and the thread it manages, and why subclassing `QThread` is almost always the wrong choice compared to the worker + `moveToThread()` pattern. One obvious practical question remains: if the worker now lives on a different thread, how do I tell it "start the computation" from the GUI thread, and how does it tell me "I'm done" back on the GUI, without reintroducing the race conditions we studied? That's the subject of the next article, along with the full lifecycle of a worker thread — and then, finally, hands on the keyboard to seriously cure the freeze from the previous module.
