---
title: "Optimiser la multiplication de matrices en C++ — Partie 1 : ce que l'ordre des boucles apporte réellement"
description: "Le premier article d'une série pratique sur l'ingénierie de la performance : pourquoi la multiplication de matrices est lente par défaut, comment fonctionne réellement la mémoire d'un ordinateur, et comment le simple fait de réordonner trois boucles for permet un gain de 2,2x — mesuré, pas supposé."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "series-part-1"]
---

Depuis quelque temps, je suis par moi-même le contenu du cours *Performance Engineering* du MIT, et à un certain moment la théorie a cessé de suffire. Lire sur les hiérarchies de cache et l'ordre des boucles est une chose ; voir son propre code passer d'un peu moins de 2 GFLOP/s à plus de 11 GFLOP/s sur sa propre machine, avec exactement le même algorithme, en est une autre. J'ai donc choisi un problème — la multiplication de matrices carrées en C++ — et j'ai décidé de parcourir moi-même chaque étape d'optimisation, en mesurant honnêtement à chaque stade, plutôt que de faire confiance à ce qui « devrait » être plus rapide.

Ceci est le premier article de cette série. Il couvre la première partie du parcours : pourquoi la multiplication de matrices est lente au départ, comment un processeur moderne va réellement chercher les données, et la première véritable optimisation — qui ne touche en rien à l'algorithme, n'ajoute pas le moindre thread, et n'utilise aucun indicateur de compilation particulier. Elle se contente de changer l'ordre de trois boucles `for`. Le résultat est un gain mesuré de 2,22x, et comprendre *pourquoi* cela fonctionne constitue le socle de tout ce qui suivra dans cette série.

Vous pouvez consulter tout le code source à ce [lien](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)

## Un problème facile à énoncer et coûteux à calculer

Multiplier deux matrices carrées $A$ et $B$, toutes deux de côté $N$, produit une troisième matrice $C$ où chaque élément $C_{ij}$ est la somme des produits entre la ligne $i$ de $A$ et la colonne $j$ de $B$ :

$$
C_{ij} = \sum_{k=0}^{N-1} A_{ik} \cdot B_{kj}
$$

La définition tient en une ligne. Le coût, lui, ne s'adapte pas du tout aussi gentiment : calculer chaque élément de $C$ nécessite $N$ multiplications et $N$ additions, et il y a $N^2$ éléments à calculer, donc le total est de l'ordre de $2N^3$ opérations en virgule flottante. Doublez le côté de la matrice, et le travail ne double pas — il est multiplié par huit. Cette croissance cubique est précisément ce qui fait de la multiplication de matrices un terrain de jeu aussi efficace pour le travail de performance : un gain qui paraît négligeable sur un petit problème de démonstration se transforme en minutes, voire en heures économisées sur un problème de grande taille — une couche de réseau de neurones, une simulation physique, un système de commande à représentation d'état.

Ce n'est pas non plus un exercice académique choisi par commodité. La multiplication de matrices est, très littéralement, le cœur computationnel de l'entraînement et de l'exécution des réseaux de neurones modernes, d'une grande partie du calcul scientifique, de l'infographie 3D, et de nombreux algorithmes de commande et d'estimation utilisés en automatique. Les bibliothèques qui l'implémentent à l'extrême (BLAS, cuBLAS, MKL) comptent parmi les logiciels les plus intensément optimisés jamais écrits — comprendre *pourquoi* elles doivent exister, et ce qu'elles font différemment d'une implémentation naïve, est la voie la plus directe vers l'ingénierie de la performance en général, pas seulement pour les matrices.

## Comment une matrice vit réellement en mémoire

Avant de parler de vitesse, un détail d'implémentation doit être fixé avec précision, car tout le reste de cette série en dépend : comment une matrice N×N est réellement disposée en mémoire. Un ordinateur n'a aucune notion native de « grille 2D » — la mémoire est, physiquement, une longue séquence linéaire d'octets. Une matrice à deux dimensions doit être *aplatie* sur cette séquence, et il existe exactement deux façons raisonnables de le faire : le **row-major** (ordre ligne), où des lignes entières sont placées les unes après les autres, ou le **column-major** (ordre colonne), l'inverse, où des colonnes entières sont placées les unes après les autres. C et C++ utilisent le row-major pour les tableaux multidimensionnels natifs ; Fortran, et par extension une bonne partie des logiciels numériques historiques, utilise le column-major. Ce n'est pas un détail d'implémentation mineur — ce choix détermine, très littéralement, quel ordre de boucles sera rapide et lequel sera lent, comme le démontre la suite de cet article.

