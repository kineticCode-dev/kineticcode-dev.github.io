---
title: "Ottimizzare la moltiplicazione tra matrici in C++ — Parte 3: vettorizzazione, il quadro completo e due sorprese oneste"
description: "L'ultima parte della serie: scrivere a mano istruzioni vettoriali AVX2 + FMA per comprimere quattro moltiplicazioni-addizioni in una sola, il confronto completo in cinque fasi da 1,88 a 11,49 GFLOP/s, e due sorprese misurate — una dimensione di matrice potenza di due che gira 6,5 volte più lenta delle vicine, e uno speedup di 2,12x che non costa una sola riga di codice."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "avx2", "simd", "series-part-3"]
---

Se hai seguito la serie fin dalla [Parte 1](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-1/), mettiti comodo, perché questo è il capitolo in cui tutto si ricompone. Siamo partiti da 1,88 GFLOP/s con la moltiplicazione tra matrici che si insegna in qualsiasi corso di base — tre cicli annidati, niente di sofisticato. La [Parte 2](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-2/) ci ha portato in una deviazione attraverso il tiling (che, misurato onestamente, da solo peggiorava le cose) e poi fino a 8,30 GFLOP/s una volta messo al lavoro un secondo core della CPU con un'unica direttiva OpenMP.

Oggi tiriamo un'ultima leva — insegniamo al ciclo più interno a processare quattro numeri alla volta invece di uno — e poi ci fermiamo a guardare l'intero percorso messo a confronto. Lungo la strada sono emerse nelle misurazioni due cose che non avrebbero dovuto sorprendere chi ha letto con attenzione la Parte 1, eppure lo hanno fatto: una dimensione di matrice più lenta delle vicine senza alcuna ragione algoritmica, e uno speedup di 2,12x ottenuto senza cambiare nemmeno una riga di codice sorgente.

Puoi consultare tutto il codice sorgente a questo [link](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)
## Insegnare alla CPU a fare quattro moltiplicazioni-addizioni in una volta

Ogni versione vista finora, nel suo nucleo più interno, fa la stessa cosa: moltiplica due valori `double`, somma il risultato a un accumulatore, un numero alla volta. Non perché la CPU sia capace di gestire un solo numero alla volta — ma perché non le abbiamo mai chiesto di fare altrimenti. Le CPU moderne supportano istruzioni **SIMD** (Single Instruction, Multiple Data): una singola istruzione macchina che applica la stessa operazione a più numeri contemporaneamente. L'estensione SIMD specifica che useremo è **AVX2**, che opera su registri a 256 bit — abbastanza larghi da contenere fianco a fianco quattro valori `double` a 64 bit. Ad affiancarla c'è **FMA** (Fused Multiply-Add), un'istruzione che calcola `a * b + c` in un solo passaggio invece di due separati — che guarda caso è *esattamente* l'operazione che si trova nel ciclo più interno di ogni tappa di questa serie. È difficile immaginare un'istruzione più su misura per questo problema.

![A sinistra: la versione scalare elabora un double alla volta — otto passaggi separati per otto elementi. A destra: AVX2 + FMA carica quattro double in un unico registro a 256 bit ed esegue la moltiplicazione-addizione per tutti e quattro in una singola istruzione — due passaggi invece di otto.](img/10-avx2-simd.png)

Da dove arrivano queste istruzioni? Non da una libreria esterna — sono **intrinseci** (intrinsics), funzioni C++ dichiarate nell'header standard `<immintrin.h>`, incluso in ogni installazione moderna di GCC, Clang o MSVC. Sono involucri sottili che corrispondono quasi uno a uno a singole istruzioni macchina; il compilatore le traduce direttamente, senza pressoché nessuno degli overhead che porterebbe con sé una normale chiamata di funzione.

