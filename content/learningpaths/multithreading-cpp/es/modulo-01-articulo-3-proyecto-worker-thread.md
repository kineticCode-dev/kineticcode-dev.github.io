---
title: "Proyecto: curar el freeze de verdad, moviendo el cálculo a un worker thread"
description: "Multithreading en C++ con Qt — Módulo 1 — Proyecto"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Proyecto: curar el freeze de verdad, moviendo el cálculo a un worker thread

Retomamos exactamente el proyecto del freeze del módulo anterior. Misma ventana, mismo latido, mismo cálculo idéntico de números primos —solo cambia *dónde* se ejecuta. Si todavía tienes abierta la carpeta de trabajo de aquel proyecto, puedes partir de ahí; si no, crea una carpeta nueva y sigue los pasos desde cero: en cualquier caso son pocos minutos de trabajo.

## Paso 1 — El esqueleto del proyecto

`CMakeLists.txt`, idéntico en su forma al del proyecto anterior (sin sorpresas: no estamos cambiando el sistema de build, solo la arquitectura interna del programa):

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

La única novedad es que ahora el cálculo pesado vive en su propio archivo separado —`primecalculator.h`/`.cpp`— en lugar de dentro de `MainWindow`. No es un capricho de estilo: es la consecuencia directa de lo visto en los artículos anteriores. El worker tiene que ser una clase aparte, distinta de `MainWindow`, precisamente porque es ella (y solo ella) la que moveremos a otro thread.

## Paso 2 — El worker: lógica pura, sin ninguna idea de "thread" dentro de sí

Crea `primecalculator.h`:

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

Detente un momento en `setLimit()`: **no** es un slot, es un método público ordinario. La razón la vimos en el artículo anterior: lo llamaremos desde el thread de la GUI, pero **antes** de arrancar el thread gestionado —en ese preciso momento todavía no hay ninguna concurrencia en marcha (el worker no está ejecutando nada en ningún thread), así que asignar directamente una variable miembro es totalmente seguro. Si lo llamaras *después* de haber arrancado el thread, en cambio, estarías escribiendo `m_limit` desde un thread mientras potencialmente `start()` lo está leyendo desde otro —de nuevo, exactamente la data race que ya reconoces de memoria.

Ahora `primecalculator.cpp` —el cuerpo del cálculo es el mismo algoritmo idéntico del proyecto anterior, con el añadido de una señal de progreso periódica:

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

La señal `progress` es la primera demostración real de comunicación desde el worker hacia el resto del programa **durante** el cálculo, no solo al final —y es un `emit` inofensivo de escribir aquí porque, como sabes por el artículo anterior, Qt lo entregará en cola al thread correcto sin que tengas que hacer nada más.

## Paso 3 — El header de la ventana: añade thread, worker, y la señal-mensajera

Crea (o modifica, si retomas el proyecto anterior) `mainwindow.h`:

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

La señal `requestComputation()`, declarada aquí en `MainWindow`, es la "mensajera" de la que hablábamos en el artículo anterior: `MainWindow` nunca llamará directamente a `m_worker->start()` (sería una llamada de función ordinaria, ejecutada en el thread llamante —incorrecto, y encima peligroso si tocara datos del worker). En su lugar, emitirá esta señal, conectada al slot del worker: la entrega segura, como siempre, la hace Qt.

## Paso 4 — El constructor: aquí ocurre toda la conexión

En `mainwindow.cpp`, el cuerpo de la ventana (etiquetas, botón, barra de progreso, latido) es idéntico en su forma al del proyecto anterior, con el añadido de una `QProgressBar`. La parte nueva, en la que vale la pena concentrarse, es la conexión del worker:

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

