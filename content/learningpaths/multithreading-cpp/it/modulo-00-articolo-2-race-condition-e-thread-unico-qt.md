---
title: "Quando la memoria condivisa morde: race condition, data race e il thread unico di Qt"
description: "Multithreading in C++ con Qt — Modulo 0"
---

# Quando la memoria condivisa morde: race condition, data race e il thread unico di Qt

Nell'articolo precedente abbiamo visto perché i thread esistono e perché conviene usarli: condividono memoria senza attrito, e questo li rende comodi ed efficienti. Ora arriva la parte scomoda della stessa storia, perché quella comodità ha un prezzo preciso: la stessa memoria condivisa che rende i thread utili è, esattamente, quella che li rende pericolosi. Non puoi semplicemente "buttare thread" sul tuo problema e sperare bene.

## Race condition: quando il risultato dipende da chi arriva prima

Una **race condition** si verifica ogni volta che il risultato finale di un programma dipende dall'ordine relativo — non controllato da te, deciso dallo scheduler — in cui più thread eseguono operazioni sugli stessi dati condivisi. Il caso di scuola è un contatore condiviso incrementato da più thread. L'istruzione, in C++, sembra innocua e atomica solo perché sta su una riga sola:

```cpp
counter++;
```

Ma "sembra una sola operazione" e "è una sola operazione a livello di CPU" sono due affermazioni diverse, e la seconda è falsa. A livello di istruzioni macchina, quell'incremento si scompone tipicamente in tre passi: **leggi** il valore corrente dalla memoria in un registro; **incrementa** il valore dentro quel registro; **scrivi** il registro di nuovo in memoria. Finché un solo thread esegue questa sequenza per volta, nessun problema. Ma se due thread eseguono questi tre passi in modo interlacciato, può succedere questo:

![Race condition: a lost update](img/modulo-00/04-race-condition-lost-update.png)

Guarda con attenzione la sequenza: entrambi i thread leggono lo stesso valore iniziale (10) prima che uno dei due abbia avuto la possibilità di scrivere il proprio risultato. Ciascuno calcola correttamente "il vecchio valore più uno" nel proprio registro privato — i registri sono privati per thread, quindi qui non c'è ancora conflitto. Il conflitto esplode al momento della scrittura: il Thread B scrive per ultimo, e il suo `11` sovrascrive l'`11` scritto poco prima dal Thread A, che invece avrebbe dovuto produrre un `12` finale (due incrementi partiti da 10). Un intero incremento è scomparso nel nulla, senza errori, senza eccezioni, senza un solo messaggio di log che ti avvisi: il programma ha semplicemente calcolato un numero sbagliato. Questo fenomeno ha un nome preciso, **lost update** (aggiornamento perso), ed è probabilmente il bug di concorrenza più comune in assoluto.

## Data race: cosa dice davvero lo standard C++

Vale la pena una distinzione tecnica precisa. Una **race condition** è il fenomeno generale appena descritto: il risultato dipende dall'ordine di interleaving non controllato. Una **data race** è la definizione formale e più stretta che lo standard C++ dà a un caso specifico di race condition: due o più thread accedono alla stessa locazione di memoria, almeno uno di quegli accessi è una scrittura, e nessuno dei due accessi è sincronizzato rispetto all'altro.

Ecco il punto che sorprende quasi tutti la prima volta: lo standard C++ dice esplicitamente che **una data race è undefined behavior**. Non "un bug", non "un comportamento sbagliato ma prevedibile" — *undefined behavior*, la stessa categoria di gravità di un accesso fuori dai limiti di un array. La conseguenza pratica è che il compilatore è legalmente autorizzato ad assumere che una data race non accada mai nel tuo programma, e a ottimizzare di conseguenza. Con le ottimizzazioni attive, il compilatore può decidere di tenere un contatore in un registro della CPU per l'intera durata di un ciclo, scrivendolo in memoria una sola volta alla fine — perfettamente legittimo *se* nessun altro thread stesse leggendo o scrivendo quella variabile nel frattempo, ipotesi che il compilatore ha il diritto di dare per scontata proprio perché il codice, violando la sincronizzazione richiesta, ha già rotto il contratto con lo standard.

Il risultato pratico è che lo stesso identico codice "buggato" può sembrare funzionare perfettamente in una build ottimizzata, e mostrare il suo vero comportamento solo in una build di debug — il che è un motivo di preoccupazione maggiore, non minore: un bug che "sembra sparire" con le ottimizzazioni non è affatto sparito, è solo diventato invisibile proprio nelle condizioni in cui più probabilmente lo avresti testato.

## Sezione critica e mutua esclusione

Il rimedio concettuale si chiama **sezione critica**: un tratto di codice che accede a dati condivisi e che deve essere eseguito da un solo thread alla volta — non perché il codice sia lento o pericoloso, ma perché l'accesso ai dati che tocca deve restare **atomico**, nel senso stretto del termine (dal greco "che non si può tagliare"): o è già successo per intero, o non è ancora iniziato, mai visto a metà. Garantire che una sezione critica sia rispettata da tutti i thread si chiama imporre la **mutua esclusione**, ed è esattamente il ruolo di un **mutex** (contrazione di *mutual exclusion*): lo strumento più elementare — e quello che userai per primo nel progetto pratico di questo modulo — per trasformare una sequenza di operazioni pericolosamente separabile in un blocco indivisibile agli occhi degli altri thread.

## Perché Qt impone un thread unico per la GUI

