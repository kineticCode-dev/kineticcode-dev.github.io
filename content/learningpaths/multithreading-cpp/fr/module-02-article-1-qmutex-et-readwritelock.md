---
title: "La section critique formalisée : QMutex, QMutexLocker et QReadWriteLock"
description: "Multithreading en C++ avec Qt — Module 2"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# La section critique formalisée : QMutex, QMutexLocker et QReadWriteLock

Dans le module précédent, tu as appris à faire tourner du travail sur un thread séparé et à le faire communiquer avec la GUI en sécurité — mais si tu y prêtes attention, tu n'as jamais eu besoin d'un vrai mutex. Le worker et la fenêtre ne touchaient jamais la même variable au même moment : ils échangeaient des messages via des signaux, et Qt se chargeait de les livrer en file, un par un, sans chevauchement. C'est une façon élégante d'éviter le problème de la mémoire partagée en évitant, justement, de la partager — un worker isolé, avec son propre état privé, qui ne parle vers l'extérieur que par des signaux.

Cet article aborde le cas où cette élégance ne suffit plus : deux threads ou plus qui doivent réellement lire et écrire la **même structure de données**, au même moment, parce que c'est précisément ce partage qui est le but du programme — pas un effet de bord à éviter. C'est le cas classique, ancien dans l'histoire des systèmes d'exploitation et pourtant encore aujourd'hui le pain quotidien de quiconque écrit du logiciel concurrent sérieusement : le **producteur-consommateur**. Un thread génère des données à un rythme qu'il ne contrôle pas totalement (un capteur, un réseau, dans un système de vision une caméra qui livre des images à un certain framerate) ; un autre les traite à un rythme différent, presque toujours plus lent et variable. Entre les deux, un entrepôt de capacité limitée — le **buffer** — qui absorbe les différences de vitesse, jusqu'à un certain point : si le producteur va trop vite, l'entrepôt se remplit et doit attendre ; si le consommateur manque de travail, c'est lui qui attend.

## La section critique, formalisée

Tu as déjà vu la section critique comme « le morceau de code qu'un seul thread doit exécuter à la fois ». Il est utile de se la représenter comme un couloir avec une seule porte, large exactement de la place d'une personne. Celui qui arrive et trouve la porte occupée attend en file dehors ; celui qui est dedans sort quand il a fini, et c'est seulement alors que le suivant dans la file peut entrer.

![The critical section as a one-way corridor](modulo-02/09-critical-section-corridor.png)

Mais « un thread à la fois » à lui seul ne suffit pas à définir une solution *correcte*, et cela vaut la peine de poser par écrit, une fois pour toutes, les trois propriétés que la théorie classique des systèmes d'exploitation exige de tout mécanisme de synchronisation — parce que chaque outil que nous verrons dans ce module doit être jugé par rapport à ces trois-là, pas seulement par rapport à « ça marche dans mes tests ».

**Exclusion mutuelle** : jamais plus d'un thread dans la section critique au même instant. C'est la propriété la plus évidente, celle sur laquelle nous nous sommes déjà attardés précédemment, et aucun outil que nous verrons aujourd'hui ne la viole jamais — c'est le minimum syndical.

**Progrès** : si la section critique est libre et qu'un ou plusieurs threads veulent y entrer, la décision de qui entre ne peut pas être reportée indéfiniment par des facteurs qui n'ont rien à voir avec l'usage réel de la ressource. En clair : il ne doit pas exister de scénario où la porte est libre mais où personne ne parvient jamais à passer à cause d'un défaut du mécanisme lui-même.

**Attente bornée** : un thread qui attend d'entrer doit, tôt ou tard, y parvenir — il n'est pas admis que quelqu'un d'autre continue à le doubler indéfiniment. C'est la propriété la plus subtile, et c'est précisément celle qui est mise en défaut dans les problèmes de **famine** (*starvation*) que nous rencontrerons plus loin : un thread pourrait techniquement entrer, la garantie d'exclusion mutuelle n'est jamais violée, et pourtant dans les faits son tour ne vient jamais parce que le « trafic » dans la section critique le double toujours.

Garde ces trois propriétés en tête comme critère de jugement : chaque fois que tu conçois un schéma de synchronisation — dans ce module ou dans ton travail réel — ce sont les trois questions à te poser, dans cet ordre.

## QMutex et QMutexLocker : l'outil de base

`QMutex` est l'équivalent natif de Qt de `std::mutex`, que tu as déjà utilisé dans le premier article de ce cours. Le fonctionnement conceptuel est identique — `lock()` entre dans la section critique (en attendant si nécessaire), `unlock()` en sort — avec quelques différences pratiques qui valent la peine d'être connues.

Ce n'est pas une redondance gratuite que Qt ait son propre mutex. `QMutex` existait dans Qt avant même que `std::mutex` ne devienne partie du standard C++ (arrivé seulement avec C++11), et reste aujourd'hui le choix naturel en code Qt pour deux raisons concrètes : il s'intègre mieux avec les outils de débogage de Qt Creator (qui sait inspecter l'état d'un `QMutex` dans le débogueur de façon plus lisible), et surtout Qt offre, distincte de `QMutex`, une classe `QRecursiveMutex` pour les cas (rares, et à utiliser avec suspicion) où un thread doit pouvoir acquérir plusieurs fois le même verrou sans se bloquer lui-même — utile dans des hiérarchies d'appels récursifs qui repassent plusieurs fois par la même section critique, mais aussi un signal d'alarme presque toujours symptomatique d'une conception de la synchronisation qui pourrait être simplifiée.

