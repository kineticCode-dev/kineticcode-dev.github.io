---
title: "Progetto: benchmark mutex vs atomic, false sharing, e verifica con ThreadSanitizer"
description: "Multithreading in C++ con Qt — Modulo 5 — Progetto"
---

Tutto il codice sorgente lo puoi trovare [qui](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Progetto: benchmark mutex vs atomic, false sharing, e verifica con ThreadSanitizer

A differenza dei progetti guidati dei moduli precedenti, oggi **non costruiamo un'applicazione Qt Widgets**. È una scelta deliberata: il tema di questo modulo — atomici, memory model, cache — vive al livello della CPU e della libreria standard C++, sotto qualunque framework tu ci costruisca sopra. Costruire il progetto come un programma console con `std::thread`, `std::atomic` e `std::mutex` puri toglie di mezzo ogni distrazione legata a Qt e ti lascia guardare direttamente il meccanismo nudo — esattamente come nel Progetto A del Modulo 0, dove la scelta di partire da `std::thread` puro era motivata dalla stessa esigenza di chiarezza.

**Requisiti**: un compilatore C++20 (verificato con GCC 13.3.0), la libreria pthread collegata a runtime (`-pthread` su Linux/macOS), CMake ≥ 3.16 (opzionale ma comodo), nessuna dipendenza da Qt. Per la sezione ThreadSanitizer, un compilatore GCC o Clang con `-fsanitize=thread` disponibile.

Una nota onesta sull'ambiente in cui questo modulo è stato scritto e misurato: la macchina di sviluppo usata per compilare e cronometrare i numeri che leggerai tra poco espone **2 core logici** (`std::thread::hardware_concurrency()` restituisce `2`) — probabilmente meno dei core disponibili sulla tua macchina di lavoro reale. Non cambia nulla nella sostanza di ciò che stai per osservare, ma vedrai i numeri esatti oscillare più di quanto ti aspetteresti da una macchina fisica dedicata — un ambiente virtualizzato condivide i core fisici sottostanti con altri processi che non controlli. È di per sé una lezione pratica di benchmarking: **misura sempre più di una volta**, e diffida di un singolo numero isolato quanto diffideresti di un singolo campione statistico.

## Passo 1 — Lo scheletro del progetto

Il progetto è composto da due programmi indipendenti, ciascuno concentrato su una sola dimostrazione, più un `CMakeLists.txt` comune:

```cmake
cmake_minimum_required(VERSION 3.16)
project(project_g_benchmark LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()
set(CMAKE_CXX_FLAGS_RELEASE "-O2")

find_package(Threads REQUIRED)

# Project G.1 -- mutex vs atomic under contention
add_executable(counter_benchmark counter_benchmark.cpp)
target_link_libraries(counter_benchmark PRIVATE Threads::Threads)

# Project G.2 -- false sharing and the alignas(64) fix
add_executable(false_sharing false_sharing.cpp)
target_link_libraries(false_sharing PRIVATE Threads::Threads)

# --------------------------------------------------------------------------
# Optional target with ThreadSanitizer enabled (see this module's articles).
# Usage: cmake -S . -B build_tsan -DCMAKE_BUILD_TYPE=Debug -DENABLE_TSAN=ON
# --------------------------------------------------------------------------
option(ENABLE_TSAN "Build with -fsanitize=thread" OFF)
if(ENABLE_TSAN)
    add_compile_options(-fsanitize=thread -g -O1)
    add_link_options(-fsanitize=thread)
endif()
```

Nota `-O2` esplicito nel `CMAKE_CXX_FLAGS_RELEASE`: per un benchmark di prestazioni, compilare senza ottimizzazioni (`-O0`, il default se non specifichi nulla) produrrebbe numeri privi di significato — un incremento non ottimizzato include overhead che nessun programma reale, compilato per l'uso normale, si porterebbe dietro. Misurare senza ottimizzazioni attive è un errore di metodo comune quanto insidioso in questo genere di confronti.

## Passo 2 — Il primo benchmark: mutex contro atomic sotto contesa

Costruiamo `counter_benchmark.cpp` a pezzi, partendo dalla versione protetta da mutex — quella che già conosci dal Modulo 2, qui con `std::mutex` al posto di `QMutex` perché siamo in territorio C++ puro:

```cpp
#include <atomic>
#include <chrono>
#include <cstdio>
#include <mutex>
#include <thread>
#include <vector>

static long long mutexCounter = 0;
static std::mutex counterMutex;

void incrementWithMutex(int incrementsPerThread) {
    for (int i = 0; i < incrementsPerThread; ++i) {
        std::lock_guard<std::mutex> lock(counterMutex);
        ++mutexCounter;
    }
}
```

Niente di nuovo qui rispetto a quanto già sai: `std::lock_guard` è l'equivalente standard di `QMutexLocker`, RAII identico, stessa garanzia di sblocco automatico. Ora la versione atomica, deliberatamente scritta accanto per il confronto:

```cpp
static std::atomic<long long> atomicCounter{0};

void incrementWithAtomic(int incrementsPerThread) {
    for (int i = 0; i < incrementsPerThread; ++i) {
        atomicCounter.fetch_add(1, std::memory_order_seq_cst);
    }
}
```

Uso deliberatamente `memory_order_seq_cst` esplicito (anche se è il default, e potrei ometterlo) per rendere immediatamente visibile, rileggendo il codice, quale garanzia di ordinamento stiamo scegliendo — coerente con la raccomandazione dell'articolo precedente di non lasciare la scelta implicita in codice che altri (incluso te stesso, tra sei mesi) dovranno rileggere.

Il motore del benchmark è un piccolo template che accetta la funzione da cronometrare:

```cpp
template <typename Function>
double runBenchmark(Function work, int numThreads, int incrementsPerThread) {
    std::vector<std::thread> threads;
    threads.reserve(numThreads);

    auto start = std::chrono::steady_clock::now();
    for (int t = 0; t < numThreads; ++t) {
        threads.emplace_back(work, incrementsPerThread);
    }
    for (auto &th : threads) {
        th.join();
    }
    auto end = std::chrono::steady_clock::now();

    return std::chrono::duration<double, std::milli>(end - start).count();
}
```

Nota `std::chrono::steady_clock`, non `system_clock`: per misurare un intervallo di tempo trascorso, `steady_clock` è la scelta corretta perché garantita monotona (non torna mai indietro, a differenza dell'orologio di sistema, che può essere corretto da un servizio NTP proprio mentre stai misurando) — un dettaglio piccolo ma che, se sbagliato, può produrre benchmark con numeri negativi assurdi in rari casi sfortunati.

Infine il `main()`, che dimensiona il numero di thread sulla macchina reale e verifica la correttezza del risultato, non solo il tempo:

```cpp
int main() {
    unsigned int hw = std::thread::hardware_concurrency();
    int numThreads = (hw >= 2) ? static_cast<int>(hw) : 4;
    const int incrementsPerThread = 5'000'000;
    const long long expected =
        static_cast<long long>(numThreads) * incrementsPerThread;

    double msMutex = runBenchmark(incrementWithMutex, numThreads,
                                   incrementsPerThread);
    bool okMutex = (mutexCounter == expected);
    std::printf("[mutex]  time: %8.2f ms   final counter: %lld   %s\n",
                msMutex, mutexCounter, okMutex ? "(correct)" : "(WRONG!)");

    double msAtomic = runBenchmark(incrementWithAtomic, numThreads,
                                    incrementsPerThread);
    bool okAtomic = (atomicCounter.load() == expected);
    std::printf("[atomic] time: %8.2f ms   final counter: %lld   %s\n",
                msAtomic, atomicCounter.load(),
                okAtomic ? "(correct)" : "(WRONG!)");

    if (msAtomic > 0.0) {
        std::printf("\nmutex/atomic ratio: %.2fx\n", msMutex / msAtomic);
    }
    return 0;
}
```

Verificare `counter == expected` non è un dettaglio decorativo: è la controprova che entrambe le versioni sono davvero corrette (nessun aggiornamento perso), il che rende il confronto di tempo significativo — non avrebbe senso vantare la velocità di una versione che, di nascosto, sta anche perdendo incrementi.

## Passo 3 — Compila ed esegui il primo benchmark

```bash
g++ -std=c++20 -O2 -pthread counter_benchmark.cpp -o counter_benchmark
./counter_benchmark
```

Ecco l'output reale, misurato in questo corso (macchina a 2 core logici, 5.000.000 di incrementi per thread, quindi 10.000.000 totali):

```
=== Project G.1 - Benchmark mutex vs atomic ===
hardware_concurrency() detected: 2 -> using 2 threads
Increments per thread: 5000000 (expected total: 10000000)

[mutex]  time:   194.64 ms   final counter: 10000000   (correct)
[atomic] time:    66.01 ms   final counter: 10000000   (correct)

mutex/atomic ratio: 2.95x
```

Ripetendo l'esecuzione altre due volte, per non fidarci di un singolo campione:

```
[run 2] mutex: 198.76 ms   atomic: 66.57 ms   ratio: 2.99x
[run 3] mutex: 208.17 ms   atomic: 68.35 ms   ratio: 3.05x
```

Il pattern è stabile: la versione atomica gira **circa 3 volte più veloce** della versione a mutex, su questa macchina, per questo carico di lavoro (un singolo incremento per operazione — il caso più favorevole possibile per un atomico, e non è un caso che il progetto lo isoli così). La spiegazione è esattamente quella dell'articolo precedente: ogni `lock_guard` che entra in una sezione critica contesa da un altro thread rischia di richiedere l'intervento dello scheduler del sistema operativo, mentre `fetch_add` resta un'unica istruzione macchina bloccata dal bus di memoria per una manciata di cicli di clock — nessuno scheduler coinvolto, nessun thread messo in pausa. Entrambe le versioni, nota, risultano corrette: il vantaggio dell'atomico qui è puramente di prestazioni, non di correttezza.

## Passo 4 — Il secondo file: false sharing, prima senza cura

Passiamo a `false_sharing.cpp`. Prima il layout "ingenuo", due contatori adiacenti nella stessa struct:

```cpp
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>

constexpr int ITERATIONS = 200'000'000;
constexpr std::size_t CACHE_LINE_SIZE = 64;

struct AdjacentCounters {
    std::atomic<int> a{0};
    std::atomic<int> b{0};
};
```

`sizeof(AdjacentCounters)` è 8 byte — due `int` da 4 byte l'uno accanto all'altro, ben dentro un'unica riga di cache da 64 byte, esattamente lo scenario patologico descritto nell'articolo precedente.

## Passo 5 — Il layout corretto, con alignas(64)

```cpp
struct alignas(CACHE_LINE_SIZE) PaddedCounter {
    std::atomic<int> value{0};
    char padding[CACHE_LINE_SIZE - sizeof(std::atomic<int>)];
};

struct PaddedCounters {
    PaddedCounter a;
    PaddedCounter b;
};
```

`sizeof(PaddedCounter)` sale a 64 byte — un'intera riga di cache per un singolo `int` utile, lo spreco esplicito già discusso — e `sizeof(PaddedCounters)` diventa quindi 128 byte: due righe di cache separate, garantite tali dall'allineamento imposto da `alignas`.

## Passo 6 — Il test: due thread, due contatori indipendenti, entrambi i layout

```cpp
template <typename Layout>
double runTest(Layout &data) {
    auto start = std::chrono::steady_clock::now();

    std::thread t1([&] {
        for (int i = 0; i < ITERATIONS; ++i) {
            if constexpr (std::is_same_v<Layout, AdjacentCounters>) {
                data.a.fetch_add(1, std::memory_order_relaxed);
            } else {
                data.a.value.fetch_add(1, std::memory_order_relaxed);
            }
        }
    });
    std::thread t2([&] {
        for (int i = 0; i < ITERATIONS; ++i) {
            if constexpr (std::is_same_v<Layout, AdjacentCounters>) {
                data.b.fetch_add(1, std::memory_order_relaxed);
            } else {
                data.b.value.fetch_add(1, std::memory_order_relaxed);
            }
        }
    });

    t1.join();
    t2.join();

    auto end = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::milli>(end - start).count();
}
```

Qui uso deliberatamente `memory_order_relaxed`, a differenza del primo benchmark: ciascun thread aggiorna solo il proprio contatore, non deve mai osservare né sincronizzarsi con l'altro, quindi non c'è alcuna relazione happens-before da stabilire — è esattamente il caso d'uso onesto di `relaxed` descritto nell'articolo precedente, non una scorciatoia arbitraria. `if constexpr` (C++17) seleziona a tempo di compilazione quale campo toccare a seconda del tipo di `Layout`, così lo stesso template gestisce entrambi gli esperimenti senza duplicare la logica del ciclo.

## Passo 7 — Compila, esegui, e guarda la cache mentirti

```bash
g++ -std=c++20 -O2 -pthread false_sharing.cpp -o false_sharing
./false_sharing
```

Primo output reale misurato:

```
=== Project G.2 - False sharing and the alignas(64) fix ===
Iterations per thread: 200000000
sizeof(AdjacentCounters) = 8 bytes
sizeof(PaddedCounter)    = 64 bytes
sizeof(PaddedCounters)   = 128 bytes

[adjacent, same cache line]       time:  5703.52 ms
[alignas(64), separate lines]     time:  1302.42 ms

Speedup from eliminating false sharing: 4.38x
```

Ripetendo l'esecuzione, per la ragione già discussa nel Setup:

```
[run 2] adjacent: 3667.79 ms   padded: 2648.09 ms   speedup: 1.39x
[run 3] adjacent: 4523.37 ms   padded: 1306.76 ms   speedup: 3.46x
```

Qui la variabilità tra le esecuzioni è più marcata di quella vista nel Passo 3 — di nuovo, la macchina virtualizzata a 2 core condivisi con altri carichi lascia il segno. Ma nota cosa **non** cambia mai, in nessuna delle tre esecuzioni: la direzione dell'effetto. Il layout imbottito è sempre più veloce di quello adiacente, mai il contrario, con un guadagno che va da un +39% a più di 4 volte a seconda del rumore di fondo di quella particolare esecuzione. È esattamente il tipo di lettura onesta che un buon benchmark richiede: il numero esatto oscilla con l'ambiente, ma il fenomeno fisico che stai osservando — l'invalidazione incrociata della riga di cache condivisa — è reale e ripetibile, non un artefatto statistico isolato.

## Passo 8 — ThreadSanitizer: verifica che nessuna delle due versioni nasconda una race

Perché "ha funzionato nei miei test" non basta mai, in concorrenza: un data race può restare invisibile per mesi di test su una macchina e comparire il primo giorno su un hardware diverso, con un numero di core diverso, o semplicemente con il sistema più carico del solito. **ThreadSanitizer** (TSan) è uno strumento di analisi dinamica integrato in GCC e Clang: istrumenta ogni accesso in memoria durante l'esecuzione reale del programma, tenendo traccia di quale thread ha letto o scritto ciascuna locazione e con quale sincronizzazione. Se rileva due thread che accedono alla stessa locazione, almeno uno in scrittura, senza una relazione di sincronizzazione riconosciuta dallo standard C++ tra i due accessi, lo segnala immediatamente con lo stack trace di entrambi.

Compiliamo entrambi i programmi con l'istrumentazione attiva:

```bash
g++ -std=c++20 -O1 -g -fsanitize=thread -pthread \
    counter_benchmark.cpp -o counter_benchmark_tsan
g++ -std=c++20 -O1 -g -fsanitize=thread -pthread \
    false_sharing.cpp -o false_sharing_tsan
./counter_benchmark_tsan
./false_sharing_tsan
```

Nota `-O1` invece di `-O2`: è una raccomandazione pratica quando si usa TSan — con ottimizzazioni più aggressive alcuni riordini di istruzioni possono rendere gli stack trace del sanitizer meno leggibili, senza guadagno reale (a queste dimensioni di programma il rallentamento di TSan stesso domina comunque il tempo totale).

Risultato reale, misurato in questo corso — **nessun warning di data race, su nessuno dei due programmi**:

```
=== Project G.1 - Benchmark mutex vs atomic ===
[mutex]  time:  2716.48 ms   final counter: 10000000   (correct)
[atomic] time:  1131.94 ms   final counter: 10000000   (correct)
mutex/atomic ratio: 2.40x
```

```
=== Project G.2 - False sharing and the alignas(64) fix ===
[adjacent, same cache line]       time:  9321.87 ms
[alignas(64), separate lines]     time:  4011.17 ms
Speedup from eliminating false sharing: 2.32x
```

Due osservazioni valgono la pena. La prima: il rallentamento imposto da TSan è enorme e ben visibile confrontando questi tempi con quelli dei Passi 3 e 7 (il benchmark mutex/atomic passa da ~200/~67 ms a ~2716/~1132 ms, un fattore approssimativamente tra 14x e 17x) — ed è precisamente il motivo per cui TSan si usa in fase di verifica e non nel binario di produzione. La seconda, più importante: **l'assenza di qualunque report di race è essa stessa un risultato**, non un "non è successo nulla" privo di significato. È la controprova sperimentale che sia `std::mutex` sia `std::atomic`, usati come li hai visti in questo progetto, proteggono davvero lo stato condiviso in ogni esecuzione osservata dal sanitizer.

Per confronto, e per chiudere il cerchio con il Modulo 0: se in questo stesso progetto il contatore fosse stato incrementato senza alcuna sincronizzazione — `++counter` diretto, come nella versione "pericolosa" del Modulo 0 — TSan lo avrebbe segnalato immediatamente, con un report del tipo `WARNING: ThreadSanitizer: data race`, con la riga esatta e i due thread in conflitto. Non l'abbiamo incluso in questo progetto proprio perché entrambi i programmi qui sono corretti per costruzione — ma tenerlo a mente resta la ragione pratica per compilare sempre, come prassi, una build con TSan attivo su qualunque codice concorrente nuovo che scrivi, invece di aspettare che un bug di questo tipo emerga da solo in un momento imprevedibile.

## Cosa hai appena dimostrato a te stesso

Hai misurato — non ipotizzato, misurato con un cronometro reale — tre fatti che nella maggior parte dei corsi di concorrenza restano affermazioni astratte: che un atomico può essere sensibilmente più veloce di un mutex per un'operazione semplice sotto contesa; che due variabili logicamente indipendenti possono rallentarsi a vicenda in modo drammatico solo per la loro posizione fisica in memoria, e che `alignas(64)` è una cura concreta e verificabile; e che ThreadSanitizer può confermare, con la stessa serietà con cui un test unitario conferma la correttezza logica, che il tuo codice concorrente è davvero privo delle race che teoricamente potrebbe nascondere. Sono tre strumenti che restano nella tua cassetta degli attrezzi ben oltre questo corso — il primo passo, ogni volta che ottimizzi codice concorrente, è sempre lo stesso: misura prima, misura dopo, e usa un sanitizer per verificare che la velocità guadagnata non sia arrivata al prezzo della correttezza.

---

*Il codice sorgente completo di questo progetto è disponibile nella repository che accompagna questo corso, nella cartella `project-G-benchmark-mutex-atomic`.*
