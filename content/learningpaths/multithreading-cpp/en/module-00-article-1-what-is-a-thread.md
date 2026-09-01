---
title: "What a thread really is (and why you suddenly need to know)"
description: "Multithreading in C++ with Qt — Module 0"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# What a thread really is (and why you suddenly need to know)

There's a moment, in the life of a programmer, when `QtConcurrent::run` stops looking like magic. Before that moment it just works: you pass a function, it runs "somewhere", the result comes back, everyone's happy. The problem is that "it worked" and "I understood why it worked" are two very different statements, and the difference is almost always paid at the worst possible moment — a Friday evening, in production, with a crash you can't reproduce on demand because it depends on how the operating system's scheduler decided, at that exact instant, to interleave your threads. There's no way around this with more experience in other areas of programming: a sequential logic bug is deterministic, you see it the same way every time; a concurrency bug is, by nature, capricious.

This article doesn't touch a single line of Qt code yet. That's on purpose: before looking at how Qt solves concurrency problems, it's worth understanding what those problems really are, stripped bare, with no framework on top hiding the mechanisms. If you understand the physical constraint first, every design choice you'll find later in this path stops looking arbitrary.

## A process does nothing on its own

When you launch a program, the operating system creates a **process**: an address space, a block of virtual memory that the program believes is entirely its own, isolated from every other process running on the same machine. If your program writes to address `0x1000` and another process also writes to `0x1000`, there's no conflict at all: those are two *virtual* addresses, translated by the CPU's MMU into two completely different physical memory pages. This isolation is one of the most important gifts a modern operating system gives you: a process that crashes, under normal conditions, doesn't take the others down with it.

But inside that isolated space, the process by itself executes nothing. Something is needed that actually advances the instructions, one at a time. That something is the **thread**. For decades a process had exactly one thread, and the concept of a "thread" separate from the process didn't even exist, because it wasn't needed. It was born when a very practical problem was understood: creating an entire process — a new address space, new page tables, new file handles — is an expensive operation, and if all you want is "run several things together, sharing the same data," duplicating the whole process is a huge waste. A lighter execution unit was needed, one able to share the address space instead of duplicating it. It's no accident that in older literature the thread is literally called a "lightweight process."

![Process and thread: what is private and what is shared](modulo-00/01-process-vs-thread.png)

Every thread inside the same process shares with all the other threads the **heap** (memory you allocate dynamically), the **global and static variables**, the **open files**, and the **code segment**. This is the convenient part: two threads exchange data simply by reading and writing the same variable, without needing the heavy machinery that two separate processes would need to communicate.

But every thread also has a **private** slice of state that no other thread ever touches directly: the **stack**, where local variables and return addresses live; the **CPU registers**, holding the values the thread is computing on at this exact instant; the **program counter**, pointing to the next instruction to execute. If two threads execute the same function at the same time, each has its own stack with its own local variables — no interference there. That's why a function that doesn't touch shared state is automatically safe to call from multiple threads at once: it's called **thread-safe by construction**, or **reentrant**.

Fix this point firmly in your mind, because it's the root of everything that follows in this path: **the sharing of heap and global variables is not an implementation detail, it is the reason the thread exists**. And it is, precisely, the source of every concurrency bug you will run into. A thread is useful because it shares memory with no friction; a thread is dangerous for the exact same reason. Every technique you'll see further along — mutexes, wait conditions, atomics, Qt's queued connections — is a way of disciplining that sharing, not eliminating it (eliminating it would mean going back to separate processes, losing the advantage that made us choose threads in the first place).

One last thing before moving on: you don't actually create the thread, the operating system does. When you write `std::thread t(function);`, under the hood a real system call fires off — `clone()` on Linux, `CreateThread()` on Windows — and what you get is an **operating system thread** (kernel thread). It's the kernel's scheduler that decides when that thread actually runs on the CPU. The C++ standard library doesn't reinvent its own scheduler: it relies directly on the operating system's, and `QThread`, which we'll see in the next article, does the same.

