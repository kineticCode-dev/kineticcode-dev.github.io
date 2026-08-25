---
title: "Optimiser la multiplication de matrices en C++ — Partie 2 : tiling, threads et une surprise bien honnête"
description: "Partie 2 de la série pratique sur l'optimisation des performances : pourquoi découper les matrices en petites tuiles dimensionnées pour le cache ne paie pas forcément tout seul, et comment mettre un second cœur CPU au travail avec un simple pragma OpenMP nous pousse à un gain mesuré de 4,42x — le tout vérifié, le tout reproductible."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "openmp", "cache-tiling", "series-part-2"]
---


Si vous avez lu [la partie 1](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-1/) de cette série, vous connaissez déjà la chute de l'histoire jusqu'ici : exactement la même multiplication de matrices, le même algorithme, le même nombre d'opérations en virgule flottante, est passée de 1,88 GFLOP/s à 4,16 GFLOP/s simplement en changeant l'ordre de trois boucles `for`. Rien de malin, aucune nouvelle fonctionnalité matérielle, juste le respect de la façon dont la mémoire est réellement lue.

Si vous arrivez tout juste dans la série — bienvenue, voici la version en deux phrases : les matrices sont stockées comme un unique tableau plat, en row-major (ligne par ligne), et parcourir ce tableau de façon séquentielle coûte infiniment moins cher que de sauter d'un endroit à l'autre, parce que les CPU récupèrent la mémoire par lignes de cache, pas nombre par nombre. Cette même idée va continuer à payer dans cet article, sous deux formes nouvelles et moins évidentes : comment vous *regroupez* le travail effectué sur chaque ligne de cache, et combien de cœurs CPU vous mettez à contribution.

À la fin de cette partie, nous serons **4,42x** plus rapides que le point de départ de la partie 1 — mais le chemin n'est pas une ligne droite, et le détour est plus intéressant que la destination.

Vous pouvez retrouver tout le code source à [ce lien](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)

## Réordonner les boucles n'était pas la fin de l'histoire

L'étape 2 a corrigé la *direction* dans laquelle la mémoire est parcourue. Elle n'a pas corrigé un autre problème : pour chaque ligne de la matrice de sortie C, la boucle réordonnée continue de balayer *toute* la matrice B, de haut en bas. B, à elle seule, pour une matrice 1023×1023 de `double`, pèse un peu plus de 8 Mo. C'est loin, très loin, de tenir dans le cache L1 (quelques dizaines de Ko) ou même dans le L2 (quelques Mo sur la plupart des CPU grand public) — donc, à chaque nouvelle ligne de C, le CPU repart en pratique de zéro avec B, en évinçant les données utiles qu'il venait tout juste de charger pour la ligne précédente.

C'est une variante de la même idée de fond que dans la partie 1 : la localité spatiale (parcourir la mémoire dans l'ordre) n'est pas la même chose que la localité temporelle (réutiliser une donnée chargée il y a un instant, avant qu'elle ne soit évincée). L'étape 2 a parfaitement réglé la première. Elle laisse la seconde entièrement de côté.

## Le tiling : travailler sur un morceau assez petit pour rester en place

La solution a un nom — le **tiling**, parfois appelé **blocking** — et l'idée, avant même d'écrire une ligne de code, est presque gênante de simplicité : au lieu de balayer des lignes et des colonnes entières, découper les matrices en petites **tuiles** carrées, dimensionnées pour qu'une tuile tienne confortablement dans le cache L1 ou L2, et terminer tout le travail possible sur une tuile avant de passer à la suivante.

