---
title: "Waiting for an event, not a lock: QWaitCondition, QSemaphore, and how to shoot yourself in the foot"
description: "Multithreading in C++ with Qt — Module 2"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Waiting for an event, not a lock: QWaitCondition, QSemaphore, and how to shoot yourself in the foot

In the previous article we saw how to protect shared data with `QMutex` and `QReadWriteLock`. But the producer-consumer pattern needs to answer a different, more subtle question: "the buffer is full — I need to wait until *something changes*, not just until the lock is free." A mutex alone isn't enough to express "wait until some condition on the data becomes true": you could keep it locked forever in a loop that keeps rechecking (a busy wait, which wastes CPU for nothing), or you need a tool built specifically for this. That tool is `QWaitCondition`.

## QWaitCondition: waiting for an event, not just a free lock

A `QWaitCondition` lets a thread **fall asleep**, temporarily releasing a mutex it holds, stay waiting until another thread explicitly **wakes** it, and only then reacquire the mutex and resume. The crucial part, the one that makes it different from a simple "sleep and recheck," is that falling asleep and releasing the mutex happen as a single atomic operation: there is never a window of time in which the thread has already released the lock but is not yet "registered" as waiting — a window that could otherwise cause a wake-up sent at exactly that instant to be lost (a classic bug called a *lost wakeup*, which `QWaitCondition` prevents by construction).

The usage pattern is always the same:

```cpp
QMutex mutex;
QWaitCondition condition;
bool dataReady = false;

// Waiting thread:
QMutexLocker locker(&mutex);
while (!dataReady) {
    condition.wait(&mutex);   // releases the mutex, sleeps, reacquires it on wake-up
}
// the mutex is back in my hands here, and dataReady is true

// Notifying thread:
{
    QMutexLocker locker(&mutex);
    dataReady = true;
}
condition.wakeOne();   // or wakeAll(), if more than one thread must be woken
```

Notice the `while`, not a plain `if`: it's deliberate, not stylistic pickiness. On waking up, the code **must recheck the condition it was waiting on from scratch**, because there can be "spurious" wake-ups (for reasons internal to the operating system, without anyone actually having called `wakeOne()`), or because — in the case of `wakeAll()` with several threads waiting — another thread might have beaten you to it and already consumed what you were waiting for before you truly regained control. Using `if` instead of `while` is one of the most common and hardest-to-spot mistakes in wait-condition-based code: it works almost every time in testing, and fails rarely, in production, at a moment nobody can reproduce on demand.

