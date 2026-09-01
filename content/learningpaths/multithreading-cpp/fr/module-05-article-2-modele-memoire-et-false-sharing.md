---
title: "std::atomic, le modèle de mémoire C++, et le bug de performance invisible dans le code"
description: "Le multithreading en C++ avec Qt — Module 5"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# std::atomic, le modèle de mémoire C++, et le bug de performance invisible dans le code

Cet article aborde le cœur physique du module : `std::atomic` et le **modèle de mémoire C++**. C'est un sujet que la plupart des tutoriels en ligne expliquent mal, en énumérant `memory_order_relaxed`, `acquire`, `release`, `seq_cst` comme s'il s'agissait d'options de configuration arbitraires à choisir au feeling. Ici, nous les expliquons en partant de ce qui se passe *physiquement* à l'intérieur d'un processeur multi-cœur — cache L1 par cœur, lignes de cache, le protocole qui les maintient cohérentes — parce que c'est la seule façon pour que ces concepts cessent d'être des règles à mémoriser et deviennent des conséquences évidentes de la façon dont est fait le matériel sur lequel tu tournes.

De là, on arrive à une conséquence directe, et peut-être la leçon la plus surprenante du module : deux variables `atomic` totalement indépendantes du point de vue logique — aucun thread ne les utilise jamais ensemble, aucun invariant ne les lie — peuvent quand même se ralentir mutuellement de façon spectaculaire, simplement parce qu'elles sont proches en mémoire. C'est le **false sharing** (partage faux, ou partage fantôme de ligne de cache).

## Deux questions distinctes que le code concurrent pose toujours ensemble

Quand deux threads partagent une variable, il y a en réalité deux problèmes distincts, et la confusion entre les deux est la source de 80 % des incompréhensions sur le modèle de mémoire :

**Atomicité** : l'opération (une écriture, un incrément, une comparaison-et-échange) se produit intégralement, sans qu'aucun autre thread ne puisse jamais l'observer « à moitié faite ». `compteur++` sur un `int` normal, comme tu l'as vu dans le Module 0, *n'est pas* atomique : c'est en réalité trois étapes séparées (lire, incrémenter, écrire), et deux threads peuvent s'entrelacer entre ces trois étapes, perdant une mise à jour.

**Ordonnancement et visibilité** : même si une opération est atomique, la question reste ouverte de savoir « *quand*, exactement, l'effet de cette écriture devient-il visible aux autres threads, et par rapport à quelles autres opérations du programme est-il garanti qu'elle se produit avant ou après ? ». C'est une question complètement différente de l'atomicité, et `std::atomic<T>` résout les deux — mais avec des leviers de contrôle séparés, et c'est là qu'intervient `std::memory_order`.

## Pourquoi le problème de visibilité existe physiquement : cache L1 par cœur

![The C++ memory model: per-core L1 caches and the coherence problem](modulo-05/22-cpp-memory-model.png)

Un processeur moderne multi-cœur ne lit et n'écrit pas directement la mémoire principale (la RAM) à chaque instruction : ce serait beaucoup trop lent, de plusieurs ordres de grandeur, par rapport à la vitesse à laquelle le CPU exécute des instructions. Chaque cœur possède son propre **cache L1**, petit (typiquement 32-64 Ko) mais très rapide (quelques cycles d'horloge contre les centaines nécessaires pour atteindre la RAM), dans lequel il conserve des copies locales des données qu'il utilise.

Le problème est immédiat et physique, ce n'est pas un détail d'implémentation qu'on peut ignorer : si le Thread A, exécuté sur le Cœur 1, écrit `x = 1`, cette écriture met d'abord à jour le cache L1 du Cœur 1 — **pas** la RAM partagée, pas immédiatement, et pas forcément selon un ordre que tu contrôles directement en écrivant `x = 1` en C++. Si au même instant le Thread B, sur le Cœur 2, lit `x` depuis son propre cache L1, il peut très bien lire encore `0` — la copie ancienne, parce que son cache n'a aucune raison automatique de savoir que le Cœur 1 vient de changer d'avis, tant qu'un mécanisme explicite ne le lui communique pas. Ce n'est pas un bug du processeur : c'est le prix physique, délibérément accepté par les concepteurs de matériel, pour avoir des caches locaux rapides plutôt qu'un accès partagé lent à tout.

