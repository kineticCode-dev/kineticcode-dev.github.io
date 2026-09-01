---
title: "Projet : benchmark mutex vs atomic, false sharing, et vérification avec ThreadSanitizer"
description: "Multithreading en C++ avec Qt — Module 5 — Projet"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projet : benchmark mutex vs atomic, false sharing, et vérification avec ThreadSanitizer

Contrairement aux projets guidés des modules précédents, aujourd'hui **nous ne construisons pas une application Qt Widgets**. C'est un choix délibéré : le thème de ce module — atomiques, modèle mémoire, cache — vit au niveau du CPU et de la bibliothèque standard C++, en dessous de n'importe quel framework que tu construis par-dessus. Construire le projet comme un programme console avec `std::thread`, `std::atomic` et `std::mutex` purs élimine toute distraction liée à Qt et te laisse observer directement le mécanisme à nu — exactement comme dans le Projet A du Module 0, où le choix de partir de `std::thread` pur était motivé par la même exigence de clarté.

**Prérequis** : un compilateur C++20 (vérifié avec GCC 13.3.0), la bibliothèque pthread liée à l'exécution (`-pthread` sous Linux/macOS), CMake ≥ 3.16 (optionnel mais pratique), aucune dépendance à Qt. Pour la section ThreadSanitizer, un compilateur GCC ou Clang avec `-fsanitize=thread` disponible.

Une note honnête sur l'environnement dans lequel ce module a été écrit et mesuré : la machine de développement utilisée pour compiler et chronométrer les chiffres que tu vas lire expose **2 cœurs logiques** (`std::thread::hardware_concurrency()` retourne `2`) — probablement moins que les cœurs disponibles sur ta propre machine de travail. Cela ne change rien au fond de ce que tu vas observer, mais tu verras les chiffres exacts osciller plus que ce à quoi tu t'attendrais sur une machine physique dédiée — un environnement virtualisé partage les cœurs physiques sous-jacents avec d'autres processus que tu ne contrôles pas. C'est en soi une leçon pratique de benchmarking : **mesure toujours plus d'une fois**, et méfie-toi d'un chiffre isolé autant que tu te méfierais d'un échantillon statistique unique.

## Étape 1 — Le squelette du projet

Le projet est composé de deux programmes indépendants, chacun concentré sur une seule démonstration, plus un `CMakeLists.txt` commun :

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

Remarque le `-O2` explicite dans `CMAKE_CXX_FLAGS_RELEASE` : pour un benchmark de performance, compiler sans optimisations (`-O0`, la valeur par défaut si tu ne précises rien) produirait des chiffres dénués de sens — un incrément non optimisé inclut un surcoût qu'aucun programme réel, compilé pour un usage normal, ne traînerait avec lui. Mesurer sans optimisations activées est une erreur de méthode aussi fréquente qu'insidieuse dans ce genre de comparaison.

## Étape 2 — Le premier benchmark : mutex contre atomic sous contention

Construisons `counter_benchmark.cpp` par étapes, en partant de la version protégée par mutex — celle que tu connais déjà depuis le Module 2, ici avec `std::mutex` à la place de `QMutex` puisque nous sommes en territoire C++ pur :

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

Rien de nouveau ici par rapport à ce que tu sais déjà : `std::lock_guard` est l'équivalent standard de `QMutexLocker`, même RAII, même garantie de déverrouillage automatique. Voici maintenant la version atomique, délibérément écrite juste à côté pour la comparaison :

```cpp
static std::atomic<long long> atomicCounter{0};

void incrementWithAtomic(int incrementsPerThread) {
    for (int i = 0; i < incrementsPerThread; ++i) {
        atomicCounter.fetch_add(1, std::memory_order_seq_cst);
    }
}
```

J'utilise délibérément `memory_order_seq_cst` explicite (même si c'est la valeur par défaut, et que je pourrais l'omettre) pour rendre immédiatement visible, à la relecture du code, quelle garantie d'ordonnancement nous choisissons — cohérent avec la recommandation de l'article précédent de ne jamais laisser le choix implicite dans du code que d'autres (y compris toi-même, dans six mois) devront relire.

Le moteur du benchmark est un petit template qui accepte la fonction à chronométrer :

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

