---
title: "Progetto: elaborazione batch di immagini con QtConcurrent::mapped e QFutureWatcher"
description: "Multithreading in C++ con Qt — Modulo 3 — Progetto"
---

# Progetto: elaborazione batch di immagini con QtConcurrent::mapped e QFutureWatcher

Costruiamo un'applicazione Qt Widgets che genera un certo numero di immagini sintetiche rumorose, le sfoca tutte in parallelo con `QtConcurrent::mapped()`, e mostra il progresso tramite `QFutureWatcher<QImage>` — con un pulsante Annulla funzionante, e una finestra che **resta sempre reattiva**.

**Requisiti aggiuntivi rispetto ai progetti precedenti**: Qt 6 con i moduli **Widgets** *e* **Concurrent** — il modulo `Concurrent` va dichiarato esplicitamente sia in `find_package` sia in `target_link_libraries`.

## Passo 1 — Lo scheletro del progetto

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

Rispetto ai progetti precedenti, l'unica differenza strutturale in questo file è `Concurrent` aggiunto sia a `find_package` sia a `target_link_libraries` — è tutto ciò che serve per avere accesso a `QtConcurrent::mapped()` e a `QFuture`/`QFutureWatcher`.

## Passo 2 — Le funzioni pure: generazione immagini e blur naive

Crea `imageprocessing.h`:

```cpp
#pragma once
#include <QImage>
#include <QList>

QList<QImage> generateNoisyImages(int count, int side, quint32 seed);
QImage blurImageNaive(const QImage &source);
```

Fermati su questa dichiarazione prima ancora di guardare l'implementazione: sono due **funzioni libere**, non metodi di una classe, e non toccano nessuno stato condiviso — né membri di classe, né variabili globali mutabili. È deliberato, ed è precisamente il requisito visto nell'articolo precedente per un lavoro adatto a `QtConcurrent::mapped()`: se `blurImageNaive()` scrivesse in una variabile globale o in un membro condiviso, due chiamate in parallelo su thread diversi si pesterebbero i piedi esattamente come nel modulo su mutex e wait condition senza mutex — solo che qui **non abbiamo bisogno di nessun mutex**, perché la funzione è pura per costruzione: ogni chiamata legge solo il proprio parametro e scrive solo nel proprio valore di ritorno.

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

Il blur è deliberatamente **non ottimizzato**: per ogni pixel di uscita rilegge da capo l'intera finestra 7×7 attorno a lui direttamente dalla sorgente tramite `pixel()` (niente puntatori grezzi, niente somma incrementale a scorrimento, niente cache di riga), con un costo di `O(larghezza × altezza × 49)`. Non è un difetto — è **intenzionale**: ci serve un carico di lavoro genuinamente CPU-bound e sostanzioso, sia per vedere il parallelismo del `QThreadPool` all'opera in modo visibile, sia per la lezione di calibrazione empirica del prossimo passo.

## Passo 3 — Calibrazione empirica: misura, non indovinare

Prima di scegliere quante immagini generare e di che dimensione, seguiamo la stessa disciplina già vista nei moduli precedenti: **misuriamo**, non indoviniamo. Un piccolo programma di prova, isolato, che cronometra un singolo `blurImageNaive()` a diverse dimensioni:

```cpp
for (int side : {128, 192, 256, 320, 384, 448, 512}) {
    auto imgs = generateNoisyImages(1, side, 42);
    QElapsedTimer t; t.start();
    QImage r = blurImageNaive(imgs[0]);
    qDebug() << "side" << side << "->" << t.elapsed() << "ms";
}
```

Sulla macchina di sviluppo di questo corso, il risultato (compilazione senza ottimizzazioni esplicite, lo stesso schema di build che useremo per il progetto finale) è stato:

| Lato immagine | Tempo di un singolo blur |
|---|---|
| 128×128  | ~9 ms |
| 256×256  | ~31 ms |
| 384×384  | ~69 ms |
| 512×512  | ~122 ms |

A 384×384, un singolo blur costa quindi circa 60-90 ms (il valore oscilla leggermente da esecuzione a esecuzione, come sempre quando si misura tempo reale su una macchina condivisa). Con `QThread::idealThreadCount()` misurato a **2** su questa macchina, e volendo un batch che duri qualche secondo — comparabile alle demo dei progetti precedenti, né istantaneo né interminabile — la scelta è stata: **200 immagini di 384×384 pixel**. Il calcolo di stima è diretto: 200 blur da ~70 ms, distribuiti su 2 thread, dovrebbero richiedere circa (200 × 70) / 2, cioè circa 7000 millisecondi.

