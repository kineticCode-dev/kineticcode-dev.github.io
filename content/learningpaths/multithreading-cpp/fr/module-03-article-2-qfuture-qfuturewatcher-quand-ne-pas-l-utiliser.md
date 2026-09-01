---
title: "QFuture, QFutureWatcher et la question que le vibe coding saute toujours"
description: "Le multithreading en C++ avec Qt — Module 3"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QFuture, QFutureWatcher et la question que le vibe coding saute toujours

Dans l'article précédent, tu as vu comment lancer du travail parallèle avec `QtConcurrent::run()` et la famille `mapped`/`filtered`/`reduced()`, et comment le `QThreadPool` global gère les threads en coulisses. Chaque fonction de `QtConcurrent` que tu as vue jusqu'ici (dans sa forme non bloquante) renvoie un `QFuture<T>`. Cela vaut la peine de s'arrêter pour bien comprendre ce que c'est, car c'est un concept différent de tout ce que tu as vu dans les modules précédents.

## QFuture : une poignée sur le résultat, pas le résultat

Un `QFuture<T>` **n'est pas** le résultat — c'est un objet léger et copiable qui représente la *promesse* d'un résultat qui n'est peut-être pas encore prêt. Tu peux l'interroger à tout moment :

```cpp
QFuture<QImage> future = QtConcurrent::mapped(images, blurImage);

future.isRunning();      // is the work still running?
future.isFinished();     // has it finished (successfully or canceled)?
future.isCanceled();     // was it canceled?
future.resultCount();    // how many results are ready right now?
```

Et tu peux, si tu le souhaites, **attendre** qu'il se termine, avec `waitForFinished()` :

```cpp
future.waitForFinished();
QList<QImage> results = future.results();
```

Arrête-toi sur cette ligne, car c'est exactement le type d'erreur que ce cours a commencé à démonter dès le tout premier projet pratique. Tu te souviens de la fenêtre qui se figeait parce qu'un calcul long tournait directement dans le slot d'un bouton, sur le thread de la GUI ? `future.waitForFinished()` appelé sur le thread GUI produit **exactement le même symptôme**, pour exactement la même raison : tu bloques le thread qui devrait rester libre pour traiter les événements (redessins, clics, tout le reste) jusqu'à ce que le travail sur l'autre thread soit terminé.

![Diagram of QFutureWatcher bridging QFuture signals to the GUI thread](modulo-03/14-qfuture-qfuturewatcher-bridge.png)

`waitForFinished()` a sa place légitime : sur un thread qui **n'est pas** celui de la GUI (par exemple à l'intérieur d'un autre job déjà exécuté via `QtConcurrent::run()`, ou dans un script en ligne de commande sans interface), ou bien quand tu sais avec certitude que le travail est déjà terminé ou se terminera dans un temps négligeable. Sur le thread GUI, pour un travail qui dure plus de quelques millisecondes, il ne faut jamais l'utiliser de cette façon directe. La solution — celle que tu utiliseras tout au long du projet pratique de ce module — consiste à **ne jamais attendre**, et à laisser Qt « frapper à la porte » quand le résultat est prêt. L'outil qui fait exactement cela est `QFutureWatcher<T>`.

## QFutureWatcher : le future traduit en signaux Qt