## The end of the frequency race, and why cores keep multiplying today

To understand why today you need to know how to write multithreaded code if you really want to exploit the hardware, we have to go back to 2004-2005, when a rule taken for granted for thirty years changed: every new generation of processors was simply faster in frequency, and your program, unchanged, ran faster without a single line being touched. Then that race stopped, for a purely physical reason. The dynamic power dissipated by a circuit follows, to a first approximation, this relation:

$$P \;\propto\; C \cdot V^2 \cdot f$$

where $C$ is the circuit's electrical capacitance, $V$ the supply voltage, and $f$ the clock frequency. The problem is that, to make transistors switch faster (higher $f$), you also need higher voltage $V$ so the signals settle in time — and since $V$ appears squared, the dissipated power (which turns almost entirely into heat) grows much more than linearly with frequency. Around 2005 manufacturers hit a real thermal wall: pushing frequency any higher would have meant dissipating more heat than any reasonable heatsink could carry away. This phenomenon went down in history as the **power wall**.

The industry's answer was to change strategy: instead of one ever-faster core, more cores, each at a moderate frequency. That's why today any CPU — from phone to server — has 4, 8, 16 or more physical cores. And this shift has an uncomfortable consequence for whoever writes software: **a single-threaded program gets no benefit at all from the other cores**. It runs on just one, exactly as it did twenty years ago, while the others sit unused as far as that program is concerned. If you actually want to exploit the multicore hardware you bought, you have to write software that can split its own work across multiple threads running in parallel.

## Concurrency and parallelism are not synonyms

And here's a distinction that everyday language tends to flatten, but that has very concrete consequences in practice. **Concurrency** means that several execution flows progress within the same interval of time, but not necessarily at the same physical instant: on a single core, two threads can be concurrent by alternating very rapidly — a bit of A, then a bit of B, then A again — giving the illusion of simultaneity, but at any single instant there is **only one** instruction executing on that core. **Parallelism**, instead, means that several flows run physically at the same instant, on distinct cores: it requires hardware with multiple real computing units, it cannot be obtained by software magic on a single core.

![Concurrency versus parallelism](modulo-00/02-concurrency-vs-parallelism.png)

In the upper half of the diagram, a single core executes Thread A and Thread B in alternating slices: pure concurrency, no real overlap in time. In the lower half, two distinct cores execute A and B for the whole duration, genuinely together: parallelism.

Why does this distinction really matter? Because **you can write concurrent code even on a machine with a single core**, and it makes sense to do so, for a reason that has nothing to do with raw computing speed: **responsiveness**. If your program has to respond to a click while waiting for a network reply that takes two seconds, you don't need more computing power: you need the thread handling the click not to stay blocked waiting for that reply. This is exactly the most common use case for which, in the next article, we'll introduce `QThread`: not (only) going faster, but staying responsive. Real parallelism — the kind that finishes a heavy computation in a quarter of the time by using four cores — is a different goal, tied to `QtConcurrent` and thread pools, and it needs real multicore hardware to show up at all.

## The scheduler, time slicing, and the hidden cost of a context switch

How does the operating system's scheduler create the illusion that dozens of threads run "at the same time" on a handful of physical cores? With **time slicing**: it assigns each ready thread a small slice of CPU time — a few milliseconds, the exact order of magnitude depends on the scheduler — at the end of which it forcibly interrupts it and puts another queued thread into execution. This forced interruption is called a **context switch**, and it is not free at all.

![The cost of a context switch](modulo-00/03-context-switch-cost.png)

When the scheduler switches from Thread A to Thread B, it must first **save** A's complete state — registers, program counter — somewhere in memory, then **load** B's previously saved state into those same physical registers, and only then can the CPU resume executing B's instructions from where it left them.

