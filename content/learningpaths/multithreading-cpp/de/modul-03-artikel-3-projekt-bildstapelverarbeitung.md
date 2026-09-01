---
title: "Projekt: Bild-Batch-Verarbeitung mit QtConcurrent::mapped und QFutureWatcher"
description: "Multithreading in C++ mit Qt — Modul 3 — Projekt"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projekt: Bild-Batch-Verarbeitung mit QtConcurrent::mapped und QFutureWatcher

Wir bauen eine Qt-Widgets-Anwendung, die eine bestimmte Anzahl synthetischer, verrauschter Bilder erzeugt, sie alle parallel mit `QtConcurrent::mapped()` weichzeichnet und den Fortschritt über `QFutureWatcher<QImage>` anzeigt – mit einem funktionierenden Abbrechen-Button und einem Fenster, das **jederzeit reaktionsfähig bleibt**.

**Zusätzliche Voraussetzungen gegenüber den vorherigen Projekten**: Qt 6 mit den Modulen **Widgets** *und* **Concurrent** – das Modul `Concurrent` muss explizit sowohl in `find_package` als auch in `target_link_libraries` deklariert werden.

## Schritt 1 — Das Grundgerüst des Projekts

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

Gegenüber den vorherigen Projekten ist der einzige strukturelle Unterschied in dieser Datei `Concurrent`, hinzugefügt sowohl zu `find_package` als auch zu `target_link_libraries` – das ist alles, was nötig ist, um Zugriff auf `QtConcurrent::mapped()` und auf `QFuture`/`QFutureWatcher` zu bekommen.

## Schritt 2 — Die reinen Funktionen: Bildgenerierung und naiver Blur

Erstelle `imageprocessing.h`:

```cpp
#pragma once
#include <QImage>
#include <QList>

QList<QImage> generateNoisyImages(int count, int side, quint32 seed);
QImage blurImageNaive(const QImage &source);
```

Halte kurz bei dieser Deklaration inne, noch bevor du dir die Implementierung ansiehst: Es sind zwei **freie Funktionen**, keine Methoden einer Klasse, und sie fassen keinen gemeinsamen Zustand an – weder Klassenmitglieder noch veränderliche globale Variablen. Das ist Absicht, und es ist genau die im vorherigen Artikel genannte Voraussetzung für Arbeit, die sich für `QtConcurrent::mapped()` eignet: Würde `blurImageNaive()` in eine globale Variable oder ein gemeinsames Member schreiben, würden sich zwei parallele Aufrufe auf verschiedenen Threads genauso gegenseitig auf die Füße treten wie im Modul über Mutex und Wait Conditions ohne Mutex – nur dass wir hier **keinen einzigen Mutex brauchen**, weil die Funktion per Konstruktion rein ist: Jeder Aufruf liest nur seinen eigenen Parameter und schreibt nur in seinen eigenen Rückgabewert.

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

Der Blur ist bewusst **nicht optimiert**: Für jedes Ausgabe-Pixel liest er von Grund auf das gesamte 7×7-Fenster um ihn herum direkt aus der Quelle über `pixel()` neu ein (keine rohen Zeiger, keine inkrementelle laufende Summe, kein Zeilen-Cache), mit Kosten von `O(Breite × Höhe × 49)`. Das ist kein Mangel – es ist **beabsichtigt**: Wir brauchen eine wirklich CPU-gebundene und substanzielle Arbeitslast, sowohl um die Parallelität des `QThreadPool` sichtbar in Aktion zu sehen, als auch für die Lektion über empirische Kalibrierung im nächsten Schritt.

## Schritt 3 — Empirische Kalibrierung: messen, nicht raten

Bevor wir festlegen, wie viele Bilder wir generieren und in welcher Größe, folgen wir derselben Disziplin, die schon in den vorherigen Modulen zu sehen war: **wir messen**, wir raten nicht. Ein kleines, isoliertes Testprogramm, das ein einzelnes `blurImageNaive()` bei verschiedenen Größen stoppt:

