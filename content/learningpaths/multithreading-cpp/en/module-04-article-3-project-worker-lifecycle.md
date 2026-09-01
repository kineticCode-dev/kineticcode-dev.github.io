---
title: "Project: a worker's complete life cycle — start, pause, resume, stop"
description: "Multithreading in C++ with Qt — Module 4 — Project"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Project: a worker's complete life cycle — start, pause, resume, stop

Let's build a Qt Widgets application with a persistent worker — the same `moveToThread()` pattern you know from Module 1 — that runs a step-by-step computation (200 steps, each with a small CPU-bound calculation followed by a short, configurable pause), controllable with four commands from the window: **Start**, **Pause**, **Resume**, **Stop**. On top of that, two dedicated controls demonstrate `QMetaObject::invokeMethod` in its two main variants: one for changing the execution speed on the fly, one for synchronously querying the current step.

**Requirements**: Qt 6 with the **Widgets** component, no additional dependency beyond the previous modules.

## Step 1 — The project skeleton

```cmake
cmake_minimum_required(VERSION 3.16)
project(worker_lifecycle_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets)

add_executable(worker_lifecycle_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
    cyclicworker.h
    cyclicworker.cpp
)

target_link_libraries(worker_lifecycle_demo PRIVATE Qt6::Widgets)
```

No surprises here: it's the same shape as always. Today's substance is entirely in `CyclicWorker`'s internal architecture.

## Step 2 — The worker: the declaration, and a distinction that matters more than any other line in this project

```cpp
#pragma once

#include <QObject>
#include <QMutex>
#include <QWaitCondition>
#include <QString>
#include <atomic>

class CyclicWorker : public QObject {
    Q_OBJECT

public:
    explicit CyclicWorker(QObject *parent = nullptr);

    Q_INVOKABLE void setInterval(int milliseconds);
    Q_INVOKABLE int currentStep() const;

    int totalSteps() const { return TOTAL_STEPS; }

    // NOT slots, on purpose.
    void pause();
    void resume();
    void stop();

public slots:
    void start();

signals:
    void progress(int step, int totalSteps);
    void stateChanged(const QString &state);
    void finished();

private:
    static constexpr int TOTAL_STEPS = 200;

    mutable QMutex m_mutex;
    QWaitCondition m_pauseCondition;

    bool m_paused = false;
    int m_currentStep = 0;
    int m_intervalMs = 40;

    std::atomic<bool> m_stop{false};
};
```

Stop on the divide between `pause()`/`resume()`/`stop()`, declared as ordinary public methods, and `start()`, the only one declared `public slots`. It's not a stylistic whim: it's the most important lesson of this whole project, and to tell it properly I first need to show you the mistake I made while building it.

### The wrong version I wrote first (and the deadlock that followed)

My first draft connected pause, resume, and stop exactly as you'd expect from Modules 1 and 2 — three signals in the window, connected via `connect()` to three slots of the worker:

```cpp
//--- WRONG VERSION, do not use it ---
connect(this, &MainWindow::requestPause, m_worker, &CyclicWorker::pause);
connect(this, &MainWindow::requestResume, m_worker, &CyclicWorker::resume);
connect(this, &MainWindow::requestStop, m_worker, &CyclicWorker::stop);
```

It compiled without errors. It ran the Start → Pause → Resume sequence with no apparent problems. But the moment my automated test pressed "Pause" and then, with the worker still asleep, pressed "Stop", the entire application froze forever — no crash, no message, just stopped, exactly the silent symptom of a deadlock that Module 2 taught you to recognize.

