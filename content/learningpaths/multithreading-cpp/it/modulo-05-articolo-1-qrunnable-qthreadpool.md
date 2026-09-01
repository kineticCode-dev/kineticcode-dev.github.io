---
title: "QRunnable e QThreadPool: un pool di task, non un thread per compito"
description: "Multithreading in C++ con Qt — Modulo 5"
---

Tutto il codice sorgente lo puoi trovare [qui](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QRunnable e QThreadPool: un pool di task, non un thread per compito

Nel Modulo 2 hai imparato a proteggere memoria condivisa con `QMutex` e a coordinare thread con `QWaitCondition`. Tutto quel modulo poggiava su un'idea di fondo che vale la pena rendere esplicita ora: un mutex è uno strumento *generale*, che protegge qualunque cosa tu ci metta dentro, al prezzo di un meccanismo che, ogni volta che viene acquisito, coinvolge potenzialmente lo scheduler del sistema operativo — e rimettere in esecuzione un thread messo in attesa ha un costo reale, non gratuito, come hai visto nel Modulo 0 parlando di context switch.

Questo modulo parte da una domanda scomoda ma onesta: quel costo è sempre necessario? La risposta, come spesso capita in ingegneria, è "dipende" — e questo primo articolo affronta il livello più organizzativo del problema, prima di scendere, nel prossimo, al livello fisico della cache e del modello di memoria.

## Il problema che QThread persistente non risolve bene

Ripensa al pattern usato nei Moduli 1, 2 e 4: un `QThread` creato, un worker spostato su di esso con `moveToThread()`, un ciclo di vita gestito con cura (`start()`, `quit()`, `wait()`). È il pattern giusto quando il lavoro è *continuo* — un produttore che gira per tutta la vita del programma, un worker che elabora un flusso costante di frame video. Ma cosa succede se il tuo problema è diverso: hai cento immagini da elaborare *una volta*, in parallelo, e poi quel lavoro finisce? Creare cento `QThread`, uno per immagine, sarebbe assurdo — la creazione di un thread di sistema operativo ha un costo non trascurabile (allocazione dello stack, registrazione presso lo scheduler, tipicamente svariate decine di microsecondi anche su un sistema moderno), e cento thread che vivono per pochi millisecondi ciascuno spenderebbero una frazione enorme del loro tempo totale semplicemente a nascere e morire, non a lavorare.

La soluzione classica, vecchia quanto la programmazione concorrente stessa, è il **thread pool**: un numero fisso di thread worker, creati una volta sola all'avvio, che restano vivi e si mettono in coda a "tirare" (pull) il prossimo lavoro disponibile da una coda condivisa, invece di essere ricreati ogni volta.

![QRunnable + QThreadPool: queued tasks consumed by a fixed set of worker threads](modulo-05/21-qrunnable-qthreadpool.png)

## QRunnable: il task, non il thread

In Qt, un'unità di lavoro sottomessa a un pool si scrive sottoclassando `QRunnable` e sovrascrivendo un solo metodo, `run()`:

```cpp
class ImageProcessingTask : public QRunnable {
public:
    explicit ImageProcessingTask(int imageId) : m_imageId(imageId) {}

    void run() override {
        // the actual work, executed on one of the pool's threads
        processImage(m_imageId);
    }

private:
    int m_imageId;
};
```

Nota la differenza concettuale rispetto a un worker `QObject` spostato con `moveToThread()`: un `QRunnable` **non è** un `QObject`, non ha segnali propri, non ha thread affinity nel senso che conosci dal Modulo 1. È deliberatamente uno strumento più povero e più leggero: rappresenta *il lavoro da fare*, non *chi lo fa*. Il "chi" è deciso al volo dal pool, in base a quale thread worker si libera per primo — e potrebbe non essere sempre lo stesso thread da un'esecuzione all'altra, cosa che con un `QThread` persistente non avrebbe nemmeno senso chiedersi.

## Sottomettere il task: QThreadPool

```cpp
// Qt's shared global pool
QThreadPool *pool = QThreadPool::globalInstance();
pool->start(new ImageProcessingTask(imageId));
```

`QThreadPool::globalInstance()` restituisce un pool condiviso da tutta l'applicazione, dimensionato di default sul numero di core logici della macchina (`QThread::idealThreadCount()`) — la stessa metrica fisica di `std::thread::hardware_concurrency()` che rivedrai nel progetto guidato del prossimo articolo. Puoi anche costruire un `QThreadPool` tuo, indipendente, se vuoi isolare un certo tipo di lavoro dal resto (per esempio per non far competere l'elaborazione immagini in background con task più urgenti che passano dal pool globale):

