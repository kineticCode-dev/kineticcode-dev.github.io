---
title: "Deux boucles d'événements qui se parlent en sécurité : connexions queued et cycle de vie d'un worker thread"
description: "Multithreading en C++ avec Qt — Module 1"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Deux boucles d'événements qui se parlent en sécurité : connexions queued et cycle de vie d'un worker thread

Dans l'article précédent, nous avons retourné l'approche de `QThread` : on ne le sous-classe pas, on l'utilise tel quel, et la logique va dans un worker séparé déplacé avec `moveToThread()`. Il reste une question pratique évidente : si le worker vit désormais sur un thread différent de celui de la GUI, comment communique-t-on dans les deux directions sans réintroduire les race conditions que nous avons déjà appris à redouter ?

## Deux boucles d'événements, et comment elles se parlent sans risque

La réponse est que tu ne le fais pas toi-même, manuellement : c'est Qt qui s'en charge, automatiquement, à travers le même mécanisme de signaux et slots que tu connais déjà, avec un comportement supplémentaire qui se déclenche silencieusement quand l'émetteur et le destinataire vivent sur des threads différents. Chaque thread qui exécute une boucle d'événements — que ce soit le thread de la GUI, ou un thread géré par un `QThread` qui n'a pas redéfini `run()` — possède sa propre **file d'événements**, indépendante de celle de tout autre thread. Quand tu appelles `connect()` entre un objet qui vit sur le thread A et un autre qui vit sur le thread B, Qt compare les deux affinités de thread au moment de l'émission du signal et, si elles sont différentes, **n'appelle pas le slot directement** : il emballe l'appel (le nom de la méthode, les arguments, tout) dans un événement et le dépose dans la file du thread qui possède le destinataire. Ce thread, quand son tour arrive dans le cycle de sa boucle d'événements, retire l'événement de la file et **seulement à ce moment-là** exécute vraiment le slot — sur son propre thread, avec ses propres données, sans qu'aucun autre thread ne touche cette mémoire au même instant.

![Two event loops connected by a queued connection](modulo-01/06-two-event-loops-queued-connection.png)

Ce type de liaison a un nom précis, que nous reverrons avec tous les détails techniques plus loin dans le parcours : on l'appelle **QueuedConnection**, et c'est l'un des quatre modes de connexion que Qt propose (les autres sont `DirectConnection`, `BlockingQueuedConnection`, et `AutoConnection` — ce dernier étant le comportement par défaut, qui choisit automatiquement Direct si l'émetteur et le destinataire partagent le même thread, Queued sinon, exactement le comportement que nous exploitons aujourd'hui sans jamais avoir à le préciser explicitement). Le point conceptuel à retenir aujourd'hui est celui-ci : **une connexion signal-slot ordinaire entre objets sur des threads différents est déjà, en elle-même, thread-safe**, parce que le signal n'exécute jamais le code du destinataire « sur place » — il se contente de laisser un message dans sa boîte aux lettres, et c'est le destinataire lui-même, quand ça lui convient, qui le lit et l'exécute. Tu n'as pas besoin d'un `QMutex` pour protéger cet échange : Qt l'a déjà rendu sûr pour toi, à condition que tu communiques toujours via signaux et slots et non, par exemple, en appelant directement une méthode publique du worker depuis l'extérieur ou en touchant ses variables membres depuis un autre thread — ce serait de nouveau, point final, une data race.

## Le cycle de vie d'un worker thread, et le piège de deleteLater()

Mettre en place un worker thread n'est que la moitié du travail : l'autre moitié, celle qui sépare le code robuste de celui qui fuit de la mémoire ou plante à la fermeture de l'application, consiste à gérer correctement sa naissance et surtout sa fin.

Un pattern très courant, et c'est celui que nous utiliserons dans le projet pratique, consiste à connecter le signal `QThread::started` — émis automatiquement dès que le thread géré a effectivement démarré sa propre boucle d'événements — au slot du worker qui donne le coup d'envoi du travail :

```cpp
connect(thread, &QThread::started, worker, &Worker::start);
```

Remarque que cette connexion est, une fois de plus, entre des objets sur des threads différents (le signal est émis *par* le thread géré dès qu'il démarre, mais la connexion elle-même, tu l'écris depuis le thread GUI, et de toute façon le worker vit sur le thread géré) — donc automatiquement queued, et l'exécution de `start()` a lieu en sécurité sur le bon thread.

Pour arrêter proprement un thread géré, la méthode correcte est `QThread::quit()` (un pseudo-synonyme de `exit(0)`) : elle poste une demande de sortie dans la file d'événements de ce thread, que la boucle d'événements traite dès que son tour arrive, en sortant de `exec()` — à ce moment-là, `run()` retourne, et le thread système se termine naturellement. C'est fondamentalement différent de `QThread::terminate()`, une méthode qui existe mais qu'il faut presque toujours éviter : elle force l'arrêt immédiat du thread à l'endroit exact où il se trouve, sans lui donner la possibilité de libérer des ressources, de débloquer des mutex qu'il pourrait tenir, ou de terminer une écriture de fichier à moitié faite — c'est l'équivalent, dans le domaine des threads, de débrancher un ordinateur au lieu de l'éteindre depuis le système d'exploitation, et les dégâts collatéraux possibles sont de la même nature.

