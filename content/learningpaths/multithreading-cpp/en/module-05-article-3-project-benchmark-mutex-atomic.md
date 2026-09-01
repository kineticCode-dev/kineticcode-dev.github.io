---
title: "Project: benchmarking mutex vs atomic, false sharing, and verification with ThreadSanitizer"
description: "Multithreading in C++ with Qt — Module 5 — Project"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Project: benchmarking mutex vs atomic, false sharing, and verification with ThreadSanitizer

Unlike the guided projects of the previous modules, today **we are not building a Qt Widgets application**. That's a deliberate choice: the subject of this module — atomics, the memory model, caches — lives at the level of the CPU and the C++ standard library, underneath whatever framework you build on top of it. Building the project as a console program with plain `std::thread`, `std::atomic`, and `std::mutex` clears away any distraction tied to Qt and lets you look directly at the bare mechanism — exactly as in Project A of Module 0, where the choice to start from plain `std::thread` was driven by that same need for clarity.

**Requirements**: a C++20 compiler (verified with GCC 13.3.0), the pthread library linked at runtime (`-pthread` on Linux/macOS), CMake ≥ 3.16 (optional but convenient), no dependency on Qt. For the ThreadSanitizer section, a GCC or Clang compiler with `-fsanitize=thread` available.

An honest note about the environment in which this module was written and measured: the development machine used to compile and time the numbers you're about to read exposes **2 logical cores** (`std::thread::hardware_concurrency()` returns `2`) — probably fewer than the cores available on your actual working machine. That changes nothing about the substance of what you're about to observe, but you'll see the exact numbers swing more than you'd expect from a dedicated physical machine — a virtualized environment shares the underlying physical cores with other processes you don't control. This is itself a practical lesson in benchmarking: **always measure more than once**, and distrust a single isolated number just as you'd distrust a single statistical sample.

## Step 1 — The project skeleton

The project consists of two independent programs, each focused on a single demonstration, plus a shared `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.16)
project(project_g_benchmark LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()
set(CMAKE_CXX_FLAGS_RELEASE "-O2")

find_package(Threads REQUIRED)

# Project G.1 -- mutex vs atomic under contention
add_executable(counter_benchmark counter_benchmark.cpp)
target_link_libraries(counter_benchmark PRIVATE Threads::Threads)

# Project G.2 -- false sharing and the alignas(64) fix
add_executable(false_sharing false_sharing.cpp)
target_link_libraries(false_sharing PRIVATE Threads::Threads)

# --------------------------------------------------------------------------
# Optional target with ThreadSanitizer enabled (see this module's articles).
# Usage: cmake -S . -B build_tsan -DCMAKE_BUILD_TYPE=Debug -DENABLE_TSAN=ON
# --------------------------------------------------------------------------
option(ENABLE_TSAN "Build with -fsanitize=thread" OFF)
if(ENABLE_TSAN)
    add_compile_options(-fsanitize=thread -g -O1)
    add_link_options(-fsanitize=thread)
endif()
```

Notice the explicit `-O2` in `CMAKE_CXX_FLAGS_RELEASE`: for a performance benchmark, compiling without optimizations (`-O0`, the default if you specify nothing) would produce meaningless numbers — an unoptimized increment carries overhead that no real program, compiled for normal use, would ever carry. Measuring without optimizations turned on is a method error as common as it is insidious in this kind of comparison.

## Step 2 — The first benchmark: mutex against atomic under contention

Let's build `counter_benchmark.cpp` piece by piece, starting with the mutex-protected version — the one you already know from Module 2, here with `std::mutex` instead of `QMutex` since we're on pure C++ ground:

```cpp
#include <atomic>
#include <chrono>
#include <cstdio>
#include <mutex>
#include <thread>
#include <vector>

static long long mutexCounter = 0;
static std::mutex counterMutex;

void incrementWithMutex(int incrementsPerThread) {
    for (int i = 0; i < incrementsPerThread; ++i) {
        std::lock_guard<std::mutex> lock(counterMutex);
        ++mutexCounter;
    }
}
```

Nothing new here compared to what you already know: `std::lock_guard` is the standard equivalent of `QMutexLocker`, identical RAII, the same guarantee of automatic unlocking. Now the atomic version, written right alongside it deliberately, for comparison:

```cpp
static std::atomic<long long> atomicCounter{0};

void incrementWithAtomic(int incrementsPerThread) {
    for (int i = 0; i < incrementsPerThread; ++i) {
        atomicCounter.fetch_add(1, std::memory_order_seq_cst);
    }
}
```

I'm deliberately using explicit `memory_order_seq_cst` (even though it's the default, and I could omit it) to make it immediately visible, when rereading the code, which ordering guarantee we're choosing — consistent with the previous article's recommendation not to leave the choice implicit in code that others (including you, six months from now) will have to reread.

The benchmark's engine is a small template that takes the function to time:

```cpp
template <typename Function>
double runBenchmark(Function work, int numThreads, int incrementsPerThread) {
    std::vector<std::thread> threads;
    threads.reserve(numThreads);

    auto start = std::chrono::steady_clock::now();
    for (int t = 0; t < numThreads; ++t) {
        threads.emplace_back(work, incrementsPerThread);
    }
    for (auto &th : threads) {
        th.join();
    }
    auto end = std::chrono::steady_clock::now();

    return std::chrono::duration<double, std::milli>(end - start).count();
}
```

Notice `std::chrono::steady_clock`, not `system_clock`: for measuring an elapsed time interval, `steady_clock` is the correct choice because it's guaranteed monotonic (it never runs backward, unlike the system clock, which can be corrected by an NTP service right while you're measuring) — a small detail, but one that, if gotten wrong, can produce absurd negative-number benchmarks in rare unlucky cases.

Finally the `main()`, which sizes the number of threads to the real machine and verifies the correctness of the result, not just the timing:

```cpp
int main() {
    unsigned int hw = std::thread::hardware_concurrency();
    int numThreads = (hw >= 2) ? static_cast<int>(hw) : 4;
    const int incrementsPerThread = 5'000'000;
    const long long expected =
        static_cast<long long>(numThreads) * incrementsPerThread;

    double msMutex = runBenchmark(incrementWithMutex, numThreads,
                                   incrementsPerThread);
    bool okMutex = (mutexCounter == expected);
    std::printf("[mutex]  time: %8.2f ms   final counter: %lld   %s\n",
                msMutex, mutexCounter, okMutex ? "(correct)" : "(WRONG!)");

    double msAtomic = runBenchmark(incrementWithAtomic, numThreads,
                                    incrementsPerThread);
    bool okAtomic = (atomicCounter.load() == expected);
    std::printf("[atomic] time: %8.2f ms   final counter: %lld   %s\n",
                msAtomic, atomicCounter.load(),
                okAtomic ? "(correct)" : "(WRONG!)");

    if (msAtomic > 0.0) {
        std::printf("\nmutex/atomic ratio: %.2fx\n", msMutex / msAtomic);
    }
    return 0;
}
```

Checking `counter == expected` isn't a decorative detail: it's the counter-proof that both versions are truly correct (no lost updates), which is what makes the time comparison meaningful — there'd be no point bragging about the speed of a version that's secretly also losing increments along the way.

## Step 3 — Compile and run the first benchmark

```bash
g++ -std=c++20 -O2 -pthread counter_benchmark.cpp -o counter_benchmark
./counter_benchmark
```

Here's the actual output, measured in this course (a machine with 2 logical cores, 5,000,000 increments per thread, so 10,000,000 total):

```
=== Project G.1 - Benchmark mutex vs atomic ===
hardware_concurrency() detected: 2 -> using 2 threads
Increments per thread: 5000000 (expected total: 10000000)

[mutex]  time:   194.64 ms   final counter: 10000000   (correct)
[atomic] time:    66.01 ms   final counter: 10000000   (correct)

mutex/atomic ratio: 2.95x
```

Running it two more times, so as not to trust a single sample:

```
[run 2] mutex: 198.76 ms   atomic: 66.57 ms   ratio: 2.99x
[run 3] mutex: 208.17 ms   atomic: 68.35 ms   ratio: 3.05x
```

