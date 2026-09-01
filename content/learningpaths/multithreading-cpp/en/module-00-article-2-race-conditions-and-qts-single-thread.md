---
title: "When shared memory bites: race conditions, data races, and Qt's single thread"
description: "Multithreading in C++ with Qt — Module 0"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# When shared memory bites: race conditions, data races, and Qt's single thread

In the previous article we saw why threads exist and why it's worth using them: they share memory with no friction, and that makes them convenient and efficient. Now comes the uncomfortable part of the same story, because that convenience has a precise price: the very same shared memory that makes threads useful is exactly what makes them dangerous. You can't just "throw threads" at your problem and hope for the best.

## Race condition: when the result depends on who gets there first

A **race condition** happens whenever the final result of a program depends on the relative order — not controlled by you, decided by the scheduler — in which multiple threads perform operations on the same shared data. The textbook case is a shared counter incremented by multiple threads. The instruction, in C++, looks harmless and atomic only because it fits on one line:

```cpp
counter++;
```

But "looks like a single operation" and "is a single operation at the CPU level" are two different statements, and the second one is false. At the machine-instruction level, that increment typically breaks down into three steps: **read** the current value from memory into a register; **increment** the value inside that register; **write** the register back to memory. As long as one thread at a time runs this sequence, no problem. But if two threads execute these three steps interleaved, this can happen:

![Race condition: a lost update](modulo-00/04-race-condition-lost-update.png)

Look carefully at the sequence: both threads read the same initial value (10) before either of the two has had a chance to write its own result. Each correctly computes "the old value plus one" in its own private register — registers are private per thread, so there's no conflict yet at this point. The conflict explodes at the moment of writing: Thread B writes last, and its `11` overwrites the `11` written a moment earlier by Thread A, which should instead have produced a final `12` (two increments starting from 10). An entire increment has vanished into thin air, with no errors, no exceptions, not a single log message warning you: the program simply computed the wrong number. This phenomenon has a precise name, **lost update**, and it's probably the single most common concurrency bug there is.

## Data race: what the C++ standard actually says

It's worth making a precise technical distinction here. A **race condition** is the general phenomenon just described: the result depends on an uncontrolled interleaving order. A **data race** is the formal, narrower definition that the C++ standard gives to a specific case of race condition: two or more threads access the same memory location, at least one of those accesses is a write, and neither access is synchronized with respect to the other.

Here's the point that surprises almost everyone the first time: the C++ standard explicitly states that **a data race is undefined behavior**. Not "a bug," not "wrong but predictable behavior" — *undefined behavior*, the same severity category as an out-of-bounds array access. The practical consequence is that the compiler is legally allowed to assume a data race never happens in your program, and to optimize accordingly. With optimizations turned on, the compiler may decide to keep a counter in a CPU register for the entire duration of a loop, writing it to memory only once at the end — perfectly legitimate *if* no other thread were reading or writing that variable in the meantime, an assumption the compiler is entitled to take for granted precisely because the code, by violating the required synchronization, has already broken its contract with the standard.

The practical result is that the exact same "buggy" code can appear to work perfectly in an optimized build, and only show its true behavior in a debug build — which is a reason for greater concern, not less: a bug that "seems to disappear" with optimizations hasn't disappeared at all, it has just become invisible precisely under the conditions where you would most likely have tested it.

## Critical section and mutual exclusion

The conceptual remedy is called a **critical section**: a stretch of code that accesses shared data and that must be executed by only one thread at a time — not because the code is slow or dangerous, but because access to the data it touches must remain **atomic**, in the strict sense of the word (from the Greek "that cannot be cut"): either it has already happened entirely, or it hasn't started yet, never seen halfway through. Guaranteeing that a critical section is respected by all threads is called enforcing **mutual exclusion**, and that is exactly the role of a **mutex** (short for *mutual exclusion*): the most basic tool — and the one you'll use first in this module's hands-on project — for turning a dangerously separable sequence of operations into a block that is indivisible in the eyes of other threads.

## Why Qt enforces a single thread for the GUI

