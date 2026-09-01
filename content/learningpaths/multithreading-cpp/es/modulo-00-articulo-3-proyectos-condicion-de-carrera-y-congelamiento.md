---
title: "Dos demostraciones, no dos relatos: la race condition y el congelamiento construidos con tus propias manos"
description: "Multithreading en C++ con Qt — Módulo 0 — Proyecto"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Dos demostraciones, no dos relatos: la race condition y el congelamiento construidos con tus propias manos

Los dos artículos anteriores construyeron el vocabulario: thread, concurrencia, race condition, data race, la restricción del thread único de Qt. Ahora les toca a las manos. Construyamos juntos dos pequeños proyectos: el primero aísla la race condition en C++ estándar puro, sin una sola línea de Qt; el segundo recrea en vivo el congelamiento de la UI del que ya hablamos, y lo cura solo a medias —la cura de verdad llega en el próximo módulo, cuando movamos el cálculo a un thread separado con `QThread`.

## Proyecto A — La race condition, aislada y en vivo

Queremos ver el fenómeno puro, sin ningún framework encima. Crea una carpeta de trabajo y, dentro, un archivo `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.16)
project(race_condition_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

add_executable(race_condition_demo main.cpp)
target_link_libraries(race_condition_demo PRIVATE Threads::Threads)
```

`find_package(Threads REQUIRED)` busca en el sistema la biblioteca de threading nativa (en Linux es `pthread`; en Windows la gestiona el propio runtime), y `Threads::Threads` es el target que enlazamos al ejecutable: sin este enlace explícito, algunos sistemas darían errores de linking en cuanto usáramos `std::thread`.

Crea `main.cpp` y empieza con los includes y las constantes:

```cpp
#include <iostream>
#include <thread>
#include <vector>
#include <mutex>

constexpr int THREAD_COUNT = 8;
constexpr int INCREMENTS_PER_THREAD = 1'000'000;
```

Ocho threads, un millón de incrementos cada uno: suficiente para que la race condition sea casi segura de observar (con números pequeños, por pura suerte estadística, podrías no verla manifestarse nunca, y eso ya es una buena lección: "no la vi, así que no existe" es un razonamiento peligroso en concurrencia).

Ahora la versión peligrosa:

```cpp
long long unprotectedCounter = 0;

void incrementUnprotected() {
    for (int i = 0; i < INCREMENTS_PER_THREAD; ++i) {
        unprotectedCounter++;   // <-- race condition qui
    }
}
```

Sin trucos: es el código más obvio posible, y precisamente por eso el bug es insidioso. No salta a la vista al escribirlo, salta a la vista solo en runtime, y solo si lo observas de la manera correcta.

Justo debajo, la versión correcta:

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

`std::lock_guard` es un wrapper **RAII**: adquiere el lock sobre el mutex en el constructor y lo libera automáticamente en el destructor, es decir, cuando `lock` sale del scope al final de cada iteración. Esto garantiza que el mutex se libere incluso si en medio se lanzara una excepción; olvidarse de hacerlo con un `lock()`/`unlock()` manuales es una manera clásica de meterse un deadlock uno mismo.

En el `main`, lanza primero la versión sin protección:

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

`t.join()` bloquea el thread que lo llama hasta que el thread `t` haya terminado por completo. Es fundamental llamarlo sobre cada thread creado antes de leer el resultado final: leer `unprotectedCounter` antes de que todos los threads hayan terminado introduciría otra race condition, esta vez entre el thread principal que lee y los demás que todavía están escribiendo.

Agrega el mismo bloque para la versión protegida, llamando a `incrementWithMutex` en lugar de `incrementUnprotected`, y luego cierra con `return 0;`.

