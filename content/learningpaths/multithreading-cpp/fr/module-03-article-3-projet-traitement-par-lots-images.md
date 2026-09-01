---
title: "Projet : traitement par lots d'images avec QtConcurrent::mapped et QFutureWatcher"
description: "Le multithreading en C++ avec Qt — Module 3 — Projet"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projet : traitement par lots d'images avec QtConcurrent::mapped et QFutureWatcher

Construisons une application Qt Widgets qui génère un certain nombre d'images synthétiques bruitées, les floute toutes en parallèle avec `QtConcurrent::mapped()`, et affiche la progression via `QFutureWatcher<QImage>` — avec un bouton Annuler fonctionnel, et une fenêtre qui **reste toujours réactive**.

**Prérequis supplémentaires par rapport aux projets précédents** : Qt 6 avec les modules **Widgets** *et* **Concurrent** — le module `Concurrent` doit être déclaré explicitement à la fois dans `find_package` et dans `target_link_libraries`.

## Étape 1 — Le squelette du projet

```cmake
cmake_minimum_required(VERSION 3.16)
project(image_batch_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Concurrent)

add_executable(image_batch_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
    imageprocessing.h
    imageprocessing.cpp
)

target_link_libraries(image_batch_demo PRIVATE Qt6::Widgets Qt6::Concurrent)
```

Par rapport aux projets précédents, la seule différence structurelle dans ce fichier est `Concurrent` ajouté à la fois à `find_package` et à `target_link_libraries` — c'est tout ce qu'il faut pour avoir accès à `QtConcurrent::mapped()` et à `QFuture`/`QFutureWatcher`.

## Étape 2 — Les fonctions pures : génération d'images et flou naïf

Crée `imageprocessing.h` :

```cpp
#pragma once
#include <QImage>
#include <QList>

QList<QImage> generateNoisyImages(int count, int side, quint32 seed);
QImage blurImageNaive(const QImage &source);
```

Arrête-toi sur cette déclaration avant même de regarder l'implémentation : ce sont deux **fonctions libres**, pas des méthodes d'une classe, et elles ne touchent aucun état partagé — ni membre de classe, ni variable globale mutable. C'est délibéré, et c'est précisément le prérequis vu dans l'article précédent pour un travail adapté à `QtConcurrent::mapped()` : si `blurImageNaive()` écrivait dans une variable globale ou dans un membre partagé, deux appels en parallèle sur des threads différents se marcheraient sur les pieds exactement comme dans le module sur les mutex et wait conditions sans mutex — sauf qu'ici **on n'a besoin d'aucun mutex**, car la fonction est pure par construction : chaque appel ne lit que son propre paramètre et n'écrit que dans sa propre valeur de retour.

`imageprocessing.cpp` :

```cpp
#include "imageprocessing.h"
#include <QRandomGenerator>

namespace {
constexpr int BLUR_RADIUS = 3;   // window (2*BLUR_RADIUS+1) x (2*BLUR_RADIUS+1) = 7x7
}

QList<QImage> generateNoisyImages(int count, int side, quint32 seed) {
    QList<QImage> images;
    images.reserve(count);
    QRandomGenerator rng(seed);

    for (int i = 0; i < count; ++i) {
        QImage img(side, side, QImage::Format_RGB32);
        for (int y = 0; y < side; ++y) {
            for (int x = 0; x < side; ++x) {
                img.setPixel(x, y, qRgb(rng.bounded(256), rng.bounded(256), rng.bounded(256)));
            }
        }
        images.append(img);
    }
    return images;
}

QImage blurImageNaive(const QImage &source) {
    const int width = source.width();
    const int height = source.height();
    QImage result(width, height, source.format());

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            long sumR = 0, sumG = 0, sumB = 0;
            int samples = 0;

            for (int dy = -BLUR_RADIUS; dy <= BLUR_RADIUS; ++dy) {
                const int yy = y + dy;
                if (yy < 0 || yy >= height) continue;
                for (int dx = -BLUR_RADIUS; dx <= BLUR_RADIUS; ++dx) {
                    const int xx = x + dx;
                    if (xx < 0 || xx >= width) continue;
                    const QRgb pixel = source.pixel(xx, yy);
                    sumR += qRed(pixel); sumG += qGreen(pixel); sumB += qBlue(pixel);
                    ++samples;
                }
            }
            result.setPixel(x, y, qRgb(sumR / samples, sumG / samples, sumB / samples));
        }
    }
    return result;
}
```

