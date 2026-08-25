---
title: "Optimiser la multiplication de matrices en C++ — Partie 3 : la vectorisation, le grand bilan, et deux surprises bien réelles"
description: "Dernier volet de la série : on écrit à la main des instructions vectorielles AVX2 + FMA pour faire quatre multiplications-additions en une seule fois, on compare les cinq étapes de bout en bout — de 1,88 à 11,49 GFLOP/s — et on tombe sur deux surprises mesurées : une taille de matrice, puissance de deux, qui tourne 6,5 fois plus lentement que ses voisines, et un gain de 2,12x obtenu sans changer une seule ligne de code."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "avx2", "simd", "series-part-3"]
---

Si vous suivez cette série depuis la [Partie 1](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-1/), installez-vous confortablement, parce que c'est ici que tout se met en place. On était partis de 1.88 GFLOP/s avec la multiplication de matrices que tout cours d'introduction à l'informatique enseigne — trois boucles imbriquées, rien de sophistiqué. La [Partie 2](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-2/) nous a fait faire un détour par le tuilage (qui, mesuré honnêtement, rendait les choses *pires* à lui seul), avant de nous amener à 8.30 GFLOP/s une fois qu'on a mis un second cœur du processeur au travail avec un simple pragma OpenMP.

Aujourd'hui on actionne un dernier levier — apprendre à la boucle la plus interne à traiter quatre nombres d'un coup au lieu d'un seul — puis on prend du recul pour regarder tout le trajet parcouru, côte à côte. Au passage, deux choses sont apparues dans les mesures qui n'auraient dû surprendre personne ayant lu attentivement la Partie 1, et pourtant : une taille de matrice plus lente que ses voisines sans aucune raison algorithmique, et un gain de 2,12x obtenu sans modifier la moindre ligne de code source.

Vous pouvez retrouver tout le code source à ce [lien](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)
## Apprendre au processeur à faire quatre multiplications-additions d'un coup

Chaque version vue jusqu'ici fait, au fond, exactement la même chose dans son cœur le plus interne : multiplier deux valeurs `double`, ajouter le résultat à un accumulateur, un nombre à la fois. Ce n'est pas que le processeur ne sache traiter qu'un nombre à la fois — c'est qu'on ne lui a jamais demandé autre chose. Les processeurs modernes prennent en charge les instructions **SIMD** (Single Instruction, Multiple Data) : une seule instruction machine qui applique la même opération à plusieurs nombres simultanément. L'extension SIMD qu'on va utiliser ici s'appelle **AVX2**, qui opère sur des registres de 256 bits — assez larges pour loger quatre valeurs `double` de 64 bits côte à côte. Elle s'accompagne de **FMA** (Fused Multiply-Add), une instruction qui calcule `a * b + c` en une seule étape au lieu de deux séparées — ce qui se trouve être *exactement* l'opération logée au cœur de la boucle la plus interne, à chaque étape de cette série. Difficile d'imaginer une instruction plus taillée sur mesure pour ce problème.

![À gauche : la version scalaire traite un double à la fois — huit étapes distinctes pour huit éléments. À droite : AVX2 + FMA charge quatre doubles dans un registre de 256 bits et effectue la multiplication-addition pour les quatre en une seule instruction — deux étapes au lieu de huit.](img/10-avx2-simd.png)

D'où viennent ces instructions ? Pas d'une bibliothèque externe — ce sont des **intrinsèques**, des fonctions C++ déclarées dans l'en-tête standard `<immintrin.h>`, fourni avec toute installation moderne de GCC, Clang ou MSVC. Ce sont de fines enveloppes qui correspondent presque une à une à des instructions machine individuelles ; le compilateur les traduit directement, avec pratiquement aucun des frais généraux qu'un appel de fonction normal impliquerait.

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

Partons de l'extérieur vers l'intérieur : la structure de tuilage et le pragma OpenMP sont **identiques** à l'Étape 4. La vectorisation ne touche que la boucle la plus interne, celle sur `j` — c'est donc elle qui mérite d'être lue ligne par ligne.