```cpp
QThreadPool dedicatedPool;
dedicatedPool.setMaxThreadCount(4);
dedicatedPool.start(new ImageProcessingTask(imageId));
```

## Chi distrugge il QRunnable? setAutoDelete

Qui c'è un dettaglio di gestione della memoria che, se lo ignori, produce o un leak o un crash da doppia `delete`. Per default, `QRunnable::autoDelete()` è `true`: il pool, terminata la `run()`, distrugge da solo l'oggetto con `delete`. È per questo che nell'esempio sopra scriviamo `new ImageProcessingTask(...)` e non ce ne preoccupiamo più — il pool se ne fa carico. Se invece hai bisogno di riutilizzare lo stesso `QRunnable` più volte, o di tenerlo vivo dopo l'esecuzione per leggerne un risultato, devi disattivare questo comportamento esplicitamente **prima** di sottometterlo:

```cpp
ImageProcessingTask *task = new ImageProcessingTask(imageId);
task->setAutoDelete(false);
pool->start(task);
pool->waitForDone();      // wait for all submitted tasks to finish
delete task;              // the responsibility is yours again now
```

`waitForDone()` blocca il chiamante finché il pool non ha esaurito tutti i task in coda — utile in un contesto batch dove serve un punto di sincronizzazione netto, molto meno utile in un contesto reattivo dove vuoi che la GUI resti viva (in quel caso, come nel Modulo 3 con `QFutureWatcher`, preferirai un meccanismo a notifica invece di un'attesa bloccante).

## Il collegamento con QtConcurrent, ora reso esplicito

Nel Modulo 3 hai usato `QtConcurrent::run()` e `QtConcurrent::mapped()` senza mai vedere un `QRunnable` o un `QThreadPool` — ed è esattamente questo il punto: **non li vedevi perché Qt li crea per te, dietro le quinte**. Ogni chiamata a `QtConcurrent::run(funzione)` impacchetta internamente `funzione` in un `QRunnable` generato automaticamente e lo sottomette a `QThreadPool::globalInstance()` — lo stesso identico pool che hai appena imparato a usare a mano in questo articolo. `QtConcurrent::mapped()` fa lo stesso, moltiplicato per ogni elemento della sequenza da processare, con la sola aggiunta della logistica per raccogliere i risultati parziali in un `QFuture`. Non è un'implementazione simile, è **lo stesso motore**: quando scrivi `pool->start(new ImageProcessingTask(...))` stai facendo a mano, in modo esplicito, esattamente ciò che `QtConcurrent::run()` fa per te in modo implicito.

Sapere questo ti dice anche quando conviene scendere al livello di `QRunnable` diretto invece di restare su `QtConcurrent`: quando hai bisogno di priorità diverse tra task (`QThreadPool::start()` accetta un parametro di priorità opzionale), o di un pool dedicato separato da quello globale, o di un controllo più fine sul ciclo di vita del singolo task — tutte cose che l'interfaccia più comoda ma più opaca di `QtConcurrent` non espone.

Con `QRunnable` e `QThreadPool` inquadrati, e il loro legame con `QtConcurrent` finalmente esplicito, il prossimo articolo scende un livello più in basso: cosa garantisce davvero `std::atomic`, spiegato non come una lista di parole chiave da memorizzare, ma partendo da cosa succede fisicamente dentro un processore multi-core.
