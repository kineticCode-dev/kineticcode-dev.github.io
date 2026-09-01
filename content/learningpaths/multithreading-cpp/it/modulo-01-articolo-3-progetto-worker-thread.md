---
title: "Progetto: curare il freeze sul serio, spostando il calcolo su un worker thread"
description: "Multithreading in C++ con Qt — Modulo 1 — Progetto"
---

# Progetto: curare il freeze sul serio, spostando il calcolo su un worker thread

Riprendiamo esattamente il progetto del freeze del modulo precedente. Stessa finestra, stesso battito, stesso identico calcolo di numeri primi — cambia solo *dove* gira. Se hai ancora aperta la cartella di lavoro di quel progetto, puoi partire da lì; altrimenti crea una nuova cartella e segui i passi da zero: sono comunque pochi minuti di lavoro.

## Passo 1 — Lo scheletro del progetto

`CMakeLists.txt`, identico nella forma a quello del progetto precedente (nessuna sorpresa: non stiamo cambiando il sistema di build, solo l'architettura interna del programma):

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

L'unica novità è che ora il calcolo pesante vive nel suo file separato — `primecalculator.h`/`.cpp` — invece che dentro `MainWindow`. Non è un capriccio stilistico: è la conseguenza diretta di quanto visto negli articoli precedenti. Il worker deve essere una classe a sé, distinta da `MainWindow`, proprio perché è lei (e solo lei) che sposteremo su un altro thread.

## Passo 2 — Il worker: logica pura, nessuna idea di "thread" al suo interno

Crea `primecalculator.h`:

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

Fermati un attimo su `setLimit()`: **non** è uno slot, è un metodo pubblico ordinario. La ragione l'abbiamo vista nell'articolo precedente: lo chiameremo dal thread GUI, ma **prima** di avviare il thread gestito — in quel preciso momento non c'è ancora nessuna concorrenza in atto (il worker non sta eseguendo nulla su nessun thread), quindi impostare direttamente una variabile membro è del tutto sicuro. Se lo chiamassi *dopo* aver avviato il thread, invece, staresti scrivendo `m_limit` da un thread mentre potenzialmente `start()` lo sta leggendo da un altro — di nuovo, esattamente la data race che ormai riconosci a memoria.

Ora `primecalculator.cpp` — il corpo del calcolo è lo stesso identico algoritmo del progetto precedente, con l'aggiunta di un segnale di progresso periodico:

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

Il segnale `progress` è la prima vera dimostrazione di comunicazione dal worker verso il resto del programma **durante** il calcolo, non solo alla fine — ed è un `emit` innocuo da scrivere qui perché, come sai dall'articolo precedente, Qt lo consegnerà in coda al thread giusto senza che tu debba fare nulla di più.

## Passo 3 — L'header della finestra: aggiungi thread, worker, e il segnale-messaggero

Crea (o modifica, se riparti dal progetto precedente) `mainwindow.h`:

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

Il segnale `requestComputation()`, dichiarato qui in `MainWindow`, è il "messaggero" di cui parlavamo nell'articolo precedente: `MainWindow` non chiamerà mai direttamente `m_worker->start()` (sarebbe una chiamata di funzione ordinaria, eseguita sul thread chiamante — sbagliato, e per di più pericoloso se toccasse dati del worker). Emetterà invece questo segnale, collegato allo slot del worker: la consegna in sicurezza, come sempre, la fa Qt.

## Passo 4 — Il costruttore: qui avviene tutto il collegamento

In `mainwindow.cpp`, il corpo della finestra (etichette, bottone, barra di progresso, battito) è identico nella forma al progetto precedente, con l'aggiunta di una `QProgressBar`. La parte nuova, quella su cui vale la pena concentrarsi, è il collegamento del worker:

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

Segui l'ordine con attenzione, perché non è casuale: prima costruisci il worker **senza genitore**, poi imposti il suo stato iniziale (ancora sicuro, thread non partito), **poi** lo sposti con `moveToThread()`, **poi** colleghi i segnali (le connessioni funzionano correttamente indipendentemente da quando le fai, ma collegarle prima di avviare il thread è buona abitudine: eviti la possibilità, remota ma concettualmente scomoda, che il thread parta e finisca il suo lavoro prima ancora che tu abbia collegato chi deve riceverne il risultato), e solo alla fine chiami `m_thread->start()`. Da questo momento, il thread gestito è vivo, in attesa — il suo event loop gira, ma non fa nulla finché non arriva un segnale da processare.

## Passo 5 — Gli slot della finestra

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

Nota `onButtonClicked()`: disabilita il bottone prima di emettere la richiesta. Non è decorazione — è la prima difesa contro un problema reale: senza questa riga, un click ripetuto mentre il calcolo precedente è ancora in corso emetterebbe una seconda `requestComputation()`, che Qt metterebbe comunque in coda in modo sicuro (niente crash), ma che farebbe eseguire `start()` una seconda volta in sequenza sullo stesso worker, sommando lavoro a lavoro invece di rifiutarlo o sostituirlo. Gestire "cosa succede se l'utente chiede un nuovo lavoro mentre uno è in corso" con una vera cancellazione è materia di un modulo successivo; oggi ci limitiamo, correttamente, a impedire il problema alla radice disabilitando il bottone.

## Passo 6 — Il distruttore: lo spegnimento pulito

```cpp
MainWindow::~MainWindow() {
    m_thread->quit();
    m_thread->wait();
    delete m_worker;
}
```

Tre righe che valgono l'intero discorso sul ciclo di vita fatto nell'articolo precedente: chiedi all'event loop del thread gestito di fermarsi, aspetti che l'abbia fatto davvero, e solo a quel punto distruggi il worker con una `delete` ordinaria — sicura, perché dopo `wait()` nessun altro thread può più toccarlo.

## Passo 7 — Compila, esegui, e osserva quello che NON succede più

```bash
cmake -S . -B build
cmake --build build
./build/worker_thread_demo
```

Premi il bottone. Osserva la barra di progresso avanzare a scatti (i segnali `progress` che arrivano dal worker) mentre, contemporaneamente, il battito in alto continua a salire senza la minima esitazione — non un'interruzione, non un rallentamento percettibile, nulla. Prova anche a ridimensionare o spostare la finestra mentre il calcolo è in corso: risponde normalmente, cosa impensabile nel progetto precedente durante lo stesso identico calcolo.

Se vuoi vedere il contrasto in modo ancora più netto, tieni aperti entrambi i progetti ed esegui lo stesso identico numero di primi da cercare in entrambi, uno dopo l'altro: la differenza non è nella durata del calcolo — che è identica, perché la CPU deve comunque fare lo stesso lavoro — ma nella *reattività della finestra* durante quel tempo. Qui non abbiamo velocizzato nulla (un solo thread di calcolo, esattamente come prima), abbiamo solo spostato quel calcolo fuori dalla strada dell'event loop che deve occuparsi della finestra.

## Cosa hai appena dimostrato a te stesso

Hai costruito, con le tue mani e capendo ogni riga, il pattern che risolve strutturalmente il problema con cui questo corso si è aperto. Hai visto la differenza pratica tra l'oggetto `QThread` e il thread che gestisce, hai spostato un worker con `moveToThread()` e verificato che i suoi slot eseguono davvero dove ti aspetti, hai comunicato in entrambe le direzioni attraverso segnali senza scrivere un solo mutex, e hai gestito uno spegnimento pulito senza perdite. Nel prossimo modulo introduciamo `QMutex` e i suoi parenti — perché il giorno in cui il tuo worker dovrà condividere dati mutabili con altri thread contemporaneamente (non solo scambiare messaggi via segnali, che oggi ti ha tenuto al riparo da ogni sezione critica), avrai bisogno di quegli strumenti.

---

*Il codice sorgente completo di questo progetto è disponibile nella repository che accompagna questo corso, nella cartella `project-C-worker-thread`.*
