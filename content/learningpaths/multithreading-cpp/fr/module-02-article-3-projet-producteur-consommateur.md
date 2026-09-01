---
title: "Projet : producteur, consommateur, et le buffer qui les tient en équilibre"
description: "Multithreading en C++ avec Qt — Module 2 — Projet"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Projet : producteur, consommateur, et le buffer qui les tient en équilibre

Construisons une application Qt Widgets avec trois threads actifs simultanément : le thread de la GUI (que tu connais bien maintenant), un thread **Producteur** qui génère une nouvelle valeur à intervalles aléatoires et l'insère dans le buffer, et un thread **Consommateur** qui la prélève et simule son traitement.

![Producer-consumer with a bounded buffer](modulo-02/10-producer-consumer-buffer.png)

Une barre de progression affiche l'occupation du buffer en temps réel, et une liste de journal enregistre chaque production et chaque consommation.

## Étape 1 — Le squelette du projet

```cmake
cmake_minimum_required(VERSION 3.16)
project(producer_consumer_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets)

add_executable(producer_consumer_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
    sharedbuffer.h
    sharedbuffer.cpp
    producer.h
    producer.cpp
    consumer.h
    consumer.cpp
)

target_link_libraries(producer_consumer_demo PRIVATE Qt6::Widgets)
```

Cinq fichiers source aujourd'hui, pas trois comme dans les projets précédents : `SharedBuffer` est une classe à part entière, distincte à la fois du Producteur et du Consommateur, parce que — contrairement au projet du module précédent, où tout l'état vivait dans un unique worker — aujourd'hui l'état partagé est précisément l'objet que *les deux* threads doivent pouvoir atteindre.

## Étape 2 — Le buffer partagé : le cœur du projet

Crée `sharedbuffer.h` :

```cpp
#pragma once
#include <QObject>
#include <QMutex>
#include <QWaitCondition>
#include <QQueue>

class SharedBuffer : public QObject {
    Q_OBJECT

public:
    explicit SharedBuffer(int capacity, QObject *parent = nullptr);

    bool produce(int value);
    bool consume(int &valueOut);
    void close();

signals:
    void occupancyChanged(int occupancy, int capacity);

private:
    QMutex m_mutex;
    QWaitCondition m_notFull;
    QWaitCondition m_notEmpty;
    QQueue<int> m_queue;
    int m_capacity;
    bool m_closed = false;
};
```

Arrête-toi sur la déclaration : `produce()` et `consume()` **ne sont pas des slots**. Ce sont des méthodes publiques ordinaires, pensées pour être appelées **directement** par le code du Producteur et du Consommateur — pas via un signal. C'est une différence de style importante par rapport au module précédent, où *tout* passait par des signaux et des slots : là, c'était nécessaire parce que nous échangions simplement des messages entre threads. Ici, en revanche, `SharedBuffer` est un objet dont la sécurité en présence de plusieurs threads est garantie **en interne**, par son `QMutex` — il peut être appelé directement depuis n'importe quel thread, à n'importe quel moment, exactement comme tu le ferais avec n'importe quelle classe C++ thread-safe écrite sans Qt. Les signaux restent le bon outil pour la *notification* vers la GUI (`occupancyChanged`), pas pour l'accès à la donnée elle-même.

Maintenant `sharedbuffer.cpp` :

