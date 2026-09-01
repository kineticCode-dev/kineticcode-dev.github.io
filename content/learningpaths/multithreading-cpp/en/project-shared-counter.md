---
title: "Project: shared counter with a race condition (and the fix)"
description: "We reproduce, live, the race condition described in the previous lesson on a counter shared by several threads, measure it, and fix it with std::atomic."
---

In the previous lesson we saw why `counter++` is not atomic when several threads access it in parallel. Let's verify that with a small real program.

## The code that reproduces the bug

```cpp
#include <iostream>
#include <thread>
#include <vector>

long counter = 0;

void increment(int times) {
    for (int i = 0; i < times; ++i) {
        counter++; // race condition: no synchronization at all
    }
}

int main() {
    const int times_per_thread = 1'000'000;
    std::vector<std::thread> threads;

    for (int i = 0; i < 4; ++i) {
        threads.emplace_back(increment, times_per_thread);
    }
    for (auto& t : threads) {
        t.join();
    }

    std::cout << "Expected: " << 4 * times_per_thread << "\n";
    std::cout << "Got: " << counter << "\n";
}
```

Spawning four threads that each increment a shared counter a million times, we would expect a total of four million. Compiling and running this repeatedly (`g++ -O2 -pthread counter.cpp -o counter`), the printed value varies on every run and is almost always **lower** than four million — the textbook signature of a race condition: increments silently lost, no errors, no crash, just a wrong number.

## The simplest fix: std::atomic

The most direct fix for this specific case is to declare the counter as atomic:

```cpp
#include <atomic>

std::atomic<long> counter{0};

void increment(int times) {
    for (int i = 0; i < times; ++i) {
        counter++; // now an indivisible atomic operation
    }
}
```

`std::atomic<long>` guarantees the increment is executed as an indivisible whole at the hardware level (typically via a dedicated CPU instruction, such as `LOCK XADD` on x86). No other thread can sneak in halfway through the operation. Recompiling with this change, the result is always exactly four million, on every run.

## The limit of this approach

`std::atomic` works great for single simple variables (counters, boolean flags, pointers). It does not work when you need to protect an **entire sequence of related operations** — for example, updating two variables so they always stay consistent with each other. For that more general case you need a different tool: the mutex, the subject of the next lesson.
