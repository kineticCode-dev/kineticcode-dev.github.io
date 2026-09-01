---
title: "Project: curing the freeze for real, by moving the computation to a worker thread"
description: "Multithreading in C++ with Qt — Module 1 — Project"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Project: curing the freeze for real, by moving the computation to a worker thread

Let's pick up exactly the freeze project from the previous module. Same window, same heartbeat, the very same prime-number computation — only *where* it runs changes. If you still have the working folder for that project open, you can start from there; otherwise create a new folder and follow the steps from scratch: either way it's just a few minutes of work.

## Step 1 — The project skeleton

`CMakeLists.txt`, identical in form to the previous project's (no surprise: we're not changing the build system, only the program's internal architecture):

```cmake
cmake_minimum_required(VERSION 3.16)
project(worker_thread_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets)

add_executable(worker_thread_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
    primecalculator.h
    primecalculator.cpp
)

target_link_libraries(worker_thread_demo PRIVATE Qt6::Widgets)
```

The only new thing is that the heavy computation now lives in its own separate file — `primecalculator.h`/`.cpp` — instead of inside `MainWindow`. This isn't a stylistic whim: it's the direct consequence of what we saw in the previous articles. The worker needs to be its own class, distinct from `MainWindow`, precisely because it is that class (and only that class) that we'll move to another thread.

## Step 2 — The worker: pure logic, with no notion of "thread" inside it

Create `primecalculator.h`:

```cpp
#pragma once
#include <QObject>

class PrimeCalculator : public QObject {
    Q_OBJECT

public:
    explicit PrimeCalculator(QObject *parent = nullptr);

    void setLimit(long long limit);

public slots:
    void start();

signals:
    void progress(int percentage);
    void finished(long long primesFound, qint64 msElapsed);

private:
    long long m_limit = 4'000'000;
};
```

