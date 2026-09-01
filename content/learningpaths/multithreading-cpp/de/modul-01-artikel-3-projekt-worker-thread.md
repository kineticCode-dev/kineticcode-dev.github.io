---
title: "Projekt: den Freeze wirklich heilen, indem man die Berechnung auf einen Worker-Thread verlagert"
description: "Multithreading in C++ mit Qt — Modul 1 — Projekt"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projekt: den Freeze wirklich heilen, indem man die Berechnung auf einen Worker-Thread verlagert

Wir greifen genau das Freeze-Projekt aus dem vorherigen Modul wieder auf. Dasselbe Fenster, derselbe Herzschlag, dieselbe identische Primzahlberechnung — es ändert sich nur *wo* sie läuft. Wenn du den Arbeitsordner jenes Projekts noch offen hast, kannst du von dort ausgehen; andernfalls erstelle einen neuen Ordner und folge den Schritten von Grund auf: Es sind ohnehin nur wenige Minuten Arbeit.

## Schritt 1 — Das Grundgerüst des Projekts

`CMakeLists.txt`, in der Form identisch mit dem des vorherigen Projekts (keine Überraschung: Wir ändern nicht das Build-System, sondern nur die interne Architektur des Programms):

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

Die einzige Neuerung ist, dass die schwere Berechnung jetzt in ihrer eigenen separaten Datei lebt — `primecalculator.h`/`.cpp` — statt innerhalb von `MainWindow`. Das ist keine stilistische Laune: Es ist die direkte Konsequenz dessen, was wir in den vorherigen Artikeln gesehen haben. Der Worker muss eine eigenständige Klasse sein, getrennt von `MainWindow`, genau weil sie es ist (und nur sie), die wir auf einen anderen Thread verschieben werden.

## Schritt 2 — Der Worker: reine Logik, keine Vorstellung von "Thread" in sich selbst

Erstelle `primecalculator.h`:

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

Halte kurz bei `setLimit()` inne: Es ist **kein** Slot, es ist eine gewöhnliche öffentliche Methode. Den Grund haben wir im vorherigen Artikel gesehen: Wir werden sie vom GUI-Thread aus aufrufen, aber **bevor** wir den verwalteten Thread starten — in genau diesem Moment findet noch keine Nebenläufigkeit statt (der Worker führt auf keinem Thread irgendetwas aus), also ist es völlig sicher, direkt eine Member-Variable zu setzen. Würdest du sie hingegen *nach* dem Start des Threads aufrufen, würdest du `m_limit` von einem Thread aus schreiben, während möglicherweise `start()` sie von einem anderen liest — wieder genau die Data Race, die du inzwischen auswendig erkennst.

Nun `primecalculator.cpp` — der Kern der Berechnung ist exakt derselbe Algorithmus wie im vorherigen Projekt, mit dem Zusatz eines periodischen Fortschrittssignals:

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

Das Signal `progress` ist der erste echte Beweis für Kommunikation vom Worker zum Rest des Programms **während** der Berechnung, nicht nur am Ende — und es ist ein harmloses `emit`, das man hier hinschreiben kann, weil Qt es, wie du aus dem vorherigen Artikel weißt, ohne dein weiteres Zutun in der Warteschlange des richtigen Threads zustellen wird.

## Schritt 3 — Der Header des Fensters: Thread, Worker und das Botschafter-Signal hinzufügen

Erstelle (oder ändere, falls du vom vorherigen Projekt ausgehst) `mainwindow.h`:

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

Das Signal `requestComputation()`, hier in `MainWindow` deklariert, ist der "Botschafter", von dem im vorherigen Artikel die Rede war: `MainWindow` wird niemals direkt `m_worker->start()` aufrufen (das wäre ein gewöhnlicher Funktionsaufruf, ausgeführt auf dem aufrufenden Thread — falsch, und noch dazu gefährlich, wenn er Daten des Workers berühren würde). Stattdessen wird es dieses Signal emittieren, verbunden mit dem Slot des Workers: Die sichere Zustellung übernimmt, wie immer, Qt.

## Schritt 4 — Der Konstruktor: hier geschieht die gesamte Verdrahtung

In `mainwindow.cpp` ist der Aufbau des Fensters (Labels, Button, Fortschrittsbalken, Herzschlag) in der Form identisch mit dem vorherigen Projekt, mit dem Zusatz einer `QProgressBar`. Der neue Teil, auf den es sich zu konzentrieren lohnt, ist die Verdrahtung des Workers:

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

