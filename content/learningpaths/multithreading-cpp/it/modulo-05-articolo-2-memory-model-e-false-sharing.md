---
title: "std::atomic, il modello di memoria C++, e il bug di prestazioni che non si vede nel codice"
description: "Multithreading in C++ con Qt — Modulo 5"
---

Tutto il codice sorgente lo puoi trovare [qui](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# std::atomic, il modello di memoria C++, e il bug di prestazioni che non si vede nel codice

Questo articolo affronta il cuore fisico del modulo: `std::atomic` e il **modello di memoria C++**. È un argomento che la maggior parte dei tutorial online spiega male, elencando `memory_order_relaxed`, `acquire`, `release`, `seq_cst` come se fossero opzioni di configurazione arbitrarie da scegliere a sensazione. Qui li spieghiamo partendo da cosa succede *fisicamente* dentro un processore multi-core — cache L1 per core, linee di cache, il protocollo che le tiene coerenti — perché è l'unico modo in cui questi concetti smettono di essere regole da memorizzare e diventano conseguenze ovvie di come è fatto l'hardware su cui giri.

Da lì arriviamo a una conseguenza diretta, e forse la lezione più sorprendente del modulo: due variabili `atomic` completamente indipendenti dal punto di vista logico — nessun thread le usa mai insieme, nessuna invariante le lega — possono comunque rallentarsi a vicenda in modo drammatico, solo per il fatto di stare vicine in memoria. È il **false sharing**.

## Due domande diverse che il codice concorrente pone sempre insieme

Quando due thread condividono una variabile, ci sono in realtà due problemi distinti, e la confusione tra i due è la fonte dell'80% delle incomprensioni sul memory model:

**Atomicità**: l'operazione (una scrittura, un incremento, un confronto-e-scambio) avviene per intero, senza che nessun altro thread possa mai osservarla "a metà". `contatore++` su un `int` normale, come hai visto nel Modulo 0, *non* è atomico: è in realtà tre passi separati (leggi, incrementa, scrivi), e due thread possono intrecciarsi in mezzo a quei tre passi, perdendo un aggiornamento.

**Ordinamento e visibilità**: anche se un'operazione è atomica, resta aperta la domanda "*quando*, esattamente, l'effetto di quella scrittura diventa visibile agli altri thread, e rispetto a quali altre operazioni nel programma è garantito che avvenga prima o dopo?". Questa è una domanda completamente diversa dall'atomicità, e `std::atomic<T>` risolve entrambe — ma con leve di controllo separate, ed è qui che entra `std::memory_order`.

## Perché il problema della visibilità esiste fisicamente: cache L1 per core

![The C++ memory model: per-core L1 caches and the coherence problem](modulo-05/22-cpp-memory-model.png)

Un processore moderno multi-core non legge e scrive la memoria principale (la RAM) direttamente a ogni istruzione: sarebbe troppo lento, di ordini di grandezza, rispetto alla velocità con cui la CPU esegue istruzioni. Ogni core ha una propria **cache L1**, piccola (tipicamente 32-64 KB) ma velocissima (pochi cicli di clock contro le centinaia necessari per raggiungere la RAM), in cui tiene copie locali dei dati che sta usando.

Il problema è immediato e fisico, non è un dettaglio implementativo che si può ignorare: se il Thread A, in esecuzione sul Core 1, scrive `x = 1`, quella scrittura per prima cosa aggiorna la cache L1 del Core 1 — **non** la RAM condivisa, non subito, e non necessariamente mai in un ordine che tu controlli direttamente scrivendo `x = 1` in C++. Se nello stesso istante il Thread B, sul Core 2, legge `x` dalla propria cache L1, può benissimo leggere ancora `0` — la copia vecchia, perché la sua cache non ha alcun motivo automatico di sapere che il Core 1 ha appena cambiato idea, finché un meccanismo esplicito non glielo comunica. Questo non è un bug del processore: è il prezzo fisico, accettato deliberatamente dai progettisti di hardware, per avere cache locali veloci invece di un accesso condiviso lento a tutto.

I processori moderni risolvono questo con un **protocollo di coerenza della cache** (il più diffuso si chiama MESI, dalle iniziali dei quattro stati che una riga di cache può assumere — Modified, Exclusive, Shared, Invalid) che tiene le cache dei vari core allineate tra loro *quando serve*. Ma "quando serve" è precisamente ciò che tu, come programmatore, devi specificare — e lo specifichi scegliendo il `memory_order` delle tue operazioni atomiche. Senza quella specifica esplicita, il compilatore e la CPU hanno entrambi la libertà di riordinare le operazioni di lettura e scrittura in modi che, su codice a thread singolo, non cambierebbero mai il risultato osservabile (è la stessa libertà che nel Modulo 0 hai visto usata dal compilatore per tenere una variabile non protetta in un registro, mascherando la race) — ma che su codice multi-thread possono produrre risultati che il tuo ordine di scrittura nel sorgente non prevedeva affatto.

## Cosa garantisce std::atomic sull'atomicità: come funziona a livello hardware

Su una CPU x86-64 — la famiglia di processori più comune sui desktop e sui server, quasi certamente quella su cui compilerai ed eseguirai il progetto guidato — un'operazione come `fetch_add` su un `std::atomic<int>` si traduce tipicamente in una singola istruzione macchina con il prefisso `LOCK` (per esempio `LOCK XADD`), che dice al bus di memoria e al protocollo di coerenza cache: "questa operazione di lettura-modifica-scrittura deve avvenire come un unico blocco indivisibile, nessun altro core può inserirsi nel mezzo". Su architetture diverse (ARM, molto comune nei sistemi embedded) il meccanismo cambia forma — tipicamente una coppia di istruzioni load-linked/store-conditional (LL/SC) che rileva se qualcun altro ha toccato la stessa locazione nel frattempo e, se sì, ritenta — ma la garanzia finale che lo standard C++ ti offre è identica: `fetch_add`, `compare_exchange`, e le altre operazioni read-modify-write di `std::atomic` sono indivisibili, qualunque sia l'hardware sotto.

## memory_order_relaxed: solo atomicità, zero garanzie di ordine

```cpp
atomicCounter.fetch_add(1, std::memory_order_relaxed);
```

`relaxed` ti dà la prima garanzia (l'operazione è indivisibile — nessun aggiornamento va perso, mai) e **non ti dà nient'altro**. Non promette nulla su quando quell'incremento diventerà visibile ad altri thread, né su come si relaziona nel tempo con altre letture o scritture, atomiche o no, che lo stesso thread ha fatto prima o dopo. È la scelta giusta quando l'unica cosa che ti interessa è un conteggio numerico corretto — un contatore di statistiche, un contatore di eventi — e nessun'altra parte del programma deve dedurre nulla dal *momento* in cui quell'incremento è avvenuto rispetto ad altro.

## acquire/release: il ponte "happens-before" tra due thread

```cpp
// Thread A: prepares the data, then publishes it
data.x = 42;
data.y = "result";
// "release": publish everything that precedes
readyFlag.store(true, std::memory_order_release);

// Thread B: waits, then consumes
// "acquire": makes everything before the release visible
while (!readyFlag.load(std::memory_order_acquire)) { }
// guaranteed to see the values written above, not stale ones
readData(data.x, data.y);
```

Il meccanismo è quello che nella letteratura si chiama relazione **happens-before**: una `store` con `memory_order_release` funziona come una barriera che dice "tutte le scritture in memoria fatte da questo thread *prima* di questa istruzione devono essere visibili a chiunque, su un altro thread, osservi *questo stesso valore* tramite una `load` con `memory_order_acquire`". È letteralmente l'analogia del lucchetto che il nome suggerisce: `release` è come chiudere un lucchetto e lasciarlo dove un altro può trovarlo, `acquire` è come raccoglierlo e aprirlo — e nel momento in cui lo apri, tutto quello che era "dentro la stanza" prima che il primo lo chiudesse è garantito visibile a te.

## memory_order_seq_cst: la scelta di default, e perché lo è

`seq_cst` (sequentially consistent) dà tutte le garanzie di `acquire`/`release` **più** una in aggiunta, più forte: tutte le operazioni `seq_cst` di tutti i thread del programma appaiono avvenire in un unico ordine totale, lo stesso identico ordine visto da ogni thread che le osserva. È il modello di ragionamento più vicino a "il programma esegue le istruzioni una alla volta, alternandosi tra i thread in un qualche ordine" — l'intuizione ingenua che probabilmente avevi in mente fin dall'inizio, resa qui una garanzia reale. Il prezzo è un extra di sincronizzazione hardware quasi sempre piccolo sulle CPU x86-64 moderne, ma non nullo.

La raccomandazione pratica: **usa `seq_cst` (il default) a meno che tu non abbia una ragione misurata e specifica per scendere a un ordinamento più debole**. `relaxed` e `acquire`/`release` sono strumenti reali, usati nel codice dei motori di gioco, dei database, dei sistemi operativi — ma richiedono un ragionamento formale e disciplinato su ogni singolo utilizzo. `seq_cst` non è "la versione pigra": è la versione in cui il tuo ragionamento mentale corrisponde davvero a una garanzia del linguaggio.

## Il paradosso apparente del false sharing

Ecco un fatto che, la prima volta che lo vedi misurato, sembra rompere l'intuizione: due variabili `std::atomic<int>`, usate da due thread diversi, senza che nessuno dei due tocchi mai la variabile dell'altro, possono rallentarsi a vicenda drasticamente. Nessuna corsa critica, nessuna violazione di correttezza, nessun `memory_order` sbagliato: il programma calcola il risultato giusto in entrambi i casi. Il problema è puramente di prestazioni, ed è tutto nella fisica appena vista, applicata a un dettaglio che sembra irrilevante: dove nella memoria, esattamente, vivono le due variabili l'una rispetto all'altra.

Le cache non spostano dati un byte alla volta, né una variabile alla volta. Si muovono a blocchi di dimensione fissa chiamati **righe di cache** (cache line), tipicamente di 64 byte sulle CPU x86-64 moderne — un valore fisico dell'hardware, non una scelta del compilatore. Quando un core legge anche un solo byte da un indirizzo, l'hardware carica in cache l'intera riga di 64 byte che lo contiene — e il protocollo di coerenza cache lavora anch'esso a livello di riga intera, non di singola variabile.

Due `std::atomic<int>` da 4 byte ciascuno, dichiarati uno di seguito all'altro in una struct, occupano una minuscola frazione dei 64 byte di una riga, quindi il compilatore, senza nessuna istruzione contraria, li piazza vicini in memoria — ed è del tutto plausibile che finiscano nella stessa riga di cache. Ora il Thread A esegue `a.fetch_add(1)`: per eseguirla il suo core deve avere accesso esclusivo alla riga di cache che contiene `a`, secondo il protocollo MESI. E quella riga contiene anche `b`. Il risultato: la scrittura di A sulla propria variabile invalida silenziosamente la copia della riga che il Core di B teneva in cache — anche se B non ha mai letto né scritto `a`. È **contesa fantasma**, generata non da un accesso reale allo stesso dato, ma dalla condivisione fisica accidentale della riga di cache che li contiene entrambi.

## La cura: alignas(64)

```cpp
struct alignas(64) PaddedCounter {
    std::atomic<int> value{0};
    // fills the rest of the line, deliberately unused
    char padding[64 - sizeof(std::atomic<int>)];
};
```

`alignas(64)` dice al compilatore: "ogni istanza di questa struct deve iniziare a un indirizzo di memoria multiplo di 64" — cioè all'inizio di una riga di cache. Il campo `padding`, un array di byte che non verrà mai letto né scritto da nessuno, esiste con l'unico scopo di occupare lo spazio rimanente della riga, impedendo al compilatore di piazzarci accanto qualcos'altro.

![False sharing: two independent atomics sharing one 64-byte cache line, and the alignas(64) fix](modulo-05/23-false-sharing-cache-line.png)

È un compromesso esplicito e va riconosciuto come tale: stai *sprecando* memoria (60 byte inutilizzati per ogni `int` da 4 byte che vuoi proteggere) per *guadagnare* velocità evitando l'invalidazione incrociata. Per due contatori è un costo irrisorio; se stessi imbottendo migliaia di piccole strutture in un array enorme, quel compromesso andrebbe pesato con più attenzione.

## Lock-free vs mutex: quando conviene, quando no

Con la fisica della cache alle spalle, sei attrezzato per rispondere a una domanda che il Modulo 2 aveva lasciato aperta: se `std::atomic` può essere più veloce di un mutex per un'operazione semplice — e il progetto guidato del prossimo articolo te lo dimostrerà con numeri reali — perché non sostituire *sempre* i mutex con atomici?

Un `std::atomic<T>` ti garantisce l'atomicità di una singola operazione su una singola variabile. Il momento in cui il tuo problema richiede di aggiornare **più variabili correlate come se fossero un'unica operazione indivisibile** — l'invariante classica del Modulo 2, dove per esempio inserire in una coda significa sia aggiungere l'elemento sia aggiornare il conteggio degli elementi — un atomico da solo non basta più. Potresti costruire un algoritmo lock-free che gestisce quel caso, tipicamente basato su `compare_exchange` in cicli di retry con tecniche non banali per evitare l'*ABA problem* — ma è codice notoriamente difficile da scrivere correttamente, difficile da rivedere, e difficile da testare, perché i bug che introduce sono spesso rarissimi e dipendenti dal timing esatto tra i core. Per la stragrande maggioranza del codice applicativo reale, un `QMutex` che protegge l'intera invariante multi-variabile resta la scelta più corretta, più leggibile, e più facile da mantenere.

È una semplificazione fin troppo comune, e va corretta esplicitamente: un algoritmo lock-free non è automaticamente più veloce di uno basato su mutex. Sotto bassa contesa, un mutex moderno su Linux (basato su futex, che nel caso comune evita del tutto una chiamata di sistema) e un atomico si comportano in modo molto simile in termini di costo. Sotto alta contesa, un'operazione atomica singola tende a restare più economica di un lock/unlock completo, perché evita il coinvolgimento dello scheduler quando il thread perde la "gara": semplicemente ritenta, invece di essere messo in pausa e risvegliato più tardi. Ma se l'operazione protetta è complessa, un algoritmo lock-free equivalente diventa rapidamente più costoso da progettare, più costoso da eseguire e molto più rischioso da certificare corretto di quanto lo sia un mutex ben piazzato.

![Mutex vs lock-free atomics: two tools with different cost and risk profiles, not a ranking](modulo-05/24-lockfree-vs-mutex-tradeoff.png)

La regola pratica che vale la pena portarsi via: parti sempre da `QMutex` (o `std::mutex`) come default per qualunque stato condiviso complesso o multi-variabile. Prendi in considerazione `std::atomic` solo per un caso specifico e ristretto — un contatore, un flag booleano, un puntatore condiviso in un pattern ben noto — e solo dopo aver **misurato** che quella sezione è davvero un collo di bottiglia sotto contesa reale, non per intuizione.

Con il memory model, il false sharing e il confronto lock-free/mutex ora chiari, il prossimo articolo mette tutto alla prova con un progetto guidato: due benchmark reali che misurano questi effetti con un cronometro vero, e ThreadSanitizer a verificare che nessuna delle due versioni nasconda una race.
