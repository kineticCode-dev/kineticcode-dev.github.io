---
title: "QFuture, QFutureWatcher e la domanda che il vibe coding salta sempre"
description: "Multithreading in C++ con Qt — Modulo 3"
---

# QFuture, QFutureWatcher e la domanda che il vibe coding salta sempre

Nell'articolo precedente hai visto come lanciare lavoro parallelo con `QtConcurrent::run()` e la famiglia `mapped`/`filtered`/`reduced()`, e come il `QThreadPool` globale gestisce i thread dietro le quinte. Ogni funzione di `QtConcurrent` che hai visto finora (nella forma non-bloccante) restituisce un `QFuture<T>`. Vale la pena fermarsi a capire bene cos'è, perché è un concetto diverso da qualunque cosa vista nei moduli precedenti.

## QFuture: un handle al risultato, non il risultato

Un `QFuture<T>` **non è** il risultato — è un oggetto leggero e copiabile che rappresenta la *promessa* di un risultato che potrebbe non essere ancora pronto. Puoi interrogarlo in ogni momento:

```cpp
QFuture<QImage> future = QtConcurrent::mapped(images, blurImage);

future.isRunning();      // is the work still running?
future.isFinished();     // has it finished (successfully or canceled)?
future.isCanceled();     // was it canceled?
future.resultCount();    // how many results are ready right now?
```

E puoi, se vuoi, **aspettare** che finisca, con `waitForFinished()`:

```cpp
future.waitForFinished();
QList<QImage> results = future.results();
```

Fermati su questa riga, perché è esattamente il tipo di errore che questo corso ha cominciato a smontare fin dal primo progetto pratico. Ricordi la finestra che si congelava perché un calcolo lungo girava direttamente sullo slot di un pulsante, sul thread della GUI? `future.waitForFinished()` chiamato sul thread GUI produce **esattamente lo stesso sintomo**, per la stessa identica ragione: stai bloccando il thread che dovrebbe restare libero di processare eventi (ridisegni, click, tutto il resto) finché il lavoro sull'altro thread non è finito.

![Diagram of QFutureWatcher bridging QFuture signals to the GUI thread](img/modulo-03/14-qfuture-qfuturewatcher-bridge.png)

`waitForFinished()` ha un suo posto legittimo: su un thread che **non** è quello della GUI (per esempio dentro un altro job già eseguito su `QtConcurrent::run()`, o in uno script a riga di comando senza interfaccia), oppure quando sai per certo che il lavoro è già finito o finirà in un tempo trascurabile. Sul thread GUI, per un lavoro che dura più di qualche millisecondo, non va mai usato in questo modo diretto. La soluzione — quella che userai in tutto il progetto pratico di questo modulo — è **non aspettare mai**, e lasciare che sia Qt a "bussare" quando il risultato è pronto. Lo strumento che fa esattamente questo è `QFutureWatcher<T>`.

## QFutureWatcher: il future tradotto in segnali Qt

`QFutureWatcher<T>` fa da ponte tra il mondo dei `QFuture` (che di per sé non emette segnali) e il mondo di segnali e slot che conosci bene. Un `QFutureWatcher` "osserva" un `QFuture` tramite `setFuture()`, e traduce ogni evento interno del future in un segnale Qt normale, recapitato — tramite connessione queued, esattamente come i segnali del worker thread — sul thread a cui appartiene il watcher stesso (quasi sempre il thread GUI, se il watcher è stato creato lì).

```cpp
QFutureWatcher<QImage> *watcher = new QFutureWatcher<QImage>(this);

connect(watcher, &QFutureWatcher<QImage>::finished, this, [this, watcher]() {
    QList<QImage> results = watcher->future().results();
    // ... use the results, safely, on the GUI thread ...
});

QFuture<QImage> future = QtConcurrent::mapped(images, blurImage);
watcher->setFuture(future);   // the work has ALREADY started: setFuture() just observes it
```

Nessun `QThread`, nessuna `moveToThread()`, nessun mutex: il worker vero e proprio gira nel `QThreadPool` globale, il `QFutureWatcher` vive tranquillamente sul thread GUI, e il collegamento tra i due passa interamente per segnali che Qt consegna in coda — la stessa infrastruttura di consegna eventi che hai già imparato a fidarti.

`QFutureWatcher<T>` espone un set di segnali che ricalca, uno a uno, il tipo di notifiche che nel modulo su `QThread` dovevi costruirti a mano dentro il tuo worker:

- **`started()`** — emesso quando il future collegato inizia effettivamente l'esecuzione.
- **`finished()`** — emesso quando tutto il lavoro è concluso, sia che sia arrivato al termine naturale, sia che sia stato cancellato. È il punto in cui è sicuro chiamare `watcher->future().results()` per leggere tutti i risultati.
- **`canceled()`** — emesso (oltre a `finished()`, non al suo posto) quando il future è stato esplicitamente cancellato tramite `watcher->cancel()`.
- **`progressRangeChanged(int minimum, int maximum)`** e **`progressValueChanged(int value)`** — riportano l'avanzamento complessivo del lavoro.
- **`resultReadyAt(int index)`** (e la variante `resultsReadyAt(int beginIndex, int endIndex)` per un intervallo) — emesso ogni volta che un nuovo risultato diventa disponibile, indicando **quale** indice della collezione originale è pronto.

C'è un dettaglio che l'articolo precedente ha già anticipato per i risultati finali, e che vale ripetere qui per le *notifiche*: `resultReadyAt(index)` ti dice quale elemento è appena diventato disponibile, ma **non garantisce che gli indici arrivino in ordine crescente** — se due worker stanno lavorando in parallelo su elementi diversi, quello che finisce per primo notifica per primo, indipendentemente da quale dei due avesse l'indice più basso. Quello che resta sempre vero è che il `QFuture` sottostante conserva comunque i risultati nella posizione corretta — `resultAt(i)` (o `results()` nel suo insieme) è sempre nell'ordine originale, anche se le *notifiche* di "pronto" sono arrivate in un ordine diverso.

`watcher->cancel()` (equivalente a `watcher->future().cancel()`) richiede l'annullamento del lavoro rimanente — ma, esattamente come il flag cooperativo che vedrai formalizzato nel prossimo modulo, **non interrompe a metà** un elemento il cui calcolo è già partito su un worker: quell'elemento finisce comunque il suo singolo passo, semplicemente non ne vengono avviati di nuovi dopo la richiesta di cancellazione. `finished()` scatta comunque alla fine (insieme a `canceled()`), e `watcher->future().resultCount()` ti dice quanti risultati sono effettivamente stati raccolti prima dell'interruzione.

## QPromise: quando vuoi essere tu a produrre il future

Tutto quello che hai visto finora parte da un `QFuture` che `QtConcurrent` costruisce per te. C'è un caso, più avanzato e meno frequente nel lavoro quotidiano, in cui vuoi il rapporto inverso: scrivere tu stesso una funzione asincrona personalizzata che si comporta come quelle di `QtConcurrent` — restituisce un `QFuture`, supporta cancellazione e progresso — senza passare per `mapped`/`filtered`/`reduced`. Lo strumento, introdotto in Qt 6, è `QPromise<T>`.

```cpp
QFuture<int> processWithProgress(const QList<int> &data) {
    return QtConcurrent::run([data](QPromise<int> &promise) {
        promise.setProgressRange(0, data.size());
        int accumulator = 0;

        for (int i = 0; i < data.size(); ++i) {
            if (promise.isCanceled()) break;   // cooperative cancellation, as always

            accumulator += processSingleItem(data[i]);
            promise.setProgressValue(i + 1);
        }

        promise.addResult(accumulator);
    });
}
```

`QtConcurrent::run()` riconosce che la lambda accetta un `QPromise<int>&` come primo parametro, e ti passa un oggetto già collegato al `QFuture<int>` che la funzione restituisce: dentro la lambda controlli tu stesso il progresso (`setProgressValue`), la cancellazione cooperativa (`isCanceled()`, verificata a ogni iterazione — lo stesso pattern del `while` visto per le wait condition, applicato qui a un ciclo), e il risultato finale (`addResult`). Dall'esterno, chi chiama `processWithProgress()` riceve un `QFuture<int>` del tutto indistinguibile da quello di una `QtConcurrent::mapped()` — può collegarci un `QFutureWatcher` esattamente come hai appena imparato.

Non useremo `QPromise` nel progetto pratico di oggi — il nostro caso d'uso (blur di immagini) rientra perfettamente nel pattern `mapped()` già pronto — ma è uno strumento che vale la pena conoscere per nome: il giorno in cui dovrai avvolgere una libreria di terze parti bloccante (una SDK di una telecamera, per esempio, con la sua API sincrona) in qualcosa che si integri pulitamente nell'ecosistema `QFuture`/`QFutureWatcher`, `QPromise` è la strada giusta.

## Eccezioni attraverso QFuture

Un'ultima cosa da sapere prima del progetto pratico, perché è facile dimenticarsene e scoprirlo nel modo peggiore in produzione: cosa succede se la funzione che passi a `QtConcurrent::run()` o `mapped()` lancia un'eccezione C++? Non sparisce silenziosamente, e non fa crashare immediatamente il programma da un thread arbitrario del pool — Qt la **cattura** sul thread worker e la **ripropaga** quando qualcuno interroga il future per il risultato:

```cpp
QFuture<int> future = QtConcurrent::run([]() -> int {
    if (errorCondition()) throw std::runtime_error("invalid data");
    return 42;
});

try {
    int value = future.result();   // or after waitForFinished()
} catch (const std::exception &e) {
    qWarning() << "Exception from worker:" << e.what();
}
```

L'eccezione viene rilanciata nel punto in cui **leggi** il risultato (`result()`, `results()`, o il corrispondente accesso dopo `waitForFinished()`) — non nel punto in cui è stata lanciata originariamente. Se invece stai usando il pattern `QFutureWatcher` (quello del progetto pratico di oggi), il posto naturale per il `try`/`catch` è dentro lo slot collegato a `finished()`, proprio nel momento in cui accedi ai risultati.

## QtConcurrent o QThread manuale? La domanda che il vibe coding salta

Arriviamo al punto che chiude davvero il cerchio con cui hai iniziato questo modulo. `QtConcurrent` è comodo — comodo abbastanza da essere, storicamente, il primo strumento di multithreading Qt che molti sviluppatori incontrano, spesso senza sapere bene cosa scelgono di *non* usare nel farlo.

![Comparison diagram of QtConcurrent versus manual QThread usage](img/modulo-03/16-qtconcurrent-vs-manual-qthread.png)

La domanda giusta da farti, ogni volta, prima di scrivere una riga di codice concorrente in Qt, è **"il mio lavoro è una trasformazione stateless su una collezione di dati?"**

Se la risposta è sì — hai N elementi, applichi la stessa operazione a ciascuno, ogni elaborazione è indipendente dalle altre, non hai bisogno di coordinazione fine durante l'esecuzione, e quando è tutto finito ti bastano i risultati — allora `QtConcurrent::mapped`/`filtered`/`reduced` (o `run()` per un singolo job) è quasi sempre la scelta giusta. Ottieni parallelismo reale, gestione del pool di thread gratuita, niente mutex da scrivere, niente ciclo di vita di `QThread` da gestire a mano. È esattamente il progetto pratico di oggi.

Se invece il tuo lavoro ha una qualunque di queste caratteristiche, `QtConcurrent` diventa lo strumento sbagliato, non perché "non funzioni", ma perché ti costringe a forzare in una scatola stateless qualcosa che stateful lo è per natura:

Un **worker che vive a lungo e mantiene stato tra un'operazione e l'altra** — il Produttore e il Consumatore del modulo precedente non erano "trasformazioni su una collezione": erano oggetti con una vita propria, che continuavano a lavorare finché il programma non li fermava. Un **produttore-consumatore, pipeline con più stadi** — quando il risultato di uno stadio alimenta continuamente il successivo, e la coordinazione tra i due (pieno/vuoto, backpressure) è il cuore del problema, non un dettaglio. Il **bisogno di pausa, stop, cancellazione fine-grained durante l'esecuzione** (non solo "cancella tutto quello che rimane", come il `cancel()` cooperativo di `QFutureWatcher`, ma "sospendi ora, riprendi dopo, con un controllo preciso su dove ti trovi") — è esattamente l'argomento del prossimo modulo. E la **coordinazione tramite mutex/wait condition tra thread che devono davvero parlarsi durante il lavoro**, non solo scambiarsi un risultato finale.

In tutti questi casi, il pattern `QThread` + oggetto worker + `moveToThread()` + segnali/slot (con, se serve, `QMutex`/`QWaitCondition` per lo stato condiviso) che hai costruito nei moduli precedenti resta lo strumento corretto — non un ripiego "meno moderno". `QtConcurrent` non sostituisce quel pattern: lo *esonera* dai casi in cui sarebbe inutilmente pesante, cioè esattamente il caso della trasformazione dati che vedi oggi.

Tenere ferma questa distinzione — e saperla riconoscere in trenta secondi guardando un nuovo problema, invece di partire "a sensazione" verso lo strumento che conosci meglio — è precisamente la competenza che questo modulo voleva darti.

## Dalla teoria alle mani sulla tastiera

Hai ora tutto il vocabolario per usare `QtConcurrent` con cognizione di causa: `QFuture` come handle non bloccante, `QFutureWatcher` per le notifiche sicure sul thread GUI, `QPromise` per i casi avanzati, la gestione delle eccezioni, e — soprattutto — il criterio per decidere quando questo strumento è quello giusto e quando no. Nel prossimo articolo mettiamo tutto in pratica con un batch di elaborazione immagini reale, con una lezione di misurazione che vale da sola l'intero articolo.
