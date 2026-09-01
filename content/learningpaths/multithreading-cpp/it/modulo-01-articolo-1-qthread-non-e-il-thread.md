---
title: "QThread non è il thread: è un telecomando (e perché sottoclassarlo inganna)"
description: "Multithreading in C++ con Qt — Modulo 1"
---

# QThread non è il thread: è un telecomando (e perché sottoclassarlo inganna)

Nell'articolo precedente hai visto il problema con i tuoi occhi: un bottone che, cliccato, ferma il battito della finestra per qualche secondo, perché lo slot che reagisce al click esegue un calcolo pesante direttamente sul thread che possiede l'event loop della GUI. Questo articolo comincia la cura, e vale la pena essere onesti su una cosa fin da subito: `QThread` è probabilmente la classe di tutta la libreria Qt più fraintesa nella sua storia, non per colpa di chi la usa, ma per un incidente storico preciso. Per anni, la stessa documentazione ufficiale di Qt e i suoi esempi hanno insegnato un modo di usarla che, in un articolo del 2010 diventato leggendario nella comunità Qt, un ingegnere del team Qt in persona ha pubblicamente intitolato *"You're doing it wrong"* — "lo stai facendo nel modo sbagliato" — riferendosi al modo in cui persino gli esempi ufficiali del framework la presentavano fino ad allora. Se hai già letto in giro, o ricordi da qualche tutorial visto anni fa, che "per usare QThread devi crearne una sottoclasse e sovrascrivere `run()`", non è colpa tua se sembrava la via naturale: era, letteralmente, quello che Qt stesso insegnava.

## QThread non è "il thread": è un telecomando

Parti da un errore di intuizione talmente comune che vale la pena smontarlo subito, prima di scrivere una sola riga di codice: quando crei un oggetto `QThread`, quell'oggetto **non è** il thread di sistema operativo. È un `QObject` — una classe C++ come tante altre, con il suo costruttore, i suoi metodi, la sua posizione nell'albero di parentela di Qt — che **rappresenta e controlla** un thread di sistema operativo, un po' come il telecomando di un televisore non è il televisore: lo accendi, lo spegni, gli cambi canale, ma il telecomando stesso se ne sta comodamente sul tuo divano, non dentro l'apparecchio.

Quando scrivi `QThread *thread = new QThread(this);` dentro, poniamo, il costruttore della tua `MainWindow`, quell'istanza di `QThread` **nasce e vive nel thread in cui l'hai creata** — quasi sempre il thread principale della GUI, esattamente come qualunque altro `QObject` che costruisci lì. Ha una manciata di metodi che sono il suo "pannello di controllo": `start()` per far partire il thread di sistema operativo che gestisce, `quit()` per chiedergli di fermare gentilmente il proprio event loop, `wait()` per bloccarsi finché quel thread non ha davvero terminato, `isRunning()` per interrogarne lo stato. Chiamare questi metodi è sicuro dal thread principale proprio perché l'oggetto `QThread` in sé vive lì.