The cause, once found, is glaring — and it's a direct corollary of the two previous articles of this module put together: while the worker is paused, its `start()` is blocked inside `m_pauseCondition.wait(&m_mutex)`. That call is **not** a turn of the event loop: it's an operating-system-level block, the thread is literally suspended there, it isn't running `exec()`, it isn't processing any event queue. A `requestStop()` signal connected with a `QueuedConnection` (automatic, because sender and receiver are on different threads) faithfully deposits its own event into the worker's queue — but nobody will ever come to read it, because the thread that should do so is stuck inside a `wait()` that nobody, in turn, wakes up. It's the exact same family of problem as the `deleteLater()` trap you saw in Module 1: an event deposited into a queue that nobody will ever process, because its owning thread isn't spinning.

### The fix: direct calls, as with the shared buffer of Module 2

The solution, in hindsight, was already written in Module 2, I just hadn't recognized it as applicable here too. Remember the shared buffer's production, consumption, and closing methods? They weren't slots: they were ordinary public methods, called **directly** from different threads, safe not because they went through the signal-and-slot meta-machinery, but because every line they touched was already protected by its own internal `QMutex`. The exact same logic applies to today's `pause()`, `resume()`, and `stop()`: they're safe to call directly from the GUI thread, on an object living on another thread, because the only thing they touch is protected by `m_mutex` or atomic (`m_stop`) — they don't need the worker's event loop to execute safely, and precisely because of that they **work even when that event loop isn't spinning**, such as during a pause.

`start()`, on the contrary, must stay a slot reached via `connect()` — because unlike pause/resume/stop, it **really has to** execute on the thread managed by the `QThread`, not on the caller's: it's the worker's entire body of work, not just a flag flip. A direct call to `m_worker->start()` from the GUI thread would run the whole 200-step cycle **on the GUI thread itself** — exactly the freeze that Module 1 taught you to cure from day one.

## Step 3 — The worker: start(), pause(), resume(), stop()

```cpp
#include "cyclicworker.h"

#include <QThread>
#include <QCoreApplication>
#include <algorithm>

CyclicWorker::CyclicWorker(QObject *parent) : QObject(parent) {}

void CyclicWorker::start() {
    emit stateChanged("Running");

    for (int step = 1; step <= TOTAL_STEPS; ++step) {
        if (m_stop.load()) break;

        {
            QMutexLocker locker(&m_mutex);
            while (m_paused && !m_stop.load()) {
                m_pauseCondition.wait(&m_mutex);
            }
        }
        if (m_stop.load()) break;

        volatile long long accumulator = 0;
        for (int i = 0; i < 200000; ++i) {
            accumulator += i % 7;
        }

        int waitMs;
        {
            QMutexLocker locker(&m_mutex);
            m_currentStep = step;
            waitMs = m_intervalMs;
        }

        emit progress(step, TOTAL_STEPS);
        QThread::msleep(static_cast<unsigned long>(waitMs));

        QCoreApplication::processEvents();
    }

    emit stateChanged(m_stop.load() ? "Stopped" : "Completed");
    emit finished();
}

void CyclicWorker::pause() {
    {
        QMutexLocker locker(&m_mutex);
        m_paused = true;
    }
    emit stateChanged("Paused");
}

void CyclicWorker::resume() {
    {
        QMutexLocker locker(&m_mutex);
        m_paused = false;
    }
    m_pauseCondition.wakeOne();
    emit stateChanged("Running");
}

void CyclicWorker::stop() {
    m_stop.store(true);

    // If the worker is asleep while paused, m_stop alone is not enough:
    // it must be woken up, otherwise it will never re-check the flag.
    // Same discipline as the shared buffer's close() in Module 2.
    {
        QMutexLocker locker(&m_mutex);
        m_paused = false;
    }
    m_pauseCondition.wakeAll();
}
```

The body of the loop should feel familiar by now: the stop-flag check at the top, the pause block with a `while` and `wait()`, a small CPU-bound calculation standing in for the "real work" of each step, and the progress emission. The last line, `QCoreApplication::processEvents()`, is explained right in the next step.

