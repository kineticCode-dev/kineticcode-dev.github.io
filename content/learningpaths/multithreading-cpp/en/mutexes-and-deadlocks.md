---
title: "Mutexes, lock_guard, and deadlocks: how to avoid them"
description: "How to protect code sections more complex than a single counter with std::mutex and std::lock_guard, and the practical rules that keep you out of a deadlock."
---

`std::atomic` solves the problem for a single variable. But what happens when you need to update several variables together, keeping them consistent with each other? That's the case, for instance, of a shared data structure with multiple fields, or a queue whose element count and buffer must stay in sync.

## std::mutex: one door, one key

A `std::mutex` (mutual exclusion) is a lock: only one thread at a time can hold it. Any other thread that tries to lock it while it's already held simply waits until it's released.

```cpp
#include <mutex>

std::mutex mtx;
int balance = 0;
int operation_count = 0;

void deposit(int amount) {
    mtx.lock();
    balance += amount;
    operation_count++;
    mtx.unlock();
}
```

This code works, but it has a practical problem: if an exception is thrown between `lock()` and `unlock()`, or if someone adds an early `return` inside that block during a future change, `unlock()` never gets called — the mutex stays locked forever, and every other thread requesting it blocks in turn.

## std::lock_guard: RAII instead of discipline

The idiomatic C++ solution is to hand off releasing the lock to an object's destructor, using the RAII pattern (Resource Acquisition Is Initialization) already familiar from `unique_ptr` or `fstream`:

```cpp
void deposit(int amount) {
    std::lock_guard<std::mutex> lock(mtx); // lock acquired here
    balance += amount;
    operation_count++;
} // automatic unlock here, whatever the exit path
```

With `std::lock_guard`, the mutex is released automatically when the `lock` object goes out of scope — whether the function returns normally, returns early, or an exception is thrown. There's no way to forget the `unlock()`. In modern code, calling `mutex.lock()`/`unlock()` directly should be treated as a red flag.

## Deadlock: when two locks block each other

The classic deadlock happens when two threads each need **two mutexes**, but acquire them in opposite order:

```cpp
// Thread A:
std::lock_guard<std::mutex> l1(mutex_a);
std::lock_guard<std::mutex> l2(mutex_b); // waits for mutex_b

// Thread B (in parallel):
std::lock_guard<std::mutex> l1(mutex_b);
std::lock_guard<std::mutex> l2(mutex_a); // waits for mutex_a
```

Thread A holds `mutex_a` and waits for `mutex_b`. Thread B holds `mutex_b` and waits for `mutex_a`. Neither can proceed: they're stuck waiting on each other forever.

**The practical rule that avoids almost every deadlock**: if a piece of code needs to acquire several mutexes together, always acquire them in the same order, everywhere in the program. When that order can't easily be guaranteed, `std::lock` (the free function, not the method) lets you acquire multiple mutexes at once safely, avoiding the circular wait:

```cpp
std::lock(mutex_a, mutex_b);
std::lock_guard<std::mutex> l1(mutex_a, std::adopt_lock);
std::lock_guard<std::mutex> l2(mutex_b, std::adopt_lock);
```

With these three tools — `std::atomic` for the simple cases, `std::lock_guard` for larger critical sections, and discipline about acquisition order to avoid deadlocks — you have the foundation that covers the large majority of real cases you'll run into working on concurrent systems.
