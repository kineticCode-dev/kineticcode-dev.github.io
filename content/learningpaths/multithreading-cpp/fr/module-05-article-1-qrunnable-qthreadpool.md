---
title: "QRunnable et QThreadPool : un pool de tâches, pas un thread par tâche"
description: "Le multithreading en C++ avec Qt — Module 5"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QRunnable et QThreadPool : un pool de tâches, pas un thread par tâche

Dans le Module 2, tu as appris à protéger de la mémoire partagée avec `QMutex` et à coordonner des threads avec `QWaitCondition`. Tout ce module reposait sur une idée de fond qu'il vaut la peine de rendre explicite maintenant : un mutex est un outil *généraliste*, qui protège n'importe quoi que tu mettes derrière lui, au prix d'un mécanisme qui, chaque fois qu'il est acquis, peut potentiellement impliquer l'ordonnanceur du système d'exploitation — et remettre en exécution un thread mis en attente a un coût réel, non négligeable, comme tu l'as vu dans le Module 0 en parlant de changement de contexte.

Ce module part d'une question inconfortable mais honnête : ce coût est-il toujours nécessaire ? La réponse, comme souvent en ingénierie, est « ça dépend » — et ce premier article aborde le niveau le plus organisationnel du problème, avant de descendre, dans le suivant, au niveau physique du cache et du modèle de mémoire.

## Le problème que le QThread persistant ne résout pas bien

Repense au motif utilisé dans les Modules 1, 2 et 4 : un `QThread` créé, un worker déplacé dessus avec `moveToThread()`, un cycle de vie géré avec soin (`start()`, `quit()`, `wait()`). C'est le bon motif quand le travail est *continu* — un producteur qui tourne pendant toute la vie du programme, un worker qui traite un flux constant d'images vidéo. Mais que se passe-t-il si ton problème est différent : tu as cent images à traiter *une seule fois*, en parallèle, et ensuite ce travail se termine ? Créer cent `QThread`, un par image, serait absurde — la création d'un thread système a un coût non négligeable (allocation de la pile, enregistrement auprès de l'ordonnanceur, typiquement plusieurs dizaines de microsecondes même sur un système moderne), et cent threads qui vivent chacun quelques millisecondes passeraient une fraction énorme de leur temps total simplement à naître et mourir, pas à travailler.

La solution classique, aussi vieille que la programmation concurrente elle-même, est le **pool de threads** (thread pool) : un nombre fixe de threads worker, créés une seule fois au démarrage, qui restent vivants et se mettent en file pour « tirer » (pull) la prochaine tâche disponible depuis une file partagée, au lieu d'être recréés à chaque fois.

![QRunnable + QThreadPool: queued tasks consumed by a fixed set of worker threads](modulo-05/21-qrunnable-qthreadpool.png)

## QRunnable : la tâche, pas le thread

En Qt, une unité de travail soumise à un pool s'écrit en sous-classant `QRunnable` et en surchargeant une seule méthode, `run()` :

```cpp
class ImageProcessingTask : public QRunnable {
public:
    explicit ImageProcessingTask(int imageId) : m_imageId(imageId) {}

    void run() override {
        // the actual work, executed on one of the pool's threads
        processImage(m_imageId);
    }

private:
    int m_imageId;
};
```

Remarque la différence conceptuelle par rapport à un worker `QObject` déplacé avec `moveToThread()` : un `QRunnable` **n'est pas** un `QObject`, il n'a pas de signaux propres, il n'a pas d'affinité de thread au sens où tu l'as connue dans le Module 1. C'est délibérément un outil plus pauvre et plus léger : il représente *le travail à faire*, pas *qui le fait*. Le « qui » est décidé à la volée par le pool, selon quel thread worker se libère le premier — et ce ne sera pas forcément toujours le même thread d'une exécution à l'autre, une question qui, avec un `QThread` persistant, n'aurait même pas de sens à poser.

## Soumettre la tâche : QThreadPool

```cpp
// Qt's shared global pool
QThreadPool *pool = QThreadPool::globalInstance();
pool->start(new ImageProcessingTask(imageId));
```

