---
title: "Projekt: Benchmark Mutex vs. Atomic, False Sharing, und Verifikation mit ThreadSanitizer"
description: "Multithreading in C++ mit Qt — Modul 5 — Projekt"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projekt: Benchmark Mutex vs. Atomic, False Sharing, und Verifikation mit ThreadSanitizer

Anders als bei den geführten Projekten der vorangegangenen Module bauen wir heute **keine Qt-Widgets-Anwendung**. Das ist eine bewusste Entscheidung: Das Thema dieses Moduls — Atomics, Speichermodell, Cache — lebt auf der Ebene der CPU und der C++-Standardbibliothek, unterhalb jedes Frameworks, das du darauf aufbaust. Das Projekt als Konsolenprogramm mit reinem `std::thread`, `std::atomic` und `std::mutex` zu bauen, räumt jede Qt-bezogene Ablenkung aus dem Weg und lässt dich den nackten Mechanismus direkt betrachten — genau wie im Projekt A des Moduls 0, wo die Entscheidung, mit reinem `std::thread` zu beginnen, durch dasselbe Bedürfnis nach Klarheit motiviert war.

**Voraussetzungen**: ein C++20-Compiler (getestet mit GCC 13.3.0), die pthread-Bibliothek zur Laufzeit gelinkt (`-pthread` unter Linux/macOS), CMake ≥ 3.16 (optional, aber praktisch), keine Qt-Abhängigkeit. Für den ThreadSanitizer-Abschnitt ein GCC- oder Clang-Compiler mit verfügbarem `-fsanitize=thread`.

Eine ehrliche Anmerkung zur Umgebung, in der dieses Modul geschrieben und gemessen wurde: Die Entwicklungsmaschine, die zum Kompilieren und Stoppen der Zahlen verwendet wurde, die du gleich lesen wirst, weist **2 logische Kerne** auf (`std::thread::hardware_concurrency()` liefert `2`) — wahrscheinlich weniger als die auf deiner tatsächlichen Arbeitsmaschine verfügbaren Kerne. Das ändert nichts an der Substanz dessen, was du gleich beobachten wirst, aber du wirst sehen, dass die exakten Zahlen stärker schwanken, als du es von einer dedizierten physischen Maschine erwarten würdest — eine virtualisierte Umgebung teilt sich die zugrundeliegenden physischen Kerne mit anderen Prozessen, die du nicht kontrollierst. Das ist an sich schon eine praktische Lektion im Benchmarking: **miss immer mehr als einmal**, und traue einer einzelnen isolierten Zahl genauso wenig wie einer einzelnen statistischen Stichprobe.

## Schritt 1 — Das Grundgerüst des Projekts

Das Projekt besteht aus zwei unabhängigen Programmen, jedes auf eine einzige Demonstration konzentriert, plus einer gemeinsamen `CMakeLists.txt`:

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

Beachte das explizite `-O2` in `CMAKE_CXX_FLAGS_RELEASE`: Für einen Performance-Benchmark würde das Kompilieren ohne Optimierungen (`-O0`, der Standard, wenn nichts angegeben wird) bedeutungslose Zahlen liefern — ein unoptimiertes Inkrement enthält Overhead, den kein reales, für den normalen Einsatz kompiliertes Programm mit sich herumträgt. Ohne aktive Optimierungen zu messen, ist bei dieser Art von Vergleichen ein ebenso verbreiteter wie tückischer Methodenfehler.

## Schritt 2 — Der erste Benchmark: Mutex gegen Atomic unter Contention

Wir bauen `counter_benchmark.cpp` stückweise auf, beginnend mit der mutexgeschützten Version — die du bereits aus Modul 2 kennst, hier mit `std::mutex` statt `QMutex`, weil wir uns in reinem C++-Territorium befinden:

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

Nichts Neues gegenüber dem, was du schon weißt: `std::lock_guard` ist das Standard-Äquivalent zu `QMutexLocker`, identisches RAII, dieselbe Garantie für automatisches Entsperren. Nun die atomare Version, bewusst daneben geschrieben für den Vergleich:

```cpp
static std::atomic<long long> atomicCounter{0};

void incrementWithAtomic(int incrementsPerThread) {
    for (int i = 0; i < incrementsPerThread; ++i) {
        atomicCounter.fetch_add(1, std::memory_order_seq_cst);
    }
}
```

Ich verwende bewusst das explizite `memory_order_seq_cst` (auch wenn es der Standard ist und ich es weglassen könnte), um beim erneuten Lesen des Codes sofort sichtbar zu machen, welche Ordnungsgarantie wir wählen — konsistent mit der Empfehlung des vorigen Artikels, die Wahl nicht implizit in Code zu lassen, den andere (dich selbst eingeschlossen, in sechs Monaten) noch einmal lesen müssen.

Der Motor des Benchmarks ist ein kleines Template, das die zu stoppende Funktion entgegennimmt:

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

Beachte `std::chrono::steady_clock`, nicht `system_clock`: Um eine verstrichene Zeitspanne zu messen, ist `steady_clock` die richtige Wahl, weil sie garantiert monoton ist (sie läuft nie zurück, anders als die Systemuhr, die genau während deiner Messung von einem NTP-Dienst korrigiert werden kann) — ein kleines Detail, das aber, falsch gewählt, in seltenen Unglücksfällen absurde negative Benchmark-Zahlen erzeugen kann.

Schließlich die `main()`, die die Thread-Anzahl an die reale Maschine anpasst und die Korrektheit des Ergebnisses überprüft, nicht nur die Zeit:

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

Zu überprüfen, ob `counter == expected` gilt, ist kein dekoratives Detail: Es ist der Gegenbeweis, dass beide Versionen wirklich korrekt sind (kein Update geht verloren), was den Zeitvergleich überhaupt erst aussagekräftig macht — es hätte keinen Sinn, die Geschwindigkeit einer Version zu preisen, die insgeheim auch Inkremente verliert.

## Schritt 3 — Kompilieren und den ersten Benchmark ausführen

```bash
g++ -std=c++20 -O2 -pthread counter_benchmark.cpp -o counter_benchmark
./counter_benchmark
```

Hier die reale, in diesem Kurs gemessene Ausgabe (Maschine mit 2 logischen Kernen, 5.000.000 Inkremente pro Thread, also 10.000.000 insgesamt):

```
=== Project G.1 - Benchmark mutex vs atomic ===
hardware_concurrency() detected: 2 -> using 2 threads
Increments per thread: 5000000 (expected total: 10000000)

[mutex]  time:   194.64 ms   final counter: 10000000   (correct)
[atomic] time:    66.01 ms   final counter: 10000000   (correct)

mutex/atomic ratio: 2.95x
```

Die Ausführung noch zweimal wiederholt, um uns nicht auf eine einzelne Stichprobe zu verlassen:

```
[run 2] mutex: 198.76 ms   atomic: 66.57 ms   ratio: 2.99x
[run 3] mutex: 208.17 ms   atomic: 68.35 ms   ratio: 3.05x
```

Das Muster ist stabil: Die atomare Version läuft **etwa 3-mal schneller** als die Mutex-Version, auf dieser Maschine, für diese Arbeitslast (ein einzelnes Inkrement pro Operation — der für ein Atomic denkbar günstigste Fall, und es ist kein Zufall, dass das Projekt ihn so isoliert). Die Erklärung ist genau die des vorigen Artikels: Jeder `lock_guard`, der in einen von einem anderen Thread umkämpften kritischen Abschnitt eintritt, riskiert, den Eingriff des Betriebssystem-Schedulers zu erfordern, während `fetch_add` eine einzige, vom Speicherbus für eine Handvoll Taktzyklen blockierte Maschineninstruktion bleibt — kein Scheduler beteiligt, kein Thread pausiert. Beide Versionen erweisen sich, wohlgemerkt, als korrekt: Der Vorteil des Atomics liegt hier rein bei der Performance, nicht bei der Korrektheit.

## Schritt 4 — Die zweite Datei: False Sharing, zuerst ohne Vorsichtsmaßnahme

Weiter zu `false_sharing.cpp`. Zunächst das "naive" Layout, zwei benachbarte Zähler in derselben Struct:

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

