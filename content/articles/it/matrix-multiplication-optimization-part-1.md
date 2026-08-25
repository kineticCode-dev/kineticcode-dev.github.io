---
title: "Ottimizzare la moltiplicazione di matrici in C++ — Parte 1: cosa ti compra davvero l'ordine dei loop"
description: "Il primo articolo di una serie pratica sul performance engineering: perché la moltiplicazione di matrici è lenta di default, come funziona davvero la memoria di un computer, e come riordinare tre loop for da soli porti a uno speedup di 2.2x — misurato, non presunto."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "series-part-1"]
---

Ho passato del tempo a studiare per conto mio il materiale di *Performance Engineering* del MIT, e a un certo punto la teoria ha smesso di bastarmi. Leggere di gerarchie di cache e ordine dei loop è una cosa; vedere il proprio codice passare da poco meno di 2 GFLOP/s a oltre 11 GFLOP/s sulla propria macchina, con lo stesso identico algoritmo, è tutta un'altra storia. Così ho scelto un problema — la moltiplicazione di matrici quadrate in C++ — e ho deciso di percorrere ogni passo di ottimizzazione di persona, misurando onestamente a ogni tappa, invece di fidarmi di quello che qualcun altro dice "dovrebbe" essere più veloce.

Questo è il primo articolo di quella serie. Copre la prima parte del percorso: perché la moltiplicazione di matrici è lenta all'origine, come un processore moderno recupera davvero i dati, e la prima vera ottimizzazione — che non tocca l'algoritmo, non aggiunge un solo thread, e non usa nessun flag speciale del compilatore. Cambia semplicemente l'ordine di tre loop `for`. Il risultato è uno speedup misurato di 2.22x, e capire *perché* funziona è la base per tutto ciò che viene dopo in questa serie.

Puoi trovare tutto il codice sorgente a questo [link](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)

## Un problema facile da enunciare e costoso da calcolare

Moltiplicare due matrici quadrate $A$ e $B$, entrambe di lato $N$, produce una terza matrice $C$ dove ogni elemento $C_{ij}$ è la somma dei prodotti tra la riga $i$ di $A$ e la colonna $j$ di $B$:

$$
C_{ij} = \sum_{k=0}^{N-1} A_{ik} \cdot B_{kj}
$$

La definizione sta in una riga. Il costo non scala altrettanto gentilmente: calcolare ogni elemento di $C$ richiede $N$ moltiplicazioni e $N$ addizioni, e gli elementi da calcolare sono $N^2$, quindi il totale è dell'ordine di $2N^3$ operazioni in virgola mobile. Raddoppia il lato della matrice, e il lavoro non raddoppia — si moltiplica per otto. Questa crescita cubica è esattamente ciò che rende la moltiplicazione di matrici un banco di prova così efficace per il lavoro sulle performance: uno speedup che sembra trascurabile su un problema piccolo, da giocattolo, diventa minuti o ore risparmiate su uno grande — un layer di rete neurale, una simulazione fisica, un sistema di controllo a spazio di stato.

Non è nemmeno un esercizio accademico scelto per comodità. La moltiplicazione di matrici è, letteralmente, il nucleo computazionale dell'addestramento e dell'esecuzione delle moderne reti neurali, di gran parte del calcolo scientifico, della grafica 3D, e di molti algoritmi di controllo e stima usati in automazione. Le librerie che la implementano al livello estremo (BLAS, cuBLAS, MKL) sono tra i software più pesantemente ottimizzati mai scritti — capire *perché* devono esistere, e cosa fanno di diverso rispetto a un'implementazione ingenua, è la via più diretta per entrare nel performance engineering in generale, non solo per le matrici.

## Come vive davvero una matrice in memoria

