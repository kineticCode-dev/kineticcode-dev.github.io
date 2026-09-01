---
title: "QThread n'est pas le thread : c'est une télécommande (et pourquoi le sous-classer trompe)"
description: "Multithreading en C++ avec Qt — Module 1"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QThread n'est pas le thread : c'est une télécommande (et pourquoi le sous-classer trompe)

Dans l'article précédent, tu as vu le problème de tes propres yeux : un bouton qui, une fois cliqué, arrête le battement de la fenêtre pendant plusieurs secondes, parce que le slot qui réagit au clic exécute un calcul lourd directement sur le thread qui possède la boucle d'événements de la GUI. Cet article commence le traitement, et il vaut la peine d'être honnête sur un point dès maintenant : `QThread` est probablement la classe la plus mal comprise de toute la bibliothèque Qt, et ce n'est pas la faute de ceux qui l'utilisent, mais celle d'un accident historique bien précis. Pendant des années, la documentation officielle de Qt elle-même et ses exemples ont enseigné une manière de l'utiliser qu'un ingénieur de l'équipe Qt en personne a publiquement qualifiée, dans un article de 2010 devenu légendaire dans la communauté Qt, de *"You're doing it wrong"* — « tu t'y prends mal » — en parlant de la façon dont les exemples officiels du framework la présentaient jusqu'alors. Si tu as déjà lu quelque part, ou si tu te souviens d'un tutoriel vu il y a des années, que « pour utiliser QThread il faut en créer une sous-classe et redéfinir `run()` », ce n'est pas de ta faute si cela semblait la voie naturelle : c'était, littéralement, ce que Qt lui-même enseignait.

## QThread n'est pas « le thread » : c'est une télécommande

Pars d'une erreur d'intuition si répandue qu'il vaut mieux la démonter tout de suite, avant d'écrire la moindre ligne de code : quand tu crées un objet `QThread`, cet objet **n'est pas** le thread du système d'exploitation. C'est un `QObject` — une classe C++ comme une autre, avec son constructeur, ses méthodes, sa place dans l'arbre de parenté de Qt — qui **représente et contrôle** un thread du système d'exploitation, un peu comme la télécommande d'un téléviseur n'est pas le téléviseur : tu l'allumes, tu l'éteins, tu changes de chaîne avec elle, mais la télécommande elle-même reste confortablement sur ton canapé, pas dans l'appareil.

Quand tu écris `QThread *thread = new QThread(this);`, disons dans le constructeur de ta `MainWindow`, cette instance de `QThread` **naît et vit dans le thread où tu l'as créée** — presque toujours le thread principal de la GUI, exactement comme n'importe quel autre `QObject` que tu construis là. Elle a une poignée de méthodes qui forment son « panneau de contrôle » : `start()` pour lancer le thread système qu'elle gère, `quit()` pour lui demander d'arrêter gentiment sa propre boucle d'événements, `wait()` pour bloquer jusqu'à ce que ce thread ait vraiment terminé, `isRunning()` pour interroger son état. Appeler ces méthodes depuis le thread principal est sûr précisément parce que l'objet `QThread` en lui-même y vit.

![QThread is not the thread: it's a remote control](modulo-01/05-qthread-is-a-remote-control.png)

Quand tu appelles `thread->start()`, il se passe quelque chose de distinct et de séparé : Qt effectue l'appel système qui crée réellement un nouveau thread du système d'exploitation (le même mécanisme sous-jacent que `std::thread`, déjà rencontré précédemment), et dans ce nouveau thread, elle lance l'exécution de la méthode virtuelle `QThread::run()`. Si tu ne l'as pas redéfinie — et dans le pattern que nous adopterons dans cet article, nous ne la redéfinirons jamais — l'implémentation par défaut de `run()` fait simplement une chose : elle appelle `exec()`, c'est-à-dire qu'elle démarre une **boucle d'événements** sur ce nouveau thread, conceptuellement identique à celle que le thread principal démarre avec `QApplication::exec()` quand l'application se lance. À partir de ce moment, ce thread système existe dans un but précis : attendre des événements (dans ce cas, presque toujours des signaux arrivant d'autres threads) et les traiter un par un, dans l'ordre — exactement comme le thread de la GUI, sauf que maintenant cette seconde boucle d'événements tourne sur un thread complètement séparé.

## L'ancien pattern : sous-classer QThread (et pourquoi ça trompe)

L'instinct naturel, quand tu veux faire tourner du code sur un thread séparé en utilisant une classe orientée objet comme `QThread`, est celui-ci : je crée ma propre classe qui hérite de `QThread`, j'y mets la logique qui doit tourner sur le thread séparé, peut-être même quelques slots pour recevoir des commandes. En code :

```cpp
class MyThread : public QThread {
    Q_OBJECT
public:
    void run() override {
        // heavy work here
    }

public slots:
    void otherMethod() {
        // ... here comes the surprise
    }
};
```

