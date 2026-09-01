---
title: "QtConcurrent::run, mapped/filtered/reduced, e il QThreadPool dietro le quinte"
description: "Multithreading in C++ con Qt — Modulo 3"
---

# QtConcurrent::run, mapped/filtered/reduced, e il QThreadPool dietro le quinte

Nei tre moduli precedenti hai costruito, pezzo per pezzo, il vocabolario e gli attrezzi con cui Qt gestisce il multithreading "manuale": `QThread`, `moveToThread`, segnali e slot per far comunicare i thread senza corromperne lo stato, e poi `QMutex`, `QWaitCondition`, `QReadWriteLock` per proteggere e coordinare dati davvero condivisi. È un percorso deliberatamente lento, perché ogni pezzo di quel vocabolario ti serve per capire *cosa succede sotto* quando le cose si complicano — un deadlock, un segnale che arriva sul thread sbagliato, un worker che non si ferma mai.

Oggi cambiamo completamente registro, e lo facciamo apposta nel punto del corso in cui puoi davvero apprezzare la differenza. Se il tuo primo contatto con il multithreading in Qt è stato tramite `QtConcurrent`, usato un po' "a sensazione" — copiare un esempio, farlo girare, andare avanti senza sapere bene perché funzionava — oggi chiudiamo quel cerchio: rivedrai esattamente gli stessi strumenti, ma questa volta sapendo con precisione cosa fa `QThreadPool` sotto il cofano, perché `QFuture` non blocca (a meno che tu non glielo chieda esplicitamente), e in che momento la comodità di `QtConcurrent` smette di essere la scelta giusta e torna a servire il pattern manuale dei moduli precedenti.

La domanda che guida tutto il modulo è semplice da enunciare e più sottile da applicare bene: **il lavoro che devo parallelizzare è una trasformazione indipendente applicata a tanti dati simili, oppure è uno stato che vive nel tempo e deve essere coordinato?** Il produttore-consumatore del modulo precedente era chiaramente nella seconda categoria — due thread persistenti, un buffer condiviso, coordinazione fine con wait condition. Oggi lavoriamo nella prima categoria, quella in cui `QtConcurrent` è stato progettato per brillare: hai una collezione di dati (nel tuo caso professionale, quasi sempre frame o immagini di un sistema di visione), e vuoi applicare la stessa operazione a ciascun elemento, il più in parallelo possibile, senza dover scrivere un solo `QThread` a mano.

## QtConcurrent::run(): una chiamata asincrona, senza cerimonie

Comincia dal caso più semplice possibile: hai una singola funzione che richiede un po' di tempo, e vuoi eseguirla su un altro thread senza bloccare chi la chiama. Nel modulo dedicato a `QThread` questo ti costava, come minimo: una classe worker derivata da `QObject`, uno slot che facesse il lavoro, un `QThread` dedicato, una `moveToThread()`, il collegamento `started` → slot, la gestione ordinata dello spegnimento nel distruttore. Cinque-sei righe di infrastruttura, per eseguire *una* funzione una volta sola.

`QtConcurrent::run()` fa la stessa cosa in una riga:

```cpp
QFuture<int> future = QtConcurrent::run([]() {
    // time-consuming work, executed on another thread
    QThread::msleep(500);
    return 42;
});
```