`QFutureWatcher<T>` fait le pont entre le monde des `QFuture` (qui, en soi, n'émet pas de signaux) et le monde des signaux et des slots que tu connais bien. Un `QFutureWatcher` « observe » un `QFuture` via `setFuture()`, et traduit chaque événement interne du future en un signal Qt normal, livré — via une connexion en file d'attente, exactement comme les signaux du worker thread — sur le thread auquel appartient le watcher lui-même (presque toujours le thread GUI, si le watcher y a été créé).

```cpp
QFutureWatcher<QImage> *watcher = new QFutureWatcher<QImage>(this);

connect(watcher, &QFutureWatcher<QImage>::finished, this, [this, watcher]() {
    QList<QImage> results = watcher->future().results();
    // ... use the results, safely, on the GUI thread ...
});

QFuture<QImage> future = QtConcurrent::mapped(images, blurImage);
watcher->setFuture(future);   // the work has ALREADY started: setFuture() just observes it
```

Aucun `QThread`, aucun `moveToThread()`, aucun mutex : le véritable worker tourne dans le `QThreadPool` global, le `QFutureWatcher` vit tranquillement sur le thread GUI, et le lien entre les deux passe entièrement par des signaux que Qt délivre en file d'attente — la même infrastructure de livraison d'événements à laquelle tu as déjà appris à faire confiance.

`QFutureWatcher<T>` expose un ensemble de signaux qui reproduit, un à un, le type de notifications que dans le module sur `QThread` tu devais construire à la main à l'intérieur de ton worker :

- **`started()`** — émis quand le future connecté commence effectivement son exécution.
- **`finished()`** — émis quand tout le travail est terminé, qu'il soit arrivé à son terme naturel ou qu'il ait été annulé. C'est le point où il est sûr d'appeler `watcher->future().results()` pour lire tous les résultats.
- **`canceled()`** — émis (en plus de `finished()`, pas à sa place) quand le future a été explicitement annulé via `watcher->cancel()`.
- **`progressRangeChanged(int minimum, int maximum)`** et **`progressValueChanged(int value)`** — rapportent l'avancement global du travail.
- **`resultReadyAt(int index)`** (et sa variante `resultsReadyAt(int beginIndex, int endIndex)` pour un intervalle) — émis chaque fois qu'un nouveau résultat devient disponible, indiquant **quel** indice de la collection d'origine est prêt.

Il y a un détail que l'article précédent a déjà anticipé pour les résultats finaux, et qu'il vaut la peine de répéter ici pour les *notifications* : `resultReadyAt(index)` te dit quel élément vient de devenir disponible, mais **ne garantit pas que les indices arrivent dans l'ordre croissant** — si deux workers travaillent en parallèle sur des éléments différents, celui qui termine en premier notifie en premier, quel que soit celui des deux qui avait l'indice le plus bas. Ce qui reste toujours vrai, c'est que le `QFuture` sous-jacent conserve malgré tout les résultats à la bonne position — `resultAt(i)` (ou `results()` dans son ensemble) est toujours dans l'ordre d'origine, même si les *notifications* de « prêt » sont arrivées dans un ordre différent.

`watcher->cancel()` (équivalent à `watcher->future().cancel()`) demande l'annulation du travail restant — mais, exactement comme le drapeau coopératif que tu verras formalisé dans le prochain module, **n'interrompt pas en cours de route** un élément dont le calcul a déjà démarré sur un worker : cet élément termine tout de même son étape, on n'en démarre simplement plus de nouveaux après la demande d'annulation. `finished()` se déclenche quand même à la fin (en même temps que `canceled()`), et `watcher->future().resultCount()` te dit combien de résultats ont effectivement été collectés avant l'interruption.

## QPromise : quand tu veux produire toi-même le future

Tout ce que tu as vu jusqu'ici part d'un `QFuture` que `QtConcurrent` construit pour toi. Il existe un cas, plus avancé et moins fréquent dans le travail quotidien, où tu veux la relation inverse : écrire toi-même une fonction asynchrone personnalisée qui se comporte comme celles de `QtConcurrent` — renvoie un `QFuture`, supporte l'annulation et la progression — sans passer par `mapped`/`filtered`/`reduced`. L'outil, introduit dans Qt 6, est `QPromise<T>`.

```cpp
QFuture<int> processWithProgress(const QList<int> &data) {
    return QtConcurrent::run([data](QPromise<int> &promise) {
        promise.setProgressRange(0, data.size());
        int accumulator = 0;

        for (int i = 0; i < data.size(); ++i) {
            if (promise.isCanceled()) break;   // cooperative cancellation, as always

            accumulator += processSingleItem(data[i]);
            promise.setProgressValue(i + 1);
        }

        promise.addResult(accumulator);
    });
}
```

`QtConcurrent::run()` reconnaît que la lambda accepte un `QPromise<int>&` comme premier paramètre, et te passe un objet déjà relié au `QFuture<int>` que la fonction renvoie : à l'intérieur de la lambda, tu contrôles toi-même la progression (`setProgressValue`), l'annulation coopérative (`isCanceled()`, vérifiée à chaque itération — le même pattern que le `while` vu pour les wait conditions, appliqué ici à une boucle), et le résultat final (`addResult`). De l'extérieur, celui qui appelle `processWithProgress()` reçoit un `QFuture<int>` totalement indiscernable de celui d'un `QtConcurrent::mapped()` — il peut y connecter un `QFutureWatcher` exactement comme tu viens de l'apprendre.

On n'utilisera pas `QPromise` dans le projet pratique d'aujourd'hui — notre cas d'usage (flou d'images) s'inscrit parfaitement dans le pattern `mapped()` déjà prêt — mais c'est un outil qu'il vaut la peine de connaître de nom : le jour où tu devras envelopper une bibliothèque tierce bloquante (un SDK de caméra, par exemple, avec son API synchrone) dans quelque chose qui s'intègre proprement dans l'écosystème `QFuture`/`QFutureWatcher`, `QPromise` est la bonne voie.

## Les exceptions à travers QFuture

Une dernière chose à savoir avant le projet pratique, car il est facile de l'oublier et de la découvrir de la pire manière en production : que se passe-t-il si la fonction que tu passes à `QtConcurrent::run()` ou `mapped()` lève une exception C++ ? Elle ne disparaît pas silencieusement, et elle ne fait pas planter immédiatement le programme depuis un thread arbitraire du pool — Qt la **capture** sur le thread worker et la **relance** quand quelqu'un interroge le future pour le résultat :

```cpp
QFuture<int> future = QtConcurrent::run([]() -> int {
    if (errorCondition()) throw std::runtime_error("invalid data");
    return 42;
});

try {
    int value = future.result();   // or after waitForFinished()
} catch (const std::exception &e) {
    qWarning() << "Exception from worker:" << e.what();
}
```

L'exception est relancée au point où tu **lis** le résultat (`result()`, `results()`, ou l'accès correspondant après `waitForFinished()`) — pas au point où elle a été levée à l'origine. Si en revanche tu utilises le pattern `QFutureWatcher` (celui du projet pratique d'aujourd'hui), l'endroit naturel pour le `try`/`catch` est à l'intérieur du slot connecté à `finished()`, juste au moment où tu accèdes aux résultats.

## QtConcurrent ou QThread manuel ? La question que le vibe coding saute

On arrive au point qui referme vraiment la boucle avec laquelle tu as commencé ce module. `QtConcurrent` est pratique — assez pratique pour être, historiquement, le premier outil de multithreading Qt que beaucoup de développeurs rencontrent, souvent sans trop savoir ce qu'ils choisissent de *ne pas* utiliser en le faisant.

![Comparison diagram of QtConcurrent versus manual QThread usage](modulo-03/16-qtconcurrent-vs-manual-qthread.png)

La bonne question à te poser, chaque fois, avant d'écrire une ligne de code concurrent en Qt, est **« mon travail est-il une transformation sans état sur une collection de données ? »**

Si la réponse est oui — tu as N éléments, tu appliques la même opération à chacun, chaque traitement est indépendant des autres, tu n'as pas besoin de coordination fine pendant l'exécution, et quand tout est fini il te suffit d'avoir les résultats — alors `QtConcurrent::mapped`/`filtered`/`reduced` (ou `run()` pour un seul job) est presque toujours le bon choix. Tu obtiens du parallélisme réel, une gestion du pool de threads gratuite, aucun mutex à écrire, aucun cycle de vie de `QThread` à gérer à la main. C'est exactement le projet pratique d'aujourd'hui.

Si en revanche ton travail présente l'une quelconque de ces caractéristiques, `QtConcurrent` devient le mauvais outil — non pas parce qu'il « ne fonctionne pas », mais parce qu'il t'oblige à forcer dans une boîte sans état quelque chose qui est stateful par nature :

Un **worker qui vit longtemps et conserve un état entre une opération et l'autre** — le Producteur et le Consommateur du module précédent n'étaient pas des « transformations sur une collection » : c'étaient des objets ayant leur propre vie, qui continuaient à travailler jusqu'à ce que le programme les arrête. Un **producteur-consommateur, une pipeline à plusieurs étages** — quand le résultat d'une étape alimente en continu l'étage suivant, et que la coordination entre les deux (plein/vide, backpressure) est le cœur du problème, pas un détail. Le **besoin de pause, d'arrêt, d'annulation fine pendant l'exécution** (pas seulement « annule tout ce qui reste », comme le `cancel()` coopératif de `QFutureWatcher`, mais « suspends maintenant, reprends plus tard, avec un contrôle précis de l'endroit où tu en es ») — c'est exactement le sujet du prochain module. Et la **coordination via mutex/wait condition entre threads qui doivent vraiment se parler pendant le travail**, pas seulement s'échanger un résultat final.