```cpp
#include "sharedbuffer.h"

SharedBuffer::SharedBuffer(int capacity, QObject *parent)
    : QObject(parent), m_capacity(capacity) {}

bool SharedBuffer::produce(int value) {
    QMutexLocker locker(&m_mutex);

    while (m_queue.size() >= m_capacity && !m_closed) {
        m_notFull.wait(&m_mutex);
    }

    if (m_closed) return false;

    m_queue.enqueue(value);
    emit occupancyChanged(m_queue.size(), m_capacity);

    m_notEmpty.wakeOne();
    return true;
}

bool SharedBuffer::consume(int &valueOut) {
    QMutexLocker locker(&m_mutex);

    while (m_queue.isEmpty() && !m_closed) {
        m_notEmpty.wait(&m_mutex);
    }

    if (m_queue.isEmpty()) return false;

    valueOut = m_queue.dequeue();
    emit occupancyChanged(m_queue.size(), m_capacity);

    m_notFull.wakeOne();
    return true;
}

void SharedBuffer::close() {
    QMutexLocker locker(&m_mutex);
    m_closed = true;
    m_notFull.wakeAll();
    m_notEmpty.wakeAll();
}
```

Tu reconnais le pattern de l'article précédent : le `while`, pas le `if` ; le mutex toujours acquis avant de toucher `m_queue` ou `m_closed` ; le réveil ciblé (`wakeOne`) sur les chemins normaux, le réveil total (`wakeAll`) seulement dans `close()`, où nous voulons que **quiconque** est en attente, producteur ou consommateur, se réveille et s'en aperçoive.

## Étape 3 — Le Producteur

`producer.h` :

```cpp
#pragma once
#include <QObject>
#include "sharedbuffer.h"

class Producer : public QObject {
    Q_OBJECT

public:
    explicit Producer(SharedBuffer *buffer, QObject *parent = nullptr);

public slots:
    void start();

signals:
    void valueProduced(int value);

private:
    SharedBuffer *m_buffer;
};
```

`producer.cpp` :

```cpp
#include "producer.h"
#include <QThread>
#include <QRandomGenerator>

Producer::Producer(SharedBuffer *buffer, QObject *parent)
    : QObject(parent), m_buffer(buffer) {}

void Producer::start() {
    int nextValue = 1;

    while (true) {
        QThread::msleep(QRandomGenerator::global()->bounded(200, 800));

        if (!m_buffer->produce(nextValue)) break;

        emit valueProduced(nextValue);
        ++nextValue;
    }
}
```

Remarque ce qui **manque** par rapport au projet du module précédent : aucun drapeau d'arrêt dédié. La boucle vit tant que `produce()` retourne `true`, et `produce()` retourne `false` exactement quand (et seulement quand) `SharedBuffer::close()` a été appelée. La condition de terminaison du thread est entièrement déléguée à l'objet partagé — un choix de conception qui garde la logique de cycle de vie en un seul endroit au lieu de la disperser entre plusieurs classes.

## Étape 4 — Le Consommateur

`consumer.h` et `consumer.cpp` suivent la même structure, en miroir :

```cpp
#pragma once
#include <QObject>
#include "sharedbuffer.h"

class Consumer : public QObject {
    Q_OBJECT

public:
    explicit Consumer(SharedBuffer *buffer, QObject *parent = nullptr);

public slots:
    void start();

signals:
    void valueConsumed(int value, int msProcessing);

private:
    SharedBuffer *m_buffer;
};
```

```cpp
#include "consumer.h"
#include <QThread>
#include <QRandomGenerator>
#include <QElapsedTimer>

Consumer::Consumer(SharedBuffer *buffer, QObject *parent)
    : QObject(parent), m_buffer(buffer) {}

void Consumer::start() {
    while (true) {
        int value;
        if (!m_buffer->consume(value)) break;

        QElapsedTimer stopwatch;
        stopwatch.start();
        int processingTime = QRandomGenerator::global()->bounded(300, 1100);
        QThread::msleep(processingTime);

        emit valueConsumed(value, static_cast<int>(stopwatch.elapsed()));
    }
}
```

Le consommateur est délibérément un peu plus lent et plus irrégulier que le producteur (intervalles 300-1100ms contre 200-800ms) : c'est ce qui te permettra de voir le buffer se remplir visiblement dans la barre de progression au lieu de rester toujours vide.

## Étape 5 — La fenêtre : relier les trois threads

`mainwindow.h` :

