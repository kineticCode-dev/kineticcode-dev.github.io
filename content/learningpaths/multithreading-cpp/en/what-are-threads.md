---
title: "What threads are, and why we need them"
description: "The essential basics before writing multithreaded code: what an operating system thread actually is, why we use them, and what can go wrong if we treat them carelessly."
---

A process is the running program: its memory, its open files, its address space. A **thread** is a flow of execution inside that process. A process can have just one (the simplest case) or several, and all threads of the same process share the same memory: global variables, the heap, everything.

That is both the strength and the weakness of multithreading compared to spawning separate processes:

- **Strength**: sharing memory is extremely fast. No data serialization, no inter-process communication — threads simply pass a pointer around.
- **Weakness**: sharing memory means two threads can read and write the same variable *at the exact same instant*, with nothing at the language level stopping them.

## Why we actually need them

In day-to-day work on embedded and industrial software, threads show up in very concrete scenarios:

- one thread continuously reading from a serial port or a Modbus bus, while another processes the data and a third updates a user interface;
- a fixed-frequency control loop (e.g. 1 kHz) that must never be blocked by a slow operation like a disk write or a network call;
- separating business logic from anything that is I/O, so a responsive application doesn't turn into one that "freezes" every time something is slow.

## The underlying problem: the race condition

When two or more threads access the same variable and at least one of them modifies it, with no coordination whatsoever, that's a **race condition**. The final outcome depends on the — non-deterministic — order in which the operating system's scheduler decides to advance the threads.

The classic case is a seemingly harmless increment:

```cpp
counter++;
```

At the CPU level, this single line is not one atomic operation at all. It typically compiles down to three steps:

1. read the current value of `counter` into a register;
2. increment the register;
3. write the register back into `counter`.

If two threads execute these three steps in parallel, one of the two increments can silently disappear: both read the same starting value, both increment it, both write back the same result — instead of two separate increments, only one ends up applied.

In the next lesson, a hands-on project: we'll reproduce this exact bug on a shared counter, measure it, and fix it with a synchronization primitive.
