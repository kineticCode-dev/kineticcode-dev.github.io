---
title: "Two demonstrations, not two stories: the race condition and the freeze built with your own hands"
description: "Multithreading in C++ with Qt — Module 0 — Project"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Two demonstrations, not two stories: the race condition and the freeze built with your own hands

The two previous articles built the vocabulary: thread, concurrency, race condition, data race, Qt's single-thread constraint. Now it's time for hands-on work. Let's build two small projects together: the first isolates the race condition in plain standard C++, without a single line of Qt; the second recreates live the UI freeze we already talked about, and cures it only halfway — the real cure comes in the next module, when we move the computation to a separate thread with `QThread`.

## Project A — The race condition, isolated and live

We want to see the pure phenomenon, with no framework on top. Create a working folder and, inside it, a `CMakeLists.txt` file:

```cmake
cmake_minimum_required(VERSION 3.16)
project(race_condition_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

add_executable(race_condition_demo main.cpp)
target_link_libraries(race_condition_demo PRIVATE Threads::Threads)
```

`find_package(Threads REQUIRED)` looks on the system for the native threading library (on Linux it's `pthread`; on Windows the runtime itself handles it), and `Threads::Threads` is the target we link into the executable: without this explicit link, some systems would throw linking errors the moment we used `std::thread`.

Create `main.cpp` and start with the includes and the constants:

```cpp
#include <iostream>
#include <thread>
#include <vector>
#include <mutex>

constexpr int THREAD_COUNT = 8;
constexpr int INCREMENTS_PER_THREAD = 1'000'000;
```

Eight threads, a million increments each: enough to make the race condition almost certain to observe (with small numbers, by pure statistical luck, you might never see it show up — and that's already a good lesson: "I didn't see it so it isn't there" is a dangerous line of reasoning in concurrency).

Now the dangerous version:

```cpp
long long unprotectedCounter = 0;

void incrementUnprotected() {
    for (int i = 0; i < INCREMENTS_PER_THREAD; ++i) {
        unprotectedCounter++;   // <-- race condition qui
    }
}
```

No tricks: it's the most obvious code possible, and that's exactly why the bug is so insidious. It doesn't jump out at you while writing it, it only jumps out at runtime, and only if you observe it the right way.

Right below it, the correct version:

```cpp
long long protectedCounter = 0;
std::mutex counterMutex;

void incrementWithMutex() {
    for (int i = 0; i < INCREMENTS_PER_THREAD; ++i) {
        std::lock_guard<std::mutex> lock(counterMutex);
        protectedCounter++;
    }
}
```

`std::lock_guard` is an **RAII** wrapper: it acquires the lock on the mutex in its constructor and releases it automatically in its destructor, that is, when `lock` goes out of scope at the end of each iteration. This guarantees the mutex gets released even if an exception is thrown in the middle — forgetting to do this with a manual `lock()`/`unlock()` is a classic way of introducing a deadlock into your own code.

In `main`, first launch the unprotected version:

```cpp
int main() {
    const long long expected = static_cast<long long>(THREAD_COUNT) * INCREMENTS_PER_THREAD;

    std::cout << "Expected final value in both cases: " << expected << "\n\n";

    {
        std::vector<std::thread> threads;
        for (int i = 0; i < THREAD_COUNT; ++i)
            threads.emplace_back(incrementUnprotected);
        for (auto& t : threads)
            t.join();

        std::cout << "[WITHOUT mutex]  final counter = " << unprotectedCounter << "\n";
    }
```

`t.join()` blocks the calling thread until thread `t` has finished completely. It's essential to call it on every thread you created before reading the final result: reading `unprotectedCounter` before all threads have finished would introduce yet another race condition, this time between the main thread reading and the others still writing.

Add the same block for the protected version, calling `incrementWithMutex` instead of `incrementUnprotected`, then close with `return 0;`.

Compile and run, first in Release:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/race_condition_demo
```

There's a real possibility that the "without mutex" counter turns out correct even in this run. That doesn't mean the code is safe: it means the compiler — being entitled to assume no data race ever occurs — has probably kept `unprotectedCounter` in a register for the entire duration of each thread's loop, masking the problem instead of solving it.

Now rebuild in Debug:

```bash
rm -rf build
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
./build/race_condition_demo
```

With optimizations turned off, every single increment really does go through a memory read and a memory write on each iteration, and it's much more likely that two threads interleave in the wrong way. On a two-core test machine, the "without mutex" counter ended up losing over five million increments out of eight million expected — a 60% error, not a negligible rounding difference. Try it several times: the exact number of lost increments will change every time, because it depends on how the scheduler interleaved the threads in that specific run. Non-deterministic, by definition — this is, once again, the central point of the previous article.

You've just demonstrated to yourself that an apparently atomic instruction (`counter++`) is not atomic at all at the machine-execution level, that the compiler can hide the problem instead of solving it if you don't synchronize explicitly, and that a simple `std::mutex` with `std::lock_guard` is enough to bring the result back to the expected mathematical exactness, every time, with no exceptions.

## Project B — The UI freeze, live

This is the project that's worth more than any paragraph of theory for understanding why this entire course exists. Let's build a small Qt Widgets window with a visual "heartbeat" — a number that goes up every tenth of a second, proof that the window is alive — and then deliberately block it, on command, by pressing a button.

Create a new working folder and a `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.16)
project(ui_freeze_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets)

add_executable(ui_freeze_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
)

target_link_libraries(ui_freeze_demo PRIVATE Qt6::Widgets)
```

`CMAKE_AUTOMOC ON` automatically invokes, behind the scenes, Qt's Meta-Object Compiler on every class that uses the `Q_OBJECT` macro — the moc generates additional code that makes the signal-and-slot mechanism possible. You will never need to invoke it by hand.

Create `mainwindow.h`:

```cpp
#pragma once

#include <QMainWindow>
#include <QLabel>
#include <QPushButton>
#include <QTimer>
#include <QElapsedTimer>
#include <QStatusBar>

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

private slots:
    void updateHeartbeat();
    void runHeavyComputation();

private:
    QLabel *m_labelHeartbeat;
    QLabel *m_labelInstructions;
    QPushButton *m_blockButton;
    QTimer *m_heartbeatTimer;
    int m_heartbeatCount = 0;

    long long countPrimes(long long limit);
};
```

The `Q_OBJECT` macro is what makes this class compatible with Qt's signal-and-slot system: any class that wants to use `connect()` must have it.

Create `mainwindow.cpp` and start with the constructor:

```cpp
#include "mainwindow.h"
#include <QWidget>
#include <QVBoxLayout>
#include <QFont>

