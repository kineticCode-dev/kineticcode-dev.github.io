---
title: "Projekt: Producer, Consumer, und der Puffer, der sie im Gleichgewicht hält"
description: "Multithreading in C++ mit Qt — Modul 2 — Projekt"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projekt: Producer, Consumer, und der Puffer, der sie im Gleichgewicht hält

Wir bauen eine Qt-Widgets-Anwendung mit drei gleichzeitig aktiven Threads: dem GUI-Thread (den du inzwischen gut kennst), einem **Producer**-Thread, der in zufälligen Abständen einen neuen Wert erzeugt und ihn in den Puffer einfügt, und einem **Consumer**-Thread, der ihn entnimmt und simuliert, ihn zu verarbeiten.

![Producer-consumer with a bounded buffer](modulo-02/10-producer-consumer-buffer.png)

Ein Fortschrittsbalken zeigt die Auslastung des Puffers in Echtzeit, und eine Log-Liste protokolliert jede Produktion und jeden Konsum.

## Schritt 1 — Das Projektgerüst

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

Heute fünf Quelldateien, nicht drei wie in den vorherigen Projekten: `SharedBuffer` ist eine eigenständige Klasse, getrennt sowohl vom Producer als auch vom Consumer, weil — anders als beim Projekt des vorherigen Moduls, wo der gesamte Zustand in einem einzigen Worker lebte — heute der gemeinsam genutzte Zustand genau das Objekt ist, das *beide* Threads erreichen können müssen.

## Schritt 2 — Der gemeinsame Puffer: das Herzstück des Projekts

Erstelle `sharedbuffer.h`:

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

Bleib bei der Deklaration kurz stehen: `produce()` und `consume()` **sind keine Slots**. Es sind gewöhnliche öffentliche Methoden, die dafür gedacht sind, **direkt** vom Code des Producers und des Consumers aufgerufen zu werden — nicht über ein Signal. Das ist ein wichtiger Stilunterschied gegenüber dem vorherigen Modul, wo *alles* über Signale und Slots lief: Dort war das nötig, weil wir schlicht Nachrichten zwischen Threads austauschten. Hier hingegen ist `SharedBuffer` ein Objekt, dessen Sicherheit bei mehreren Threads **intern** durch seinen `QMutex` garantiert wird — es kann direkt von jedem beliebigen Thread zu jedem beliebigen Zeitpunkt aufgerufen werden, genau so, wie du es mit jeder beliebigen thread-sicheren C++-Klasse ohne Qt tun würdest. Signale bleiben das richtige Werkzeug für die *Benachrichtigung* der GUI (`occupancyChanged`), nicht für den Zugriff auf das Datum selbst.

Jetzt `sharedbuffer.cpp`:

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

Du erkennst das Muster aus dem vorherigen Artikel wieder: das `while`, nicht das `if`; der Mutex immer erworben, bevor `m_queue` oder `m_closed` angefasst wird; das gezielte Aufwecken (`wakeOne`) auf den normalen Pfaden, das vollständige Aufwecken (`wakeAll`) nur in `close()`, wo wir wollen, dass **jeder**, der wartet, ob Producer oder Consumer, aufwacht und es bemerkt.

## Schritt 3 — Der Producer

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

Beachte, was im Vergleich zum Projekt des vorherigen Moduls **fehlt**: kein eigenes Stop-Flag. Die Schleife lebt so lange, wie `produce()` `true` zurückgibt, und `produce()` gibt genau dann (und nur dann) `false` zurück, wenn `SharedBuffer::close()` aufgerufen wurde. Die Terminierungsbedingung des Threads wird vollständig an das gemeinsam genutzte Objekt delegiert — eine Designentscheidung, die die Lebenszykluslogik an einem einzigen Ort hält, statt sie über mehrere Klassen zu verstreuen.

## Schritt 4 — Der Consumer

`consumer.h` und `consumer.cpp` folgen derselben Struktur, spiegelbildlich:

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

Der Consumer ist absichtlich etwas langsamer und unregelmäßiger als der Producer (Intervalle 300–1100 ms gegenüber 200–800 ms): Das ist es, was dich den Puffer sichtbar im Fortschrittsbalken anwachsen lässt, statt dass er immer leer bleibt.

## Schritt 5 — Das Fenster: die drei Threads verbinden

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

Im Konstruktor, nachdem die Widgets aufgesetzt sind (Fortschrittsbalken, Log-Liste — nichts Neues gegenüber den vorherigen Projekten), der Teil, der zählt:

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

Beachte, wo `m_buffer` lebt: Es wird mit `this` (dem Fenster) als Elternteil erzeugt, seine Thread-Affinität bleibt also die des GUI-Threads — und das ist völlig in Ordnung, denn wie du in Schritt 2 gesehen hast, ruft niemand seine Methoden `produce()`/`consume()` über Signale auf (wo die Affinität für die Entscheidung zwischen Direct und Queued eine Rolle spielen würde): Sie werden direkt aufgerufen, von verschiedenen Threads aus, unter Vertrauen auf den internen `QMutex` für die Sicherheit. Das Signal `occupancyChanged` hingegen wird aus dem Inneren von `produce()`/`consume()` emittiert — also vom Thread des Producers oder des Consumers, je nachdem, wer gerade gehandelt hat — hin zu einem Slot, der im GUI-Thread lebt: Hier zählt die Thread-Affinität **sehr wohl**, und Qt wählt automatisch eine Queued-Verbindung, genau wie im vorherigen Modul, unabhängig davon, wo das Objekt `SharedBuffer`, das das Signal emittiert hat, nominell "lebt".