```cpp
#pragma once
#include <QMainWindow>
#include <QProgressBar>
#include <QListWidget>
#include <QLabel>
#include <QThread>
#include "sharedbuffer.h"
#include "producer.h"
#include "consumer.h"

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow() override;

private slots:
    void updateOccupancy(int occupancy, int capacity);
    void logProduced(int value);
    void logConsumed(int value, int msProcessing);

private:
    QProgressBar *m_occupancyBar;
    QListWidget *m_log;
    QLabel *m_labelOccupancy;

    SharedBuffer *m_buffer;
    QThread *m_producerThread;
    QThread *m_consumerThread;
    Producer *m_producer;
    Consumer *m_consumer;
};
```

Dans le constructeur, après avoir mis en place les widgets (barre de progression, liste de journal — rien de nouveau par rapport aux projets précédents), la partie qui compte :

```cpp
    m_buffer = new SharedBuffer(BUFFER_CAPACITY, this);
    connect(m_buffer, &SharedBuffer::occupancyChanged, this, &MainWindow::updateOccupancy);

    m_producerThread = new QThread(this);
    m_producer = new Producer(m_buffer);
    m_producer->moveToThread(m_producerThread);
    connect(m_producerThread, &QThread::started, m_producer, &Producer::start);
    connect(m_producer, &Producer::valueProduced, this, &MainWindow::logProduced);

    m_consumerThread = new QThread(this);
    m_consumer = new Consumer(m_buffer);
    m_consumer->moveToThread(m_consumerThread);
    connect(m_consumerThread, &QThread::started, m_consumer, &Consumer::start);
    connect(m_consumer, &Consumer::valueConsumed, this, &MainWindow::logConsumed);

    m_producerThread->start();
    m_consumerThread->start();
```

