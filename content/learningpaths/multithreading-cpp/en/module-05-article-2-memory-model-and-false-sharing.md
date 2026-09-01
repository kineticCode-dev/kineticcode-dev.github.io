---
title: "std::atomic, the C++ memory model, and the performance bug you can't see in the code"
description: "Multithreading in C++ with Qt — Module 5"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# std::atomic, the C++ memory model, and the performance bug you can't see in the code

This article tackles the physical core of the module: `std::atomic` and the **C++ memory model**. It's a topic that most online tutorials explain poorly, listing `memory_order_relaxed`, `acquire`, `release`, `seq_cst` as if they were arbitrary configuration options to pick by feel. Here we explain them starting from what *physically* happens inside a multi-core processor — per-core L1 cache, cache lines, the protocol that keeps them coherent — because that's the only way these concepts stop being rules to memorize and become obvious consequences of how the hardware you're running on is built.

From there we arrive at a direct consequence, and perhaps the most surprising lesson of the module: two `atomic` variables that are completely independent from a logical standpoint — no thread ever uses them together, no invariant ties them — can still slow each other down dramatically, simply because they sit close together in memory. This is **false sharing**.

## Two different questions that concurrent code always asks together

When two threads share a variable, there are actually two distinct problems, and confusing the two is the source of 80% of the misunderstandings about the memory model:

**Atomicity**: the operation (a write, an increment, a compare-and-swap) happens as a whole, with no other thread ever able to observe it "halfway done." `counter++` on a plain `int`, as you saw in Module 0, is *not* atomic: it's actually three separate steps (read, increment, write), and two threads can interleave in the middle of those three steps, losing an update.

**Ordering and visibility**: even if an operation is atomic, the question remains open of "*when*, exactly, does the effect of that write become visible to other threads, and relative to which other operations in the program is it guaranteed to happen before or after?". This is a completely different question from atomicity, and `std::atomic<T>` addresses both — but with separate control levers, and this is where `std::memory_order` comes in.

## Why the visibility problem exists physically: per-core L1 cache

![The C++ memory model: per-core L1 caches and the coherence problem](modulo-05/22-cpp-memory-model.png)

A modern multi-core processor doesn't read and write main memory (RAM) directly on every instruction: it would be too slow, by orders of magnitude, compared to the speed at which the CPU executes instructions. Each core has its own **L1 cache**, small (typically 32-64 KB) but extremely fast (a few clock cycles versus the hundreds needed to reach RAM), where it keeps local copies of the data it's using.

The problem is immediate and physical, not an implementation detail you can ignore: if Thread A, running on Core 1, writes `x = 1`, that write first updates Core 1's L1 cache — **not** the shared RAM, not right away, and not necessarily ever in an order you directly control by writing `x = 1` in C++. If, at the same instant, Thread B, on Core 2, reads `x` from its own L1 cache, it can perfectly well read `0` still — the old copy, because its cache has no automatic reason to know that Core 1 just changed its mind, until some explicit mechanism tells it so. This isn't a processor bug: it's the physical price, deliberately accepted by hardware designers, for having fast local caches instead of slow shared access to everything.

Modern processors solve this with a **cache coherence protocol** (the most common one is called MESI, from the initials of the four states a cache line can be in — Modified, Exclusive, Shared, Invalid) that keeps the various cores' caches aligned with each other *when it matters*. But "when it matters" is precisely what you, as the programmer, have to specify — and you specify it by choosing the `memory_order` of your atomic operations. Without that explicit specification, the compiler and the CPU are both free to reorder reads and writes in ways that, on single-threaded code, would never change the observable result (it's the same freedom you saw in Module 0 being used by the compiler to keep an unprotected variable in a register, masking the race) — but that on multi-threaded code can produce results that your source-code order of writes didn't anticipate at all.

## What std::atomic guarantees about atomicity: how it works at the hardware level

