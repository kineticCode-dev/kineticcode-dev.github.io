---
title: "Projet Capstone : pipeline de traitement de frames en quasi temps réel"
description: "Multithreading en C++ avec Qt — Module 6 — Projet final"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projet Capstone : pipeline de traitement de frames en quasi temps réel

Dans les articles précédents, tu as vu les quatre étages « invisibles » du pipeline capstone : capture (Module 1), buffer limité avec contropression (Module 2), pool de traitement persistant (Module 5, comparé au `QtConcurrent` du Module 3), et la séquence d'annulation coopérative complète (Module 4). Cet article boucle la boucle avec le cinquième étage — l'intégration de l'interface graphique — et parcourt le projet guidé complet : comment il est composé, comment il se compile, et ce qu'il faut observer quand on l'exécute vraiment.

## Étage 5 : la GUI, la progression, et les erreurs qui ne font rien tomber

**Objectif.** Une fenêtre qui affiche, en temps réel et sans jamais se bloquer, l'occupation du buffer (la contropression rendue visible), le compte des frames capturées/traitées, et un journal qui distingue les événements normaux des erreurs — tout en restant réactive, même sous la charge la plus soutenue que le pipeline puisse générer.

Chaque `FrameWorkerTask` émet l'un de deux signaux pour chaque frame qu'elle traite, jamais les deux :

```cpp
try {
    QImage result = processFrame(frame, frameNumber);
    emit frameProcessed(m_workerId, frameNumber, timer.elapsed());
} catch (const std::exception &e) {
    emit frameError(m_workerId, frameNumber, QString::fromStdString(e.what()));
}
```

![Per-frame errors and progress, without ever bringing the pipeline down](modulo-06/28-error-handling-progress-signals.png)

Le Projet H simule délibérément, toutes les treize frames, un « payload corrompu » — pense à une frame réellement endommagée par une erreur de transfert sur un bus réel, un scénario tout sauf hypothétique dans un système d'acquisition industriel — en levant une exception à l'intérieur de `processFrame()`. Le `try`/`catch` qui l'entoure garantit que **cette frame unique** échoue sans que le worker, le pool, ou le pipeline dans son ensemble n'en pâtissent : la boucle de `run()` continue immédiatement avec la frame suivante. C'est la même philosophie de robustesse que tu devrais adopter dans n'importe quel pipeline de production : une frame perdue ne doit jamais être une raison d'arrêter toute la chaîne, elle doit être une donnée de plus à enregistrer et, si besoin, à investiguer plus tard.

**Piège — où va le compte des erreurs.** Dans l'interface, `onFrameError()` incrémente un compteur visible séparé de celui des frames traitées avec succès, et écrit une entrée colorée en rouge dans le journal — jamais silencieusement ignorée, jamais mélangée au compte de succès dans un unique nombre qui masquerait le problème. C'est un choix minuscule dans le code mais pas dans la conception : un système qui affiche « 24 frames traitées » alors qu'en réalité 3 ont échoué silencieusement est un système qui ment, d'une façon particulièrement dangereuse car l'opérateur n'a aucune raison d'en douter.

**Pourquoi tout cela est sûr sans un seul mutex dans la GUI.** Chaque signal émis par `CaptureWorker` ou par une `FrameWorkerTask` — qui vivent, respectivement, sur le thread de capture et sur un thread du pool — arrive à un slot de `MainWindow`, qui vit sur le thread GUI. Qt compare l'affinité de thread de l'émetteur et du destinataire au moment de l'émission et choisit automatiquement une connexion en file (queued) (Module 4) : l'événement est mis en file dans la boucle d'événements du thread GUI et traité là, un à la fois, sans jamais une écriture concurrente sur les widgets. C'est le même principe que le Module 1 t'a montré avec un seul worker, vérifié aujourd'hui avec quatre threads sources ou plus qui convergent tous vers le même thread de destination sans une seule ligne de code de synchronisation manuelle écrite par toi — à condition de ne jamais forcer une connexion `Direct` entre threads différents.

## Configuration et prérequis