Pause for a moment on `setLimit()`: it's **not** a slot, it's an ordinary public method. We saw the reason in the previous article: we'll call it from the GUI thread, but **before** starting the managed thread — at that precise moment there's no concurrency happening yet (the worker isn't running anything on any thread), so setting a member variable directly is entirely safe. If you called it *after* starting the thread, instead, you'd be writing `m_limit` from one thread while potentially `start()` is reading it from another — once again, exactly the data race you now recognize by heart.

Now `primecalculator.cpp` — the body of the computation is the very same algorithm as the previous project, with the addition of a periodic progress signal:

```cpp
#include "primecalculator.h"
#include <QElapsedTimer>

PrimeCalculator::PrimeCalculator(QObject *parent) : QObject(parent) {}

void PrimeCalculator::setLimit(long long limit) {
    m_limit = limit;
}

void PrimeCalculator::start() {
    QElapsedTimer stopwatch;
    stopwatch.start();

    long long count = 0;
    long long nextProgressThreshold = m_limit / 20; // one update every 5%

    for (long long n = 2; n < m_limit; ++n) {
        bool isPrime = true;
        for (long long d = 2; d * d <= n; ++d) {
            if (n % d == 0) { isPrime = false; break; }
        }
        if (isPrime) ++count;

        if (n >= nextProgressThreshold) {
            int percentage = static_cast<int>((n * 100) / m_limit);
            emit progress(percentage);
            nextProgressThreshold += m_limit / 20;
        }
    }

    emit finished(count, stopwatch.elapsed());
}
```

The `progress` signal is the first real demonstration of communication from the worker to the rest of the program **during** the computation, not just at the end — and it's a harmless `emit` to write here because, as you know from the previous article, Qt will deliver it, queued, to the right thread without you having to do anything more.

## Step 3 — The window's header: adding thread, worker, and the messenger signal

Create (or modify, if you're starting from the previous project) `mainwindow.h`:

```cpp
#pragma once

#include <QMainWindow>
#include <QLabel>
#include <QPushButton>
#include <QProgressBar>
#include <QTimer>
#include <QThread>
#include <QStatusBar>

#include "primecalculator.h"

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow() override;

signals:
    void requestComputation();

private slots:
    void onButtonClicked();
    void updateHeartbeat();
    void updateProgress(int percentage);
    void computationFinished(long long result, qint64 msElapsed);

private:
    QLabel *m_labelHeartbeat;
    QLabel *m_labelInstructions;
    QPushButton *m_startButton;
    QProgressBar *m_progressBar;
    QTimer *m_heartbeatTimer;
    int m_heartbeatCount = 0;

    QThread *m_thread;
    PrimeCalculator *m_worker;
};
```

The `requestComputation()` signal, declared here in `MainWindow`, is the "messenger" we talked about in the previous article: `MainWindow` will never directly call `m_worker->start()` (that would be an ordinary function call, executed on the calling thread — wrong, and dangerous on top of that if it touched the worker's data). Instead it will emit this signal, connected to the worker's slot: delivery, safely, is handled by Qt as always.

## Step 4 — The constructor: this is where all the wiring happens

In `mainwindow.cpp`, the body of the window (labels, button, progress bar, heartbeat) is identical in form to the previous project, with the addition of a `QProgressBar`. The new part, the one worth focusing on, is the wiring of the worker:

```cpp
    // --- Setting up the worker thread ------------------------------
    m_thread = new QThread(this);          // stays in the GUI thread: it's a QObject like any other
    m_worker = new PrimeCalculator();      // NO parent: otherwise moveToThread() fails
    m_worker->setLimit(4'000'000);         // safe: the thread hasn't started yet

    m_worker->moveToThread(m_thread);      // from here on, its slots run in the managed thread

    connect(this, &MainWindow::requestComputation, m_worker, &PrimeCalculator::start);
    connect(m_worker, &PrimeCalculator::progress, this, &MainWindow::updateProgress);
    connect(m_worker, &PrimeCalculator::finished, this, &MainWindow::computationFinished);

    connect(m_startButton, &QPushButton::clicked, this, &MainWindow::onButtonClicked);

    m_thread->start();   // started once, stays alive for the whole life of the window
```

Follow the order carefully, because it's not arbitrary: first you construct the worker **with no parent**, then you set its initial state (still safe, thread not started yet), **then** you move it with `moveToThread()`, **then** you wire up the signals (the connections work correctly regardless of when you make them, but wiring them up before starting the thread is good practice: you avoid the remote, but conceptually uncomfortable, possibility that the thread starts and finishes its work before you've even connected whoever is supposed to receive the result), and only at the end do you call `m_thread->start()`. From this moment on, the managed thread is alive, waiting — its event loop is spinning, but it does nothing until a signal arrives to process.

## Step 5 — The window's slots

```cpp
void MainWindow::onButtonClicked() {
    m_startButton->setEnabled(false);
    m_progressBar->setValue(0);
    statusBar()->showMessage("Computing in the background...");
    emit requestComputation();
}

void MainWindow::updateHeartbeat() {
    m_heartbeatCount++;
    m_labelHeartbeat->setText(QString("Heartbeat: %1").arg(m_heartbeatCount));
}

void MainWindow::updateProgress(int percentage) {
    m_progressBar->setValue(percentage);
}

void MainWindow::computationFinished(long long result, qint64 msElapsed) {
    m_progressBar->setValue(100);
    m_startButton->setEnabled(true);
    statusBar()->showMessage(
        QString("Done: %1 primes found in %2 ms. The heartbeat above never stopped.")
            .arg(result).arg(msElapsed));
}
```

Notice `onButtonClicked()`: it disables the button before emitting the request. This isn't decoration — it's the first line of defense against a real problem: without this line, a repeated click while the previous computation is still running would emit a second `requestComputation()`, which Qt would still queue up safely (no crash), but which would make `start()` run a second time in sequence on the same worker, stacking work on top of work instead of rejecting or replacing it. Handling "what happens if the user asks for new work while one is already in progress" with real cancellation is the subject of a later module; today we correctly limit ourselves to preventing the problem at the root, by disabling the button.

## Step 6 — The destructor: clean shutdown

```cpp
MainWindow::~MainWindow() {
    m_thread->quit();
    m_thread->wait();
    delete m_worker;
}
```

Three lines that are worth the entire lifecycle discussion from the previous article: you ask the managed thread's event loop to stop, you wait until it truly has, and only then do you destroy the worker with an ordinary `delete` — safe, because after `wait()` no other thread can touch it anymore.

## Step 7 — Build, run, and watch what no longer happens

```bash
cmake -S . -B build
cmake --build build
./build/worker_thread_demo
```

Press the button. Watch the progress bar advance in steps (the `progress` signals arriving from the worker) while, at the same time, the heartbeat at the top keeps climbing without the slightest hesitation — not an interruption, not a perceptible slowdown, nothing. Also try resizing or moving the window while the computation is running: it responds normally, something unthinkable in the previous project during the exact same computation.

If you want to see the contrast even more sharply, keep both projects open and run the search for the same number of primes in both, one after the other: the difference isn't in how long the computation takes — which is identical, because the CPU still has to do the same work — but in the window's *responsiveness* during that time. We haven't sped anything up here (still a single computation thread, exactly as before), we've only moved that computation out of the way of the event loop that has to take care of the window.

## What you just proved to yourself

You've built, with your own hands and understanding every line, the pattern that structurally solves the problem this course opened with. You've seen the practical difference between the `QThread` object and the thread it manages, you've moved a worker with `moveToThread()` and verified that its slots really do execute where you'd expect, you've communicated in both directions through signals without writing a single mutex, and you've handled a clean shutdown with no leaks. In the next module we introduce `QMutex` and its relatives — because the day your worker needs to share mutable data with other threads at the same time (not just exchange messages via signals, which today kept you safe from every critical section), you'll need those tools.

---

*The complete source code for this project is available in the repository that accompanies this course, in the `project-C-worker-thread` folder.*