Dans le code de cette série, une matrice N×N est représentée par un unique `std::vector<double>` de longueur $N^2$, en ordre row-major : l'élément logique $(i, j)$ se trouve à l'indice `i * N + j`.

![Une matrice 3x3 aplatie en un seul vecteur row-major, avec la formule d'indexation i*N+j](img/01-row-major-flattening.png)

**Pourquoi pas `std::vector<std::vector<double>>`?** C'est tentant — un vecteur de vecteurs se lit naturellement comme « une matrice ». Le problème est que chaque vecteur interne constitue sa propre allocation de tas (heap), séparée. Les lignes finissent dispersées en mémoire, sans aucune garantie de proximité entre elles ; seuls les éléments *à l'intérieur* d'une même ligne sont garantis contigus. Un unique vecteur plat, indexé à la main, est la seule façon de garantir que toute la matrice constitue un bloc contigu — et comme l'explique la section suivante, la contiguïté n'est pas un simple confort, c'est tout l'enjeu.

![Vecteur unique contigu comparé aux allocations de tas dispersées d'un vecteur de vecteurs](img/02-vector-of-vectors-fragmentation.png)

## Le processeur n'est pas « une calculatrice qui exécute des instructions » — c'est une hiérarchie mémoire

C'est l'idée centrale de tout cet article, et elle mérite qu'on s'y attarde. La façon intuitive de se représenter un processeur — il lit une instruction, va chercher les données dont il a besoin, les traite — est techniquement correcte mais cache un détail énorme : **récupérer une donnée n'a pas un coût fixe**. Un CPU moderne ne lit pas les données directement depuis la RAM principale à chaque accès ; la RAM est bien trop lente par rapport à la vitesse à laquelle le CPU pourrait, en principe, traiter les données. Si chaque lecture devait attendre la RAM, le CPU passerait l'écrasante majorité de son temps tout simplement inactif, à attendre.

C'est pour cela qu'existe le **cache** : une série de mémoires progressivement plus petites, progressivement plus proches (physiquement, sur la puce), et donc progressivement plus rapides. Un processeur moderne typique comporte trois niveaux : **L1**, minuscule (32–64 Ko par cœur) mais presque aussi rapide que les registres du CPU lui-même ; **L2**, plus grand et encore très rapide (256 Ko – 2 Mo par cœur) ; **L3**, partagé entre tous les cœurs de la puce, beaucoup plus grand (plusieurs Mo, parfois des dizaines) mais le plus lent des trois. Ce n'est que si une donnée n'est trouvée dans aucun de ces trois niveaux que le processeur doit aller la demander à la RAM principale — une opération qui, mesurée en cycles d'horloge, est nettement plus lente qu'un accès réussi en L1.

![Hiérarchie du cache CPU, des registres jusqu'à la RAM principale en passant par L1, L2 et L3, avec les tailles et latences relatives](img/03-cache-hierarchy.png)

Le cache ne fonctionne pas en copiant des octets ou des nombres individuels — il copie des **lignes de cache** entières, typiquement 64 octets à la fois (huit valeurs `double`). Cela fonctionne grâce à un pari, appelé le **principe de localité**, qui se révèle gagnant dans l'écrasante majorité des cas dans les programmes réels : si vous venez d'utiliser la donnée à l'adresse X, il est très probable que vous utilisiez bientôt aussi la donnée à des adresses voisines (localité *spatiale*), et il est probable que vous réutilisiez sous peu la donnée à l'adresse X elle-même (localité *temporelle*). Un programme qui respecte ce pari — qui parcourt la mémoire de façon séquentielle et réutilise ce qu'il vient de charger — s'exécute rapidement. Un programme qui le trahit — qui saute d'un endroit à l'autre de la mémoire, touchant chaque donnée une seule fois et jamais plus — paie le prix plein d'un accès RAM, encore et encore, même si du point de vue de l'algorithme il effectue « la même quantité de travail ».

## Où cela mord réellement dans la multiplication de matrices

Revenons à la formule : $C_{ij} = \sum_k A_{ik} \cdot B_{kj}$. La façon « manuel scolaire » d'écrire cela en code utilise trois boucles imbriquées sur les indices i, j, k, dans cet ordre — parce que c'est l'ordre dans lequel la formule mathématique se lit naturellement de gauche à droite. Le problème est que, avec une mémoire row-major, l'accès `A[i * N + k]` se déplace de façon séquentielle quand k varie (localité spatiale parfaite), tandis que l'accès `B[k * N + j]`, avec k comme index le plus *interne*, saute d'une ligne entière — N éléments — à chaque itération. C'est exactement l'opposé de la localité spatiale, et du pire côté possible : pour N suffisamment grand, chaque saut de N éléments atterrit hors du cache L1, et souvent hors du L2 également, forçant un accès lent à chaque multiplication.

C'est précisément le genre d'observation que cette série est construite pour rendre tangible plutôt que purement théorique. Le reste de cet article écrit la version « manuel scolaire », la mesure honnêtement, puis la transforme — sans changer le moindre résultat numérique produit — simplement en changeant l'ordre des trois boucles. L'amélioration ne sera pas une erreur d'arrondi de quelques points de pourcentage : ce sera un facteur multiplicatif mesurable, obtenu sans écrire une seule ligne d'algorithme « plus intelligent » — juste en écrivant exactement le même algorithme dans l'ordre qui respecte le fonctionnement réel de la mémoire.

## Un mot rapide sur la configuration du projet

Avant d'écrire le moindre code sensible à la performance, il y a une petite décision architecturale qui mérite d'être énoncée plutôt que subie par habitude : ce projet est une **application console C++17 pure**, construite avec **CMake**, **sans aucune bibliothèque numérique externe**. Pas d'Eigen, pas de BLAS, rien à télécharger ni à lier — l'objectif de cette série est de comprendre *d'où* vient la vitesse, pas de la déléguer à une bibliothèque qui a déjà résolu le problème (même si, pour être honnête, dans un vrai projet de production une bibliothèque BLAS bien optimisée surpassera presque toujours du code écrit à la main — j'y reviendrai dans une comparaison ultérieure). Le C++ moderne apporte aussi des bénéfices réels, non cosmétiques, par rapport au C classique ici : `std::vector` offre une gestion mémoire sûre et automatique, sans `malloc`/`free` manuel et sans risque d'oublier un `free` ou de lire de la mémoire non initialisée, et les templates permettent qu'une seule fonction de chronométrage fonctionne, sans modification, sur chacune des versions de l'algorithme que cette série va construire.

## Comment mesurer le temps sans se tromper soi-même

Avant d'écrire la première vraie version de la multiplication, il vaut la peine de construire les outils qui serviront à la mesurer — un choix d'ordre délibéré. Mal mesurer la performance est facile, et cela produit des conclusions fausses avec exactement la même apparence de confiance qu'une mesure correcte : un chiffre à l'écran a toujours l'air d'autorité, même quand la méthode qui l'a produit est défaillante. Trois erreurs en particulier sont assez courantes pour mériter d'être mentionnées explicitement, avant même de regarder la moindre ligne du vrai code de multiplication.

**Erreur numéro un : mesurer sans préchauffer le cache.** La toute première exécution d'une fonction, sur des données fraîchement allouées, paie des coûts que les exécutions suivantes ne paient pas : les pages mémoire qui viennent d'être allouées ne sont peut-être pas encore physiquement mappées par le système d'exploitation (un *page fault*), et le cache ne contient encore rien d'utile. Mesurer une seule exécution « à froid » mesure aussi ces coûts ponctuels, et non la performance en régime établi de l'algorithme — qui est presque toujours ce qui compte réellement, puisque cela reflète le comportement du code lorsqu'il tourne pendant un certain temps.

**Erreur numéro deux : faire confiance à une seule mesure.** Toute machine réelle fait tourner un système d'exploitation jonglant avec des dizaines d'autres processus, des interruptions matérielles, et une fréquence d'horloge qui peut varier dynamiquement pour des raisons thermiques. Une seule exécution peut, par pur hasard, être ralentie par quelque chose de totalement étranger au code mesuré. Le correctif le plus robuste n'est pas la moyenne arithmétique (qu'une seule valeur aberrante peut encore fortement fausser), mais la **médiane** : la valeur du milieu d'une série de mesures triées, qui par construction ignore les extrêmes.

**Erreur numéro trois, la plus sournoise : mesurer quelque chose qui ne fait pas ce que l'on croit.** Un compilateur moderne est agressif quand il s'agit d'éliminer du code qui, selon son analyse, n'a aucun effet observable — si vous calculez un résultat et ne l'utilisez jamais, le compilateur peut tout simplement ne pas le calculer du tout, vous laissant mesurer un temps « impossiblement » rapide qui ne correspond à aucun travail réel. Dans cette série, le risque est faible, car chaque version écrit son résultat dans une matrice qui est ensuite explicitement comparée pour vérifier son exactitude — un effet observable qui empêche le compilateur de « tricher » en évacuant le calcul.

Ces trois points sont tous rassemblés dans un unique en-tête partagé, `common.h`, inclus par chaque étape du projet :

```cpp
// Chronomètre haute résolution basé sur <chrono>.
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

// Exécute « func » plusieurs fois, ignore la première exécution (préchauffage),
// et renvoie la MÉDIANE des temps des exécutions suivantes.
template <typename Func>
double median_timing_seconds(Func&& func, int repetitions = 5) {
    func();  // préchauffage, ignoré

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

Le chronométrage utilise `std::chrono::steady_clock`, et non `std::chrono::system_clock` : la différence compte. `system_clock` représente l'heure murale réelle, et elle peut sauter — une synchronisation NTP, un changement manuel de l'horloge — ce qui rendrait les mesures de durée non fiables dans des cas rares mais réels. `steady_clock` est garantie monotone : elle n'avance jamais que vers l'avant, à un rythme constant, ce qui est exactement la propriété nécessaire pour mesurer correctement un intervalle de temps.

L'autre élément qui mérite d'être montré est la façon dont un temps mesuré brut se transforme en un chiffre comparable entre différentes tailles de problème : les **GFLOP/s**, milliards d'opérations en virgule flottante par seconde. Comme établi plus haut, une multiplication N×N par N×N nécessite au total $2N^3$ opérations en virgule flottante ; en divisant par le temps mesuré, puis par un milliard, on obtient un débit qui permet de comparer N=200 à N=2000 sur un pied d'égalité.

```cpp
inline double gflops(int N, double seconds) {
    double flops = 2.0 * static_cast<double>(N) * N * N;
    return (flops / seconds) / 1e9;
}
```

## Étape 1 : la version « manuel scolaire »

Voici la première version — celle déjà anticipée en théorie plus haut. Trois boucles imbriquées, dans l'ordre où la formule mathématique se lit le plus naturellement : i, puis j, puis k.

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

Un choix d'implémentation petit mais délibéré : la somme est accumulée dans une variable locale, `sum`, et écrite dans `C[i * N + j]` seulement une fois la boucle k terminée, plutôt que d'écrire directement dans `C[i*N+j] += ...` à chaque itération. `sum` vit presque certainement dans un registre du CPU pendant toute la durée de la boucle interne — l'accès le plus rapide possible, plusieurs ordres de grandeur plus rapide même qu'un accès réussi en cache L1. Écrire de façon répétée en mémoire (même en mémoire cachée) à l'intérieur de la boucle la plus interne aurait été une petite blessure auto-infligée, facilement évitable, qu'il valait la peine d'écarter dès la toute première version.

Compilé avec `g++ -O2 -std=c++17` et exécuté avec N = 1023 sur la machine de développement utilisée pour cette série (un CPU Intel avec 2 cœurs disponibles — la divulgation complète du matériel et du logiciel viendra avec le tableau comparatif complet plus loin dans cette série), le résultat est :

```
Stage 1 - naive ijk          N=1023   time=  1.1402 s      1.878 GFLOP/s
```

Un peu plus d'une seconde. Gardez ce chiffre en tête — c'est la base de référence à laquelle chaque étape ultérieure de cette série sera comparée.

## Étape 2 : réordonner les boucles en (i, k, j)

Changeons maintenant **uniquement l'ordre des trois boucles**, de (i, j, k) à (i, k, j). Les mathématiques calculées sont identiques — la même formule, $C_{ij} = \sum_k A_{ik} B_{kj}$ — seul l'enchaînement dans lequel les opérations individuelles de multiplication-addition se produisent change :

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

Deux différences par rapport à l'étape 1 méritent un commentaire avant le point principal. D'abord, le résultat n'est plus accumulé dans une seule variable `sum` : désormais la boucle la plus interne parcourt j, donc à chaque itération c'est un élément *différent* de C qui est mis à jour — il ne peut plus être conservé dans un seul registre local, il doit donc être accumulé directement dans `C[i*N+j]`. Pour cette raison, C doit maintenant être explicitement mis à zéro au départ (`std::fill`), ce dont l'étape 1 n'avait pas besoin, puisque là chaque élément était écrit exactement une fois, et non accumulé. Ensuite, `a_ik` est extrait une seule fois par paire (i, k), en dehors de la boucle j : il est constant pendant toute la durée de cette boucle interne, donc le calculer une fois plutôt que N fois est une optimisation modeste, essentiellement gratuite.

Mais le changement qui compte réellement est celui évoqué plus haut : maintenant, avec j comme index le plus interne, **à la fois** `B[k*N + j]` **et** `C[i*N + j]` sont parcourus en séquence, un élément après l'autre — exactement comme ils sont disposés en mémoire row-major. Chaque ligne de cache chargée (64 octets, huit valeurs `double`) est utilisée pendant huit itérations consécutives de la boucle, au lieu d'une seule, comme c'était le cas avec l'accès à pas variable dans B de l'étape 1.

![Comparaison des motifs d'accès : l'étape 1 descend une colonne de B avec un pas de N, l'étape 2 parcourt une ligne de B avec un pas de 1](img/04-access-pattern-comparison.png)

```
Stage 2 - reordered ikj      N=1023   time=  0.5143 s      4.164 GFLOP/s
```

De 1,14 seconde à 0,51 seconde : plus du double, **2,22x plus rapide**, obtenu sans changer l'algorithme, sans ajouter de parallélisme, sans toucher au moindre indicateur de compilation — simplement en écrivant les trois mêmes boucles `for` dans un ordre différent. S'il ne fallait retenir qu'une seule chose de tout cet article, ce serait celle-ci : l'ordre dans lequel on parcourt la mémoire compte tout autant — parfois plus — que l'algorithme que l'on exécute.

![Diagramme en barres des GFLOP/s mesurés, étape 1 contre étape 2, N=1023](img/05-stage1-vs-stage2-benchmark.png)

**Vérification de l'exactitude, toujours.** Avant de faire confiance à un chiffre de performance, vérifiez que le résultat est réellement correct : comparer la matrice C produite par l'étape 2 à celle produite par l'étape 1, sur la même entrée, donne une différence maximale de `3.55e-14` — entièrement attribuable au fait que l'addition en virgule flottante n'est pas parfaitement associative lorsque les opérations se produisent dans un ordre différent, et non à un bug logique. Une erreur de cet ordre de grandeur est la signature attendue et inoffensive de ce phénomène ; une erreur de plusieurs ordres de grandeur supérieure serait, elle, un signal d'alarme indiquant que quelque chose est réellement cassé dans l'algorithme réécrit.

## Ce qui arrive ensuite dans cette série

Réordonner trois boucles était le premier levier, et à lui seul il vaut exactement un chiffre honnête : 2,22x. Ce n'est cependant pas la fin de l'histoire — l'étape 2 laisse encore de la performance réelle sur la table, et les prochaines parties de cette série reprennent exactement là où celle-ci s'arrête :

- **Le tiling (découpage en blocs)** — diviser les matrices en petits sous-blocs qui tiennent confortablement dans le cache L1/L2, pour exploiter la localité *temporelle* à plus grande échelle, en plus de la localité spatiale déjà captée par l'étape 2. Cette technique s'accompagne d'une surprise honnête dans les mesures : le tiling naïf, à lui seul, ne bat *pas* l'étape 2 — et comprendre exactement pourquoi est plus instructif que la technique elle-même.
- **Le parallélisme avec OpenMP** — mettre plus d'un cœur CPU au travail, en répartissant le calcul en blocs entre plusieurs threads avec un simple `#pragma`, sans écriture partagée et donc sans condition de concurrence à gérer.
- **La vectorisation manuelle avec AVX2 et FMA** — réécrire à la main la boucle la plus interne avec des instructions vectorielles qui traitent quatre valeurs `double` par instruction au lieu d'une seule, pour les lecteurs dont le CPU le prend en charge (avec un repli automatique et correct pour ceux dont ce n'est pas le cas).
- **La comparaison complète, et deux autres surprises honnêtes** — une comparaison complète et méthodologiquement transparente des cinq étapes, y compris pourquoi une taille de matrice qui se trouve être une puissance de deux peut être nettement *plus lente* qu'une taille voisine qui n'en est pas une, et pourquoi isoler l'effet des indicateurs de compilation agressifs de l'effet des changements algorithmiques compte tout autant que le travail algorithmique lui-même.
- **Tout rassembler dans un benchmark consolidé unique et un dépôt public** — un seul programme qui exécute chaque étape, vérifie automatiquement l'exactitude, et produit le tableau comparatif et le graphique utilisés tout au long de cette série, ainsi qu'un renvoi vers les idées algorithmiques classiques (l'algorithme de Strassen, les algorithmes cache-oblivious) qui prennent le relais là où cette série pratique s'arrête.

Le code de cet article — étape 1, étape 2, et les utilitaires de mesure partagés, ainsi que les étapes encore à venir — se trouve dans le dépôt GitHub associé, prêt à cloner, compiler avec CMake, et exécuter sur votre propre machine. Vos propres chiffres différeront de ceux mesurés ici — CPU différent, nombre de cœurs différent, compilateur différent — et c'est précisément l'intérêt de l'exécuter vous-même plutôt que de prendre ces chiffres pour argent comptant.
