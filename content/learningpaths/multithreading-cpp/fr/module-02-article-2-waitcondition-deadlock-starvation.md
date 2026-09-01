---
title: "Attendre un événement, pas un verrou : QWaitCondition, QSemaphore, et comment se tirer une balle dans le pied"
description: "Multithreading en C++ avec Qt — Module 2"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Attendre un événement, pas un verrou : QWaitCondition, QSemaphore, et comment se tirer une balle dans le pied

Dans l'article précédent, nous avons vu comment protéger une donnée partagée avec `QMutex` et `QReadWriteLock`. Mais le producteur-consommateur a besoin de répondre à une question différente et plus subtile : « le buffer est plein — dois-je attendre que *quelque chose change*, pas seulement que le verrou se libère ». Un mutex à lui seul ne suffit pas à exprimer « attends jusqu'à ce qu'une certaine condition sur les données devienne vraie » : tu peux le garder verrouillé pour toujours dans une boucle qui revérifie en continu (une attente active, qui gaspille inutilement le CPU), ou bien tu as besoin d'un outil pensé exactement pour ça. Cet outil, c'est `QWaitCondition`.

## QWaitCondition : attendre un événement, pas seulement un verrou libre

Une `QWaitCondition` permet à un thread de **s'endormir** en relâchant temporairement un mutex qu'il détient, de rester en attente jusqu'à ce qu'un autre thread le **réveille** explicitement, et alors seulement de réacquérir le mutex et de reprendre. La partie cruciale, celle qui la rend différente d'un simple « dors et revérifie », est que l'endormissement et la libération du mutex se produisent comme une seule opération atomique : il n'y a jamais de fenêtre de temps où le thread a déjà libéré le verrou mais n'est pas encore « enregistré » comme en attente, fenêtre qui pourrait sinon faire perdre un réveil envoyé précisément à cet instant (un bug classique appelé *lost wakeup*, que `QWaitCondition` empêche par construction).

Le pattern d'utilisation est toujours le même :

```cpp
QMutex mutex;
QWaitCondition condition;
bool dataReady = false;

// Waiting thread:
QMutexLocker locker(&mutex);
while (!dataReady) {
    condition.wait(&mutex);   // releases the mutex, sleeps, reacquires it on wake-up
}
// the mutex is back in my hands here, and dataReady is true

// Notifying thread:
{
    QMutexLocker locker(&mutex);
    dataReady = true;
}
condition.wakeOne();   // or wakeAll(), if more than one thread must be woken
```

Remarque le `while`, pas un simple `if` : c'est délibéré, et ce n'est pas une pinaillerie stylistique. Au réveil, le code **doit revérifier depuis le début** la condition qu'il attendait, parce qu'il peut y avoir des réveils « intempestifs » (pour des raisons internes au système d'exploitation, sans que personne n'ait vraiment appelé `wakeOne()`), ou parce que — dans le cas de `wakeAll()` avec plusieurs threads en attente — un autre thread pourrait t'avoir devancé et avoir déjà consommé ce que tu attendais avant que tu ne reprennes réellement la main. Un `if` à la place du `while` est l'une des erreurs les plus courantes et les plus difficiles à repérer dans du code basé sur les wait conditions : ça marche presque toujours dans les tests, et échoue rarement, en production, à un moment que personne n'arrive à reproduire à volonté.