Verfolge die Reihenfolge aufmerksam, denn sie ist nicht zufällig: Zuerst konstruierst du den Worker **ohne Elternobjekt**, dann setzt du seinen Anfangszustand (immer noch sicher, der Thread ist noch nicht gestartet), **dann** verschiebst du ihn mit `moveToThread()`, **dann** verbindest du die Signale (die Verbindungen funktionieren korrekt, unabhängig davon, wann du sie herstellst, aber sie vor dem Start des Threads zu verbinden ist eine gute Angewohnheit: Du vermeidest die zwar entfernte, aber konzeptionell unangenehme Möglichkeit, dass der Thread startet und seine Arbeit beendet, noch bevor du denjenigen verbunden hast, der das Ergebnis empfangen soll), und erst am Ende rufst du `m_thread->start()` auf. Von diesem Moment an ist der verwaltete Thread am Leben, wartend — seine Event-Loop läuft, tut aber nichts, bis ein Signal zur Verarbeitung eintrifft.

## Schritt 5 — Die Slots des Fensters

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

Beachte `onButtonClicked()`: Es deaktiviert den Button, bevor es die Anfrage emittiert. Das ist keine Verzierung — es ist die erste Verteidigung gegen ein reales Problem: Ohne diese Zeile würde ein wiederholter Klick, während die vorherige Berechnung noch läuft, ein zweites `requestComputation()` emittieren, das Qt zwar trotzdem sicher in die Warteschlange stellen würde (kein Absturz), das aber `start()` ein zweites Mal nacheinander auf demselben Worker ausführen lassen würde, wobei sich Arbeit zu Arbeit addiert, statt sie abzulehnen oder zu ersetzen. Zu behandeln, "was passiert, wenn der Benutzer eine neue Arbeit anfordert, während eine läuft" mit einer echten Cancellation, ist Stoff eines späteren Moduls; heute beschränken wir uns, korrekterweise, darauf, das Problem an der Wurzel zu verhindern, indem wir den Button deaktivieren.

## Schritt 6 — Der Destruktor: das saubere Herunterfahren

```cpp
MainWindow::~MainWindow() {
    m_thread->quit();
    m_thread->wait();
    delete m_worker;
}
```

Drei Zeilen, die den gesamten Diskurs über den Lebenszyklus aus dem vorherigen Artikel wert sind: Du bittest die Event-Loop des verwalteten Threads, sich zu beenden, wartest, bis das wirklich geschehen ist, und zerstörst erst dann den Worker mit einem gewöhnlichen `delete` — sicher, weil nach `wait()` kein anderer Thread ihn mehr berühren kann.

## Schritt 7 — Kompilieren, ausführen, und beobachten, was NICHT mehr passiert

```bash
cmake -S . -B build
cmake --build build
./build/worker_thread_demo
```

Drücke den Button. Beobachte, wie der Fortschrittsbalken ruckartig voranschreitet (die `progress`-Signale, die vom Worker eintreffen), während gleichzeitig der Herzschlag oben ohne die geringste Zögerung weiter steigt — keine Unterbrechung, keine spürbare Verlangsamung, nichts. Versuche auch, das Fenster während der laufenden Berechnung zu verschieben oder in der Größe zu ändern: Es reagiert normal, undenkbar im vorherigen Projekt während derselben identischen Berechnung.

Wenn du den Kontrast noch schärfer sehen willst, halte beide Projekte geöffnet und lass in beiden dieselbe identische Anzahl an zu suchenden Primzahlen laufen, eines nach dem anderen: Der Unterschied liegt nicht in der Dauer der Berechnung — die identisch ist, weil die CPU ohnehin dieselbe Arbeit leisten muss —, sondern in der *Reaktionsfähigkeit des Fensters* während dieser Zeit. Hier haben wir nichts beschleunigt (ein einziger Berechnungsthread, genau wie zuvor), wir haben diese Berechnung nur aus dem Weg der Event-Loop geräumt, die sich um das Fenster kümmern muss.

## Was du dir gerade selbst bewiesen hast

Du hast mit deinen eigenen Händen, und jede Zeile verstehend, das Pattern gebaut, das das Problem strukturell löst, mit dem dieser Kurs begonnen hat. Du hast den praktischen Unterschied zwischen dem `QThread`-Objekt und dem von ihm verwalteten Thread gesehen, du hast einen Worker mit `moveToThread()` verschoben und überprüft, dass seine Slots wirklich dort laufen, wo du es erwartest, du hast in beide Richtungen über Signale kommuniziert, ohne einen einzigen Mutex zu schreiben, und du hast ein sauberes Herunterfahren ohne Verluste gehandhabt. Im nächsten Modul führen wir `QMutex` und seine Verwandten ein — denn an dem Tag, an dem dein Worker veränderliche Daten gleichzeitig mit anderen Threads teilen muss (nicht nur Nachrichten über Signale austauschen, was dich heute vor jedem kritischen Abschnitt geschützt hat), wirst du diese Werkzeuge brauchen.

---

*Der vollständige Quellcode dieses Projekts ist im Repository verfügbar, das diesen Kurs begleitet, im Ordner `project-C-worker-thread`.*