`sizeof(AdjacentCounters)` beträgt 8 Byte — zwei 4-Byte-`int`s direkt nebeneinander, weit innerhalb einer einzigen 64-Byte-Cache-Zeile, genau das im vorigen Artikel beschriebene pathologische Szenario.

## Schritt 5 — Das korrekte Layout, mit alignas(64)

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

`sizeof(PaddedCounter)` steigt auf 64 Byte — eine ganze Cache-Zeile für ein einziges nützliches `int`, die bereits diskutierte explizite Verschwendung — und `sizeof(PaddedCounters)` wird dadurch 128 Byte: zwei getrennte Cache-Zeilen, garantiert durch die von `alignas` erzwungene Ausrichtung.

## Schritt 6 — Der Test: zwei Threads, zwei unabhängige Zähler, beide Layouts

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

Hier verwende ich bewusst `memory_order_relaxed`, anders als beim ersten Benchmark: Jeder Thread aktualisiert nur seinen eigenen Zähler, muss den anderen nie beobachten oder sich mit ihm synchronisieren, also gibt es keine happens-before-Beziehung herzustellen — es ist genau der ehrliche Anwendungsfall für `relaxed`, den der vorige Artikel beschrieben hat, keine willkürliche Abkürzung. `if constexpr` (C++17) wählt zur Kompilierzeit aus, welches Feld je nach Typ von `Layout` angefasst wird, sodass dasselbe Template beide Experimente handhabt, ohne die Schleifenlogik zu duplizieren.

## Schritt 7 — Kompilieren, ausführen, und dem Cache beim Lügen zusehen

```bash
g++ -std=c++20 -O2 -pthread false_sharing.cpp -o false_sharing
./false_sharing
```

Erste real gemessene Ausgabe:

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

Die Ausführung wiederholt, aus dem im Setup bereits genannten Grund:

```
[run 2] adjacent: 3667.79 ms   padded: 2648.09 ms   speedup: 1.39x
[run 3] adjacent: 4523.37 ms   padded: 1306.76 ms   speedup: 3.46x
```

Hier ist die Schwankung zwischen den Läufen ausgeprägter als die in Schritt 3 gesehene — wieder hinterlässt die virtualisierte Maschine mit 2 Kernen, die sich andere Lasten teilt, ihre Spuren. Aber beachte, was sich **nie** ändert, in keinem der drei Läufe: die Richtung des Effekts. Das gepolsterte Layout ist immer schneller als das benachbarte, nie umgekehrt, mit einem Gewinn, der je nach Hintergrundrauschen des jeweiligen Laufs von +39% bis über das Vierfache reicht. Das ist genau die Art ehrlicher Lesart, die ein guter Benchmark verlangt: Die exakte Zahl schwankt mit der Umgebung, aber das physikalische Phänomen, das du beobachtest — die wechselseitige Invalidierung der geteilten Cache-Zeile — ist real und wiederholbar, kein isoliertes statistisches Artefakt.

## Schritt 8 — ThreadSanitizer: prüfen, dass keine der beiden Versionen eine Race verbirgt

Denn "hat in meinen Tests funktioniert" reicht bei Nebenläufigkeit nie: Eine Data Race kann monatelang bei Tests auf einer Maschine unsichtbar bleiben und am ersten Tag auf anderer Hardware, mit einer anderen Kernzahl, oder einfach mit einem stärker ausgelasteten System zutage treten. **ThreadSanitizer** (TSan) ist ein in GCC und Clang integriertes dynamisches Analysewerkzeug: Es instrumentiert jeden Speicherzugriff während der tatsächlichen Programmausführung und verfolgt, welcher Thread welche Speicherstelle wann gelesen oder geschrieben hat und mit welcher Synchronisierung. Erkennt es zwei Threads, die auf dieselbe Speicherstelle zugreifen — mindestens einer schreibend —, ohne dass zwischen den beiden Zugriffen eine vom C++-Standard anerkannte Synchronisationsbeziehung besteht, meldet es das sofort mit dem Stack-Trace beider Threads.

Kompilieren wir beide Programme mit aktivierter Instrumentierung:

```bash
g++ -std=c++20 -O1 -g -fsanitize=thread -pthread \
    counter_benchmark.cpp -o counter_benchmark_tsan
g++ -std=c++20 -O1 -g -fsanitize=thread -pthread \
    false_sharing.cpp -o false_sharing_tsan
./counter_benchmark_tsan
./false_sharing_tsan
```

Beachte `-O1` statt `-O2`: Das ist eine praktische Empfehlung beim Einsatz von TSan — bei aggressiveren Optimierungen können bestimmte Instruktions-Umordnungen die Stack-Traces des Sanitizers weniger lesbar machen, ohne echten Gewinn (bei diesen Programmgrößen dominiert ohnehin die von TSan selbst verursachte Verlangsamung die Gesamtzeit).

Reales, in diesem Kurs gemessenes Ergebnis — **kein Data-Race-Warning, bei keinem der beiden Programme**:

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

Zwei Beobachtungen sind es wert, festgehalten zu werden. Die erste: Die von TSan auferlegte Verlangsamung ist enorm und gut sichtbar, vergleicht man diese Zeiten mit denen aus den Schritten 3 und 7 (der Mutex/Atomic-Benchmark geht von ~200/~67 ms auf ~2716/~1132 ms über, ein Faktor zwischen etwa 14x und 17x) — und das ist genau der Grund, warum TSan in der Verifikationsphase eingesetzt wird und nicht im Produktions-Binary. Die zweite, wichtigere: **Das Ausbleiben jeglicher Race-Meldung ist selbst ein Ergebnis**, kein bedeutungsloses "es ist nichts passiert". Es ist der experimentelle Gegenbeweis, dass sowohl `std::mutex` als auch `std::atomic`, so eingesetzt, wie du sie in diesem Projekt gesehen hast, den geteilten Zustand in jedem vom Sanitizer beobachteten Durchlauf tatsächlich schützen.

Zum Vergleich, und um den Kreis zu Modul 0 zu schließen: Wäre in diesem selben Projekt der Zähler ohne jegliche Synchronisierung inkrementiert worden — `++counter` direkt, wie in der "gefährlichen" Version aus Modul 0 — hätte TSan das sofort gemeldet, mit einem Report der Art `WARNING: ThreadSanitizer: data race`, mit der exakten Zeile und den beiden im Konflikt stehenden Threads. Wir haben das in diesem Projekt nicht aufgenommen, gerade weil beide Programme hier von Konstruktion her korrekt sind — aber es im Hinterkopf zu behalten, bleibt der praktische Grund, warum man als Praxis immer einen Build mit aktiviertem TSan für jeden neu geschriebenen nebenläufigen Code kompilieren sollte, statt zu warten, bis ein Bug dieser Art von selbst zu einem unvorhersehbaren Zeitpunkt auftaucht.

## Was du dir selbst gerade bewiesen hast

Du hast — nicht vermutet, sondern mit einer echten Stoppuhr gemessen — drei Tatsachen belegt, die in den meisten Nebenläufigkeitskursen abstrakte Behauptungen bleiben: dass ein Atomic für eine einfache Operation unter Contention spürbar schneller sein kann als ein Mutex; dass zwei logisch unabhängige Variablen sich allein aufgrund ihrer physischen Position im Speicher drastisch gegenseitig ausbremsen können, und dass `alignas(64)` dafür eine konkrete, überprüfbare Abhilfe ist; und dass ThreadSanitizer mit derselben Ernsthaftigkeit, mit der ein Unit-Test die logische Korrektheit bestätigt, bestätigen kann, dass dein nebenläufiger Code tatsächlich frei von den Races ist, die er theoretisch verbergen könnte. Das sind drei Werkzeuge, die weit über diesen Kurs hinaus in deinem Werkzeugkasten bleiben — der erste Schritt, jedes Mal wenn du nebenläufigen Code optimierst, ist immer derselbe: miss vorher, miss nachher, und benutze einen Sanitizer, um zu überprüfen, dass die gewonnene Geschwindigkeit nicht auf Kosten der Korrektheit erkauft wurde.

---

*Der vollständige Quellcode dieses Projekts ist im Repository verfügbar, das diesen Kurs begleitet, im Ordner `project-G-benchmark-mutex-atomic`.*
