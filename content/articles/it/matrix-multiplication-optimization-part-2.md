---
title: "Ottimizzare la moltiplicazione di matrici in C++ — Parte 2: tiling, thread e una sorpresa onesta"
description: "Parte 2 della serie pratica sul performance engineering: perché suddividere le matrici in piccoli tile dimensionati sulla cache non paga automaticamente da sola, e come mettere al lavoro un secondo core della CPU con un singolo pragma OpenMP ci porta a un 4.42x misurato — tutto verificato, tutto riproducibile."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "openmp", "cache-tiling", "series-part-2"]
---


Se avete letto la [Parte 1](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-1/) di questa serie, conoscete già il succo della storia fin qui: la stessa identica moltiplicazione di matrici, stesso algoritmo, stesso numero di operazioni in virgola mobile, è passata da 1.88 GFLOP/s a 4.16 GFLOP/s semplicemente scambiando l'ordine di tre cicli `for`. Niente di astuto, nessuna nuova feature hardware, solo il rispetto di come la memoria viene effettivamente letta.

Se vi state unendo ora — benvenuti, ed ecco la versione in due frasi: le matrici sono memorizzate come un unico array piatto, in ordine per righe (row-major), e leggere quell'array in sequenza è drammaticamente più economico che saltare qua e là al suo interno, perché le CPU recuperano la memoria in linee di cache, non numero per numero. Quella singola idea continuerà a ripagare anche in questo articolo, ma in due forme nuove e meno ovvie: come *raggruppate* il lavoro che fate con ogni linea di cache, e quanti core della CPU ci mettete sopra.

Alla fine di questa parte saremo a un **4.42x** più veloci rispetto al punto di partenza della Parte 1 — ma la strada per arrivarci non è una linea retta, e la deviazione è più interessante della destinazione.

Potete controllare tutto il codice sorgente a questo [link](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)

## Il riordino non era la fine della storia

Lo Stage 2 ha sistemato la *direzione* in cui la memoria viene percorsa. Non ha sistemato un problema diverso: per ogni singola riga della matrice di output C, il ciclo riordinato continua a spazzare l'*intera* matrice B, dall'alto in basso. B stessa, per una matrice 1023×1023 di `double`, pesa poco più di 8 MB. Non è nemmeno lontanamente abbastanza piccola da entrare nella cache L1 (decine di KB) o persino nella L2 (un paio di MB sulla maggior parte delle CPU consumer) — quindi a ogni nuova riga di C, la CPU sta di fatto ripartendo da zero con B, sfrattando qualunque dato utile avesse appena finito di caricare per la riga precedente.

Questa è una variante diversa della stessa idea di fondo della Parte 1: la località spaziale (percorrere la memoria in ordine) non è la stessa cosa della località temporale (riutilizzare dati caricati un attimo prima, prima che vengano sfrattati). Lo Stage 2 ha inchiodato la prima. Lascia la seconda completamente sul tavolo.

## Tiling: lavorare su un pezzo abbastanza piccolo da restare fermo

La soluzione ha un nome — **tiling**, a volte chiamato **blocking** — e l'idea, prima di qualunque codice, è quasi imbarazzantemente semplice: invece di spazzare intere righe e colonne, spezzare le matrici in piccoli **tile** quadrati, dimensionati in modo che un tile stia comodamente nella cache L1 o L2, e finire tutto il lavoro possibile con un tile prima di passare al successivo.

![Sinistra: lo Stage 2 spazza l'intera matrice B a ogni riga, molto più grande di qualunque livello di cache. Destra: lo Stage 3 lavora un tile BS×BS alla volta, abbastanza piccolo da restare residente in L1/L2 mentre viene riutilizzato su un'intera banda di righe.](img/06-tiling-concept.png)

Nel codice, questo significa che la struttura piatta a due cicli dello Stage 2 cresce di altri tre cicli all'esterno — uno per ciascuna dimensione, percorso a passi di `BS` (block size) invece che a passi di 1:

```cpp
inline void multiply_blocked_ikj(const Matrix& A, const Matrix& B, Matrix& C, int N, int BS = 64) {
    std::fill(C.begin(), C.end(), 0.0);
    for (int ii = 0; ii < N; ii += BS) {
        const int i_max = std::min(ii + BS, N);
        for (int kk = 0; kk < N; kk += BS) {
            const int k_max = std::min(kk + BS, N);
            for (int jj = 0; jj < N; jj += BS) {
                const int j_max = std::min(jj + BS, N);
                for (int i = ii; i < i_max; ++i) {
                    for (int k = kk; k < k_max; ++k) {
                        const double a_ik = A[i * N + k];
                        for (int j = jj; j < j_max; ++j) {
                            C[i * N + j] += a_ik * B[k * N + j];
                        }
                    }
                }
            }
        }
    }
}
```

Guardate con attenzione e noterete che i tre cicli più interni — su i, k, j — sono *carattere per carattere* identici allo Stage 2. Nulla è cambiato nell'aritmetica. I tre nuovi cicli esterni (`ii`, `kk`, `jj`) si limitano a ritagliare il problema in sotto-blocchi `BS`×`BS` e a restringere ogni passaggio dei cicli interni a lavorare all'interno di un sotto-blocco alla volta, in modo che quel blocco di B resti abbastanza piccolo da trovarsi ancora in cache la volta successiva che serve. `std::min(ii + BS, N)` è lì puramente per correttezza — ritaglia l'ultimo tile parziale quando N non è un multiplo pulito di `BS`.

Compilato ed eseguito come prima:

```bash
g++ -O2 -std=c++17 stage3_blocked.cpp -o stage3_blocked
./stage3_blocked 1023 64
```

```
Stage 3 - blocked ikj        N=1023   time=  0.7194 s      2.976 GFLOP/s
```

## La sorpresa: è più lento dello Stage 2, non più veloce

Eccolo qui, nero su bianco:

![Grafico a barre: Stage 1 a 1.88 GFLOP/s, Stage 2 a 4.16 GFLOP/s, Stage 3 (tiled, single-threaded) che ricade a 2.98 GFLOP/s — con un'annotazione che segnala come il solo tiling sia più lento dello Stage 2.](img/07-stage1-2-3-benchmark.png)

Se questo fosse un tutorial pulito in cui ogni passo è una vittoria netta, questo numero sarebbe stato silenziosamente omesso, oppure la dimensione del blocco sarebbe stata aggiustata finché non fosse sembrata migliore. Non è così che funziona qui. **Un risultato misurato che va nella direzione "sbagliata" non è un errore da nascondere — è un dato**, e questo in particolare insegna qualcosa che un grafico monotonamente crescente non insegnerebbe mai.

Qui sono vere due cose contemporaneamente, e vale la pena separarle.

Primo, il tiling ha un costo reale, non nullo: sei cicli annidati invece di tre, con `std::min` ricalcolato a ogni confine di tile. Quell'overhead vale la pena pagarlo solo se i cache miss che elimina lo superano con un margine sano.

Secondo — ed è la parte specifica della macchina — la cache L2 sulla CPU usata per queste misurazioni è di 2 MB per core. Una matrice 1023×1023 di `double` è circa 8 MB — decisamente più grande della L2, certo, ma il *pattern di accesso all'interno di una riga* dello Stage 2 era già ragionevolmente cache-friendly di suo su questo hardware specifico, lasciando meno margine perché il tiling, da solo, single-threaded, potesse recuperare. Su una CPU con una cache più piccola, o su un problema più grande, questo stesso identico confronto potrebbe facilmente ribaltarsi. Non è un avvertimento da liquidare in fretta — è l'intera ragione per cui questa serie insiste sul *misurare*, sulla vostra macchina, invece di fidarsi di una regola empirica copiata da un articolo di blog (incluso questo).

**Allora perché tenere lo Stage 3 nella serie**, se perde contro lo Stage 2 preso da solo? Perché il tiling qui non riguarda davvero la velocità single-threaded — riguarda il preparare la mossa successiva.

```{=comment}
(marcatore no-op per le due cose che questo articolo NON afferma: non afferma che il tiling sia inutile, e non afferma che questo numero si generalizzi a ogni CPU.)
```

## Dividere il lavoro tra i core

Un calcolo tiled ha una proprietà che il ciclo piatto dello Stage 2 non aveva altrettanto nettamente: è già spezzato in blocchi indipendenti. E blocchi di lavoro indipendenti sono esattamente ciò che serve per passarli a più di un core della CPU.

**OpenMP** è lo strumento per questo, e non è una libreria da scaricare a parte — è una funzionalità del compilatore, abilitata con un singolo flag (`-fopenmp` per GCC e Clang), più un header standard, `<omp.h>`, che viene fornito insieme al compilatore stesso. Il modo in cui lo si usa davvero, nella stragrande maggioranza del codice reale, è tramite le **direttive pragma**: righe simili a commenti che al compilatore viene detto di interpretare come istruzioni anziché ignorare. Questo ha un piacevole effetto collaterale — codice che usa pragma OpenMP continua a compilare e funzionare correttamente anche senza `-fopenmp`; il pragma viene semplicemente ignorato e il codice gira single-threaded.

```cpp
inline void multiply_blocked_parallel(const Matrix& A, const Matrix& B, Matrix& C, int N, int BS = 64) {
    std::fill(C.begin(), C.end(), 0.0);
    #pragma omp parallel for schedule(dynamic)
    for (int ii = 0; ii < N; ii += BS) {
        const int i_max = std::min(ii + BS, N);
        for (int kk = 0; kk < N; kk += BS) {
            const int k_max = std::min(kk + BS, N);
            for (int jj = 0; jj < N; jj += BS) {
                const int j_max = std::min(jj + BS, N);
                for (int i = ii; i < i_max; ++i) {
                    for (int k = kk; k < k_max; ++k) {
                        const double a_ik = A[i * N + k];
                        for (int j = jj; j < j_max; ++j) {
                            C[i * N + j] += a_ik * B[k * N + j];
                        }
                    }
                }
            }
        }
    }
}
```

Confrontatelo con lo Stage 3 qui sopra: è identico, fin nella spaziatura, tranne che per una riga — `#pragma omp parallel for schedule(dynamic)`, posizionata appena sopra il ciclo più esterno su `ii`. Quella singola riga dice al compilatore: dividi le iterazioni di questo ciclo tra i thread disponibili, ed eseguile in modo concorrente invece che una dopo l'altra.

## Perché è davvero sicuro

Appiccicare un `parallel for` a un ciclo senza pensarci bene è uno degli errori più comuni — e più pericolosi proprio perché intermittenti — nel codice parallelo. Se due thread scrivono nella stessa posizione di memoria senza coordinarsi, si ottiene una **race condition**, un bug che spesso non si manifesta a ogni esecuzione, il che lo rende un incubo da debuggare con un debugger tradizionale.

![Matrice C divisa in blocchi di righe; blocchi alternati vengono assegnati al Thread 0 e al Thread 1. Didascalia: ogni thread scrive solo nelle proprie righe di C — A e B sono in sola lettura per tutti — quindi non c'è scrittura condivisa, nessuna race condition, nessun lock necessario.](img/08-openmp-row-split.png)

Qui vale la pena percorrere davvero *perché* è sicuro, invece di darlo per fede. Il ciclo che viene parallelizzato è quello su `ii` — blocchi di *righe* di C. Per qualunque valore di `ii` venga assegnato a un dato thread, quel thread scrive solo nelle righe di C comprese tra `ii` e `i_max` — un intervallo di righe che **nessun altro thread tocca mai**, perché ogni valore di `ii` è assegnato a esattamente un thread. Non c'è scrittura condivisa su C, e quindi nessuna race condition possibile su di essa. A e B, nel frattempo, vengono solo *lette* da ogni thread, mai scritte — e letture concorrenti degli stessi dati sono sempre sicure, senza bisogno di alcuna sincronizzazione.

Anche `schedule(dynamic)` merita una menzione specifica: dice a OpenMP di distribuire blocchi di iterazioni ai thread man mano che si liberano, invece di dividere il lavoro in blocchi fissi ed equi in anticipo. Con blocchi di dimensione abbastanza uniforme come questi, la differenza pratica rispetto allo scheduling statico predefinito è piccola — ma `dynamic` è la scelta predefinita più robusta in generale, perché resta efficiente anche se il carico di lavoro per blocco non è perfettamente uniforme (per esempio, l'ultimo tile parziale quando N non è un multiplo di `BS`).

## Misurarlo

```bash
g++ -O2 -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_parallel
./stage4_parallel 1023 64
```

```
OpenMP active: 2 threads available.
Stage 4 - blocked parallel   N=1023   time=  0.2580 s      8.298 GFLOP/s
```

![Grafico a barre, quattro stage: 1.88, 4.16, 2.98, 8.30 GFLOP/s, con lo Stage 4 annotato come 4.42x più veloce dello Stage 1.](img/09-stage1-4-benchmark.png)

Questo è uno speedup di **4.42x** rispetto allo Stage 1 — merita una lettura attenta, perché a prima vista sembra sproporzionato per una macchina con solo 2 core. Il confronto onesto, però, non è con lo Stage 1 — è con lo Stage 3 (0.719 s), lo stesso algoritmo tiled in esecuzione su un solo core: `0.719 / 0.258 ≈ 2.79`, uno speedup un po' *sopra* il teorico 2x che ci si aspetterebbe raddoppiando i core — probabilmente perché dividere il lavoro allevia anche la pressione sulla cache L3 condivisa, un effetto secondario che si somma al parallelismo puro. Contro lo Stage 2 (0.514 s), il confronto più corretto tra pari, il numero è un molto più credibile **1.99x** — quasi esattamente il raddoppio che ci si aspetterebbe da 2 core, ed è il modo più equo di giudicare "quanto ci ha effettivamente reso il parallelismo in sé" su questa macchina specifica.

**Un limite onesto, dichiarato senza giri di parole.** Questi numeri sono stati misurati su una macchina con solo 2 core CPU. Lo stesso identico codice — non una riga cambiata — scalerebbe considerevolmente di più su una macchina con 8 o 16 core, fino ad avvicinarsi (senza mai raggiungerlo del tutto, per via dell'overhead di sincronizzazione e della banda di memoria condivisa) a uno speedup proporzionale al numero di core. Se avete più core a disposizione, rieseguire `benchmark_all` di persona è il modo più diretto per vedere quanto margine il parallelismo lasci effettivamente sul tavolo, oltre a quello che questa macchina specifica ha potuto mostrare.

## Cosa resta sul tavolo

Quattro dati onesti fin qui: 1.88 → 4.16 → 2.98 (la deviazione) → 8.30 GFLOP/s. Due grandi leve restano ancora intoccate, e la Parte 3 le raccoglie entrambe:

- **Vettorizzazione manuale con AVX2 e FMA** — scrivere a mano il ciclo più interno con istruzioni vettoriali che processano quattro valori `double` per istruzione invece che uno.
- **Il confronto completo, e altre due sorprese oneste** — perché una dimensione di matrice che per caso è una potenza di due può girare *drammaticamente* più lenta di una dimensione vicina che non lo è, e perché isolare l'effetto dei flag di compilazione aggressivi dall'effetto dei cambiamenti algoritmici finisce per contare quasi quanto il lavoro sull'algoritmo stesso.

Il codice completo e compilabile per ogni stage di questa serie — inclusi quelli ancora da venire — si trova nel repository GitHub linkato dalla Parte 1. Clonatelo, compilatelo con CMake, ed eseguite i numeri sul vostro hardware; i vostri saranno diversi da questi, ed è esattamente questo il punto.