Les processeurs modernes résolvent cela avec un **protocole de cohérence de cache** (le plus répandu s'appelle MESI, d'après les initiales des quatre états qu'une ligne de cache peut prendre — Modified, Exclusive, Shared, Invalid) qui maintient les caches des différents cœurs alignés entre eux *quand c'est nécessaire*. Mais « quand c'est nécessaire » est précisément ce que toi, en tant que programmeur, dois spécifier — et tu le spécifies en choisissant le `memory_order` de tes opérations atomiques. Sans cette spécification explicite, le compilateur et le CPU ont tous deux la liberté de réordonner les opérations de lecture et d'écriture d'une manière qui, sur du code mono-thread, ne changerait jamais le résultat observable (c'est la même liberté que tu as vue utilisée par le compilateur dans le Module 0 pour garder une variable non protégée dans un registre, masquant la course critique) — mais qui, sur du code multi-thread, peut produire des résultats que ton ordre d'écriture dans le code source n'avait absolument pas prévus.

## Ce que garantit std::atomic sur l'atomicité : comment ça marche au niveau matériel

Sur un CPU x86-64 — la famille de processeurs la plus courante sur les postes de travail et les serveurs, quasi certainement celle sur laquelle tu compileras et exécuteras le projet guidé — une opération comme `fetch_add` sur un `std::atomic<int>` se traduit typiquement en une seule instruction machine avec le préfixe `LOCK` (par exemple `LOCK XADD`), qui indique au bus mémoire et au protocole de cohérence de cache : « cette opération de lecture-modification-écriture doit se produire comme un seul bloc indivisible, aucun autre cœur ne peut s'y insérer ». Sur des architectures différentes (ARM, très courante dans les systèmes embarqués), le mécanisme change de forme — typiquement une paire d'instructions load-linked/store-conditional (LL/SC) qui détecte si quelqu'un d'autre a touché le même emplacement entre-temps et, si oui, retente — mais la garantie finale offerte par la norme C++ est identique : `fetch_add`, `compare_exchange`, et les autres opérations de lecture-modification-écriture de `std::atomic` sont indivisibles, quel que soit le matériel en dessous.

## memory_order_relaxed : seulement l'atomicité, zéro garantie d'ordre

```cpp
atomicCounter.fetch_add(1, std::memory_order_relaxed);
```

`relaxed` te donne la première garantie (l'opération est indivisible — aucune mise à jour n'est jamais perdue) et **rien d'autre**. Il ne promet rien sur le moment où cet incrément deviendra visible pour d'autres threads, ni sur la manière dont il se situe dans le temps par rapport à d'autres lectures ou écritures, atomiques ou non, que le même thread a faites avant ou après. C'est le bon choix quand la seule chose qui t'intéresse est un décompte numérique correct — un compteur de statistiques, un compteur d'événements — et qu'aucune autre partie du programme ne doit rien déduire du *moment* où cet incrément s'est produit par rapport au reste.

## acquire/release : le pont « happens-before » entre deux threads

```cpp
// Thread A: prepares the data, then publishes it
data.x = 42;
data.y = "result";
// "release": publish everything that precedes
readyFlag.store(true, std::memory_order_release);

// Thread B: waits, then consumes
// "acquire": makes everything before the release visible
while (!readyFlag.load(std::memory_order_acquire)) { }
// guaranteed to see the values written above, not stale ones
readData(data.x, data.y);
```

Le mécanisme est ce que la littérature appelle la relation **happens-before** : une `store` avec `memory_order_release` fonctionne comme une barrière qui dit « toutes les écritures en mémoire faites par ce thread *avant* cette instruction doivent être visibles pour quiconque, sur un autre thread, observe *cette même valeur* via une `load` avec `memory_order_acquire` ». C'est littéralement l'analogie du cadenas que suggère le nom : `release` revient à fermer un cadenas et le laisser là où quelqu'un d'autre peut le trouver, `acquire` revient à le ramasser et l'ouvrir — et au moment où tu l'ouvres, tout ce qui était « dans la pièce » avant que le premier ne l'ait fermé t'est garanti visible.