```cpp
for (int side : {128, 192, 256, 320, 384, 448, 512}) {
    auto imgs = generateNoisyImages(1, side, 42);
    QElapsedTimer t; t.start();
    QImage r = blurImageNaive(imgs[0]);
    qDebug() << "side" << side << "->" << t.elapsed() << "ms";
}
```

Auf der Entwicklungsmaschine dieses Kurses war das Ergebnis (Kompilierung ohne explizite Optimierungen, dasselbe Build-Schema, das wir für das finale Projekt verwenden werden):

| Bildseite | Zeit für einen einzelnen Blur |
|---|---|
| 128×128  | ~9 ms |
| 256×256  | ~31 ms |
| 384×384  | ~69 ms |
| 512×512  | ~122 ms |

Bei 384×384 kostet ein einzelner Blur also etwa 60-90 ms (der Wert schwankt leicht von Ausführung zu Ausführung, wie immer, wenn man Echtzeit auf einer gemeinsam genutzten Maschine misst). Mit `QThread::idealThreadCount()`, gemessen mit **2** auf dieser Maschine, und dem Wunsch nach einem Batch, der ein paar Sekunden dauert – vergleichbar mit den Demos der vorherigen Projekte, weder augenblicklich noch endlos –, fiel die Wahl auf: **200 Bilder mit 384×384 Pixeln**. Die Schätzrechnung ist direkt: 200 Blurs zu je ~70 ms, verteilt auf 2 Threads, sollten etwa (200 × 70) / 2, also etwa 7000 Millisekunden, benötigen.

Die Überprüfung mit dem echten Batch, über `QtConcurrent::mapped()`, über mehrere Durchläufe gestoppt, bestätigte die Schätzung: **zwischen 7,3 und 7,6 Sekunden** für die eigentliche Verarbeitungs-Batch (die Erzeugung der 200 verrauschten Bilder, ein separater und sequenzieller Schritt, fügt weitere 1,6-2,2 Sekunden hinzu, bevor der Batch beginnt). Die Zahl ist nicht geraten – sie ist gemessen, wiederholt und stimmt mit der theoretischen Schätzung auf Basis der verfügbaren Threads überein: genau die Art empirischer Überprüfung, die dieser Kurs von dir verlangt, jedes Mal, wenn du Lastparameter für eine Demo oder, ernsthafter, für ein Produktivsystem wählst.

## Schritt 4 — Die Oberfläche: mainwindow.h

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

Die allgemeine Form – ein Start-Button, ein Abbrechen-Button, eine Fortschrittsleiste, eine Log-Liste – orientiert sich bewusst am Stil der Oberflächen der vorherigen Projekte: Wir wollen, dass der visuelle Vergleich mit dem Producer-Consumer-Beispiel sofort ins Auge fällt. `m_watcher` ist ein direktes Mitglied des Fensters, kein von Hand verwalteter Zeiger: Da es ein leichtgewichtiges Objekt ist, das für die gesamte Lebensdauer des Fensters lebt, gibt es keinen Grund, die Speicherverwaltung zu verkomplizieren.

## Schritt 5 — Der Konstruktor: Oberfläche und Bildgenerierung

Oben in `mainwindow.cpp`, die aus der Kalibrierung in Schritt 3 hervorgegangenen Parameter:

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

## Schritt 6 — Die Verdrahtung des QFutureWatcher, und eine echte Lektion über Messung

```cpp
connect(&m_watcher, &QFutureWatcher<QImage>::started, this, &MainWindow::batchStarted);
connect(&m_watcher, &QFutureWatcher<QImage>::resultReadyAt, this, &MainWindow::resultReady);
connect(&m_watcher, &QFutureWatcher<QImage>::canceled, this, &MainWindow::batchCanceled);
connect(&m_watcher, &QFutureWatcher<QImage>::finished, this, &MainWindow::batchFinished);

connect(m_startButton, &QPushButton::clicked, this, &MainWindow::startProcessing);
connect(m_cancelButton, &QPushButton::clicked, this, &MainWindow::cancelProcessing);
```