`__m256d` est le type C++ représentant un registre AVX de 256 bits contenant quatre valeurs `double`. `_mm256_set1_pd(a_ik)` construit un registre où `a_ik` est répété quatre fois — nécessaire parce que `a_ik` est un simple scalaire, constant sur tout le balayage de `j` (exactement comme à chaque étape précédente), mais les instructions AVX opèrent sur des registres complets, donc il faut le « répandre » dans les quatre voies avant qu'il puisse participer à une opération vectorielle.

La boucle `for (; j + 4 <= j_max; j += 4)` avance **quatre par quatre** au lieu d'un par un : chaque itération traite quatre colonnes contiguës en une seule fois. `_mm256_loadu_pd` charge quatre valeurs `double` consécutives depuis la mémoire dans un registre AVX (le `u` signifie *unaligned*, non aligné : ça fonctionne même quand l'adresse de départ n'est pas alignée sur 32 octets, au prix d'un léger coût de performance par rapport à la variante alignée — un choix de simplicité et de robustesse plutôt que de gratter le dernier pourcent). `_mm256_fmadd_pd(a_vec, b_vec, c_vec)` calcule, en une seule instruction, `a_vec * b_vec + c_vec` sur les quatre voies à la fois — quatre multiplications et quatre additions en virgule flottante en un seul cycle d'horloge (dans l'idéal). `_mm256_storeu_pd` réécrit le résultat en mémoire.

La seconde boucle, `for (; j < j_max; ++j)`, est la **queue scalaire** : elle traite ce qui reste quand la largeur de la tuile courante (`j_max - jj`) n'est pas un multiple exact de quatre. Avec une taille de bloc de 64 (toujours un multiple de 4), cette queue ne se déclenche que sur des valeurs de N qui ne sont pas elles-mêmes un multiple de `BS` — mais elle doit rester présente quoi qu'il arrive, pour garantir la correction sur tout N et tout BS que quelqu'un exécuterait réellement.

## Un détail de compilation qu'on ne peut pas se permettre de sauter

Contrairement à OpenMP, où oublier `-fopenmp` donne quand même un programme correct, simplement séquentiel en silence, oublier les drapeaux AVX2 ici fait que le code **ne compile tout simplement pas** — `<immintrin.h>` verrouille ses propres fonctions derrière des macros liées aux options de compilation :

```bash
g++ -O2 -std=c++17 -fopenmp -mavx2 -mfma stage5_avx2.cpp -o stage5_avx2
./stage5_avx2 1023 64
```

```
AVX2/FMA active at compile time.
Stage 5 - blocked AVX2+FMA   N=1023   time=  0.1863 s      11.493 GFLOP/s
```

