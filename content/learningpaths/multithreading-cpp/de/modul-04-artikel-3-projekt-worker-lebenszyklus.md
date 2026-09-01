---
title: "Projekt: der vollständige Lebenszyklus eines Workers — starten, pausieren, fortsetzen, stoppen"
description: "Multithreading in C++ mit Qt — Modul 4 — Projekt"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projekt: der vollständige Lebenszyklus eines Workers — starten, pausieren, fortsetzen, stoppen

Wir bauen eine Qt-Widgets-Anwendung mit einem dauerhaften Worker — demselben `moveToThread()`-Muster, das du aus Modul 1 kennst —, der eine schrittweise Verarbeitung durchführt (200 Schritte, jeder mit einer kleinen CPU-lastigen Berechnung gefolgt von einer kurzen, konfigurierbaren Pause), steuerbar über vier Befehle vom Fenster aus: **Start**, **Pause**, **Resume**, **Stop**. Zusätzlich demonstrieren zwei eigene Steuerelemente `QMetaObject::invokeMethod` in seinen zwei wichtigsten Varianten: eine, um die Ausführungsgeschwindigkeit im laufenden Betrieb zu ändern, eine, um den aktuellen Schritt synchron abzufragen.

**Voraussetzungen**: Qt 6 mit der Komponente **Widgets**, keine zusätzlichen Abhängigkeiten gegenüber den vorangegangenen Modulen.

## Schritt 1 — Das Grundgerüst des Projekts

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

Keine Überraschung hier: dieselbe Form wie immer. Die Substanz von heute steckt vollständig in der internen Architektur von `CyclicWorker`.

## Schritt 2 — Der Worker: die Deklaration, und eine Unterscheidung, die mehr zählt als jede andere Zeile dieses Projekts

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

Bleib bei der Aufteilung zwischen `pause()`/`resume()`/`stop()`, die als gewöhnliche öffentliche Methoden deklariert sind, und `start()`, der einzigen, die als `public slots` deklariert ist. Das ist keine stilistische Laune: Es ist die wichtigste Lektion dieses gesamten Projekts, und um sie dir gut zu erzählen, muss ich dir zuerst den Fehler zeigen, den ich bei ihrer Konstruktion gemacht habe.

### Die falsche Version, die ich zuerst geschrieben habe (und der Deadlock, der daraus folgte)

Mein erster Entwurf verband Pause, Fortsetzung und Stopp genau so, wie du es aus den Modulen 1 und 2 erwarten würdest — drei Signale im Fenster, per `connect()` mit drei Slots des Workers verbunden:

```cpp
//--- WRONG VERSION, do not use it ---
connect(this, &MainWindow::requestPause, m_worker, &CyclicWorker::pause);
connect(this, &MainWindow::requestResume, m_worker, &CyclicWorker::resume);
connect(this, &MainWindow::requestStop, m_worker, &CyclicWorker::stop);
```

Es kompilierte ohne Fehler. Es führte die Sequenz Start → Pause → Resume ohne erkennbare Probleme aus. Aber in dem Moment, in dem mein automatisierter Test "Pause" drückte und dann, bei noch schlafendem Worker, "Stop" drückte, fror die gesamte Anwendung für immer ein — kein Absturz, keine Meldung, einfach stehengeblieben, genau das stille Symptom eines Deadlocks, das dich Modul 2 zu erkennen gelehrt hat.