Quella riga fa tre cose insieme: prende la funzione (qui una lambda, ma può essere un puntatore a funzione libera, un metodo membro, o un funtore), la accoda su un thread preso in prestito da un magazzino di thread già pronti (il `QThreadPool` globale — l'argomento della prossima sezione), e ti restituisce immediatamente un `QFuture<int>`: un oggetto maneggevole che rappresenta "il risultato che arriverà", non il risultato stesso. La riga `QtConcurrent::run(...)` **non blocca**: ritorna subito, prima ancora che la lambda abbia iniziato a girare, esattamente come `m_thread->start()` non aspettava che il lavoro del worker thread finisse.

Il guadagno è evidente: zero classi nuove, zero gestione manuale del ciclo di vita di un `QThread`, zero rischio di dimenticare `quit()`+`wait()` nel distruttore. Per un lavoro "spara e dimentica" — o "spara e recupera il risultato più tardi" — è quasi sempre la scelta giusta.

Quello che hai perso è altrettanto importante da riconoscere subito, perché è il filo conduttore di tutto il modulo: **non hai più un oggetto persistente con cui parlare mentre il lavoro procede**. Il Produttore del modulo precedente viveva sul proprio thread per tutta la durata del programma, riceveva segnali, ne emetteva, poteva essere fermato in modo ordinato. Una chiamata a `QtConcurrent::run()` è, concettualmente, una funzione pura che parte, gira, e finisce — non un oggetto con cui interagisci nel mezzo. Se il tuo problema ha bisogno di quel tipo di interazione continua (pausa, cancellazione fine, notifiche di progresso granulari durante l'esecuzione), stai già intravedendo perché *non tutto* deve passare da `QtConcurrent` — ci torniamo con calma nel prossimo articolo.

## mapped, filtered, reduced: il parallelismo sui dati

`QtConcurrent::run()` esegue *una* funzione una volta. Il caso molto più comune nel tuo lavoro — elaborare N immagini di un'ispezione, N frame di una sequenza acquisita, N misure di un sensore — è applicare la *stessa* funzione a *ogni elemento* di una collezione, indipendentemente. Questo pattern ha un nome preciso nella letteratura del calcolo parallelo, **data parallelism** (parallelismo sui dati, per contrapposizione al *task parallelism* dove sono le operazioni diverse a girare in parallelo), ed è esattamente il caso che `QtConcurrent::mapped()` copre.

```cpp
QList<QImage> blurredImages = QtConcurrent::blockingMapped(originalImages, blurImage);
```

![Visual diagram of map, filter and reduce data-parallel operations](img/modulo-03/15-map-filter-reduce-visual.png)

`mapped()` prende una collezione (qui una `QList<QImage>`) e una funzione a un argomento (qui `blurImage`, che prende una `QImage` e ne restituisce una nuova), e applica quella funzione a *ogni* elemento, distribuendo il lavoro sui thread disponibili nel pool. Ogni elemento è elaborato **indipendentemente** dagli altri — nessuno stato condiviso, nessun mutex necessario, perché per definizione del problema due elaborazioni non si toccano mai. È precisamente la ragione per cui questo pattern si presta così bene al parallelismo: la sezione critica del modulo precedente esisteva perché più thread toccavano *lo stesso* dato; qui ogni worker tocca un elemento diverso, quindi la sezione critica semplicemente non esiste.

Un dettaglio che vale la pena mettere per iscritto perché è facile darlo per scontato nel modo sbagliato: i worker completano gli elementi **in qualunque ordine**, a seconda di quanto ciascuno impiega e di quale thread se lo aggiudica — ma la collezione di risultati che ottieni alla fine **preserva sempre l'ordine originale**. `result[i]` corrisponde sempre a `f(element[i])`, indipendentemente da quale worker l'abbia calcolato o in che ordine sia stato calcolato. Per il tuo lavoro con sequenze di frame è una garanzia preziosa: il frame numero 10 nella lista di risultati è sempre l'elaborazione del frame numero 10 di partenza, mai quella di un altro frame arrivato prima per puro accidente di scheduling.

Accanto a `mapped()`, `QtConcurrent` offre due varianti dello stesso schema generale. **`filtered()`** applica un predicato (una funzione che restituisce `bool`) a ogni elemento, e restituisce una nuova collezione contenente solo gli elementi per cui il predicato è vero — calcolato in parallelo, con l'ordine relativo degli elementi superstiti sempre preservato:

```cpp
QList<QImage> darkImagesOnly = QtConcurrent::blockingFiltered(images, [](const QImage &img) {
    return averageBrightness(img) < DARK_THRESHOLD;
});
```

**`reduced()`** combina tutti i risultati di una `mapped()` in un unico valore accumulato, tramite una funzione di combinazione associativa — la somma, il massimo, la concatenazione, qualunque operazione per cui l'ordine con cui combini le coppie non cambia il risultato finale:

```cpp
double totalBrightness = QtConcurrent::blockingMappedReduced(
    images,
    computeBrightness,                       // map: QImage -> double
    [](double &accumulator, double value) { accumulator += value; }  // reduce
);
```

Nota `mappedReduced`: è la fusione di map e reduce in un'unica passata, che evita di costruire e tenere in memoria l'intera collezione intermedia dei risultati mappati prima di combinarli — utile quando quella collezione intermedia sarebbe grande e non ti serve mai come tale, solo il valore finale accumulato.

Esiste anche una coppia di varianti in minuscolo, `QtConcurrent::map()` e `QtConcurrent::filter()` (da non confondere con `mapped`/`filtered`), che modificano la collezione **sul posto** invece di restituirne una nuova — utili quando non ti serve conservare i dati originali e vuoi risparmiare la memoria di una copia. Nel progetto pratico di questo modulo useremo la forma "non mutante" (`mapped`) perché vogliamo conservare sia le immagini originali sia quelle elaborate, per un confronto — ma sappi che l'alternativa esiste, ed è la scelta giusta quando l'unica cosa che ti interessa è il risultato finale in-place.

Avrai notato che gli esempi sopra usano `QtConcurrent::blockingMapped()`, non `QtConcurrent::mapped()`. La differenza è esattamente quello che il nome suggerisce: la versione `blocking*` esegue il lavoro in parallelo sugli altri thread ma **aspetta** (bloccando il thread chiamante) che tutto sia finito prima di restituire direttamente la collezione di risultati — comoda per uno script a riga di comando o per codice che gira già su un thread secondario, ma **da evitare sul thread GUI** per la stessa identica ragione che il prossimo articolo formalizza. La versione senza prefisso, `QtConcurrent::mapped()`, restituisce immediatamente un `QFuture<T>` senza aspettare nulla — ed è quella che useremo nel progetto pratico.

## Il QThreadPool globale: il magazzino di thread dietro le quinte

Ogni chiamata a `QtConcurrent::run()`, `mapped()`, `filtered()` o `reduced()` che hai visto finora non specifica mai esplicitamente *su quali thread* girare il lavoro. Non è magia: dietro c'è un `QThreadPool`, e per default è quello globale, condiviso da tutta l'applicazione, accessibile tramite `QThreadPool::globalInstance()`.

![Diagram of the implicit global QThreadPool shared by QtConcurrent operations](img/modulo-03/13-global-thread-pool.png)

Nel modello dei moduli precedenti, ogni job che volevi eseguire su un thread separato comportava la creazione di un `QThread` nuovo — un oggetto del sistema operativo, con un proprio stack, una propria identità, un costo di creazione e distruzione non trascurabile. Va benissimo per un worker che vive a lungo (il tuo Produttore o Consumatore, vivi per tutta la durata del programma), ma diventa uno spreco evidente se il "job" dura pochi millisecondi e ne arrivano centinaia: creeresti e distruggeresti centinaia di thread del sistema operativo, pagando ogni volta il costo pieno, per lavoro che nella migliore delle ipotesi occupa una piccola frazione di quel tempo.

Il `QThreadPool` risolve il problema mantenendo un numero fisso di thread **già creati e pronti**, e riciclandoli: quando accodi un job (tramite `QtConcurrent::run()` o uno degli algoritmi `mapped`/`filtered`/`reduced`), il pool lo assegna al primo thread worker libero; quando quel thread finisce, **non muore** — torna disponibile per il prossimo job in coda. Il costo di creazione del thread del sistema operativo lo paghi una volta sola, all'avvio, non a ogni singolo job.

La dimensione di default del pool è `QThread::idealThreadCount()` — tipicamente il numero di core logici disponibili sulla macchina (sulla macchina di sviluppo di questo corso, misurato con `qDebug() << QThread::idealThreadCount();`, il valore è **2**: lo vedrai citato più volte nel progetto pratico, perché è uno dei numeri che determina quanto tempo impiega davvero il nostro batch di immagini). L'idea è che, per lavoro genuinamente CPU-bound come il nostro blur, avere più thread attivi dei core fisici disponibili non aiuta — anzi introduce solo overhead di cambio di contesto — quindi il pool si dimensiona per sfruttare esattamente il parallelismo che l'hardware offre, né di più né di meno.

Puoi cambiare questa dimensione con `QThreadPool::globalInstance()->setMaxThreadCount(n)`, e puoi anche creare un tuo `QThreadPool` privato (passandolo come primo argomento a `QtConcurrent::run()`/`mapped()` in overload dedicati) se vuoi isolare un certo tipo di lavoro dal resto dell'applicazione — utile, per esempio, se hai un sottosistema a bassa priorità che non deve mai competere per i thread con l'elaborazione principale. Nel progetto pratico di oggi useremo sempre il pool globale di default: per un'applicazione con un solo tipo di lavoro CPU-bound come la nostra, non c'è motivo di complicare le cose con pool multipli.

Da qui in avanti, una regola semplice: se il tuo lavoro è **spezzabile in job brevi e numerosi**, lascia che sia il `QThreadPool` a gestirli — è letteralmente il problema per cui è stato progettato. Se invece hai bisogno di **un singolo worker che vive a lungo e mantiene stato tra un'operazione e l'altra** (di nuovo, il Produttore/Consumatore del modulo precedente), un `QThread` dedicato resta lo strumento giusto — non tutto deve passare dal pool globale.

## Cosa resta da capire

Sai ora come lanciare lavoro parallelo con `QtConcurrent::run()` e `mapped()`/`filtered()`/`reduced()`, e cosa succede dietro le quinte nel `QThreadPool` globale. Resta da capire come ottenere notifiche sul progresso senza mai bloccare il thread GUI — il ruolo di `QFuture` e soprattutto di `QFutureWatcher` — ed esattamente in quali casi tornare invece al pattern manuale dei moduli precedenti. È il tema del prossimo articolo.