## Schritt 6 — Die Slots des Fensters

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

Nichts Neues hier — das sind normale Slots, die auf dem GUI-Thread ausgeführt werden, dank der oben beschriebenen Queued-Verbindungen sicher befüllt.

## Schritt 7 — Der Destruktor: die Reihenfolge, auf die es wirklich ankommt

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

Das ist der Punkt, an dem sich der Lebenszyklus eines Worker-Threads aus dem vorherigen Modul und die Wait Conditions von heute treffen, und es lohnt sich zu erklären, warum die Reihenfolge dieser Zeilen nicht austauschbar ist. Wenn der Producer in diesem Moment innerhalb von `produce()` schläft (Puffer voll, wartend auf `notFull`), wird seine `start()` **nicht von selbst zurückkehren**: Sie ist dort blockiert, nicht in ihrer Event-Loop. Das bedeutet, der Producer-Thread ist nicht in der Lage, **irgendein anderes Ereignis** zu verarbeiten, einschließlich einer eventuell zuvor in die Warteschlange gestellten `quit()`-Anfrage. `close()` ist das, was die Situation physisch löst: Es weckt jeden, der wartet, deren `start()` kann endlich `if (m_closed) return false;` auswerten und zurückkehren, und **erst dann** kehrt der Thread zu seiner eigenen Event-Loop zurück, frei, `quit()` zu empfangen und auszuführen. Würdest du die Reihenfolge umkehren — `quit()` vor `close()` —, würde nichts Katastrophales passieren (die Beendigungsanfrage würde einfach harmlos in der Warteschlange bleiben), aber die eigentliche Entsperrarbeit würde trotzdem nur `close()` leisten: Sie, nicht `quit()`, ist der Schlüssel zu einem sauberen Herunterfahren, wenn Wait Conditions im Spiel sind.

## Schritt 8 — Kompilieren, ausführen, dem Lager beim Atmen zusehen

```bash
cmake -S . -B build
cmake --build build
./build/producer_consumer_demo
```

Schau dir den Fortschrittsbalken an: Er springt nach oben, wenn der Producer einen Wert einfügt, und geht nach unten, wenn der Consumer einen entnimmt. Da der Consumer im Schnitt langsamer ist, wirst du mit der Zeit tendenziell öfter sehen, wie sich der Puffer der Maximalkapazität (5) nähert, als dass er sich vollständig leert — genau das Verhalten, das die Theorie der vorherigen Artikel vorhersagt, jetzt auf dem Bildschirm beobachtbar. Schau dir auch die Log-Liste an: Die Werte erscheinen immer in derselben Reihenfolge, in der sie produziert wurden, sowohl in der Spalte "Produced" als auch in der Spalte "Consumed" — der Puffer, als Warteschlange (`QQueue`, First-in-first-out), bewahrt die Reihenfolge, eine Eigenschaft, die in deiner Arbeit mit Bild-Pipelines fast immer die gewünschte ist (Frame Nummer 10 muss vor Frame Nummer 11 verarbeitet und ausgegeben werden, nicht danach).

Schließe das Fenster und beobachte, dass die Anwendung sofort beendet wird, ohne hängen zu bleiben: Das ist der direkte Beweis, dass die Sequenz `close()` + `quit()` + `wait()` aus Schritt 7 wie versprochen funktioniert, selbst wenn genau in diesem Moment einer der beiden Threads im Puffer wartend eingeschlafen war.

## Was du dir gerade selbst bewiesen hast

Du hast das meistzitierte Synchronisationsmuster in der Geschichte nebenläufiger Systeme gebaut und mit eigenen Augen überprüft — nicht als Lehrbuchübung, sondern mit zwei echten Threads, einem echten Mutex, zwei echten Wait Conditions und einem Herunterfahren, das nichts hängen lässt. Du hast auch eine wichtige Designunterscheidung gegenüber dem vorherigen Modul gesehen: Nicht alles muss über Signale und Slots laufen — ein Objekt mit eigener interner Synchronisation kann direkt von mehreren Threads aufgerufen werden, und das ist oft die naheliegendere Wahl, wenn der gemeinsam genutzte Zustand der Kern des Problems ist, kein Detail, das hinter Nachrichten versteckt werden muss.

Wenn dich der heutige Producer-Consumer neugierig gemacht hat, ist eine hervorragende Vertiefung, die du selbst ausprobieren solltest, das Projekt auf **mehrere Producer oder mehrere Consumer** am selben Puffer zu erweitern: Der Code von `SharedBuffer` ändert sich dabei keine Zeile (er ist bereits korrekt für diesen Fall — `wakeOne()` und die `while`-Schleife garantieren das), aber zu beobachten, wie er sich mit drei Consumern statt einem verhält, ist eine Übung, die mehr wert ist als viele Seiten Theorie über Starvation.

---

*Der vollständige Quellcode dieses Projekts ist im Repository verfügbar, das diesen Kurs begleitet, im Ordner `project-D-producer-consumer`.*