Ecco un vincolo che, visto senza contesto, sembra un capriccio della libreria: Qt impone che **tutti i widget della tua interfaccia grafica vengano creati e manipolati esclusivamente dal thread principale del programma**, spesso chiamato "GUI thread". Non è un'invenzione arbitraria: eredita un vincolo che viene da molto più in basso nello stack software, dai toolkit grafici nativi del sistema operativo — su Windows il subsystem Win32/GDI, su Linux X11 o Wayland, su macOS Cocoa. Questi toolkit sono stati progettati attorno all'assunzione che esista un unico "message loop" che riceve gli eventi dal sistema operativo (un click, la pressione di un tasto, una richiesta di ridisegno) e li smista uno alla volta, in sequenza, ai widget interessati. Permettere a thread diversi di manipolare contemporaneamente le stesse strutture grafiche native avrebbe richiesto sincronizzazione pesante a ogni livello del toolkit, con un costo enorme per un'interfaccia che, in fondo, deve solo reagire a eventi umani — lenti, rispetto ai tempi della CPU. La scelta storica, quasi universale in tutti i toolkit grafici desktop, è stata: un solo thread può toccare la GUI, punto, e in cambio quel thread può restare semplice ed efficiente perché non deve mai preoccuparsi di essere interrotto a metà di un'operazione da un altro thread che tocca la stessa finestra.

Qt formalizza esplicitamente questo vincolo con il concetto di **event loop**: il thread principale, dopo aver creato le finestre, entra in un ciclo (`app.exec()`) che fa esattamente una cosa, all'infinito, finché l'applicazione non si chiude: aspetta il prossimo evento, lo processa **fino al termine**, poi torna ad aspettare il successivo. La parola chiave è "fino al termine": se il codice che processa un evento decide di eseguire un calcolo che dura quattro secondi invece di quattro millisecondi, l'event loop resta bloccato dentro quel singolo evento per quattro secondi interi, e durante quel tempo non può processare **nessun altro evento** — non un click, non un timer, nemmeno l'evento che il sistema operativo manda periodicamente per verificare che l'applicazione sia ancora "viva".

![The window freezes: the GUI thread is busy](img/modulo-00/06-gui-thread-blocked.png)

Questo è esattamente il fenomeno che vedremo dal vivo tra poco, ed è precisamente il problema che nel prossimo modulo risolveremo introducendo `QThread` e il pattern del worker object: spostare il calcolo lungo *fuori* dal thread che possiede l'event loop della GUI, in modo che quest'ultimo resti sempre libero di rispondere in pochi millisecondi. Non è un dettaglio implementativo di Qt: è una conseguenza diretta e inevitabile di tutto quello che hai appena letto, applicata al caso specifico di un'interfaccia utente.

## Quando conviene usare un thread (e quando no)

Prima di scrivere codice, vale la pena mettere per iscritto una bussola che tornerà utile per tutto il resto del percorso, perché "un thread in più" non è mai gratis e non è mai automaticamente la scelta giusta.

La prima distinzione da fare è se il lavoro che vuoi affidare a un thread è **CPU-bound** o **I/O-bound**. Un lavoro è CPU-bound quando il collo di bottiglia è puramente di calcolo — la CPU è sempre occupata, senza pause, come il conteggio di numeri primi o un filtro di image processing applicato pixel per pixel. Un lavoro è I/O-bound quando invece il thread, per la maggior parte del tempo, non calcola affatto: sta *aspettando* — una risposta di rete, una lettura da disco, l'acquisizione di un frame da una telecamera con il suo tempo fisico di esposizione. Per il lavoro CPU-bound, il beneficio del multithreading dipende strettamente da quanti core fisici hai davvero a disposizione (torna la legge di Amdahl dell'articolo precedente: più thread di core fisici liberi non dà più velocità, dà solo più context switch). Per il lavoro I/O-bound, invece, anche su un solo core il multithreading ha senso, perché il thread che aspetta non sta "sprecando" un core — sta semplicemente lasciando che lo scheduler dia quel tempo a qualcun altro, tipicamente al thread della GUI, che nel frattempo resta reattivo.

La seconda bussola è la **granularità**, già incontrata parlando di context switch: un thread che vive per meno tempo di quanto serva a crearlo, avviarlo, fargli contendere CPU con gli altri e poi distruggerlo, è un pessimo affare. È il motivo per cui, più avanti nel percorso, preferiremo un **thread pool** — dove i thread vengono creati una volta sola e riutilizzati per molti task — alla creazione di un thread nuovo per ogni singolo pezzetto di lavoro.

E infine, la domanda più semplice e più spesso saltata: **il tuo programma ha davvero bisogno di essere più veloce, o solo di restare reattivo?** Sono due problemi diversi, con soluzioni diverse. Se il problema è la reattività della UI durante un'operazione lunga ma isolata, basta *un* worker thread — non serve un thread pool né preoccuparsi di sfruttare tutti i core della macchina. Se invece il problema è "questo calcolo richiede troppo tempo e voglio dividerlo per finire prima", allora sei nel territorio del vero parallelismo, con tutto quello che la legge di Amdahl ha già detto sui suoi limiti. Confondere questi due obiettivi è, nella pratica, la causa più comune di architetture di concorrenza inutilmente complicate per problemi che avrebbero richiesto una soluzione molto più semplice.

## Dalla teoria alle mani sulla tastiera

Hai ora un vocabolario preciso — race condition, data race, sezione critica, mutua esclusione, event loop — e sai perché Qt ha fatto la scelta che ha fatto per la sua GUI. Manca solo una cosa: vederlo succedere davvero, con le tue mani sulla tastiera. È esattamente quello che facciamo nel prossimo articolo, con due piccoli progetti guidati — uno in C++ puro, senza Qt, e uno che ricrea dal vivo il freeze della finestra di cui abbiamo appena parlato.
