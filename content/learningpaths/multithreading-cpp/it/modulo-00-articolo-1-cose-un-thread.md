---
title: "Cos'è davvero un thread (e perché all'improvviso ti serve saperlo)"
description: "Multithreading in C++ con Qt — Modulo 0"
---

# Cos'è davvero un thread (e perché all'improvviso ti serve saperlo)

C'è un momento, nella vita di chi programma, in cui `QtConcurrent::run` smette di sembrare magia. Prima di quel momento funziona e basta: passi una funzione, quella parte "da qualche parte", il risultato arriva, tutti contenti. Il problema è che "ha funzionato" e "ho capito perché ha funzionato" sono due frasi molto diverse, e la differenza si paga quasi sempre nel momento peggiore possibile — un venerdì sera, in produzione, con un crash che non riesci a riprodurre a comando perché dipende da come lo scheduler del sistema operativo ha deciso, in quel preciso istante, di intrecciare i tuoi thread. Non c'è modo di aggirare questo problema con più esperienza in altre aree della programmazione: un bug di logica sequenziale è deterministico, lo vedi sempre uguale; un bug di concorrenza è, per natura, capriccioso.

Questo articolo non tocca ancora una riga di codice Qt. È voluto: prima di guardare come Qt risolve i problemi della concorrenza, vale la pena capire cosa sono davvero quei problemi, a nudo, senza nessun framework sopra a nascondere i meccanismi. Se prima capisci il vincolo fisico, ogni scelta di design che troverai più avanti nel percorso smette di sembrarti arbitraria.

## Un processo non fa nulla da solo

Quando lanci un programma, il sistema operativo crea un **processo**: uno spazio di indirizzamento, un blocco di memoria virtuale che il programma crede tutto suo, isolato da ogni altro processo in esecuzione sulla stessa macchina. Se il tuo programma scrive all'indirizzo `0x1000` e un altro processo scrive anche lui a `0x1000`, non c'è alcun conflitto: sono due indirizzi *virtuali*, tradotti dalla MMU della CPU verso due pagine di memoria fisica completamente diverse. Questo isolamento è uno dei regali più importanti che un sistema operativo moderno ti fa: un processo che va in crash, in condizioni normali, non si porta dietro gli altri.

Ma dentro quello spazio isolato, il processo da solo non esegue nulla. Serve qualcosa che faccia effettivamente avanzare le istruzioni, una alla volta. Quel qualcosa è il **thread**. Per decenni un processo aveva esattamente un thread, e il concetto di "thread" separato dal processo nemmeno esisteva, perché non serviva. È nato quando si è capito un problema molto pratico: creare un processo intero — nuovo spazio di indirizzamento, nuove tabelle di pagina, nuovi handle a file — è un'operazione costosa, e se tutto quello che vuoi è "esegui più cose insieme, condividendo gli stessi dati", duplicare l'intero processo è uno spreco enorme. Serviva un'unità di esecuzione più leggera, capace di condividere lo spazio di indirizzamento invece di duplicarlo. Non a caso, nella letteratura più vecchia, il thread viene chiamato letteralmente "lightweight process".

![Process and thread: what is private and what is shared](modulo-00/01-process-vs-thread.png)

Ogni thread all'interno dello stesso processo condivide con tutti gli altri thread lo **heap** (la memoria che allochi dinamicamente), le **variabili globali e statiche**, i **file aperti** e il **segmento di codice**. Questa è la parte comoda: due thread si scambiano dati semplicemente leggendo e scrivendo la stessa variabile, senza bisogno dei meccanismi pesanti che servirebbero a due processi separati per comunicare.

