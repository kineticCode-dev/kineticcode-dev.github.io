---
title: "Due event loop che si parlano in sicurezza: connessioni queued e il ciclo di vita di un worker thread"
description: "Multithreading in C++ con Qt — Modulo 1"
---

# Due event loop che si parlano in sicurezza: connessioni queued e il ciclo di vita di un worker thread

Nell'articolo precedente abbiamo capovolto l'approccio a `QThread`: non si sottoclassa, si usa così com'è, e la logica va in un worker separato spostato con `moveToThread()`. Resta una domanda pratica ovvia: se il worker ora vive su un thread diverso da quello della GUI, come si comunica nelle due direzioni senza reintrodurre le race condition che abbiamo già imparato a temere?

## Due event loop, e come si parlano tra loro senza correre rischi

La risposta è che non lo fai tu manualmente: lo fa Qt, automaticamente, attraverso lo stesso meccanismo di segnali e slot che già conosci, con un comportamento aggiuntivo che scatta silenziosamente quando mittente e destinatario vivono su thread diversi. Ogni thread che esegue un event loop — sia il thread della GUI, sia un thread gestito da un `QThread` che non ha sovrascritto `run()` — ha una propria **coda di eventi**, indipendente da quella di ogni altro thread. Quando chiami `connect()` tra un oggetto che vive sul thread A e uno che vive sul thread B, Qt confronta le due thread affinity al momento dell'emissione del segnale e, se sono diverse, **non chiama lo slot direttamente**: impacchetta la chiamata (il nome del metodo, gli argomenti, tutto) in un evento e lo deposita nella coda del thread che possiede il destinatario. Quel thread, quando arriva al proprio turno nel ciclo del suo event loop, estrae l'evento dalla coda e **solo a quel punto** esegue davvero lo slot — sul proprio thread, con i propri dati, senza che nessun altro thread stia toccando quella memoria nello stesso istante.

![Two event loops connected by a queued connection](modulo-01/06-two-event-loops-queued-connection.png)