`QThreadPool::globalInstance()` renvoie un pool partagé par toute l'application, dimensionné par défaut sur le nombre de cœurs logiques de la machine (`QThread::idealThreadCount()`) — la même métrique physique que `std::thread::hardware_concurrency()`, que tu retrouveras dans le projet guidé du prochain article. Tu peux aussi construire ton propre `QThreadPool`, indépendant, si tu veux isoler un certain type de travail du reste (par exemple pour éviter que le traitement d'images en arrière-plan n'entre en concurrence avec des tâches plus urgentes qui passent par le pool global) :

```cpp
QThreadPool dedicatedPool;
dedicatedPool.setMaxThreadCount(4);
dedicatedPool.start(new ImageProcessingTask(imageId));
```

## Qui détruit le QRunnable ? setAutoDelete

Voici un détail de gestion de mémoire qui, si tu l'ignores, produit soit une fuite, soit un crash par double `delete`. Par défaut, `QRunnable::autoDelete()` vaut `true` : une fois `run()` terminée, le pool détruit lui-même l'objet avec `delete`. C'est pour cela que dans l'exemple ci-dessus on écrit `new ImageProcessingTask(...)` sans plus s'en soucier — le pool s'en charge. Si en revanche tu as besoin de réutiliser le même `QRunnable` plusieurs fois, ou de le garder vivant après l'exécution pour en lire un résultat, tu dois désactiver ce comportement explicitement **avant** de le soumettre :

```cpp
ImageProcessingTask *task = new ImageProcessingTask(imageId);
task->setAutoDelete(false);
pool->start(task);
pool->waitForDone();      // wait for all submitted tasks to finish
delete task;              // the responsibility is yours again now
```

`waitForDone()` bloque l'appelant jusqu'à ce que le pool ait épuisé toutes les tâches en file — utile dans un contexte batch où l'on a besoin d'un point de synchronisation net, beaucoup moins utile dans un contexte réactif où l'on veut que l'interface graphique reste vivante (dans ce cas, comme dans le Module 3 avec `QFutureWatcher`, tu préféreras un mécanisme à notification plutôt qu'une attente bloquante).

## Le lien avec QtConcurrent, enfin rendu explicite

Dans le Module 3, tu as utilisé `QtConcurrent::run()` et `QtConcurrent::mapped()` sans jamais voir de `QRunnable` ni de `QThreadPool` — et c'est exactement ça, le point : **tu ne les voyais pas parce que Qt les crée pour toi, en coulisses**. Chaque appel à `QtConcurrent::run(fonction)` emballe en interne `fonction` dans un `QRunnable` généré automatiquement et le soumet à `QThreadPool::globalInstance()` — exactement le même pool que tu viens d'apprendre à utiliser à la main dans cet article. `QtConcurrent::mapped()` fait la même chose, multipliée pour chaque élément de la séquence à traiter, avec en plus la logistique nécessaire pour rassembler les résultats partiels dans un `QFuture`. Ce n'est pas une implémentation similaire, c'est **le même moteur** : quand tu écris `pool->start(new ImageProcessingTask(...))`, tu fais à la main, explicitement, exactement ce que `QtConcurrent::run()` fait pour toi implicitement.

Savoir cela te dit aussi quand il vaut la peine de descendre au niveau de `QRunnable` direct plutôt que de rester sur `QtConcurrent` : quand tu as besoin de priorités différentes entre tâches (`QThreadPool::start()` accepte un paramètre de priorité optionnel), ou d'un pool dédié séparé du pool global, ou d'un contrôle plus fin sur le cycle de vie de chaque tâche — autant de choses que l'interface plus pratique mais plus opaque de `QtConcurrent` n'expose pas.

Avec `QRunnable` et `QThreadPool` désormais bien cadrés, et leur lien avec `QtConcurrent` enfin explicite, le prochain article descend un niveau plus bas : ce que `std::atomic` garantit réellement, expliqué non pas comme une liste de mots-clés à mémoriser, mais en partant de ce qui se passe physiquement à l'intérieur d'un processeur multi-cœur.
