---
title: "QtConcurrent::run, mapped/filtered/reduced, et le QThreadPool en coulisses"
description: "Le multithreading en C++ avec Qt — Module 3"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QtConcurrent::run, mapped/filtered/reduced, et le QThreadPool en coulisses

Dans les trois modules précédents, tu as construit, pièce par pièce, le vocabulaire et les outils avec lesquels Qt gère le multithreading « manuel » : `QThread`, `moveToThread`, les signaux et les slots pour faire communiquer les threads sans corrompre leur état, puis `QMutex`, `QWaitCondition`, `QReadWriteLock` pour protéger et coordonner des données réellement partagées. C'est un parcours délibérément lent, parce que chaque pièce de ce vocabulaire te sert à comprendre *ce qui se passe en dessous* quand les choses se compliquent — un deadlock, un signal qui arrive sur le mauvais thread, un worker qui ne s'arrête jamais.

Aujourd'hui, on change complètement de registre, et on le fait exprès à ce moment précis du cours où tu peux vraiment apprécier la différence. Si ton premier contact avec le multithreading dans Qt s'est fait via `QtConcurrent`, utilisé un peu « au feeling » — copier un exemple, le faire tourner, avancer sans trop savoir pourquoi ça marchait — aujourd'hui on referme cette boucle : tu vas revoir exactement les mêmes outils, mais cette fois en sachant précisément ce que fait `QThreadPool` sous le capot, pourquoi `QFuture` ne bloque pas (sauf si tu le lui demandes explicitement), et à quel moment le confort de `QtConcurrent` cesse d'être le bon choix et laisse la place au pattern manuel des modules précédents.

La question qui guide tout ce module est simple à énoncer et plus subtile à bien appliquer : **le travail que je dois paralléliser est-il une transformation indépendante appliquée à de nombreuses données similaires, ou bien est-ce un état qui vit dans le temps et doit être coordonné ?** Le producteur-consommateur du module précédent relevait clairement de la seconde catégorie — deux threads persistants, un buffer partagé, une coordination fine avec des wait conditions. Aujourd'hui, on travaille dans la première catégorie, celle où `QtConcurrent` a été conçu pour briller : tu as une collection de données (dans ton contexte professionnel, presque toujours des frames ou des images issues d'un système de vision), et tu veux appliquer la même opération à chaque élément, le plus possible en parallèle, sans avoir à écrire un seul `QThread` à la main.

## QtConcurrent::run() : un appel asynchrone, sans cérémonie

Commence par le cas le plus simple possible : tu as une seule fonction qui prend un peu de temps, et tu veux l'exécuter sur un autre thread sans bloquer celui qui l'appelle. Dans le module consacré à `QThread`, cela te coûtait au minimum : une classe worker dérivée de `QObject`, un slot qui fait le travail, un `QThread` dédié, un `moveToThread()`, la connexion `started` → slot, la gestion ordonnée de l'arrêt dans le destructeur. Cinq ou six lignes d'infrastructure, pour exécuter *une* fonction une seule fois.

`QtConcurrent::run()` fait la même chose en une ligne :

```cpp
QFuture<int> future = QtConcurrent::run([]() {
    // time-consuming work, executed on another thread
    QThread::msleep(500);
    return 42;
});
```

Cette ligne fait trois choses à la fois : elle prend la fonction (ici une lambda, mais ce pourrait être un pointeur vers une fonction libre, une méthode membre, ou un foncteur), elle la met en file d'attente sur un thread emprunté à un entrepôt de threads déjà prêts (le `QThreadPool` global — le sujet de la prochaine section), et elle te renvoie immédiatement un `QFuture<int>` : un objet maniable qui représente « le résultat qui va arriver », pas le résultat lui-même. La ligne `QtConcurrent::run(...)` **ne bloque pas** : elle retourne tout de suite, avant même que la lambda ait commencé à s'exécuter, exactement comme `m_thread->start()` n'attendait pas que le travail du worker thread soit terminé.

Le gain est évident : zéro nouvelle classe, zéro gestion manuelle du cycle de vie d'un `QThread`, zéro risque d'oublier `quit()`+`wait()` dans le destructeur. Pour un travail « tire et oublie » — ou « tire et récupère le résultat plus tard » — c'est presque toujours le bon choix.