Die Ursache, einmal gefunden, ist glasklar — und ist ein direktes Korollar aus den beiden vorangegangenen Artikeln dieses Moduls zusammengenommen: Während der Worker pausiert ist, ist sein `start()` blockiert innerhalb von `m_pauseCondition.wait(&m_mutex)`. Dieser Aufruf **ist kein Durchlauf der Event-Loop**: Es ist eine Blockade auf Betriebssystemebene, der Thread ist buchstäblich dort suspendiert, er führt nicht `exec()` aus, er verarbeitet keine Ereigniswarteschlange. Ein Signal `requestStop()`, das über eine `QueuedConnection` verbunden ist (automatisch, weil Sender und Empfänger auf unterschiedlichen Threads sind), legt sein Ereignis brav in die Warteschlange des Workers ab — aber niemand wird es je auslesen, weil der Thread, der das tun sollte, in einem `wait()` festsitzt, aus dem ihn seinerseits niemand aufweckt. Es ist genau dieselbe Problemfamilie wie die `deleteLater()`-Falle, die du in Modul 1 kennengelernt hast: ein Ereignis, das in eine Warteschlange gelegt wurde, die niemand je verarbeiten wird, weil ihr besitzender Thread nicht läuft.

### Die Korrektur: direkte Aufrufe, wie beim gemeinsamen Puffer aus Modul 2

Die Lösung, im Nachhinein betrachtet, stand bereits in Modul 2 geschrieben, ich hatte sie nur nicht als auch hier anwendbar erkannt. Erinnerst du dich an die Methoden zum Produzieren, Konsumieren und Schließen des gemeinsamen Puffers? Es waren keine Slots: Es waren gewöhnliche öffentliche Methoden, **direkt** von unterschiedlichen Threads aus aufgerufen, sicher nicht, weil sie über die Meta-Maschinerie von Signalen und Slots liefen, sondern weil jede Zeile, die sie berührten, bereits durch ein eigenes, internes `QMutex` geschützt war. Genau dieselbe Logik gilt heute für `pause()`, `resume()` und `stop()`: Sie sind sicher, direkt vom GUI-Thread aus auf einem Objekt aufzurufen, das auf einem anderen Thread lebt, weil das Einzige, was sie berühren, durch `m_mutex` geschützt oder atomar (`m_stop`) ist — sie brauchen die Event-Loop des Workers nicht, um sicher ausgeführt zu werden, und gerade deshalb **funktionieren sie auch dann, wenn diese Event-Loop nicht läuft**, wie zum Beispiel während der Pause.

`start()` hingegen muss ein Slot bleiben, der über `connect()` erreicht wird — weil sie, anders als pause/resume/stop, wirklich auf dem vom `QThread` verwalteten Thread laufen muss, nicht auf dem des Aufrufers: Es ist der gesamte Arbeitskörper des Workers, nicht nur eine Flag-Änderung. Ein direkter Aufruf `m_worker->start()` vom GUI-Thread aus würde den gesamten 200-Schritte-Zyklus **auf dem GUI-Thread selbst** ausführen — genau das Einfrieren, das dich Modul 1 seit dem ersten Tag zu vermeiden gelehrt hat.

## Schritt 3 — Der Worker: start(), pause(), resume(), stop()

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

Der Körper der Schleife dürfte dir mittlerweile vertraut sein: die Prüfung des Stop-Flags ganz oben, der Pauseblock mit `while` und `wait()`, eine kleine CPU-lastige Berechnung, die die "eigentliche Arbeit" jedes Schritts darstellt, und die Emission des Fortschritts. Die letzte Zeile, `QCoreApplication::processEvents()`, erklären wir gleich im nächsten Schritt.

Betrachte `stop()` genau, denn es ist die direkte Anwendung der Lektion aus Modul 2 auf das heutige Problem: `m_stop.store(true)` allein zu schreiben, würde den Fall lösen, in dem der Worker **aktiv** ist, innerhalb seiner eigenen Arbeitsschleife — bei der nächsten Prüfung des Flags würde er sauber aussteigen. Wenn der Worker aber in diesem Moment **innerhalb von `wait()` eingeschlafen** ist, weil er pausiert, erreicht ihn dieses eine Schreiben allein nicht: Er würde für immer weiterschlafen, weil ihn niemand aufgeweckt hat, damit er irgendetwas neu prüft, einschließlich des Stop-Flags. `stop()` beschränkt sich also nicht darauf, das Flag zu schreiben: Es erzwingt auch `m_paused` auf `false` und ruft `wakeAll()` auf — es weckt alle, die gewartet haben, die daraufhin die Bedingung ihrer eigenen `while`-Schleife neu prüfen, `m_stop` als `true` vorfinden und sauber aus der Warteschleife aussteigen, noch bevor sie in den Arbeitskörper zurückkehren.