Ma ogni thread ha anche una fetta di stato **privata**, che nessun altro thread tocca mai direttamente: lo **stack**, dove vivono le variabili locali e gli indirizzi di ritorno; i **registri della CPU**, con i valori su cui il thread sta calcolando in questo preciso istante; il **program counter**, che indica la prossima istruzione da eseguire. Se due thread eseguono la stessa funzione nello stesso momento, ciascuno ha il proprio stack con le proprie variabili locali — nessuna interferenza lì. Ecco perché una funzione che non tocca stato condiviso è automaticamente sicura da chiamare da più thread insieme: si dice **thread-safe per costruzione**, o **rientrante**.

Fissa bene questo punto, perché è la radice di tutto quello che segue in questo percorso: **la condivisione di heap e variabili globali non è un dettaglio implementativo, è la ragione d'essere del thread**. Ed è, esattamente, la fonte di ogni bug di concorrenza che incontrerai. Un thread è utile perché condivide memoria senza attrito; un thread è pericoloso per lo stesso identico motivo. Ogni tecnica che vedrai più avanti — mutex, wait condition, atomics, le connessioni queued di Qt — è un modo di disciplinare questa condivisione, non di eliminarla (eliminarla vorrebbe dire tornare a processi separati, perdendo il vantaggio che ci ha fatto scegliere i thread).

Un'ultima cosa prima di andare avanti: chi crea davvero il thread non sei tu, è il sistema operativo. Quando scrivi `std::thread t(function);`, sotto al cofano parte una vera chiamata di sistema — `clone()` su Linux, `CreateThread()` su Windows — e quello che ottieni è un **thread di sistema operativo** (kernel thread). È lo scheduler del kernel a decidere quando quel thread gira davvero sulla CPU. La libreria standard C++ non reinventa un proprio scheduler: si appoggia direttamente su quello del sistema operativo, e lo stesso farà `QThread` che vedremo nel prossimo articolo.

## La fine della corsa alla frequenza, e perché oggi i core si moltiplicano

Per capire perché oggi devi saper scrivere codice multithread se vuoi davvero sfruttare l'hardware, bisogna tornare indietro fino al 2004-2005, quando è cambiata una regola data per scontata per trent'anni: ogni nuova generazione di processori era semplicemente più veloce in frequenza, e il tuo programma, identico, girava più veloce senza cambiare una riga. Poi quella corsa si è fermata, per un motivo puramente fisico. La potenza dinamica dissipata da un circuito segue, in prima approssimazione, questa relazione:

$$P \;\propto\; C \cdot V^2 \cdot f$$

dove $C$ è la capacità elettrica del circuito, $V$ la tensione di alimentazione e $f$ la frequenza di clock. Il problema è che, per far girare i transistor più velocemente (più *f*), serve anche più tensione $V$ perché i segnali si stabilizzino in tempo — e siccome $V$ compare al quadrato, la potenza dissipata (che diventa quasi tutta calore) cresce molto più che linearmente con la frequenza. Verso il 2005 i produttori hanno sbattuto contro un muro termico reale: salire ancora in frequenza avrebbe significato dissipare più calore di quanto un dissipatore ragionevole potesse smaltire. Questo fenomeno è passato alla storia come **power wall**.

La risposta dell'industria è stata cambiare strategia: invece di un solo core sempre più veloce, più core, ciascuno a frequenza moderata. È il motivo per cui oggi qualunque CPU — dal telefono al server — ha 4, 8, 16 o più core fisici. E questo cambio ha una conseguenza scomoda per chi scrive software: **un programma a singolo thread non trae alcun beneficio dagli altri core**. Gira su uno solo, esattamente come vent'anni fa, mentre gli altri restano inutilizzati per quel programma. Se vuoi sfruttare davvero l'hardware multicore che hai comprato, devi scrivere software che possa dividere il proprio lavoro tra più thread eseguibili in parallelo.

## Concorrenza e parallelismo non sono sinonimi