## memory_order_seq_cst : le choix par défaut, et pourquoi

`seq_cst` (sequentially consistent, séquentiellement cohérent) donne toutes les garanties d'`acquire`/`release` **plus** une garantie supplémentaire, plus forte : toutes les opérations `seq_cst` de tous les threads du programme apparaissent se produire selon un ordre total unique, exactement le même ordre vu par chaque thread qui les observe. C'est le modèle de raisonnement le plus proche de « le programme exécute les instructions une à une, en alternant entre les threads dans un certain ordre » — l'intuition naïve que tu avais probablement en tête depuis le début, ici transformée en garantie réelle. Le prix est un surcoût de synchronisation matérielle presque toujours faible sur les CPU x86-64 modernes, mais non nul.

La recommandation pratique : **utilise `seq_cst` (le défaut) sauf si tu as une raison mesurée et spécifique de descendre vers un ordonnancement plus faible**. `relaxed` et `acquire`/`release` sont des outils réels, utilisés dans le code des moteurs de jeu, des bases de données, des systèmes d'exploitation — mais ils exigent un raisonnement formel et discipliné à chaque utilisation individuelle. `seq_cst` n'est pas « la version paresseuse » : c'est la version où ton raisonnement mental correspond vraiment à une garantie du langage.

## Le paradoxe apparent du false sharing

Voici un fait qui, la première fois qu'on le voit mesuré, semble briser l'intuition : deux variables `std::atomic<int>`, utilisées par deux threads différents, sans qu'aucun des deux ne touche jamais la variable de l'autre, peuvent se ralentir mutuellement de façon spectaculaire. Aucune course critique, aucune violation de correction, aucun `memory_order` erroné : le programme calcule le bon résultat dans les deux cas. Le problème est purement une question de performance, et il tient entièrement dans la physique qu'on vient de voir, appliquée à un détail qui semble sans importance : où exactement, en mémoire, vivent les deux variables l'une par rapport à l'autre.

Les caches ne déplacent pas les données un octet à la fois, ni une variable à la fois. Elles se déplacent par blocs de taille fixe appelés **lignes de cache** (cache line), typiquement de 64 octets sur les CPU x86-64 modernes — une valeur physique du matériel, pas un choix du compilateur. Quand un cœur lit ne serait-ce qu'un seul octet à une adresse, le matériel charge en cache toute la ligne de 64 octets qui le contient — et le protocole de cohérence de cache travaille lui aussi au niveau de la ligne entière, pas de la variable individuelle.

Deux `std::atomic<int>` de 4 octets chacune, déclarées l'une à la suite de l'autre dans une struct, occupent une infime fraction des 64 octets d'une ligne, donc le compilateur, sans instruction contraire, les place proches l'une de l'autre en mémoire — et il est tout à fait plausible qu'elles finissent dans la même ligne de cache. Maintenant le Thread A exécute `a.fetch_add(1)` : pour l'exécuter, son cœur doit avoir un accès exclusif à la ligne de cache contenant `a`, selon le protocole MESI. Et cette ligne contient aussi `b`. Résultat : l'écriture de A sur sa propre variable invalide silencieusement la copie de la ligne que le cœur de B gardait en cache — même si B n'a jamais lu ni écrit `a`. C'est une **contention fantôme**, générée non pas par un accès réel à la même donnée, mais par le partage physique accidentel de la ligne de cache qui les contient toutes les deux.

## Le remède : alignas(64)

```cpp
struct alignas(64) PaddedCounter {
    std::atomic<int> value{0};
    // fills the rest of the line, deliberately unused
    char padding[64 - sizeof(std::atomic<int>)];
};
```

