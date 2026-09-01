---
title: "The critical section, formalized: QMutex, QMutexLocker, and QReadWriteLock"
description: "Multithreading in C++ with Qt — Module 2"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# The critical section, formalized: QMutex, QMutexLocker, and QReadWriteLock

In the previous module you learned how to run work on a separate thread and have it talk to the GUI safely — but if you look closely, you never actually needed a real mutex. The worker and the window never touched the same variable at the same moment: they exchanged messages through signals, and Qt took care of delivering them one at a time, queued, without overlap. That's an elegant way of avoiding the shared-memory problem by avoiding, precisely, the sharing — an isolated worker with its own private state, talking to the outside only through signals.

This article deals with the case where that elegance is no longer enough: two or more threads that genuinely need to read and write the **same data structure**, at the same moment, because that sharing is exactly the point of the program — not a side effect to be avoided. It's the classic case, ancient in the history of operating systems and yet still today the daily bread of anyone writing real concurrent software: the **producer-consumer** pattern. One thread generates data at a pace it doesn't fully control (a sensor, a network, in a vision system a camera delivering frames at a given frame rate); another thread processes it at a different pace, almost always slower and more irregular. Between the two, a warehouse of limited capacity — the **buffer** — absorbs the speed differences, up to a point: if the producer runs too fast, the warehouse fills up and it has to wait; if the consumer runs short of work, it waits instead.

## The critical section, formalized

You've already seen the critical section as "the stretch of code that only one thread at a time may execute." It's useful to picture it as a corridor with a single door, exactly wide enough for one person. Whoever arrives and finds the door occupied waits in line outside; whoever is inside leaves when done, and only then can the next person in line come in.

![The critical section as a one-way corridor](modulo-02/09-critical-section-corridor.png)

But "one thread at a time" alone isn't enough to define a *correct* solution, and it's worth writing down, once, the three properties that classical operating-system theory requires of any synchronization mechanism — because every tool we'll see in this module has to be judged against these three, not just against "it works in my tests."

**Mutual exclusion**: never more than one thread inside the critical section at the same instant. It's the most obvious property, the one we've already dwelt on before, and no tool we'll see today ever violates it — it's the bare minimum.

**Progress**: if the critical section is free and one or more threads want to enter, the decision of who gets in cannot be postponed forever by factors that have nothing to do with actual use of the resource. Put simply: there must be no scenario where the door is free but nobody ever manages to get through because of a flaw in the mechanism itself.

**Bounded waiting**: a thread waiting to get in must, sooner or later, succeed — it's not acceptable for someone else to keep cutting in front of it indefinitely. This is the subtlest property, and it's precisely the one that breaks down in the **starvation** problems we'll meet later: a thread technically could enter, the mutual-exclusion guarantee is never violated, and yet in practice it never gets its turn because the "traffic" through the critical section always cuts in ahead of it.

Keep these three properties in mind as your yardstick: every time you design a synchronization scheme — in this module or in your real work — these are the three questions to ask yourself, in this order.

## QMutex and QMutexLocker: the basic tool

`QMutex` is Qt's native equivalent of `std::mutex`, which you already used in the first article of this course. The conceptual behavior is identical — `lock()` enters the critical section (waiting if necessary), `unlock()` leaves it — with a few practical differences worth knowing.

It's not gratuitous redundancy that Qt has its own mutex. `QMutex` existed in Qt before `std::mutex` became part of the C++ standard (which only arrived with C++11), and today it remains the natural choice in Qt code for a couple of concrete reasons: it integrates better with Qt Creator's debugging tools (which can inspect a `QMutex`'s state in the debugger in a more readable way), and above all Qt offers, distinct from `QMutex`, a `QRecursiveMutex` class for the (rare, and to be used with suspicion) cases where a thread needs to be able to acquire the same lock more than once without blocking itself — useful in recursive call hierarchies that pass through the same critical section multiple times, but also almost always a warning sign that the synchronization design could be simplified.

Exactly like `std::lock_guard`, `QMutexLocker` acquires the lock in its constructor and releases it in its destructor:

```cpp
void SharedBuffer::produce(int value) {
    QMutexLocker locker(&m_mutex);
    // ... critical section ...
} // automatic unlock here, whichever way the function exits
```

The advantage of the RAII pattern here isn't just aesthetic: if there's an early `return` inside the critical section, or if an exception were thrown, `QMutexLocker` still guarantees the unlock — a hand-written `mutex.lock()` / `mutex.unlock()` would leave you with a permanently locked mutex in either of those cases, one of the sneakiest and hardest-to-diagnose bugs in all of concurrent programming, because the symptom (the program hangs) shows up far away, in time and in code, from the cause (the missing `unlock()`).

Besides `lock()` (blocking, waits as long as needed), `QMutex` offers `tryLock()`, which attempts to acquire the lock and returns immediately with `true` or `false` depending on whether it succeeded, without ever blocking — useful when your thread has a sensible alternative to fall back on if the resource is busy, instead of queuing up. There's also a timeout variant, `tryLock(milliseconds)`, which waits at most the given time before giving up. We won't use them in this module's hands-on project — our producer and consumer *must* wait, they have no plan B — but you'll naturally come across them the day you design code with tighter responsiveness constraints.

## QReadWriteLock: when most of the traffic is reads

There's a very common scenario where `QMutex` is more restrictive than it needs to be: when a shared piece of data is **read** very often by multiple threads and **written** rarely. Think of a configuration table, or a calibration map in a vision system, loaded once and then continually consulted by several processing threads: with an ordinary `QMutex`, even two reads — operations that, on their own, never interfere with each other, since neither one modifies anything — would be forced to queue up one behind the other, wasting parallelism the hardware would otherwise give you for free.

`QReadWriteLock` explicitly distinguishes the two intentions. When several threads only want to **read**, they can all do so together, at the same moment — neither blocks the other, because a read doesn't alter the state another read is observing. The moment a thread wants to **write**, though, the lock becomes exclusive in the strictest sense: no other thread, reader or writer, can access the data until the writer is done.

![QReadWriteLock: concurrent reads, exclusive write](modulo-02/12-readwritelock-readers-writer.png)

The practical use follows the same RAII spirit already seen: `QReadLocker` to acquire for reading, `QWriteLocker` to acquire for writing, both released automatically at the end of scope.

```cpp
double readCalibration(int index) const {
    QReadLocker locker(&m_lock);
    return m_calibrationValues.at(index);
}

void updateCalibration(int index, double newValue) {
    QWriteLocker locker(&m_lock);
    m_calibrationValues[index] = newValue;
}
```

A word of caution, because it's a common conceptual mistake: `QReadWriteLock` is **not always faster** than `QMutex`, even in read-heavy scenarios. The mechanism that keeps track of "how many readers are inside right now" has a non-zero internal cost, and for very short critical sections (a few instructions) that bookkeeping cost can outweigh the benefit of the parallelism gained — the same granularity lesson already met when discussing context switches, applied here again: the right choice depends on how much time you actually spend inside the critical section and how lopsided the traffic is between reads and writes, not on a generic intuition about which primitive "sounds" more efficient.

## What's still missing

With `QMutex`, `QMutexLocker`, and `QReadWriteLock` you already know how to protect shared data from simultaneous access. But the producer-consumer pattern needs something more subtle: not just "can I get in?", but "I need to wait until *something changes*, not just until the lock is free." That's the subject of the next article, along with the classic dangers — deadlock, starvation, priority inversion — that any serious synchronization has to be able to recognize.