Prima di parlare di velocità, c'è un dettaglio implementativo da fissare con precisione, perché tutto il resto di questa serie dipende da esso: come è effettivamente disposta in memoria una matrice N×N. Un computer non ha nessuna nozione nativa di "griglia 2D" — la memoria è, fisicamente, un'unica lunga sequenza lineare di byte. Una matrice bidimensionale deve essere *appiattita* su quella sequenza, e ci sono esattamente due modi ragionevoli per farlo: **row-major**, dove intere righe vengono posizionate una dopo l'altra, oppure **column-major**, l'opposto, dove sono intere colonne a essere posizionate una dopo l'altra. C e C++ usano row-major per gli array multidimensionali nativi; Fortran, e per estensione buona parte del software numerico storico, usa column-major. Non è una nota implementativa marginale — questa scelta determina, letteralmente, quale ordine dei loop sarà veloce e quale sarà lento, come dimostra il resto di questo articolo.

Nel codice di questa serie, una matrice N×N è rappresentata come un singolo `std::vector<double>` di lunghezza $N^2$, in ordine row-major: l'elemento logico $(i, j)$ vive all'indice `i * N + j`.

![Una matrice 3x3 appiattita in un singolo vettore row-major, con la formula dell'indice i*N+j](img/01-row-major-flattening.png)

**Perché non `std::vector<std::vector<double>>`?** È tentante — un vettore di vettori si legge naturalmente come "una matrice". Il problema è che ogni vettore interno è un'allocazione heap propria, separata. Le righe finiscono per essere sparse in memoria, senza nessuna garanzia di trovarsi vicine tra loro; solo gli elementi *all'interno* di una singola riga sono garantiti contigui. Un unico vettore piatto, indicizzato a mano, è l'unico modo per garantire che l'intera matrice sia un blocco contiguo — e come spiega la prossima sezione, la contiguità non è un vezzo, è tutta la partita.

![Confronto tra un singolo vettore contiguo e le allocazioni heap sparse di un vettore di vettori](img/02-vector-of-vectors-fragmentation.png)

## Il processore non è "una calcolatrice che esegue istruzioni" — è una gerarchia di memoria

Questa è l'idea centrale di tutto l'articolo, quindi vale la pena soffermarcisi. Il modo intuitivo di immaginare un processore — legge un'istruzione, recupera i dati che gli servono, li elabora — è tecnicamente corretto ma nasconde un dettaglio enorme: **recuperare un dato non ha un costo fisso**. Una CPU moderna non legge i dati direttamente dalla RAM principale a ogni accesso; la RAM è troppo lenta rispetto alla velocità con cui la CPU potrebbe, in linea di principio, elaborare i dati. Se ogni singola lettura dovesse aspettare la RAM, la CPU passerebbe la stragrande maggioranza del suo tempo semplicemente inattiva, in attesa.

Ecco perché esiste la **cache**: una serie di memorie progressivamente più piccole, progressivamente più vicine (fisicamente, sul chip), e quindi progressivamente più veloci. Un processore moderno tipico ha tre livelli: **L1**, minuscola (32–64 KB per core) ma quasi veloce quanto i registri della CPU stessa; **L2**, più grande e ancora molto veloce (256 KB – 2 MB per core); **L3**, condivisa tra tutti i core del chip, molto più grande (diversi MB, a volte decine) ma la più lenta delle tre. Solo se un dato non si trova in nessuno di questi tre livelli, il processore deve andare a chiederlo alla RAM principale — un'operazione che, misurata in cicli di clock, è drasticamente più lenta di un hit in L1.

![Gerarchia della cache CPU dai registri passando per L1, L2, L3 fino alla RAM principale, con dimensioni e latenze relative](img/03-cache-hierarchy.png)

La cache non funziona copiando singoli byte o singoli numeri — copia intere **linee di cache**, tipicamente 64 byte alla volta (otto valori `double`). Funziona per via di una scommessa, chiamata **principio di località**, che nella stragrande maggioranza dei casi vince nei programmi reali: se hai appena usato il dato all'indirizzo X, è molto probabile che userai presto anche il dato agli indirizzi vicini (località *spaziale*), ed è probabile che riuserai a breve lo stesso dato all'indirizzo X (località *temporale*). Un programma che onora questa scommessa — che percorre la memoria in modo sequenziale e riusa ciò che ha appena caricato — gira veloce. Un programma che la tradisce — che salta qua e là in memoria, toccando ogni dato una volta sola e mai più — paga il prezzo pieno di un accesso alla RAM, ripetutamente, anche se dal punto di vista dell'algoritmo sta facendo "la stessa quantità di lavoro."

## Dove questo morde davvero nella moltiplicazione di matrici

Torniamo alla formula: $C_{ij} = \sum_k A_{ik} \cdot B_{kj}$. Il modo "da manuale" di scriverla in codice usa tre loop annidati sugli indici i, j, k, in quest'ordine — perché è l'ordine in cui la formula matematica si legge naturalmente da sinistra a destra. Il problema è che, con memoria row-major, l'accesso `A[i * N + k]` si muove sequenzialmente al variare di k (località spaziale perfetta), mentre l'accesso `B[k * N + j]`, con k come indice *più interno*, salta di un'intera riga — N elementi — a ogni singola iterazione. Questo è esattamente l'opposto della località spaziale, e nel peggior modo possibile: per N sufficientemente grande, ogni salto di N elementi finisce fuori dalla cache L1, e spesso anche fuori dalla L2, costringendo a un accesso lento a ogni singola moltiplicazione.

Questo è esattamente il tipo di osservazione che questa serie è costruita per rendere tangibile, non solo teorica. Il resto di questo articolo scrive la versione "da manuale", la misura onestamente, e poi la trasforma — senza cambiare di una virgola nessun risultato numerico prodotto — semplicemente cambiando l'ordine dei tre loop. Il miglioramento non sarà un arrotondamento di qualche punto percentuale: sarà un fattore moltiplicativo misurabile, ottenuto senza scrivere una sola riga di algoritmo "più intelligente" — solo scrivendo lo stesso identico algoritmo nell'ordine che rispetta come funziona davvero la memoria.

## Una breve nota sul setup del progetto

Prima di scrivere codice sensibile alle performance, c'è una piccola decisione architetturale che vale la pena dichiarare esplicitamente invece di lasciarla all'abitudine: questo progetto è un'**applicazione console in puro C++17**, costruita con **CMake**, **senza nessuna libreria numerica esterna**. Niente Eigen, niente BLAS, niente da scaricare e linkare — il punto di questa serie è capire *da dove* viene la velocità, non delegarla a una libreria che ha già risolto il problema (anche se, va detto onestamente, in un progetto di produzione reale una libreria BLAS ben ottimizzata quasi sempre batterà codice scritto a mano — ne parleremo meglio in un confronto più avanti nella serie). Il C++ moderno porta anche benefici reali, non solo cosmetici, rispetto al C classico in questo contesto: `std::vector` offre una gestione della memoria sicura e automatica, senza `malloc`/`free` manuali e senza il rischio di dimenticare una `free` o leggere memoria non inizializzata, e i template permettono a un'unica funzione di misurazione di funzionare, senza modifiche, con ogni versione dell'algoritmo che questa serie costruirà.

## Come misurare il tempo senza illudersi

Prima di scrivere la prima vera versione della moltiplicazione, vale la pena costruire gli strumenti usati per misurarla — una scelta di ordine deliberata. Misurare male le performance è facile, e produce conclusioni sbagliate con la stessa identica apparente sicurezza di una misura corretta: un numero sullo schermo sembra sempre autorevole, anche quando il metodo che lo ha prodotto è rotto. Tre errori in particolare sono abbastanza comuni da meritare di essere segnalati esplicitamente, prima ancora di guardare una sola riga del codice di moltiplicazione vero e proprio.

**Errore uno: misurare senza scaldare la cache.** La primissima esecuzione di una funzione, su dati appena allocati, paga costi che le esecuzioni successive non pagano: le pagine di memoria appena allocate potrebbero non essere ancora fisicamente mappate dal sistema operativo (un *page fault*), e la cache non contiene ancora nulla di utile. Misurare una singola esecuzione "fredda" misura anche questi costi una tantum, non le performance a regime dell'algoritmo — che è quasi sempre ciò che conta davvero, perché riflette come si comporta il codice quando gira per un po'.

**Errore due: fidarsi di una singola misurazione.** Qualsiasi macchina reale fa girare un sistema operativo che gestisce decine di altri processi, interrupt hardware, e una frequenza di clock che può variare dinamicamente per ragioni termiche. Una singola esecuzione può, per puro caso, essere rallentata da qualcosa di completamente estraneo al codice che si sta misurando. Il rimedio più robusto non è la media aritmetica (che un singolo outlier può comunque distorcere pesantemente), ma la **mediana**: il valore centrale di una serie di misurazioni ordinata, che per costruzione ignora gli estremi.

**Errore tre, il più subdolo: misurare qualcosa che non fa quello che credi faccia.** Un compilatore moderno è aggressivo nell'eliminare codice che, secondo la sua analisi, non ha nessun effetto osservabile — se calcoli un risultato e non lo usi mai, il compilatore potrebbe semplicemente non calcolarlo affatto, lasciandoti a misurare un tempo "impossibilmente" veloce che non corrisponde a nessun lavoro reale. In questa serie il rischio è basso, perché ogni versione scrive il proprio risultato in una matrice che viene poi esplicitamente confrontata per verificarne la correttezza — un effetto osservabile che impedisce al compilatore di "barare" eliminando il calcolo.

Tutti e tre finiscono in un unico header condiviso, `common.h`, incluso da ogni fase del progetto:

```cpp
// High-resolution stopwatch based on <chrono>.
class Stopwatch {
public:
    void start() { t0_ = std::chrono::steady_clock::now(); }
    double stop_seconds() {
        auto t1 = std::chrono::steady_clock::now();
        return std::chrono::duration<double>(t1 - t0_).count();
    }
private:
    std::chrono::steady_clock::time_point t0_;
};

// Runs "func" repeatedly, discards the first run (warm-up), and returns
// the MEDIAN of the following runs' timings.
template <typename Func>
double median_timing_seconds(Func&& func, int repetitions = 5) {
    func();  // warm-up, discarded

    std::vector<double> times;
    times.reserve(repetitions);
    Stopwatch sw;
    for (int r = 0; r < repetitions; ++r) {
        sw.start();
        func();
        times.push_back(sw.stop_seconds());
    }
    std::sort(times.begin(), times.end());
    return times[times.size() / 2];
}
```

La misurazione usa `std::chrono::steady_clock`, non `std::chrono::system_clock`: la differenza conta. `system_clock` rappresenta il tempo reale sul muro, e può saltare — una sincronizzazione NTP, un cambio manuale dell'orologio — cosa che renderebbe inaffidabili le misure di durata in casi rari ma reali. `steady_clock` è garantito monotono: si muove solo in avanti, a un ritmo costante, che è esattamente la proprietà necessaria per misurare correttamente un intervallo di tempo.

L'altro pezzo che vale la pena mostrare è come un tempo grezzo misurato diventi un numero confrontabile tra dimensioni di problema diverse: i **GFLOP/s**, miliardi di operazioni in virgola mobile al secondo. Come stabilito prima, una moltiplicazione N×N per N×N richiede in totale $2N^3$ operazioni in virgola mobile; dividendo per il tempo misurato, e poi per un miliardo, si ottiene una cifra di throughput che permette di confrontare N=200 con N=2000 su un piano di parità.

```cpp
inline double gflops(int N, double seconds) {
    double flops = 2.0 * static_cast<double>(N) * N * N;
    return (flops / seconds) / 1e9;
}
```

## Fase 1: la versione da manuale

Ecco la prima versione — quella già anticipata sopra in teoria. Tre loop annidati, nell'ordine in cui la formula matematica si legge più naturalmente: i, poi j, poi k.

```cpp
inline void multiply_naive_ijk(const Matrix& A, const Matrix& B, Matrix& C, int N) {
    for (int i = 0; i < N; ++i) {
        for (int j = 0; j < N; ++j) {
            double sum = 0.0;
            for (int k = 0; k < N; ++k) {
                sum += A[i * N + k] * B[k * N + j];
            }
            C[i * N + j] = sum;
        }
    }
}
```

Una piccola ma deliberata scelta implementativa: la somma viene accumulata in una variabile locale, `sum`, e scritta in `C[i * N + j]` solo quando il loop k termina, invece di scrivere direttamente in `C[i*N+j] += ...` a ogni iterazione. `sum` vive quasi certamente in un registro della CPU per tutta la durata del loop interno — l'accesso più veloce possibile, ordini di grandezza più rapido persino di un hit in cache L1. Scrivere ripetutamente in memoria (anche in memoria cachata) dentro il loop più interno sarebbe stata una piccola ferita autoinflitta, facilmente evitabile, che vale la pena escludere fin dalla prima versione.

Compilato con `g++ -O2 -std=c++17` ed eseguito con N = 1023 sulla macchina di sviluppo usata per questa serie (una CPU Intel con 2 core disponibili — la scheda tecnica completa, hardware e software, arriva insieme alla tabella comparativa completa più avanti nella serie), il risultato è:

```
Stage 1 - naive ijk          N=1023   time=  1.1402 s      1.878 GFLOP/s
```

Poco più di un secondo. Tieni a mente questo numero — è la base di riferimento con cui viene confrontata ogni fase successiva di questa serie.

## Fase 2: riordinare i loop in (i, k, j)

Ora cambia **solo l'ordine dei tre loop**, da (i, j, k) a (i, k, j). La matematica calcolata è identica — la stessa formula, $C_{ij} = \sum_k A_{ik} B_{kj}$ — cambia solo la sequenza in cui avvengono le singole operazioni di moltiplicazione-e-somma:

```cpp
inline void multiply_reordered_ikj(const Matrix& A, const Matrix& B, Matrix& C, int N) {
    std::fill(C.begin(), C.end(), 0.0);
    for (int i = 0; i < N; ++i) {
        for (int k = 0; k < N; ++k) {
            const double a_ik = A[i * N + k];
            for (int j = 0; j < N; ++j) {
                C[i * N + j] += a_ik * B[k * N + j];
            }
        }
    }
}
```

Due differenze rispetto alla Fase 1 meritano un commento prima del punto principale. Primo, il risultato non è più accumulato in un'unica variabile `sum`: ora il loop più interno percorre j, quindi a ogni iterazione viene aggiornato un elemento *diverso* di C — non può più stare in un unico registro locale, quindi va accumulato direttamente in `C[i*N+j]`. Per questo motivo C ora deve essere azzerata esplicitamente all'inizio (`std::fill`), cosa che la Fase 1 non richiedeva, dato che lì ogni elemento veniva scritto esattamente una volta, non accumulato. Secondo, `a_ik` viene estratto una sola volta per ogni coppia (i, k), fuori dal loop j: è costante per tutta la durata di quel loop interno, quindi calcolarlo una volta invece che N volte è un'ottimizzazione piccola ma sostanzialmente gratuita.

Ma il cambiamento che conta davvero è quello descritto sopra: ora, con j come indice più interno, **sia** `B[k*N + j]` **sia** `C[i*N + j]` vengono percorsi in sequenza, un elemento dopo l'altro — esattamente come si trovano in memoria row-major. Ogni linea di cache caricata (64 byte, otto valori `double`) viene usata per otto iterazioni consecutive del loop, invece che per una sola, com'era invece l'accesso a stride nella Fase 1 su B.

![Confronto dei pattern di accesso: la Fase 1 salta lungo una colonna di B con stride N, la Fase 2 percorre una riga di B con stride 1](img/04-access-pattern-comparison.png)

```
Stage 2 - reordered ikj      N=1023   time=  0.5143 s      4.164 GFLOP/s
```

Da 1.14 secondi a 0.51 secondi: più del doppio, **2.22x più veloce**, ottenuto senza cambiare l'algoritmo, senza aggiungere parallelismo, senza toccare un solo flag del compilatore — semplicemente scrivendo gli stessi tre loop `for` in un ordine diverso. Se c'è esattamente una cosa da ricordare da tutto questo articolo, è questa: l'ordine in cui percorri la memoria conta tanto quanto — a volte più di — l'algoritmo che stai eseguendo.

![Grafico a barre dei GFLOP/s misurati, Fase 1 contro Fase 2, N=1023](img/05-stage1-vs-stage2-benchmark.png)

**Verifica di correttezza, sempre.** Prima di fidarsi di un numero di performance, verifica che il risultato sia effettivamente corretto: confrontando la matrice C prodotta dalla Fase 2 con quella prodotta dalla Fase 1, sullo stesso input, si ottiene una differenza massima di `3.55e-14` — attribuibile interamente al fatto che l'addizione in virgola mobile non è perfettamente associativa quando le operazioni avvengono in un ordine diverso, non a un bug di logica. Un errore di quest'ordine di grandezza è la firma attesa e innocua di questo fenomeno; un errore di molti ordini di grandezza più grande sarebbe invece un campanello d'allarme che qualcosa è effettivamente rotto nell'algoritmo riscritto.

## Cosa arriva nella prossima parte di questa serie

Riordinare tre loop è stata la prima leva, e da sola vale esattamente un numero onesto: 2.22x. Non è però la fine della storia — la Fase 2 lascia ancora sul tavolo delle performance vere, e le prossime parti di questa serie riprendono esattamente da dove questa si ferma:

- **Tiling (blocking)** — dividere le matrici in piccoli sotto-blocchi che stanno comodamente nella cache L1/L2, per sfruttare la località *temporale* su scala più ampia, in aggiunta alla località spaziale che la Fase 2 già cattura. Qui c'è una sorpresa onesta nelle misurazioni: il tiling ingenuo, da solo, *non* batte la Fase 2 — e capire esattamente perché è più istruttivo della tecnica stessa.
- **Parallelismo con OpenMP** — mettere al lavoro più di un core della CPU, distribuendo il calcolo con tiling tra i thread con un singolo `#pragma`, senza scritture condivise e quindi senza race condition di cui preoccuparsi.
- **Vettorizzazione manuale con AVX2 e FMA** — riscrivere a mano il loop più interno con istruzioni vettoriali che processano quattro valori `double` per istruzione invece di uno solo, per chi ha una CPU che lo supporta (con un fallback automatico e corretto per chi non ce l'ha).
- **Il confronto completo, e altre due sorprese oneste** — un confronto completo e metodologicamente trasparente di tutte e cinque le fasi, incluso il motivo per cui una dimensione di matrice che è per caso una potenza di due può essere drasticamente *più lenta* di una dimensione vicina che non lo è, e perché isolare l'effetto dei flag di compilazione aggressivi dall'effetto dei cambiamenti algoritmici conta tanto quanto il lavoro sull'algoritmo stesso.
- **Racchiudere tutto in un benchmark consolidato e un repository pubblico** — un unico programma che esegue ogni fase, verifica automaticamente la correttezza, e produce la tabella e il grafico comparativi usati in tutta la serie, più un rimando a dove le idee algoritmiche classiche (l'algoritmo di Strassen, gli algoritmi cache-oblivious) proseguono da dove questa serie pratica si ferma.

Il codice di questo articolo — Fase 1, Fase 2, e le utility di misurazione condivise, insieme alle fasi ancora da venire — si trova nel repository GitHub allegato, pronto da clonare, compilare con CMake ed eseguire sulla tua macchina. I tuoi numeri saranno diversi da quelli misurati qui — CPU diversa, numero di core diverso, compilatore diverso — ed è esattamente questo il punto di eseguirlo tu stesso invece di prendere per buoni questi numeri sulla fiducia.