The pattern is stable: the atomic version runs **roughly 3 times faster** than the mutex version, on this machine, for this workload (a single increment per operation — the most favorable case possible for an atomic, and it's no accident the project isolates it this way). The explanation is exactly the one from the previous article: every `lock_guard` that enters a critical section contended by another thread risks requiring the operating system scheduler to step in, while `fetch_add` remains a single machine instruction, blocked by the memory bus for a handful of clock cycles — no scheduler involved, no thread put to sleep. Both versions, notice, turn out correct: the atomic's advantage here is purely one of performance, not correctness.

## Step 4 — The second file: false sharing, first without care

Let's move on to `false_sharing.cpp`. First the "naive" layout, two counters sitting adjacent in the same struct:

```cpp
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>

constexpr int ITERATIONS = 200'000'000;
constexpr std::size_t CACHE_LINE_SIZE = 64;

struct AdjacentCounters {
    std::atomic<int> a{0};
    std::atomic<int> b{0};
};
```

`sizeof(AdjacentCounters)` is 8 bytes — two 4-byte `int`s sitting right next to each other, comfortably inside a single 64-byte cache line, exactly the pathological scenario described in the previous article.

## Step 5 — The correct layout, with alignas(64)

```cpp
struct alignas(CACHE_LINE_SIZE) PaddedCounter {
    std::atomic<int> value{0};
    char padding[CACHE_LINE_SIZE - sizeof(std::atomic<int>)];
};

struct PaddedCounters {
    PaddedCounter a;
    PaddedCounter b;
};
```

`sizeof(PaddedCounter)` grows to 64 bytes — an entire cache line for a single useful `int`, the explicit waste already discussed — and `sizeof(PaddedCounters)` accordingly becomes 128 bytes: two separate cache lines, guaranteed to be so by the alignment imposed by `alignas`.

## Step 6 — The test: two threads, two independent counters, both layouts

```cpp
template <typename Layout>
double runTest(Layout &data) {
    auto start = std::chrono::steady_clock::now();

    std::thread t1([&] {
        for (int i = 0; i < ITERATIONS; ++i) {
            if constexpr (std::is_same_v<Layout, AdjacentCounters>) {
                data.a.fetch_add(1, std::memory_order_relaxed);
            } else {
                data.a.value.fetch_add(1, std::memory_order_relaxed);
            }
        }
    });
    std::thread t2([&] {
        for (int i = 0; i < ITERATIONS; ++i) {
            if constexpr (std::is_same_v<Layout, AdjacentCounters>) {
                data.b.fetch_add(1, std::memory_order_relaxed);
            } else {
                data.b.value.fetch_add(1, std::memory_order_relaxed);
            }
        }
    });

    t1.join();
    t2.join();

    auto end = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::milli>(end - start).count();
}
```

Here I'm deliberately using `memory_order_relaxed`, unlike the first benchmark: each thread only updates its own counter, it never needs to observe or synchronize with the other, so there's no happens-before relationship to establish here — it's exactly the honest use case for `relaxed` described in the previous article, not an arbitrary shortcut. `if constexpr` (C++17) selects at compile time which field to touch depending on the `Layout` type, so the same template handles both experiments without duplicating the loop logic.

## Step 7 — Compile, run, and watch the cache lie to you

```bash
g++ -std=c++20 -O2 -pthread false_sharing.cpp -o false_sharing
./false_sharing
```

First actual measured output:

```
=== Project G.2 - False sharing and the alignas(64) fix ===
Iterations per thread: 200000000
sizeof(AdjacentCounters) = 8 bytes
sizeof(PaddedCounter)    = 64 bytes
sizeof(PaddedCounters)   = 128 bytes

[adjacent, same cache line]       time:  5703.52 ms
[alignas(64), separate lines]     time:  1302.42 ms

Speedup from eliminating false sharing: 4.38x
```

Running it again, for the reason already discussed in the Setup:

```
[run 2] adjacent: 3667.79 ms   padded: 2648.09 ms   speedup: 1.39x
[run 3] adjacent: 4523.37 ms   padded: 1306.76 ms   speedup: 3.46x
```

Here the variability between runs is more pronounced than what we saw in Step 3 — again, the virtualized 2-core machine, shared with other workloads, leaves its mark. But notice what **never** changes, in any of the three runs: the direction of the effect. The padded layout is always faster than the adjacent one, never the other way around, with a gain ranging from +39% to more than 4 times depending on the background noise of that particular run. This is exactly the kind of honest reading a good benchmark requires: the exact number swings with the environment, but the physical phenomenon you're observing — cross-invalidation of the shared cache line — is real and repeatable, not an isolated statistical artifact.

## Step 8 — ThreadSanitizer: verify that neither version is hiding a race

Because "it worked in my tests" is never enough, in concurrency: a data race can stay invisible for months of testing on one machine and show up on the very first day on different hardware, with a different number of cores, or simply with the system under heavier load than usual. **ThreadSanitizer** (TSan) is a dynamic analysis tool built into GCC and Clang: it instruments every memory access during the program's actual execution, keeping track of which thread read or wrote each location and with what synchronization. If it detects two threads accessing the same location, with at least one write, without a synchronization relationship recognized by the C++ standard between the two accesses, it reports it immediately, with the stack trace of both.

Let's compile both programs with instrumentation turned on:

```bash
g++ -std=c++20 -O1 -g -fsanitize=thread -pthread \
    counter_benchmark.cpp -o counter_benchmark_tsan
g++ -std=c++20 -O1 -g -fsanitize=thread -pthread \
    false_sharing.cpp -o false_sharing_tsan
./counter_benchmark_tsan
./false_sharing_tsan
```

Notice `-O1` instead of `-O2`: this is a practical recommendation when using TSan — with more aggressive optimizations, some instruction reorderings can make the sanitizer's stack traces less readable, with no real benefit (at this program size, TSan's own slowdown dominates the total time anyway).

