---
title: "La sezione critica formalizzata: QMutex, QMutexLocker e QReadWriteLock"
description: "Multithreading in C++ con Qt — Modulo 2"
---

# La sezione critica formalizzata: QMutex, QMutexLocker e QReadWriteLock

Nel modulo precedente hai imparato a far girare del lavoro su un thread separato e a farlo comunicare con la GUI in sicurezza — ma se ci fai caso, non hai mai avuto bisogno di un mutex vero e proprio. Il worker e la finestra non toccavano mai la stessa variabile nello stesso momento: si scambiavano messaggi tramite segnali, e Qt si occupava di consegnarli in coda, uno alla volta, senza sovrapposizioni. È un modo elegante di evitare il problema della memoria condivisa evitando, appunto, di condividerla — un worker isolato, con il proprio stato privato, che parla con l'esterno solo tramite segnali.

Questo articolo affronta il caso in cui quell'eleganza non basta più: due o più thread che devono davvero leggere e scrivere la **stessa struttura dati**, nello stesso momento, perché è proprio quella condivisione lo scopo del programma — non un effetto collaterale da evitare. È il caso classico, antichissimo nella storia dei sistemi operativi eppure ancora oggi il pane quotidiano di chi scrive software concorrente sul serio: il **produttore-consumatore**. Un thread genera dati a un ritmo che non controlla del tutto (un sensore, una rete, in un sistema di visione una telecamera che consegna frame a un certo framerate); un altro li elabora a un ritmo diverso, quasi sempre più lento e variabile. Tra i due, un magazzino di capacità limitata — il **buffer** — che assorbe le differenze di velocità, fino a un certo punto: se il produttore corre troppo, il magazzino si riempie e deve aspettare; se il consumatore è a corto di lavoro, aspetta lui.

## La sezione critica, formalizzata

Hai già visto la sezione critica come "il tratto di codice che deve eseguire un thread alla volta". È utile pensarla come un corridoio con una sola porta, largo esattamente quanto basta per una persona. Chi arriva e trova la porta occupata aspetta in fila fuori; chi è dentro esce quando ha finito, e solo allora il prossimo della fila può entrare.

![The critical section as a one-way corridor](img/modulo-02/09-critical-section-corridor.png)

Ma "un thread alla volta" da solo non basta a definire una soluzione *corretta*, e vale la pena mettere per iscritto, una volta, le tre proprietà che la teoria classica dei sistemi operativi richiede a qualunque meccanismo di sincronizzazione — perché ogni strumento che vedremo in questo modulo va giudicato rispetto a queste tre, non solo rispetto a "funziona nei miei test".

**Mutua esclusione**: mai più di un thread dentro la sezione critica nello stesso istante. È la proprietà più ovvia, quella su cui ci siamo già soffermati in precedenza, e nessuno strumento che vedremo oggi la viola mai — è il minimo sindacale.

**Progresso**: se la sezione critica è libera e uno o più thread vogliono entrarci, la decisione di chi entra non può essere rimandata all'infinito da fattori che non hanno a che fare con l'uso reale della risorsa. In parole povere: non deve esistere uno scenario in cui la porta è libera ma nessuno riesce mai a passare per un difetto del meccanismo stesso.

**Attesa limitata**: un thread che aspetta di entrare deve, prima o poi, riuscirci — non è ammesso che qualcun altro continui a scavalcarlo indefinitamente. Questa è la proprietà più sottile, ed è precisamente quella che va in crisi nei problemi di **starvation** (digiuno) che incontriamo più avanti: un thread tecnicamente potrebbe entrare, la garanzia di mutua esclusione non è mai violata, eppure di fatto non gli tocca mai perché il "traffico" nella sezione critica lo scavalca sempre.

Tieni a mente queste tre proprietà come metro di giudizio: ogni volta che progetti uno schema di sincronizzazione — in questo modulo o nel tuo lavoro reale — sono le tre domande da farti, nell'ordine.

## QMutex e QMutexLocker: lo strumento di base

`QMutex` è l'equivalente nativo di Qt di `std::mutex`, che hai già usato nel primo articolo di questo corso. Il funzionamento concettuale è identico — `lock()` entra nella sezione critica (aspettando se necessario), `unlock()` ne esce — con qualche differenza pratica che vale la pena conoscere.

Non è ridondanza gratuita che Qt abbia il proprio mutex. `QMutex` esisteva in Qt da prima che `std::mutex` diventasse parte dello standard C++ (arrivato solo con C++11), e oggi resta la scelta naturale in codice Qt per un paio di ragioni concrete: si integra meglio con gli strumenti di debug di Qt Creator (che sa ispezionare lo stato di un `QMutex` nel debugger in modo più leggibile), e soprattutto Qt offre, distinta da `QMutex`, una classe `QRecursiveMutex` per i (rari, e da usare con sospetto) casi in cui un thread deve poter acquisire più volte lo stesso lock senza bloccarsi da solo — utile in gerarchie di chiamate ricorsive che passano più volte per la stessa sezione critica, ma anche un campanello d'allarme quasi sempre sintomo di un progetto della sincronizzazione che si potrebbe semplificare.

