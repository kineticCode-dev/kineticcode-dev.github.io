---
title: "Project: batch image processing with QtConcurrent::mapped and QFutureWatcher"
description: "Multithreading in C++ with Qt — Module 3 — Project"
---

All source code available [here](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Project: batch image processing with QtConcurrent::mapped and QFutureWatcher

Let's build a Qt Widgets application that generates a number of synthetic noisy images, blurs all of them in parallel with `QtConcurrent::mapped()`, and shows progress via `QFutureWatcher<QImage>` — with a working Cancel button, and a window that **stays responsive at all times**.

**Additional requirements compared to previous projects**: Qt 6 with the **Widgets** *and* **Concurrent** modules — the `Concurrent` module must be declared explicitly both in `find_package` and in `target_link_libraries`.

## Step 1 — The project skeleton

```cmake
cmake_minimum_required(VERSION 3.16)
project(image_batch_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Concurrent)

add_executable(image_batch_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
    imageprocessing.h
    imageprocessing.cpp
)

target_link_libraries(image_batch_demo PRIVATE Qt6::Widgets Qt6::Concurrent)
```

Compared to the previous projects, the only structural difference in this file is `Concurrent` added both to `find_package` and to `target_link_libraries` — that's all it takes to get access to `QtConcurrent::mapped()` and to `QFuture`/`QFutureWatcher`.

## Step 2 — The pure functions: image generation and naive blur

Create `imageprocessing.h`:

```cpp
#pragma once
#include <QImage>
#include <QList>

QList<QImage> generateNoisyImages(int count, int side, quint32 seed);
QImage blurImageNaive(const QImage &source);
```

Stop on this declaration before even looking at the implementation: these are two **free functions**, not class methods, and they don't touch any shared state — no class members, no mutable global variables. This is deliberate, and it's precisely the requirement seen in the previous article for work suited to `QtConcurrent::mapped()`: if `blurImageNaive()` wrote to a global variable or a shared member, two calls running in parallel on different threads would step on each other exactly like in the module on mutexes and wait conditions without a mutex — except here **we don't need any mutex at all**, because the function is pure by construction: every call only reads its own parameter and only writes to its own return value.

`imageprocessing.cpp`:

```cpp
#include "imageprocessing.h"
#include <QRandomGenerator>

namespace {
constexpr int BLUR_RADIUS = 3;   // window (2*BLUR_RADIUS+1) x (2*BLUR_RADIUS+1) = 7x7
}

QList<QImage> generateNoisyImages(int count, int side, quint32 seed) {
    QList<QImage> images;
    images.reserve(count);
    QRandomGenerator rng(seed);

    for (int i = 0; i < count; ++i) {
        QImage img(side, side, QImage::Format_RGB32);
        for (int y = 0; y < side; ++y) {
            for (int x = 0; x < side; ++x) {
                img.setPixel(x, y, qRgb(rng.bounded(256), rng.bounded(256), rng.bounded(256)));
            }
        }
        images.append(img);
    }
    return images;
}

QImage blurImageNaive(const QImage &source) {
    const int width = source.width();
    const int height = source.height();
    QImage result(width, height, source.format());

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            long sumR = 0, sumG = 0, sumB = 0;
            int samples = 0;

            for (int dy = -BLUR_RADIUS; dy <= BLUR_RADIUS; ++dy) {
                const int yy = y + dy;
                if (yy < 0 || yy >= height) continue;
                for (int dx = -BLUR_RADIUS; dx <= BLUR_RADIUS; ++dx) {
                    const int xx = x + dx;
                    if (xx < 0 || xx >= width) continue;
                    const QRgb pixel = source.pixel(xx, yy);
                    sumR += qRed(pixel); sumG += qGreen(pixel); sumB += qBlue(pixel);
                    ++samples;
                }
            }
            result.setPixel(x, y, qRgb(sumR / samples, sumG / samples, sumB / samples));
        }
    }
    return result;
}
```

The blur is deliberately **unoptimized**: for every output pixel it rereads the whole 7×7 window around it from scratch, straight from the source, via `pixel()` (no raw pointers, no incremental sliding sum, no row cache), with a cost of `O(width × height × 49)`. This isn't a flaw — it's **intentional**: we need a genuinely CPU-bound and substantial workload, both to see the `QThreadPool`'s parallelism at work in a visible way, and for the empirical calibration lesson in the next step.

## Step 3 — Empirical calibration: measure, don't guess

Before choosing how many images to generate and at what size, let's follow the same discipline already seen in the previous modules: **measure**, don't guess. A small, isolated test program that times a single `blurImageNaive()` call at different sizes:

```cpp
for (int side : {128, 192, 256, 320, 384, 448, 512}) {
    auto imgs = generateNoisyImages(1, side, 42);
    QElapsedTimer t; t.start();
    QImage r = blurImageNaive(imgs[0]);
    qDebug() << "side" << side << "->" << t.elapsed() << "ms";
}
```

On this course's development machine, the result (built without explicit optimizations, the same build scheme we'll use for the final project) was:

| Image side | Time for a single blur |
|---|---|
| 128×128  | ~9 ms |
| 256×256  | ~31 ms |
| 384×384  | ~69 ms |
| 512×512  | ~122 ms |

At 384×384, a single blur therefore costs roughly 60-90 ms (the value fluctuates slightly from run to run, as always when measuring real time on a shared machine). With `QThread::idealThreadCount()` measured at **2** on this machine, and wanting a batch that lasts a few seconds — comparable to the demos of previous projects, neither instant nor never-ending — the choice was: **200 images of 384×384 pixels**. The estimate is straightforward: 200 blurs at ~70 ms each, spread across 2 threads, should take roughly (200 × 70) / 2, i.e. roughly 7000 milliseconds.

Verification with the real batch, via `QtConcurrent::mapped()` timed over several runs, confirmed the estimate: **between 7.3 and 7.6 seconds** for the actual processing batch (generating the 200 noisy images, which is a separate, sequential step, adds another 1.6-2.2 seconds before the batch even starts). The number isn't guessed — it's measured, repeated, and consistent with the theoretical estimate based on the available threads: exactly the kind of empirical check this course asks you to do every time you choose load parameters for a demo or, more seriously, for a production system.

## Step 4 — The interface: mainwindow.h

```cpp
#pragma once
#include <QMainWindow>
#include <QProgressBar>
#include <QListWidget>
#include <QLabel>
#include <QPushButton>
#include <QFutureWatcher>
#include <QImage>
#include <QElapsedTimer>
#include "imageprocessing.h"

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

private slots:
    void startProcessing();
    void cancelProcessing();

    void batchStarted();
    void resultReady(int index);
    void batchCanceled();
    void batchFinished();

private:
    QList<QImage> m_sourceImages;

    QLabel *m_labelStatus;
    QProgressBar *m_progressBar;
    QListWidget *m_log;
    QPushButton *m_startButton;
    QPushButton *m_cancelButton;

    QFutureWatcher<QImage> m_watcher;
    QElapsedTimer m_stopwatch;
    int m_resultsArrived = 0;
};
```

The general shape — a Start button, a Cancel button, a progress bar, a log list — deliberately mirrors the style of the previous projects' interfaces: we want the visual comparison with the producer-consumer to be immediate. `m_watcher` is a direct member of the window, not a manually managed pointer: being a lightweight object that lives for the whole duration of the window, there's no reason to complicate memory management.

## Step 5 — The constructor: interface and image generation

At the top of `mainwindow.cpp`, the parameters that came out of the Step 3 calibration:

```cpp
namespace {
constexpr int IMAGE_COUNT = 200;
constexpr int IMAGE_SIDE = 384;
constexpr quint32 GENERATION_SEED = 42;
constexpr int LOG_EVERY_N = 10;   // see the cadence note at Step 6
}
```

```cpp
MainWindow::MainWindow(QWidget *parent) : QMainWindow(parent) {
    setWindowTitle("Project E - Image Batch with QtConcurrent::mapped");
    resize(560, 460);

    auto *centralWidget = new QWidget(this);
    auto *layout = new QVBoxLayout(centralWidget);

    m_labelStatus = new QLabel(centralWidget);
    m_progressBar = new QProgressBar(centralWidget);
    m_progressBar->setRange(0, IMAGE_COUNT);
    m_progressBar->setValue(0);

    auto *buttonLayout = new QHBoxLayout();
    m_startButton = new QPushButton("Start batch processing", centralWidget);
    m_cancelButton = new QPushButton("Cancel", centralWidget);
    m_cancelButton->setEnabled(false);
    buttonLayout->addWidget(m_startButton);
    buttonLayout->addWidget(m_cancelButton);

    m_log = new QListWidget(centralWidget);

    layout->addWidget(m_labelStatus);
    layout->addWidget(m_progressBar);
    layout->addLayout(buttonLayout);
    layout->addWidget(m_log);
    centralWidget->setLayout(layout);
    setCentralWidget(centralWidget);

    // Generating the synthetic images: fast (1.6-2.2s even at 200 images,
    // measured at Step 3) compared to the blur that follows. We do it here,
    // on the GUI thread, once at startup -- it's not the CPU-bound work
    // this project wants to demonstrate.
    m_sourceImages = generateNoisyImages(IMAGE_COUNT, IMAGE_SIDE, GENERATION_SEED);

    m_labelStatus->setText(QString("%1 images %2x%3 ready in memory. Press Start.")
                               .arg(IMAGE_COUNT).arg(IMAGE_SIDE).arg(IMAGE_SIDE));
    statusBar()->showMessage(QString("Ideal threads on this machine: %1")
                                  .arg(QThread::idealThreadCount()));

    // ... QFutureWatcher wiring: Step 6 ...
}
```