Compila y ejecuta, primero en Release:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/race_condition_demo
```

Hay una posibilidad concreta de que el contador "sin mutex" resulte correcto incluso en esta ejecución. Eso no significa que el código sea seguro: significa que el compilador —al tener derecho a asumir que no ocurre ninguna data race— probablemente mantuvo `unprotectedCounter` en un registro durante toda la duración del ciclo de cada thread, enmascarando el problema en lugar de resolverlo.

Ahora recompila en Debug:

```bash
rm -rf build
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
./build/race_condition_demo
```

Con las optimizaciones desactivadas, cada incremento individual pasa de verdad por una lectura y una escritura en memoria en cada iteración, y es mucho más probable que dos threads se entrelacen de manera equivocada. En una máquina de prueba con dos núcleos, el contador "sin mutex" llegó a perder más de cinco millones de incrementos sobre ocho millones esperados: un error del 60%, no un redondeo despreciable. Pruébalo varias veces: el número exacto de incrementos perdidos cambiará cada vez, porque depende de cómo el scheduler entrelazó los threads en esa ejecución específica. No determinista, por definición: es de nuevo el punto central del artículo anterior.

Acabas de demostrarte a ti mismo que una instrucción aparentemente atómica (`counter++`) no lo es en absoluto a nivel de ejecución de máquina, que el compilador puede esconder el problema en lugar de resolverlo si no sincronizas explícitamente, y que un simple `std::mutex` con `std::lock_guard` basta para devolver el resultado a la exactitud matemática esperada, siempre, sin excepciones.

## Proyecto B — El congelamiento de la UI, en vivo

Este es el proyecto que vale más que cualquier párrafo de teoría para entender por qué existe todo este curso. Construyamos una pequeña ventana Qt Widgets con un "latido" visual —un número que sube cada décima de segundo, la prueba de que la ventana está viva— y luego lo bloqueamos a propósito, a demanda, presionando un botón.

Crea una nueva carpeta de trabajo y un `CMakeLists.txt`:

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

`CMAKE_AUTOMOC ON` invoca automáticamente, detrás de escena, el Meta-Object Compiler de Qt sobre cada clase que usa la macro `Q_OBJECT`; el moc genera código adicional que hace posible el mecanismo de señales y slots. Nunca tendrás que invocarlo a mano.

Crea `mainwindow.h`:

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

La macro `Q_OBJECT` es la que hace que esta clase sea compatible con el sistema de señales y slots de Qt: cualquier clase que quiera usar `connect()` debe tenerla.

Crea `mainwindow.cpp` y empieza con el constructor:

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

Fíjate en `new QWidget(this)`: pasar `this` como padre le dice a Qt "este objeto vive mientras viva la ventana, y cuando la ventana se destruya, destrúyelo también a él"; es el sistema de gestión de memoria en árbol de parentesco de Qt, que ahorra casi siempre `delete` manuales sobre los widgets. `connect()` conecta una **señal** (`QTimer::timeout`, emitida cada vez que el timer vence; `QPushButton::clicked`, emitida al hacer click) con un **slot** (una función miembro que reacciona); es el mecanismo con el que, en Qt, un evento se comunica con el código que debe reaccionar a él, y sobre el que construiremos la comunicación segura entre threads en los módulos siguientes.

El slot inofensivo, el latido:

```cpp
void MainWindow::updateHeartbeat() {
    m_heartbeatCount++;
    m_labelHeartbeat->setText(QString("Heartbeat: %1").arg(m_heartbeatCount));
}
```

Nada especial: cada 100 ms el número sube en uno y la etiqueta se actualiza. Es tu sensor visual para saber si el thread de la GUI sigue respirando.

El trabajo pesado, deliberadamente ingenuo:

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

No nos interesa que sea eficiente, solo nos interesa que ocupe la CPU durante algunos segundos de manera reproducible.

El slot que bloquea todo:

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

Este slot está conectado al `clicked()` de un `QPushButton`, así que se ejecuta en el thread que posee ese botón: el thread principal, el mismo que hace correr el event loop y que actualiza `m_labelHeartbeat`. Hasta que `countPrimes` no retorne, ese thread no puede hacer **ninguna otra cosa**: no redibujar la ventana, no procesar el timer del latido, no responder al sistema operativo. Aumenta o disminuye `30'000'000` según qué tan rápida sea tu máquina, hasta que el cálculo dure al menos 3-4 segundos.

Por último, `main.cpp`:

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

`app.exec()` es, literalmente, el event loop del que hablamos en el artículo anterior: de aquí en adelante, hasta que la aplicación se cierre, es este ciclo —no tu código— el que decide cuándo se llama a cada slot.

Compila y ejecuta:

```bash
cmake -S . -B build
cmake --build build
./build/ui_freeze_demo
```

Deja la ventana abierta unos segundos y observa el número subir con regularidad. Luego presiona el botón "Run heavy computation": el número se detiene **exactamente** en el instante del click, la ventana probablemente se pone gris (especialmente si intentas arrastrarla o redimensionarla mientras el cálculo está en curso, pruébalo, es instructivo), y solo cuando el cálculo termina ves al número retomar su ascenso desde donde se había detenido, todo de golpe, como si el tiempo transcurrido en el medio nunca hubiera existido para el thread de la GUI.

No es un concepto abstracto: viste con tus propios ojos que "un thread único" no es una limitación teórica de Qt, sino un comportamiento físico observable de tu programa. En el próximo módulo retomamos este mismo archivo `mainwindow.cpp` y lo modificamos para mover `countPrimes` a un `QThread` separado, usando el patrón del worker object con `moveToThread()`: verás el latido seguir subiendo, imperturbable, mientras el cálculo corre en segundo plano; la cura para la enfermedad que acabas de diagnosticar con tus propias manos.

---

*El código fuente completo de ambos proyectos está disponible en el repositorio que acompaña este curso, en las carpetas `project-A-race-condition` y `project-B-ui-freeze`.*