Exactement comme `std::lock_guard`, `QMutexLocker` acquiert le verrou dans le constructeur et le libère dans le destructeur :

```cpp
void SharedBuffer::produce(int value) {
    QMutexLocker locker(&m_mutex);
    // ... critical section ...
} // automatic unlock here, whichever way the function exits
```

L'avantage du pattern RAII ici n'est pas seulement esthétique : si dans la section critique il y a un `return` anticipé, ou si une exception venait à être lancée, `QMutexLocker` garantit quand même le déverrouillage — un `mutex.lock()` / `mutex.unlock()` écrits à la main te laisseraient avec un mutex bloqué pour toujours dans chacun de ces cas, l'un des bugs les plus sournois et les plus difficiles à diagnostiquer de toute la programmation concurrente, parce que le symptôme (le programme se bloque) apparaît très loin, dans le temps et dans le code, de la cause (l'`unlock()` manquant).

Au-delà de `lock()` (bloquant, attend le temps qu'il faut), `QMutex` offre `tryLock()`, qui tente d'acquérir le verrou et retourne immédiatement avec `true` ou `false` selon qu'il y est parvenu, sans jamais se bloquer — utile quand ton thread a une alternative sensée à faire si la ressource est occupée, plutôt que de se mettre en file. Il existe aussi une variante avec timeout, `tryLock(milliseconds)`, qui attend au maximum le temps indiqué avant d'abandonner. Nous ne les utiliserons pas dans le projet pratique de ce module — notre producteur et notre consommateur *doivent* attendre, ils n'ont pas de plan B — mais tu les retrouveras naturellement le jour où tu concevras du code avec des contraintes de réactivité plus strictes.

## QReadWriteLock : quand la majorité du trafic est en lecture

Il y a un scénario très courant dans lequel `QMutex` est plus restrictif que nécessaire : quand une donnée partagée est **lue** très souvent par plusieurs threads et **écrite** rarement. Pense à une table de configuration ou à une carte de calibration d'un système de vision, chargée une fois puis consultée en continu par plusieurs threads de traitement : avec un `QMutex` ordinaire, même deux lectures — des opérations qui, en elles-mêmes, ne se gênent jamais mutuellement, parce qu'aucune des deux ne modifie rien — seraient forcées de se mettre en file l'une derrière l'autre, gaspillant un parallélisme que le matériel t'offrirait gratuitement.

`QReadWriteLock` distingue explicitement les deux intentions. Quand plusieurs threads veulent seulement **lire**, ils peuvent tous le faire ensemble, au même moment — aucun d'eux ne bloque l'autre, parce qu'une lecture ne modifie pas l'état qu'une autre lecture est en train d'observer. Au moment où un thread veut **écrire**, en revanche, le verrou devient exclusif au sens le plus strict : aucun autre thread, lecteur ou écrivain, ne peut accéder à la donnée tant que l'écrivain n'a pas fini.

![QReadWriteLock: concurrent reads, exclusive write](modulo-02/12-readwritelock-readers-writer.png)

L'usage pratique reprend le même esprit RAII déjà vu : `QReadLocker` pour acquérir en lecture, `QWriteLocker` pour acquérir en écriture, tous deux avec libération automatique en fin de portée.

```cpp
double readCalibration(int index) const {
    QReadLocker locker(&m_lock);
    return m_calibrationValues.at(index);
}

void updateCalibration(int index, double newValue) {
    QWriteLocker locker(&m_lock);
    m_calibrationValues[index] = newValue;
}
```

Un mot de prudence, car c'est une erreur conceptuelle courante : `QReadWriteLock` **n'est pas toujours plus rapide** que `QMutex`, même dans des scénarios à lecture prédominante. Le mécanisme qui tient le compte de « combien de lecteurs sont dedans en ce moment » a un coût interne non nul, et pour des sections critiques très courtes (quelques instructions) ce coût de comptabilité peut dépasser le bénéfice du parallélisme gagné — la même leçon de granularité déjà rencontrée à propos des changements de contexte, réappliquée ici : le bon choix dépend du temps réellement passé dans la section critique et du déséquilibre entre lectures et écritures, pas d'une intuition générique sur la primitive qui « sonne » la plus efficace.

## Ce qu'il reste à comprendre

Avec `QMutex`, `QMutexLocker` et `QReadWriteLock`, tu sais déjà comment protéger une donnée partagée contre des accès simultanés. Mais le producteur-consommateur a besoin de quelque chose de plus subtil : pas seulement « puis-je entrer ? », mais « dois-je attendre que *quelque chose change*, pas seulement que le verrou se libère ». C'est le thème du prochain article, ainsi que les dangers classiques — deadlock, famine, inversion de priorité — que toute synchronisation sérieuse doit savoir reconnaître.