## Step 6 — Wiring the QFutureWatcher, and a real measurement lesson

```cpp
connect(&m_watcher, &QFutureWatcher<QImage>::started, this, &MainWindow::batchStarted);
connect(&m_watcher, &QFutureWatcher<QImage>::resultReadyAt, this, &MainWindow::resultReady);
connect(&m_watcher, &QFutureWatcher<QImage>::canceled, this, &MainWindow::batchCanceled);
connect(&m_watcher, &QFutureWatcher<QImage>::finished, this, &MainWindow::batchFinished);

connect(m_startButton, &QPushButton::clicked, this, &MainWindow::startProcessing);
connect(m_cancelButton, &QPushButton::clicked, this, &MainWindow::cancelProcessing);
```

Notice what's **missing** compared to the full list of signals from the previous article: `progressRangeChanged` and `progressValueChanged` aren't connected to anything. This isn't an oversight — it's the direct result of a measurement taken while developing this very project, and it's too instructive not to tell in full, because it's the same "measure, don't guess" discipline from Step 3, applied this time to the interface instead of to the computation.

The first attempt, the "obvious" one, connected `progressValueChanged` directly to `m_progressBar->setValue()`, updating the bar on every single result. The code compiled, ran, and **the interface froze for the whole duration of the batch**: no redraws, no response to events, a genuine 7-9 second freeze followed by a sudden update at the end — with direct measurement confirming it, via a 300ms "heartbeat" timer connected to the event loop, which showed zero event processing for the entire duration of the batch.

Isolating the problem piece by piece, it turned out the culprit wasn't `QtConcurrent::mapped()` itself (a test with the exact same future, without a `QProgressBar` connected, stayed smooth and responsive the whole time) but specifically the **frequent** updating of a `QProgressBar` during the batch's active execution: it took just a few calls to `setValue()` in the middle of the work, not necessarily hundreds, to reintroduce the freeze. Updating the bar **only at the endpoints** instead — to zero when it starts, to the final value when `finished()` fires, when the thread pool has already exhausted the work and there's no more competition for the GUI's CPU time — proved, verified multiple times, perfectly smooth: the event loop kept ticking reliably every 300 milliseconds for the whole duration of the batch.

The lesson isn't about a specific bug in this environment but a general principle, valid everywhere: **an API that promises "never to block" at the contract level (and `QtConcurrent`/`QFuture` do honor that) doesn't automatically guarantee a smooth interface for every combination of widget and update frequency** — the real cost of a redraw, multiplied by hundreds of closely spaced calls, always has to be **measured**, never assumed.

## Step 7 — startProcessing(): the line that replaces entire worker files

```cpp
void MainWindow::startProcessing() {
    m_log->clear();
    m_progressBar->setValue(0);
    m_resultsArrived = 0;
    m_startButton->setEnabled(false);
    m_cancelButton->setEnabled(true);
    m_stopwatch.start();

    QFuture<QImage> resultFuture = QtConcurrent::mapped(m_sourceImages, blurImageNaive);
    m_watcher.setFuture(resultFuture);
}
```

Compare this function to the entire `producer.cpp` file from the previous module, or to building a `QThread` + worker: here there's no `QThread`, no `moveToThread()`, no `connect(started, ...)`. The `QtConcurrent::mapped(...)` line immediately starts the work on the global `QThreadPool` and returns a `QFuture<QImage>` without waiting for anything; `setFuture()` connects our already-ready `QFutureWatcher` to that future, and from that moment on all the signals from the previous article start arriving, on the GUI thread, as the work proceeds.