Ce code compile, et la partie à l'intérieur de `run()` s'exécute exactement là où tu t'y attends : sur le thread système géré par cette instance, parce que `run()` est précisément la méthode que Qt invoque sur ce thread dès qu'il démarre. Jusque-là, tout correspond à l'intuition. Le problème — celui qui a donné naissance à l'article « You're doing it wrong » et à des années de rapports de bugs confus sur les forums Qt — concerne `otherMethod()` : c'est un slot déclaré dans la même classe, mais **il ne s'exécute pas du tout sur le thread géré par cette instance**. Il s'exécute sur le thread qui **possède** l'objet `MyThread` lui-même — c'est-à-dire, presque toujours, le thread principal qui l'a créé avec `new MyThread()`. La raison est la même que précédemment : un `QObject` (et `QThread` reste un `QObject`, avec toute l'infrastructure de signaux et slots que cela implique) exécute ses propres slots sur le thread auquel il **appartient** — son affinité de thread — pas sur le thread qu'il gère éventuellement comme « contenu » de `run()`. `run()` est un cas particulier, la seule méthode dont Qt garantit qu'elle s'exécute réellement sur le thread géré ; tout autre slot de la même classe suit la règle générale, pas cette exception.

Historiquement, cela a conduit des développeurs à écrire du code qui semblait fonctionner dans les cas simples — quand la seule chose nécessaire est de faire tourner un bloc de calcul isolé, sans besoin de recevoir des commandes ultérieures via des signaux — et à se casser silencieusement au moment où ce thread devait aussi réagir à des événements externes pendant l'exécution, avec des race conditions ou des comportements inexplicables que personne ne savait diagnostiquer sans avoir lu, justement, cet article de 2010.

## Le pattern recommandé : worker object et moveToThread()

La solution que la communauté Qt (et aujourd'hui la documentation officielle elle-même) recommande retourne l'approche : **ne jamais sous-classer `QThread`**. Utilise-la toujours telle quelle, identique dans chaque projet — la télécommande de tout à l'heure, sans modification. La logique métier, elle, va dans une classe séparée qui hérite seulement de `QObject` — on l'appelle par convention le **worker** — et qui ne sait rien, ni ne se soucie de rien, à propos des threads ou de `QThread`. C'est un morceau de logique pur. Ensuite, une seule méthode fait toute la magie :

```cpp
worker->moveToThread(thread);
```

`moveToThread()` change l'**affinité de thread** de l'objet `worker` : à partir de ce moment, cet objet « appartient » à `thread` au lieu du thread qui l'avait créé, et — c'est la partie qui compte — **chacun de ses slots, appelé via une connexion queued, s'exécutera sur le thread géré par `thread`**, sans exception, sans cas particulier à retenir par cœur.

![Thread affinity before and after moveToThread](modulo-01/08-thread-affinity-before-after.png)

Il y a une contrainte technique à connaître, parce que tu la rencontreras dans le projet pratique un peu plus loin : un `QObject` **avec un parent** (au sens de l'arbre de parenté de Qt, `new Worker(this)`) **ne peut pas être déplacé** avec `moveToThread()` — l'appel échoue silencieusement avec un avertissement à l'exécution, pas une erreur de compilation, ce qui en fait un piège facile à ne pas remarquer. La raison est logique une fois qu'on y réfléchit : l'arbre de parenté de Qt suppose qu'un parent et ses enfants vivent sur le même thread (c'est comme ça, par exemple, que fonctionne la destruction en cascade) ; déplacer un enfant sur un thread différent de celui du parent romprait cette garantie. La conséquence pratique est que ton worker doit être construit **sans parent** — `new PrimeCalculator()`, pas `new PrimeCalculator(this)` — et sa vie gérée explicitement par toi, comme nous le verrons dans le prochain article à propos du cycle de vie.

![Comparing the two patterns: subclassing QThread versus worker plus moveToThread](modulo-01/07-subclass-vs-movetothread-comparison.png)

Avec ce pattern, `QThread` reste un objet anonyme et jamais personnalisé, réutilisable à l'identique dans chaque projet Qt que tu écriras désormais ; c'est le worker, une classe `QObject` tout à fait ordinaire avec ses slots et ses signaux, qui porte toute la logique — et **chacun** de ses slots, sans exception à retenir, s'exécute correctement sur le thread géré. C'est précisément le pattern que nous construisons ensemble dans le projet pratique de ce module.

## Ce qu'il reste à comprendre

Tu connais maintenant la différence entre l'objet `QThread` et le thread qu'il gère, et pourquoi sous-classer `QThread` est presque toujours le mauvais choix face au pattern worker + `moveToThread()`. Il reste une question pratique évidente : si le worker vit désormais sur un thread différent, comment lui dire « commence le calcul » depuis le thread de la GUI, et comment le faire me dire « j'ai fini » en revenant sur la GUI, sans réintroduire les race conditions que nous avons étudiées ? C'est le sujet du prochain article, avec le cycle de vie complet d'un worker thread — et ensuite, enfin, les mains sur le clavier pour soigner sérieusement le freeze du module précédent.