## Schritt 4 — setInterval() und currentStep(): die invokeMethod-Demo, und warum processEvents() nötig ist

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

Nichts Überraschendes in der Implementierung: zwei `Q_INVOKABLE`-Methoden, geschützt durch denselben Mutex wie der Rest des Zustands. Der interessante Punkt liegt darin, **wie** das Fenster sie gleich aufrufen wird — mit `QMetaObject::invokeMethod`, nicht mit einem `connect()`. Und das bringt uns zurück zu jener isolierten Zeile am Ende der Schleife von `start()`, `QCoreApplication::processEvents()`.

Sowohl `Qt::QueuedConnection` als auch `Qt::BlockingQueuedConnection` funktionieren bei `invokeMethod`, indem sie ein Ereignis in die Warteschlange des empfangenden Threads ablegen, und dieses Ereignis wird erst ausgeführt, wenn die Event-Loop dieses Threads dazu kommt, es zu verarbeiten. Aber `start()` ist **selbst** ein einzelner, langer Slot, der den Thread des Workers vom Beginn bis zum Ende der Schleife belegt — während er läuft, führt dieser Thread in dem Sinne, wie du es normalerweise meinst, **kein `exec()` aus**: Er führt den Körper von `start()` aus, das seinerseits *von* einem Ereignis aufgerufen wurde, das die Event-Loop verarbeitet hat. Solange `start()` nicht zurückkehrt, kehrt die Event-Loop des Workers nicht zu ihrem eigenen Empfangszyklus zurück — was bedeutet, dass jedes neue Ereignis, das in der Zwischenzeit ankommt (etwa ein `invokeMethod`-Aufruf an `setInterval()` oder `currentStep()`), unverarbeitet in der Warteschlange bliebe, bis die 200 Schritte abgeschlossen sind. Bei einer `Qt::QueuedConnection` wäre das nur eine lästige Verzögerung; bei einer `Qt::BlockingQueuedConnection` wäre es eine **Blockade der GUI für die gesamte Dauer der Schleife** — genau die Art von Einfrieren, die dich dieser gesamte Kurs zu vermeiden gelehrt hat, diesmal aber nicht verursacht durch eine schwere Berechnung direkt auf der GUI, sondern durch ein subtileres Detail der Event-Loop des Workers.

`QCoreApplication::processEvents()`, einmal pro Schritt aufgerufen, ist die Abhilfe: Es "pumpt" manuell die Ereigniswarteschlange des aktuellen Threads und gibt jedem wartenden Ereignis — einschließlich der `invokeMethod`-Aufrufe an dieses Objekt selbst — ein Zeitfenster, verarbeitet zu werden, bevor mit dem nächsten Schritt fortgefahren wird. Es ist eine dokumentierte und legitime Technik für lange Slots, die teilweise reaktiv bleiben müssen, aber es lohnt sich, ehrlich über ihre Grenzen zu sein: **Sie hilft während der Pause überhaupt nicht**. Innerhalb von `wait()` ist der Thread auf Betriebssystemebene blockiert, er führt keinerlei Qt-Code aus — es gibt keinen Punkt, an dem `processEvents()` aufgerufen werden könnte, weil die Kontrolle in diesem Moment nicht in den Händen deines Codes liegt. Und genau aus diesem Grund — nicht aus stilistischer Symmetrie — bleiben `pause()`, `resume()` und `stop()` direkte Aufrufe: Sie sind der einzige Mechanismus, der den Worker in **jedem** seiner Zustände erreicht, Pause eingeschlossen, während `invokeMethod` an diesen Worker nur funktioniert, weil wir absichtlich ein Zeitfenster für ihn innerhalb der aktiven Schleife geöffnet haben.