`alignas(64)` dit au compilateur : « chaque instance de cette struct doit commencer à une adresse mémoire multiple de 64 » — c'est-à-dire au début d'une ligne de cache. Le champ `padding`, un tableau d'octets qui ne sera jamais lu ni écrit par personne, existe dans le seul but d'occuper l'espace restant de la ligne, empêchant le compilateur d'y placer autre chose juste à côté.

![False sharing: two independent atomics sharing one 64-byte cache line, and the alignas(64) fix](modulo-05/23-false-sharing-cache-line.png)

C'est un compromis explicite et il faut le reconnaître comme tel : tu *gaspilles* de la mémoire (60 octets inutilisés pour chaque `int` de 4 octets que tu veux protéger) pour *gagner* en vitesse en évitant l'invalidation croisée. Pour deux compteurs, c'est un coût dérisoire ; si tu étais en train de padder des milliers de petites structures dans un immense tableau, ce compromis mériterait d'être pesé avec plus d'attention.

## Lock-free contre mutex : quand ça vaut le coup, quand non

Avec la physique du cache maintenant derrière toi, tu es équipé pour répondre à une question que le Module 2 avait laissée ouverte : si `std::atomic` peut être plus rapide qu'un mutex pour une opération simple — et le projet guidé du prochain article te le démontrera avec de vrais chiffres — pourquoi ne pas remplacer *systématiquement* les mutex par des atomiques ?

Un `std::atomic<T>` te garantit l'atomicité d'une seule opération sur une seule variable. Dès que ton problème exige de mettre à jour **plusieurs variables corrélées comme s'il s'agissait d'une seule opération indivisible** — l'invariant classique du Module 2, où par exemple insérer dans une file signifie à la fois ajouter l'élément et mettre à jour le compte d'éléments — un atomique seul ne suffit plus. Tu pourrais construire un algorithme lock-free qui gère ce cas, typiquement basé sur `compare_exchange` dans des boucles de retry avec des techniques non triviales pour éviter l'*ABA problem* — mais c'est un code notoirement difficile à écrire correctement, difficile à relire, et difficile à tester, parce que les bugs qu'il introduit sont souvent extrêmement rares et dépendants du timing exact entre les cœurs. Pour l'immense majorité du code applicatif réel, un `QMutex` qui protège l'invariant multi-variable dans son ensemble reste le choix le plus correct, le plus lisible et le plus facile à maintenir.

C'est une simplification bien trop répandue, et il faut la corriger explicitement : un algorithme lock-free n'est pas automatiquement plus rapide qu'un algorithme basé sur mutex. Sous faible contention, un mutex moderne sous Linux (basé sur futex, qui dans le cas courant évite complètement un appel système) et un atomique se comportent de façon très similaire en termes de coût. Sous forte contention, une opération atomique unique tend à rester moins chère qu'un verrouillage/déverrouillage complet, parce qu'elle évite l'implication de l'ordonnanceur quand le thread perd la « course » : il retente simplement, au lieu d'être mis en pause puis réveillé plus tard. Mais si l'opération protégée est complexe, un algorithme lock-free équivalent devient rapidement plus coûteux à concevoir, plus coûteux à exécuter et beaucoup plus risqué à certifier correct qu'un mutex bien placé.

![Mutex vs lock-free atomics: two tools with different cost and risk profiles, not a ranking](modulo-05/24-lockfree-vs-mutex-tradeoff.png)

La règle pratique à retenir : pars toujours de `QMutex` (ou `std::mutex`) comme choix par défaut pour tout état partagé complexe ou multi-variable. Envisage `std::atomic` uniquement pour un cas précis et restreint — un compteur, un drapeau booléen, un pointeur partagé dans un motif bien connu — et seulement après avoir **mesuré** que cette section est vraiment un goulot d'étranglement sous contention réelle, pas par intuition.

Le modèle de mémoire, le false sharing et la comparaison lock-free/mutex étant maintenant clairs, le prochain article met tout cela à l'épreuve avec un projet guidé : deux benchmarks réels qui mesurent ces effets avec un vrai chronomètre, et ThreadSanitizer pour vérifier qu'aucune des deux versions ne cache une course critique.