## Step 8 — cancelProcessing(): cooperative cancellation in practice

```cpp
void MainWindow::cancelProcessing() {
    m_watcher.cancel();
    m_cancelButton->setEnabled(false);
    m_labelStatus->setText("Cancellation requested: finishing items already in progress...");
}
```

As anticipated, `cancel()` is cooperative: it doesn't interrupt a blur already underway on a worker, it simply prevents new ones from being started. In a measured check during development — cancellation requested about 1.8 seconds after starting a batch of 200 images — the observed result was **46 images processed and collected** before it fully stopped (against the roughly 25-26 you'd expect from a linear completion rate over 1.8 seconds out of a 7.3s total batch): the difference is explained exactly by the cooperative behavior just described — the items already assigned to the two workers at the moment of the request kept going until their natural completion, before the pool stopped picking up new ones.

## Step 9 — The notification slots

```cpp
void MainWindow::batchStarted() {
    m_labelStatus->setText("Batch started: processing on the global QThreadPool...");
}

void MainWindow::resultReady(int index) {
    ++m_resultsArrived;
    if (m_resultsArrived % LOG_EVERY_N == 0) {
        m_log->addItem(QString("Image %1 processed (%2/%3 results collected so far)")
                            .arg(index).arg(m_resultsArrived).arg(m_sourceImages.size()));
        m_log->scrollToBottom();
    }
}

void MainWindow::batchCanceled() {
    m_log->addItem("--- Batch canceled by user ---");
    m_log->scrollToBottom();
}

void MainWindow::batchFinished() {
    const qint64 msElapsed = m_stopwatch.elapsed();
    const bool canceled = m_watcher.isCanceled();
    const int resultsCollected = m_watcher.future().resultCount();

    // Only touch on the progress bar during the whole batch lifecycle (see
    // the Step 6 note): the pool has already exhausted the work here, so
    // there's no more contention with the workers for GUI CPU time.
    m_progressBar->setValue(resultsCollected);

    m_log->addItem(QString("--- Batch %1 in %2 ms (%3 results collected) ---")
                        .arg(canceled ? "terminated (canceled)" : "completed")
                        .arg(msElapsed).arg(resultsCollected));
    m_log->scrollToBottom();

    m_labelStatus->setText(canceled
                               ? QString("Canceled after %1 ms.").arg(msElapsed)
                               : QString("Completed in %1 ms.").arg(msElapsed));

    m_startButton->setEnabled(true);
    m_cancelButton->setEnabled(false);
}
```

`resultReady()` logs one result out of every ten (`LOG_EVERY_N = 10`), not every single one — the same cadence caution discussed at Step 6, applied here to the log instead of the bar. `batchFinished()` correctly distinguishes between natural completion and cancellation via `m_watcher.isCanceled()`, and in both cases re-enables the Start button: you can launch several batches in a row without ever restarting the application.

## Step 10 — Build, run, watch the numbers

```bash
cmake -S . -B build
cmake --build build
./build/image_batch_demo
```

Press "Start batch processing": the bar stays at zero, the log starts filling up in bursts of ten results at a time, and — the crucial point, check it yourself by moving or resizing the window while the batch runs — **the interface stays completely responsive** for the whole duration, no freeze, no "not responding". When the batch finishes (measured, as noted, between 7.3 and 7.6 seconds on this machine), the bar jumps straight to the final value and the last log line reports the exact elapsed time and the number of results collected — always 200, unless you pressed Cancel.

## What you just proved to yourself

You built a real parallel processing batch, with `QtConcurrent::mapped()` distributing 200 CPU-bound computations across the global pool's threads, a `QFutureWatcher` keeping you informed without ever blocking the GUI thread, and working cooperative cancellation — all of this without writing a single `QThread`, a single `moveToThread()`, a single mutex. And you saw, with measured numbers rather than guessed ones, both how long the work really takes (the Step 3 calibration) and how a seemingly innocent choice in connecting a signal to a widget can produce an interface that freezes (Step 6).

You've closed the loop this module opened with: `QtConcurrent`, the tool you may have started with "by feel", you now know all the way down to the `QThreadPool` behind it, you can tell the difference between a blocking `QFuture` and one observed through a `QFutureWatcher`, and above all you know **when** to use it and when not to.

---

*The full source code for this project is available in the repository that accompanies this course, in the `project-E-image-batch` folder.*