## Schritt 5 — Der Header des Fensters

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

Beachte, dass es nur ein einziges Signal gibt, `requestStart()` — konsequent mit allem, was du gerade in Schritt 2 gesehen hast: Es ist der einzige Befehl, der wirklich über die Event-Loop laufen muss, weil er der einzige ist, der Code **auf dem Thread des Workers** ausführen muss, statt nur dessen internen Zustand zu ändern.

## Schritt 6 — Der Konstruktor: den Worker aufbauen, ohne ihn sofort zu starten

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

Beachte einen bewussten Unterschied zu den Modulen 1 und 2: Hier verbinden wir `QThread::started` **nicht** direkt mit `start()`. Der Worker bleibt, sobald der Thread gestartet ist, untätig — seine Event-Loop ist trotzdem bereits aktiv und bereit, Befehle entgegenzunehmen (einschließlich der direkten Aufrufe an `pause()`/`resume()`/`stop()`, die diese, wie du weißt, gar nicht brauchen) —, bis der Benutzer wirklich den Button "Start" drückt. Das ist der Zustand "Idle" im Diagramm unten, jener vor jeglicher Arbeit.

## Schritt 7 — Die Slots des Fensters, einschließlich der zwei invokeMethod-Demonstrationen

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

Und endlich die zwei seit der Einleitung des Moduls versprochenen Demonstrationen:

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

Das erste ist Fire-and-forget: Der GUI-Thread postet den Befehl und macht sofort weiter, ohne auf eine Bestätigung zu warten — perfekt für eine Konfigurationsänderung, die nicht synchron sein muss. Das zweite hingegen verwendet `Qt::BlockingQueuedConnection` mit `Q_RETURN_ARG`: Der GUI-Thread hält wirklich an, bis `currentStep()` auf dem Thread des Workers ausgeführt wurde und einen Wert zurückgegeben hat — den wir also sofort im Label anzeigen können, mit der Gewissheit, dass es der wahre Wert dieses Augenblicks ist, kein abgestandener. Beide funktionieren ohne spürbares Einfrieren der GUI dank des `QCoreApplication::processEvents()`, das in Schritt 4 in die Schleife von `start()` eingefügt wurde und dem Worker zwischen zwei Schritten die Gelegenheit gibt, genau diese beiden Befehle zu verarbeiten.

## Schritt 8 — Der Destruktor: dieselbe Disziplin wie in Modul 2, hier angewandt

```cpp
MainWindow::~MainWindow() {
    m_worker->stop();   // direct call: reaches the worker even while paused

    m_thread->quit();
    m_thread->wait();

    delete m_worker;
}
```

Drei Zeilen, aber jede erledigt eine präzise Aufgabe, und es ist dieselbe Reihenfolge, die du bereits im geführten Projekt aus Modul 2 gesehen hast: Zuerst stellen wir sicher, dass der Worker niemals wartend eingeschlafen bleiben kann (`stop()`, das, wie du weißt, `m_paused` auf `false` erzwingt und `wakeAll()` aufruft, noch bevor es das Stop-Flag vollständig geschrieben hat), **dann** bitten wir den Thread mit `quit()`, sich zu beenden, **dann** warten wir mit `wait()`, bis er es wirklich getan hat. Würdest du die Reihenfolge umkehren — `quit()` vor `stop()` — und der Worker wäre in diesem Moment pausiert und eingeschlafen, hätte der Thread nie die Möglichkeit, seine Schleife zu verlassen, um zu dem Punkt zu gelangen, an dem die `quit()`-Anfrage tatsächlich befolgt wird, und `wait()` würde das Schließen des Fensters für immer blockieren.

## Schritt 9 — Kompilieren, ausführen und den vollständigen Lebenszyklus beobachten

```bash
cmake -S . -B build
cmake --build build
./build/worker_lifecycle_demo
```