Ce que tu as perdu est tout aussi important à reconnaître dès maintenant, car c'est le fil conducteur de tout ce module : **tu n'as plus d'objet persistant avec qui parler pendant que le travail avance**. Le Producteur du module précédent vivait sur son propre thread pendant toute la durée du programme, recevait des signaux, en émettait, pouvait être arrêté proprement. Un appel à `QtConcurrent::run()` est, conceptuellement, une fonction pure qui part, tourne, et se termine — pas un objet avec lequel tu interagis en cours de route. Si ton problème a besoin de ce type d'interaction continue (pause, annulation fine, notifications de progression granulaires pendant l'exécution), tu commences déjà à entrevoir pourquoi *tout* ne doit pas passer par `QtConcurrent` — on y reviendra tranquillement dans le prochain article.

## mapped, filtered, reduced : le parallélisme sur les données

`QtConcurrent::run()` exécute *une* fonction une fois. Le cas bien plus fréquent dans ton travail — traiter N images d'une inspection, N frames d'une séquence acquise, N mesures d'un capteur — consiste à appliquer la *même* fonction à *chaque élément* d'une collection, indépendamment. Ce pattern porte un nom précis dans la littérature du calcul parallèle, le **data parallelism** (parallélisme sur les données, par opposition au *task parallelism* où ce sont des opérations différentes qui tournent en parallèle), et c'est exactement le cas que `QtConcurrent::mapped()` couvre.

```cpp
QList<QImage> blurredImages = QtConcurrent::blockingMapped(originalImages, blurImage);
```

![Visual diagram of map, filter and reduce data-parallel operations](modulo-03/15-map-filter-reduce-visual.png)

`mapped()` prend une collection (ici une `QList<QImage>`) et une fonction à un argument (ici `blurImage`, qui prend une `QImage` et en renvoie une nouvelle), et applique cette fonction à *chaque* élément, en répartissant le travail sur les threads disponibles dans le pool. Chaque élément est traité **indépendamment** des autres — aucun état partagé, aucun mutex nécessaire, car par définition du problème, deux traitements ne se touchent jamais. C'est précisément la raison pour laquelle ce pattern se prête si bien au parallélisme : la section critique du module précédent existait parce que plusieurs threads touchaient *la même* donnée ; ici, chaque worker touche un élément différent, donc la section critique n'existe tout simplement pas.

Un détail qui mérite d'être écrit noir sur blanc, car il est facile de le tenir pour acquis dans le mauvais sens : les workers terminent les éléments **dans un ordre quelconque**, selon le temps que prend chacun et selon le thread qui s'en empare — mais la collection de résultats que tu obtiens à la fin **préserve toujours l'ordre d'origine**. `result[i]` correspond toujours à `f(element[i])`, quel que soit le worker qui l'a calculé ou l'ordre dans lequel c'est arrivé. Pour ton travail avec des séquences de frames, c'est une garantie précieuse : la frame numéro 10 dans la liste de résultats est toujours le traitement de la frame numéro 10 de départ, jamais celui d'une autre frame arrivée avant par pur hasard d'ordonnancement.

À côté de `mapped()`, `QtConcurrent` propose deux variantes du même schéma général. **`filtered()`** applique un prédicat (une fonction qui renvoie un `bool`) à chaque élément, et renvoie une nouvelle collection ne contenant que les éléments pour lesquels le prédicat est vrai — calculé en parallèle, l'ordre relatif des éléments survivants étant toujours préservé :

```cpp
QList<QImage> darkImagesOnly = QtConcurrent::blockingFiltered(images, [](const QImage &img) {
    return averageBrightness(img) < DARK_THRESHOLD;
});
```

**`reduced()`** combine tous les résultats d'un `mapped()` en une seule valeur accumulée, via une fonction de combinaison associative — la somme, le maximum, la concaténation, n'importe quelle opération pour laquelle l'ordre dans lequel tu combines les paires ne change pas le résultat final :

```cpp
double totalBrightness = QtConcurrent::blockingMappedReduced(
    images,
    computeBrightness,                       // map: QImage -> double
    [](double &accumulator, double value) { accumulator += value; }  // reduce
);
```

Remarque `mappedReduced` : c'est la fusion du map et du reduce en une seule passe, qui évite de construire et de garder en mémoire toute la collection intermédiaire des résultats mappés avant de les combiner — utile lorsque cette collection intermédiaire serait volumineuse et ne te sert jamais en tant que telle, seulement la valeur finale accumulée.

Il existe aussi une paire de variantes en minuscules, `QtConcurrent::map()` et `QtConcurrent::filter()` (à ne pas confondre avec `mapped`/`filtered`), qui modifient la collection **sur place** au lieu d'en renvoyer une nouvelle — utile quand tu n'as pas besoin de conserver les données d'origine et que tu veux économiser la mémoire d'une copie. Dans le projet pratique de ce module, on utilisera la forme « non mutante » (`mapped`) car on veut conserver à la fois les images d'origine et les images traitées, pour comparaison — mais sache que l'alternative existe, et qu'elle est le bon choix quand la seule chose qui t'intéresse est le résultat final in-place.

Tu auras remarqué que les exemples ci-dessus utilisent `QtConcurrent::blockingMapped()`, et non `QtConcurrent::mapped()`. La différence est exactement ce que le nom suggère : la version `blocking*` exécute le travail en parallèle sur les autres threads mais **attend** (en bloquant le thread appelant) que tout soit terminé avant de renvoyer directement la collection de résultats — pratique pour un script en ligne de commande ou pour du code qui tourne déjà sur un thread secondaire, mais **à éviter sur le thread GUI**, pour exactement la raison que le prochain article va formaliser. La version sans préfixe, `QtConcurrent::mapped()`, renvoie immédiatement un `QFuture<T>` sans rien attendre — et c'est celle qu'on utilisera dans le projet pratique.

## Le QThreadPool global : l'entrepôt de threads en coulisses

Chaque appel à `QtConcurrent::run()`, `mapped()`, `filtered()` ou `reduced()` que tu as vu jusqu'ici ne précise jamais explicitement *sur quels threads* faire tourner le travail. Ce n'est pas de la magie : derrière, il y a un `QThreadPool`, et par défaut c'est le pool global, partagé par toute l'application, accessible via `QThreadPool::globalInstance()`.

![Diagram of the implicit global QThreadPool shared by QtConcurrent operations](modulo-03/13-global-thread-pool.png)

Dans le modèle des modules précédents, chaque job que tu voulais exécuter sur un thread séparé impliquait la création d'un nouveau `QThread` — un objet du système d'exploitation, avec sa propre pile, sa propre identité, un coût de création et de destruction non négligeable. C'est très bien pour un worker qui vit longtemps (ton Producteur ou ton Consommateur, vivants pendant toute la durée du programme), mais cela devient un gaspillage évident si le « job » dure quelques millisecondes et qu'il en arrive des centaines : tu créerais et détruirais des centaines de threads système, en payant à chaque fois le coût plein, pour un travail qui, dans le meilleur des cas, occupe une petite fraction de ce temps.

Le `QThreadPool` résout le problème en maintenant un nombre fixe de threads **déjà créés et prêts**, et en les recyclant : quand tu mets un job en file d'attente (via `QtConcurrent::run()` ou l'un des algorithmes `mapped`/`filtered`/`reduced`), le pool l'assigne au premier thread worker libre ; quand ce thread termine, **il ne meurt pas** — il redevient disponible pour le prochain job en attente. Le coût de création du thread système, tu le paies une seule fois, au démarrage, pas à chaque job.