```cpp
inline void multiply_blocked_avx2(const Matrix& A, const Matrix& B, Matrix& C, int N, int BS = 64) {
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
                        __m256d a_vec = _mm256_set1_pd(a_ik);

                        int j = jj;
                        for (; j + 4 <= j_max; j += 4) {
                            double* c_ptr = &C[i * N + j];
                            const double* b_ptr = &B[k * N + j];
                            __m256d c_vec = _mm256_loadu_pd(c_ptr);
                            __m256d b_vec = _mm256_loadu_pd(b_ptr);
                            c_vec = _mm256_fmadd_pd(a_vec, b_vec, c_vec);
                            _mm256_storeu_pd(c_ptr, c_vec);
                        }
                        for (; j < j_max; ++j) {
                            C[i * N + j] += a_ik * B[k * N + j];
                        }
                    }
                }
            }
        }
    }
}
```

Partiamo dall'esterno verso l'interno: la struttura a tile e la direttiva OpenMP sono **identiche** alla Fase 4. La vettorizzazione tocca solo il ciclo più interno, quello su `j` — è quella la parte che vale la pena leggere riga per riga.

`__m256d` è il tipo C++ che rappresenta un registro AVX a 256 bit contenente quattro valori `double`. `_mm256_set1_pd(a_ik)` costruisce un registro con `a_ik` ripetuto quattro volte — necessario perché `a_ik` è uno scalare semplice, costante per l'intera scansione su `j` (esattamente come in ogni fase precedente), ma le istruzioni AVX operano su registri interi, quindi va "distribuito" su tutte e quattro le corsie (lane) prima di poter partecipare a un'operazione vettoriale.

Il ciclo `for (; j + 4 <= j_max; j += 4)` avanza **di quattro alla volta** invece che di uno: ogni iterazione elabora quattro colonne contigue in un solo colpo. `_mm256_loadu_pd` carica quattro valori `double` consecutivi dalla memoria in un registro AVX (la `u` sta per *unaligned*, non allineato — funziona anche quando l'indirizzo di partenza non è allineato a 32 byte, a un piccolo costo prestazionale rispetto alla variante allineata; una scelta che privilegia semplicità e robustezza rispetto a spremere fino all'ultimo punto percentuale). `_mm256_fmadd_pd(a_vec, b_vec, c_vec)` calcola, in una sola istruzione, `a_vec * b_vec + c_vec` su tutte e quattro le corsie contemporaneamente — quattro moltiplicazioni in virgola mobile e quattro addizioni in un solo ciclo di clock (nel caso ideale). `_mm256_storeu_pd` scrive il risultato in memoria.

Il secondo ciclo, `for (; j < j_max; ++j)`, è la **coda scalare**: gestisce ciò che avanza quando la larghezza del tile corrente (`j_max - jj`) non è un multiplo esatto di quattro. Con un block size di 64 (sempre multiplo di 4), questa coda scatta solo per valori di N che non sono a loro volta multipli di `BS` — ma deve esserci comunque, per garantire la correttezza qualunque siano N e BS con cui viene effettivamente eseguito il programma.

## Un dettaglio di compilazione che non si può saltare

A differenza di OpenMP, dove dimenticare `-fopenmp` produce comunque un programma corretto, silenziosamente seriale, qui dimenticare i flag AVX2 significa che il codice **non compila affatto** — `<immintrin.h>` blocca le proprie funzioni dietro macro legate ai flag del compilatore:

```bash
g++ -O2 -std=c++17 -fopenmp -mavx2 -mfma stage5_avx2.cpp -o stage5_avx2
./stage5_avx2 1023 64
```

```
AVX2/FMA active at compile time.
Stage 5 - blocked AVX2+FMA   N=1023   time=  0.1863 s      11.493 GFLOP/s
```

Rispetto alla Fase 4 (0,258 s), è **1,39 volte più veloce** — un guadagno reale, ma decisamente inferiore al 4x che ci si potrebbe aspettare ingenuamente da "quattro numeri alla volta invece di uno". Questo scarto merita una spiegazione onesta, non un passaggio frettoloso: la vettorizzazione accelera solo l'aritmetica pura. Il tempo totale misurato include anche il traffico di memoria (caricare quattro valori `double` non è comunque un'operazione istantanea) e l'overhead di gestione dei blocchi che lo circonda. Un tetto teorico di 4x si applica rigorosamente solo alla parte aritmetica, non al quadro complessivo — vale la pena ricordarlo ogni volta che uno speedup viene stimato sulla carta prima di essere misurato davvero.

## Il quadro completo

