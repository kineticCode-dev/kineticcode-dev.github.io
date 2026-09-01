---
title: "Projet : soigner le freeze pour de bon, en déplaçant le calcul sur un worker thread"
description: "Multithreading en C++ avec Qt — Module 1 — Projet"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projet : soigner le freeze pour de bon, en déplaçant le calcul sur un worker thread

Reprenons exactement le projet du freeze du module précédent. Même fenêtre, même battement, même calcul de nombres premiers identique — seul change *où* il s'exécute. Si tu as encore ouvert le dossier de travail de ce projet, tu peux repartir de là ; sinon, crée un nouveau dossier et suis les étapes depuis zéro : cela reste de toute façon quelques minutes de travail.

## Étape 1 — Le squelette du projet

`CMakeLists.txt`, identique dans sa forme à celui du projet précédent (aucune surprise : nous ne changeons pas le système de build, seulement l'architecture interne du programme) :

```cmake
cmake_minimum_required(VERSION 3.16)
project(worker_thread_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets)

add_executable(worker_thread_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
    primecalculator.h
    primecalculator.cpp
)

target_link_libraries(worker_thread_demo PRIVATE Qt6::Widgets)
```

La seule nouveauté est que le calcul lourd vit maintenant dans son propre fichier séparé — `primecalculator.h`/`.cpp` — plutôt qu'à l'intérieur de `MainWindow`. Ce n'est pas un caprice stylistique : c'est la conséquence directe de ce que nous avons vu dans les articles précédents. Le worker doit être une classe à part, distincte de `MainWindow`, précisément parce que c'est elle (et elle seule) que nous allons déplacer sur un autre thread.

## Étape 2 — Le worker : logique pure, aucune idée de « thread » en son sein

Crée `primecalculator.h` :

```cpp
#pragma once
#include <QObject>

class PrimeCalculator : public QObject {
    Q_OBJECT

public:
    explicit PrimeCalculator(QObject *parent = nullptr);

    void setLimit(long long limit);

public slots:
    void start();

signals:
    void progress(int percentage);
    void finished(long long primesFound, qint64 msElapsed);

private:
    long long m_limit = 4'000'000;
};
```

Arrête-toi un instant sur `setLimit()` : ce **n'est pas** un slot, c'est une méthode publique ordinaire. La raison, nous l'avons vue dans l'article précédent : nous l'appellerons depuis le thread GUI, mais **avant** de démarrer le thread géré — à ce moment précis, il n'y a encore aucune concurrence en cours (le worker n'exécute rien sur aucun thread), donc régler directement une variable membre est tout à fait sûr. Si tu l'appelais *après* avoir démarré le thread, en revanche, tu écrirais `m_limit` depuis un thread pendant que `start()` la lit potentiellement depuis un autre — de nouveau, exactement la data race que tu reconnais désormais par cœur.

Maintenant `primecalculator.cpp` — le corps du calcul est exactement le même algorithme que dans le projet précédent, avec l'ajout d'un signal de progression périodique :

```cpp
#include "primecalculator.h"
#include <QElapsedTimer>

PrimeCalculator::PrimeCalculator(QObject *parent) : QObject(parent) {}

void PrimeCalculator::setLimit(long long limit) {
    m_limit = limit;
}

void PrimeCalculator::start() {
    QElapsedTimer stopwatch;
    stopwatch.start();

    long long count = 0;
    long long nextProgressThreshold = m_limit / 20; // one update every 5%

    for (long long n = 2; n < m_limit; ++n) {
        bool isPrime = true;
        for (long long d = 2; d * d <= n; ++d) {
            if (n % d == 0) { isPrime = false; break; }
        }
        if (isPrime) ++count;

        if (n >= nextProgressThreshold) {
            int percentage = static_cast<int>((n * 100) / m_limit);
            emit progress(percentage);
            nextProgressThreshold += m_limit / 20;
        }
    }

    emit finished(count, stopwatch.elapsed());
}
```

Le signal `progress` est la première véritable démonstration de communication du worker vers le reste du programme **pendant** le calcul, pas seulement à la fin — et c'est un `emit` inoffensif à écrire ici parce que, comme tu le sais depuis l'article précédent, Qt le livrera en file d'attente au bon thread sans que tu aies besoin de faire quoi que ce soit de plus.

## Étape 3 — L'en-tête de la fenêtre : ajoute thread, worker, et le signal-messager

Crée (ou modifie, si tu repars du projet précédent) `mainwindow.h` :

```cpp
#pragma once

#include <QMainWindow>
#include <QLabel>
#include <QPushButton>
#include <QProgressBar>
#include <QTimer>
#include <QThread>
#include <QStatusBar>

#include "primecalculator.h"

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow() override;

signals:
    void requestComputation();

private slots:
    void onButtonClicked();
    void updateHeartbeat();
    void updateProgress(int percentage);
    void computationFinished(long long result, qint64 msElapsed);

private:
    QLabel *m_labelHeartbeat;
    QLabel *m_labelInstructions;
    QPushButton *m_startButton;
    QProgressBar *m_progressBar;
    QTimer *m_heartbeatTimer;
    int m_heartbeatCount = 0;

    QThread *m_thread;
    PrimeCalculator *m_worker;
};
```

Le signal `requestComputation()`, déclaré ici dans `MainWindow`, est le « messager » dont nous parlions dans l'article précédent : `MainWindow` n'appellera jamais directement `m_worker->start()` (ce serait un appel de fonction ordinaire, exécuté sur le thread appelant — faux, et de surcroît dangereux s'il touchait aux données du worker). Elle émettra à la place ce signal, connecté au slot du worker : la livraison en sécurité, comme toujours, c'est Qt qui s'en charge.

## Étape 4 — Le constructeur : c'est ici que se fait toute la connexion

Dans `mainwindow.cpp`, le corps de la fenêtre (labels, bouton, barre de progression, battement) est identique dans sa forme au projet précédent, avec l'ajout d'une `QProgressBar`. La partie nouvelle, celle qui mérite qu'on s'y attarde, est la connexion du worker :

```cpp
    // --- Setting up the worker thread ------------------------------
    m_thread = new QThread(this);          // stays in the GUI thread: it's a QObject like any other
    m_worker = new PrimeCalculator();      // NO parent: otherwise moveToThread() fails
    m_worker->setLimit(4'000'000);         // safe: the thread hasn't started yet

    m_worker->moveToThread(m_thread);      // from here on, its slots run in the managed thread

    connect(this, &MainWindow::requestComputation, m_worker, &PrimeCalculator::start);
    connect(m_worker, &PrimeCalculator::progress, this, &MainWindow::updateProgress);
    connect(m_worker, &PrimeCalculator::finished, this, &MainWindow::computationFinished);

    connect(m_startButton, &QPushButton::clicked, this, &MainWindow::onButtonClicked);

    m_thread->start();   // started once, stays alive for the whole life of the window
```

Suis l'ordre avec attention, parce qu'il n'est pas arbitraire : tu construis d'abord le worker **sans parent**, puis tu règles son état initial (encore sûr, le thread n'est pas parti), **ensuite** tu le déplaces avec `moveToThread()`, **ensuite** tu connectes les signaux (les connexions fonctionnent correctement quel que soit le moment où tu les fais, mais les connecter avant de démarrer le thread est une bonne habitude : tu évites la possibilité, lointaine mais conceptuellement gênante, que le thread démarre et termine son travail avant même que tu aies connecté qui doit en recevoir le résultat), et c'est seulement à la fin que tu appelles `m_thread->start()`. À partir de ce moment, le thread géré est vivant, en attente — sa boucle d'événements tourne, mais ne fait rien tant qu'aucun signal n'arrive à traiter.

## Étape 5 — Les slots de la fenêtre

```cpp
void MainWindow::onButtonClicked() {
    m_startButton->setEnabled(false);
    m_progressBar->setValue(0);
    statusBar()->showMessage("Computing in the background...");
    emit requestComputation();
}

void MainWindow::updateHeartbeat() {
    m_heartbeatCount++;
    m_labelHeartbeat->setText(QString("Heartbeat: %1").arg(m_heartbeatCount));
}

void MainWindow::updateProgress(int percentage) {
    m_progressBar->setValue(percentage);
}

void MainWindow::computationFinished(long long result, qint64 msElapsed) {
    m_progressBar->setValue(100);
    m_startButton->setEnabled(true);
    statusBar()->showMessage(
        QString("Done: %1 primes found in %2 ms. The heartbeat above never stopped.")
            .arg(result).arg(msElapsed));
}
```

Remarque `onButtonClicked()` : il désactive le bouton avant d'émettre la requête. Ce n'est pas de la décoration — c'est la première défense contre un problème réel : sans cette ligne, un clic répété pendant que le calcul précédent est encore en cours émettrait une seconde `requestComputation()`, que Qt mettrait quand même en file d'attente en toute sécurité (pas de crash), mais qui ferait exécuter `start()` une seconde fois, en séquence, sur le même worker, en ajoutant du travail au travail au lieu de le refuser ou de le remplacer. Gérer « que se passe-t-il si l'utilisateur demande un nouveau travail pendant qu'un autre est en cours » avec une véritable annulation est le sujet d'un module ultérieur ; aujourd'hui, nous nous limitons, à juste titre, à empêcher le problème à la racine en désactivant le bouton.

## Étape 6 — Le destructeur : l'arrêt propre

```cpp
MainWindow::~MainWindow() {
    m_thread->quit();
    m_thread->wait();
    delete m_worker;
}
```

Trois lignes qui valent tout le discours sur le cycle de vie tenu dans l'article précédent : tu demandes à la boucle d'événements du thread géré de s'arrêter, tu attends qu'elle l'ait vraiment fait, et c'est seulement alors que tu détruis le worker avec un `delete` ordinaire — sûr, parce qu'après `wait()`, aucun autre thread ne peut plus le toucher.

## Étape 7 — Compile, exécute, et observe ce qui ne se produit PLUS

```bash
cmake -S . -B build
cmake --build build
./build/worker_thread_demo
```

Appuie sur le bouton. Observe la barre de progression avancer par à-coups (les signaux `progress` qui arrivent du worker) tandis que, simultanément, le battement en haut continue de monter sans la moindre hésitation — pas une interruption, pas un ralentissement perceptible, rien. Essaie aussi de redimensionner ou de déplacer la fenêtre pendant que le calcul est en cours : elle répond normalement, chose impensable dans le projet précédent pendant ce même calcul identique.

Si tu veux voir le contraste de façon encore plus nette, garde les deux projets ouverts et exécute exactement le même nombre de nombres premiers à chercher dans les deux, l'un après l'autre : la différence n'est pas dans la durée du calcul — qui est identique, parce que le CPU doit de toute façon faire le même travail — mais dans la *réactivité de la fenêtre* pendant ce temps. Ici, nous n'avons rien accéléré (un seul thread de calcul, exactement comme avant), nous avons seulement déplacé ce calcul hors du chemin de la boucle d'événements qui doit s'occuper de la fenêtre.

## Ce que tu viens de te démontrer à toi-même

Tu as construit, de tes propres mains et en comprenant chaque ligne, le pattern qui résout structurellement le problème sur lequel ce cours s'est ouvert. Tu as vu la différence pratique entre l'objet `QThread` et le thread qu'il gère, tu as déplacé un worker avec `moveToThread()` et vérifié que ses slots s'exécutent réellement là où tu t'y attends, tu as communiqué dans les deux directions à travers des signaux sans écrire un seul mutex, et tu as géré un arrêt propre sans fuite. Dans le prochain module, nous introduisons `QMutex` et ses parents — parce que le jour où ton worker devra partager des données mutables avec d'autres threads simultanément (pas seulement échanger des messages via des signaux, ce qui aujourd'hui t'a mis à l'abri de toute section critique), tu auras besoin de ces outils.

---

*Le code source complet de ce projet est disponible dans le dépôt qui accompagne ce cours, dans le dossier `project-C-worker-thread`.*
