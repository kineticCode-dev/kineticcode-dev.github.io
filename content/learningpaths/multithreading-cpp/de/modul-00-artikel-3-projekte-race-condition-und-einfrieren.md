---
title: "Zwei Demonstrationen, keine zwei Erzählungen: die Race Condition und das Einfrieren mit eigenen Händen gebaut"
description: "Multithreading in C++ mit Qt — Modul 0 — Projekt"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Zwei Demonstrationen, keine zwei Erzählungen: die Race Condition und das Einfrieren mit eigenen Händen gebaut

Die beiden vorherigen Artikel haben das Vokabular aufgebaut: Thread, Nebenläufigkeit, Race Condition, Data Race, der Zwang zum einzigen Thread in Qt. Jetzt sind die Hände dran. Bauen wir gemeinsam zwei kleine Projekte: Das erste isoliert die Race Condition in reinem Standard-C++, ohne eine einzige Zeile Qt; das zweite stellt live das Einfrieren der UI nach, von dem wir schon gesprochen haben, und heilt es nur zur Hälfte — die eigentliche Heilung kommt im nächsten Modul, wenn wir die Berechnung mit `QThread` auf einen separaten Thread verschieben.

## Projekt A — Die Race Condition, isoliert und live

Wir wollen das reine Phänomen sehen, ohne irgendein Framework darüber. Erstelle einen Arbeitsordner und darin eine Datei `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.16)
project(race_condition_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

add_executable(race_condition_demo main.cpp)
target_link_libraries(race_condition_demo PRIVATE Threads::Threads)
```

`find_package(Threads REQUIRED)` sucht auf dem System nach der nativen Threading-Bibliothek (unter Linux ist das `pthread`; unter Windows übernimmt das die Runtime selbst), und `Threads::Threads` ist das Target, das wir an das ausführbare Programm binden: ohne diese explizite Verknüpfung würden manche Systeme Linkfehler werfen, sobald wir `std::thread` verwenden.

Erstelle `main.cpp` und beginne mit den Includes und den Konstanten:

```cpp
#include <iostream>
#include <thread>
#include <vector>
#include <mutex>

constexpr int THREAD_COUNT = 8;
constexpr int INCREMENTS_PER_THREAD = 1'000'000;
```

Acht Threads, je eine Million Inkremente: genug, um die Race Condition fast sicher beobachtbar zu machen (bei kleinen Zahlen könntest du sie, aus reinem statistischem Glück, nie auftreten sehen — und das ist bereits eine gute Lektion: "Ich habe es nicht gesehen, also gibt es das nicht" ist bei Nebenläufigkeit ein gefährlicher Gedankengang).

Nun die gefährliche Version:

```cpp
long long unprotectedCounter = 0;

void incrementUnprotected() {
    for (int i = 0; i < INCREMENTS_PER_THREAD; ++i) {
        unprotectedCounter++;   // <-- race condition qui
    }
}
```

Kein Trick: Es ist der offensichtlichste Code, den man sich vorstellen kann, und genau deshalb ist der Bug so heimtückisch. Er fällt beim Schreiben nicht auf, er fällt nur zur Laufzeit auf, und nur, wenn man ihn auf die richtige Weise beobachtet.

Direkt darunter die korrekte Version:

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

`std::lock_guard` ist ein **RAII**-Wrapper: Er erwirbt den Lock auf den Mutex im Konstruktor und gibt ihn automatisch im Destruktor frei, das heißt, wenn `lock` am Ende jeder Iteration den Gültigkeitsbereich verlässt. Das garantiert, dass der Mutex auch dann freigegeben wird, wenn zwischendurch eine Ausnahme geworfen würde — das mit manuellem `lock()`/`unlock()` zu vergessen, ist eine klassische Art, sich selbst einen Deadlock einzuhandeln.

In der `main` starte zuerst die ungeschützte Version:

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