- Compilateur C++17 (vérifié avec GCC 13.3 sous Linux).
- CMake ≥ 3.16.
- Qt 6, composants **Widgets** et **Concurrent** (ce dernier ne sert que pour `QtConcurrent::run()` utilisé dans la séquence d'arrêt asynchrone — pas pour le traitement des frames, qui reste sur `QThreadPool` pur).
- Aucune bibliothèque de vision externe : le filtre de détection de contours est implémenté à partir de zéro sur les données brutes d'une `QImage` en niveaux de gris.

```bash
cd project-H-vision-pipeline-capstone
cmake -S . -B build
cmake --build build
./build/vision_pipeline_capstone
```

## La structure des fichiers

Six fichiers source plus l'en-tête partagé du drapeau d'annulation :

- `pipelinestate.h` — `CancellationFlag`, un mince wrapper autour de `std::atomic<bool>` avec `requestStop()`/`requested()`/`reset()`.
- `framebuffer.h/.cpp` — l'Étage 2 : la file limitée de `QImage`.
- `captureworker.h/.cpp` — l'Étage 1 : génération des frames synthétiques.
- `frameworkertask.h/.cpp` — l'Étage 3 : le filtre Sobel et la boucle persistante sur le pool.
- `mainwindow.h/.cpp` — les Étages 4 et 5 : orchestration, séquence d'arrêt, widgets.
- `main.cpp` — onze lignes, aucune surprise : crée `QApplication`, crée `MainWindow`, appelle `exec()`.

Dans l'interface, tu trouves deux contrôles numériques — nombre de frames à acquérir et nombre de workers parallèles — pensés exprès pour que tu puisses reproduire toi-même l'expérience de la contropression : abaisse le nombre de workers à 1 et observe le buffer se remplir plus rapidement et rester plein plus longtemps ; monte-le à 4 et observe la contropression presque disparaître.

## Calibration empirique : mesure, ne devine pas

Le cours t'a répété la même discipline dans chaque module — mesurer avant de fixer une constante, ne pas la caler à l'intuition — et ce projet ne fait pas exception. Avant de fixer les chiffres finaux, le coût réel d'une seule passe du filtre Sobel sur une frame synthétique, mesuré isolément :

| Taille de frame | 1 passe | 3 passes | 5 passes |
|---|---|---|---|
| 128×96 | 0,05 ms | 0,15 ms | 0,25 ms |
| 256×192 | 0,20 ms | 0,65 ms | 1,25 ms |
| 1536×1152 | — | 28,8 ms | — |

Le fait intéressant est de constater à quel point un filtre Sobel écrit de manière directe est *rapide* sur une frame de taille réaliste pour un capteur bon marché : même à 1536×1152 (plus de 1,7 mégapixel), trois passes coûtent moins de 30 millisecondes. Un véritable système de vision, cependant, s'arrête rarement à la seule détection de contours : extraction de caractéristiques, classification, suivi ont un coût que nous n'implémentons pas ici (cela dépasserait le cadre d'un cours sur la concurrence), mais qu'il est honnête de simuler explicitement, dans le même esprit que le Consommateur du Module 2 utilisait `QThread::msleep()` pour représenter un temps de traitement réaliste. Le Projet H utilise des frames en 256×192, trois passes Sobel réelles (~0,65 ms, un travail CPU-bound authentique et mesuré) plus une attente explicite de 350-450 ms pour représenter les étages suivants non implémentés.

Avec ces chiffres, et un intervalle de capture de 90 ms/frame, la production (≈11 frames/s) dépasse durablement la capacité de traitement agrégée de deux workers (≈2 frames toutes les ~400 ms ≈ 5 frames/s) : la contropression prévue par la théorie se manifeste ponctuellement, vérifiée expérimentalement, pas seulement sur le papier.

## Vérification d'exécution

Compilé avec g++ 13.3 sous Qt 6.4.2, exécuté en mode headless (`QT_QPA_PLATFORM=offscreen`) avec une copie instrumentée temporaire pour piloter l'interface sans écran réel :

- **Achèvement naturel** (24 frames cible, 2 workers) : 24 capturées, 23 traitées avec succès, 1 échouée (la frame corrompue simulée n°13, comme attendu — une erreur toutes les 13 frames). Occupation maximale du buffer observée : 5/5 — contropression confirmée visuellement. Aucune frame perdue : `23 + 1 = 24`. Arrêt complet en environ 5 secondes depuis le démarrage, aucun blocage, aucun crash, code de sortie 0.
- **Arrêt anticipé** (Stop appuyé à 900 ms du démarrage, buffer déjà saturé) : 9 frames capturées, 5 traitées avant l'arrêt — le reste abandonné par conception (arrêt réactif). Aucun blocage, aucun crash, buffer jamais observé au-delà de la capacité configurée.
- **Double cycle** (démarrage → arrêt naturel → redémarrage → arrêt naturel) : comportement identique et déterministe sur les deux cycles, aucune fuite de ressources observable, aucun état résiduel entre un cycle et l'autre — le pipeline est redémarrable en toute sécurité depuis la même fenêtre.

Dans aucune des exécutions n'est apparu d'avertissement (warning) runtime de Qt.

## Où aller à partir d'ici

Le Projet H est, délibérément, un système jouet qui se comporte comme un système réel — et la distance entre les deux est plus courte qu'il n'y paraît. Quelques pistes concrètes pour aller plus loin :

**Remplacer la capture simulée par une source réelle.** `CaptureWorker::generateSyntheticFrame()` est le seul point du programme qui « fait semblant » : remplace-le par un appel à une véritable bibliothèque d'acquisition — un frame grabber industriel, une GenICam, ou même simplement une webcam via `QCamera` — et le reste du pipeline, buffer, pool, annulation, GUI, ne nécessite aucune modification. C'est la preuve concrète que découpler les étages avec une interface nette paie exactement à ce moment-là.

**Intégrer OpenCV à la place du Sobel écrit à la main.** Le filtre écrit de zéro dans ce module a un but pédagogique, mais en production tu utiliserais quasiment certainement `cv::Sobel` ou équivalent, souvent vectorisé et multi-thread en interne. Attention à un détail non trivial dans ce cas : si la bibliothèque de vision que tu utilises a déjà son propre parallélisme interne, l'additionner naïvement au parallélisme de ton `QThreadPool` peut produire plus de threads que tu n'as de cœurs — un cas concret de la leçon sur le coût des changements de contexte du Module 0, ici appliquée à l'échelle du système.

**Recalibrer la taille du pool sur le matériel réel.** En production, tu voudrais probablement partir de `QThread::idealThreadCount()` puis mesurer — la même discipline de calibration empirique que dans ce chapitre, appliquée au nombre de workers plutôt qu'au temps de traitement, peut-être avec un petit benchmark qui reprend l'esprit du Projet G du Module 5.

**Profiler sous charge soutenue, pas seulement dans une démo de quelques secondes.** Un test de 24 frames en cinq secondes démontre la justesse de la conception, pas sa tenue sous des heures de fonctionnement continu. ThreadSanitizer, en particulier, mérite d'être relancé sur ce projet étendu, et un profilage de longue durée est le seul moyen honnête de savoir si la capacité du buffer et la taille du pool tiennent réellement la charge réelle.

## Conclusions du module — et du cours

Il y a six modules, le problème était un bouton qui bloquait une fenêtre. Aujourd'hui, tu as construit, vérifié par des mesures réelles et pas seulement par intuition, un système à cinq étages avec trois catégories de threads actives simultanément — un worker persistant, un pool dynamique, le thread GUI — coordonnées par un buffer limité et par une séquence d'arrêt qui ne laisse jamais rien en suspens, même dans le cas le plus insidieux où un étage est endormi dans une wait condition précisément au moment où on lui demande de s'arrêter. Ce n'est pas un exercice de manuel : c'est, sur le fond architectural, le même type de système que tu rencontreras dans le travail sur des systèmes de vision industriels.

Ce qu'on retire de ce parcours n'est pas la syntaxe de `QThread` ou de `QMutex` — cela se retrouve dans n'importe quelle documentation en trente secondes. C'est le modèle mental qui permet, face à un nouveau système concurrent, de savoir poser les bonnes questions dans le bon ordre : quelles données sont réellement partagées, et par qui ; quel est l'ordre d'extinction qui ne laisse personne endormi pour toujours ; où l'interface risque de se bloquer, et comment déplacer ce risque vers un thread qui n'en paie pas le prix. Le reste — la classe précise, le nom exact de la méthode — est un détail qu'on regarde quand on en a besoin, pas une théorie à apprendre par cœur.

---

*Le code source complet de ce projet est disponible dans le dépôt qui accompagne ce cours, dans le dossier `project-H-vision-pipeline-capstone`.*