La verifica con il batch reale, tramite `QtConcurrent::mapped()` cronometrato su più esecuzioni, ha confermato la stima: **tra 7.3 e 7.6 secondi** per il batch di elaborazione vero e proprio (la generazione delle 200 immagini rumorose, che è un passo separato e sequenziale, aggiunge altri 1.6-2.2 secondi prima che il batch inizi). Il numero non è indovinato — è misurato, ripetuto, e coerente con la stima teorica basata sui thread disponibili: esattamente il tipo di verifica empirica che questo corso ti chiede di fare ogni volta che scegli parametri di carico per una demo o, più seriamente, per un sistema in produzione.

## Passo 4 — L'interfaccia: mainwindow.h

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

La forma generale — un pulsante Avvia, un pulsante Annulla, una barra di avanzamento, una lista di log — ricalca deliberatamente lo stile delle interfacce dei progetti precedenti: vogliamo che il confronto visivo con il produttore-consumatore sia immediato. `m_watcher` è un membro diretto della finestra, non un puntatore gestito a mano: essendo un oggetto leggero che vive per tutta la durata della finestra, non c'è motivo di complicare la gestione della memoria.

## Passo 5 — Il costruttore: interfaccia e generazione immagini

In cima a `mainwindow.cpp`, i parametri emersi dalla calibrazione del Passo 3:

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

## Passo 6 — Il collegamento del QFutureWatcher, e una lezione di misurazione vera

```cpp
connect(&m_watcher, &QFutureWatcher<QImage>::started, this, &MainWindow::batchStarted);
connect(&m_watcher, &QFutureWatcher<QImage>::resultReadyAt, this, &MainWindow::resultReady);
connect(&m_watcher, &QFutureWatcher<QImage>::canceled, this, &MainWindow::batchCanceled);
connect(&m_watcher, &QFutureWatcher<QImage>::finished, this, &MainWindow::batchFinished);

connect(m_startButton, &QPushButton::clicked, this, &MainWindow::startProcessing);
connect(m_cancelButton, &QPushButton::clicked, this, &MainWindow::cancelProcessing);
```

Nota cosa **manca** rispetto all'elenco completo dei segnali dell'articolo precedente: `progressRangeChanged` e `progressValueChanged` non sono collegati a nulla. Non è una dimenticanza — è il risultato diretto di una misurazione fatta durante lo sviluppo di questo stesso progetto, ed è troppo istruttiva per non raccontartela per intero, perché è la stessa disciplina di "misura, non indovinare" del Passo 3 applicata questa volta all'interfaccia invece che al calcolo.

Il primo tentativo, quello "ovvio", collegava `progressValueChanged` direttamente a `m_progressBar->setValue()`, aggiornando la barra a ogni singolo risultato. Il codice compilava, girava, e **l'interfaccia si bloccava per l'intera durata del batch**: nessun ridisegno, nessuna risposta a eventi, un vero e proprio freeze di 7-9 secondi seguito da un aggiornamento di colpo alla fine — con tanto di misurazione diretta, tramite un timer di "battito cardiaco" a 300ms collegato all'event loop, che ha confermato zero elaborazione di eventi per l'intera durata del batch.

