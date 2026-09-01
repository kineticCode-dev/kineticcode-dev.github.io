---
title: "Aspettare un evento, non un lock: QWaitCondition, QSemaphore, e come ci si spara nei piedi"
description: "Multithreading in C++ con Qt — Modulo 2"
---

# Aspettare un evento, non un lock: QWaitCondition, QSemaphore, e come ci si spara nei piedi

Nell'articolo precedente abbiamo visto come proteggere un dato condiviso con `QMutex` e `QReadWriteLock`. Ma il produttore-consumatore ha bisogno di rispondere a una domanda diversa e più sottile: "il buffer è pieno — devo aspettare che *cambi qualcosa*, non solo che il lock si liberi". Un mutex da solo non basta a esprimere "aspetta finché una certa condizione sui dati non diventa vera": puoi tenerlo bloccato per sempre in un ciclo che ricontrolla in continuazione (un'attesa attiva, che spreca CPU inutilmente), oppure hai bisogno di uno strumento pensato apposta per questo. Quello strumento è `QWaitCondition`.

## QWaitCondition: aspettare un evento, non solo un lock libero

Una `QWaitCondition` permette a un thread di **addormentarsi** rilasciando temporaneamente un mutex che detiene, restare in attesa finché un altro thread non lo **sveglia** esplicitamente, e solo a quel punto riacquisire il mutex e riprendere. La parte cruciale, quella che la rende diversa da un semplice "dormi e ricontrolla", è che l'addormentamento e il rilascio del mutex avvengono come un'unica operazione atomica: non c'è mai una finestra di tempo in cui il thread ha già rilasciato il lock ma non è ancora "registrato" come in attesa, finestra che altrimenti potrebbe far perdere un risveglio inviato proprio in quell'istante (un bug classico chiamato *lost wakeup*, che `QWaitCondition` previene per costruzione).

Il pattern d'uso è sempre lo stesso:

```cpp
QMutex mutex;
QWaitCondition condition;
bool dataReady = false;

// Waiting thread:
QMutexLocker locker(&mutex);
while (!dataReady) {
    condition.wait(&mutex);   // releases the mutex, sleeps, reacquires it on wake-up
}
// the mutex is back in my hands here, and dataReady is true

// Notifying thread:
{
    QMutexLocker locker(&mutex);
    dataReady = true;
}
condition.wakeOne();   // or wakeAll(), if more than one thread must be woken
```

Nota il `while`, non un semplice `if`: è deliberato, e non è pignoleria stilistica. Al risveglio, il codice **deve ricontrollare da capo** la condizione che stava aspettando, perché possono esserci risvegli "spuri" (per ragioni interne al sistema operativo, senza che nessuno abbia davvero chiamato `wakeOne()`), oppure perché — nel caso di `wakeAll()` con più thread in attesa — un altro thread potrebbe averti anticipato e aver già consumato ciò che stavi aspettando prima che tu riprendessi davvero il controllo. Un `if` al posto del `while` è uno degli errori più comuni e più difficili da individuare in codice basato su wait condition: funziona quasi sempre nei test, e fallisce raramente, in produzione, in un momento che nessuno riesce a riprodurre a comando.

`wakeOne()` sveglia esattamente un thread in attesa (se ce n'è più di uno, la scelta di quale non è specificata — non fare mai affidamento su un ordine); `wakeAll()` li sveglia tutti, ciascuno dei quali ricontrollerà comunque la propria condizione (da cui, di nuovo, l'importanza del `while`) e tornerà eventualmente ad aspettare se la condizione non è ancora quella giusta per lui.

Nel progetto pratico di questo modulo userai **due** `QWaitCondition` distinte sullo stesso buffer: una per la direzione "il buffer è pieno, il produttore aspetta", una per "il buffer è vuoto, il consumatore aspetta". È un pattern standard, e vederlo applicato con le tue mani chiarirà molto più di qualunque ulteriore spiegazione astratta.

## QSemaphore: contare invece di aspettare un booleano

