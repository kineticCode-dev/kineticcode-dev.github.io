---
title: "Project: producer, consumer, and the buffer that keeps them in balance"
description: "Multithreading in C++ with Qt — Module 2 — Project"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Project: producer, consumer, and the buffer that keeps them in balance

Let's build a Qt Widgets application with three threads active at the same time: the GUI thread (which you know well by now), a **Producer** thread that generates a new value at random intervals and inserts it into the buffer, and a **Consumer** thread that pulls it out and simulates processing it.

![Producer-consumer with a bounded buffer](modulo-02/10-producer-consumer-buffer.png)

A progress bar shows the buffer's occupancy in real time, and a log list records every production and every consumption.

## Step 1 — The project skeleton

```cmake
cmake_minimum_required(VERSION 3.16)
project(producer_consumer_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets)

add_executable(producer_consumer_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
    sharedbuffer.h
    sharedbuffer.cpp
    producer.h
    producer.cpp
    consumer.h
    consumer.cpp
)

target_link_libraries(producer_consumer_demo PRIVATE Qt6::Widgets)
```

Five source files today, not three like in the previous projects: `SharedBuffer` is its own class, separate from both the Producer and the Consumer, because — unlike the project in the previous module, where all the state lived inside a single worker — today the shared state is precisely the object that *both* threads need to be able to reach.

## Step 2 — The shared buffer: the heart of the project

Create `sharedbuffer.h`:

```cpp
#pragma once
#include <QObject>
#include <QMutex>
#include <QWaitCondition>
#include <QQueue>

class SharedBuffer : public QObject {
    Q_OBJECT

public:
    explicit SharedBuffer(int capacity, QObject *parent = nullptr);

    bool produce(int value);
    bool consume(int &valueOut);
    void close();

signals:
    void occupancyChanged(int occupancy, int capacity);

private:
    QMutex m_mutex;
    QWaitCondition m_notFull;
    QWaitCondition m_notEmpty;
    QQueue<int> m_queue;
    int m_capacity;
    bool m_closed = false;
};
```

Stop for a moment on the declaration: `produce()` and `consume()` are **not slots**. They're ordinary public methods, meant to be called **directly** from the Producer's and Consumer's code — not through a signal. This is an important stylistic difference from the previous module, where *everything* went through signals and slots: there, it was needed because we were simply exchanging messages between threads. Here, instead, `SharedBuffer` is an object whose safety in the presence of multiple threads is guaranteed **internally**, by its own `QMutex` — it can be called directly from any thread, at any moment, exactly as you would with any thread-safe C++ class written without Qt. Signals remain the right tool for *notifying* the GUI (`occupancyChanged`), not for accessing the data itself.

Now `sharedbuffer.cpp`:

```cpp
#include "sharedbuffer.h"

SharedBuffer::SharedBuffer(int capacity, QObject *parent)
    : QObject(parent), m_capacity(capacity) {}

bool SharedBuffer::produce(int value) {
    QMutexLocker locker(&m_mutex);

    while (m_queue.size() >= m_capacity && !m_closed) {
        m_notFull.wait(&m_mutex);
    }

    if (m_closed) return false;

    m_queue.enqueue(value);
    emit occupancyChanged(m_queue.size(), m_capacity);

    m_notEmpty.wakeOne();
    return true;
}

bool SharedBuffer::consume(int &valueOut) {
    QMutexLocker locker(&m_mutex);

    while (m_queue.isEmpty() && !m_closed) {
        m_notEmpty.wait(&m_mutex);
    }

    if (m_queue.isEmpty()) return false;

    valueOut = m_queue.dequeue();
    emit occupancyChanged(m_queue.size(), m_capacity);

    m_notFull.wakeOne();
    return true;
}

void SharedBuffer::close() {
    QMutexLocker locker(&m_mutex);
    m_closed = true;
    m_notFull.wakeAll();
    m_notEmpty.wakeAll();
}
```

You'll recognize the pattern from the previous article: the `while`, not the `if`; the mutex always acquired before touching `m_queue` or `m_closed`; the targeted wake-up (`wakeOne`) on the normal paths, the full wake-up (`wakeAll`) only in `close()`, where we want **everyone** waiting, producer or consumer, to wake up and notice.

## Step 3 — The Producer

`producer.h`:

```cpp
#pragma once
#include <QObject>
#include "sharedbuffer.h"

class Producer : public QObject {
    Q_OBJECT

public:
    explicit Producer(SharedBuffer *buffer, QObject *parent = nullptr);

public slots:
    void start();

signals:
    void valueProduced(int value);

private:
    SharedBuffer *m_buffer;
};
```

`producer.cpp`:

```cpp
#include "producer.h"
#include <QThread>
#include <QRandomGenerator>

Producer::Producer(SharedBuffer *buffer, QObject *parent)
    : QObject(parent), m_buffer(buffer) {}

void Producer::start() {
    int nextValue = 1;

    while (true) {
        QThread::msleep(QRandomGenerator::global()->bounded(200, 800));

        if (!m_buffer->produce(nextValue)) break;

        emit valueProduced(nextValue);
        ++nextValue;
    }
}
```

Notice what's **missing** compared to the previous module's project: no dedicated stop flag. The loop lives as long as `produce()` returns `true`, and `produce()` returns `false` exactly when (and only when) `SharedBuffer::close()` has been called. The thread's termination condition is entirely delegated to the shared object — a design choice that keeps the lifecycle logic in a single place instead of scattered across several classes.

## Step 4 — The Consumer

`consumer.h` and `consumer.cpp` follow the same structure, mirrored:

```cpp
#pragma once
#include <QObject>
#include "sharedbuffer.h"

class Consumer : public QObject {
    Q_OBJECT

public:
    explicit Consumer(SharedBuffer *buffer, QObject *parent = nullptr);

public slots:
    void start();

signals:
    void valueConsumed(int value, int msProcessing);

private:
    SharedBuffer *m_buffer;
};
```

```cpp
#include "consumer.h"
#include <QThread>
#include <QRandomGenerator>
#include <QElapsedTimer>

Consumer::Consumer(SharedBuffer *buffer, QObject *parent)
    : QObject(parent), m_buffer(buffer) {}

void Consumer::start() {
    while (true) {
        int value;
        if (!m_buffer->consume(value)) break;

        QElapsedTimer stopwatch;
        stopwatch.start();
        int processingTime = QRandomGenerator::global()->bounded(300, 1100);
        QThread::msleep(processingTime);

        emit valueConsumed(value, static_cast<int>(stopwatch.elapsed()));
    }
}
```

The consumer is deliberately a bit slower and more irregular than the producer (300-1100ms intervals versus 200-800ms): that's what will let you actually see the buffer fill up visibly on the progress bar instead of staying empty all the time.

## Step 5 — The window: wiring the three threads together

`mainwindow.h`:

```cpp
#pragma once
#include <QMainWindow>
#include <QProgressBar>
#include <QListWidget>
#include <QLabel>
#include <QThread>
#include "sharedbuffer.h"
#include "producer.h"
#include "consumer.h"

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow() override;

private slots:
    void updateOccupancy(int occupancy, int capacity);
    void logProduced(int value);
    void logConsumed(int value, int msProcessing);

private:
    QProgressBar *m_occupancyBar;
    QListWidget *m_log;
    QLabel *m_labelOccupancy;

    SharedBuffer *m_buffer;
    QThread *m_producerThread;
    QThread *m_consumerThread;
    Producer *m_producer;
    Consumer *m_consumer;
};
```

In the constructor, after setting up the widgets (progress bar, log list — nothing new compared to the previous projects), the part that matters:

```cpp
    m_buffer = new SharedBuffer(BUFFER_CAPACITY, this);
    connect(m_buffer, &SharedBuffer::occupancyChanged, this, &MainWindow::updateOccupancy);

    m_producerThread = new QThread(this);
    m_producer = new Producer(m_buffer);
    m_producer->moveToThread(m_producerThread);
    connect(m_producerThread, &QThread::started, m_producer, &Producer::start);
    connect(m_producer, &Producer::valueProduced, this, &MainWindow::logProduced);

    m_consumerThread = new QThread(this);
    m_consumer = new Consumer(m_buffer);
    m_consumer->moveToThread(m_consumerThread);
    connect(m_consumerThread, &QThread::started, m_consumer, &Consumer::start);
    connect(m_consumer, &Consumer::valueConsumed, this, &MainWindow::logConsumed);

    m_producerThread->start();
    m_consumerThread->start();
```