Observe où vit `m_buffer` : il est construit avec `this` (la fenêtre) comme parent, donc son affinité de thread reste celle du thread GUI — et c'est très bien ainsi, parce que comme tu l'as vu à l'Étape 2 personne n'appelle ses méthodes `produce()`/`consume()` via des signaux (là où l'affinité compterait pour décider entre Direct et Queued) : elles sont appelées directement, depuis des threads différents, en comptant sur le `QMutex` interne pour la sécurité. Le signal `occupancyChanged`, en revanche, est émis depuis l'intérieur de `produce()`/`consume()` — donc depuis le thread du Producteur ou du Consommateur, selon celui qui vient d'agir — vers un slot qui vit dans le thread GUI : ici l'affinité de thread **compte bel et bien**, et Qt choisit automatiquement une connexion queued, exactement comme dans le module précédent, indépendamment de l'endroit où « vit » nominalement l'objet `SharedBuffer` qui a émis le signal.

## Étape 6 — Les slots de la fenêtre

```cpp
void MainWindow::updateOccupancy(int occupancy, int capacity) {
    m_occupancyBar->setValue(occupancy);
    m_labelOccupancy->setText(QString("Buffer occupancy: %1 / %2").arg(occupancy).arg(capacity));
}

void MainWindow::logProduced(int value) {
    m_log->addItem(QString("Produced: value %1").arg(value));
    m_log->scrollToBottom();
}

void MainWindow::logConsumed(int value, int msProcessing) {
    m_log->addItem(QString("Consumed: value %1 (processed in %2 ms)").arg(value).arg(msProcessing));
    m_log->scrollToBottom();
}
```

Rien de nouveau ici — ce sont de simples slots exécutés sur le thread GUI, remplis en toute sécurité grâce aux connexions queued vues plus haut.

## Étape 7 — Le destructeur : l'ordre qui compte vraiment

```cpp
MainWindow::~MainWindow() {
    m_buffer->close();

    m_producerThread->quit();
    m_producerThread->wait();

    m_consumerThread->quit();
    m_consumerThread->wait();

    delete m_producer;
    delete m_consumer;
}
```

C'est le point où le cycle de vie d'un worker thread vu dans le module précédent et les wait conditions d'aujourd'hui se rencontrent, et cela vaut la peine d'expliquer pourquoi l'ordre de ces lignes n'est pas interchangeable. Si à ce moment le Producteur est endormi dans `produce()` (buffer plein, en attente sur `notFull`), sa `start()` **ne reviendra jamais toute seule** : elle est bloquée là, pas dans sa boucle d'événements. Cela signifie que le thread du Producteur n'est pas en mesure de traiter **aucun autre événement**, y compris une éventuelle demande de `quit()` mise en file auparavant. `close()` est ce qui débloque physiquement la situation : elle réveille quiconque est en attente, leur `start()` peut enfin évaluer `if (m_closed) return false;` et retourner, et **c'est seulement alors** que le thread revient à sa propre boucle d'événements, libre de recevoir et d'exécuter `quit()`. Si tu inversais l'ordre — `quit()` avant `close()` — rien de catastrophique ne se produirait (la demande de sortie resterait simplement en file, inoffensive), mais le vrai travail de déblocage serait quand même fait uniquement par `close()` : c'est elle, pas `quit()`, la clé de voûte d'un arrêt propre quand des wait conditions sont en jeu.

## Étape 8 — Compile, exécute, observe l'entrepôt respirer

```bash
cmake -S . -B build
cmake --build build
./build/producer_consumer_demo
```

Regarde la barre de progression : elle monte par à-coups quand le Producteur insère une valeur, descend quand le Consommateur en prélève une. Puisque le Consommateur est en moyenne plus lent, avec le temps tu verras tendanciellement le buffer se remplir vers sa capacité maximale (5) plus souvent qu'il ne se vide complètement — c'est exactement le comportement que la théorie des articles précédents prévoit, désormais observable à l'écran. Regarde aussi la liste de journal : les valeurs apparaissent toujours dans le même ordre dans lequel elles ont été produites, aussi bien dans la colonne « Produced » que dans « Consumed » — le buffer, étant une file (`QQueue`, premier entré premier sorti), préserve l'ordre, une propriété qui, dans ton travail avec des pipelines d'images, est presque toujours celle que tu veux (l'image numéro 10 doit être traitée et émise avant l'image numéro 11, pas après).

Ferme la fenêtre et observe que l'application se termine immédiatement, sans rester suspendue : c'est la preuve directe que la séquence `close()` + `quit()` + `wait()` de l'Étape 7 fonctionne comme promis, même si à cet instant précis l'un des deux threads était endormi en attente dans le buffer.

## Ce que tu viens de te démontrer à toi-même

Tu as construit, et vérifié de tes propres yeux, le pattern de synchronisation le plus cité dans l'histoire des systèmes concurrents — pas comme un exercice de manuel, mais avec deux vrais threads, un vrai mutex, deux vraies wait conditions, et un arrêt qui ne laisse rien en suspens. Tu as aussi vu une distinction de conception importante par rapport au module précédent : tout ne doit pas nécessairement passer par des signaux et des slots — un objet avec sa propre synchronisation interne peut être appelé directement par plusieurs threads, et c'est souvent le choix le plus naturel quand l'état partagé est le cœur du problème, pas un détail à cacher derrière des messages.

Si le producteur-consommateur d'aujourd'hui t'a intrigué, un excellent approfondissement à essayer par toi-même est d'étendre le projet à **plusieurs producteurs ou plusieurs consommateurs** sur le même buffer : le code de `SharedBuffer` ne change pas d'une ligne (il est déjà correct pour ce cas, `wakeOne()` et la boucle `while` le garantissent), mais observer comment il se comporte avec trois consommateurs au lieu d'un est un exercice qui vaut plus que bien des pages de théorie sur la famine.

---

*Le code source complet de ce projet est disponible dans le dépôt qui accompagne ce cours, dans le dossier `project-D-producer-consumer`.*