`wakeOne()` wakes exactly one waiting thread (if there's more than one, which one is unspecified — never rely on any ordering); `wakeAll()` wakes all of them, each of which will still recheck its own condition (hence, again, the importance of the `while`) and go back to waiting if the condition isn't yet the right one for it.

In this module's hands-on project you'll use **two** distinct `QWaitCondition`s on the same buffer: one for the direction "the buffer is full, the producer waits," one for "the buffer is empty, the consumer waits." It's a standard pattern, and seeing it applied with your own hands will clarify it far better than any further abstract explanation.

## QSemaphore: counting instead of waiting on a boolean

There's one last primitive worth knowing, even though we won't use it directly today: `QSemaphore`. A semaphore (in the computer-science sense, a concept dating back to Dijkstra in the 1960s) is, conceptually, a non-negative integer counter with two operations: `acquire()`, which decrements the counter but **blocks** the caller if the counter is already at zero, waiting for it to become positive again; and `release()`, which increments the counter and wakes any threads waiting on `acquire()`.

Why is it useful? Because it naturally expresses the idea of "N interchangeable resources available" — not "the buffer is full or empty" in a boolean sense, but "how many free slots there are right now," counted explicitly. This module's producer-consumer problem can also be solved this way, and it's instructive to see the correspondence: two semaphores, `freeSlots` initialized to the buffer's capacity and `usedSlots` initialized to zero, where the producer does `freeSlots.acquire()` before inserting and `usedSlots.release()` afterward, and the consumer does exactly the opposite. The end result is behaviorally equivalent to what we build with `QWaitCondition` — it's the same idea, the same pair of "full" and "empty" conditions, just expressed with a counter instead of a boolean plus two explicit wait conditions.

Which of the two styles should you pick, in real code you write after this course? `QWaitCondition` (the one we'll use today) is the right tool when the waiting condition is richer than a simple count — for example, "wait until the buffer contains *an element with a certain property*," not just "wait until it's not empty." `QSemaphore` is more direct and readable when your problem is, literally, a count of available resources — a connection pool, a fixed number of hardware slots, a limit on how many concurrent operations are allowed. Neither is "superior": pick whichever one more faithfully mirrors the actual shape of the problem.

## Deadlock: circular waiting

Introducing mutexes and wait conditions without talking about how to shoot yourself in the foot with them would be dishonest. Three pitfalls, in order of how common they are in practice.

A **deadlock** happens when two (or more) threads stay blocked forever, each waiting for a resource that another thread in the group holds and will never release — because that other thread, in turn, is waiting for something the first one holds. Thread A holds Mutex X and is waiting to acquire Mutex Y; Thread B, at the same time, holds Y and is waiting for X. Neither can proceed, neither will ever release what it holds (because to release it, it would first have to finish its own work, which is blocked), and the program just sits there, silently, forever — no crash, no error message, just two threads that no longer do anything.

![Deadlock: circular waiting](modulo-02/11-deadlock-circular-wait.png)

The condition that makes this scenario possible has a name in classical operating-systems literature (the "Coffman conditions," named after one of the authors of the 1971 paper that first formalized them), and there are four of them, all necessary at the same time for a deadlock to occur: mutual exclusion (resources cannot be shared), hold-and-wait (a thread holds one resource while waiting for another), no preemption (a resource cannot be forcibly taken away from whoever holds it), and **circular wait** (there is a cycle of threads, each waiting for a resource held by the next one in the cycle). Of the four, the first three are almost always intrinsic to the problem you're solving — you can't eliminate them without distorting the solution. The fourth, circular wait, is the one you actually have leverage over, and that's why every deadlock guide converges on the same recommendation: **establish a fixed global order in which locks are always acquired**, at every point in the program, without exceptions. If every thread that needs both X and Y always acquires them in the same order (say, always X first and then Y, never the other way around), the cycle becomes structurally impossible: there can be no circular wait if everyone queues in the same direction.

In today's hands-on project the risk of deadlock is low because we use a single mutex (the one internal to the buffer) — but it's a risk that grows quickly as soon as a real project starts having several separately protected resources, and that's why it's worth nailing down the principle now, before you need it under pressure with a debugger open and a program that no longer responds.

## Starvation: technically alive, effectively forgotten

**Starvation** is sneakier than deadlock because it doesn't block everything: a specific thread simply never gets the resource it needs, even though there's no waiting cycle preventing it in theory — it's always cut in front of by other, "luckier" or more frequent threads. It's exactly the violation of the third property seen in the previous article, bounded waiting. `wakeOne()` on a `QWaitCondition` with many threads waiting, for example, doesn't guarantee a fair wake-up order (it's not necessarily FIFO) — in scenarios with very high contention and lopsided access patterns, it's theoretically possible for the same thread to stay unlucky for longer than you'd expect. For our hands-on project, with a single producer and a single consumer, this risk is zero by construction (there's nobody to cut in front of); it becomes a real factor to consider once your system grows to multiple producers or multiple consumers on the same buffer.

## Priority inversion: when the operating system adds an unwelcome third party

One last pitfall, rarer but worth knowing by name because when it happens it's particularly hard to diagnose: **priority inversion**. It happens when a **low-priority** thread holds a lock that a **high-priority** thread needs; the latter blocks waiting, which would already be normal on its own — but if, in the meantime, a third thread at **medium** priority (which doesn't need that lock at all) keeps the CPU busy, the scheduler keeps giving it room at the expense of the low-priority thread holding the lock, which never gets to finish its work and release it. The net result is that the high-priority thread ends up indirectly blocked by a medium-priority one — a complete inversion of the priority order the system was supposed to respect.

It's a real enough problem that it historically caused the near-failure of NASA's Mars Pathfinder mission in 1997 — a case study cited very often in the literature precisely for this reason. I tell the full story in a separate article, because it's worth understanding exactly how a synchronization problem on a rover 225 million kilometers away turned into periodic resets of the whole system, and how it was diagnosed and fixed — see *"Mars Pathfinder: When Priority Inversion Reaches Mars."*

The classic operating-system-level mitigation is called *priority inheritance*: temporarily, the low-priority thread holding the contested lock "inherits" the priority of the higher-priority thread waiting for it, so the scheduler favors it enough to let it finish its work and release the lock. Qt doesn't handle this automatically at the application level — it's typically a responsibility of the underlying operating system's scheduler — but knowing that the phenomenon exists, and recognizing its symptoms (a high-priority thread mysteriously slow, in the presence of load from medium-priority threads), will save you hours of debugging the day you run into it in a system with real-time constraints.

## From theory to hands on the keyboard

You now have all the tools to protect and coordinate real shared state: `QMutex`, `QReadWriteLock`, `QWaitCondition`, `QSemaphore`, and the vocabulary to recognize deadlock, starvation, and priority inversion when you meet them. In the next article we put it all together by building a real producer-consumer, with two persistent threads contending for a bounded buffer right in front of you.