Actual result, measured in this course — **no data race warning, on either program**:

```
=== Project G.1 - Benchmark mutex vs atomic ===
[mutex]  time:  2716.48 ms   final counter: 10000000   (correct)
[atomic] time:  1131.94 ms   final counter: 10000000   (correct)
mutex/atomic ratio: 2.40x
```

```
=== Project G.2 - False sharing and the alignas(64) fix ===
[adjacent, same cache line]       time:  9321.87 ms
[alignas(64), separate lines]     time:  4011.17 ms
Speedup from eliminating false sharing: 2.32x
```

Two observations are worth making. The first: the slowdown TSan imposes is enormous and clearly visible when comparing these times with those from Steps 3 and 7 (the mutex/atomic benchmark goes from ~200/~67 ms to ~2716/~1132 ms, a factor of roughly 14x to 17x) — and this is precisely why TSan is used during verification and never in a production binary. The second, more important one: **the absence of any race report is itself a result**, not a meaningless "nothing happened." It's the experimental counter-proof that both `std::mutex` and `std::atomic`, used the way you've seen them in this project, genuinely protect the shared state in every run the sanitizer observed.

For comparison, and to close the loop with Module 0: if in this same project the counter had been incremented without any synchronization at all — a direct `++counter`, as in Module 0's "dangerous" version — TSan would have flagged it immediately, with a report along the lines of `WARNING: ThreadSanitizer: data race`, complete with the exact line and the two conflicting threads. We didn't include that in this project precisely because both programs here are correct by construction — but keeping it in mind remains the practical reason to always compile, as a matter of practice, a TSan-enabled build for any new concurrent code you write, instead of waiting for a bug of this kind to surface on its own at some unpredictable moment.

## What you just proved to yourself

You measured — not hypothesized, actually measured with a real stopwatch — three facts that in most concurrency courses remain abstract claims: that an atomic can be noticeably faster than a mutex for a simple operation under contention; that two logically independent variables can dramatically slow each other down purely because of their physical position in memory, and that `alignas(64)` is a concrete, verifiable cure for it; and that ThreadSanitizer can confirm, with the same rigor with which a unit test confirms logical correctness, that your concurrent code is genuinely free of the races it could theoretically be hiding. These are three tools that stay in your toolbox well beyond this course — the first step, every time you optimize concurrent code, is always the same: measure before, measure after, and use a sanitizer to verify that the speed you gained didn't come at the price of correctness.

---

*The complete source code for this project is available in the repository accompanying this course, in the `project-G-benchmark-mutex-atomic` folder.*