La taille par défaut du pool est `QThread::idealThreadCount()` — typiquement le nombre de cœurs logiques disponibles sur la machine (sur la machine de développement de ce cours, mesuré avec `qDebug() << QThread::idealThreadCount();`, la valeur est **2** : tu la verras citée plusieurs fois dans le projet pratique, car c'est l'un des nombres qui déterminent le temps réel que prend notre batch d'images). L'idée est que, pour un travail véritablement CPU-bound comme notre flou, avoir plus de threads actifs que de cœurs physiques disponibles n'aide pas — cela n'introduit qu'un surcoût de changement de contexte — donc le pool se dimensionne pour exploiter exactement le parallélisme que le matériel offre, ni plus ni moins.

Tu peux changer cette taille avec `QThreadPool::globalInstance()->setMaxThreadCount(n)`, et tu peux même créer ton propre `QThreadPool` privé (en le passant comme premier argument à `QtConcurrent::run()`/`mapped()`, dans des surcharges dédiées) si tu veux isoler un certain type de travail du reste de l'application — utile, par exemple, si tu as un sous-système à basse priorité qui ne doit jamais entrer en concurrence pour les threads avec le traitement principal. Dans le projet pratique d'aujourd'hui, on utilisera toujours le pool global par défaut : pour une application avec un seul type de travail CPU-bound comme la nôtre, il n'y a aucune raison de compliquer les choses avec plusieurs pools.

À partir d'ici, une règle simple : si ton travail est **découpable en jobs courts et nombreux**, laisse le `QThreadPool` les gérer — c'est littéralement le problème pour lequel il a été conçu. Si en revanche tu as besoin d'**un seul worker qui vit longtemps et conserve un état entre une opération et l'autre** (de nouveau, le Producteur/Consommateur du module précédent), un `QThread` dédié reste le bon outil — tout ne doit pas passer par le pool global.

## Ce qu'il reste à comprendre

Tu sais désormais comment lancer du travail parallèle avec `QtConcurrent::run()` et `mapped()`/`filtered()`/`reduced()`, et ce qui se passe en coulisses dans le `QThreadPool` global. Il reste à comprendre comment obtenir des notifications sur la progression sans jamais bloquer le thread GUI — le rôle de `QFuture` et surtout de `QFutureWatcher` — et exactement dans quels cas revenir plutôt au pattern manuel des modules précédents. C'est le sujet du prochain article.