Cinque fasi, un'unica configurazione di misurazione coerente, la stessa matrice N = 1023, lo stesso hardware per l'intera serie:

| Fase | Tempo (s) | GFLOP/s | Speedup vs Fase 1 |
|---|---|---|---|
| Fase 1 — ijk ingenuo | 1.140 | 1.88 | 1.00x |
| Fase 2 — ikj riordinato | 0.514 | 4.16 | 2.22x |
| Fase 3 — ikj a blocchi | 0.719 | 2.98 | 1.58x |
| Fase 4 — a blocchi + OpenMP | 0.258 | 8.30 | 4.42x |
| Fase 5 — a blocchi + OpenMP + AVX2/FMA | 0.186 | 11.49 | **6.12x** |

![Grafico a barre delle cinque fasi, con i GFLOP/s che salgono da 1,88 a 11,49, annotato con 6,12x rispetto alla Fase 1.](img/11-full-comparison.png)

Prima di fidarsi ulteriormente di questa tabella, ecco la piena trasparenza che ogni numero qui merita: g++ 13.3.0 su Ubuntu, 2 core CPU disponibili, AVX2/FMA supportati via hardware, OpenMP funzionante, `-O2` per ogni fase salvo dove esplicitamente indicato altrimenti (la sezione successiva). **Un numero di performance senza il contesto hardware e software in cui è stato misurato non dice quasi nulla** — se rieseguite questi test voi stessi su hardware diverso, aspettatevi numeri assoluti diversi; la forma relativa dovrebbe reggere, con l'unica eccezione già segnalata onestamente nella Parte 2 per la Fase 3.

Da poco meno di 2 GFLOP/s a quasi 11,5 — un fattore superiore a sei — attraverso quattro cambiamenti distinti e cumulativi, ciascuno giustificato da un principio sottostante diverso: ordine di accesso alla memoria (Fase 2), working set dimensionati sulla cache (Fase 3, deviazione inclusa), più core (Fase 4), istruzioni vettoriali (Fase 5). Nessuno di questi ha toccato *cosa* viene calcolato — solo *come*.

## Sorpresa 1: la trappola della potenza di due

Mentre mettevo insieme questa serie, è saltato fuori qualcosa di non pianificato, ma è un esempio troppo bello dello scontro tra la teoria della cache della Parte 1 e la pratica per lasciarlo fuori. Cronometrando la Fase 1 — la versione ingenua pura — su tre dimensioni di matrice consecutive:

```
N = 1023 (not a power of two):  time = 1.309 s
N = 1024 (a power of two):      time = 8.488 s
N = 1025:                       time = 1.382 s
```

![Grafico a barre: N=1023 a 1,31s, N=1024 con un picco a 8,49s, N=1025 di nuovo giù a 1,38s — annotato "potenza di due ⇒ cache-set thrashing".](img/13-power-of-two-trap.png)

**N = 1024 impiega quasi 6,5 volte più tempo di N = 1023 o N = 1025**, pur essendo appena più grande — N = 1024 esegue circa lo 0,3% di aritmetica in più rispetto a N = 1023. Niente, nella teoria della complessità $O(N^3)$, prevede un dirupo del genere; prevede una curva liscia. La spiegazione è di nuovo legata alla cache, ma con un meccanismo più sottile di quello visto nella Parte 1.

![A sinistra: con N=1023, sei inizi di riga consecutivi cadono distribuiti su sei diversi cache set — comportamento ordinario. A destra: con N=1024, tutti e sei gli inizi di riga collidono esattamente sullo stesso cache set, che viene sfrattato e ricaricato a ogni accesso.](img/12-cache-conflict.png)

Le cache reali sono organizzate come strutture **set-associative**: un dato indirizzo di memoria può finire soltanto in uno specifico sottoinsieme delle linee di cache disponibili, determinato dai bit meno significativi del suo indirizzo. Quando la lunghezza di una riga di matrice è *esattamente* una potenza di due (o un suo grande multiplo), gli indirizzi toccati in sequenza dal ciclo più interno della Fase 1 — ricordiamo, `B[k*N + j]`, con `k` come ciclo che salta di `N` elementi a ogni passo — mappano ripetutamente sullo **stesso identico sottoinsieme** di linee di cache invece di distribuirsi. Il risultato è un **cache conflict miss**: la cache ha ancora spazio libero altrove, ma quel particolare sottoinsieme viene continuamente sovrascritto, come se l'intera cache fosse molto più piccola di quanto realmente sia.

