---
title: "Capstone : architecture d'un pipeline de vision — capture et buffer limité"
description: "Multithreading en C++ avec Qt — Module 6 (Capstone)"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone : architecture d'un pipeline de vision — capture et buffer limité

Tu es parti, il y a six modules, d'un bouton qui bloquait une fenêtre. Un clic, un calcul lourd exécuté au mauvais endroit, et l'application entière cessait de respirer pendant quelques secondes — non pas à cause d'un bug exotique, mais tout simplement parce que c'est ce qui arrive quand un seul thread doit à la fois faire le travail et répondre à l'utilisateur. À partir de là, tu as construit, pièce par pièce, tout un vocabulaire : `QThread` et l'architecture à boucle d'événements (Module 1), `QMutex` et `QWaitCondition` pour coordonner un véritable état partagé (Module 2), `QtConcurrent` et le modèle Future/Promise pour le travail à gros grain (Module 3), les règles précises des connexions entre threads et l'annulation coopérative (Module 4), `QThreadPool`, les atomiques et le coût caché du cache (Module 5). Chaque module a résolu un problème précis, isolé, avec un projet guidé qui le démontrait à lui seul.

Ce module capstone n'en introduit pas de nouveau. Sa mission est différente et, pour être honnête, plus difficile : prendre toutes ces pièces et les faire fonctionner **ensemble**, dans le même programme, simultanément — car c'est exactement là que se joue la différence entre « connaître une technique » et « savoir construire un système ». Un pool de threads qui fonctionne parfaitement en isolation peut se bloquer indéfiniment si l'ordre dans lequel on l'arrête par rapport à un buffer en amont n'est pas le bon. Une annulation coopérative irréprochable avec un seul worker doit être repensée de fond en comble lorsque les workers coopérants deviennent trois étages concurrents au lieu d'un.

Le projet guidé de ces derniers articles, **Projet H — Pipeline de traitement de frames en quasi temps réel**, est délibérément proche d'un cas réel : un thread d'acquisition qui simule une caméra, un buffer limité qui découple acquisition et traitement, un pool de workers qui applique un filtre réel à chaque frame en parallèle, un mécanisme d'arrêt qui doit tout stopper sans perdre de données et sans rester bloqué, et une interface graphique qui reste réactive du début à la fin. Cinq étages, chacun construit avec la technique d'un module précis.

## Vue d'ensemble : cinq étages, un seul flux

![End-to-end architecture of the capstone pipeline](modulo-06/25-capstone-pipeline-architecture.png)

Le flux est linéaire dans le sens des données — une frame naît à l'Étage 1, traverse l'Étage 2, est consommée et traitée à l'Étage 3, et son résultat atteint l'Étage 5 par des signaux — mais **pas** linéaire dans le contrôle : l'Étage 4, le drapeau d'annulation coopérative, n'est pas un cinquième maillon de la chaîne, c'est une ligne qui touche *simultanément* les quatre autres, car arrêter le pipeline est une opération qui doit toucher chaque étage dans le bon ordre, explicitement.

Voici la carte complète de quel module du cours a enseigné la technique de chaque étage :

- **Étage 1 — Capture** : un `QThread` persistant avec un worker déplacé via `moveToThread()`, jamais une sous-classe de `QThread`. Technique du **Module 1**.
- **Étage 2 — Buffer partagé** : `QMutex` + deux `QWaitCondition`, une file limitée, le même schéma producteur-consommateur déjà vu. Technique du **Module 2**.
- **Étage 3 — Traitement parallèle** : un pool de tâches persistantes sur `QThreadPool`, avec une alternative à `QtConcurrent` discutée et justifiée. Technique du **Module 5** (avec une comparaison explicite avec le **Module 3**).
- **Étage 4 — Annulation coopérative** : un drapeau atomique partagé, étendu pour coordonner correctement trois étages concurrents au lieu d'un seul. Technique du **Module 4**.
- **Étage 5 — Intégration GUI** : des signaux avec connexion en file (queued) vers le thread principal, qui ne se bloque jamais. Technique du **Module 0** réappliquée à l'échelle du système entier.

## Étage 1 : la capture, un worker persistant qui ne sait rien du reste

**Objectif.** Un thread séparé qui génère des frames synthétiques à un rythme régulier et contrôlé, exactement comme le ferait le pilote d'une véritable caméra — sans jamais toucher directement à l'interface graphique, sans rien savoir de la façon dont les frames seront traitées.

Le pattern est celui du Module 1 : aucune sous-classe de `QThread`, un `QObject` worker (`CaptureWorker`) déplacé avec `moveToThread()` sur un `QThread` pur, démarré quand le thread émet `started`. Ce qui est nouveau, c'est ce que fait le worker une fois démarré : il ne traite rien lui-même, il se contente de générer une `QImage` synthétique et de la remettre à l'étage suivant :

```cpp
void CaptureWorker::start() {
    int frameNumber = 0;

    while (!m_flag->requested() && frameNumber < m_targetFrameCount) {
        QThread::msleep(m_intervalMs);
        if (m_flag->requested()) break;   // re-check even after the sleep

        QImage frame = generateSyntheticFrame(frameNumber);
        if (!m_buffer->produce(frame, frameNumber)) break;

        emit frameCaptured(frameNumber);
        ++frameNumber;
    }

    emit captureFinished(frameNumber);
}
```