![À gauche : l'étape 2 balaie toute la matrice B à chaque ligne, bien plus grande que n'importe quel niveau de cache. À droite : l'étape 3 travaille une tuile BS×BS à la fois, assez petite pour rester résidente en L1/L2 tout en étant réutilisée sur toute une bande de lignes.](img/06-tiling-concept.png)

En code, cela signifie que la structure plate à deux boucles de l'étape 2 se voit ajouter trois boucles supplémentaires à l'extérieur — une par dimension, parcourues par pas de `BS` (block size, la taille de bloc) au lieu de pas de 1 :

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

Regardez d'un peu plus près et vous remarquerez que les trois boucles les plus internes — sur i, k, j — sont *identiques caractère pour caractère* à celles de l'étape 2. Rien n'a changé dans l'arithmétique. Les trois nouvelles boucles externes (`ii`, `kk`, `jj`) se contentent de découper le problème en sous-blocs `BS`×`BS` et de restreindre chaque passage des boucles internes au travail sur un seul sous-bloc à la fois, de sorte que ce bloc de B reste assez petit pour être encore présent en cache la prochaine fois qu'on en a besoin. `std::min(ii + BS, N)` est là purement pour la correction du résultat — elle borne la dernière tuile, partielle, quand N n'est pas un multiple exact de `BS`.

Compilé et exécuté de la même façon qu'avant :

```bash
g++ -O2 -std=c++17 stage3_blocked.cpp -o stage3_blocked
./stage3_blocked 1023 64
```

```
Stage 3 - blocked ikj        N=1023   time=  0.7194 s      2.976 GFLOP/s
```

## La surprise : c'est plus lent que l'étape 2, pas plus rapide

Le voici, noir sur blanc :

![Diagramme en barres : étape 1 à 1,88 GFLOP/s, étape 2 à 4,16 GFLOP/s, étape 3 (avec tiling, mono-thread) qui retombe à 2,98 GFLOP/s — une annotation signale que le tiling seul est plus lent que l'étape 2.](img/07-stage1-2-3-benchmark.png)

Si ceci était un tutoriel bien propre où chaque étape est un gain net, ce chiffre aurait été discrètement passé sous silence, ou la taille de bloc aurait été bidouillée jusqu'à ce qu'elle ait l'air meilleure. Ce ne sera pas le cas ici. **Un résultat mesuré qui va dans le "mauvais" sens n'est pas une erreur à cacher — c'est une donnée**, et celle-ci, en particulier, enseigne quelque chose qu'un graphique monotone croissant n'apprendrait jamais.

Deux choses sont vraies en même temps ici, et cela vaut la peine de les démêler.

D'abord, le tiling a un coût réel, non nul : six boucles imbriquées au lieu de trois, avec `std::min` recalculé à chaque frontière de tuile. Ce surcoût ne vaut la peine d'être payé que si les défauts de cache qu'il élimine le compensent largement.

Ensuite — et c'est la partie propre à la machine — le cache L2 du CPU utilisé pour ces mesures est de 2 Mo par cœur. Une matrice 1023×1023 de `double` pèse environ 8 Mo — bien plus grande que le L2, certes, mais le *motif d'accès à l'intérieur d'une ligne* de l'étape 2 était déjà raisonnablement adapté au cache sur ce matériel précis, ce qui laisse moins de marge pour que le tiling seul, en mono-thread, puisse en récupérer. Sur un CPU avec un cache plus petit, ou sur un problème plus grand, cette même comparaison pourrait très bien s'inverser. Ce n'est pas une réserve à survoler rapidement — c'est toute la raison pour laquelle cette série insiste pour *mesurer*, sur votre propre machine, plutôt que de faire confiance à une règle empirique recopiée d'un article de blog (celui-ci y compris).

**Alors pourquoi garder l'étape 3 dans la série**, si elle perd face à l'étape 2 à elle seule ? Parce qu'ici, le tiling n'a pas vraiment pour but la vitesse en mono-thread — il s'agit de préparer le coup suivant.

```{=comment}
(marqueur neutre pour les deux points que cet article NE prétend PAS : il ne prétend pas que le tiling est inutile, et il ne prétend pas que ce chiffre se généralise à tous les CPU.)
```

## Répartir le travail entre les cœurs

Un calcul en tuiles a une propriété que la boucle plate de l'étape 2 n'avait pas aussi nettement : il est déjà découpé en morceaux indépendants. Et des morceaux de travail indépendants, c'est exactement ce qu'il faut pour les confier à plus d'un cœur CPU.

**OpenMP** est l'outil pour ça, et ce n'est pas une bibliothèque à télécharger séparément — c'est une fonctionnalité du compilateur, activée par un simple flag (`-fopenmp` pour GCC et Clang), plus un header standard, `<omp.h>`, fourni avec le compilateur lui-même. En pratique, dans l'écrasante majorité du code réel, on l'utilise via des **directives pragma** : des lignes qui ressemblent à des commentaires, mais que l'on demande au compilateur d'interpréter comme des instructions plutôt que de les ignorer. Cela a un effet secondaire agréable : du code qui utilise des pragmas OpenMP continue de compiler et de s'exécuter correctement sans `-fopenmp` ; le pragma est simplement ignoré, et le code tourne en mono-thread.

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

Comparez ce code à l'étape 3 ci-dessus : il est identique, jusqu'aux espaces, à l'exception d'une seule ligne — `#pragma omp parallel for schedule(dynamic)`, juste au-dessus de la boucle la plus externe sur `ii`. Cette seule ligne dit au compilateur : répartis les itérations de cette boucle entre les threads disponibles, et exécute-les en parallèle plutôt que les unes après les autres.

## Pourquoi c'est vraiment sans risque

Coller un `parallel for` sur une boucle sans y avoir vraiment réfléchi est l'une des erreurs les plus courantes — et les plus dangereuses, précisément parce qu'elle est intermittente — du code parallèle. Si deux threads écrivent au même emplacement mémoire sans coordination, on obtient une **race condition**, un bug qui ne se manifeste souvent pas à chaque exécution, ce qui la rend infernale à déboguer avec un débogueur classique.

![La matrice C découpée en blocs de lignes ; les blocs alternés sont confiés au Thread 0 et au Thread 1. Légende : chaque thread n'écrit jamais que dans ses propres lignes de C — A et B sont en lecture seule pour tout le monde — donc aucune écriture partagée, aucune race condition, aucun verrou nécessaire.](img/08-openmp-row-split.png)

Ici, cela vaut la peine de vraiment détailler *pourquoi* c'est sûr, plutôt que de le prendre pour acquis. La boucle qui est parallélisée est celle sur `ii` — des blocs de *lignes* de C. Pour la valeur de `ii` confiée à un thread donné, ce thread n'écrit jamais que dans les lignes de C comprises entre `ii` et `i_max` — une plage de lignes qu'**aucun autre thread ne touche jamais**, puisque chaque valeur de `ii` est attribuée à exactement un seul thread. Il n'y a donc aucune écriture partagée sur C, et par conséquent aucune race condition possible dessus. A et B, de leur côté, ne sont jamais que *lues* par chaque thread, jamais écrites — et des lectures concurrentes de la même donnée sont toujours sûres, sans qu'aucune synchronisation soit nécessaire.

`schedule(dynamic)` mérite lui aussi une mention à part : il dit à OpenMP de distribuer des blocs d'itérations aux threads au fur et à mesure qu'ils se libèrent, plutôt que de découper le travail en parts fixes et égales dès le départ. Avec des blocs d'une taille aussi uniforme que ceux-ci, la différence pratique avec l'ordonnancement statique par défaut est faible — mais `dynamic` reste le choix par défaut le plus robuste en général, puisqu'il conserve son efficacité même si la charge par bloc n'est pas parfaitement équilibrée (par exemple, la dernière tuile, partielle, quand N n'est pas un multiple de `BS`).

## La mesure

```bash
g++ -O2 -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_parallel
./stage4_parallel 1023 64
```

```
OpenMP active: 2 threads available.
Stage 4 - blocked parallel   N=1023   time=  0.2580 s      8.298 GFLOP/s
```

![Diagramme en barres, quatre étapes : 1,88, 4,16, 2,98, 8,30 GFLOP/s, avec l'étape 4 annotée comme étant 4,42x plus rapide que l'étape 1.](img/09-stage1-4-benchmark.png)

C'est un gain de **4,42x** par rapport à l'étape 1 — un chiffre à lire avec attention, car à première vue il paraît disproportionné pour une machine à seulement 2 cœurs. La comparaison honnête, pourtant, ne se fait pas face à l'étape 1 — elle se fait face à l'étape 3 (0,719 s), le même algorithme en tuiles tournant sur un seul cœur : `0.719 / 0.258 ≈ 2.79`, un gain légèrement *au-dessus* du 2x théorique attendu en doublant le nombre de cœurs — probablement parce que répartir le travail soulage aussi la pression sur le cache L3 partagé, un effet secondaire qui s'ajoute au parallélisme brut. Face à l'étape 2 (0,514 s), la comparaison la plus équitable, le chiffre est bien plus crédible : **1,99x** — quasiment exactement le doublement attendu avec 2 cœurs, et la façon la plus juste de juger ce que le parallélisme en lui-même a réellement apporté sur cette machine précise.

**Une limite honnête, dite sans détour.** Ces chiffres ont été mesurés sur une machine avec seulement 2 cœurs CPU. Exactement le même code — pas une ligne modifiée — passerait à l'échelle bien plus loin sur une machine à 8 ou 16 cœurs, jusqu'à (sans jamais tout à fait l'atteindre, à cause du surcoût de synchronisation et de la bande passante mémoire partagée) un gain proportionnel au nombre de cœurs. Si vous disposez de plus de cœurs, relancer `benchmark_all` vous-même est le moyen le plus direct de voir combien de marge le parallélisme laisse réellement sur la table au-delà de ce que cette machine précise a pu montrer.

## Ce qu'il reste à explorer

Quatre points de mesure honnêtes jusqu'ici : 1,88 → 4,16 → 2,98 (le détour) → 8,30 GFLOP/s. Deux gros leviers restent intacts, et la partie 3 s'attaque aux deux :

- **La vectorisation manuelle avec AVX2 et FMA** — écrire à la main la boucle la plus interne avec des instructions vectorielles qui traitent quatre valeurs `double` par instruction au lieu d'une seule.
- **La comparaison complète, et deux nouvelles surprises bien honnêtes** — pourquoi une taille de matrice qui se trouve être une puissance de deux peut tourner *considérablement* plus lentement qu'une taille voisine qui ne l'est pas, et pourquoi isoler l'effet des flags de compilation agressifs de celui des changements algorithmiques s'avère compter presque autant que le travail sur l'algorithme lui-même.

Le code complet et compilable de chaque étape de cette série — y compris celles encore à venir — se trouve dans le dépôt GitHub lié depuis la partie 1. Clonez-le, compilez-le avec CMake, et faites tourner les mesures sur votre propre matériel ; les vôtres seront différentes de celles-ci, et c'est exactement le but.