Esattamente come `std::lock_guard`, `QMutexLocker` acquisisce il lock nel costruttore e lo rilascia nel distruttore:

```cpp
void SharedBuffer::produce(int value) {
    QMutexLocker locker(&m_mutex);
    // ... critical section ...
} // automatic unlock here, whichever way the function exits
```

Il vantaggio del pattern RAII qui non è solo estetico: se dentro la sezione critica c'è un `return` anticipato, o se venisse lanciata un'eccezione, `QMutexLocker` garantisce comunque lo sblocco — un `mutex.lock()` / `mutex.unlock()` scritti a mano ti lascerebbero con un mutex bloccato per sempre in ognuno di quei casi, uno dei bug più subdoli e difficili da diagnosticare in tutta la programmazione concorrente, perché il sintomo (il programma si blocca) appare molto lontano, nel tempo e nel codice, dalla causa (l'`unlock()` mancante).

Oltre a `lock()` (bloccante, aspetta quanto serve), `QMutex` offre `tryLock()`, che tenta di acquisire il lock e ritorna immediatamente con `true` o `false` a seconda che ci sia riuscito, senza mai bloccarsi — utile quando il tuo thread ha un'alternativa sensata da fare se la risorsa è occupata, invece di mettersi in coda. Esiste anche una variante con timeout, `tryLock(milliseconds)`, che aspetta al massimo il tempo indicato prima di arrendersi. Non li useremo nel progetto pratico di questo modulo — il nostro produttore e consumatore *devono* aspettare, non hanno un piano B — ma li ritroverai naturalmente il giorno in cui progetterai codice con vincoli di responsività più stringenti.

## QReadWriteLock: quando la maggior parte del traffico è in lettura

C'è uno scenario molto comune in cui `QMutex` è più restrittivo del necessario: quando un dato condiviso viene **letto** molto spesso da più thread e **scritto** raramente. Pensa a una tabella di configurazione o a una mappa di calibrazione di un sistema di visione, caricata una volta e poi consultata continuamente da più thread di elaborazione: con un `QMutex` ordinario, anche due letture — operazioni che, da sole, non si disturbano mai a vicenda, perché nessuna delle due modifica nulla — sarebbero costrette a mettersi in fila una dietro l'altra, sprecando parallelismo che l'hardware ti offrirebbe gratis.

`QReadWriteLock` distingue esplicitamente le due intenzioni. Quando più thread vogliono solo **leggere**, possono farlo tutti insieme, nello stesso momento — nessuno dei due si blocca a vicenda, perché una lettura non altera lo stato che un'altra lettura sta osservando. Nel momento in cui un thread vuole **scrivere**, invece, la lock diventa esclusiva nel senso più stretto: nessun altro thread, lettore o scrittore che sia, può accedere al dato finché lo scrittore non ha finito.

![QReadWriteLock: concurrent reads, exclusive write](img/modulo-02/12-readwritelock-readers-writer.png)

L'uso pratico ricalca lo stesso spirito RAII già visto: `QReadLocker` per acquisire in lettura, `QWriteLocker` per acquisire in scrittura, entrambi con rilascio automatico a fine scope.

```cpp
double readCalibration(int index) const {
    QReadLocker locker(&m_lock);
    return m_calibrationValues.at(index);
}

void updateCalibration(int index, double newValue) {
    QWriteLocker locker(&m_lock);
    m_calibrationValues[index] = newValue;
}
```

Una parola di cautela, perché è un errore concettuale comune: `QReadWriteLock` **non è sempre più veloce** di `QMutex`, anche in scenari a lettura prevalente. Il meccanismo che tiene il conto di "quanti lettori sono dentro in questo momento" ha un costo interno non nullo, e per sezioni critiche molto brevi (poche istruzioni) quel costo di contabilità può superare il beneficio del parallelismo guadagnato — la stessa lezione di granularità già incontrata a proposito dei context switch, riapplicata qui: la scelta giusta dipende da quanto tempo si passa davvero dentro la sezione critica e da quanto è squilibrato il traffico tra letture e scritture, non da un'intuizione generica su quale primitiva "suona" più efficiente.

## Cosa resta da capire

Con `QMutex`, `QMutexLocker` e `QReadWriteLock` sai già come proteggere un dato condiviso da accessi simultanei. Ma il produttore-consumatore ha bisogno di qualcosa di più sottile: non solo "posso entrare?", ma "devo aspettare che *cambi qualcosa*, non solo che il lock si liberi". È il tema del prossimo articolo, insieme ai pericoli classici — deadlock, starvation, inversione di priorità — che ogni sincronizzazione seria deve saper riconoscere.