`t.join()` blockiert den aufrufenden Thread, bis der Thread `t` vollständig beendet ist. Es ist entscheidend, es auf jedem erstellten Thread aufzurufen, bevor man das Endergebnis liest: `unprotectedCounter` zu lesen, bevor alle Threads fertig sind, würde eine weitere Race Condition einführen, diesmal zwischen dem lesenden Hauptthread und den anderen, die noch schreiben.

Füge denselben Block für die geschützte Version hinzu, wobei du `incrementWithMutex` statt `incrementUnprotected` aufrufst, und schließe mit `return 0;` ab.

Kompiliere und führe zunächst im Release-Modus aus:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/race_condition_demo
```

Es besteht eine konkrete Möglichkeit, dass der Zähler "ohne Mutex" auch bei dieser Ausführung korrekt erscheint. Das bedeutet nicht, dass der Code sicher ist: Es bedeutet, dass der Compiler — der das Recht hat anzunehmen, dass keine Data Race auftritt — `unprotectedCounter` wahrscheinlich für die gesamte Dauer der Schleife jedes Threads in einem Register gehalten hat, was das Problem verdeckt statt es zu lösen.

Kompiliere jetzt neu im Debug-Modus:

```bash
rm -rf build
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
./build/race_condition_demo
```

Mit deaktivierten Optimierungen durchläuft jedes einzelne Inkrement bei jeder Iteration tatsächlich ein Lesen und Schreiben im Speicher, und es ist viel wahrscheinlicher, dass sich zwei Threads auf die falsche Weise verschränken. Auf einer Testmaschine mit zwei Kernen verlor der Zähler "ohne Mutex" über fünf Millionen von acht Millionen erwarteten Inkrementen — ein Fehler von 60 %, keine vernachlässigbare Rundung. Probiere es mehrmals: Die exakte Anzahl der verlorenen Inkremente ändert sich jedes Mal, weil sie davon abhängt, wie der Scheduler die Threads bei dieser konkreten Ausführung verschränkt hat. Nicht deterministisch, per Definition — das ist wieder der zentrale Punkt des vorherigen Artikels.

Du hast dir gerade selbst bewiesen, dass eine scheinbar atomare Anweisung (`counter++`) auf Maschinenebene überhaupt nicht atomar ist, dass der Compiler das Problem verdecken kann, statt es zu lösen, wenn du nicht explizit synchronisierst, und dass ein einfacher `std::mutex` mit `std::lock_guard` ausreicht, um das Ergebnis jedes Mal, ohne Ausnahme, zur erwarteten mathematischen Exaktheit zurückzuführen.

## Projekt B — Das Einfrieren der UI, live

Das ist das Projekt, das mehr wert ist als jeder Absatz Theorie, um zu verstehen, warum dieser ganze Kurs überhaupt existiert. Wir bauen ein kleines Qt-Widgets-Fenster mit einem visuellen "Herzschlag" — einer Zahl, die jede Zehntelsekunde steigt, der Beweis, dass das Fenster lebt — und blockieren es dann absichtlich, auf Kommando, per Knopfdruck.

Erstelle einen neuen Arbeitsordner und eine `CMakeLists.txt`:

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

`CMAKE_AUTOMOC ON` ruft automatisch, hinter den Kulissen, den Meta-Object Compiler von Qt für jede Klasse auf, die das Makro `Q_OBJECT` verwendet — der moc generiert zusätzlichen Code, der den Signal-Slot-Mechanismus überhaupt erst ermöglicht. Du musst ihn nie von Hand aufrufen.

Erstelle `mainwindow.h`:

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

Das Makro `Q_OBJECT` ist es, das diese Klasse kompatibel mit dem Signal-Slot-System von Qt macht: Jede Klasse, die `connect()` verwenden will, muss es haben.

Erstelle `mainwindow.cpp` und beginne mit dem Konstruktor:

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

Beachte `new QWidget(this)`: `this` als Elternteil zu übergeben, sagt Qt "dieses Objekt lebt, solange das Fenster lebt, und wenn das Fenster zerstört wird, zerstöre auch dieses" — es ist das baumartige Verwandtschafts-Speicherverwaltungssystem von Qt, das fast immer manuelle `delete`-Aufrufe auf Widgets erspart. `connect()` verbindet ein **Signal** (`QTimer::timeout`, ausgelöst jedes Mal, wenn der Timer abläuft; `QPushButton::clicked`, ausgelöst beim Klick) mit einem **Slot** (einer Member-Funktion, die reagiert) — das ist der Mechanismus, mit dem in Qt ein Ereignis mit dem Code kommuniziert, der darauf reagieren muss, und auf dem wir in den nächsten Modulen die sichere Kommunikation zwischen Threads aufbauen werden.

Der harmlose Slot, der Herzschlag:

```cpp
void MainWindow::updateHeartbeat() {
    m_heartbeatCount++;
    m_labelHeartbeat->setText(QString("Heartbeat: %1").arg(m_heartbeatCount));
}
```

Nichts Besonderes: alle 100 ms steigt die Zahl um eins, und das Label wird aktualisiert. Das ist dein visueller Sensor dafür, ob der GUI-Thread noch atmet.

Die schwere Arbeit, absichtlich naiv:

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

Uns interessiert nicht, dass sie effizient ist, uns interessiert nur, dass sie die CPU auf reproduzierbare Weise für einige Sekunden beschäftigt.

Der Slot, der alles blockiert:

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

Dieser Slot ist mit dem `clicked()`-Signal eines `QPushButton` verbunden, wird also auf dem Thread ausgeführt, dem dieser Button gehört — dem Hauptthread, demselben, der die Event Loop laufen lässt und der `m_labelHeartbeat` aktualisiert. Solange `countPrimes` nicht zurückkehrt, kann dieser Thread **nichts anderes** tun: das Fenster nicht neu zeichnen, den Herzschlag-Timer nicht verarbeiten, nicht auf das Betriebssystem reagieren. Erhöhe oder verringere `30'000'000` je nachdem, wie schnell deine Maschine ist, bis die Berechnung mindestens 3-4 Sekunden dauert.

Schließlich `main.cpp`:

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

`app.exec()` ist buchstäblich die Event Loop, von der wir im vorherigen Artikel gesprochen haben: Von hier an, bis die Anwendung geschlossen wird, entscheidet dieser Zyklus — nicht dein Code —, wann jeder Slot aufgerufen wird.

Kompiliere und führe aus:

```bash
cmake -S . -B build
cmake --build build
./build/ui_freeze_demo
```

Lass das Fenster ein paar Sekunden offen und beobachte, wie die Zahl gleichmäßig steigt. Drücke dann den Knopf "Run heavy computation": Die Zahl bleibt **genau** im Moment des Klicks stehen, das Fenster wird wahrscheinlich grau (besonders wenn du versuchst, es während der Berechnung zu ziehen oder in der Größe zu ändern — probier es, es ist lehrreich), und erst wenn die Berechnung fertig ist, siehst du die Zahl wieder steigen, dort weiter, wo sie stehengeblieben war, alles auf einmal, als hätte die dazwischenliegende Zeit für den GUI-Thread nie existiert.

Kein abstraktes Konzept: Du hast mit eigenen Augen gesehen, dass "ein einziger Thread" keine theoretische Einschränkung von Qt ist, sondern ein physisch beobachtbares Verhalten deines Programms. Im nächsten Modul greifen wir genau dieselbe Datei `mainwindow.cpp` wieder auf und ändern sie so, dass `countPrimes` auf einen separaten `QThread` verschoben wird, mit dem Worker-Object-Pattern und `moveToThread()`: Du wirst sehen, wie der Herzschlag ungestört weitersteigt, während die Berechnung im Hintergrund läuft — die Heilung für die Krankheit, die du gerade mit deinen eigenen Händen diagnostiziert hast.

---

*Der vollständige Quellcode beider Projekte ist im begleitenden Repository dieses Kurses verfügbar, in den Ordnern `project-A-race-condition` und `project-B-ui-freeze`.*