There's an additional cost, often more insidious: the **CPU cache**. While A was running, the cache had filled up with its "hot" data and instructions. When B takes over, working on different data, those cache lines get gradually replaced: when A resumes, a few time slices later, it will find the cache "cold" for its own data and will have to re-read it from RAM, which is much slower. This phenomenon is called **cache pollution** from context switching, and it's often the real reason why "too many threads" make performance worse instead of better: it's not the cost of saving a handful of registers, it's the cache being continuously emptied and refilled.

The practical consequence is that **creating a thread for every tiny piece of work is almost always a bad idea**. If the useful work a thread has to do lasts less than the time it takes to create it, start it, and have it contend for CPU through repeated context switches, you've spent more energy on administration than on actual computation. This principle — the granularity of a task must pay back the overhead of managing it in a separate thread — you'll meet again when we talk about thread pools further along in this path.

## Amdahl's law: the limit no core can beat

There's an obvious practical question left: if I parallelize a program well, how much do I speed it up by adding cores? The rigorous answer is **Amdahl's law**, formulated in 1967, and it's probably the single most important formula in all of concurrent programming, because it states something that at first sounds counter-intuitive: there is an insurmountable limit to the speedup obtainable, no matter how many cores you add, and that limit depends on a single characteristic of your program.

$$S(N) = \dfrac{1}{(1-P) + \dfrac{P}{N}}$$

Stop for a moment on what each symbol physically represents. $S(N)$ is the **speedup**: how many times faster the program runs using $N$ cores compared to just one — if $S(N) = 3$, the program takes a third of the original time. $N$ is the number of parallel cores used. $P$ is the fraction of the total execution time that is actually **parallelizable**, a number between 0 and 1. And $(1-P)$, the piece in the denominator that is not divided by $N$, is the **serial** part: work that, by its own logical nature, must be executed by a single thread at a time — initialization, sequentially reading a file, a final step that has to combine the partial results of all the other threads.

The conceptual point is what happens as $N$ tends to infinity: the term $P/N$ tends to zero, and what's left is

$$S(\infty) = \dfrac{1}{1-P}$$

The theoretical maximum speedup, with infinitely many cores available, is limited exclusively by the serial fraction of the program. If only 90% is parallelizable ($P = 0{,}9$, which already sounds very high), the maximum speedup you could *ever* get is $1 / (1 - 0{,}9) = 10\times$ — not a million times faster just because you have a million cores, but ten times, full stop. If only 50% is parallelizable, the ceiling is a mere $2\times$.

![Amdahl's law](modulo-00/05-amdahls-law.png)

A concrete example, tied to the world of computer vision: imagine a pipeline that captures a frame, applies a preprocessing filter that's parallelizable across different blocks of the image, and finally runs a sequential post-processing step that has to see the whole recomposed image before deciding whether the inspected part is compliant. If that final step takes 20% of the total time ($P = 0{,}8$ parallelizable), the theoretical speedup limit is $1/0{,}2 = 5\times$, no matter what board with however many cores you throw at it. Knowing this *before* buying more powerful hardware, or before inventing increasingly complex architectures to parallelize the last 5% of the program, saves months of work chasing a gain the math already says is nearly exhausted. That's why, in the real world, the first step before parallelizing anything is always to **measure where the time is actually being spent**, not to guess it: it's the hidden serial fraction, often in an unexpected place, that decides how much parallelization effort will really be worth it.

## What's left to understand

At this point you know what a thread is, why it exists, why it matters more than ever today, and how much you can realistically hope to gain by parallelizing. What's still missing is the most dangerous piece: what happens when two threads touch the same variable with no discipline at all, and why Qt, for its graphical interface, decided to forbid this problem entirely by enforcing a single thread. That's the topic of the next article — and from there we go straight into the two hands-on projects of this module, where the freeze of a Qt window stops being a sentence and becomes something you watch happen with your own eyes.