**Piège 1 — le nouveau contrôle après le sleep.** Remarque le second `if (m_flag->requested()) break;`, juste après `QThread::msleep()`. S'il n'était pas là, une frame « de trop » pourrait être produite précisément dans la fenêtre de temps entre une demande d'arrêt et le réveil du sleep — ce n'est pas un bug catastrophique, mais c'est une discipline : chaque point où le thread reprend la main après une attente est un point où il vaut la peine de se redemander « devrais-je encore être là ? », exactement l'esprit du `while` (et non du `if`) que le Module 2 t'a enseigné pour les `QWaitCondition`.

**Piège 2 — deux conditions de terminaison indépendantes.** La boucle se termine pour deux raisons distinctes, et les deux comptent : le drapeau d'annulation (Module 4) ou l'objectif de frames atteint. Une erreur courante lorsqu'on intègre plusieurs étages est de penser qu'une seule des deux conditions suffit — mais le cas « la capture a simplement terminé son travail » n'est en rien identique au cas « l'utilisateur a interrompu le tout en cours de route » : on verra plus loin que la séquence d'arrêt correcte diffère dans les deux cas.

**Piège 3 — ce qui se passe si `produce()` renvoie `false`.** Le worker de capture ne vérifie jamais directement l'état du buffer : la valeur de retour de `produce()` lui suffit. Si quelqu'un d'autre a déjà fermé le buffer pendant que le worker était bloqué en attente d'espace libre, l'appel renvoie `false` et la boucle sort proprement. C'est le même principe d'encapsulation que le Module 2 : la logique de fermeture vit à un seul endroit, pas éparpillée entre les threads qui l'utilisent.

## Étage 2 : le buffer limité, et la contropression comme choix délibéré

**Objectif.** Découpler le rythme de capture de celui du traitement, de sorte que les deux étages puissent avancer à des vitesses différentes sans que l'un doive attendre l'autre pas à pas — mais avec une limite nette à la « distance » qui peut se creuser entre les deux.

`FrameBuffer` est, délibérément, une réécriture du même pattern de buffer partagé construit au Module 2, non pas copiée mais repensée pour transporter des `QImage` plutôt que des entiers : même `QMutex`, mêmes deux `QWaitCondition` (`m_notFull` pour le producteur, `m_notEmpty` pour les consommateurs), même boucle `while` de re-vérification, même discipline RAII avec `QMutexLocker`.

```cpp
bool FrameBuffer::consume(QImage &frameOut, int &frameNumberOut) {
    QMutexLocker locker(&m_mutex);

    while (m_queue.isEmpty() && !m_closed) {
        m_notEmpty.wait(&m_mutex);
    }

    if (m_queue.isEmpty()) return false;   // closed AND empty: really done

    Entry e = m_queue.dequeue();
    frameOut = e.frame;
    frameNumberOut = e.number;
    emit occupancyChanged(m_queue.size(), m_capacity);

    m_notFull.wakeOne();
    return true;
}
```

**Piège — la condition de retour de `consume()` n'est pas symétrique à celle de `produce()`, et c'est voulu.** Regarde bien la ligne `if (m_queue.isEmpty()) return false;` : le test porte uniquement sur la file vide, pas aussi sur `m_closed`. Cela signifie qu'une fois le buffer fermé, `consume()` **continue de renvoyer `true`** tant qu'il reste des frames en file — fermer le buffer ne jette rien de ce qui a déjà été produit. C'est une décision de conception qui mérite d'être rendue explicite : le choix inverse (tout jeter dès l'arrivée de `close()`) aurait été tout aussi facile à écrire et bien plus dangereux dans un vrai système de vision, où une frame jetée peut signifier un événement non détecté.

### Pourquoi la limite

![Backpressure: the bounded buffer fills up and the producer waits](modulo-06/26-backpressure-bounded-buffer.png)

Avec une capacité fixe et un rythme de capture plus rapide que le rythme de traitement agrégé, le buffer se remplit régulièrement pendant l'exécution du projet, et `CaptureWorker::start()` se bloque à l'intérieur de `m_buffer->produce()` en attendant de l'espace, exactement comme prévu. C'est le point sur lequel il vaut la peine de s'arrêter pour réfléchir en termes de système, et pas seulement de code : la contropression (backpressure) n'est pas un défaut de conception, c'est **l'alternative délibérée et supérieure** à une file illimitée. Avec une file qui peut croître sans limite, un producteur plus rapide que le consommateur n'attendrait jamais — mais la mémoire occupée par les frames en attente croîtrait sans limite sous charge soutenue, le délai entre « frame capturée » et « frame traitée » deviendrait arbitrairement grand et, surtout, invisible jusqu'à ce que quelque chose épuise les ressources disponibles. Un buffer limité convertit un problème latent et silencieux en un ralentissement immédiat, mesurable, et — ce qui importe le plus pour un système censé tourner 24 heures sur 24 sur du matériel embarqué — avec une limite de mémoire connue à l'avance.

Avec la capture et le buffer limité posés, le prochain article aborde la partie la plus délicate de tout le module : comment traiter les frames en parallèle avec un pool persistant, et comment arrêter correctement un pipeline dans lequel trois étages concurrents peuvent être endormis à des endroits différents au même instant.