Look closely at `stop()`, because it's the direct application of Module 2's lesson to today's problem: writing `m_stop.store(true)` alone would solve the case where the worker is **active**, inside its own work loop — at the next flag check, it would exit cleanly. But if the worker is at that moment **asleep inside `wait()`** because it's paused, that write alone doesn't reach it: it would keep sleeping forever, because nobody woke it up to make it recheck anything, stop flag included. `stop()`, therefore, doesn't just write the flag: it also forces `m_paused` to `false` and calls `wakeAll()` — waking up whoever was waiting, who will then recheck the condition of their own `while`, see `m_stop` at `true`, and exit the wait loop cleanly before ever re-entering the body of work.

## Step 4 — setInterval() and currentStep(): the invokeMethod demo, and why processEvents() is needed

```cpp
void CyclicWorker::setInterval(int milliseconds) {
    QMutexLocker locker(&m_mutex);
    m_intervalMs = std::clamp(milliseconds, 0, 2000);
}

int CyclicWorker::currentStep() const {
    QMutexLocker locker(&m_mutex);
    return m_currentStep;
}
```

Nothing surprising in the implementation: two `Q_INVOKABLE` methods, protected by the same mutex as the rest of the state. The interesting part is in **how** the window will call them shortly — with `QMetaObject::invokeMethod`, not with a `connect()`. And that brings us back to that isolated line at the end of `start()`'s loop, `QCoreApplication::processEvents()`.

Both `Qt::QueuedConnection` and `Qt::BlockingQueuedConnection` for `invokeMethod` work by depositing an event in the receiving thread's queue, and that event is only executed when that thread's event loop gets around to processing it. But `start()` is **itself** a single, long slot that occupies the worker's thread from the beginning to the end of the loop — while it's running, that thread **is not executing `exec()`** in the sense you'd usually mean: it's executing the body of `start()`, which itself was invoked *by* an event processed by the event loop. Until `start()` returns, the worker's event loop doesn't go back to its own receiving cycle — which means any new event arriving in the meantime (an `invokeMethod` call to `setInterval()` or `currentStep()`, for instance) would sit in the queue, unprocessed, until the end of the 200 steps. For a `Qt::QueuedConnection` this would just be an annoying delay; for a `Qt::BlockingQueuedConnection` it would be **a GUI freeze for the entire duration of the cycle** — exactly the kind of freeze this whole course has taught you to avoid, but this time caused not by heavy computation directly on the GUI, but by a subtler detail about the worker's event loop.

`QCoreApplication::processEvents()`, called once per step, is the remedy: it manually "pumps" the current thread's event queue, giving a window of opportunity for any pending event — including `invokeMethod` calls to this very object — to be processed before moving on to the next step. It's a documented and legitimate technique for long slots that need to stay partially responsive, but it's worth being honest about its limits: **it doesn't help at all during a pause**. Inside `wait()`, the thread is blocked at the operating-system level, it isn't executing any Qt code — there's no point at which `processEvents()` could be called, because control isn't in your code's hands at that instant. And it's precisely for this reason — not for stylistic symmetry — that `pause()`, `resume()`, and `stop()` remain direct calls: they're the only mechanism that reaches the worker in **every** one of its states, pause included, while `invokeMethod` toward this worker only works because we deliberately opened a window for it inside the active loop.

## Step 5 — The window header

```cpp
#pragma once

#include <QMainWindow>
#include <QLabel>
#include <QPushButton>
#include <QProgressBar>
#include <QListWidget>
#include <QSpinBox>
#include <QThread>

#include "cyclicworker.h"

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow() override;

signals:
    void requestStart();

private slots:
    void onStartClicked();
    void onPauseClicked();
    void onResumeClicked();
    void onStopClicked();
    void onApplySpeedClicked();
    void onQueryProgressClicked();

    void updateProgress(int step, int totalSteps);
    void updateState(const QString &state);
    void onFinished();

private:
    void log(const QString &message);

    QLabel *m_stateLabel;
    QProgressBar *m_progressBar;
    QPushButton *m_startButton;
    QPushButton *m_pauseButton;
    QPushButton *m_resumeButton;
    QPushButton *m_stopButton;
    QSpinBox *m_speedSpinBox;
    QPushButton *m_applySpeedButton;
    QPushButton *m_queryButton;
    QLabel *m_queryResultLabel;
    QListWidget *m_log;

    QThread *m_thread;
    CyclicWorker *m_worker;
};
```