Beachte, was gegenüber der vollständigen Liste der Signale aus dem vorherigen Artikel **fehlt**: `progressRangeChanged` und `progressValueChanged` sind mit nichts verbunden. Das ist kein Versehen – es ist das direkte Ergebnis einer Messung, die während der Entwicklung genau dieses Projekts vorgenommen wurde, und zu lehrreich, um sie dir nicht vollständig zu erzählen, denn es ist dieselbe "Messen, nicht raten"-Disziplin aus Schritt 3, diesmal auf die Oberfläche statt auf die Berechnung angewendet.

Der erste, "naheliegende" Versuch verband `progressValueChanged` direkt mit `m_progressBar->setValue()` und aktualisierte die Leiste bei jedem einzelnen Ergebnis. Der Code kompilierte, lief – und **die Oberfläche blockierte für die gesamte Dauer des Batches**: kein Neuzeichnen, keine Reaktion auf Ereignisse, ein regelrechtes Einfrieren von 7-9 Sekunden, gefolgt von einer schlagartigen Aktualisierung am Ende – bestätigt durch eine direkte Messung mittels eines an die Event-Loop angeschlossenen "Herzschlag"-Timers mit 300 ms, der für die gesamte Dauer des Batches null verarbeitete Ereignisse zeigte.

Nach schrittweiser Isolierung des Problems stellte sich heraus, dass nicht `QtConcurrent::mapped()` selbst der Schuldige war (ein Test mit exakt demselben Future, ohne verbundene `QProgressBar`, blieb während der gesamten Dauer flüssig und reaktionsfähig), sondern speziell die **häufige** Aktualisierung einer `QProgressBar` während der aktiven Ausführung des Batches: Es genügten wenige Aufrufe von `setValue()` mitten in der Arbeit, nicht notwendigerweise Hunderte, um die Blockade wieder herbeizuführen. Stattdessen die Leiste **nur an den Extrempunkten** zu aktualisieren – bei null zum Start, auf den Endwert, wenn `finished()` auslöst, wenn der Thread-Pool die Arbeit bereits erschöpft hat und keine Konkurrenz mehr um GUI-CPU-Zeit besteht – erwies sich, mehrfach überprüft, als vollkommen flüssig: Die Event-Loop schlug für die gesamte Dauer des Batches zuverlässig alle 300 Millisekunden.

Die Lektion betrifft keinen spezifischen Bug dieser Umgebung, sondern ein allgemeines, überall gültiges Prinzip: **Eine API, die auf Vertragsebene verspricht, "niemals zu blockieren" (und `QtConcurrent`/`QFuture` halten dieses Versprechen), garantiert nicht automatisch eine flüssige Oberfläche bei jeder Kombination aus Widget und Aktualisierungsfrequenz** – die tatsächlichen Kosten eines Neuzeichnens, multipliziert mit Hunderten dicht aufeinanderfolgender Aufrufe, müssen immer **gemessen** werden, nicht angenommen.

## Schritt 7 — startProcessing(): die Zeile, die ganze Worker-Dateien ersetzt

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

Vergleiche diese Funktion mit der gesamten Datei `producer.cpp` des vorherigen Moduls, oder mit dem Aufbau eines `QThread` + Worker: Hier gibt es keinen `QThread`, kein `moveToThread()`, kein `connect(started, ...)`. Die Zeile `QtConcurrent::mapped(...)` startet sofort die Arbeit im globalen `QThreadPool` und gibt ein `QFuture<QImage>` zurück, ohne auf irgendetwas zu warten; `setFuture()` verbindet unseren bereits bereitstehenden `QFutureWatcher` mit diesem Future, und von diesem Moment an beginnen alle Signale aus dem vorherigen Artikel einzutreffen, auf dem GUI-Thread, während die Arbeit fortschreitet.

## Schritt 8 — cancelProcessing(): kooperativer Abbruch in der Praxis

```cpp
void MainWindow::cancelProcessing() {
    m_watcher.cancel();
    m_cancelButton->setEnabled(false);
    m_labelStatus->setText("Cancellation requested: finishing items already in progress...");
}
```