On an x86-64 CPU — the most common processor family on desktops and servers, almost certainly the one you'll compile and run the guided project on — an operation like `fetch_add` on a `std::atomic<int>` typically compiles down to a single machine instruction with the `LOCK` prefix (for example `LOCK XADD`), which tells the memory bus and the cache-coherence protocol: "this read-modify-write operation must happen as a single indivisible block, no other core can step in the middle." On different architectures (ARM, very common in embedded systems) the mechanism takes a different shape — typically a pair of load-linked/store-conditional (LL/SC) instructions that detects whether someone else has touched the same location in the meantime and, if so, retries — but the final guarantee that the C++ standard offers you is identical: `fetch_add`, `compare_exchange`, and the other read-modify-write operations of `std::atomic` are indivisible, whatever hardware is underneath.

## memory_order_relaxed: only atomicity, zero ordering guarantees

```cpp
atomicCounter.fetch_add(1, std::memory_order_relaxed);
```

`relaxed` gives you the first guarantee (the operation is indivisible — no update is ever lost) and **gives you nothing else**. It promises nothing about when that increment will become visible to other threads, nor about how it relates in time to other reads or writes, atomic or not, that the same thread performed before or after. It's the right choice when the only thing you care about is a correct numeric count — a statistics counter, an event counter — and no other part of the program needs to infer anything from the *moment* that increment happened relative to anything else.

## acquire/release: the "happens-before" bridge between two threads

```cpp
// Thread A: prepares the data, then publishes it
data.x = 42;
data.y = "result";
// "release": publish everything that precedes
readyFlag.store(true, std::memory_order_release);

// Thread B: waits, then consumes
// "acquire": makes everything before the release visible
while (!readyFlag.load(std::memory_order_acquire)) { }
// guaranteed to see the values written above, not stale ones
readData(data.x, data.y);
```

The mechanism is what the literature calls a **happens-before** relationship: a `store` with `memory_order_release` acts as a barrier that says "all memory writes made by this thread *before* this instruction must be visible to anyone, on another thread, who observes *this very value* via a `load` with `memory_order_acquire`." It's literally the padlock analogy the name suggests: `release` is like closing a padlock and leaving it where someone else can find it, `acquire` is like picking it up and opening it — and the moment you open it, everything that was "inside the room" before the first thread closed it is guaranteed visible to you.

## memory_order_seq_cst: the default choice, and why it is one

`seq_cst` (sequentially consistent) gives all the guarantees of `acquire`/`release` **plus** one additional, stronger one: all `seq_cst` operations from all threads in the program appear to happen in a single total order, the very same order seen by every thread that observes them. It's the reasoning model closest to "the program executes instructions one at a time, alternating between threads in some order" — the naive intuition you probably had in mind from the start, made here into a real guarantee. The price is an extra bit of hardware synchronization, almost always small on modern x86-64 CPUs, but not zero.

The practical recommendation: **use `seq_cst` (the default) unless you have a measured, specific reason to drop to a weaker ordering**. `relaxed` and `acquire`/`release` are real tools, used in game-engine code, in databases, in operating systems — but they require formal, disciplined reasoning about every single use. `seq_cst` isn't "the lazy version": it's the version where your mental reasoning actually matches a guarantee of the language.

## The apparent paradox of false sharing

Here's a fact that, the first time you see it measured, seems to break your intuition: two `std::atomic<int>` variables, used by two different threads, with neither ever touching the other's variable, can slow each other down drastically. No race condition, no correctness violation, no wrong `memory_order`: the program computes the right result in both cases. The problem is purely one of performance, and it's entirely down to the physics we just covered, applied to a detail that seems irrelevant: exactly where in memory the two variables live relative to each other.

Caches don't move data one byte at a time, nor one variable at a time. They move in fixed-size blocks called **cache lines**, typically 64 bytes on modern x86-64 CPUs — a physical property of the hardware, not a compiler choice. When a core reads even a single byte from an address, the hardware loads into cache the entire 64-byte line that contains it — and the cache-coherence protocol also operates at the level of a whole line, not a single variable.