Notice that there's only one signal, `requestStart()` — consistent with everything you just saw in Step 2: it's the only command that genuinely needs to go through the event loop, because it's the only one that must execute code **on the worker's thread** rather than just modify its internal state.

## Step 6 — The constructor: setting up the worker, without starting it right away

```cpp
    m_thread = new QThread(this);
    m_worker = new CyclicWorker();   // NO parent: moveToThread() requires it
    m_worker->moveToThread(m_thread);

    connect(this, &MainWindow::requestStart, m_worker, &CyclicWorker::start);

    connect(m_worker, &CyclicWorker::progress, this, &MainWindow::updateProgress);
    connect(m_worker, &CyclicWorker::stateChanged, this, &MainWindow::updateState);
    connect(m_worker, &CyclicWorker::finished, this, &MainWindow::onFinished);

    connect(m_startButton, &QPushButton::clicked, this, &MainWindow::onStartClicked);
    connect(m_pauseButton, &QPushButton::clicked, this, &MainWindow::onPauseClicked);
    connect(m_resumeButton, &QPushButton::clicked, this, &MainWindow::onResumeClicked);
    connect(m_stopButton, &QPushButton::clicked, this, &MainWindow::onStopClicked);
    connect(m_applySpeedButton, &QPushButton::clicked, this, &MainWindow::onApplySpeedClicked);
    connect(m_queryButton, &QPushButton::clicked, this, &MainWindow::onQueryProgressClicked);

    m_thread->start();
```

