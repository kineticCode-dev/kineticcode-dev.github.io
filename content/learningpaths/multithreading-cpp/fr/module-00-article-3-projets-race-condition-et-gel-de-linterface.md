---
title: "Deux démonstrations, pas deux récits : la race condition et le gel construits de tes propres mains"
description: "Multithreading en C++ avec Qt — Module 0 — Projet"
---

Tu peux trouver tout le code source [ici](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Deux démonstrations, pas deux récits : la race condition et le gel construits de tes propres mains

Les deux articles précédents ont construit le vocabulaire : thread, concurrence, race condition, data race, la contrainte du thread unique de Qt. Maintenant, place aux mains. Construisons ensemble deux petits projets : le premier isole la race condition en C++ standard pur, sans une seule ligne de Qt ; le second recrée en direct le gel de l'UI dont nous avons déjà parlé, et ne le guérit qu'à moitié — la vraie guérison arrive dans le prochain module, quand nous déplacerons le calcul sur un thread séparé avec `QThread`.

## Projet A — La race condition, isolée et en direct

Nous voulons voir le phénomène pur, sans aucun framework par-dessus. Crée un dossier de travail et, dedans, un fichier `CMakeLists.txt` :

```cmake
cmake_minimum_required(VERSION 3.16)
project(race_condition_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

add_executable(race_condition_demo main.cpp)
target_link_libraries(race_condition_demo PRIVATE Threads::Threads)
```

`find_package(Threads REQUIRED)` cherche sur le système la bibliothèque de threading native (sur Linux c'est `pthread` ; sur Windows c'est le runtime lui-même qui s'en charge), et `Threads::Threads` est la cible que nous lions à l'exécutable : sans ce lien explicite, certains systèmes donneraient des erreurs de linkage dès qu'on utiliserait `std::thread`.

Crée `main.cpp` et commence par les includes et les constantes :

```cpp
#include <iostream>
#include <thread>
#include <vector>
#include <mutex>

constexpr int THREAD_COUNT = 8;
constexpr int INCREMENTS_PER_THREAD = 1'000'000;
```

Huit threads, un million d'incréments chacun : suffisant pour rendre la race condition presque certaine à observer (avec de petits nombres, par pure chance statistique, tu pourrais ne jamais la voir se manifester — et c'est déjà une bonne leçon : "je ne l'ai pas vue donc elle n'existe pas" est un raisonnement dangereux en matière de concurrence).

Maintenant la version dangereuse :

```cpp
long long unprotectedCounter = 0;

void incrementUnprotected() {
    for (int i = 0; i < INCREMENTS_PER_THREAD; ++i) {
        unprotectedCounter++;   // <-- race condition qui
    }
}
```

Aucune ruse : c'est le code le plus évident possible, et c'est exactement pour ça que le bug est insidieux. Il ne saute pas aux yeux à l'écriture, il ne saute aux yeux qu'à l'exécution, et seulement si tu l'observes de la bonne façon.

Juste en dessous, la version correcte :

```cpp
long long protectedCounter = 0;
std::mutex counterMutex;

void incrementWithMutex() {
    for (int i = 0; i < INCREMENTS_PER_THREAD; ++i) {
        std::lock_guard<std::mutex> lock(counterMutex);
        protectedCounter++;
    }
}
```

`std::lock_guard` est un wrapper **RAII** : il acquiert le verrou sur le mutex dans le constructeur et le libère automatiquement dans le destructeur, c'est-à-dire quand `lock` sort de son scope à la fin de chaque itération. Ça garantit que le mutex est libéré même si une exception était levée entre-temps — oublier de le faire avec un `lock()`/`unlock()` manuels est une façon classique de s'introduire soi-même un deadlock.

Dans `main`, lance d'abord la version sans protection :

```cpp
int main() {
    const long long expected = static_cast<long long>(THREAD_COUNT) * INCREMENTS_PER_THREAD;

    std::cout << "Expected final value in both cases: " << expected << "\n\n";

    {
        std::vector<std::thread> threads;
        for (int i = 0; i < THREAD_COUNT; ++i)
            threads.emplace_back(incrementUnprotected);
        for (auto& t : threads)
            t.join();

        std::cout << "[WITHOUT mutex]  final counter = " << unprotectedCounter << "\n";
    }
```

`t.join()` bloque le thread appelant jusqu'à ce que le thread `t` ait complètement terminé. Il est essentiel de l'appeler sur chaque thread créé avant de lire le résultat final : lire `unprotectedCounter` avant que tous les threads aient fini introduirait une autre race condition, cette fois entre le thread principal qui lit et les autres qui écrivent encore.

Ajoute le même bloc pour la version protégée, en rappelant `incrementWithMutex` à la place d'`incrementUnprotected`, puis termine par `return 0;`.

Compile et exécute, d'abord en Release :

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/race_condition_demo
```

Il y a une possibilité concrète que le compteur "sans mutex" s'avère correct même dans cette exécution. Ça ne veut pas dire que le code est sûr : ça veut dire que le compilateur — ayant le droit de supposer qu'aucune data race ne se produit — a probablement gardé `unprotectedCounter` dans un registre pendant toute la durée de la boucle de chaque thread, masquant le problème au lieu de le résoudre.

Maintenant recompile en Debug :

```bash
rm -rf build
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
./build/race_condition_demo
```

Avec les optimisations désactivées, chaque incrément passe vraiment par une lecture et une écriture en mémoire à chaque itération, et il est bien plus probable que deux threads s'entrelacent de la mauvaise façon. Sur une machine de vérification à deux cœurs, le compteur "sans mutex" a fini par perdre plus de cinq millions d'incréments sur huit millions attendus — une erreur de 60 %, pas un arrondi négligeable. Essaie plusieurs fois : le nombre exact d'incréments perdus changera à chaque fois, parce qu'il dépend de la façon dont l'ordonnanceur a entrelacé les threads lors de cette exécution précise. Non déterministe, par définition — c'est de nouveau le point central de l'article précédent.

Tu viens de te démontrer à toi-même qu'une instruction apparemment atomique (`counter++`) ne l'est absolument pas au niveau de l'exécution machine, que le compilateur peut cacher le problème au lieu de le résoudre si tu ne synchronises pas explicitement, et qu'un simple `std::mutex` avec `std::lock_guard` suffit à ramener le résultat à l'exactitude mathématique attendue, à chaque fois, sans exception.

## Projet B — Le gel de l'UI, en direct

C'est le projet qui vaut plus que tout paragraphe de théorie pour comprendre pourquoi ce cours entier existe. Construisons une petite fenêtre Qt Widgets avec un "battement de cœur" visuel — un nombre qui monte tous les dixièmes de seconde, la preuve que la fenêtre est vivante — puis bloquons-la exprès, sur commande, en appuyant sur un bouton.

Crée un nouveau dossier de travail et un `CMakeLists.txt` :

```cmake
cmake_minimum_required(VERSION 3.16)
project(ui_freeze_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets)

add_executable(ui_freeze_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
)

target_link_libraries(ui_freeze_demo PRIVATE Qt6::Widgets)
```

`CMAKE_AUTOMOC ON` invoque automatiquement, en coulisses, le Meta-Object Compiler de Qt sur chaque classe qui utilise la macro `Q_OBJECT` — le moc génère du code supplémentaire qui rend possible le mécanisme de signaux et slots. Tu n'auras jamais besoin de l'invoquer à la main.

Crée `mainwindow.h` :

```cpp
#pragma once

#include <QMainWindow>
#include <QLabel>
#include <QPushButton>
#include <QTimer>
#include <QElapsedTimer>
#include <QStatusBar>

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

private slots:
    void updateHeartbeat();
    void runHeavyComputation();

private:
    QLabel *m_labelHeartbeat;
    QLabel *m_labelInstructions;
    QPushButton *m_blockButton;
    QTimer *m_heartbeatTimer;
    int m_heartbeatCount = 0;

    long long countPrimes(long long limit);
};
```

La macro `Q_OBJECT` est celle qui rend cette classe compatible avec le système de signaux et slots de Qt : n'importe quelle classe qui veut utiliser `connect()` doit l'avoir.

Crée `mainwindow.cpp` et commence par le constructeur :

```cpp
#include "mainwindow.h"
#include <QWidget>
#include <QVBoxLayout>
#include <QFont>

