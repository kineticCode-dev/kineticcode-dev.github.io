---
title: "Progetto Capstone: pipeline di elaborazione frame in tempo quasi reale"
description: "Multithreading in C++ con Qt — Modulo 6 — Progetto finale"
---

Tutto il codice sorgente lo puoi trovare [qui](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Progetto Capstone: pipeline di elaborazione frame in tempo quasi reale

Negli articoli precedenti hai visto i quattro stadi "invisibili" della pipeline capstone: cattura (Modulo 1), buffer limitato con contropressione (Modulo 2), pool di elaborazione persistente (Modulo 5, confrontato con `QtConcurrent` del Modulo 3), e la sequenza di cancellazione cooperativa completa (Modulo 4). Questo articolo chiude il cerchio con il quinto stadio — l'integrazione GUI — e cammina attraverso il progetto guidato completo: come è composto, come si compila, e cosa osservare quando lo esegui davvero.

## Stadio 5: la GUI, il progresso, e gli errori che non fanno cadere nulla

**Obiettivo.** Una finestra che mostra, in tempo reale e senza mai bloccarsi, l'occupazione del buffer (la contropressione resa visibile), il conteggio di frame catturati/elaborati, e un log che distingue eventi normali da errori — restando sempre reattiva, anche sotto il carico più sostenuto che la pipeline può generare.

Ogni `FrameWorkerTask` emette uno di due segnali per ogni frame che gestisce, mai entrambi:

```cpp
try {
    QImage result = processFrame(frame, frameNumber);
    emit frameProcessed(m_workerId, frameNumber, timer.elapsed());
} catch (const std::exception &e) {
    emit frameError(m_workerId, frameNumber, QString::fromStdString(e.what()));
}
```

![Per-frame errors and progress, without ever bringing the pipeline down](modulo-06/28-error-handling-progress-signals.png)

Il Progetto H simula deliberatamente, ogni tredici frame, un "payload corrotto" — pensa a un frame realmente danneggiato da un errore di trasferimento su un bus reale, uno scenario tutt'altro che ipotetico in un sistema di acquisizione industriale — lanciando un'eccezione dentro `processFrame()`. Il `try`/`catch` che la circonda garantisce che **quel singolo frame** fallisca senza che il worker, il pool, o la pipeline nel suo complesso ne risentano: il ciclo di `run()` continua immediatamente con il frame successivo. È la stessa filosofia di robustezza che dovresti portare in qualunque pipeline di produzione: un frame perso non deve mai essere un motivo per fermare l'intera linea, deve essere un dato in più da registrare e, se serve, da indagare dopo.

**Insidia — dove va il conteggio degli errori.** Nella GUI, `onFrameError()` incrementa un contatore visibile separato da quello dei frame elaborati con successo, e scrive una voce colorata di rosso nel log — mai silenziosamente ignorata, mai mescolata al conteggio di successo in un unico numero che nasconderebbe il problema. È una scelta minuscola nel codice ma non nel design: un sistema che segnala "24 frame processati" quando in realtà 3 sono falliti silenziosamente è un sistema che mente, in un modo particolarmente pericoloso perché l'operatore non ha motivo di dubitarne.

**Perché è tutto sicuro senza un solo mutex nella GUI.** Ogni segnale emesso da `CaptureWorker` o da un `FrameWorkerTask` — che vivono, rispettivamente, sul thread di cattura e su un thread del pool — arriva a uno slot di `MainWindow`, che vive sul thread GUI. Qt confronta l'affinità di thread di mittente e destinatario al momento dell'emissione e sceglie automaticamente una connessione queued (Modulo 4): l'evento viene accodato nell'event loop del thread GUI e processato lì, uno alla volta, senza mai una scrittura concorrente sui widget. È lo stesso principio che il Modulo 1 ti ha mostrato con un solo worker, verificato oggi con quattro o più thread sorgente che convergono tutti sullo stesso thread di destinazione senza una sola riga di codice di sincronizzazione manuale scritta da te — a patto che tu non forzi mai una connessione `Direct` fra thread diversi.

## Setup & Prerequisiti

- Compilatore C++17 (verificato con GCC 13.3 su Linux).
- CMake ≥ 3.16.
- Qt 6, componenti **Widgets** e **Concurrent** (quest'ultima serve solo per `QtConcurrent::run()` usato nella sequenza di arresto asincrona — non per l'elaborazione dei frame, che resta su `QThreadPool` puro).
- Nessuna libreria di visione esterna: il filtro di rilevamento bordi è implementato da zero sui dati grezzi di un `QImage` in scala di grigi.

```bash
cd project-H-vision-pipeline-capstone
cmake -S . -B build
cmake --build build
./build/vision_pipeline_capstone
```

## La struttura dei file

Sei file sorgente più l'header condiviso del flag di cancellazione:

- `pipelinestate.h` — `CancellationFlag`, un sottile wrapper attorno a `std::atomic<bool>` con `requestStop()`/`requested()`/`reset()`.
- `framebuffer.h/.cpp` — lo Stadio 2: la coda limitata di `QImage`.
- `captureworker.h/.cpp` — lo Stadio 1: generazione dei frame sintetici.
- `frameworkertask.h/.cpp` — lo Stadio 3: il filtro Sobel e il ciclo persistente sul pool.
- `mainwindow.h/.cpp` — gli Stadi 4 e 5: orchestrazione, sequenza di arresto, widget.
- `main.cpp` — undici righe, nessuna sorpresa: crea `QApplication`, crea `MainWindow`, chiama `exec()`.

Nell'interfaccia trovi due controlli numerici — numero di frame da acquisire e numero di worker paralleli — pensati apposta perché tu possa riprodurre da solo l'esperimento della contropressione: abbassa il numero di worker a 1 e osserva il buffer riempirsi più rapidamente e restare pieno più a lungo; alzalo a 4 e osserva la contropressione quasi scomparire.

## Calibrazione empirica: misura, non indovinare

Il corso ti ha ripetuto in ogni modulo la stessa disciplina — misura prima di scegliere una costante, non tararla a intuito — e questo progetto non fa eccezione. Prima di fissare i numeri finali, il costo reale di una singola passata del filtro Sobel su un frame sintetico, misurato isolatamente:

| Dimensione frame | 1 passata | 3 passate | 5 passate |
|---|---|---|---|
| 128×96 | 0.05 ms | 0.15 ms | 0.25 ms |
| 256×192 | 0.20 ms | 0.65 ms | 1.25 ms |
| 1536×1152 | — | 28.8 ms | — |

Il dato interessante è quanto sia *veloce* un filtro Sobel scritto in modo diretto su un frame di dimensioni realistiche per un sensore economico: anche a 1536×1152 (oltre 1.7 megapixel), tre passate costano meno di 30 millisecondi. Un vero sistema di visione, però, raramente si ferma al solo edge detection: estrazione di feature, classificazione, tracking hanno un costo che qui non implementiamo (esulerebbe dallo scopo di un corso sulla concorrenza), ma che è onesto simulare esplicitamente, con lo stesso spirito con cui il Consumatore del Modulo 2 usava `QThread::msleep()` per rappresentare un tempo di elaborazione realistico. Il Progetto H usa frame a 256×192, tre passate Sobel reali (~0.65 ms, lavoro CPU-bound autentico e misurato) più un'attesa esplicita di 350-450 ms per rappresentare gli stadi successivi non implementati.

Con questi numeri, e un intervallo di cattura di 90 ms/frame, la produzione (≈11 frame/s) supera stabilmente la capacità di elaborazione aggregata di due worker (≈2 frame ogni ~400 ms ≈ 5 frame/s): la contropressione prevista dalla teoria si manifesta puntualmente, verificata sperimentalmente, non solo sulla carta.

## Verifica di esecuzione

Compilato con g++ 13.3 su Qt 6.4.2, eseguito headless (`QT_QPA_PLATFORM=offscreen`) con una copia istrumentata temporanea per pilotare la GUI senza un display reale:

- **Completamento naturale** (24 frame target, 2 worker): 24 catturati, 23 elaborati con successo, 1 fallito (il frame corrotto simulato #13, come atteso — un errore ogni 13 frame). Occupazione massima del buffer osservata: 5/5 — contropressione confermata visivamente. Nessun frame perso: `23 + 1 = 24`. Arresto completo in circa 5 secondi dall'avvio, nessun blocco, nessun crash, codice di uscita 0.
- **Stop anticipato** (Stop premuto a 900 ms dall'avvio, buffer già saturo): 9 frame catturati, 5 elaborati prima dell'arresto — il resto abbandonato per design (arresto responsivo). Nessun blocco, nessun crash, buffer mai osservato oltre la capacità configurata.
- **Doppio ciclo** (avvio → arresto naturale → riavvio → arresto naturale): comportamento identico e deterministico nei due cicli, nessuna perdita di risorse osservabile, nessuno stato residuo tra un ciclo e l'altro — la pipeline è riavviabile in sicurezza dalla stessa finestra.

In nessuna delle esecuzioni sono comparsi warning runtime di Qt.

## Dove andare da qui

Il Progetto H è, deliberatamente, un sistema giocattolo che si comporta come uno vero — e la distanza tra i due è più corta di quanto sembri. Alcune direzioni concrete per portarlo oltre:

**Sostituire la cattura simulata con una sorgente reale.** `CaptureWorker::generateSyntheticFrame()` è l'unico punto del programma che "finge": sostituiscilo con una chiamata a una libreria di acquisizione reale — un frame grabber industriale, una GenICam, o anche solo una webcam via `QCamera` — e il resto della pipeline, buffer, pool, cancellazione, GUI, non richiede nessuna modifica. È la prova pratica che disaccoppiare gli stadi con un'interfaccia netta paga esattamente in questo momento.

**Integrare OpenCV al posto del Sobel fatto a mano.** Il filtro scritto da zero in questo modulo serve a scopo didattico, ma in produzione useresti quasi certamente `cv::Sobel` o equivalenti, spesso vettorizzati e multi-thread internamente. Attenzione a un dettaglio non banale in quel caso: se la libreria di visione che usi ha già un proprio parallelismo interno, sommarlo ingenuamente al parallelismo del tuo `QThreadPool` può produrre più thread di quanti core hai — un caso concreto della lezione sul costo dei context switch del Modulo 0, qui applicata a scala di sistema.

**Ritarare la dimensione del pool sull'hardware reale.** In produzione vorresti probabilmente partire da `QThread::idealThreadCount()` e poi misurare — la stessa disciplina di calibrazione empirica di questo capitolo, applicata al numero di worker invece che al tempo di elaborazione, magari con un piccolo benchmark che replica lo spirito del Progetto G del Modulo 5.

**Profilare sotto carico sostenuto, non solo in una demo di pochi secondi.** Un test di 24 frame in cinque secondi dimostra la correttezza del design, non la sua tenuta sotto ore di funzionamento continuo. ThreadSanitizer, in particolare, vale la pena di essere rilanciato su questo progetto esteso, e un profiling di lungo periodo è l'unico modo onesto di sapere se la capacità del buffer e la taglia del pool reggono davvero il carico reale.

## Conclusioni del modulo — e del corso

Sei moduli fa il problema era un bottone che bloccava una finestra. Oggi hai costruito, verificato con misure reali e non solo con l'intuizione, un sistema a cinque stadi con tre categorie di thread attive contemporaneamente — un worker persistente, un pool dinamico, il thread GUI — coordinate da un buffer limitato e da una sequenza di arresto che non lascia mai nulla appeso, anche nel caso più insidioso in cui uno stadio è addormentato dentro una wait condition proprio nel momento in cui gli chiedi di fermarsi. Non è un esercizio da manuale: è, nella sostanza architetturale, lo stesso tipo di sistema che incontrerai nel lavoro su sistemi di visione industriale.

Quello che ci si porta via da questo percorso non è la sintassi di `QThread` o di `QMutex` — quella si ritrova in qualunque documentazione in trenta secondi. È il modello mentale per cui, davanti a un sistema concorrente nuovo, si sanno fare le domande giuste nell'ordine giusto: quali dati sono davvero condivisi, e da chi; qual è l'ordine di spegnimento che non lascia nessuno addormentato per sempre; dove la GUI rischia di bloccarsi, e come spostare quel rischio su un thread che non lo paga. Il resto — la classe specifica, il nome esatto del metodo — è dettaglio che si guarda quando serve, non teoria da portare a memoria.

---

*Il codice sorgente completo di questo progetto è disponibile nella repository che accompagna questo corso, nella cartella `project-H-vision-pipeline-capstone`.*