Sigue el orden con atención, porque no es casual: primero construyes el worker **sin padre**, luego fijas su estado inicial (todavía seguro, el thread no ha arrancado), **después** lo mueves con `moveToThread()`, **después** conectas las señales (las conexiones funcionan correctamente sin importar cuándo las hagas, pero conectarlas antes de arrancar el thread es buena costumbre: evitas la posibilidad, remota pero conceptualmente incómoda, de que el thread arranque y termine su trabajo antes incluso de que hayas conectado a quien debe recibir el resultado), y solo al final llamas a `m_thread->start()`. A partir de este momento, el thread gestionado está vivo, a la espera —su event loop gira, pero no hace nada hasta que llega una señal que procesar.

## Paso 5 — Los slots de la ventana

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

Fíjate en `onButtonClicked()`: deshabilita el botón antes de emitir la solicitud. No es decoración —es la primera defensa frente a un problema real: sin esta línea, un clic repetido mientras el cálculo anterior todavía está en curso emitiría una segunda `requestComputation()`, que Qt pondría igualmente en cola de forma segura (sin crash), pero que haría ejecutar `start()` por segunda vez en secuencia sobre el mismo worker, sumando trabajo a trabajo en lugar de rechazarlo o sustituirlo. Gestionar "qué pasa si el usuario pide un nuevo trabajo mientras uno está en curso" con una cancelación de verdad es materia de un módulo posterior; hoy nos limitamos, correctamente, a impedir el problema de raíz deshabilitando el botón.

## Paso 6 — El destructor: el apagado limpio

```cpp
MainWindow::~MainWindow() {
    m_thread->quit();
    m_thread->wait();
    delete m_worker;
}
```

Tres líneas que resumen todo el discurso sobre el ciclo de vida hecho en el artículo anterior: pides al event loop del thread gestionado que se detenga, esperas a que lo haya hecho de verdad, y solo entonces destruyes el worker con un `delete` ordinario —seguro, porque después de `wait()` ningún otro thread puede ya tocarlo.

## Paso 7 — Compila, ejecuta, y observa lo que YA NO ocurre

```bash
cmake -S . -B build
cmake --build build
./build/worker_thread_demo
```

Pulsa el botón. Observa cómo la barra de progreso avanza a saltos (las señales `progress` que llegan del worker) mientras, al mismo tiempo, el latido de arriba sigue subiendo sin la menor vacilación —ni una interrupción, ni una ralentización perceptible, nada. Prueba también a redimensionar o mover la ventana mientras el cálculo está en curso: responde con normalidad, algo impensable en el proyecto anterior durante ese mismo cálculo idéntico.

Si quieres ver el contraste de forma todavía más clara, mantén abiertos los dos proyectos y ejecuta el mismo número idéntico de primos a buscar en ambos, uno tras otro: la diferencia no está en la duración del cálculo —que es idéntica, porque la CPU tiene que hacer de todas formas el mismo trabajo— sino en la *capacidad de respuesta de la ventana* durante ese tiempo. Aquí no hemos acelerado nada (un solo thread de cálculo, exactamente como antes), solo hemos apartado ese cálculo del camino del event loop que tiene que ocuparse de la ventana.

## Qué acabas de demostrarte a ti mismo

Has construido, con tus propias manos y entendiendo cada línea, el patrón que resuelve estructuralmente el problema con el que se abrió este curso. Has visto la diferencia práctica entre el objeto `QThread` y el thread que gestiona, has movido un worker con `moveToThread()` y has comprobado que sus slots se ejecutan de verdad donde esperas, has comunicado en ambas direcciones a través de señales sin escribir un solo mutex, y has gestionado un apagado limpio sin pérdidas. En el próximo módulo introducimos `QMutex` y sus parientes —porque el día en que tu worker tenga que compartir datos mutables con otros threads simultáneamente (no solo intercambiar mensajes vía señales, que hoy te ha mantenido a salvo de cualquier sección crítica), necesitarás esas herramientas.

---

*El código fuente completo de este proyecto está disponible en el repositorio que acompaña a este curso, en la carpeta `project-C-worker-thread`.*