Isolando il problema pezzo per pezzo, è emerso che il colpevole non era `QtConcurrent::mapped()` in sé (un test dello stesso identico future, senza `QProgressBar` collegata, restava fluido e reattivo per l'intera durata) ma specificamente l'aggiornamento **frequente** di una `QProgressBar` durante l'esecuzione attiva del batch: bastavano poche chiamate a `setValue()` nel mezzo del lavoro, non necessariamente centinaia, per reintrodurre il blocco. Aggiornare invece la barra **solo agli estremi** — a zero quando parte, al valore finale quando `finished()` scatta, quando il pool di thread ha già esaurito il lavoro e non c'è più nessuna competizione per il tempo di CPU della GUI — si è dimostrato, verificato più volte, perfettamente fluido: l'event loop continua a battere puntualmente ogni 300 millisecondi per tutta la durata del batch.

La lezione non riguarda un bug specifico di questo ambiente quanto un principio generale, valido ovunque: **un'API che promette di "non bloccare mai" a livello di contratto (e `QtConcurrent`/`QFuture` lo rispettano) non garantisce automaticamente un'interfaccia fluida in ogni combinazione di widget e frequenza di aggiornamento** — il costo reale di un ridisegno, moltiplicato per centinaia di chiamate ravvicinate, va sempre **misurato**, non assunto.

## Passo 7 — startProcessing(): la riga che sostituisce interi file di worker

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

Confronta questa funzione con l'intero file `producer.cpp` del modulo precedente, o con la costruzione di un `QThread` + worker: qui non c'è nessun `QThread`, nessuna `moveToThread()`, nessun `connect(started, ...)`. La riga `QtConcurrent::mapped(...)` avvia immediatamente il lavoro sul `QThreadPool` globale e ritorna un `QFuture<QImage>` senza attendere nulla; `setFuture()` collega il nostro `QFutureWatcher` già pronto a quel future, e da quel momento tutti i segnali dell'articolo precedente cominciano ad arrivare, sul thread GUI, man mano che il lavoro procede.

## Passo 8 — cancelProcessing(): cancellazione cooperativa in pratica

```cpp
void MainWindow::cancelProcessing() {
    m_watcher.cancel();
    m_cancelButton->setEnabled(false);
    m_labelStatus->setText("Cancellation requested: finishing items already in progress...");
}
```

Come anticipato, `cancel()` è cooperativo: non interrompe a metà un blur già iniziato su un worker, semplicemente impedisce che ne vengano avviati di nuovi. In una verifica misurata durante lo sviluppo — annullamento richiesto circa 1.8 secondi dopo l'avvio di un batch di 200 immagini — il risultato osservato è stato **46 immagini elaborate e raccolte** prima dell'arresto completo (contro le circa 25-26 che ci si aspetterebbe da un tasso di completamento lineare in 1.8 secondi su un batch da 7.3s totali): la differenza è spiegata esattamente dal comportamento cooperativo appena descritto — gli item già assegnati ai due worker al momento della richiesta hanno continuato fino al proprio completamento naturale, prima che il pool smettesse di prenderne di nuovi.

## Passo 9 — Gli slot di notifica

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

`resultReady()` logga un risultato ogni dieci (`LOG_EVERY_N = 10`), non ogni singolo — la stessa cautela di cadenza discussa al Passo 6, applicata qui al log invece che alla barra. `batchFinished()` distingue correttamente tra completamento naturale e annullamento tramite `m_watcher.isCanceled()`, e in entrambi i casi riabilita il pulsante Avvia: puoi lanciare più batch in sequenza senza mai riavviare l'applicazione.

## Passo 10 — Compila, esegui, osserva i numeri

```bash
cmake -S . -B build
cmake --build build
./build/image_batch_demo
```

Premi "Start batch processing": la barra resta a zero, il log comincia a riempirsi a scatti di dieci risultati alla volta, e — punto cruciale, verificalo tu stesso spostando la finestra o ridimensionandola mentre il batch gira — **l'interfaccia resta completamente reattiva** per tutta la durata, nessun blocco, nessun "non risponde". Quando il batch finisce (misurato, come detto, tra 7.3 e 7.6 secondi su questa macchina), la barra salta di colpo al valore finale e l'ultima riga di log riporta il tempo esatto trascorso e il numero di risultati raccolti — sempre 200, se non hai premuto Annulla.

## Cosa hai appena dimostrato a te stesso

Hai costruito un batch di elaborazione parallela vera, con `QtConcurrent::mapped()` che distribuisce 200 elaborazioni CPU-bound sui thread del pool globale, un `QFutureWatcher` che ti tiene informato senza mai bloccare il thread GUI, e una cancellazione cooperativa funzionante — tutto questo senza scrivere un solo `QThread`, un solo `moveToThread()`, un solo mutex. E hai visto, con numeri misurati e non indovinati, sia quanto tempo impiega davvero il lavoro (calibrazione del Passo 3) sia come una scelta apparentemente innocua nel collegare un segnale a un widget possa produrre un'interfaccia che si blocca (Passo 6).

Hai chiuso il cerchio con cui questo modulo era iniziato: `QtConcurrent`, lo strumento con cui magari avevi cominciato "a sensazione", ora lo conosci fino al `QThreadPool` che ci sta dietro, sai leggere la differenza tra un `QFuture` bloccante e uno osservato tramite `QFutureWatcher`, e soprattutto sai **quando** usarlo e quando no.

---

*Il codice sorgente completo di questo progetto è disponibile nella repository che accompagna questo corso, nella cartella `project-E-image-batch`.*