Questo tipo di collegamento ha un nome preciso, che rivedremo con tutti i dettagli tecnici più avanti nel percorso: si chiama **QueuedConnection**, ed è una delle quattro modalità di connessione che Qt offre (le altre sono `DirectConnection`, `BlockingQueuedConnection`, e `AutoConnection` — quest'ultima è il comportamento di default, che sceglie automaticamente Direct se mittente e destinatario condividono lo stesso thread, Queued altrimenti, esattamente il comportamento che stiamo sfruttando oggi senza doverlo specificare mai esplicitamente). Il punto concettuale da portarti via oggi è questo: **una normale connessione segnale-slot tra oggetti su thread diversi è già, di per sé, thread-safe**, perché il segnale non esegue mai codice del destinatario "sul posto" — si limita a lasciare un messaggio nella sua cassetta della posta, ed è il destinatario stesso, quando gli va bene, a leggerlo ed eseguirlo. Non hai bisogno di un `QMutex` per proteggere questo scambio: Qt lo ha già reso sicuro per te, a patto che tu comunichi sempre attraverso segnali e slot e non, per esempio, chiamando direttamente un metodo pubblico del worker da fuori o toccando le sue variabili membro da un altro thread — quella sarebbe di nuovo, punto e a capo, una data race.

## Il ciclo di vita di un worker thread, e la trappola di deleteLater()

Mettere in piedi un worker thread è solo metà del lavoro: l'altra metà, quella che separa il codice robusto da quello che perde memoria o crasha alla chiusura dell'applicazione, è gestirne correttamente la nascita e soprattutto la fine.

Un pattern molto comune, ed è quello che useremo nel progetto pratico, è collegare il segnale `QThread::started` — emesso automaticamente non appena il thread gestito ha effettivamente avviato il proprio event loop — allo slot del worker che dà inizio al lavoro:

```cpp
connect(thread, &QThread::started, worker, &Worker::start);
```

Nota che questa connessione è, ancora una volta, tra oggetti su thread diversi (il segnale è emesso *dal* thread gestito appena parte, ma la connect stessa la stai scrivendo dal thread GUI, e comunque il worker vive sul thread gestito) — quindi automaticamente queued, e l'esecuzione di `start()` avviene in sicurezza sul thread giusto.

Per fermare un thread gestito in modo pulito, il metodo corretto è `QThread::quit()` (uno pseudo-sinonimo di `exit(0)`): posta una richiesta di uscita nella coda eventi di quel thread, che l'event loop processa non appena arriva al suo turno, uscendo da `exec()` — a quel punto `run()` ritorna, e il thread di sistema operativo termina naturalmente. Questo è fondamentalmente diverso da `QThread::terminate()`, un metodo che esiste ma che va quasi sempre evitato: forza l'arresto immediato del thread nel punto esatto in cui si trova, senza dargli la possibilità di rilasciare risorse, sbloccare mutex che potrebbe tenere, o completare una scrittura su file a metà — è l'equivalente, in ambito thread, di staccare la spina a un computer invece di spegnerlo dal sistema operativo, e i danni collaterali possibili sono della stessa natura.

Dopo `quit()`, se vuoi essere certo che il thread abbia **davvero** terminato prima di procedere (per esempio, prima di distruggere il worker), chiami `wait()`, che blocca il thread chiamante finché quello gestito non è finito per davvero. È esattamente la sequenza che useremo nel distruttore della nostra finestra tra poco: `thread->quit(); thread->wait();` — prima chiedo gentilmente di uscire, poi aspetto che sia successo davvero, e solo a quel punto è sicuro toccare di nuovo lo stato del worker dal thread GUI.

Un pattern che troverai spessissimo nella documentazione ufficiale e negli esempi Qt, per distruggere in modo sicuro un worker quando il suo thread termina, è questo:

```cpp
connect(thread, &QThread::finished, worker, &QObject::deleteLater);
```

`deleteLater()` non distrugge l'oggetto immediatamente: posta un evento di cancellazione differita nella coda eventi **del thread a cui l'oggetto appartiene in quel momento** — non del thread chiamante — che verrà processato ed eseguito alla prima occasione utile da quell'event loop. È un meccanismo pensato apposta per essere sicuro da chiamare anche da un altro thread, ed è per questo che compare così spesso in codice concorrente Qt.

Ma qui si nasconde una trappola concreta: **se il thread a cui l'oggetto appartiene ha già smesso di eseguire il proprio event loop, quell'evento di cancellazione non verrà mai processato**, e l'oggetto non verrà mai distrutto — un leak silenzioso, nessun crash, nessun avviso, solo memoria che non torna mai indietro. È una situazione sorprendentemente facile in cui cadere: se per errore chiami `quit()` sul thread *prima* che l'evento di `deleteLater()` sia stato processato, o se strutturi l'ordine delle tue connessioni in modo che l'evento di cancellazione arrivi dopo che il thread ha già iniziato a fermarsi, ti ritrovi con un oggetto fantasma che nessuno distruggerà mai.

Nel progetto pratico di oggi **evitiamo deliberatamente questa complicazione**: il nostro worker thread resta vivo per tutta la durata dell'applicazione (è un worker "persistente", non "usa e getta" — ne parliamo tra un momento), e quando la finestra si chiude fermiamo il thread con `quit()` + `wait()` e distruggiamo il worker con una `delete` diretta e ordinaria, che è perfettamente sicura in quel momento preciso perché, dopo che `wait()` è tornato, sei matematicamente certo che nessun altro thread stia più eseguendo codice che tocca quell'oggetto. Il pattern completo con `deleteLater()` per worker "usa e getta" — quelli che nascono, fanno un lavoro, e devono essere smaltiti automaticamente — lo vedremo con tutta l'attenzione che merita più avanti nel percorso, quando parleremo di cancellazione cooperativa e cicli di vita più articolati.

## Worker persistente contro worker usa-e-getta

Un'ultima distinzione concettuale, prima del progetto pratico, perché la incontrerai di nuovo più avanti nel corso: un worker **persistente** è creato una volta, spostato una volta sul suo thread con `moveToThread()`, e da lì riceve, nel corso della vita dell'applicazione, tante richieste di lavoro quante servono, tramite segnali ripetuti — è il pattern che useremo oggi, adatto quando sai che l'utente premerà quel bottone più e più volte nella stessa sessione. Un worker **usa e getta**, al contrario, nasce per fare un singolo lavoro, si spegne (con la sequenza `quit()` + `deleteLater()` di prima) al termine, e se serve un altro calcolo se ne crea uno nuovo da zero. Nessuno dei due è "quello giusto" in senso assoluto: la scelta dipende da quante volte prevedi che quel lavoro debba ripetersi e da quanto costa, in termini di risorse, tenere un thread inattivo in attesa piuttosto che ricrearlo ogni volta — lo stesso principio di granularità già incontrato in precedenza, applicato qui alla scala di un intero thread invece che di una singola istruzione.

## Dalla teoria alle mani sulla tastiera

Hai ora tutto il vocabolario per costruire un worker thread robusto: la differenza tra `QThread` e il thread gestito, il pattern worker + `moveToThread()`, le connessioni queued che rendono la comunicazione tra thread automaticamente sicura, e la sequenza corretta di avvio e spegnimento. Nel prossimo articolo mettiamo tutto insieme, riprendendo esattamente la finestra con il freeze del modulo precedente e curandola sul serio.