`wakeOne()` réveille exactement un thread en attente (s'il y en a plus d'un, le choix duquel n'est pas spécifié — ne compte jamais sur un ordre) ; `wakeAll()` les réveille tous, chacun d'eux revérifiant quand même sa propre condition (d'où, à nouveau, l'importance du `while`) et retournant éventuellement attendre si la condition n'est pas encore la bonne pour lui.

Dans le projet pratique de ce module, tu utiliseras **deux** `QWaitCondition` distinctes sur le même buffer : une pour la direction « le buffer est plein, le producteur attend », une pour « le buffer est vide, le consommateur attend ». C'est un pattern standard, et le voir appliqué de tes propres mains clarifiera bien plus que n'importe quelle explication abstraite supplémentaire.

## QSemaphore : compter au lieu d'attendre un booléen

Il y a une dernière primitive qui vaut la peine d'être connue, même si nous ne l'utiliserons pas directement aujourd'hui : `QSemaphore`. Un sémaphore (au sens informatique du terme, concept qui remonte à Dijkstra dans les années 1960) est, conceptuellement, un compteur entier non négatif avec deux opérations : `acquire()`, qui décrémente le compteur mais **bloque** l'appelant si le compteur est déjà à zéro, en attendant qu'il redevienne positif ; et `release()`, qui incrémente le compteur et réveille les éventuels threads en attente sur `acquire()`.

Pourquoi est-ce utile ? Parce que cela exprime naturellement l'idée de « N ressources interchangeables disponibles » — pas « le buffer est plein ou vide » au sens booléen, mais « combien d'emplacements libres il y a en ce moment », comptés explicitement. Le producteur-consommateur de ce module peut aussi se résoudre de cette façon, et il est instructif de voir la correspondance : deux sémaphores, `freeSlots` initialisé à la capacité du buffer et `usedSlots` initialisé à zéro, où le producteur fait `freeSlots.acquire()` avant d'insérer et `usedSlots.release()` après, et le consommateur fait exactement l'inverse. Le résultat final est comportementalement équivalent à ce que nous construisons avec `QWaitCondition` — c'est la même idée, la même paire de conditions « plein » et « vide », mais exprimée avec un compteur plutôt qu'avec un booléen et deux wait conditions explicites.

Lequel des deux styles choisir, dans le code réel que tu écriras après ce cours ? `QWaitCondition` (celle que nous utiliserons aujourd'hui) est le bon outil quand la condition d'attente est plus riche qu'un simple comptage — par exemple « attends jusqu'à ce que le buffer contienne *un élément avec une certaine propriété* », pas seulement « attends jusqu'à ce qu'il ne soit plus vide ». `QSemaphore` est plus direct et plus lisible quand ton problème est, littéralement, un comptage de ressources disponibles — un pool de connexions, un nombre fixe d'emplacements matériels, une limite du nombre d'opérations concurrentes permises. Aucun des deux n'est « supérieur » : choisis celui qui reflète le plus fidèlement la forme réelle du problème.

## Deadlock : l'attente circulaire

Introduire mutex et wait conditions sans parler de la façon dont on se tire une balle dans le pied avec eux serait malhonnête. Trois pièges, par ordre de fréquence dans la pratique.

Un **deadlock** (interblocage) se produit quand deux threads (ou plus) restent bloqués pour toujours, chacun en attente d'une ressource qu'un autre thread du groupe détient et ne relâchera jamais — parce que, à son tour, il attend quelque chose que le premier détient. Le Thread A détient le Mutex X et attend d'acquérir le Mutex Y ; le Thread B, au même moment, détient Y et attend X. Aucun des deux ne peut avancer, aucun des deux ne relâchera jamais ce qu'il détient (parce que pour le relâcher il devrait d'abord terminer son propre travail, qui est bloqué), et le programme reste là, silencieusement, pour toujours — aucun crash, aucun message d'erreur, simplement deux threads qui ne font plus rien.

![Deadlock: circular waiting](modulo-02/11-deadlock-circular-wait.png)

La condition qui rend ce scénario possible porte un nom dans la littérature classique des systèmes d'exploitation (les « conditions de Coffman », du nom d'un des auteurs de l'article de 1971 qui les a formalisées le premier), et elles sont quatre, toutes nécessaires simultanément pour qu'un deadlock puisse se produire : exclusion mutuelle (les ressources ne peuvent pas être partagées), possession-et-attente (un thread détient une ressource tout en en attendant une autre), pas de préemption (une ressource ne peut pas être arrachée de force à celui qui la détient), et **attente circulaire** (il existe un cycle de threads, chacun en attente d'une ressource détenue par le suivant dans le cycle). Sur les quatre, les trois premières sont presque toujours intrinsèques au problème que tu résous — tu ne peux pas les éliminer sans dénaturer la solution. La quatrième, l'attente circulaire, est en revanche celle sur laquelle tu as un levier pratique, et c'est pourquoi tout guide sur le deadlock converge vers la même recommandation : **établis un ordre global fixe dans lequel les verrous sont toujours acquis**, en tout point du programme, sans exception. Si chaque thread qui a besoin à la fois de X et de Y les acquiert toujours dans le même ordre (disons, toujours X puis Y, jamais l'inverse), le cycle devient structurellement impossible : il ne peut pas exister d'attente circulaire si tout le monde fait la file dans la même direction.

Dans le projet pratique d'aujourd'hui, le risque de deadlock est faible parce que nous utilisons un seul mutex (celui interne au buffer) — mais c'est un risque qui croît rapidement dès qu'un projet réel commence à avoir plusieurs ressources protégées séparément, et c'est pourquoi cela vaut la peine de bien fixer le principe dès maintenant, avant qu'il ne te serve sous pression avec un débogueur ouvert et un programme qui ne répond plus.

## Famine : techniquement vivant, en pratique oublié

La **famine** (*starvation*) est plus sournoise que le deadlock parce qu'elle ne bloque pas tout : un thread particulier, tout simplement, n'obtient jamais la ressource dont il a besoin, sans qu'il existe pourtant de cycle d'attente qui l'en empêche en théorie — il est toujours doublé par d'autres threads plus « chanceux » ou plus fréquents dans leurs demandes. C'est exactement la violation de la troisième propriété vue dans l'article précédent, l'attente bornée. `wakeOne()` sur une `QWaitCondition` avec de nombreux threads en attente, par exemple, ne garantit pas un ordre de réveil équitable (ce n'est pas nécessairement FIFO) — dans des scénarios avec une contention très élevée et des schémas d'accès déséquilibrés, il est théoriquement possible que le même thread reste malchanceux plus longtemps qu'on ne s'y attendrait. Pour notre projet pratique, avec un seul producteur et un seul consommateur, ce risque est nul par construction (il n'y a personne à doubler) ; il devient un facteur réel à considérer quand ton système grandit vers plusieurs producteurs ou plusieurs consommateurs sur le même buffer.

## Inversion de priorité : quand le système d'exploitation ajoute un troisième trouble-fête

Un dernier piège, plus rare mais qui vaut la peine d'être connu de nom parce que, quand il se produit, il est particulièrement difficile à diagnostiquer : l'**inversion de priorité**. Cela arrive quand un thread à **basse priorité** détient un verrou dont a besoin un thread à **haute priorité** ; ce dernier se bloque en attente, ce qui serait déjà normal — mais si entre-temps un troisième thread à priorité **moyenne** (qui n'a pas besoin de ce verrou) occupe le CPU, l'ordonnanceur continue à lui faire de la place au détriment du thread à basse priorité qui détient le verrou, lequel ne parvient pas à finir son travail et à le relâcher. Le résultat net est que le thread à haute priorité reste bloqué indirectement par un thread à priorité moyenne, une inversion complète de l'ordre de priorité que le système aurait dû respecter.

C'est un problème suffisamment réel pour avoir historiquement causé le quasi-échec de la mission Mars Pathfinder de la NASA en 1997 — un cas d'étude cité très souvent dans la littérature précisément pour cette raison. J'en raconte les détails dans un article à part, parce que cela vaut la peine de comprendre exactement comment un problème de synchronisation sur un rover à 225 millions de kilomètres de distance s'est transformé en réinitialisation périodique de tout le système, et comment il a été diagnostiqué et résolu — voir *« Mars Pathfinder : quand l'inversion de priorité atteint Mars »*.

La mitigation classique au niveau du système d'exploitation s'appelle l'*héritage de priorité* (*priority inheritance*) : temporairement, le thread à basse priorité qui détient le verrou contesté « hérite » de la priorité du thread plus élevé qui l'attend, de sorte que l'ordonnanceur le favorise assez pour lui permettre de finir le travail et de libérer le verrou. Qt ne gère pas cela automatiquement au niveau applicatif — c'est typiquement une responsabilité de l'ordonnanceur du système d'exploitation sous-jacent — mais savoir que le phénomène existe, et en reconnaître les symptômes (un thread à haute priorité mystérieusement lent, en présence d'une charge de threads à priorité intermédiaire), t'épargnera des heures de débogage le jour où tu le rencontreras dans un système avec des contraintes temps réel.

## De la théorie aux mains sur le clavier

Tu disposes maintenant de tous les outils pour protéger et coordonner un véritable état partagé : `QMutex`, `QReadWriteLock`, `QWaitCondition`, `QSemaphore`, et le vocabulaire pour reconnaître deadlock, famine et inversion de priorité quand tu les rencontres. Dans le prochain article, nous mettons tout cela ensemble en construisant un vrai producteur-consommateur, avec deux threads persistants qui se disputent un buffer limité sous tes yeux.