Remarque `std::chrono::steady_clock`, et non `system_clock` : pour mesurer un intervalle de temps écoulé, `steady_clock` est le bon choix car il est garanti monotone (il ne revient jamais en arrière, contrairement à l'horloge système, qui peut être corrigée par un service NTP pendant même que tu mesures) — un détail minuscule mais qui, s'il est ignoré, peut produire des benchmarks affichant des chiffres négatifs absurdes dans de rares cas malchanceux.

Enfin le `main()`, qui dimensionne le nombre de threads selon la machine réelle et vérifie la justesse du résultat, pas seulement le temps :

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

Vérifier `counter == expected` n'est pas un détail décoratif : c'est la contre-preuve que les deux versions sont réellement correctes (aucune mise à jour perdue), ce qui rend la comparaison de temps significative — cela n'aurait aucun sens de vanter la rapidité d'une version qui, en cachette, perdrait aussi des incréments.

## Étape 3 — Compile et exécute le premier benchmark

```bash
g++ -std=c++20 -O2 -pthread counter_benchmark.cpp -o counter_benchmark
./counter_benchmark
```

Voici la sortie réelle, mesurée dans ce cours (machine à 2 cœurs logiques, 5 000 000 d'incréments par thread, donc 10 000 000 au total) :

```
=== Project G.1 - Benchmark mutex vs atomic ===
hardware_concurrency() detected: 2 -> using 2 threads
Increments per thread: 5000000 (expected total: 10000000)

[mutex]  time:   194.64 ms   final counter: 10000000   (correct)
[atomic] time:    66.01 ms   final counter: 10000000   (correct)

mutex/atomic ratio: 2.95x
```

En répétant l'exécution deux autres fois, pour ne pas se fier à un seul échantillon :

```
[run 2] mutex: 198.76 ms   atomic: 66.57 ms   ratio: 2.99x
[run 3] mutex: 208.17 ms   atomic: 68.35 ms   ratio: 3.05x
```

Le motif est stable : la version atomique tourne **environ 3 fois plus vite** que la version à mutex, sur cette machine, pour cette charge de travail (un seul incrément par opération — le cas le plus favorable possible pour un atomique, et ce n'est pas un hasard si le projet l'isole ainsi). L'explication est exactement celle de l'article précédent : chaque `lock_guard` qui entre dans une section critique contestée par un autre thread risque de nécessiter l'intervention de l'ordonnanceur du système d'exploitation, tandis que `fetch_add` reste une unique instruction machine bloquée par le bus mémoire pour une poignée de cycles d'horloge — aucun ordonnanceur impliqué, aucun thread mis en pause. Les deux versions, remarque-le, s'avèrent correctes : l'avantage de l'atomique ici est purement une question de performance, pas de justesse.

## Étape 4 — Le second fichier : false sharing, d'abord sans précaution

Passons à `false_sharing.cpp`. D'abord la disposition « naïve », deux compteurs adjacents dans la même struct :

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

`sizeof(AdjacentCounters)` vaut 8 octets — deux `int` de 4 octets l'un à côté de l'autre, bien à l'intérieur d'une unique ligne de cache de 64 octets, exactement le scénario pathologique décrit dans l'article précédent.

## Étape 5 — La disposition correcte, avec alignas(64)

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

`sizeof(PaddedCounter)` monte à 64 octets — une ligne de cache entière pour un seul `int` utile, le gaspillage explicite déjà évoqué — et `sizeof(PaddedCounters)` devient donc 128 octets : deux lignes de cache séparées, garanties telles par l'alignement imposé par `alignas`.

## Étape 6 — Le test : deux threads, deux compteurs indépendants, les deux dispositions

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

Ici j'utilise délibérément `memory_order_relaxed`, contrairement au premier benchmark : chaque thread ne met à jour que son propre compteur, il n'a jamais besoin d'observer l'autre ni de se synchroniser avec lui, il n'y a donc aucune relation happens-before à établir — c'est exactement le cas d'usage honnête de `relaxed` décrit dans l'article précédent, pas un raccourci arbitraire. `if constexpr` (C++17) sélectionne à la compilation quel champ toucher selon le type de `Layout`, si bien que le même template gère les deux expériences sans dupliquer la logique de la boucle.

## Étape 7 — Compile, exécute, et regarde le cache te mentir

```bash
g++ -std=c++20 -O2 -pthread false_sharing.cpp -o false_sharing
./false_sharing
```

Première sortie réelle mesurée :

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

En répétant l'exécution, pour la raison déjà évoquée dans la mise en place :

```
[run 2] adjacent: 3667.79 ms   padded: 2648.09 ms   speedup: 1.39x
[run 3] adjacent: 4523.37 ms   padded: 1306.76 ms   speedup: 3.46x
```

Ici la variabilité entre les exécutions est plus marquée que celle observée à l'Étape 3 — encore une fois, la machine virtualisée à 2 cœurs partagés avec d'autres charges laisse sa marque. Mais remarque ce qui ne change **jamais**, dans aucune des trois exécutions : la direction de l'effet. La disposition rembourrée est toujours plus rapide que la disposition adjacente, jamais l'inverse, avec un gain qui va de +39 % à plus de 4 fois selon le bruit de fond de cette exécution particulière. C'est exactement le genre de lecture honnête qu'exige un bon benchmark : le chiffre exact oscille avec l'environnement, mais le phénomène physique que tu observes — l'invalidation croisée de la ligne de cache partagée — est réel et reproductible, pas un artefact statistique isolé.

## Étape 8 — ThreadSanitizer : vérifie qu'aucune des deux versions ne cache une race

Parce que « ça a marché dans mes tests » ne suffit jamais, en concurrence : une data race peut rester invisible pendant des mois de tests sur une machine et apparaître dès le premier jour sur un matériel différent, avec un nombre de cœurs différent, ou tout simplement avec un système plus chargé que d'habitude. **ThreadSanitizer** (TSan) est un outil d'analyse dynamique intégré à GCC et Clang : il instrumente chaque accès mémoire pendant l'exécution réelle du programme, en gardant trace de quel thread a lu ou écrit chaque emplacement et avec quelle synchronisation. S'il détecte deux threads accédant au même emplacement, au moins l'un en écriture, sans relation de synchronisation reconnue par le standard C++ entre les deux accès, il le signale immédiatement avec la pile d'appels des deux threads.

Compilons les deux programmes avec l'instrumentation activée :

```bash
g++ -std=c++20 -O1 -g -fsanitize=thread -pthread \
    counter_benchmark.cpp -o counter_benchmark_tsan
g++ -std=c++20 -O1 -g -fsanitize=thread -pthread \
    false_sharing.cpp -o false_sharing_tsan
./counter_benchmark_tsan
./false_sharing_tsan
```

Remarque `-O1` au lieu de `-O2` : c'est une recommandation pratique lors de l'utilisation de TSan — avec des optimisations plus agressives, certains réordonnancements d'instructions peuvent rendre les piles d'appels du sanitizer moins lisibles, sans gain réel (à cette taille de programme, le ralentissement de TSan lui-même domine de toute façon le temps total).

Résultat réel, mesuré dans ce cours — **aucun avertissement de data race, sur aucun des deux programmes** :

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

Deux observations méritent d'être relevées. La première : le ralentissement imposé par TSan est énorme et bien visible en comparant ces temps à ceux des Étapes 3 et 7 (le benchmark mutex/atomic passe d'environ 200/67 ms à environ 2716/1132 ms, un facteur situé approximativement entre 14x et 17x) — et c'est précisément la raison pour laquelle TSan s'utilise en phase de vérification et non dans le binaire de production. La seconde, plus importante : **l'absence de tout rapport de race est en elle-même un résultat**, pas un « il ne s'est rien passé » dénué de sens. C'est la contre-preuve expérimentale que `std::mutex` comme `std::atomic`, utilisés comme tu les as vus dans ce projet, protègent réellement l'état partagé dans chaque exécution observée par le sanitizer.

À titre de comparaison, et pour boucler la boucle avec le Module 0 : si dans ce même projet le compteur avait été incrémenté sans aucune synchronisation — `++counter` direct, comme dans la version « dangereuse » du Module 0 — TSan l'aurait signalé immédiatement, avec un rapport du type `WARNING: ThreadSanitizer: data race`, indiquant la ligne exacte et les deux threads en conflit. Nous ne l'avons pas inclus dans ce projet précisément parce que les deux programmes ici sont corrects par construction — mais garder cela à l'esprit reste la raison pratique de toujours compiler, par principe, une build avec TSan activé sur tout nouveau code concurrent que tu écris, plutôt que d'attendre qu'un bug de ce genre émerge de lui-même à un moment imprévisible.

## Ce que tu viens de te démontrer à toi-même

Tu as mesuré — pas supposé, mesuré avec un vrai chronomètre — trois faits qui, dans la plupart des cours de concurrence, restent des affirmations abstraites : qu'un atomique peut être sensiblement plus rapide qu'un mutex pour une opération simple sous contention ; que deux variables logiquement indépendantes peuvent se ralentir mutuellement de façon spectaculaire uniquement à cause de leur position physique en mémoire, et que `alignas(64)` en est un remède concret et vérifiable ; et que ThreadSanitizer peut confirmer, avec le même sérieux qu'un test unitaire confirme la justesse logique, que ton code concurrent est réellement dépourvu des races qu'il pourrait théoriquement dissimuler. Ce sont trois outils qui restent dans ta boîte à outils bien au-delà de ce cours — la première étape, chaque fois que tu optimises du code concurrent, est toujours la même : mesure avant, mesure après, et utilise un sanitizer pour vérifier que la vitesse gagnée n'a pas été payée au prix de la justesse.

---

*Le code source complet de ce projet est disponible dans le dépôt qui accompagne ce cours, dans le dossier `project-G-benchmark-mutex-atomic`.*