Ed ecco una distinzione che nel linguaggio comune viene appiattita, ma che nella pratica ha conseguenze molto concrete. **Concorrenza** significa che più flussi di esecuzione progrediscono nello stesso intervallo di tempo, ma non necessariamente nello stesso istante fisico: su un singolo core, due thread possono essere concorrenti alternandosi rapidissimamente — un po' di A, poi un po' di B, poi di nuovo A — dando l'illusione di simultaneità, ma in ogni singolo istante c'è **una sola** istruzione in esecuzione su quel core. **Parallelismo** significa invece che più flussi girano fisicamente nello stesso istante, su core distinti: richiede hardware con più unità di calcolo reali, non è ottenibile per magia software su un solo core.

![Concurrency versus parallelism](modulo-00/02-concurrency-vs-parallelism.png)

Nella metà superiore dello schema, un solo core esegue il Thread A e il Thread B a fette alternate: concorrenza pura, nessuna vera sovrapposizione temporale. Nella metà inferiore, due core distinti eseguono A e B per l'intera durata, realmente insieme: parallelismo.

Perché conta davvero questa distinzione? Perché **puoi scrivere codice concorrente anche su una macchina con un solo core**, e ha senso farlo, per un motivo che non ha nulla a che vedere con la velocità di calcolo pura: la **reattività**. Se il tuo programma deve rispondere a un click mentre aspetta una risposta di rete che richiede due secondi, non ti serve più potenza di calcolo: ti serve che il thread che gestisce il click non resti bloccato ad aspettare quella risposta. È esattamente il caso d'uso più comune per cui, nel prossimo articolo, introdurremo `QThread`: non (solo) andare più veloci, ma restare reattivi. Il parallelismo vero — quello che finisce un calcolo pesante in un quarto del tempo usando quattro core — è un obiettivo diverso, legato a `QtConcurrent` e ai thread pool, e richiede hardware multicore reale per manifestarsi.

## Lo scheduler, il time slicing, e il prezzo nascosto del context switch

Come fa lo scheduler del sistema operativo a dare l'illusione che decine di thread girino "contemporaneamente" su una manciata di core fisici? Con il **time slicing**: assegna a ciascun thread pronto una piccola fetta di tempo di CPU — pochi millisecondi, l'ordine di grandezza esatto dipende dallo scheduler — allo scadere della quale lo interrompe forzatamente e mette in esecuzione un altro thread in coda. Questa interruzione forzata si chiama **context switch**, e non è affatto gratis.

![The cost of a context switch](modulo-00/03-context-switch-cost.png)

Quando lo scheduler passa dal Thread A al Thread B, deve prima **salvare** lo stato completo di A — registri, program counter — da qualche parte in memoria, poi **caricare** lo stato salvato in precedenza di B negli stessi registri fisici, e solo a quel punto la CPU può riprendere a eseguire istruzioni di B da dove le aveva lasciate.

C'è un costo ulteriore, spesso più insidioso: la **cache della CPU**. Mentre A girava, la cache si era riempita dei suoi dati e delle sue istruzioni "calde". Quando subentra B, che lavora su dati diversi, quelle righe di cache vengono via via rimpiazzate: quando A riprenderà, tra qualche fetta di tempo, troverà la cache "fredda" per i suoi dati e dovrà rileggerli dalla RAM, molto più lenta. Questo fenomeno si chiama **cache pollution** da context switch, ed è spesso il vero motivo per cui "troppi thread" peggiorano le prestazioni invece di migliorarle: non è il costo di salvare qualche registro, è la cache continuamente svuotata e riempita da capo.

La conseguenza pratica è che **creare un thread per ogni minuscolo pezzetto di lavoro è quasi sempre un'idea pessima**. Se il lavoro utile che un thread deve fare dura meno del tempo che serve a crearlo, avviarlo e fargli contendere CPU con context switch continui, hai speso più energia in amministrazione che in calcolo reale. Questo principio — la granularità del task deve ripagare l'overhead di gestirlo in un thread separato — lo ritroverai quando parleremo di thread pool più avanti nel percorso.