Here's a constraint that, seen without context, looks like a library's whim: Qt requires that **all the widgets of your graphical interface be created and manipulated exclusively by the program's main thread**, often called the "GUI thread." It's not an arbitrary invention: it inherits a constraint that comes from much lower in the software stack, from the operating system's native graphics toolkits — the Win32/GDI subsystem on Windows, X11 or Wayland on Linux, Cocoa on macOS. These toolkits were designed around the assumption that there is a single "message loop" that receives events from the operating system (a click, a key press, a redraw request) and dispatches them one at a time, in sequence, to the interested widgets. Allowing different threads to simultaneously manipulate the same native graphical structures would have required heavy synchronization at every level of the toolkit, at an enormous cost for an interface that, after all, only has to react to human events — slow, compared to CPU timescales. The historical choice, nearly universal across all desktop GUI toolkits, was: only one thread may touch the GUI, period, and in exchange that thread can stay simple and efficient because it never has to worry about being interrupted halfway through an operation by another thread touching the same window.

Qt formalizes this constraint explicitly with the concept of an **event loop**: the main thread, after creating the windows, enters a loop (`app.exec()`) that does exactly one thing, forever, until the application closes: wait for the next event, process it **to completion**, then go back to waiting for the next one. The key phrase is "to completion": if the code that processes an event decides to run a computation that takes four seconds instead of four milliseconds, the event loop stays stuck inside that single event for four whole seconds, and during that time it cannot process **any other event** — not a click, not a timer, not even the event the operating system periodically sends to check that the application is still "alive."

![The window freezes: the GUI thread is busy](modulo-00/06-gui-thread-blocked.png)

This is exactly the phenomenon we'll see live in a moment, and it's precisely the problem that, in the next module, we'll solve by introducing `QThread` and the worker-object pattern: moving the long computation *out* of the thread that owns the GUI's event loop, so that the latter always stays free to respond within a few milliseconds. This isn't a Qt implementation detail: it's a direct, unavoidable consequence of everything you've just read, applied to the specific case of a user interface.

## When it's worth using a thread (and when it isn't)

Before writing any code, it's worth putting down a compass that will keep being useful for the rest of this path, because "one more thread" is never free and is never automatically the right choice.

The first distinction to make is whether the work you want to hand off to a thread is **CPU-bound** or **I/O-bound**. Work is CPU-bound when the bottleneck is purely computational — the CPU stays busy the whole time, without pauses, like counting prime numbers or an image-processing filter applied pixel by pixel. Work is I/O-bound when, instead, the thread spends most of its time not computing at all: it's *waiting* — for a network reply, a disk read, a frame being acquired from a camera with its own physical exposure time. For CPU-bound work, the benefit of multithreading depends strictly on how many physical cores you actually have available (Amdahl's law from the previous article comes back: more threads than free physical cores doesn't give you more speed, it just gives you more context switching). For I/O-bound work, on the other hand, multithreading makes sense even on a single core, because the waiting thread isn't "wasting" a core — it's simply letting the scheduler give that time to someone else, typically the GUI thread, which stays responsive in the meantime.

The second compass point is **granularity**, already encountered when discussing context switches: a thread that lives for less time than it takes to create it, start it, have it contend for CPU with the others, and then destroy it, is a bad deal. That's why, further along in this path, we'll prefer a **thread pool** — where threads are created once and reused for many tasks — over creating a new thread for every single piece of work.

And finally, the simplest question, and the one most often skipped: **does your program actually need to be faster, or just to stay responsive?** These are two different problems, with different solutions. If the problem is UI responsiveness during a long but isolated operation, *one* worker thread is enough — no need for a thread pool, no need to worry about exploiting every core of the machine. If instead the problem is "this computation takes too long and I want to split it up to finish sooner," then you're in the territory of real parallelism, with everything Amdahl's law has already said about its limits. Confusing these two goals is, in practice, the most common cause of needlessly complicated concurrency architectures for problems that would have called for a much simpler solution.

## From theory to hands on the keyboard

You now have a precise vocabulary — race condition, data race, critical section, mutual exclusion, event loop — and you know why Qt made the choice it made for its GUI. Only one thing is missing: seeing it actually happen, with your own hands on the keyboard. That's exactly what we do in the next article, with two small guided projects — one in plain C++, without Qt, and one that recreates live the window freeze we've just been talking about.