Notice where `m_buffer` lives: it's constructed with `this` (the window) as its parent, so its thread affinity stays that of the GUI thread — and that's perfectly fine, because as you saw in Step 2 nobody calls its `produce()`/`consume()` methods through signals (where affinity would matter for deciding Direct or Queued): they're called directly, from different threads, relying on the internal `QMutex` for safety. The `occupancyChanged` signal, on the other hand, is emitted from inside `produce()`/`consume()` — so from the Producer's or Consumer's thread, whichever one just acted — toward a slot living on the GUI thread: here thread affinity **does matter**, and Qt automatically picks a queued connection, exactly as in the previous module, regardless of where the `SharedBuffer` object that emitted the signal nominally "lives."

## Step 6 — The window's slots

```cpp
void MainWindow::updateOccupancy(int occupancy, int capacity) {
    m_occupancyBar->setValue(occupancy);
    m_labelOccupancy->setText(QString("Buffer occupancy: %1 / %2").arg(occupancy).arg(capacity));
}

void MainWindow::logProduced(int value) {
    m_log->addItem(QString("Produced: value %1").arg(value));
    m_log->scrollToBottom();
}

void MainWindow::logConsumed(int value, int msProcessing) {
    m_log->addItem(QString("Consumed: value %1 (processed in %2 ms)").arg(value).arg(msProcessing));
    m_log->scrollToBottom();
}
```

Nothing new here — these are ordinary slots running on the GUI thread, populated safely thanks to the queued connections above.

## Step 7 — The destructor: the order that actually matters

```cpp
MainWindow::~MainWindow() {
    m_buffer->close();

    m_producerThread->quit();
    m_producerThread->wait();

    m_consumerThread->quit();
    m_consumerThread->wait();

    delete m_producer;
    delete m_consumer;
}
```

This is where the worker-thread lifecycle from the previous module and today's wait conditions meet, and it's worth explaining why the order of these lines isn't interchangeable. If, right now, the Producer is asleep inside `produce()` (buffer full, waiting on `notFull`), its `start()` **will never return on its own**: it's blocked there, not in its event loop. This means the Producer's thread is in no condition to process **any other event**, including a `quit()` request queued up beforehand. `close()` is what physically unblocks the situation: it wakes up whoever is waiting, their `start()` can finally evaluate `if (m_closed) return false;` and return, and **only then** does the thread go back to its own event loop, free to receive and execute `quit()`. If you swapped the order — `quit()` before `close()` — nothing catastrophic would happen (the quit request would simply sit harmlessly in the queue), but the actual unblocking work would still only be done by `close()`: it, not `quit()`, is the keystone of a clean shutdown whenever wait conditions are involved.

## Step 8 — Build, run, watch the warehouse breathe

```bash
cmake -S . -B build
cmake --build build
./build/producer_consumer_demo
```

Watch the progress bar: it jumps up when the Producer inserts a value, drops when the Consumer pulls one out. Since the Consumer is on average slower, over time you'll tend to see the buffer fill up toward its maximum capacity (5) more often than emptying out completely — it's exactly the behavior the theory from the previous articles predicts, now observable on screen. Also watch the log list: the values always appear in the same order they were produced, both in the "Produced" column and in the "Consumed" one — the buffer, being a queue (`QQueue`, first in first out), preserves order, a property that in your work with image pipelines is almost always the one you want (frame number 10 must be processed and emitted before frame number 11, not after).

Close the window and notice that the application terminates immediately, without hanging: it's direct proof that the `close()` + `quit()` + `wait()` sequence from Step 7 works as promised, even if, at that exact instant, one of the two threads was asleep waiting inside the buffer.

## What you've just proven to yourself

You've built, and verified with your own eyes, the most cited synchronization pattern in the history of concurrent systems — not as a textbook exercise, but with two real threads, a real mutex, two real wait conditions, and a shutdown that leaves nothing hanging. You've also seen an important design distinction from the previous module: not everything has to go through signals and slots — an object with its own internal synchronization can be called directly by multiple threads, and that's often the more natural choice when the shared state is the central point of the problem, not a detail to be hidden behind messages.

If today's producer-consumer got you curious, an excellent follow-up to try on your own is extending the project to **multiple producers or multiple consumers** on the same buffer: `SharedBuffer`'s code doesn't change by a single line (it's already correct for that case, `wakeOne()` and the `while` loop guarantee it), but watching how it behaves with three consumers instead of one is an exercise worth more than many pages of theory on starvation.

---

*The complete source code for this project is available in the repository that accompanies this course, in the `project-D-producer-consumer` folder.*