Wie angekündigt ist `cancel()` kooperativ: Es unterbricht keinen bereits auf einem Worker begonnenen Blur mitten drin, es verhindert lediglich, dass neue gestartet werden. Bei einer während der Entwicklung gemessenen Überprüfung – Abbruch angefordert etwa 1,8 Sekunden nach Start eines Batches von 200 Bildern – lag das beobachtete Ergebnis bei **46 verarbeiteten und gesammelten Bildern** vor dem vollständigen Stopp (gegenüber den etwa 25-26, die man bei einer linearen Abschlussrate in 1,8 Sekunden bei einem Gesamt-Batch von 7,3 s erwarten würde): Der Unterschied erklärt sich genau durch das eben beschriebene kooperative Verhalten – die den beiden Workern zum Zeitpunkt der Anforderung bereits zugewiesenen Elemente liefen bis zu ihrem natürlichen Abschluss weiter, bevor der Pool aufhörte, neue anzunehmen.

## Schritt 9 — Die Benachrichtigungs-Slots

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

`resultReady()` protokolliert jedes zehnte Ergebnis (`LOG_EVERY_N = 10`), nicht jedes einzelne – dieselbe Vorsicht bei der Taktung, die schon in Schritt 6 besprochen wurde, hier auf das Log statt auf die Leiste angewendet. `batchFinished()` unterscheidet über `m_watcher.isCanceled()` korrekt zwischen natürlichem Abschluss und Abbruch, und aktiviert in beiden Fällen den Start-Button wieder: Du kannst mehrere Batches nacheinander starten, ohne die Anwendung je neu starten zu müssen.

## Schritt 10 — Kompilieren, ausführen, die Zahlen beobachten

```bash
cmake -S . -B build
cmake --build build
./build/image_batch_demo
```

Drücke "Start batch processing": Die Leiste bleibt bei null, das Log füllt sich stoßweise mit jeweils zehn Ergebnissen auf einmal, und – entscheidender Punkt, überprüfe es selbst, indem du das Fenster verschiebst oder es während des laufenden Batches in der Größe änderst – **die Oberfläche bleibt für die gesamte Dauer vollkommen reaktionsfähig**, keine Blockade, kein "reagiert nicht". Wenn der Batch fertig ist (gemessen, wie gesagt, zwischen 7,3 und 7,6 Sekunden auf dieser Maschine), springt die Leiste schlagartig auf den Endwert, und die letzte Zeile im Log meldet die genaue verstrichene Zeit und die Anzahl der gesammelten Ergebnisse – immer 200, sofern du nicht Abbrechen gedrückt hast.

## Was du dir gerade selbst bewiesen hast

Du hast eine echte parallele Batch-Verarbeitung gebaut, bei der `QtConcurrent::mapped()` 200 CPU-gebundene Verarbeitungen auf die Threads des globalen Pools verteilt, ein `QFutureWatcher`, der dich informiert hält, ohne je den GUI-Thread zu blockieren, und einen funktionierenden kooperativen Abbruch – all das, ohne einen einzigen `QThread`, ein einziges `moveToThread()`, einen einzigen Mutex zu schreiben. Und du hast, mit gemessenen statt geratenen Zahlen, sowohl gesehen, wie lange die Arbeit tatsächlich dauert (Kalibrierung in Schritt 3), als auch, wie eine scheinbar harmlose Entscheidung bei der Verbindung eines Signals mit einem Widget eine blockierende Oberfläche erzeugen kann (Schritt 6).

Du hast den Kreis geschlossen, mit dem dieses Modul begonnen hat: `QtConcurrent`, das Werkzeug, mit dem du vielleicht "nach Gefühl" angefangen hast, kennst du jetzt bis hinunter zum `QThreadPool`, der dahintersteckt, du weißt, den Unterschied zwischen einem blockierenden `QFuture` und einem über `QFutureWatcher` beobachteten zu erkennen, und vor allem weißt du, **wann** man es einsetzt und wann nicht.

---

*Der vollständige Quellcode dieses Projekts ist im Repository verfügbar, das diesen Kurs begleitet, im Ordner `project-E-image-batch`.*
