---
title: "Two event loops talking safely: queued connections and the lifecycle of a worker thread"
description: "Multithreading in C++ with Qt — Module 1"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Two event loops talking safely: queued connections and the lifecycle of a worker thread

In the previous article we turned the approach to `QThread` upside down: you don't subclass it, you use it as-is, and the logic goes into a separate worker moved with `moveToThread()`. One obvious practical question remains: if the worker now lives on a thread different from the GUI's, how do you communicate in both directions without reintroducing the race conditions we've already learned to fear?

## Two event loops, and how they talk to each other without risk

The answer is that you don't do it manually: Qt does it, automatically, through the same signal-and-slot mechanism you already know, with an extra behavior that kicks in silently whenever sender and receiver live on different threads. Every thread running an event loop — whether the GUI thread or a thread managed by a `QThread` that hasn't overridden `run()` — has its own **event queue**, independent of every other thread's. When you call `connect()` between an object living on thread A and one living on thread B, Qt compares the two thread affinities at the moment the signal is emitted and, if they differ, **does not call the slot directly**: it packages up the call (the method name, the arguments, everything) into an event and drops it into the queue of the thread that owns the receiver. That thread, when its turn comes around in its own event loop cycle, pulls the event out of the queue and **only then** actually executes the slot — on its own thread, with its own data, with no other thread touching that memory at the same instant.

![Two event loops connected by a queued connection](modulo-01/06-two-event-loops-queued-connection.png)

This kind of connection has a precise name, which we'll revisit with all the technical details later in the course: it's called a **QueuedConnection**, and it's one of the four connection modes Qt offers (the others are `DirectConnection`, `BlockingQueuedConnection`, and `AutoConnection` — the last of which is the default behavior, automatically choosing Direct if sender and receiver share the same thread, Queued otherwise — which is exactly the behavior we're relying on today without ever having to specify it explicitly). The conceptual point to take away today is this: **an ordinary signal-slot connection between objects on different threads is already, by itself, thread-safe**, because the signal never executes the receiver's code "on the spot" — it just leaves a message in its mailbox, and it's the receiver itself, when it's ready, that reads it and runs it. You don't need a `QMutex` to protect this exchange: Qt has already made it safe for you, as long as you always communicate through signals and slots and not, say, by directly calling a public method on the worker from outside, or by touching its member variables from another thread — that would once again, plain and simple, be a data race.

## The lifecycle of a worker thread, and the deleteLater() trap

Setting up a worker thread is only half the job: the other half — the one that separates robust code from code that leaks memory or crashes on application shutdown — is managing its birth, and above all its end, correctly.

A very common pattern, and the one we'll use in the hands-on project, is connecting the `QThread::started` signal — emitted automatically as soon as the managed thread has actually started its own event loop — to the worker's slot that kicks off the work:

```cpp
connect(thread, &QThread::started, worker, &Worker::start);
```

Notice that this connection is, once again, between objects on different threads (the signal is emitted *from* the managed thread as soon as it starts, but you're writing the connect statement itself from the GUI thread, and either way the worker lives on the managed thread) — so it's automatically queued, and `start()` executes safely on the right thread.

To stop a managed thread cleanly, the correct method is `QThread::quit()` (a pseudo-synonym for `exit(0)`): it posts an exit request into that thread's event queue, which the event loop processes as soon as its turn comes, returning from `exec()` — at that point `run()` returns, and the operating-system thread terminates naturally. This is fundamentally different from `QThread::terminate()`, a method that exists but that you should almost always avoid: it forces the thread to stop immediately, right wherever it happens to be, without giving it any chance to release resources, unlock mutexes it might be holding, or finish a half-completed file write — it's the thread equivalent of pulling the plug on a computer instead of shutting it down properly through the operating system, and the potential collateral damage is of the same kind.

After `quit()`, if you want to be certain the thread has **really** finished before proceeding (for instance, before destroying the worker), you call `wait()`, which blocks the calling thread until the managed one is truly done. This is exactly the sequence we'll use in our window's destructor shortly: `thread->quit(); thread->wait();` — first politely ask it to exit, then wait until it actually has, and only then is it safe to touch the worker's state again from the GUI thread.

A pattern you'll find very often in the official documentation and in Qt examples, for safely destroying a worker when its thread finishes, is this:

```cpp
connect(thread, &QThread::finished, worker, &QObject::deleteLater);
```

`deleteLater()` doesn't destroy the object immediately: it posts a deferred-deletion event into the event queue **of the thread the object currently belongs to** — not the calling thread — which will be processed and executed by that event loop at the first available opportunity. It's a mechanism specifically designed to be safe to call even from another thread, which is why it shows up so often in concurrent Qt code.

But there's a concrete trap hiding here: **if the thread the object belongs to has already stopped running its own event loop, that deletion event will never be processed**, and the object will never be destroyed — a silent leak, no crash, no warning, just memory that never comes back. It's a surprisingly easy situation to fall into: if you mistakenly call `quit()` on the thread *before* the `deleteLater()` event has been processed, or if you structure the order of your connections so that the deletion event arrives after the thread has already started shutting down, you end up with a ghost object that nobody will ever destroy.

In today's hands-on project we **deliberately avoid this complication**: our worker thread stays alive for the entire life of the application (it's a "persistent" worker, not a "disposable" one — more on this in a moment), and when the window closes we stop the thread with `quit()` + `wait()` and destroy the worker with a plain, ordinary `delete`, which is perfectly safe at that precise moment because, once `wait()` has returned, you are mathematically certain that no other thread is still executing code touching that object. The full pattern with `deleteLater()` for "disposable" workers — the kind that are born, do a piece of work, and must be disposed of automatically — we'll cover with all the attention it deserves later in the course, when we talk about cooperative cancellation and more elaborate lifecycles.

## Persistent worker versus disposable worker

One last conceptual distinction, before the hands-on project, because you'll run into it again later in the course: a **persistent** worker is created once, moved once to its thread with `moveToThread()`, and from there receives, over the lifetime of the application, as many work requests as needed, through repeated signals — this is the pattern we'll use today, suited to cases where you know the user will press that button over and over in the same session. A **disposable** worker, by contrast, is born to do a single piece of work, shuts down (with the `quit()` + `deleteLater()` sequence from before) once it's done, and if another computation is needed, a new one is created from scratch. Neither is "the right one" in an absolute sense: the choice depends on how many times you expect that work to repeat, and on how costly it is, in terms of resources, to keep an idle thread waiting around versus recreating it each time — the same granularity principle we already met earlier, applied here at the scale of an entire thread instead of a single instruction.

## From theory to hands on the keyboard

You now have the full vocabulary to build a robust worker thread: the difference between `QThread` and the thread it manages, the worker + `moveToThread()` pattern, the queued connections that make cross-thread communication automatically safe, and the correct startup and shutdown sequence. In the next article we put it all together, picking up exactly the window with the freeze from the previous module and curing it for real.
