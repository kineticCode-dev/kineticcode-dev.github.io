---
title: "Progetto: ciclo di vita completo di un worker — avvia, pausa, riprendi, ferma"
description: "Multithreading in C++ con Qt — Modulo 4 — Progetto"
---

# Progetto: ciclo di vita completo di un worker — avvia, pausa, riprendi, ferma

Costruiamo un'applicazione Qt Widgets con un worker persistente — lo stesso pattern `moveToThread()` che conosci dal Modulo 1 — che esegue un'elaborazione a passi (200 passi, ciascuno con un piccolo calcolo CPU-bound seguito da una breve pausa configurabile), pilotabile con quattro comandi dalla finestra: **Start**, **Pause**, **Resume**, **Stop**. In più, due controlli dedicati dimostrano `QMetaObject::invokeMethod` nelle sue due varianti principali: una per cambiare a caldo la velocità di esecuzione, una per interrogare sincronamente il passo corrente.

**Requisiti**: Qt 6 con il componente **Widgets**, nessuna dipendenza aggiuntiva rispetto ai moduli precedenti.

## Passo 1 — Lo scheletro del progetto

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

Nessuna sorpresa qui: è la stessa forma di sempre. La sostanza di oggi è tutta nell'architettura interna di `CyclicWorker`.

## Passo 2 — Il worker: la dichiarazione, e una distinzione che conta più di ogni altra riga di questo progetto

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

Fermati sulla divisione tra `pause()`/`resume()`/`stop()`, dichiarati come metodi pubblici ordinari, e `start()`, l'unico dichiarato `public slots`. Non è un capriccio stilistico: è la lezione più importante di questo intero progetto, e per raccontartela bene devo prima mostrarti l'errore che ho fatto costruendolo.

### La versione sbagliata che ho scritto per prima (e il deadlock che ne è seguito)

La mia prima bozza collegava pausa, ripresa e stop esattamente come ti aspetteresti dai Moduli 1 e 2 — tre segnali nella finestra, connessi via `connect()` a tre slot del worker:

```cpp
//--- WRONG VERSION, do not use it ---
connect(this, &MainWindow::requestPause, m_worker, &CyclicWorker::pause);
connect(this, &MainWindow::requestResume, m_worker, &CyclicWorker::resume);
connect(this, &MainWindow::requestStop, m_worker, &CyclicWorker::stop);
```

Compilava senza errori. Eseguiva la sequenza Start → Pause → Resume senza problemi apparenti. Ma nel momento in cui il mio test automatizzato premeva "Pause" e poi, con il worker ancora addormentato, premeva "Stop", l'intera applicazione si bloccava per sempre — nessun crash, nessun messaggio, semplicemente ferma, esattamente il sintomo silenzioso di un deadlock che il Modulo 2 ti ha insegnato a riconoscere.

La causa, una volta trovata, è lampante — ed è un corollario diretto dei due articoli precedenti di questo modulo messi insieme: mentre il worker è in pausa, la sua `start()` è bloccata dentro `m_pauseCondition.wait(&m_mutex)`. Quella chiamata **non è un giro dell'event loop**: è un blocco a livello di sistema operativo, il thread è letteralmente sospeso lì, non sta eseguendo `exec()`, non sta processando nessuna coda eventi. Un segnale `requestStop()` connesso con una `QueuedConnection` (automatica, perché mittente e destinatario sono su thread diversi) deposita fedelmente il proprio evento nella coda del worker — ma nessuno verrà mai a leggerlo, perché il thread che dovrebbe farlo è fermo dentro una `wait()` che nessuno, a sua volta, sveglia. È la stessa identica famiglia di problema della trappola di `deleteLater()` che hai visto nel Modulo 1: un evento depositato in una coda che nessuno processerà mai, perché il suo thread proprietario non sta girando.

### La correzione: chiamate dirette, come per il buffer condiviso del Modulo 2

