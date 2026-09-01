---
title: "Projet : cycle de vie complet d'un worker — démarrer, mettre en pause, reprendre, arrêter"
description: "Le multithreading en C++ avec Qt — Module 4 — Projet"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projet : cycle de vie complet d'un worker — démarrer, mettre en pause, reprendre, arrêter

Construisons une application Qt Widgets avec un worker persistant — le même pattern `moveToThread()` que tu connais depuis le Module 1 — qui exécute un traitement par étapes (200 étapes, chacune avec un petit calcul CPU-bound suivi d'une courte pause configurable), pilotable avec quatre commandes depuis la fenêtre : **Start**, **Pause**, **Resume**, **Stop**. En plus de cela, deux contrôles dédiés démontrent `QMetaObject::invokeMethod` dans ses deux variantes principales : l'une pour changer à chaud la vitesse d'exécution, l'autre pour interroger de manière synchrone l'étape courante.

**Prérequis** : Qt 6 avec le composant **Widgets**, aucune dépendance supplémentaire par rapport aux modules précédents.

## Étape 1 — Le squelette du projet

```cmake
cmake_minimum_required(VERSION 3.16)
project(worker_lifecycle_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets)

add_executable(worker_lifecycle_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
    cyclicworker.h
    cyclicworker.cpp
)

target_link_libraries(worker_lifecycle_demo PRIVATE Qt6::Widgets)
```

Aucune surprise ici : c'est la même forme que d'habitude. La substance du jour se trouve entièrement dans l'architecture interne de `CyclicWorker`.

## Étape 2 — Le worker : la déclaration, et une distinction qui compte plus que toute autre ligne de ce projet

```cpp
#pragma once

#include <QObject>
#include <QMutex>
#include <QWaitCondition>
#include <QString>
#include <atomic>

class CyclicWorker : public QObject {
    Q_OBJECT

public:
    explicit CyclicWorker(QObject *parent = nullptr);

    Q_INVOKABLE void setInterval(int milliseconds);
    Q_INVOKABLE int currentStep() const;

    int totalSteps() const { return TOTAL_STEPS; }

    // NOT slots, on purpose.
    void pause();
    void resume();
    void stop();

public slots:
    void start();

signals:
    void progress(int step, int totalSteps);
    void stateChanged(const QString &state);
    void finished();

private:
    static constexpr int TOTAL_STEPS = 200;

    mutable QMutex m_mutex;
    QWaitCondition m_pauseCondition;

    bool m_paused = false;
    int m_currentStep = 0;
    int m_intervalMs = 40;

    std::atomic<bool> m_stop{false};
};
```

Arrête-toi sur la division entre `pause()`/`resume()`/`stop()`, déclarées comme des méthodes publiques ordinaires, et `start()`, la seule déclarée `public slots`. Ce n'est pas un caprice stylistique : c'est la leçon la plus importante de tout ce projet, et pour bien te la raconter, je dois d'abord te montrer l'erreur que j'ai commise en le construisant.

### La version erronée que j'ai écrite en premier (et le deadlock qui s'en est suivi)

Ma première ébauche reliait pause, reprise et arrêt exactement comme tu t'y attendrais depuis les Modules 1 et 2 — trois signaux dans la fenêtre, reliés via `connect()` à trois slots du worker :

```cpp
//--- WRONG VERSION, do not use it ---
connect(this, &MainWindow::requestPause, m_worker, &CyclicWorker::pause);
connect(this, &MainWindow::requestResume, m_worker, &CyclicWorker::resume);
connect(this, &MainWindow::requestStop, m_worker, &CyclicWorker::stop);
```

Ça compilait sans erreur. Ça exécutait la séquence Start → Pause → Resume sans problème apparent. Mais au moment où mon test automatisé appuyait sur « Pause » puis, avec le worker encore endormi, appuyait sur « Stop », l'application entière se bloquait pour toujours — aucun crash, aucun message, simplement figée, exactement le symptôme silencieux d'un deadlock que le Module 2 t'a appris à reconnaître.

La cause, une fois trouvée, est éclatante — et c'est un corollaire direct des deux articles précédents de ce module mis ensemble : pendant que le worker est en pause, sa `start()` est bloquée à l'intérieur de `m_pauseCondition.wait(&m_mutex)`. Cet appel **n'est pas un tour de boucle d'événements** : c'est un blocage au niveau du système d'exploitation, le thread est littéralement suspendu là, il n'exécute pas `exec()`, il ne traite aucune file d'événements. Un signal `requestStop()` connecté avec une `QueuedConnection` (automatique, car l'émetteur et le destinataire sont sur des threads différents) dépose fidèlement son événement dans la file du worker — mais personne ne viendra jamais le lire, car le thread qui devrait le faire est arrêté à l'intérieur d'un `wait()` que personne, à son tour, ne réveille. C'est exactement la même famille de problème que le piège de `deleteLater()` que tu as vu au Module 1 : un événement déposé dans une file que personne ne traitera jamais, parce que son thread propriétaire ne tourne pas.

### La correction : des appels directs, comme pour le buffer partagé du Module 2

La solution, avec le recul, était déjà écrite dans le Module 2, seulement je ne l'avais pas reconnue comme applicable ici aussi. Tu te souviens des méthodes de production, de consommation et de fermeture du buffer partagé ? Ce n'étaient pas des slots : c'étaient des méthodes publiques ordinaires, appelées **directement** depuis des threads différents, sûres non pas parce qu'elles passaient par la méta-machine des signaux et slots, mais parce que chaque ligne qu'elles touchaient était déjà protégée par son propre `QMutex` interne. Exactement la même logique s'applique à `pause()`, `resume()` et `stop()` d'aujourd'hui : elles sont sûres à appeler directement depuis le thread GUI, sur un objet qui vit sur un autre thread, parce que la seule chose qu'elles touchent est protégée par `m_mutex` ou atomique (`m_stop`) — elles n'ont pas besoin de la boucle d'événements du worker pour s'exécuter en sécurité, et c'est justement pour cela qu'**elles fonctionnent même quand cette boucle d'événements ne tourne pas**, comme pendant la pause.

`start()`, au contraire, doit rester un slot atteint via `connect()` — car contrairement à pause/resume/stop, elle **doit vraiment s'exécuter sur le thread géré par le QThread**, pas sur celui de l'appelant : c'est l'intégralité du corps du travail du worker, pas seulement un changement de drapeau. Un appel direct à `m_worker->start()` depuis le thread GUI exécuterait la totalité du cycle de 200 étapes **sur le thread GUI lui-même** — exactement le gel que le Module 1 t'a appris à soigner dès le premier jour.

## Étape 3 — Le worker : start(), pause(), resume(), stop()

```cpp
#include "cyclicworker.h"

#include <QThread>
#include <QCoreApplication>
#include <algorithm>

CyclicWorker::CyclicWorker(QObject *parent) : QObject(parent) {}

void CyclicWorker::start() {
    emit stateChanged("Running");

    for (int step = 1; step <= TOTAL_STEPS; ++step) {
        if (m_stop.load()) break;

        {
            QMutexLocker locker(&m_mutex);
            while (m_paused && !m_stop.load()) {
                m_pauseCondition.wait(&m_mutex);
            }
        }
        if (m_stop.load()) break;

        volatile long long accumulator = 0;
        for (int i = 0; i < 200000; ++i) {
            accumulator += i % 7;
        }

        int waitMs;
        {
            QMutexLocker locker(&m_mutex);
            m_currentStep = step;
            waitMs = m_intervalMs;
        }

        emit progress(step, TOTAL_STEPS);
        QThread::msleep(static_cast<unsigned long>(waitMs));

        QCoreApplication::processEvents();
    }

    emit stateChanged(m_stop.load() ? "Stopped" : "Completed");
    emit finished();
}

void CyclicWorker::pause() {
    {
        QMutexLocker locker(&m_mutex);
        m_paused = true;
    }
    emit stateChanged("Paused");
}

void CyclicWorker::resume() {
    {
        QMutexLocker locker(&m_mutex);
        m_paused = false;
    }
    m_pauseCondition.wakeOne();
    emit stateChanged("Running");
}

void CyclicWorker::stop() {
    m_stop.store(true);

    // If the worker is asleep while paused, m_stop alone is not enough:
    // it must be woken up, otherwise it will never re-check the flag.
    // Same discipline as the shared buffer's close() in Module 2.
    {
        QMutexLocker locker(&m_mutex);
        m_paused = false;
    }
    m_pauseCondition.wakeAll();
}
```

Le corps de la boucle devrait déjà t'être familier : le contrôle du drapeau d'arrêt en haut, le bloc de pause avec `while` et `wait()`, un petit calcul CPU-bound qui représente le « vrai travail » de chaque étape, et l'émission de la progression. La dernière ligne, `QCoreApplication::processEvents()`, on l'explique tout de suite dans l'étape suivante.

Regarde `stop()` avec attention, car c'est l'application directe de la leçon du Module 2 au problème d'aujourd'hui : écrire seulement `m_stop.store(true)` résoudrait le cas où le worker est **actif**, à l'intérieur de sa propre boucle de travail — au prochain contrôle du drapeau, il sortirait proprement. Mais si le worker est à ce moment-là **endormi dans `wait()`** parce qu'il est en pause, cette seule écriture ne l'atteint pas : il continuerait à dormir pour toujours, car personne ne l'a réveillé pour qu'il revérifie quoi que ce soit, drapeau d'arrêt compris. `stop()` ne se limite donc pas à écrire le drapeau : elle force aussi `m_paused` à `false` et appelle `wakeAll()` — réveillant quiconque était en attente, qui à ce moment-là revérifiera la condition de son propre `while`, verra `m_stop` à `true`, et sortira proprement de la boucle d'attente avant même de rentrer dans le corps du travail.

## Étape 4 — setInterval() et currentStep() : la démo d'invokeMethod, et pourquoi processEvents() est nécessaire

```cpp
void CyclicWorker::setInterval(int milliseconds) {
    QMutexLocker locker(&m_mutex);
    m_intervalMs = std::clamp(milliseconds, 0, 2000);
}

int CyclicWorker::currentStep() const {
    QMutexLocker locker(&m_mutex);
    return m_currentStep;
}
```

Rien de surprenant dans l'implémentation : deux méthodes `Q_INVOKABLE`, protégées par le même mutex que le reste de l'état. Le point intéressant est dans **comment** la fenêtre les appellera dans un instant — avec `QMetaObject::invokeMethod`, pas avec un `connect()`. Et cela nous ramène à cette ligne isolée à la fin de la boucle de `start()`, `QCoreApplication::processEvents()`.

Aussi bien `Qt::QueuedConnection` que `Qt::BlockingQueuedConnection` pour `invokeMethod` fonctionnent en déposant un événement dans la file du thread destinataire, et cet événement n'est exécuté que lorsque la boucle d'événements de ce thread arrive à le traiter. Mais `start()` est **elle-même** un unique et long slot qui occupe le thread du worker du début à la fin de la boucle — pendant qu'elle tourne, ce thread **n'exécute pas `exec()`** au sens où tu l'entends habituellement : il exécute le corps de `start()`, qui a elle-même été invoquée *par* un événement traité par la boucle d'événements. Tant que `start()` ne retourne pas, la boucle d'événements du worker ne revient pas à son propre cycle de réception — ce qui signifie que tout nouvel événement arrivant entre-temps (un appel `invokeMethod` vers `setInterval()` ou `currentStep()`, par exemple) resterait en file, non traité, jusqu'à la fin des 200 étapes. Pour une `Qt::QueuedConnection`, ce ne serait qu'un retard gênant ; pour une `Qt::BlockingQueuedConnection`, ce serait un **blocage de la GUI pendant toute la durée du cycle** — exactement le type de gel que ce cours entier t'a appris à éviter, mais cette fois causé non pas par un calcul lourd directement sur la GUI, mais par un détail plus subtil sur la boucle d'événements du worker.

`QCoreApplication::processEvents()`, appelée une fois par étape, est le remède : elle « pompe » manuellement la file d'événements du thread courant, donnant une fenêtre d'opportunité à tout événement en attente — y compris les `invokeMethod` vers cet objet même — d'être traité avant de passer à l'étape suivante. C'est une technique documentée et légitime pour les slots longs qui doivent rester partiellement réactifs, mais il vaut la peine d'être honnête sur ses limites : **elle n'aide absolument pas pendant la pause**. À l'intérieur de `wait()`, le thread est bloqué au niveau du système d'exploitation, il n'exécute aucun code Qt — il n'y a aucun point où `processEvents()` pourrait être appelée, car le contrôle n'est pas entre les mains de ton code à cet instant. Et c'est précisément pour cette raison — pas par symétrie stylistique — que `pause()`, `resume()` et `stop()` restent des appels directs : ce sont le seul mécanisme qui atteint le worker dans **chacun** de ses états, pause comprise, tandis que `invokeMethod` vers ce worker ne fonctionne que parce que nous avons délibérément ouvert une fenêtre pour lui à l'intérieur de la boucle active.

## Étape 5 — L'en-tête de la fenêtre

```cpp
#pragma once

#include <QMainWindow>
#include <QLabel>
#include <QPushButton>
#include <QProgressBar>
#include <QListWidget>
#include <QSpinBox>
#include <QThread>

#include "cyclicworker.h"

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow() override;

signals:
    void requestStart();

private slots:
    void onStartClicked();
    void onPauseClicked();
    void onResumeClicked();
    void onStopClicked();
    void onApplySpeedClicked();
    void onQueryProgressClicked();

    void updateProgress(int step, int totalSteps);
    void updateState(const QString &state);
    void onFinished();

private:
    void log(const QString &message);

    QLabel *m_stateLabel;
    QProgressBar *m_progressBar;
    QPushButton *m_startButton;
    QPushButton *m_pauseButton;
    QPushButton *m_resumeButton;
    QPushButton *m_stopButton;
    QSpinBox *m_speedSpinBox;
    QPushButton *m_applySpeedButton;
    QPushButton *m_queryButton;
    QLabel *m_queryResultLabel;
    QListWidget *m_log;

    QThread *m_thread;
    CyclicWorker *m_worker;
};
```

Remarque qu'il n'y a qu'un seul signal, `requestStart()` — cohérent avec tout ce que tu viens de voir à l'Étape 2 : c'est la seule commande qui a vraiment besoin de passer par la boucle d'événements, car c'est la seule qui doit faire exécuter du code **sur le thread du worker** plutôt que de simplement modifier son état interne.

## Étape 6 — Le constructeur : mettre en place le worker, sans le démarrer tout de suite

```cpp
    m_thread = new QThread(this);
    m_worker = new CyclicWorker();   // NO parent: moveToThread() requires it
    m_worker->moveToThread(m_thread);

    connect(this, &MainWindow::requestStart, m_worker, &CyclicWorker::start);

    connect(m_worker, &CyclicWorker::progress, this, &MainWindow::updateProgress);
    connect(m_worker, &CyclicWorker::stateChanged, this, &MainWindow::updateState);
    connect(m_worker, &CyclicWorker::finished, this, &MainWindow::onFinished);

    connect(m_startButton, &QPushButton::clicked, this, &MainWindow::onStartClicked);
    connect(m_pauseButton, &QPushButton::clicked, this, &MainWindow::onPauseClicked);
    connect(m_resumeButton, &QPushButton::clicked, this, &MainWindow::onResumeClicked);
    connect(m_stopButton, &QPushButton::clicked, this, &MainWindow::onStopClicked);
    connect(m_applySpeedButton, &QPushButton::clicked, this, &MainWindow::onApplySpeedClicked);
    connect(m_queryButton, &QPushButton::clicked, this, &MainWindow::onQueryProgressClicked);

    m_thread->start();
```

Remarque une différence délibérée par rapport aux Modules 1 et 2 : ici nous **ne** relions **pas** `QThread::started` directement à `start()`. Le worker, une fois le thread démarré, reste inactif — sa boucle d'événements est déjà active et prête à recevoir des commandes (y compris les appels directs à `pause()`/`resume()`/`stop()`, qui comme tu le sais n'en ont même pas besoin) — jusqu'à ce que l'utilisateur appuie réellement sur le bouton « Start ». C'est l'état « Idle » du diagramme ci-dessous, celui avant tout travail.

## Étape 7 — Les slots de la fenêtre, y compris les deux démonstrations d'invokeMethod

```cpp
void MainWindow::onStartClicked() {
    m_startButton->setEnabled(false);
    m_pauseButton->setEnabled(true);
    m_stopButton->setEnabled(true);
    m_progressBar->setValue(0);
    emit requestStart();
}

void MainWindow::onPauseClicked() {
    m_pauseButton->setEnabled(false);
    m_resumeButton->setEnabled(true);
    m_worker->pause();       // direct call
}

void MainWindow::onResumeClicked() {
    m_resumeButton->setEnabled(false);
    m_pauseButton->setEnabled(true);
    m_worker->resume();      // direct call
}

void MainWindow::onStopClicked() {
    m_pauseButton->setEnabled(false);
    m_resumeButton->setEnabled(false);
    m_stopButton->setEnabled(false);
    m_worker->stop();        // direct call, works even if the worker is paused
}
```

Et enfin les deux démonstrations promises depuis l'introduction du module :

```cpp
void MainWindow::onApplySpeedClicked() {
    int value = m_speedSpinBox->value();
    QMetaObject::invokeMethod(m_worker, "setInterval", Qt::QueuedConnection,
                               Q_ARG(int, value));
}

void MainWindow::onQueryProgressClicked() {
    int value = -1;
    QMetaObject::invokeMethod(m_worker, "currentStep", Qt::BlockingQueuedConnection,
                               Q_RETURN_ARG(int, value));
    m_queryResultLabel->setText(
        QString("current step: %1 / %2").arg(value).arg(m_worker->totalSteps()));
}
```

Le premier est fire-and-forget : le thread GUI poste la commande et poursuit immédiatement, sans attendre de confirmation — parfait pour un changement de configuration qui n'a pas besoin d'être synchrone. Le second, en revanche, utilise `Qt::BlockingQueuedConnection` avec `Q_RETURN_ARG` : le thread GUI s'arrête réellement jusqu'à ce que `currentStep()` ait exécuté sur le thread du worker et ait renvoyé une valeur — que nous pouvons donc afficher immédiatement dans l'étiquette, avec la certitude qu'il s'agit de la vraie donnée de cet instant, pas d'une valeur périmée. Les deux fonctionnent sans gel perceptible de la GUI grâce au `QCoreApplication::processEvents()` inséré dans la boucle de `start()` à l'Étape 4, qui donne au worker, entre chaque étape, l'occasion de traiter précisément ces deux commandes.

## Étape 8 — Le destructeur : la même discipline que le Module 2, appliquée ici

```cpp
MainWindow::~MainWindow() {
    m_worker->stop();   // direct call: reaches the worker even while paused

    m_thread->quit();
    m_thread->wait();

    delete m_worker;
}
```

Trois lignes, mais chacune accomplit un travail précis, et c'est le même ordre déjà vu dans le projet guidé du Module 2 : d'abord nous nous assurons que le worker ne puisse jamais rester endormi en attente (`stop()`, qui comme tu le sais force `m_paused` à `false` et appelle `wakeAll()` avant même d'écrire complètement le drapeau d'arrêt), **puis** nous demandons au thread de s'arrêter avec `quit()`, **puis** nous attendons avec `wait()` qu'il l'ait vraiment fait. Si tu inversais l'ordre — `quit()` avant `stop()` — et que le worker était à ce moment-là endormi en pause, le thread n'aurait jamais l'occasion de sortir de sa propre boucle pour atteindre le point où la demande de `quit()` est effectivement honorée, et `wait()` bloquerait la fermeture de la fenêtre pour toujours.

## Étape 9 — Compile, exécute, et observe le cycle de vie complet

```bash
cmake -S . -B build
cmake --build build
./build/worker_lifecycle_demo
```

Appuie sur « Start » : la barre de progression commence à avancer, une étape à la fois, et l'étiquette d'état affiche « Running ». Appuie sur « Pause » à mi-parcours : l'avancement s'arrête immédiatement, l'étiquette passe à « Paused » — et si tu observes l'utilisation CPU du processus pendant qu'il est en pause, tu la verras descendre presque à zéro, la preuve directe que le worker dort à l'intérieur de `wait()` au lieu de revérifier le drapeau dans une boucle active qui gaspillerait un cœur entier à ne rien faire. Appuie sur « Resume » : l'avancement continue exactement là où il s'était arrêté. Essaie aussi les deux contrôles d'`invokeMethod` : change l'intervalle avec le spin box et appuie sur « Appliquer » pendant que le worker s'exécute — tu verras la vitesse d'avancement de la barre changer dès l'étape suivante, preuve que la commande est bien arrivée ; appuie sur « Interroger l'étape » et observe que l'étiquette se met à jour immédiatement avec l'étape exacte, lue de manière synchrone depuis le thread du worker. Enfin, appuie sur « Stop » — essaie de le faire aussi bien pendant que le worker s'exécute que pendant qu'il est en pause, pour voir de tes propres yeux que dans les deux cas la fermeture est propre et immédiate, jamais un blocage. Ferme la fenêtre : l'application se termine à l'instant, quel qu'ait été l'état du worker à ce moment-là.

![Worker lifecycle diagram: which command triggers each transition, and how it reaches the worker](modulo-04/20-worker-lifecycle-start-pause-stop.png)

Le diagramme résume tout le parcours que tu viens de construire : chaque transition est déclenchée par un clic sur la GUI, mais le mécanisme par lequel elle atteint le worker change selon ce qui est nécessaire — un signal queued pour `start()` (qui doit s'exécuter sur le bon thread), des appels directs pour pause/reprise/arrêt (qui doivent fonctionner même quand la boucle d'événements du worker ne tourne pas).

## Ce que tu viens de te démontrer à toi-même

Tu as construit un worker avec un cycle de vie complet et contrôlable — pas seulement « démarre et se termine tout seul » comme dans les modules précédents, mais démarrable, mettable en pause, reprenable et arrêtable sur demande, dans n'importe quelle combinaison, sans jamais un blocage. Tu as vu, avec un vrai deadlock reproduit puis résolu, pourquoi le choix entre « connexion queued » et « appel direct » n'est pas une question de style mais dépend d'un fait précis : si le thread destinataire a, à ce moment-là, sa propre boucle d'événements libre de tourner ou non. Tu as utilisé `QMetaObject::invokeMethod` dans ses deux variantes principales, en comprenant pourquoi la variante bloquante aurait pu geler ta GUI si tu n'avais pas compris — et résolu — la raison pour laquelle un unique slot long peut affamer la boucle d'événements de son propre thread.

Ce n'est pas un hasard si le deadlock raconté dans cet article est né précisément au point de rencontre entre deux concepts qui semblaient déjà acquis — la queued connection du Module 1, la wait condition du Module 2 — appliqués ensemble dans un contexte nouveau : c'est presque toujours là, à l'intersection entre deux outils que tu connais bien individuellement, que se nichent les bugs les plus instructifs.

---

*Le code source complet de ce projet est disponible dans le dépôt qui accompagne ce cours, dans le dossier `project-F-worker-lifecycle`.*