C'è un'ultima primitiva che vale la pena conoscere, anche se oggi non la useremo direttamente: `QSemaphore`. Un semaforo (nel senso informatico del termine, concetto che risale a Dijkstra negli anni '60) è, concettualmente, un contatore intero non-negativo con due operazioni: `acquire()`, che decrementa il contatore ma **blocca** il chiamante se il contatore è già a zero, aspettando che torni positivo; e `release()`, che incrementa il contatore e sveglia eventuali thread in attesa su `acquire()`.

Perché è utile? Perché esprime naturalmente il concetto di "N risorse intercambiabili disponibili" — non "il buffer è pieno o vuoto" in senso booleano, ma "quanti slot liberi ci sono in questo momento", contati esplicitamente. Il produttore-consumatore di questo modulo si può risolvere anche in questo modo, ed è istruttivo vedere la corrispondenza: due semafori, `freeSlots` inizializzato alla capacità del buffer e `usedSlots` inizializzato a zero, dove il produttore fa `freeSlots.acquire()` prima di inserire e `usedSlots.release()` dopo, e il consumatore fa esattamente il contrario. Il risultato finale è comportamentalmente equivalente a quello che costruiamo con `QWaitCondition` — è la stessa idea, la stessa coppia di condizioni "pieno" e "vuoto", ma espressa con un contatore invece che con un booleano e due wait condition esplicite.

Quale dei due stili scegliere, nel codice reale che scriverai dopo questo corso? `QWaitCondition` (quella che useremo oggi) è lo strumento giusto quando la condizione di attesa è più ricca di un semplice conteggio — per esempio "aspetta finché il buffer non contiene *un elemento con una certa proprietà*", non solo "aspetta finché non è vuoto". `QSemaphore` è più diretto e leggibile quando il tuo problema è, letteralmente, un conteggio di risorse disponibili — un pool di connessioni, un numero fisso di slot hardware, un limite di quante operazioni concorrenti sono permesse. Nessuno dei due è "superiore": scegli quello che rispecchia più fedelmente la forma reale del problema.

## Deadlock: l'attesa circolare

Introdurre mutex e wait condition senza parlare di come ci si spara nei piedi con essi sarebbe disonesto. Tre insidie, in ordine di quanto sono comuni nella pratica.

Un **deadlock** si verifica quando due (o più) thread restano bloccati per sempre, ciascuno in attesa di una risorsa che un altro thread del gruppo detiene e non rilascerà mai — perché, a sua volta, sta aspettando qualcosa che il primo detiene. Il Thread A tiene il Mutex X e aspetta di acquisire il Mutex Y; il Thread B, nello stesso momento, tiene Y e aspetta X. Nessuno dei due può procedere, nessuno dei due rilascerà mai ciò che ha (perché per rilasciarlo dovrebbe prima finire il proprio lavoro, che è bloccato), e il programma resta lì, silenziosamente, per sempre — nessun crash, nessun messaggio d'errore, semplicemente due thread che non fanno più nulla.

![Deadlock: circular waiting](img/modulo-02/11-deadlock-circular-wait.png)

La condizione che rende possibile questo scenario ha un nome nella letteratura classica dei sistemi operativi (le "condizioni di Coffman", dal nome di uno degli autori dell'articolo del 1971 che le ha formalizzate per primo), e sono quattro, tutte necessarie contemporaneamente perché un deadlock possa verificarsi: mutua esclusione (le risorse non si possono condividere), possesso-e-attesa (un thread tiene una risorsa mentre ne aspetta un'altra), niente prelazione (una risorsa non può essere strappata a forza a chi la detiene), e **attesa circolare** (esiste un ciclo di thread, ciascuno in attesa di una risorsa detenuta dal successivo nel ciclo). Delle quattro, le prime tre sono quasi sempre intrinseche al problema che stai risolvendo — non puoi eliminarle senza snaturare la soluzione. La quarta, l'attesa circolare, è invece quella su cui hai leva pratica, ed è per questo che ogni guida sul deadlock converge sulla stessa raccomandazione: **stabilisci un ordine globale fisso in cui i lock vengono sempre acquisiti**, in ogni punto del programma, senza eccezioni. Se ogni thread che ha bisogno sia di X sia di Y li acquisisce sempre nello stesso ordine (poniamo, sempre prima X e poi Y, mai il contrario), il ciclo diventa strutturalmente impossibile: non può esistere un'attesa circolare se tutti fanno la fila nella stessa direzione.

Nel progetto pratico di oggi il rischio di deadlock è basso perché usiamo un solo mutex (quello interno al buffer) — ma è un rischio che cresce rapidamente non appena un progetto reale comincia ad avere più risorse protette separatamente, ed è il motivo per cui vale la pena fissare bene il principio fin da ora, prima che ti serva sotto pressione con un debugger aperto e un programma che non risponde più.

## Starvation: tecnicamente vivo, di fatto dimenticato

La **starvation** (digiuno) è più subdola del deadlock perché non blocca tutto: un thread specifico, semplicemente, non ottiene mai la risorsa di cui ha bisogno, pur non essendoci nessun ciclo di attesa che lo impedisca in teoria — viene sempre scavalcato da altri thread più "fortunati" o più frequenti nelle loro richieste. È esattamente la violazione della terza proprietà vista nell'articolo precedente, l'attesa limitata. `wakeOne()` su una `QWaitCondition` con molti thread in attesa, per esempio, non garantisce un ordine di risveglio equo (non è necessariamente FIFO) — in scenari con contesa molto alta e pattern di accesso squilibrati, è teoricamente possibile che lo stesso thread resti sfortunato più a lungo di quanto ti aspetteresti. Per il nostro progetto pratico, con un solo produttore e un solo consumatore, questo rischio è nullo per costruzione (non c'è nessuno da scavalcare); diventa un fattore reale da considerare quando il tuo sistema cresce a più produttori o più consumatori sullo stesso buffer.

## Inversione di priorità: quando il sistema operativo aggiunge un terzo incomodo

Un'ultima insidia, più rara ma che vale la pena conoscere per nome perché quando capita è particolarmente difficile da diagnosticare: l'**inversione di priorità**. Succede quando un thread a **bassa priorità** detiene un lock che serve a un thread ad **alta priorità**; quest'ultimo si blocca in attesa, il che sarebbe già normale — ma se nel frattempo un terzo thread a priorità **media** (che non ha bisogno di quel lock) tiene occupata la CPU, lo scheduler continua a fargli spazio a scapito del thread a bassa priorità che detiene il lock, il quale non riesce a finire il proprio lavoro e rilasciarlo. Il risultato netto è che il thread ad alta priorità resta bloccato indirettamente da uno a priorità media, un'inversione completa dell'ordine di priorità che il sistema avrebbe dovuto rispettare.

È un problema abbastanza reale da aver causato, storicamente, il quasi-fallimento della missione Mars Pathfinder della NASA nel 1997 — un caso di studio citato spessissimo in letteratura proprio per questo. Ne racconto i dettagli in un articolo a parte, perché vale la pena capire esattamente come un problema di sincronizzazione su un rover a 225 milioni di chilometri di distanza si sia trasformato in un reset periodico dell'intero sistema, e come sia stato diagnosticato e risolto — vedi *"Mars Pathfinder: quando l'inversione di priorità arriva su Marte"*.

La mitigazione classica a livello di sistema operativo si chiama *priority inheritance*: temporaneamente, il thread a bassa priorità che detiene il lock conteso "eredita" la priorità del thread più alto che lo sta aspettando, così lo scheduler lo favorisce abbastanza da fargli finire il lavoro e liberare il lock. Qt non gestisce questo automaticamente a livello applicativo — è tipicamente una responsabilità dello scheduler del sistema operativo sottostante — ma sapere che il fenomeno esiste, e riconoscerne i sintomi (un thread ad alta priorità misteriosamente lento, in presenza di carico da thread a priorità intermedia), ti risparmierà ore di debugging il giorno in cui lo incontrerai in un sistema con vincoli di tempo reale.

## Dalla teoria alle mani sulla tastiera

Hai ora tutti gli strumenti per proteggere e coordinare stato condiviso vero: `QMutex`, `QReadWriteLock`, `QWaitCondition`, `QSemaphore`, e il vocabolario per riconoscere deadlock, starvation e inversione di priorità quando li incontri. Nel prossimo articolo mettiamo tutto insieme costruendo un vero produttore-consumatore, con due thread persistenti che si contendono un buffer limitato sotto i tuoi occhi.