Notice a deliberate difference from Modules 1 and 2: here we do **not** connect `QThread::started` directly to `start()`. The worker, once the thread is started, stays idle — its event loop is already running and ready to receive commands regardless (including direct calls to `pause()`/`resume()`/`stop()`, which as you know don't even need it) — until the user actually presses the "Start" button. That's the "Idle" state in the diagram below, the one before any work happens.

## Step 7 — The window's slots, including the two invokeMethod demonstrations

```cpp
void MainWindow::onStartClicked() {
    m_startButton->setEnabled(false);
    m_pauseButton->setEnabled(true);
    m_stopButton->setEnabled(true);
    m_progressBar->setValue(0);
    emit requestStart();
}

void MainWindow::onPauseClicked() {
    m_pauseButton->setEnabled(false);
    m_resumeButton->setEnabled(true);
    m_worker->pause();       // direct call
}

void MainWindow::onResumeClicked() {
    m_resumeButton->setEnabled(false);
    m_pauseButton->setEnabled(true);
    m_worker->resume();      // direct call
}

void MainWindow::onStopClicked() {
    m_pauseButton->setEnabled(false);
    m_resumeButton->setEnabled(false);
    m_stopButton->setEnabled(false);
    m_worker->stop();        // direct call, works even if the worker is paused
}
```

And finally the two demonstrations promised since the introduction of this module:

```cpp
void MainWindow::onApplySpeedClicked() {
    int value = m_speedSpinBox->value();
    QMetaObject::invokeMethod(m_worker, "setInterval", Qt::QueuedConnection,
                               Q_ARG(int, value));
}

void MainWindow::onQueryProgressClicked() {
    int value = -1;
    QMetaObject::invokeMethod(m_worker, "currentStep", Qt::BlockingQueuedConnection,
                               Q_RETURN_ARG(int, value));
    m_queryResultLabel->setText(
        QString("current step: %1 / %2").arg(value).arg(m_worker->totalSteps()));
}
```

The first is fire-and-forget: the GUI thread posts the command and moves on right away, without waiting for confirmation — perfect for a configuration change that doesn't need to be synchronous. The second, instead, uses `Qt::BlockingQueuedConnection` with `Q_RETURN_ARG`: the GUI thread really stops until `currentStep()` has executed on the worker's thread and returned a value — which we can then show right away in the label, with the certainty that it's the real value at that instant, not a stale one. Both work without any perceptible GUI freeze thanks to the `QCoreApplication::processEvents()` inserted in `start()`'s loop back in Step 4, which gives the worker, between one step and the next, the chance to process exactly these two commands.

## Step 8 — The destructor: the same discipline as Module 2, applied here

```cpp
MainWindow::~MainWindow() {
    m_worker->stop();   // direct call: reaches the worker even while paused

    m_thread->quit();
    m_thread->wait();

    delete m_worker;
}
```

Three lines, but each does a precise job, and it's the same order already seen in Module 2's guided project: first we make sure the worker can never stay asleep waiting forever (`stop()`, which as you know forces `m_paused` to `false` and calls `wakeAll()` before even finishing writing the stop flag), **then** we ask the thread to stop with `quit()`, **then** we wait with `wait()` for it to actually have done so. If you reversed the order — `quit()` before `stop()` — and the worker happened to be asleep, paused, at that moment, the thread would never get the chance to leave its own loop and reach the point where the `quit()` request is actually honored, and `wait()` would block the window's closing forever.

## Step 9 — Build, run, and observe the complete life cycle

```bash
cmake -S . -B build
cmake --build build
./build/worker_lifecycle_demo
```

Press "Start": the progress bar begins to advance, one step at a time, and the state label shows "Running". Press "Pause" halfway through: the advance stops immediately, the label switches to "Paused" — and if you watch the process's CPU usage while it's paused, you'll see it drop to almost zero, direct proof that the worker is sleeping inside `wait()` instead of rechecking the flag in an active loop that would burn an entire core for nothing. Press "Resume": the advance continues exactly from where it stopped. Try the two `invokeMethod` controls too: change the interval with the spin box and press "Apply" while the worker is running — you'll see the bar's advance speed change from the next step on, proof the command arrived; press "Query step" and watch the label update immediately with the exact step, read synchronously from the worker's thread. Finally press "Stop" — try it both while the worker is running and while it's paused, to see with your own eyes that in both cases the shutdown is clean and immediate, never a freeze. Close the window: the application terminates instantly, whatever state the worker was in at that moment.

![Worker lifecycle diagram: which command triggers each transition, and how it reaches the worker](modulo-04/20-worker-lifecycle-start-pause-stop.png)

The diagram summarizes the whole path you just built: every transition is triggered by a click on the GUI, but the mechanism by which it reaches the worker changes depending on what's needed — a queued signal for `start()` (which must execute on the right thread), direct calls for pause/resume/stop (which must work even when the worker's event loop isn't spinning).

## What you just proved to yourself

You built a worker with a complete, controllable life cycle — not just "starts and finishes on its own" like in the previous modules, but startable, pausable, resumable, and stoppable on request, in any combination, never with a freeze. You saw, with a real deadlock reproduced and fixed, why the choice between "queued connection" and "direct call" isn't a matter of style but depends on a precise fact: whether the receiving thread has its own event loop free to spin at that moment or not. You used `QMetaObject::invokeMethod` in both of its main variants, understanding why the blocking one could have frozen your GUI had you not understood — and fixed — the reason a single long slot can starve its own thread's event loop.

It's no accident that the deadlock told in this article was born precisely at the meeting point of two concepts that seemed already settled — Module 1's queued connection, Module 2's wait condition — applied together in a new context: it's almost always there, at the intersection of two tools you know well individually, that the most instructive bugs hide.

---

*The complete source code for this project is available in the repository that accompanies this course, in the `project-F-worker-lifecycle` folder.*