Drücke "Start": Der Fortschrittsbalken beginnt, Schritt für Schritt voranzuschreiten, und das Statuslabel zeigt "Running". Drücke "Pause" auf halbem Weg: Der Fortschritt stoppt sofort, das Label wechselt zu "Paused" — und beobachtest du die CPU-Auslastung des Prozesses während der Pause, wirst du sehen, wie sie fast auf null fällt, der direkte Beweis dafür, dass der Worker innerhalb von `wait()` schläft, statt das Flag in einer aktiven Schleife zu prüfen, die einen ganzen Kern verschwenden würde, ohne etwas zu tun. Drücke "Resume": Der Fortschritt setzt sich genau dort fort, wo er stehen geblieben war. Probiere auch die zwei `invokeMethod`-Steuerelemente aus: Ändere das Intervall mit dem Spinbox und drücke "Anwenden", während der Worker läuft — du wirst sehen, wie sich die Fortschrittsgeschwindigkeit des Balkens ab dem nächsten Schritt ändert, der Beweis, dass der Befehl angekommen ist; drücke "Schritt abfragen" und beobachte, wie sich das Label sofort mit dem exakten Schritt aktualisiert, synchron vom Thread des Workers gelesen. Drücke schließlich "Stop" — probiere es sowohl aus, während der Worker läuft, als auch während er pausiert ist, um mit eigenen Augen zu sehen, dass die Beendigung in beiden Fällen sauber und sofort erfolgt, niemals eine Blockade. Schließe das Fenster: Die Anwendung endet sofort, unabhängig davon, in welchem Zustand sich der Worker gerade befand.

![Worker lifecycle diagram: which command triggers each transition, and how it reaches the worker](modulo-04/20-worker-lifecycle-start-pause-stop.png)

Das Diagramm fasst den gesamten Weg zusammen, den du gerade zurückgelegt hast: Jeder Übergang wird durch einen Klick in der GUI ausgelöst, aber der Mechanismus, mit dem er den Worker erreicht, ändert sich je nachdem, was gebraucht wird — ein queued Signal für `start()` (das auf dem richtigen Thread laufen muss), direkte Aufrufe für Pause/Fortsetzung/Stopp (die auch funktionieren müssen, wenn die Event-Loop des Workers nicht läuft).

## Was du dir selbst gerade bewiesen hast

Du hast einen Worker mit einem vollständigen, kontrollierbaren Lebenszyklus gebaut — nicht nur "startet und endet von selbst" wie in den vorangegangenen Modulen, sondern startbar, pausierbar, fortsetzbar und auf Anfrage stoppbar, in jeder Kombination, ohne je eine Blockade. Du hast, mit einem echten reproduzierten und gelösten Deadlock, gesehen, warum die Wahl zwischen "queued Verbindung" und "direktem Aufruf" keine Stilfrage ist, sondern von einer präzisen Tatsache abhängt: ob der empfangende Thread in diesem Moment seine eigene Event-Loop frei laufen lassen kann oder nicht. Du hast `QMetaObject::invokeMethod` in beiden Hauptvarianten benutzt und verstanden, warum die blockierende Variante deine GUI hätte einfrieren können, hättest du den Grund nicht verstanden — und gelöst —, warum ein einzelner langer Slot die Event-Loop seines eigenen Threads aushungern kann.

Es ist kein Zufall, dass der in diesem Artikel geschilderte Deadlock genau an dem Berührungspunkt zweier Konzepte entstand, die bereits erworben schienen — die queued Connection aus Modul 1, die Wait Condition aus Modul 2 — gemeinsam angewandt in einem neuen Kontext: Fast immer ist es genau dort, an der Schnittstelle zweier Werkzeuge, die man einzeln gut kennt, wo sich die lehrreichsten Bugs verstecken.

---

*Der vollständige Quellcode dieses Projekts ist im Repository verfügbar, das diesen Kurs begleitet, im Ordner `project-F-worker-lifecycle`.*