Dans tous ces cas, le pattern `QThread` + objet worker + `moveToThread()` + signaux/slots (avec, si besoin, `QMutex`/`QWaitCondition` pour l'état partagé) que tu as construit dans les modules précédents reste le bon outil — pas un pis-aller « moins moderne ». `QtConcurrent` ne remplace pas ce pattern : il t'en *dispense* dans les cas où il serait inutilement lourd, c'est-à-dire exactement le cas de la transformation de données que tu vois aujourd'hui.

Garder cette distinction bien en tête — et savoir la reconnaître en trente secondes en regardant un nouveau problème, au lieu de partir « au feeling » vers l'outil que tu connais le mieux — c'est précisément la compétence que ce module voulait te donner.

## De la théorie aux mains sur le clavier

Tu as maintenant tout le vocabulaire pour utiliser `QtConcurrent` en connaissance de cause : `QFuture` comme poignée non bloquante, `QFutureWatcher` pour les notifications sûres sur le thread GUI, `QPromise` pour les cas avancés, la gestion des exceptions, et — surtout — le critère pour décider quand cet outil est le bon et quand il ne l'est pas. Dans le prochain article, on met tout cela en pratique avec un batch de traitement d'images réel, avec une leçon de mesure qui vaut à elle seule tout l'article.