Two 4-byte `std::atomic<int>` values, declared one after the other in a struct, occupy a tiny fraction of a 64-byte line, so the compiler, with no instruction to the contrary, places them close together in memory — and it's entirely plausible that they end up in the same cache line. Now Thread A executes `a.fetch_add(1)`: to execute it, its core needs exclusive access to the cache line containing `a`, per the MESI protocol. And that line also contains `b`. The result: A's write to its own variable silently invalidates the copy of the line that B's core was holding in cache — even though B never read or wrote `a`. This is **phantom contention**, generated not by any real access to the same data, but by the accidental physical sharing of the cache line that holds them both.

## The cure: alignas(64)

```cpp
struct alignas(64) PaddedCounter {
    std::atomic<int> value{0};
    // fills the rest of the line, deliberately unused
    char padding[64 - sizeof(std::atomic<int>)];
};
```

`alignas(64)` tells the compiler: "every instance of this struct must start at a memory address that's a multiple of 64" — that is, at the start of a cache line. The `padding` field, an array of bytes that will never be read or written by anyone, exists for the sole purpose of occupying the rest of the line's space, preventing the compiler from placing something else right next to it.

![False sharing: two independent atomics sharing one 64-byte cache line, and the alignas(64) fix](modulo-05/23-false-sharing-cache-line.png)

This is an explicit trade-off and should be recognized as such: you're *wasting* memory (60 unused bytes for every 4-byte `int` you want to protect) to *gain* speed by avoiding cross-invalidation. For two counters this cost is negligible; if you were padding thousands of small structs in a huge array, that trade-off would deserve more careful weighing.

## Lock-free vs mutex: when it pays off, when it doesn't

With cache physics behind you, you're now equipped to answer a question Module 2 left open: if `std::atomic` can be faster than a mutex for a simple operation — and the guided project in the next article will prove it with real numbers — why not *always* replace mutexes with atomics?

A `std::atomic<T>` guarantees you the atomicity of a single operation on a single variable. The moment your problem requires updating **multiple related variables as if they were one indivisible operation** — the classic invariant from Module 2, where, for instance, inserting into a queue means both adding the element and updating the element count — a single atomic is no longer enough. You could build a lock-free algorithm that handles that case, typically based on `compare_exchange` in retry loops with non-trivial techniques to avoid the *ABA problem* — but this is code that's notoriously hard to write correctly, hard to review, and hard to test, because the bugs it introduces are often extremely rare and dependent on exact timing between cores. For the vast majority of real application code, a `QMutex` protecting the entire multi-variable invariant remains the more correct, more readable, and easier-to-maintain choice.

This is an all-too-common simplification, and it needs to be corrected explicitly: a lock-free algorithm isn't automatically faster than a mutex-based one. Under low contention, a modern mutex on Linux (futex-based, which in the common case avoids a system call entirely) and an atomic behave very similarly in terms of cost. Under high contention, a single atomic operation tends to remain cheaper than a full lock/unlock, because it avoids involving the scheduler when the thread loses the "race": it simply retries, instead of being put to sleep and woken up later. But if the protected operation is complex, an equivalent lock-free algorithm quickly becomes more expensive to design, more expensive to run, and far riskier to certify correct than a well-placed mutex.

![Mutex vs lock-free atomics: two tools with different cost and risk profiles, not a ranking](modulo-05/24-lockfree-vs-mutex-tradeoff.png)

The practical rule worth taking away: always start from `QMutex` (or `std::mutex`) as the default for any complex or multi-variable shared state. Consider `std::atomic` only for a specific, narrow case — a counter, a boolean flag, a shared pointer in a well-known pattern — and only after **measuring** that this section is really a bottleneck under real contention, not by intuition.

With the memory model, false sharing, and the lock-free/mutex comparison now clear, the next article puts it all to the test with a guided project: two real benchmarks that measure these effects with an actual stopwatch, and ThreadSanitizer to verify that neither version is hiding a race.