MainWindow::MainWindow(QWidget *parent) : QMainWindow(parent) {
    setWindowTitle("Project B - UI Freeze Demonstration");
    resize(480, 220);

    auto *centralWidget = new QWidget(this);
    auto *layout = new QVBoxLayout(centralWidget);

    m_labelInstructions = new QLabel(
        "Watch the counter below: it updates every 100 ms.\n"
        "Then press the button and see what happens.", centralWidget);
    m_labelInstructions->setWordWrap(true);

    m_labelHeartbeat = new QLabel("Heartbeat: 0", centralWidget);
    QFont heartbeatFont = m_labelHeartbeat->font();
    heartbeatFont.setPointSize(18);
    heartbeatFont.setBold(true);
    m_labelHeartbeat->setFont(heartbeatFont);

    m_blockButton = new QPushButton("Run heavy computation (BLOCKING)", centralWidget);

    layout->addWidget(m_labelInstructions);
    layout->addWidget(m_labelHeartbeat);
    layout->addWidget(m_blockButton);
    centralWidget->setLayout(layout);
    setCentralWidget(centralWidget);
    statusBar()->showMessage("Ready.");

    m_heartbeatTimer = new QTimer(this);
    connect(m_heartbeatTimer, &QTimer::timeout, this, &MainWindow::updateHeartbeat);
    m_heartbeatTimer->start(100);

    connect(m_blockButton, &QPushButton::clicked,
            this, &MainWindow::runHeavyComputation);
}
```

Remarque `new QWidget(this)` : passer `this` comme parent dit à Qt "cet objet vit tant que vit la fenêtre, et quand la fenêtre est détruite, détruis-le aussi" — c'est le système de gestion de mémoire en arbre de parenté de Qt, qui évite presque toujours des `delete` manuels sur les widgets. `connect()` relie un **signal** (`QTimer::timeout`, émis chaque fois que le timer expire ; `QPushButton::clicked`, émis au clic) à un **slot** (une fonction membre qui réagit) — c'est le mécanisme par lequel, dans Qt, un événement communique avec le code qui doit y réagir, et sur lequel nous construirons la communication sûre entre threads dans les modules suivants.

Le slot inoffensif, le battement :

```cpp
void MainWindow::updateHeartbeat() {
    m_heartbeatCount++;
    m_labelHeartbeat->setText(QString("Heartbeat: %1").arg(m_heartbeatCount));
}
```

Rien de spécial : toutes les 100 ms le nombre monte de un et l'étiquette se met à jour. C'est ton capteur visuel pour savoir si le thread de la GUI respire encore.

Le travail lourd, délibérément naïf :

```cpp
long long MainWindow::countPrimes(long long limit) {
    long long count = 0;
    for (long long n = 2; n < limit; ++n) {
        bool isPrime = true;
        for (long long d = 2; d * d <= n; ++d) {
            if (n % d == 0) { isPrime = false; break; }
        }
        if (isPrime) ++count;
    }
    return count;
}
```

Peu importe qu'il soit efficace, on veut seulement qu'il occupe le processeur pendant quelques secondes de façon reproductible.

Le slot qui bloque tout :

```cpp
void MainWindow::runHeavyComputation() {
    statusBar()->showMessage("Computing... (the UI is blocked, on purpose)");

    QElapsedTimer stopwatch;
    stopwatch.start();

    long long result = countPrimes(30'000'000);

    qint64 elapsedMs = stopwatch.elapsed();
    statusBar()->showMessage(
        QString("Done: %1 primes found in %2 ms. The heartbeat above did not move.")
            .arg(result).arg(elapsedMs));
}
```

Ce slot est connecté au `clicked()` d'un `QPushButton`, donc il s'exécute sur le thread qui possède ce bouton — le thread principal, le même qui fait tourner la boucle d'événements et qui met à jour `m_labelHeartbeat`. Tant que `countPrimes` n'est pas revenue, ce thread ne peut rien faire d'**autre** : ne pas redessiner la fenêtre, ne pas traiter le timer du battement, ne pas répondre au système d'exploitation. Augmente ou diminue `30'000'000` selon la rapidité de ta machine, jusqu'à ce que le calcul dure au moins 3-4 secondes.

Enfin `main.cpp` :

```cpp
#include <QApplication>
#include "mainwindow.h"

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);

    MainWindow window;
    window.show();

    return app.exec();
}
```

`app.exec()` est, littéralement, la boucle d'événements dont nous avons parlé dans l'article précédent : à partir d'ici, jusqu'à ce que l'application se ferme, c'est cette boucle — pas ton code — qui décide quand chaque slot est appelé.

Compile et exécute :

```bash
cmake -S . -B build
cmake --build build
./build/ui_freeze_demo
```

Laisse la fenêtre ouverte quelques secondes et observe le nombre monter régulièrement. Puis appuie sur le bouton "Run heavy computation" : le nombre s'arrête **exactement** à l'instant du clic, la fenêtre grisonne probablement (surtout si tu essaies de la déplacer ou de la redimensionner pendant que le calcul est en cours — essaie, c'est instructif), et ce n'est que quand le calcul se termine que tu vois le nombre reprendre sa montée là où il s'était arrêté, tout d'un coup, comme si le temps écoulé entre-temps n'avait jamais existé pour le thread de la GUI.

Pas un concept abstrait : tu as vu de tes propres yeux qu'"un thread unique" n'est pas une limite théorique de Qt, mais un comportement physique observable de ton programme. Dans le prochain module, nous reprenons ce même fichier `mainwindow.cpp` et le modifions pour déplacer `countPrimes` sur un `QThread` séparé, en utilisant le pattern du worker object avec `moveToThread()` : tu verras le battement continuer à monter, imperturbable, pendant que le calcul tourne en arrière-plan — le remède à la maladie que tu viens de diagnostiquer de tes propres mains.

---

*Le code source complet des deux projets est disponible dans le dépôt qui accompagne ce cours, dans les dossiers `project-A-race-condition` et `project-B-ui-freeze`.*
