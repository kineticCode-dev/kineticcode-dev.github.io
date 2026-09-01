---
title: "Progetto: produttore, consumatore, e il buffer che li tiene in equilibrio"
description: "Multithreading in C++ con Qt — Modulo 2 — Progetto"
---

# Progetto: produttore, consumatore, e il buffer che li tiene in equilibrio

Costruiamo un'applicazione Qt Widgets con tre thread attivi contemporaneamente: il thread della GUI (che ormai conosci bene), un thread **Produttore** che genera un nuovo valore a intervalli casuali e lo inserisce nel buffer, e un thread **Consumatore** che lo preleva e simula di elaborarlo.

![Producer-consumer with a bounded buffer](img/modulo-02/10-producer-consumer-buffer.png)

Una barra di avanzamento mostra l'occupazione del buffer in tempo reale, e una lista di log registra ogni produzione e ogni consumo.

## Passo 1 — Lo scheletro del progetto

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

Cinque file sorgente oggi, non tre come nei progetti precedenti: `SharedBuffer` è una classe a sé, distinta sia dal Produttore sia dal Consumatore, perché — a differenza del progetto del modulo precedente, dove tutto lo stato viveva dentro un unico worker — oggi lo stato condiviso è precisamente l'oggetto che *entrambi* i thread devono poter raggiungere.

## Passo 2 — Il buffer condiviso: il cuore del progetto

Crea `sharedbuffer.h`:

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

Fermati sulla dichiarazione: `produce()` e `consume()` **non sono slot**. Sono metodi pubblici ordinari, pensati per essere chiamati **direttamente** dal codice del Produttore e del Consumatore — non tramite un segnale. È una differenza di stile importante rispetto al modulo precedente, dove *tutto* passava da segnali e slot: lì serviva perché stavamo semplicemente scambiando messaggi tra thread. Qui, invece, `SharedBuffer` è un oggetto la cui sicurezza in presenza di più thread viene garantita **internamente**, dal suo `QMutex` — può essere chiamato direttamente da qualunque thread, in qualunque momento, esattamente come faresti con una qualsiasi classe C++ thread-safe scritta senza Qt. I segnali restano lo strumento giusto per la *notifica* verso la GUI (`occupancyChanged`), non per l'accesso al dato stesso.

Ora `sharedbuffer.cpp`:

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

Riconosci il pattern dell'articolo precedente: il `while`, non l'`if`; il mutex sempre acquisito prima di toccare `m_queue` o `m_closed`; il risveglio mirato (`wakeOne`) nei percorsi normali, il risveglio totale (`wakeAll`) solo in `close()`, dove vogliamo che **chiunque** sia in attesa, produttore o consumatore, si svegli e se ne accorga.

## Passo 3 — Il Produttore

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

Nota cosa **manca** rispetto al progetto del modulo precedente: nessun flag di stop dedicato. Il ciclo vive finché `produce()` restituisce `true`, e `produce()` restituisce `false` esattamente quando (e solo quando) `SharedBuffer::close()` è stato chiamato. La condizione di terminazione del thread è interamente delegata all'oggetto condiviso — una scelta di design che tiene la logica di ciclo di vita in un unico posto invece di sparsa tra più classi.

## Passo 4 — Il Consumatore

`consumer.h` e `consumer.cpp` seguono la stessa struttura, specularmente:

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

Il consumatore è deliberatamente un po' più lento e più irregolare del produttore (intervalli 300-1100ms contro 200-800ms): è quello che ti permetterà di vedere il buffer riempirsi visibilmente nella barra di avanzamento invece di restare sempre vuoto.

## Passo 5 — La finestra: collegare i tre thread

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

Nel costruttore, dopo aver messo in piedi i widget (barra di avanzamento, lista di log — niente di nuovo rispetto ai progetti precedenti), la parte che conta:

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

Osserva dove vive `m_buffer`: è costruito con `this` (la finestra) come genitore, quindi la sua thread affinity resta quella del thread GUI — e va benissimo così, perché come hai visto nel Passo 2 nessuno chiama i suoi metodi `produce()`/`consume()` tramite segnali (dove la affinity conterebbe per decidere Direct o Queued): li chiama direttamente, da thread diversi, contando sul `QMutex` interno per la sicurezza. Il segnale `occupancyChanged`, invece, è emesso dall'interno di `produce()`/`consume()` — quindi dal thread del Produttore o del Consumatore, a seconda di chi ha appena agito — verso uno slot che vive nel thread GUI: qui la thread affinity **conta eccome**, e Qt sceglie automaticamente una connessione queued, esattamente come nel modulo precedente, indipendentemente da dove "vive" nominalmente l'oggetto `SharedBuffer` che ha emesso il segnale.