MainWindow::MainWindow(QWidget *parent) : QMainWindow(parent) {
    setWindowTitle("Project B - UI Freeze Demonstration");
    resize(480, 220);

    auto *centralWidget = new QWidget(this);
    auto *layout = new QVBoxLayout(centralWidget);

    m_labelInstructions = new QLabel(
        "Watch the counter below: it updates every 100 ms.\n"
        "Then press the button and see what happens.", centralWidget);
    m_labelInstructions->setWordWrap(true);

    m_labelHeartbeat = new QLabel("Heartbeat: 0", centralWidget);
    QFont heartbeatFont = m_labelHeartbeat->font();
    heartbeatFont.setPointSize(18);
    heartbeatFont.setBold(true);
    m_labelHeartbeat->setFont(heartbeatFont);

    m_blockButton = new QPushButton("Run heavy computation (BLOCKING)", centralWidget);

    layout->addWidget(m_labelInstructions);
    layout->addWidget(m_labelHeartbeat);
    layout->addWidget(m_blockButton);
    centralWidget->setLayout(layout);
    setCentralWidget(centralWidget);
    statusBar()->showMessage("Ready.");

    m_heartbeatTimer = new QTimer(this);
    connect(m_heartbeatTimer, &QTimer::timeout, this, &MainWindow::updateHeartbeat);
    m_heartbeatTimer->start(100);

    connect(m_blockButton, &QPushButton::clicked,
            this, &MainWindow::runHeavyComputation);
}
```

Notice `new QWidget(this)`: passing `this` as the parent tells Qt "this object lives as long as the window lives, and when the window is destroyed, destroy it too" — it's Qt's parent-child memory management tree, which spares you almost all manual `delete` calls on widgets. `connect()` links a **signal** (`QTimer::timeout`, emitted every time the timer expires; `QPushButton::clicked`, emitted on click) to a **slot** (a member function that reacts to it) — this is the mechanism through which, in Qt, an event communicates with the code that must react to it, and it's what we'll build safe cross-thread communication on in later modules.

The harmless slot, the heartbeat:

```cpp
void MainWindow::updateHeartbeat() {
    m_heartbeatCount++;
    m_labelHeartbeat->setText(QString("Heartbeat: %1").arg(m_heartbeatCount));
}
```

Nothing special: every 100 ms the number goes up by one and the label updates. It's your visual sensor for checking whether the GUI thread is still breathing.

The heavy work, deliberately naive:

```cpp
long long MainWindow::countPrimes(long long limit) {
    long long count = 0;
    for (long long n = 2; n < limit; ++n) {
        bool isPrime = true;
        for (long long d = 2; d * d <= n; ++d) {
            if (n % d == 0) { isPrime = false; break; }
        }
        if (isPrime) ++count;
    }
    return count;
}
```

We don't care that it's efficient, we only care that it keeps the CPU busy for a few seconds in a reproducible way.

The slot that blocks everything:

```cpp
void MainWindow::runHeavyComputation() {
    statusBar()->showMessage("Computing... (the UI is blocked, on purpose)");

    QElapsedTimer stopwatch;
    stopwatch.start();

    long long result = countPrimes(30'000'000);

    qint64 elapsedMs = stopwatch.elapsed();
    statusBar()->showMessage(
        QString("Done: %1 primes found in %2 ms. The heartbeat above did not move.")
            .arg(result).arg(elapsedMs));
}
```

This slot is connected to a `QPushButton`'s `clicked()`, so it runs on the thread that owns that button — the main thread, the same one running the event loop and updating `m_labelHeartbeat`. Until `countPrimes` returns, that thread can do **nothing else**: not redraw the window, not process the heartbeat timer, not respond to the operating system. Increase or decrease `30'000'000` depending on how fast your machine is, until the computation lasts at least 3-4 seconds.

Finally, `main.cpp`:

```cpp
#include <QApplication>
#include "mainwindow.h"

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);

    MainWindow window;
    window.show();

    return app.exec();
}
```

`app.exec()` is, literally, the event loop we talked about in the previous article: from here on, until the application closes, it's this loop — not your code — that decides when each slot gets called.

Compile and run:

```bash
cmake -S . -B build
cmake --build build
./build/ui_freeze_demo
```

Leave the window open for a few seconds and watch the number climb steadily. Then press the "Run heavy computation" button: the number stops **exactly** at the instant of the click, the window probably grays out (especially if you try to drag or resize it while the computation is running — try it, it's instructive), and only when the computation finishes do you see the number start climbing again from where it stopped, all at once, as if the time that passed in between had never existed for the GUI thread.

Not an abstract concept: you've seen with your own eyes that "a single thread" is not a theoretical limitation of Qt, but an observable physical behavior of your program. In the next module we go back to this exact same `mainwindow.cpp` file and modify it to move `countPrimes` onto a separate `QThread`, using the worker-object pattern with `moveToThread()`: you'll see the heartbeat keep climbing, undisturbed, while the computation runs in the background — the cure for the illness you've just diagnosed with your own hands.

---

*The complete source code for both projects is available in the repository that accompanies this course, in the folders `project-A-race-condition` and `project-B-ui-freeze`.*