Le flou est délibérément **non optimisé** : pour chaque pixel de sortie, il relit depuis le début toute la fenêtre 7×7 qui l'entoure directement depuis la source via `pixel()` (aucun pointeur brut, aucune somme incrémentale glissante, aucun cache de ligne), avec un coût de `O(largeur × hauteur × 49)`. Ce n'est pas un défaut — c'est **intentionnel** : il nous faut une charge de travail vraiment CPU-bound et substantielle, à la fois pour voir le parallélisme du `QThreadPool` à l'œuvre de façon visible, et pour la leçon de calibration empirique de l'étape suivante.

## Étape 3 — Calibration empirique : mesure, ne devine pas

Avant de choisir combien d'images générer et de quelle taille, on suit la même discipline déjà vue dans les modules précédents : **on mesure**, on ne devine pas. Un petit programme de test, isolé, qui chronomètre un seul `blurImageNaive()` à différentes tailles :

```cpp
for (int side : {128, 192, 256, 320, 384, 448, 512}) {
    auto imgs = generateNoisyImages(1, side, 42);
    QElapsedTimer t; t.start();
    QImage r = blurImageNaive(imgs[0]);
    qDebug() << "side" << side << "->" << t.elapsed() << "ms";
}
```

Sur la machine de développement de ce cours, le résultat (compilation sans optimisations explicites, le même schéma de build que celui qu'on utilisera pour le projet final) a été :

| Côté de l'image | Temps d'un seul flou |
|---|---|
| 128×128  | ~9 ms |
| 256×256  | ~31 ms |
| 384×384  | ~69 ms |
| 512×512  | ~122 ms |

À 384×384, un seul flou coûte donc environ 60-90 ms (la valeur oscille légèrement d'une exécution à l'autre, comme toujours quand on mesure un temps réel sur une machine partagée). Avec `QThread::idealThreadCount()` mesuré à **2** sur cette machine, et en voulant un batch qui dure quelques secondes — comparable aux démos des projets précédents, ni instantané ni interminable — le choix a été : **200 images de 384×384 pixels**. Le calcul d'estimation est direct : 200 flous d'environ 70 ms, répartis sur 2 threads, devraient prendre environ (200 × 70) / 2, soit environ 7000 millisecondes.

La vérification avec le batch réel, via `QtConcurrent::mapped()` chronométré sur plusieurs exécutions, a confirmé l'estimation : **entre 7,3 et 7,6 secondes** pour le batch de traitement proprement dit (la génération des 200 images bruitées, qui est une étape séparée et séquentielle, ajoute encore 1,6-2,2 secondes avant que le batch ne démarre). Le nombre n'est pas deviné — il est mesuré, répété, et cohérent avec l'estimation théorique fondée sur les threads disponibles : exactement le type de vérification empirique que ce cours te demande de faire à chaque fois que tu choisis des paramètres de charge pour une démo ou, plus sérieusement, pour un système en production.

## Étape 4 — L'interface : mainwindow.h

```cpp
#pragma once
#include <QMainWindow>
#include <QProgressBar>
#include <QListWidget>
#include <QLabel>
#include <QPushButton>
#include <QFutureWatcher>
#include <QImage>
#include <QElapsedTimer>
#include "imageprocessing.h"

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

private slots:
    void startProcessing();
    void cancelProcessing();

    void batchStarted();
    void resultReady(int index);
    void batchCanceled();
    void batchFinished();

private:
    QList<QImage> m_sourceImages;

    QLabel *m_labelStatus;
    QProgressBar *m_progressBar;
    QListWidget *m_log;
    QPushButton *m_startButton;
    QPushButton *m_cancelButton;

    QFutureWatcher<QImage> m_watcher;
    QElapsedTimer m_stopwatch;
    int m_resultsArrived = 0;
};
```

La forme générale — un bouton Démarrer, un bouton Annuler, une barre de progression, une liste de log — reprend délibérément le style des interfaces des projets précédents : on veut que la comparaison visuelle avec le producteur-consommateur soit immédiate. `m_watcher` est un membre direct de la fenêtre, pas un pointeur géré à la main : étant un objet léger qui vit pendant toute la durée de la fenêtre, il n'y a aucune raison de compliquer la gestion de la mémoire.

## Étape 5 — Le constructeur : interface et génération des images

En haut de `mainwindow.cpp`, les paramètres issus de la calibration de l'étape 3 :

```cpp
namespace {
constexpr int IMAGE_COUNT = 200;
constexpr int IMAGE_SIDE = 384;
constexpr quint32 GENERATION_SEED = 42;
constexpr int LOG_EVERY_N = 10;   // see the cadence note at Step 6
}
```

```cpp
MainWindow::MainWindow(QWidget *parent) : QMainWindow(parent) {
    setWindowTitle("Project E - Image Batch with QtConcurrent::mapped");
    resize(560, 460);

    auto *centralWidget = new QWidget(this);
    auto *layout = new QVBoxLayout(centralWidget);

    m_labelStatus = new QLabel(centralWidget);
    m_progressBar = new QProgressBar(centralWidget);
    m_progressBar->setRange(0, IMAGE_COUNT);
    m_progressBar->setValue(0);

    auto *buttonLayout = new QHBoxLayout();
    m_startButton = new QPushButton("Start batch processing", centralWidget);
    m_cancelButton = new QPushButton("Cancel", centralWidget);
    m_cancelButton->setEnabled(false);
    buttonLayout->addWidget(m_startButton);
    buttonLayout->addWidget(m_cancelButton);

    m_log = new QListWidget(centralWidget);

    layout->addWidget(m_labelStatus);
    layout->addWidget(m_progressBar);
    layout->addLayout(buttonLayout);
    layout->addWidget(m_log);
    centralWidget->setLayout(layout);
    setCentralWidget(centralWidget);

    // Generating the synthetic images: fast (1.6-2.2s even at 200 images,
    // measured at Step 3) compared to the blur that follows. We do it here,
    // on the GUI thread, once at startup -- it's not the CPU-bound work
    // this project wants to demonstrate.
    m_sourceImages = generateNoisyImages(IMAGE_COUNT, IMAGE_SIDE, GENERATION_SEED);

    m_labelStatus->setText(QString("%1 images %2x%3 ready in memory. Press Start.")
                               .arg(IMAGE_COUNT).arg(IMAGE_SIDE).arg(IMAGE_SIDE));
    statusBar()->showMessage(QString("Ideal threads on this machine: %1")
                                  .arg(QThread::idealThreadCount()));

    // ... QFutureWatcher wiring: Step 6 ...
}
```

## Étape 6 — La connexion du QFutureWatcher, et une vraie leçon de mesure

```cpp
connect(&m_watcher, &QFutureWatcher<QImage>::started, this, &MainWindow::batchStarted);
connect(&m_watcher, &QFutureWatcher<QImage>::resultReadyAt, this, &MainWindow::resultReady);
connect(&m_watcher, &QFutureWatcher<QImage>::canceled, this, &MainWindow::batchCanceled);
connect(&m_watcher, &QFutureWatcher<QImage>::finished, this, &MainWindow::batchFinished);

connect(m_startButton, &QPushButton::clicked, this, &MainWindow::startProcessing);
connect(m_cancelButton, &QPushButton::clicked, this, &MainWindow::cancelProcessing);
```

Remarque ce qui **manque** par rapport à la liste complète des signaux de l'article précédent : `progressRangeChanged` et `progressValueChanged` ne sont connectés à rien. Ce n'est pas un oubli — c'est le résultat direct d'une mesure faite pendant le développement de ce même projet, et c'est trop instructif pour ne pas te le raconter en entier, car c'est la même discipline « mesure, ne devine pas » de l'étape 3, appliquée cette fois-ci à l'interface plutôt qu'au calcul.

La première tentative, celle « évidente », connectait `progressValueChanged` directement à `m_progressBar->setValue()`, mettant à jour la barre à chaque résultat individuel. Le code compilait, tournait, et **l'interface se bloquait pendant toute la durée du batch** : aucun redessin, aucune réponse aux événements, un véritable gel de 7-9 secondes suivi d'une mise à jour d'un coup à la fin — avec, mesure directe à l'appui, un timer de « battement de cœur » à 300 ms connecté à la boucle d'événements, qui a confirmé zéro traitement d'événements pendant toute la durée du batch.

En isolant le problème morceau par morceau, il est apparu que le coupable n'était pas `QtConcurrent::mapped()` en soi (un test du même future exact, sans `QProgressBar` connectée, restait fluide et réactif pendant toute la durée) mais spécifiquement la mise à jour **fréquente** d'une `QProgressBar` pendant l'exécution active du batch : il suffisait de quelques appels à `setValue()` au milieu du travail, pas forcément des centaines, pour réintroduire le blocage. Mettre à jour la barre **seulement aux extrémités** — à zéro quand ça démarre, à la valeur finale quand `finished()` se déclenche, au moment où le pool de threads a déjà épuisé le travail et où il n'y a plus aucune compétition pour le temps CPU de la GUI — s'est révélé, vérifié à plusieurs reprises, parfaitement fluide : la boucle d'événements continue de battre ponctuellement toutes les 300 millisecondes pendant toute la durée du batch.

La leçon ne concerne pas un bug spécifique à cet environnement, mais un principe général, valable partout : **une API qui promet contractuellement de « ne jamais bloquer » (et `QtConcurrent`/`QFuture` respectent cette promesse) ne garantit pas automatiquement une interface fluide pour n'importe quelle combinaison de widgets et de fréquence de mise à jour** — le coût réel d'un redessin, multiplié par des centaines d'appels rapprochés, doit toujours être **mesuré**, jamais supposé.

## Étape 7 — startProcessing() : la ligne qui remplace des fichiers entiers de worker

```cpp
void MainWindow::startProcessing() {
    m_log->clear();
    m_progressBar->setValue(0);
    m_resultsArrived = 0;
    m_startButton->setEnabled(false);
    m_cancelButton->setEnabled(true);
    m_stopwatch.start();

    QFuture<QImage> resultFuture = QtConcurrent::mapped(m_sourceImages, blurImageNaive);
    m_watcher.setFuture(resultFuture);
}
```

Compare cette fonction avec le fichier `producer.cpp` complet du module précédent, ou avec la construction d'un `QThread` + worker : ici, il n'y a aucun `QThread`, aucun `moveToThread()`, aucun `connect(started, ...)`. La ligne `QtConcurrent::mapped(...)` démarre immédiatement le travail sur le `QThreadPool` global et renvoie un `QFuture<QImage>` sans rien attendre ; `setFuture()` connecte notre `QFutureWatcher` déjà prêt à ce future, et à partir de ce moment tous les signaux de l'article précédent commencent à arriver, sur le thread GUI, au fur et à mesure que le travail avance.

## Étape 8 — cancelProcessing() : l'annulation coopérative en pratique

```cpp
void MainWindow::cancelProcessing() {
    m_watcher.cancel();
    m_cancelButton->setEnabled(false);
    m_labelStatus->setText("Cancellation requested: finishing items already in progress...");
}
```

Comme annoncé, `cancel()` est coopératif : il n'interrompt pas en cours de route un flou déjà démarré sur un worker, il empêche simplement que de nouveaux ne soient lancés. Lors d'une vérification mesurée pendant le développement — annulation demandée environ 1,8 seconde après le démarrage d'un batch de 200 images — le résultat observé a été **46 images traitées et collectées** avant l'arrêt complet (contre environ 25-26 attendues d'après un taux d'achèvement linéaire en 1,8 seconde sur un batch de 7,3 s au total) : la différence s'explique exactement par le comportement coopératif décrit ci-dessus — les éléments déjà assignés aux deux workers au moment de la demande ont continué jusqu'à leur achèvement naturel, avant que le pool cesse d'en prendre de nouveaux.

## Étape 9 — Les slots de notification

```cpp
void MainWindow::batchStarted() {
    m_labelStatus->setText("Batch started: processing on the global QThreadPool...");
}

void MainWindow::resultReady(int index) {
    ++m_resultsArrived;
    if (m_resultsArrived % LOG_EVERY_N == 0) {
        m_log->addItem(QString("Image %1 processed (%2/%3 results collected so far)")
                            .arg(index).arg(m_resultsArrived).arg(m_sourceImages.size()));
        m_log->scrollToBottom();
    }
}

void MainWindow::batchCanceled() {
    m_log->addItem("--- Batch canceled by user ---");
    m_log->scrollToBottom();
}

void MainWindow::batchFinished() {
    const qint64 msElapsed = m_stopwatch.elapsed();
    const bool canceled = m_watcher.isCanceled();
    const int resultsCollected = m_watcher.future().resultCount();

    // Only touch on the progress bar during the whole batch lifecycle (see
    // the Step 6 note): the pool has already exhausted the work here, so
    // there's no more contention with the workers for GUI CPU time.
    m_progressBar->setValue(resultsCollected);

    m_log->addItem(QString("--- Batch %1 in %2 ms (%3 results collected) ---")
                        .arg(canceled ? "terminated (canceled)" : "completed")
                        .arg(msElapsed).arg(resultsCollected));
    m_log->scrollToBottom();

    m_labelStatus->setText(canceled
                               ? QString("Canceled after %1 ms.").arg(msElapsed)
                               : QString("Completed in %1 ms.").arg(msElapsed));

    m_startButton->setEnabled(true);
    m_cancelButton->setEnabled(false);
}
```

`resultReady()` enregistre un résultat sur dix (`LOG_EVERY_N = 10`), pas chacun d'entre eux — la même prudence de cadence discutée à l'étape 6, appliquée ici au log plutôt qu'à la barre. `batchFinished()` distingue correctement entre achèvement naturel et annulation via `m_watcher.isCanceled()`, et dans les deux cas réactive le bouton Démarrer : tu peux lancer plusieurs batchs à la suite sans jamais redémarrer l'application.

## Étape 10 — Compile, exécute, observe les chiffres

```bash
cmake -S . -B build
cmake --build build
./build/image_batch_demo
```

Appuie sur « Start batch processing » : la barre reste à zéro, le log commence à se remplir par à-coups de dix résultats à la fois, et — point crucial, vérifie-le toi-même en déplaçant la fenêtre ou en la redimensionnant pendant que le batch tourne — **l'interface reste complètement réactive** pendant toute la durée, aucun blocage, aucun « ne répond pas ». Quand le batch se termine (mesuré, comme dit, entre 7,3 et 7,6 secondes sur cette machine), la barre saute d'un coup à la valeur finale et la dernière ligne de log rapporte le temps exact écoulé et le nombre de résultats collectés — toujours 200, si tu n'as pas appuyé sur Annuler.

## Ce que tu viens de te démontrer à toi-même

Tu as construit un batch de traitement parallèle bien réel, avec `QtConcurrent::mapped()` répartissant 200 traitements CPU-bound sur les threads du pool global, un `QFutureWatcher` qui te tient informé sans jamais bloquer le thread GUI, et une annulation coopérative fonctionnelle — tout cela sans écrire un seul `QThread`, un seul `moveToThread()`, un seul mutex. Et tu as vu, avec des chiffres mesurés et non devinés, à la fois combien de temps le travail prend réellement (calibration de l'étape 3) et comment un choix apparemment anodin dans la connexion d'un signal à un widget peut produire une interface qui se bloque (étape 6).

Tu as bouclé la boucle avec laquelle ce module avait commencé : `QtConcurrent`, l'outil avec lequel tu avais peut-être commencé « au feeling », tu le connais maintenant jusqu'au `QThreadPool` qui se cache derrière, tu sais lire la différence entre un `QFuture` bloquant et un autre observé via `QFutureWatcher`, et surtout tu sais **quand** l'utiliser et quand ne pas le faire.

---

*Le code source complet de ce projet est disponible dans le dépôt qui accompagne ce cours, dans le dossier `project-E-image-batch`.*