La soluzione, con il senno di poi, era già scritta nel Modulo 2, solo che non l'avevo riconosciuta come applicabile anche qui. Ricordi i metodi di produzione, consumo e chiusura del buffer condiviso? Non erano slot: erano metodi pubblici ordinari, chiamati **direttamente** da thread diversi, sicuri non perché passassero dalla meta-macchina di segnali e slot, ma perché ogni riga che toccavano era già protetta dal proprio `QMutex` interno. La stessa identica logica si applica a `pause()`, `resume()` e `stop()` di oggi: sono sicure da chiamare direttamente dal thread GUI, su un oggetto che vive su un altro thread, perché l'unica cosa che toccano è stato protetto da `m_mutex` o atomico (`m_stop`) — non hanno bisogno dell'event loop del worker per essere eseguite in sicurezza, e proprio per questo **funzionano anche quando quell'event loop non sta girando**, come durante la pausa.

`start()`, al contrario, deve restare uno slot raggiunto tramite `connect()` — perché a differenza di pause/resume/stop, lei **deve davvero eseguire sul thread gestito dal QThread**, non su quello del chiamante: è l'intero corpo del lavoro del worker, non solo un cambio di flag. Una chiamata diretta a `m_worker->start()` dal thread GUI eseguirebbe l'intero ciclo di 200 passi **sul thread GUI stesso** — esattamente il freeze che il Modulo 1 ti ha insegnato a curare fin dal primo giorno.

## Passo 3 — Il worker: start(), pause(), resume(), stop()

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

Il corpo del ciclo dovrebbe ormai esserti familiare: il controllo del flag di stop in cima, il blocco di pausa con `while` e `wait()`, un piccolo calcolo CPU-bound che rappresenta il "lavoro vero" di ogni passo, e l'emissione del progresso. L'ultima riga, `QCoreApplication::processEvents()`, la spieghiamo subito nel prossimo passo.

Guarda `stop()` con attenzione, perché è l'applicazione diretta della lezione del Modulo 2 al problema di oggi: scrivere `m_stop.store(true)` da solo risolverebbe il caso in cui il worker è **attivo**, dentro il proprio ciclo di lavoro — al prossimo controllo del flag, uscirebbe pulito. Ma se il worker in quel momento è **addormentato dentro `wait()`** perché in pausa, quella sola scrittura non lo raggiunge: continuerebbe a dormire per sempre, perché nessuno l'ha svegliato per fargli ricontrollare qualunque cosa, flag di stop incluso. `stop()` quindi non si limita a scrivere il flag: forza anche `m_paused` a `false` e chiama `wakeAll()` — svegliando chiunque fosse in attesa, che a quel punto ricontrollerà la condizione del proprio `while`, vedrà `m_stop` a `true`, e uscirà pulito dal ciclo di attesa prima ancora di rientrare nel corpo del lavoro.

## Passo 4 — setInterval() e currentStep(): la demo di invokeMethod, e perché serve processEvents()

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

Nulla di sorprendente nell'implementazione: due metodi `Q_INVOKABLE`, protetti dallo stesso mutex del resto dello stato. Il punto interessante è in **come** la finestra li chiamerà tra poco — con `QMetaObject::invokeMethod`, non con un `connect()`. E questo ci riporta a quella riga isolata alla fine del ciclo di `start()`, `QCoreApplication::processEvents()`.

Sia `Qt::QueuedConnection` sia `Qt::BlockingQueuedConnection` per `invokeMethod` funzionano depositando un evento nella coda del thread destinatario, e quell'evento viene eseguito solo quando l'event loop di quel thread arriva a processarlo. Ma `start()` è **essa stessa** un singolo, lungo slot che occupa il thread del worker dall'inizio alla fine del ciclo — mentre gira, quel thread **non sta eseguendo `exec()`** nel senso in cui lo intendi di solito: sta eseguendo il corpo di `start()`, che a sua volta è stata invocata *da* un evento processato dall'event loop. Finché `start()` non ritorna, l'event loop del worker non torna al proprio ciclo di ricezione — il che significa che qualunque nuovo evento arrivi nel frattempo (una chiamata `invokeMethod` verso `setInterval()` o `currentStep()`, per esempio) resterebbe in coda, non processato, fino al termine dei 200 passi. Per una `Qt::QueuedConnection` questo sarebbe solo un ritardo fastidioso; per una `Qt::BlockingQueuedConnection` sarebbe un **blocco della GUI per l'intera durata del ciclo** — esattamente il tipo di freeze che questo intero corso ti ha insegnato a evitare, ma questa volta causato non da un calcolo pesante diretto sulla GUI, bensì da un dettaglio più sottile sull'event loop del worker.

