---
title: "Capstone : pool de traitement persistant et annulation coopérative complète"
description: "Multithreading en C++ avec Qt — Module 6 (Capstone)"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone : pool de traitement persistant et annulation coopérative complète

Dans l'article précédent, tu as vu les deux premiers étages du pipeline capstone : un worker de capture persistant (Module 1) qui produit des frames dans un buffer limité (Module 2), avec la contropression comme choix délibéré. Cet article aborde les étages 3 et 4 : comment traiter ces frames en parallèle, et — la partie la plus difficile de tout le cours — comment arrêter correctement un pipeline dans lequel plusieurs étages concurrents peuvent être endormis à des endroits différents au même instant.

## Étage 3 : traitement parallèle, et pourquoi QThreadPool bat QtConcurrent ici

**Objectif.** Appliquer à chaque frame un filtre réel, gourmand en CPU — dans le Projet H, un détecteur de contours de type Sobel — en répartissant le travail sur plusieurs threads, de sorte que le temps total de traitement s'adapte au nombre de cœurs disponibles.

### La décision de conception qui compte : pool persistant contre lot fini

Le Module 3 t'a enseigné `QtConcurrent::mapped` : tu donnes une collection, tu donnes une fonction, tu obtiens un `QFuture` qui te livre les résultats avec une progression observable via `QFutureWatcher`. C'est l'outil adapté chaque fois que ton problème a la forme « j'ai *N* éléments, tous déjà disponibles, et je veux tous les traiter ». Le Projet H, cependant, **n'a pas cette forme** : les frames arrivent une par une, à un rythme que tu ne connais pas à l'avance, pendant une durée qui pourrait ne pas avoir de terme fixe (une véritable caméra ne te dit jamais à l'avance « je suis la dernière frame »). `QtConcurrent::mapped` a besoin de connaître la collection complète avant de démarrer — il n'est pas pensé pour un flux continu qui grandit pendant qu'on le consomme.

La solution adoptée est un pool de **tâches persistantes** : pas un `QRunnable` par frame (ce qui paierait le coût de créer et de planifier un nouvel objet pour chaque frame, un surcoût qui, avec des frames arrivant toutes les 90 millisecondes, compte réellement), mais un nombre fixe de `FrameWorkerTask` — typiquement 2, configurable par l'utilisateur dans l'interface — dont chacune reste en exécution **pendant toute la durée du pipeline**, prélevant des frames dans le buffer l'une après l'autre dans sa propre boucle interne :

```cpp
void FrameWorkerTask::run() {
    QImage frame;
    int frameNumber = -1;

    while (m_buffer->consume(frame, frameNumber)) {
        // ... process, measure, emit signals ...
        if (m_flag->requested()) break;
    }
}
```

Chaque `FrameWorkerTask` hérite à la fois de `QObject` (pour pouvoir émettre des signaux vers l'interface) et de `QRunnable` (pour être planifiable par `QThreadPool::start()`) — un double héritage que le Module 5 ne t'avait pas encore donné l'occasion d'utiliser, car tes `QRunnable` y étaient purement calculatoires, sans besoin de communiquer de résultats via des signaux.

**Piège — la taille du pool doit être fixée *avant* de démarrer les tâches, pas après.** `QThreadPool::setMaxThreadCount(N)` doit être appelé avant `start()`, et avec des tâches persistantes, la séquence inversée n'est pas seulement sous-optimale, c'est potentiellement un blocage silencieux : si tu démarres `N` tâches mais que le pool a de la place pour moins de `N` threads simultanés, les tâches excédentaires restent en file interne au pool, en attendant qu'une des tâches déjà en cours se termine — ce qui, pour une tâche qui boucle jusqu'à ce que le buffer se ferme, n'arrive pas avant la fin du pipeline. Le résultat est un pool qui semble « démarré » mais dans lequel seule une partie des workers consomme réellement le buffer, avec un débit réduit et aucun message d'erreur pour le signaler.

**Quand choisir l'un ou l'autre, dans ton travail réel.** Si ton problème est « j'ai un lot de 200 images déjà sur disque, traite-les toutes et dis-moi quand tu as fini », `QtConcurrent::mapped` avec un `QFutureWatcher` reste le choix le plus simple et le plus lisible — ne le réinvente pas avec un pool persistant simplement parce que tu l'as vu ici. Si ton problème est « un flux continu de données arrivant, de durée inconnue, qui doit être traité avec un délai minimal pendant qu'il continue d'arriver », le pattern du Projet H — pool persistant prélevant dans un buffer partagé — est la forme naturelle du problème.

## Étage 4 : annulation coopérative complète — la partie la plus difficile du cours

S'il y a un seul passage de ce module dont il vaut la peine de relire chaque phrase deux fois, c'est celui-ci. Arrêter correctement **un** worker, comme au Module 4, demande de la discipline mais reste conceptuellement simple : un drapeau, une boucle qui le vérifie, un `quit()` + `wait()` final. Arrêter **un pipeline à trois étages concurrents qui se transmettent des données via un buffer bloquant** est un problème qualitativement différent, car il existe désormais plusieurs façons dont un thread peut être « occupé » au moment précis où arrive la demande d'arrêt, et chacune exige que quelqu'un d'autre le réveille physiquement — un drapeau seul ne suffit plus.

### L'erreur qu'une version naïve commettrait

Imagine écrire, spontanément, cette séquence d'arrêt :

```cpp
// NAIVE VERSION -- DO NOT DO THIS
void naiveShutdown() {
    m_flag.requestStop();        // (a)
    m_captureThread->quit();     // (b)
    m_captureThread->wait();     // (c)  <-- can hang here forever
    m_pool->waitForDone();       // (d)
}
```

Cela semble raisonnable, et c'est exactement le genre de code qui passerait un test rapide fait en appuyant sur Stop pendant que le pipeline est peu chargé. Le problème apparaît dans un cas précis mais tout sauf rare : si, au moment où `naiveShutdown()` est appelée, le thread de capture est bloqué *à l'intérieur* de `m_buffer->produce()` parce que le buffer est plein — c'est-à-dire exactement le scénario de contropression de l'article précédent, un comportement **normal et attendu** du pipeline — alors l'étape (a) ne sert à rien : `m_flag` est une variable atomique, mais le thread de capture n'est pas en train de la regarder à ce moment-là, il dort dans `QWaitCondition::wait()`, qui ne se réveille que sur un `wakeOne()`/`wakeAll()` explicite ou un réveil intempestif (spurious wakeup). L'étape (b) met en file une demande de sortie que le thread ne pourra jamais traiter, car il n'est pas dans sa boucle d'événements. L'étape (c), `wait()`, se bloque alors **pour toujours** — ce n'est pas un ralentissement, c'est un véritable interblocage (deadlock).

### La séquence correcte, étape par étape

![Full shutdown: the deadlock-free stop ordering](modulo-06/27-full-pipeline-shutdown.png)

Ce qui manque à la version naïve est l'appel à `FrameBuffer::close()`, et sa position dans la séquence n'est pas négociable : il doit venir **avant** tout `wait()` bloquant sur un thread ou un pool, car c'est le seul des quatre pas qui **réveille physiquement** ceux qui dorment dans une `QWaitCondition` — exactement la même leçon que celle du Module 2, ici appliquée à trois étages concurrents au lieu de deux :

```cpp
void MainWindow::startShutdownSequence(const QString &reason, bool earlyCancellation) {
    if (m_stopInProgress || !m_running) return;
    m_stopInProgress = true;

    if (earlyCancellation) {
        m_flag.requestStop();    // stop producing NEW frames
    }
    m_buffer->close();           // WAKES anyone blocked in wait() -- the step that matters

    // wait for real termination, but NEVER on the GUI thread (see below)
    QThread *captureThread = m_captureThread;
    QThreadPool *pool = m_pool;
    QFuture<void> future = QtConcurrent::run([captureThread, pool]() {
        captureThread->quit();
        captureThread->wait();
        pool->waitForDone();
    });
    // ... QFutureWatcher signals onPipelineFullyStopped() when done ...
}
```

Avec `close()` appelé en premier, le thread de capture bloqué dans `produce()` se réveille immédiatement (`m_notFull.wakeAll()` à l'intérieur de `close()`), constate `m_closed == true`, et `produce()` renvoie `false` — sa `start()` sort de la boucle et retourne, le thread revient à sa propre boucle d'événements, et c'est seulement à ce moment-là que le `quit()` mis en file précédemment prend effet réel. Il en va de même, de manière symétrique, pour chaque `FrameWorkerTask` éventuellement bloquée dans `consume()` sur un buffer vide.

### Pourquoi l'attente finale ne peut pas se trouver sur le thread GUI

Il existe un second piège, moins spectaculaire qu'un interblocage mais pas moins important : `QThread::wait()` et `QThreadPool::waitForDone()` sont toutes deux des appels **bloquants**. Même une fois le problème d'interblocage résolu grâce à `close()`, les appeler directement depuis le slot connecté au bouton Stop bloquerait le thread de l'interface pendant toute la durée du drainage — ce qui, avec des workers encore à mi-chemin d'une frame de 200 millisecondes, peut être perceptible. C'est exactement la même leçon que celle du Module 0, le tout premier chapitre du cours entier (« ne jamais bloquer le thread GUI »), qui revient ici à l'échelle du pipeline complet : la solution consiste à déplacer l'attente hors du thread GUI avec `QtConcurrent::run()` (Module 3, utilisé ici pour une tâche différente de celle pour laquelle tu l'avais appris — non pas traiter des données, mais *attendre* que d'autres threads terminent) et un `QFutureWatcher` qui rappelle `onPipelineFullyStopped()` une fois le drainage réellement terminé, avec une connexion en file vers le thread GUI (Module 4).

### Arrêt anticipé contre arrêt naturel : ce n'est pas la même chose

Une dernière distinction, subtile mais réelle : quand l'utilisateur appuie sur Stop en plein milieu du pipeline, le drapeau coopératif est levé, et chaque `FrameWorkerTask` le vérifie après avoir terminé la frame qu'elle a en main — elle cesse donc d'en prélever d'autres, même si le buffer en contient encore. C'est un choix de réactivité : l'utilisateur a demandé de s'arrêter *maintenant*, pas « quand tu auras fini tout le travail déjà en file ». Quand, au contraire, la capture se termine d'elle-même parce qu'elle a atteint le nombre de frames demandé, il n'y a aucune urgence analogue : le drapeau **n'est pas** levé, et les workers continuent de drainer via `consume()` jusqu'à ce que le buffer soit véritablement vide — chaque frame capturée est garantie d'arriver au traitement. Deux chemins d'arrêt, la même séquence `close()` → attente asynchrone → notification, mais une seule différence délibérée, et c'est la différence entre « arrête-toi tout de suite » et « termine ce que tu as commencé » : dans le travail sur des systèmes de vision, c'est presque toujours une distinction que l'opérateur de la machine s'attend à pouvoir contrôler, pas un détail d'implémentation.

Avec le traitement parallèle et l'annulation coopérative complète désormais clairs, le dernier article de ce module — et du cours — traverse l'intégration de l'interface graphique et le projet guidé complet : comment le construire, comment le compiler, et ce qu'il faut observer quand on l'exécute vraiment.