Après `quit()`, si tu veux être certain que le thread s'est **vraiment** terminé avant de continuer (par exemple, avant de détruire le worker), tu appelles `wait()`, qui bloque le thread appelant jusqu'à ce que le thread géré ait vraiment fini. C'est exactement la séquence que nous utiliserons bientôt dans le destructeur de notre fenêtre : `thread->quit(); thread->wait();` — d'abord je demande gentiment de sortir, puis j'attends que ce soit vraiment arrivé, et alors seulement il est sûr de retoucher l'état du worker depuis le thread GUI.

Un pattern que tu trouveras très fréquemment dans la documentation officielle et les exemples Qt, pour détruire en toute sécurité un worker quand son thread se termine, est celui-ci :

```cpp
connect(thread, &QThread::finished, worker, &QObject::deleteLater);
```

`deleteLater()` ne détruit pas l'objet immédiatement : elle poste un événement de destruction différée dans la file d'événements **du thread auquel l'objet appartient à ce moment-là** — pas du thread appelant — qui sera traité et exécuté à la première occasion utile par cette boucle d'événements. C'est un mécanisme conçu exprès pour qu'on puisse l'appeler en toute sécurité depuis un autre thread, et c'est pour cela qu'il apparaît si souvent dans le code concurrent Qt.

Mais un piège concret se cache ici : **si le thread auquel l'objet appartient a déjà cessé d'exécuter sa propre boucle d'événements, cet événement de destruction ne sera jamais traité**, et l'objet ne sera jamais détruit — une fuite silencieuse, aucun crash, aucun avertissement, juste de la mémoire qui ne revient jamais. C'est une situation étonnamment facile dans laquelle tomber : si par erreur tu appelles `quit()` sur le thread *avant* que l'événement de `deleteLater()` ait été traité, ou si tu structures l'ordre de tes connexions de façon que l'événement de destruction arrive après que le thread a déjà commencé à s'arrêter, tu te retrouves avec un objet fantôme que personne ne détruira jamais.

Dans le projet pratique d'aujourd'hui, **nous évitons délibérément cette complication** : notre worker thread reste vivant pendant toute la durée de l'application (c'est un worker « persistant », pas « à usage unique » — nous en parlons dans un instant), et quand la fenêtre se ferme, nous arrêtons le thread avec `quit()` + `wait()` et nous détruisons le worker avec un `delete` direct et ordinaire, ce qui est parfaitement sûr à ce moment précis parce que, une fois que `wait()` est revenu, tu es mathématiquement certain qu'aucun autre thread n'exécute plus de code touchant cet objet. Le pattern complet avec `deleteLater()` pour les workers « à usage unique » — ceux qui naissent, font un travail, et doivent être supprimés automatiquement — nous le verrons avec toute l'attention qu'il mérite plus loin dans le parcours, quand nous parlerons d'annulation coopérative et de cycles de vie plus élaborés.

## Worker persistant contre worker à usage unique

Une dernière distinction conceptuelle, avant le projet pratique, parce que tu la retrouveras plus loin dans le cours : un worker **persistant** est créé une fois, déplacé une fois sur son thread avec `moveToThread()`, et reçoit à partir de là, au cours de la vie de l'application, autant de demandes de travail que nécessaire, via des signaux répétés — c'est le pattern que nous utiliserons aujourd'hui, adapté quand tu sais que l'utilisateur appuiera sur ce bouton encore et encore dans la même session. Un worker **à usage unique**, au contraire, naît pour faire un seul travail, s'éteint (avec la séquence `quit()` + `deleteLater()` de tout à l'heure) une fois terminé, et si un autre calcul est nécessaire, on en crée un nouveau à partir de zéro. Aucun des deux n'est « le bon » dans l'absolu : le choix dépend du nombre de fois où tu prévois que ce travail doive se répéter, et du coût, en termes de ressources, de garder un thread inactif en attente plutôt que de le recréer à chaque fois — le même principe de granularité déjà rencontré précédemment, appliqué ici à l'échelle d'un thread entier plutôt qu'à celle d'une seule instruction.

## De la théorie aux mains sur le clavier

Tu as maintenant tout le vocabulaire pour construire un worker thread robuste : la différence entre `QThread` et le thread géré, le pattern worker + `moveToThread()`, les connexions queued qui rendent la communication entre threads automatiquement sûre, et la séquence correcte de démarrage et d'arrêt. Dans le prochain article, nous mettons tout cela ensemble, en reprenant exactement la fenêtre au freeze du module précédent et en la soignant pour de bon.