Face à l'Étape 4 (0.258 s), c'est **1.39x plus rapide** — un gain réel, mais nettement en deçà du 4x qu'on pourrait naïvement attendre de « quatre nombres à la fois au lieu d'un ». Cet écart mérite une explication honnête plutôt qu'un passage sous silence : la vectorisation n'accélère que l'arithmétique pure. Le temps d'horloge total inclut aussi le trafic mémoire (toujours quatre valeurs `double` par chargement, ce n'est pas une opération instantanée) et les frais de gestion des blocs qui l'entourent. Un plafond théorique de 4x s'applique strictement à la portion arithmétique, pas à l'ensemble du tableau — bon à garder en tête chaque fois qu'un gain de performance est estimé sur le papier avant d'être mesuré pour de vrai.

## Le grand bilan

Cinq étapes, un même protocole de mesure, la même matrice N = 1023, le même matériel tout au long de cette série :

| Stage | Time (s) | GFLOP/s | Speedup vs Stage 1 |
|---|---|---|---|
| Stage 1 — naive ijk | 1.140 | 1.88 | 1.00x |
| Stage 2 — reordered ikj | 0.514 | 4.16 | 2.22x |
| Stage 3 — blocked ikj | 0.719 | 2.98 | 1.58x |
| Stage 4 — blocked + OpenMP | 0.258 | 8.30 | 4.42x |
| Stage 5 — blocked + OpenMP + AVX2/FMA | 0.186 | 11.49 | **6.12x** |

![Diagramme en barres des cinq étapes, GFLOP/s passant de 1,88 à 11,49, annoté 6,12x par rapport à l'Étape 1.](img/11-full-comparison.png)

Avant de faire davantage confiance à ce tableau, voici la divulgation complète que chacun de ces chiffres mérite : g++ 13.3.0 sous Ubuntu, 2 cœurs CPU disponibles, AVX2/FMA pris en charge par le matériel, OpenMP fonctionnel, `-O2` pour chaque étape sauf mention explicite du contraire (la section suivante). **Un chiffre de performance sans le contexte matériel et logiciel dans lequel il a été mesuré ne dit presque rien** — si vous relancez tout ça vous-même sur un autre matériel, attendez-vous à des chiffres absolus différents ; la forme relative, elle, devrait tenir, à la seule exception déjà signalée honnêtement dans la Partie 2 concernant l'Étape 3.

De tout juste sous 2 GFLOP/s à près de 11,5 — un facteur supérieur à six — via quatre changements distincts et cumulatifs, chacun justifié par un principe sous-jacent différent : l'ordre d'accès à la mémoire (Étape 2), des ensembles de travail à la taille du cache (Étape 3, détour compris), plusieurs cœurs (Étape 4), les instructions vectorielles (Étape 5). Aucun d'eux n'a touché à *ce qui* est calculé — seulement à *comment*.

## Surprise n°1 : le piège de la puissance de deux

En préparant cette série, quelque chose est apparu qui n'était pas prévu au programme, et c'est un trop bel exemple de la théorie du cache de la Partie 1 percutant la pratique pour le laisser de côté. En chronométrant l'Étape 1 — la version naïve toute simple — sur trois tailles de matrice voisines :

```
N = 1023 (not a power of two):  time = 1.309 s
N = 1024 (a power of two):      time = 8.488 s
N = 1025:                       time = 1.382 s
```

![Diagramme en barres : N=1023 à 1,31s, N=1024 grimpant à 8,49s, N=1025 redescendant à 1,38s — annoté « puissance de deux ⇒ conflits d'ensembles de cache ».](img/13-power-of-two-trap.png)

**N = 1024 prend presque 6,5 fois plus de temps que N = 1023 ou N = 1025**, alors qu'elle est à peine plus grande — N = 1024 effectue environ 0,3 % d'arithmétique en plus que N = 1023. Rien dans la théorie de complexité en $O(N^3)$ ne prédit une falaise pareille ; elle prédit une courbe lisse. L'explication tient encore au cache, mais via un mécanisme plus subtil que celui de la Partie 1.

![À gauche : avec N=1023, six débuts de ligne consécutifs atterrissent répartis sur six ensembles de cache différents — comportement ordinaire. À droite : avec N=1024, les six débuts de ligne s'entassent exactement dans le même ensemble de cache, qui se retrouve évincé et rechargé à chaque accès.](img/12-cache-conflict.png)

Les caches réels sont organisés en structures **associatives par ensembles** : une adresse mémoire donnée ne peut atterrir que dans un sous-ensemble bien précis des lignes de cache disponibles, déterminé par les bits de poids faible de son adresse. Quand la longueur d'une ligne de matrice est *exactement* une puissance de deux (ou un grand multiple d'une puissance de deux), les adresses que la boucle la plus interne de l'Étape 1 touche successivement — rappelons, `B[k*N + j]`, avec `k` comme boucle qui saute de `N` éléments à chaque pas — retombent sans cesse sur le **même sous-ensemble identique** de lignes de cache au lieu de se répartir. Il en résulte un **conflict miss** de cache : le cache a pourtant de la place libre ailleurs, mais ce sous-ensemble précis se fait écraser en boucle, comme si le cache entier était bien plus petit qu'il ne l'est réellement.

Cet effet est spécifique au motif d'accès à foulée N de l'Étape 1 — précisément le motif d'accès « pire cas » signalé dans la Partie 1, rendu pathologique par une coïncidence d'alignement. Les étapes suivantes, avec un accès séquentiel ou tuilé, y sont bien moins sensibles. C'est tout de même une leçon générale utile : quand une dimension de matrice ou de tableau est sous votre contrôle et que le motif d'accès n'est pas purement séquentiel, éviter les puissances de deux exactes (ou remplir légèrement la ligne pour casser l'alignement) est une véritable technique employée en code de production haute performance, pas juste une curiosité de manuel. Essayez-le vous-même si vous voulez le voir de vos propres yeux — `./stage1_naive 1023`, puis `1024`, puis `1025` — c'est l'une des expériences les plus immédiatement convaincantes de toute cette série.

## Surprise n°2 : isoler l'effet des options de compilation

Toutes les mesures jusqu'ici ont gardé `-O2` constant, spécifiquement pour que les changements algorithmiques ne se mélangent pas avec les changements du niveau d'optimisation du compilateur. Mais combien reste sur la table, rien qu'avec les drapeaux, code source resté rigoureusement fixe ? Prenons le code source de l'Étape 4 (tuilé + OpenMP) — **pas une seule ligne modifiée** — et compilons-le de deux façons différentes :

```bash
g++ -O2 -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_O2
g++ -O3 -march=native -ffast-math -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_O3native
```

`-O3` active des optimisations plus agressives que `-O2`, y compris la propre tentative du compilateur de vectorisation automatique. `-march=native` demande au compilateur de générer du code spécifique au processeur exact sur lequel il compile (y compris, si disponible, l'utilisation automatique d'AVX2 — sans le moindre intrinsèque requis) au lieu de code générique fonctionnant sur n'importe quel processeur x86 — un vrai compromis, puisque le binaire résultant peut ne plus du tout fonctionner sur une autre machine dotée d'un jeu d'instructions plus ancien. `-ffast-math` assouplit certaines règles strictes de la norme IEEE 754 en virgule flottante — précisément, elle autorise le compilateur à réordonner des additions, ce qu'il ne peut normalement pas faire parce que cela changerait le résultat d'une infime quantité — ce qui est exactement la liberté supplémentaire dont une boucle d'accumulation comme la nôtre a besoin pour une vectorisation automatique agressive.

```
Stage 4 with -O2:                              0.3176 s     6.741 GFLOP/s
Stage 4 with -O3 -march=native -ffast-math:    0.1497 s    14.308 GFLOP/s
```

![Diagramme en barres : -O2 à 6,74 GFLOP/s contre -O3 -march=native -ffast-math à 14,31 GFLOP/s sur le même code source identique — annoté 2,12x, zéro ligne modifiée.](img/14-compiler-flags.png)

**2,12x plus rapide, exactement le même fichier source.** Ça vaut la peine de le mettre en regard du reste de la série : réordonner les boucles (Partie 1) avait rapporté 2,22x. Les options de compilation seules, sur une boucle déjà bien écrite, en rapportent encore 2,12x — un rappel à garder tout près avant d'investir du temps dans l'optimisation manuelle : **vérifier que les options de compilation correspondent réellement au matériel visé est souvent le gain de performance le moins cher qui soit disponible**, et cela doit se faire au tout début du processus, pas comme une réflexion après coup une fois l'algorithme déjà réécrit à la main.

On a délibérément choisi de ne pas compiler avec `-O3 -march=native -ffast-math` dès la toute première étape de la Partie 1. Mélanger l'effet des options de compilation avec l'effet des changements algorithmiques aurait rendu impossible de déterminer lequel des deux était réellement responsable d'une amélioration donnée — isoler une variable à la fois, ici les drapeaux face à un code source fixe, c'est la même discipline de mesure que cette série entière a tenté d'incarner de bout en bout.

## Tout rassembler : un seul benchmark, un seul dépôt

Chaque étape a vécu jusqu'ici dans son propre petit exécutable — pratique pour suivre étape par étape, moins pratique si on veut simplement comparer les cinq d'une seule commande. C'est à ça que sert `benchmark_all.cpp` dans le dépôt : il construit une paire de matrices d'entrée (même graine pour chaque version, pour que chaque étape soit mesurée sur des données identiques), calcule un résultat de référence une fois avec l'Étape 1, puis exécute et chronomètre chaque autre version, en vérifiant chaque résultat par rapport à cette référence avec un contrôle de correction `max_abs_diff` avant de faire confiance à l'un quelconque des chiffres.

```bash
g++ -O2 -std=c++17 -fopenmp -mavx2 -mfma benchmark_all.cpp -o benchmark_all
./benchmark_all 1023 64
```

Il affiche le même tableau comparatif montré plus haut — temps, GFLOP/s, gain par rapport à l'Étape 1, et l'erreur maximale par rapport à la référence (de l'ordre de $10^{-14}$ pour chaque étape, exactement ce que prédit l'arrondi en virgule flottante) — et écrit un fichier `benchmark_results.csv` à côté, prêt pour l'outil de visualisation de votre choix.

Le code source complet de chaque étape de cette série — `common.h`, `kernels.h`, les cinq fichiers `stageN_*.cpp`, `benchmark_all.cpp`, un `CMakeLists.txt`, et un `build_and_run.sh` — se trouve dans le dépôt GitHub qui accompagne la série, lié depuis la Partie 1. Clonez-le, compilez-le, et lancez les chiffres sur votre propre machine : processeur différent, nombre de cœurs différent, compilateur différent, chiffres différents — et le constater par soi-même vaut plus que de faire confiance à n'importe quel tableau dans un billet de blog, y compris celui-ci.

## Ce qui reste sur la table

Aucune série technique honnête ne se termine par « et voilà, c'est tout ». Certaines choses ont été délibérément laissées de côté, à la fois pour des raisons de portée et comme piste pour continuer à explorer. On n'a pas touché à l'**algorithme de Strassen** ni à ses proches parents, qui réduisent la complexité asymptotique *en dessous* de $O(N^3)$ en changeant l'algorithme lui-même, plutôt qu'en optimisant l'implémentation d'un algorithme fixe comme l'a fait toute cette série. On n'a pas exploré les **algorithmes cache-oblivious**, qui obtiennent un bon comportement vis-à-vis du cache par un diviser-pour-régner récursif au lieu d'une taille de bloc choisie à la main comme notre `BS` — une approche plus élégante en théorie, puisqu'elle n'a jamais besoin de connaître à l'avance les tailles de cache du processeur cible. Et on n'a pas comparé nos résultats à une bibliothèque BLAS optimisée professionnellement (OpenBLAS, Intel MKL, et consorts) — il serait honnête de s'attendre à ce que l'une d'elles batte encore sensiblement l'Étape 5, étant écrite par des spécialistes et réglée pendant des décennies sur d'innombrables architectures. Le but de cette série n'a jamais été de rivaliser avec ce niveau d'ingénierie — c'était de comprendre, une étape mesurée à la fois, d'où vient réellement ce genre de performance.

## Une dernière chose

L'enseignement le plus durable ici n'est pas le nombre 6,12x — c'est l'habitude qu'il représente : mesurer avant d'optimiser, mesurer à nouveau après chaque changement, un par un, vérifier la correction à chaque étape, et alors seulement en tirer une conclusion. Cette habitude s'applique bien au-delà de la multiplication de matrices — une requête de base de données lente, une boucle de contrôle qui rate sans cesse son temps de cycle, un pipeline de vision qui n'arrive pas à suivre la cadence de la chaîne, tous récompensent exactement la même discipline. Le code change d'un domaine à l'autre. La méthode — la théorie pour savoir quoi chercher, la mesure honnête pour la vérifier, la correction vérifiée à chaque étape — ne change pas.

Merci d'être resté jusqu'au bout de ces trois parties. Allez mesurer quelque chose.