![QThread is not the thread: it's a remote control](modulo-01/05-qthread-is-a-remote-control.png)

Quando chiami `thread->start()`, succede una cosa distinta e separata: Qt effettua la chiamata di sistema che crea davvero un nuovo thread di sistema operativo (lo stesso meccanismo di fondo di `std::thread`, già incontrato in precedenza), e in quel nuovo thread fa partire l'esecuzione del metodo virtuale `QThread::run()`. Se non l'hai sovrascritto — e nel pattern che adotteremo in questo articolo non lo sovrascriveremo mai — l'implementazione di default di `run()` fa semplicemente una cosa: chiama `exec()`, cioè avvia un **event loop** su quel nuovo thread, concettualmente identico a quello che il thread principale avvia con `QApplication::exec()` quando l'applicazione parte. Da questo momento, quel thread di sistema operativo esiste per uno scopo preciso: aspettare eventi (in questo caso, quasi sempre segnali in arrivo da altri thread) e processarli uno alla volta, in ordine — proprio come il thread della GUI, solo che ora questo secondo event loop gira su un thread completamente separato.

## Il pattern vecchio: sottoclassare QThread (e perché inganna)

L'istinto naturale, quando vuoi far girare del codice su un thread separato usando una classe orientata agli oggetti come `QThread`, è questo: creo una mia classe che eredita da `QThread`, ci metto dentro la logica che deve girare sul thread separato, magari anche qualche slot per ricevere comandi. In codice:

```cpp
class MyThread : public QThread {
    Q_OBJECT
public:
    void run() override {
        // heavy work here
    }

public slots:
    void otherMethod() {
        // ... here comes the surprise
    }
};
```

Questo codice compila, e la parte dentro `run()` esegue esattamente dove ti aspetti: sul thread di sistema operativo gestito da questa istanza, perché `run()` è precisamente il metodo che Qt invoca su quel thread appena parte. Fin qui, tutto secondo intuizione. Il problema, quello che ha generato l'articolo "You're doing it wrong" e anni di bug report confusi sui forum Qt, riguarda `otherMethod()`: è uno slot dichiarato nella stessa classe, ma **non esegue affatto sul thread gestito da questa istanza**. Esegue sul thread che **possiede** l'oggetto `MyThread` stesso — cioè, quasi sempre, il thread principale che lo ha creato con `new MyThread()`. La ragione è la stessa di prima: un `QObject` (e `QThread` è comunque un `QObject`, con tutta l'infrastruttura di segnali e slot che questo comporta) esegue i propri slot sul thread a cui **appartiene** — la sua thread affinity — non sul thread che eventualmente gestisce come "contenuto" di `run()`. `run()` è un caso speciale, l'unico metodo che Qt garantisce esegua davvero sul thread gestito; ogni altro slot della stessa classe segue la regola generale, non quell'eccezione.

Storicamente, questo ha portato sviluppatori a scrivere codice che sembrava funzionare nei casi semplici — quando l'unica cosa che serve è far girare un blocco di calcolo isolato, senza bisogno di ricevere comandi successivi via segnali — e a rompersi silenziosamente nel momento in cui quel thread doveva anche reagire a eventi esterni durante l'esecuzione, con race condition o comportamenti inspiegabili che nessuno sapeva diagnosticare senza aver letto, appunto, quell'articolo del 2010.

## Il pattern raccomandato: worker object e moveToThread()

La soluzione che la comunità Qt (e oggi la documentazione ufficiale stessa) raccomanda capovolge l'approccio: **non sottoclassare mai `QThread`**. Usala sempre così com'è, identica in ogni progetto — il telecomando di prima, senza modifiche. La logica di business, invece, va in una classe separata che eredita solo da `QObject` — la chiamiamo convenzionalmente il **worker** — e che non sa nulla, né le importa nulla, di thread o di `QThread`. È un pezzo di logica puro. Poi, un singolo metodo fa tutta la magia:

```cpp
worker->moveToThread(thread);
```

`moveToThread()` cambia la **thread affinity** dell'oggetto `worker`: da questo momento, quell'oggetto "appartiene" a `thread` invece che al thread che lo aveva creato, e — questa è la parte che conta — **ogni suo slot, chiamato tramite una connessione queued, eseguirà sul thread gestito da `thread`**, senza eccezioni, senza casi particolari da ricordare a memoria.

![Thread affinity before and after moveToThread](modulo-01/08-thread-affinity-before-after.png)

C'è un vincolo tecnico da conoscere, perché lo incontrerai nel progetto pratico tra poco: un `QObject` **con un genitore** (nel senso dell'albero di parentela di Qt, `new Worker(this)`) **non può essere spostato** con `moveToThread()` — la chiamata fallisce silenziosamente con un avviso a runtime, non un errore di compilazione, il che la rende un'insidia facile da non notare. Il motivo è logico una volta che ci pensi: l'albero di parentela di Qt presume che un genitore e i suoi figli vivano sullo stesso thread (è così che funziona, per esempio, la distruzione a cascata); spostare un figlio su un thread diverso da quello del genitore romperebbe questa garanzia. La conseguenza pratica è che il tuo worker va costruito **senza genitore** — `new PrimeCalculator()`, non `new PrimeCalculator(this)` — e la sua vita gestita esplicitamente da te, come vedremo nel prossimo articolo a proposito del ciclo di vita.

![Comparing the two patterns: subclassing QThread versus worker plus moveToThread](modulo-01/07-subclass-vs-movetothread-comparison.png)

Con questo pattern, `QThread` resta un oggetto anonimo e mai personalizzato, riusabile identico in ogni progetto Qt che scriverai da qui in avanti; è il worker, una normalissima classe `QObject` con i suoi slot e segnali, a portare tutta la logica — ed **ogni** suo slot, senza eccezioni da ricordare, esegue correttamente sul thread gestito. È precisamente il pattern che costruiamo insieme nel progetto pratico di questo modulo.

## Cosa resta da capire

Sai ora la differenza tra l'oggetto `QThread` e il thread che gestisce, e perché sottoclassare `QThread` è quasi sempre la scelta sbagliata rispetto al pattern worker + `moveToThread()`. Resta una domanda pratica ovvia: se il worker ora vive su un thread diverso, come faccio a dirgli "inizia il calcolo" dal thread della GUI, e come faccio a farmi dire da lui "ho finito" tornando sulla GUI, senza reintrodurre le race condition che abbiamo studiato? È il tema del prossimo articolo, insieme al ciclo di vita completo di un worker thread — e poi, finalmente, alle mani sulla tastiera per curare sul serio il freeze del modulo precedente.