Questo effetto è specifico del pattern di accesso a passo N (stride-N) della Fase 1 — esattamente il pattern di accesso "caso peggiore" segnalato nella Parte 1, reso patologico da una coincidenza di allineamento. Le fasi successive, con accesso sequenziale o a tile, ne sono molto meno sensibili. Resta comunque una lezione generale utile: quando una dimensione di matrice o array è sotto il vostro controllo e il pattern di accesso non è puramente sequenziale, evitare potenze di due esatte (o aggiungere un piccolo padding alla riga per rompere l'allineamento) è una tecnica reale usata nel codice ad alte prestazioni in produzione, non solo una curiosità da manuale. Provatelo voi stessi se volete vederlo in prima persona — `./stage1_naive 1023`, poi `1024`, poi `1025` — è uno degli esperimenti più immediatamente convincenti che questa intera serie ha da offrire.

## Sorpresa 2: isolare l'effetto dei flag del compilatore

Ogni misurazione finora ha mantenuto `-O2` costante, specificamente per evitare che i cambiamenti all'algoritmo si confondessero con i cambiamenti al livello di ottimizzazione del compilatore. Ma quanto resta sul tavolo dai soli flag, a codice sorgente completamente fermo? Prendiamo il sorgente della Fase 4 (a blocchi + OpenMP) — **senza cambiare nemmeno una riga** — e compiliamolo in due modi diversi:

```bash
g++ -O2 -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_O2
g++ -O3 -march=native -ffast-math -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_O3native
```

`-O3` attiva ottimizzazioni più aggressive rispetto a `-O2`, incluso il tentativo del compilatore stesso di vettorizzazione automatica. `-march=native` dice al compilatore di generare codice specifico per la CPU esatta su cui sta compilando (incluso, se disponibile, l'uso automatico di AVX2 — senza bisogno di intrinseci) invece di codice generico eseguibile su qualsiasi processore x86 — un vero e proprio compromesso, dato che il binario risultante potrebbe non funzionare affatto su una macchina diversa con un set di istruzioni più datato. `-ffast-math` allenta alcune delle regole rigorose dello standard IEEE 754 sulla virgola mobile — in particolare, permette al compilatore di riordinare le addizioni, cosa che normalmente non può fare perché cambierebbe il risultato di una quantità minima — che è esattamente la libertà extra di cui un ciclo di accumulo come il nostro ha bisogno per una vettorizzazione automatica aggressiva.

```
Stage 4 with -O2:                              0.3176 s     6.741 GFLOP/s
Stage 4 with -O3 -march=native -ffast-math:    0.1497 s    14.308 GFLOP/s
```

![Grafico a barre: -O2 a 6,74 GFLOP/s contro -O3 -march=native -ffast-math a 14,31 GFLOP/s sullo stesso identico sorgente — annotato 2,12x, zero righe cambiate.](img/14-compiler-flags.png)

**2,12 volte più veloce, lo stesso identico file sorgente.** Vale la pena metterlo accanto a tutto il resto di questa serie: riordinare i cicli (Parte 1) ha portato un 2,22x. I soli flag del compilatore, su un ciclo già scritto bene, portano un altro 2,12x — un promemoria da tenere bene a mente prima di investire tempo nell'ottimizzazione scritta a mano: **verificare che i flag del compilatore corrispondano davvero all'hardware di destinazione è spesso il guadagno di performance più economico disponibile**, e va fatto all'inizio del processo, non come ripensamento dopo che l'algoritmo è già stato riscritto a mano.

Non abbiamo deliberatamente compilato con `-O3 -march=native -ffast-math` fin dalla primissima fase nella Parte 1. Mescolare l'effetto dei flag del compilatore con l'effetto dei cambiamenti algoritmici avrebbe reso impossibile capire quale dei due fosse effettivamente responsabile di un dato miglioramento — isolare una variabile alla volta, qui i flag rispetto a un sorgente fisso, è la stessa disciplina di misurazione che questa intera serie ha cercato di rappresentare dall'inizio alla fine.

## Mettere tutto insieme: un solo benchmark, un solo repository

Finora ogni fase è vissuta nel proprio piccolo eseguibile — comodo per seguire un passo alla volta, meno comodo se si vuole semplicemente confrontare tutte e cinque con un unico comando. È a questo che serve `benchmark_all.cpp` nel repository: costruisce un'unica coppia di matrici di input (stesso seed per ogni versione, così ogni fase viene misurata su dati identici), calcola una volta un risultato di riferimento con la Fase 1, poi esegue e cronometra ogni altra versione, verificando ciascun risultato rispetto a quel riferimento con un controllo di correttezza `max_abs_diff` prima di fidarsi di uno qualsiasi dei numeri.

```bash
g++ -O2 -std=c++17 -fopenmp -mavx2 -mfma benchmark_all.cpp -o benchmark_all
./benchmark_all 1023 64
```

Stampa la stessa tabella di confronto mostrata sopra — tempo, GFLOP/s, speedup rispetto alla Fase 1, e l'errore massimo rispetto al riferimento (dell'ordine di $10^{-14}$ per ogni fase, esattamente ciò che l'arrotondamento in virgola mobile prevede) — e scrive accanto un file `benchmark_results.csv`, pronto per lo strumento di grafici che preferite.

Il codice sorgente completo di ogni fase di questa serie — `common.h`, `kernels.h`, tutti e cinque i file `stageN_*.cpp`, `benchmark_all.cpp`, un `CMakeLists.txt`, e un `build_and_run.sh` — si trova nel repository GitHub di accompagnamento, linkato dalla Parte 1. Clonatelo, compilatelo, ed eseguite i numeri sulla vostra macchina; CPU diversa, numero di core diverso, compilatore diverso, numeri diversi — e vederlo con i propri occhi vale più che fidarsi di qualsiasi tabella in un post di blog, questo incluso.

## Cosa resta sul tavolo

Nessuna serie tecnica onesta finisce con "e questo è tutto". Alcune cose sono state deliberatamente lasciate fuori, sia per una questione di ambito sia come indicazione su dove proseguire. Non abbiamo toccato l'**algoritmo di Strassen** o i suoi parenti, che riducono la complessità asintotica *al di sotto* di $O(N^3)$ cambiando l'algoritmo stesso, invece di ottimizzare l'implementazione di un algoritmo fisso come ha fatto l'intera serie. Non abbiamo esplorato gli **algoritmi cache-oblivious**, che ottengono un buon comportamento di cache tramite divide-et-impera ricorsivo invece di una dimensione di blocco scelta a mano come il nostro `BS` — un approccio teoricamente più elegante, dato che non ha mai bisogno di conoscere in anticipo la dimensione della cache della CPU di destinazione. E non abbiamo fatto benchmark contro una libreria BLAS ottimizzata professionalmente (OpenBLAS, Intel MKL e simili) — sarebbe onesto aspettarsi che una di queste batta ancora in modo significativo persino la Fase 5, essendo scritte da specialisti e messe a punto per decenni su innumerevoli architetture. Lo scopo di questa serie non è mai stato competere con quel livello di ingegneria — era capire, un passo misurato alla volta, da dove viene davvero quel tipo di prestazioni.

## Un'ultima cosa

La lezione più duratura qui non è il numero 6,12x — è l'abitudine che rappresenta: misurare prima di ottimizzare, misurare di nuovo dopo ogni singolo cambiamento, verificare la correttezza a ogni passo, e solo allora trarre una conclusione. Questa abitudine si applica ben oltre la moltiplicazione tra matrici — una query di database lenta, un ciclo di controllo che continua a mancare il proprio tempo di ciclo, una pipeline di visione che non riesce a stare al passo con la linea di produzione, ricompensano tutte esattamente la stessa disciplina. Il codice cambia da un dominio all'altro. Il metodo — teoria per sapere cosa cercare, misurazione onesta per verificarlo, correttezza verificata a ogni passo — no.

Grazie per essere rimasti fino in fondo per tutte e tre le parti. Andate a misurare qualcosa.