`QCoreApplication::processEvents()`, chiamata una volta per passo, è il rimedio: "pompa" manualmente la coda eventi del thread corrente, dando una finestra di opportunità a qualunque evento in attesa — inclusi gli `invokeMethod` verso questo stesso oggetto — di essere processato prima di procedere al passo successivo. È una tecnica documentata e legittima per slot lunghi che devono restare parzialmente reattivi, ma vale la pena essere onesti sui suoi limiti: **non aiuta affatto durante la pausa**. Dentro `wait()`, il thread è bloccato a livello di sistema operativo, non sta eseguendo nessun codice Qt — non c'è nessun punto in cui `processEvents()` potrebbe essere chiamata, perché il controllo non è nelle mani del tuo codice in quell'istante. Ed è esattamente per questo motivo — non per simmetria stilistica — che `pause()`, `resume()` e `stop()` restano chiamate dirette: sono l'unico meccanismo che raggiunge il worker in **ogni** suo stato, pausa inclusa, mentre `invokeMethod` verso questo worker funziona solo perché abbiamo deliberatamente aperto una finestra per lui dentro il ciclo attivo.

## Passo 5 — L'header della finestra

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

Nota che c'è un solo segnale, `requestStart()` — coerente con tutto quello che hai appena visto nel Passo 2: è l'unico comando che ha davvero bisogno di passare dall'event loop, perché è l'unico che deve far eseguire codice **sul thread del worker** invece che modificare solo il suo stato interno.

## Passo 6 — Il costruttore: mettere in piedi il worker, senza avviarlo subito

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

Nota una differenza deliberata rispetto ai Moduli 1 e 2: qui **non** colleghiamo `QThread::started` direttamente a `start()`. Il worker, una volta avviato il thread, resta inattivo — il suo event loop è comunque già attivo e pronto a ricevere comandi (comprese le chiamate dirette a `pause()`/`resume()`/`stop()`, che come sai non ne hanno nemmeno bisogno) — finché l'utente non preme davvero il bottone "Start". È lo stato "Idle" del diagramma qui sotto, quello prima di qualunque lavoro.

## Passo 7 — Gli slot della finestra, incluse le due dimostrazioni di invokeMethod

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

E finalmente le due dimostrazioni promesse fin dall'introduzione del modulo:

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

Il primo è fire-and-forget: il thread GUI posta il comando e prosegue subito, senza aspettare conferma — perfetto per un cambiamento di configurazione che non ha bisogno di essere sincrono. Il secondo, invece, usa `Qt::BlockingQueuedConnection` con `Q_RETURN_ARG`: il thread GUI si ferma davvero finché `currentStep()` non ha eseguito sul thread del worker e non ha restituito un valore — che possiamo quindi mostrare immediatamente nell'etichetta, con la certezza che sia il dato vero di quell'istante, non uno stantio. Entrambe funzionano senza freeze percepibile della GUI grazie al `QCoreApplication::processEvents()` inserito nel ciclo di `start()` al Passo 4, che dà al worker, tra un passo e l'altro, l'occasione di processare esattamente questi due comandi.

## Passo 8 — Il distruttore: la stessa disciplina del Modulo 2, applicata qui

```cpp
MainWindow::~MainWindow() {
    m_worker->stop();   // direct call: reaches the worker even while paused

    m_thread->quit();
    m_thread->wait();

    delete m_worker;
}
```