## La legge di Amdahl: il limite che nessun core può superare

Resta una domanda pratica ovvia: se parallelizzo bene un programma, quanto velocizzo aggiungendo core? La risposta rigorosa è la **legge di Amdahl**, formulata nel 1967, ed è probabilmente la formula più importante di tutta la programmazione concorrente perché dice qualcosa che sulle prime sembra contro-intuitivo: c'è un limite invalicabile allo speedup ottenibile, indipendentemente da quanti core aggiungi, e quel limite dipende da una singola caratteristica del tuo programma.

$$S(N) = \dfrac{1}{(1-P) + \dfrac{P}{N}}$$

Fermati un attimo su cosa rappresenta fisicamente ogni simbolo. $S(N)$ è lo **speedup**: quante volte più veloce gira il programma usando $N$ core rispetto a uno solo — se $S(N) = 3$, il programma impiega un terzo del tempo originale. $N$ è il numero di core paralleli usati. $P$ è la frazione del tempo di esecuzione totale che è effettivamente **parallelizzabile**, un numero tra 0 e 1. E $(1-P)$, il pezzo che al denominatore non viene diviso per $N$, è la parte **seriale**: lavoro che, per sua natura logica, deve essere eseguito da un solo thread alla volta — l'inizializzazione, la lettura sequenziale di un file, un passo finale che deve combinare i risultati parziali di tutti gli altri thread.

Il punto concettuale è cosa succede quando $N$ tende a infinito: il termine $P/N$ tende a zero, e resta

$$S(\infty) = \dfrac{1}{1-P}$$

Lo speedup massimo teorico, con infiniti core a disposizione, è limitato esclusivamente dalla frazione seriale del programma. Se solo il 90% è parallelizzabile ($P = 0{,}9$, che suona già altissimo), lo speedup massimo che potrai *mai* ottenere è $1 / (1 - 0{,}9) = 10\times$ — non un milione di volte più veloce solo perché hai un milione di core, ma dieci volte, punto. Se solo il 50% è parallelizzabile, il tetto è appena $2\times$.

![Amdahl's law](modulo-00/05-amdahls-law.png)

Un esempio concreto, legato al mondo della visione artificiale: immagina una pipeline che acquisisce un frame, applica un filtro di preprocessing parallelizzabile su blocchi diversi dell'immagine, e infine esegue un passo di post-processing sequenziale che deve vedere l'immagine intera già ricomposta prima di decidere se il pezzo ispezionato è conforme. Se quel passo finale occupa il 20% del tempo totale ($P = 0{,}8$ parallelizzabile), il limite teorico di speedup è $1/0{,}2 = 5\times$, qualunque scheda con quanti core tu ci metta sotto. Sapere questo *prima* di comprare hardware più potente, o di inventarsi architetture sempre più complesse per parallelizzare l'ultimo 5% del programma, risparmia mesi di lavoro speso a inseguire un guadagno che la matematica dice già quasi esaurito. Per questo, nel mondo reale, il primo passo prima di parallelizzare qualsiasi cosa è sempre **misurare dove il tempo va davvero speso**, non intuirlo: è la frazione seriale nascosta, spesso in un posto inaspettato, a decidere quanto sforzo di parallelizzazione varrà davvero la pena.

## Cosa resta da capire

A questo punto sai cos'è un thread, perché esiste, perché oggi conta più che mai, e quanto puoi realisticamente sperare di guadagnare parallelizzando. Manca ancora il pezzo più pericoloso: cosa succede quando due thread toccano la stessa variabile senza disciplina, e perché Qt, per la sua interfaccia grafica, ha deciso di vietare del tutto questo problema imponendo un thread unico. È il tema del prossimo articolo — e da lì partiamo dritti verso i due progetti pratici di questo modulo, dove il freeze di una finestra Qt smette di essere una frase e diventa qualcosa che vedi succedere sotto i tuoi occhi.
