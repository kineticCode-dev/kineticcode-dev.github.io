---
title: "Capstone: pool di elaborazione persistente e cancellazione cooperativa completa"
description: "Multithreading in C++ con Qt — Modulo 6 (Capstone)"
---

Tutto il codice sorgente lo puoi trovare [qui](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone: pool di elaborazione persistente e cancellazione cooperativa completa

Nell'articolo precedente hai visto i primi due stadi della pipeline capstone: un worker di cattura persistente (Modulo 1) che produce frame in un buffer limitato (Modulo 2), con la contropressione come scelta deliberata. Questo articolo affronta gli stadi 3 e 4: come elaborare quei frame in parallelo, e — la parte più difficile dell'intero corso — come fermare correttamente una pipeline in cui più stadi concorrenti possono essere addormentati in punti diversi nello stesso istante.

## Stadio 3: elaborazione parallela, e perché qui QThreadPool batte QtConcurrent

**Obiettivo.** Applicare a ogni frame un filtro CPU-bound reale — nel Progetto H, un rilevatore di bordi in stile Sobel — distribuendo il lavoro su più thread, così che il tempo totale di elaborazione scali con il numero di core disponibili.

### La decisione di design che conta: pool persistente contro batch finito

Il Modulo 3 ti ha insegnato `QtConcurrent::mapped`: dai una collezione, dai una funzione, ottieni un `QFuture` che ti consegna i risultati con un progresso osservabile via `QFutureWatcher`. È lo strumento giusto ogni volta che il tuo problema ha la forma "ho *N* elementi, tutti già disponibili, e voglio elaborarli tutti". Il Progetto H, però, **non ha questa forma**: i frame arrivano uno alla volta, a un ritmo che non conosci in anticipo, per un tempo che potrebbe non avere un termine fisso (una vera telecamera non ti dice mai in anticipo "sono l'ultimo frame"). `QtConcurrent::mapped` ha bisogno di conoscere la collezione completa prima di partire — non è pensato per un flusso continuo che cresce mentre lo consumi.

La soluzione adottata è un pool di **task persistenti**: non un `QRunnable` per frame (che pagherebbe il costo di creare e schedulare un nuovo oggetto per ogni singolo frame, un overhead che con frame che arrivano ogni 90 millisecondi conta), ma un numero fisso di `FrameWorkerTask` — tipicamente 2, configurabile dall'utente nella GUI — ciascuno dei quali resta in esecuzione **per l'intera durata della pipeline**, prelevando frame dal buffer uno dopo l'altro in un proprio ciclo interno:

```cpp
void FrameWorkerTask::run() {
    QImage frame;
    int frameNumber = -1;

    while (m_buffer->consume(frame, frameNumber)) {
        // ... process, measure, emit signals ...
        if (m_flag->requested()) break;
    }
}
```

Ogni `FrameWorkerTask` eredita sia da `QObject` (per poter emettere segnali verso la GUI) sia da `QRunnable` (per essere schedulabile da `QThreadPool::start()`) — una doppia eredità che nel Modulo 5 non hai ancora avuto motivo di usare, perché lì i tuoi `QRunnable` erano puramente computazionali, senza bisogno di comunicare risultati via segnali.

**Insidia — la taglia del pool deve essere fissata *prima* di avviare i task, non dopo.** `QThreadPool::setMaxThreadCount(N)` va chiamato prima di `start()`, e con task persistenti la sequenza sbagliata non è solo subottimale, è potenzialmente uno stallo silenzioso: se avvii `N` task ma il pool ha spazio per meno di `N` thread contemporanei, i task in eccesso restano in coda interna al pool, in attesa che uno dei task già in esecuzione finisca — cosa che, per un task che loop finché il buffer non si chiude, non succede fino alla fine della pipeline. Il risultato è un pool che sembra "avviato" ma in cui solo una parte dei worker sta davvero consumando dal buffer, con throughput ridotto e nessun messaggio d'errore a segnalarlo.

**Quando scegliere l'uno o l'altro, nel tuo lavoro reale.** Se il tuo problema è "ho un batch di 200 immagini già su disco, elaborale tutte e dimmi quando hai finito", `QtConcurrent::mapped` con un `QFutureWatcher` resta la scelta più semplice e più leggibile — non reinventarla con un pool persistente solo perché l'hai vista qui. Se il tuo problema è "un flusso continuo di dati in arrivo, di durata non nota, che deve essere elaborato con un ritardo minimo mentre continua ad arrivare", il pattern del Progetto H — pool persistente che preleva da un buffer condiviso — è la forma naturale del problema.

## Stadio 4: cancellazione cooperativa completa — la parte più difficile del corso

Se c'è un solo passaggio di questo modulo su cui vale la pena rileggere due volte ogni frase, è questo. Fermare correttamente **un** worker, come nel Modulo 4, richiede disciplina ma è concettualmente semplice: un flag, un ciclo che lo controlla, un `quit()` + `wait()` finale. Fermare **una pipeline con tre stadi concorrenti che si passano dati attraverso un buffer bloccante** è un problema qualitativamente diverso, perché ora esistono più modi in cui un thread può essere "occupato" nel momento esatto in cui arriva la richiesta di stop, e ognuno richiede che qualcun altro lo svegli fisicamente — un flag da solo non basta più.

### L'errore che una versione ingenua farebbe

Immagina di scrivere, di getto, questa sequenza di arresto:

```cpp
// NAIVE VERSION -- DO NOT DO THIS
void naiveShutdown() {
    m_flag.requestStop();        // (a)
    m_captureThread->quit();     // (b)
    m_captureThread->wait();     // (c)  <-- can hang here forever
    m_pool->waitForDone();       // (d)
}
```

Sembra ragionevole, ed è esattamente il tipo di codice che supererebbe una prova rapida fatta premendo Stop mentre la pipeline è scarica. Il problema emerge in un caso specifico ma tutt'altro che raro: se, nel momento in cui `naiveShutdown()` viene chiamata, il thread di cattura è bloccato *dentro* `m_buffer->produce()` perché il buffer è pieno — cioè esattamente lo scenario di contropressione dell'articolo precedente, comportamento **normale e atteso** della pipeline — allora il passo (a) non serve a nulla: `m_flag` è una variabile atomica, ma il thread di cattura non la sta guardando in questo momento, sta dormendo dentro `QWaitCondition::wait()`, che si sveglia solo per una `wakeOne()`/`wakeAll()` esplicita o per un risveglio spurio. Il passo (b) mette in coda una richiesta di uscita che il thread non potrà mai processare, perché non è nel suo event loop. Il passo (c), `wait()`, blocca allora **per sempre** — non è un rallentamento, è uno stallo (deadlock) vero e proprio.

### La sequenza corretta, passo per passo

![Full shutdown: the deadlock-free stop ordering](../../img/modulo-06/27-full-pipeline-shutdown.png)

Il passo che manca alla versione ingenua è `FrameBuffer::close()`, e la sua posizione nella sequenza non è negoziabile: deve venire **prima** di qualunque `wait()` bloccante su thread o pool, perché è l'unico dei quattro passi che **sveglia fisicamente** chi è addormentato in una `QWaitCondition` — esattamente la stessa identica lezione del Modulo 2, qui applicata a tre stadi concorrenti invece di due:

```cpp
void MainWindow::startShutdownSequence(const QString &reason, bool earlyCancellation) {
    if (m_stopInProgress || !m_running) return;
    m_stopInProgress = true;

    if (earlyCancellation) {
        m_flag.requestStop();    // stop producing NEW frames
    }
    m_buffer->close();           // WAKES anyone blocked in wait() -- the step that matters

    // wait for real termination, but NEVER on the GUI thread (see below)
    QThread *captureThread = m_captureThread;
    QThreadPool *pool = m_pool;
    QFuture<void> future = QtConcurrent::run([captureThread, pool]() {
        captureThread->quit();
        captureThread->wait();
        pool->waitForDone();
    });
    // ... QFutureWatcher signals onPipelineFullyStopped() when done ...
}
```

Con `close()` chiamato prima, il thread di cattura bloccato in `produce()` si risveglia immediatamente (`m_notFull.wakeAll()` dentro `close()`), vede `m_closed == true`, e `produce()` ritorna `false` — la sua `start()` esce dal ciclo e ritorna, il thread torna al proprio event loop, ed è solo a questo punto che il `quit()` accodato in precedenza ha effetto reale. Lo stesso vale, specularmente, per ogni `FrameWorkerTask` eventualmente bloccato in `consume()` su buffer vuoto.

### Perché l'attesa finale non può stare sul thread GUI

C'è una seconda insidia, meno drammatica di uno stallo ma non meno importante: sia `QThread::wait()` sia `QThreadPool::waitForDone()` sono chiamate **bloccanti**. Anche una volta risolto il problema dello stallo con `close()`, chiamarle direttamente dallo slot collegato al bottone Stop bloccherebbe il thread della GUI per tutta la durata del drenaggio — che, con worker ancora a metà di un frame da 200 millisecondi, può essere percepibile. È la stessa identica lezione del Modulo 0, il primissimo capitolo di tutto il corso ("mai bloccare il thread della GUI"), che qui torna a scala di intera pipeline: la soluzione è spostare l'attesa fuori dal thread GUI con `QtConcurrent::run()` (Modulo 3, usato qui per un compito diverso da quello per cui l'avevi imparato — non elaborare dati, ma *aspettare* che altri thread finiscano) e un `QFutureWatcher` che richiama `onPipelineFullyStopped()` quando il drenaggio è davvero concluso, con una connessione queued verso il thread GUI (Modulo 4).

### Arresto anticipato contro arresto naturale: non sono la stessa cosa

Un'ultima distinzione, sottile ma reale: quando l'utente preme Stop a metà pipeline, il flag cooperativo viene alzato, e ogni `FrameWorkerTask` lo controlla dopo aver finito il frame che ha in mano — smette cioè di prelevarne altri, anche se il buffer ne contiene ancora. È una scelta di responsività: l'utente ha chiesto di fermarsi *ora*, non "quando avrai finito tutto il lavoro già in coda". Quando invece la cattura termina da sola perché ha raggiunto il numero di frame richiesto, non c'è nessuna urgenza analoga: il flag **non** viene alzato, e i worker continuano a drenare `consume()` finché il buffer non è davvero vuoto — ogni frame catturato viene garantito arrivare a elaborazione. Due percorsi di arresto, stessa sequenza `close()` → attesa asincrona → notifica, ma una sola differenza deliberata, ed è la differenza tra "fermati subito" e "finisci quello che hai iniziato": nel lavoro su sistemi di visione, è quasi sempre una distinzione che l'operatore della macchina si aspetta di poter controllare, non un dettaglio implementativo.

Con l'elaborazione parallela e la cancellazione cooperativa completa ora chiare, l'ultimo articolo di questo modulo — e del corso — cammina attraverso l'integrazione GUI e il progetto guidato completo: come costruirlo, come compilarlo, e cosa osservare quando lo esegui davvero.