## Passo 6 — Gli slot della finestra

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

Nulla di nuovo qui — sono normali slot eseguiti sul thread GUI, popolati in sicurezza grazie alle connessioni queued di cui sopra.

## Passo 7 — Il distruttore: l'ordine che conta davvero

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

Questo è il punto in cui il ciclo di vita di un worker thread visto nel modulo precedente e le wait condition di oggi si incontrano, e vale la pena spiegare perché l'ordine di queste righe non è intercambiabile. Se in questo momento il Produttore è addormentato dentro `produce()` (buffer pieno, in attesa su `notFull`), la sua `start()` **non tornerà mai da sola**: è bloccata lì, non nel suo event loop. Questo significa che il thread del Produttore non è in condizione di processare **nessun altro evento**, incluso un'eventuale richiesta di `quit()` messa in coda prima. `close()` è quello che sblocca fisicamente la situazione: sveglia chiunque sia in attesa, la loro `start()` può finalmente valutare `if (m_closed) return false;` e ritornare, e **solo a quel punto** il thread torna al proprio event loop, libero di ricevere ed eseguire `quit()`. Se invertissi l'ordine — `quit()` prima di `close()` — non succederebbe nulla di catastrofico (la richiesta di uscita resterebbe semplicemente in coda, innocua), ma il vero lavoro di sblocco lo farebbe comunque solo `close()`: è lei, non `quit()`, la chiave di volta di uno spegnimento pulito quando ci sono wait condition di mezzo.

## Passo 8 — Compila, esegui, osserva il magazzino respirare

```bash
cmake -S . -B build
cmake --build build
./build/producer_consumer_demo
```

Guarda la barra di avanzamento: sale a scatti quando il Produttore inserisce un valore, scende quando il Consumatore ne preleva uno. Poiché il Consumatore è mediamente più lento, con il tempo tenderà a vedere il buffer riempirsi verso la capacità massima (5) più spesso che svuotarsi del tutto — è esattamente il comportamento che la teoria degli articoli precedenti prevede, ora osservabile a schermo. Guarda anche la lista di log: i valori compaiono sempre nello stesso ordine in cui sono stati prodotti, sia nella colonna "Produced" sia in quella "Consumed" — il buffer, essendo una coda (`QQueue`, primo entrato primo uscito), preserva l'ordine, una proprietà che nel tuo lavoro con pipeline di immagini è quasi sempre quella che vuoi (il frame numero 10 va elaborato ed emesso prima del frame numero 11, non dopo).

Chiudi la finestra e osserva che l'applicazione termina immediatamente, senza restare appesa: è la prova diretta che la sequenza `close()` + `quit()` + `wait()` del Passo 7 funziona come promesso, anche se in quel preciso istante uno dei due thread era addormentato in attesa dentro il buffer.

## Cosa hai appena dimostrato a te stesso

Hai costruito, e verificato con i tuoi occhi, il pattern di sincronizzazione più citato nella storia dei sistemi concorrenti — non come esercizio da manuale, ma con due thread veri, un mutex vero, due wait condition vere, e uno spegnimento che non lascia nulla appeso. Hai anche visto una distinzione di design importante rispetto al modulo precedente: non tutto deve passare da segnali e slot — un oggetto con la propria sincronizzazione interna può essere chiamato direttamente da più thread, ed è spesso la scelta più naturale quando lo stato condiviso è il punto centrale del problema, non un dettaglio da nascondere dietro messaggi.

Se il produttore-consumatore di oggi ti ha incuriosito, un ottimo approfondimento da provare per conto tuo è estendere il progetto a **più produttori o più consumatori** sullo stesso buffer: il codice di `SharedBuffer` non cambia di una riga (è già corretto per quel caso, `wakeOne()` e il ciclo `while` lo garantiscono), ma osservare come si comporta con tre consumatori invece di uno è un esercizio che vale più di molte pagine di teoria sulla starvation.

---

*Il codice sorgente completo di questo progetto è disponibile nella repository che accompagna questo corso, nella cartella `project-D-producer-consumer`.*
