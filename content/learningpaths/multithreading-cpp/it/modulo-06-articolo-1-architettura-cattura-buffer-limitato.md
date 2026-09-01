---
title: "Capstone: architettura di una pipeline di visione — cattura e buffer limitato"
description: "Multithreading in C++ con Qt — Modulo 6 (Capstone)"
---

Tutto il codice sorgente lo puoi trovare [qui](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone: architettura di una pipeline di visione — cattura e buffer limitato

Sei partito, sei moduli fa, da un bottone che bloccava una finestra. Un click, un calcolo pesante eseguito nel posto sbagliato, e l'intera applicazione smetteva di respirare per qualche secondo — non per un bug esotico, ma perché quello è semplicemente cosa succede quando un solo thread deve fare sia il lavoro sia rispondere all'utente. Da lì hai costruito, un pezzo alla volta, un vocabolario intero: `QThread` e l'architettura a event loop (Modulo 1), `QMutex` e `QWaitCondition` per coordinare stato condiviso vero (Modulo 2), `QtConcurrent` e il modello Future/Promise per il lavoro a grana grossa (Modulo 3), le regole precise delle connessioni tra thread e la cancellazione cooperativa (Modulo 4), `QThreadPool`, gli atomici e il costo nascosto della cache (Modulo 5). Ogni modulo ha risolto un problema preciso, isolato, con un progetto guidato che lo dimostrava da solo.

Questo modulo capstone non ne introduce uno nuovo. Il suo compito è diverso e, se vogliamo essere onesti, più difficile: prendere tutti quei pezzi e farli funzionare **insieme**, nello stesso programma, contemporaneamente — perché è esattamente questa la differenza tra "conoscere una tecnica" e "saper costruire un sistema". Un thread pool che funziona benissimo da solo, in isolamento, può bloccarsi per sempre se l'ordine con cui lo spegni rispetto a un buffer a monte è quello sbagliato. Una cancellazione cooperativa impeccabile con un solo worker deve essere ripensata da capo quando i worker cooperanti diventano tre stadi concorrenti invece di uno.

Il progetto guidato di questi ultimi articoli, **Progetto H — Pipeline di elaborazione frame in tempo quasi reale**, è deliberatamente vicino a un caso reale: un thread di acquisizione che simula una telecamera, un buffer limitato che disaccoppia acquisizione ed elaborazione, un pool di worker che applica un filtro reale a ogni frame in parallelo, un meccanismo di stop che deve fermare tutto senza perdere dati e senza restare appeso, e una GUI che resta reattiva dall'inizio alla fine. Cinque stadi, ciascuno costruito con la tecnica di un modulo preciso.

## Vista d'insieme: cinque stadi, un solo flusso

![End-to-end architecture of the capstone pipeline](modulo-06/25-capstone-pipeline-architecture.png)

Il flusso è lineare nella direzione dei dati — un frame nasce nello Stadio 1, attraversa lo Stadio 2, viene consumato ed elaborato nello Stadio 3, e il suo risultato raggiunge lo Stadio 5 tramite segnali — ma **non** lineare nel controllo: lo Stadio 4, il flag di cancellazione cooperativa, non è un quinto anello della catena, è una linea che tocca *tutti* gli altri quattro contemporaneamente, perché fermare la pipeline è un'operazione che deve toccare ogni stadio nell'ordine giusto, esplicitamente.

Ecco la mappa completa di quale modulo del corso ha insegnato la tecnica di ciascuno stadio:

- **Stadio 1 — Cattura**: un `QThread` persistente con un worker spostato via `moveToThread()`, mai una sottoclasse di `QThread`. Tecnica del **Modulo 1**.
- **Stadio 2 — Buffer condiviso**: `QMutex` + due `QWaitCondition`, una coda limitata, lo stesso schema produttore-consumatore visto in precedenza. Tecnica del **Modulo 2**.
- **Stadio 3 — Elaborazione parallela**: un pool di task persistenti su `QThreadPool`, con un'alternativa a `QtConcurrent` discussa e motivata. Tecnica del **Modulo 5** (con un confronto esplicito rispetto al **Modulo 3**).
- **Stadio 4 — Cancellazione cooperativa**: un flag atomico condiviso, esteso a coordinare correttamente tre stadi concorrenti invece di uno. Tecnica del **Modulo 4**.
- **Stadio 5 — Integrazione GUI**: segnali con connessione queued verso il thread principale, che non si blocca mai. Tecnica del **Modulo 0** applicata di nuovo a scala di sistema intero.

## Stadio 1: la cattura, un worker persistente che non sa nulla del resto

**Obiettivo.** Un thread separato che genera frame sintetici a un ritmo regolare e controllato, esattamente come farebbe il driver di una telecamera reale — senza mai toccare direttamente la GUI, senza sapere nulla di come i frame verranno elaborati.

Il pattern è quello del Modulo 1: nessuna sottoclasse di `QThread`, un `QObject` worker (`CaptureWorker`) spostato con `moveToThread()` su un `QThread` puro, avviato quando il thread emette `started`. Quello che è nuovo è cosa fa il worker una volta avviato: non elabora nulla lui stesso, si limita a generare un `QImage` sintetico e a consegnarlo allo stadio successivo:

```cpp
void CaptureWorker::start() {
    int frameNumber = 0;

    while (!m_flag->requested() && frameNumber < m_targetFrameCount) {
        QThread::msleep(m_intervalMs);
        if (m_flag->requested()) break;   // re-check even after the sleep

        QImage frame = generateSyntheticFrame(frameNumber);
        if (!m_buffer->produce(frame, frameNumber)) break;

        emit frameCaptured(frameNumber);
        ++frameNumber;
    }

    emit captureFinished(frameNumber);
}
```

**Insidia 1 — il ricontrollo dopo la sleep.** Nota il secondo `if (m_flag->requested()) break;`, subito dopo `QThread::msleep()`. Se non ci fosse, un frame "di troppo" potrebbe essere prodotto proprio nella finestra di tempo tra una richiesta di stop e il risveglio dalla sleep — non è un bug catastrofico, ma è disciplina: ogni punto in cui il thread riprende controllo dopo un'attesa è un punto in cui vale la pena chiedersi di nuovo "dovrei ancora essere qui?", esattamente lo spirito del `while` (non `if`) che il Modulo 2 ti ha insegnato per le `QWaitCondition`.

**Insidia 2 — due condizioni di terminazione indipendenti.** Il ciclo termina per due ragioni distinte, ed entrambe contano: il flag di cancellazione (Modulo 4) oppure il target di frame raggiunto. Un errore comune quando si integrano più stadi è pensare che basti *una* delle due condizioni — ma il caso "la cattura ha semplicemente finito il suo lavoro" non è affatto uguale al caso "l'utente ha interrotto tutto a metà": vedremo più avanti che la sequenza di spegnimento corretta è diversa nei due casi.

**Insidia 3 — cosa succede se `produce()` ritorna `false`.** Il worker di cattura non controlla mai direttamente lo stato del buffer: gli basta il valore di ritorno di `produce()`. Se qualcun altro ha già chiuso il buffer mentre il worker era bloccato in attesa di spazio libero, la chiamata ritorna `false` e il ciclo esce pulito. È lo stesso principio di incapsulamento del Modulo 2: la logica di chiusura vive in un solo posto, non sparsa tra i thread che la usano.

## Stadio 2: il buffer limitato, e la contropressione come scelta deliberata

**Obiettivo.** Disaccoppiare il ritmo di cattura da quello di elaborazione, in modo che i due stadi possano procedere a velocità diverse senza che uno debba aspettare l'altro passo-passo — ma con un limite netto a quanta "distanza" può crescere tra i due.

`FrameBuffer` è, deliberatamente, una riscrittura dello stesso pattern buffer condiviso costruito nel Modulo 2, non copiata ma ripensata per trasportare `QImage` invece di interi: stesso `QMutex`, stesse due `QWaitCondition` (`m_notFull` per il produttore, `m_notEmpty` per i consumatori), stesso ciclo `while` di ricontrollo, stessa disciplina RAII con `QMutexLocker`.

```cpp
bool FrameBuffer::consume(QImage &frameOut, int &frameNumberOut) {
    QMutexLocker locker(&m_mutex);

    while (m_queue.isEmpty() && !m_closed) {
        m_notEmpty.wait(&m_mutex);
    }

    if (m_queue.isEmpty()) return false;   // closed AND empty: really done

    Entry e = m_queue.dequeue();
    frameOut = e.frame;
    frameNumberOut = e.number;
    emit occupancyChanged(m_queue.size(), m_capacity);

    m_notFull.wakeOne();
    return true;
}
```

**Insidia — la condizione di ritorno di `consume()` non è simmetrica a quella di `produce()`, ed è voluta.** Guarda bene la riga `if (m_queue.isEmpty()) return false;`: il test è solo sulla coda vuota, non anche su `m_closed`. Significa che, una volta chiuso il buffer, `consume()` **continua a restituire `true`** finché ci sono ancora frame in coda — chiudere il buffer non butta via nulla di ciò che è già stato prodotto. È una decisione di design che vale la pena rendere esplicita: la scelta opposta (scartare tutto appena arriva `close()`) sarebbe stata altrettanto facile da scrivere e molto più pericolosa in un sistema di visione reale, dove un frame scartato può significare un evento non rilevato.

### Il perché del limite

![Backpressure: the bounded buffer fills up and the producer waits](modulo-06/26-backpressure-bounded-buffer.png)

Con una capacità fissa e un ritmo di cattura più veloce del ritmo di elaborazione aggregato, il buffer si riempie regolarmente durante l'esecuzione del progetto, e `CaptureWorker::start()` si blocca dentro `m_buffer->produce()` in attesa di spazio, esattamente come previsto. Questo è il punto su cui vale la pena fermarsi a pensare in termini di sistema, non solo di codice: la contropressione (backpressure) non è un difetto del design, è **l'alternativa deliberata e superiore** a una coda illimitata. Con una coda che può crescere senza limite, un produttore più veloce del consumatore non aspetterebbe mai — ma la memoria occupata dai frame in attesa crescerebbe senza limite sotto carico sostenuto, il ritardo tra "frame catturato" e "frame elaborato" diventerebbe arbitrariamente grande e, soprattutto, invisibile finché qualcosa non esaurisce le risorse disponibili. Un buffer limitato converte un problema latente e silenzioso in un rallentamento immediato, misurabile, e — cosa più importante per un sistema che deve girare 24 ore su 24 su hardware embedded — con un limite di memoria noto in anticipo.

Con la cattura e il buffer limitato inquadrati, il prossimo articolo affronta la parte più delicata dell'intero modulo: come elaborare i frame in parallelo con un pool persistente, e come fermare correttamente una pipeline in cui tre stadi concorrenti possono essere addormentati in punti diversi nello stesso istante.