Tre righe, ma ciascuna fa un lavoro preciso, ed è lo stesso ordine già visto nel progetto guidato del Modulo 2: prima ci assicuriamo che il worker non possa restare mai addormentato in attesa (`stop()`, che come sai forza `m_paused` a `false` e chiama `wakeAll()` prima ancora di scrivere il flag di stop nella sua interezza), **poi** chiediamo al thread di fermarsi con `quit()`, **poi** aspettiamo con `wait()` che l'abbia fatto davvero. Se invertissi l'ordine — `quit()` prima di `stop()` — e il worker fosse in quel momento addormentato in pausa, il thread non avrebbe mai la possibilità di uscire dal proprio ciclo per raggiungere il punto in cui la richiesta di `quit()` viene effettivamente onorata, e `wait()` bloccherebbe la chiusura della finestra per sempre.

## Passo 9 — Compila, esegui, e osserva il ciclo di vita completo

```bash
cmake -S . -B build
cmake --build build
./build/worker_lifecycle_demo
```

Premi "Start": la barra di progresso comincia ad avanzare, un passo alla volta, e l'etichetta di stato mostra "Running". Premi "Pause" a metà strada: l'avanzamento si ferma immediatamente, l'etichetta passa a "Paused" — e se osservi l'uso di CPU del processo mentre è in pausa, lo vedrai scendere quasi a zero, la prova diretta che il worker sta dormendo dentro `wait()` invece di ricontrollare il flag in un loop attivo che sprecherebbe un intero core per non fare nulla. Premi "Resume": l'avanzamento continua esattamente da dove si era fermato. Prova anche i due controlli di `invokeMethod`: cambia l'intervallo con lo spin box e premi "Applica" mentre il worker è in esecuzione — vedrai la velocità di avanzamento della barra cambiare dal passo successivo, prova che il comando è arrivato; premi "Interroga passo" e osserva che l'etichetta si aggiorna immediatamente con il passo esatto, letto in modo sincrono dal thread del worker. Infine premi "Stop" — prova a farlo sia mentre il worker è in esecuzione sia mentre è in pausa, per vedere con i tuoi occhi che in entrambi i casi la chiusura è pulita e immediata, mai un blocco. Chiudi la finestra: l'applicazione termina all'istante, qualunque fosse lo stato del worker in quel momento.

![Worker lifecycle diagram: which command triggers each transition, and how it reaches the worker](img/modulo-04/20-worker-lifecycle-start-pause-stop.png)

Il diagramma riassume l'intero percorso che hai appena costruito: ogni transizione è innescata da un click sulla GUI, ma il meccanismo con cui raggiunge il worker cambia a seconda di cosa serve — un segnale queued per `start()` (che deve eseguire sul thread giusto), chiamate dirette per pausa/ripresa/stop (che devono funzionare anche quando l'event loop del worker non sta girando).

## Cosa hai appena dimostrato a te stesso

Hai costruito un worker con un ciclo di vita completo e controllabile — non solo "parte e finisce da solo" come nei moduli precedenti, ma avviabile, mettibile in pausa, riprendibile e fermabile su richiesta, in ogni combinazione, senza mai un blocco. Hai visto, con un deadlock vero riprodotto e risolto, perché la scelta tra "connessione queued" e "chiamata diretta" non è una questione di stile ma dipende da un fatto preciso: se il thread destinatario ha in quel momento il proprio event loop libero di girare oppure no. Hai usato `QMetaObject::invokeMethod` in entrambe le sue varianti principali, capendo perché la variante bloccante avrebbe potuto congelare la tua GUI se non avessi capito — e risolto — il motivo per cui un singolo slot lungo può affamare l'event loop del proprio stesso thread.

Non è un caso che il deadlock raccontato in questo articolo sia nato proprio dal punto di incontro tra due concetti che sembravano già acquisiti — la queued connection del Modulo 1, la wait condition del Modulo 2 — applicati insieme in un contesto nuovo: è quasi sempre lì, all'intersezione tra due strumenti che conosci bene singolarmente, che si annidano i bug più istruttivi.

---

*Il codice sorgente completo di questo progetto è disponibile nella repository che accompagna questo corso, nella cartella `project-F-worker-lifecycle`.*
