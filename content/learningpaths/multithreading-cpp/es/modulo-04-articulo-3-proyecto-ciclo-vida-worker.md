---
title: "Proyecto: ciclo de vida completo de un worker — arranca, pausa, reanuda, detén"
description: "Multithreading en C++ con Qt — Módulo 4 — Proyecto"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Proyecto: ciclo de vida completo de un worker — arranca, pausa, reanuda, detén

Construyamos una aplicación Qt Widgets con un worker persistente — el mismo patrón `moveToThread()` que conoces desde el Módulo 1 — que ejecuta un procesamiento por pasos (200 pasos, cada uno con un pequeño cálculo CPU-bound seguido de una breve pausa configurable), controlable con cuatro comandos desde la ventana: **Start**, **Pause**, **Resume**, **Stop**. Además, dos controles dedicados demuestran `QMetaObject::invokeMethod` en sus dos variantes principales: una para cambiar en caliente la velocidad de ejecución, otra para consultar sincrónicamente el paso actual.

**Requisitos**: Qt 6 con el componente **Widgets**, ninguna dependencia adicional respecto a los módulos anteriores.

## Paso 1 — El esqueleto del proyecto

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

Ninguna sorpresa aquí: es la misma forma de siempre. La sustancia de hoy está toda en la arquitectura interna de `CyclicWorker`.

## Paso 2 — El worker: la declaración, y una distinción que importa más que cualquier otra línea de este proyecto

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

Detente en la división entre `pause()`/`resume()`/`stop()`, declarados como métodos públicos ordinarios, y `start()`, el único declarado `public slots`. No es un capricho estilístico: es la lección más importante de todo este proyecto, y para contártela bien debo antes mostrarte el error que cometí al construirlo.

### La versión equivocada que escribí primero (y el deadlock que resultó)

Mi primer borrador conectaba pausa, reanudación y stop exactamente como esperarías desde los Módulos 1 y 2 — tres señales en la ventana, conectadas vía `connect()` a tres slots del worker:

```cpp
//--- WRONG VERSION, do not use it ---
connect(this, &MainWindow::requestPause, m_worker, &CyclicWorker::pause);
connect(this, &MainWindow::requestResume, m_worker, &CyclicWorker::resume);
connect(this, &MainWindow::requestStop, m_worker, &CyclicWorker::stop);
```

Compilaba sin errores. Ejecutaba la secuencia Start → Pause → Resume sin problemas aparentes. Pero en el momento en que mi test automatizado pulsaba "Pause" y luego, con el worker todavía dormido, pulsaba "Stop", la aplicación entera se bloqueaba para siempre — ningún crash, ningún mensaje, simplemente detenida, exactamente el síntoma silencioso de un deadlock que el Módulo 2 te enseñó a reconocer.

La causa, una vez encontrada, es evidente — y es un corolario directo de los dos artículos anteriores de este módulo combinados: mientras el worker está en pausa, su `start()` está bloqueada dentro de `m_pauseCondition.wait(&m_mutex)`. Esa llamada **no es un giro del event loop**: es un bloqueo a nivel de sistema operativo, el hilo está literalmente suspendido ahí, no está ejecutando `exec()`, no está procesando ninguna cola de eventos. Una señal `requestStop()` conectada con una `QueuedConnection` (automática, porque emisor y receptor están en hilos distintos) deposita fielmente su propio evento en la cola del worker — pero nadie vendrá jamás a leerlo, porque el hilo que debería hacerlo está detenido dentro de un `wait()` que nadie, a su vez, despierta. Es exactamente la misma familia de problema que la trampa de `deleteLater()` que viste en el Módulo 1: un evento depositado en una cola que nadie procesará jamás, porque su hilo propietario no está girando.

### La corrección: llamadas directas, como para el buffer compartido del Módulo 2

La solución, con la ventaja de la retrospectiva, ya estaba escrita en el Módulo 2, solo que no la había reconocido como aplicable también aquí. ¿Recuerdas los métodos de producción, consumo y cierre del buffer compartido? No eran slots: eran métodos públicos ordinarios, llamados **directamente** desde hilos distintos, seguros no porque pasaran por la meta-máquina de señales y slots, sino porque cada línea que tocaban ya estaba protegida por su propio `QMutex` interno. La misma lógica idéntica se aplica a `pause()`, `resume()` y `stop()` de hoy: son seguras de llamar directamente desde el hilo GUI, sobre un objeto que vive en otro hilo, porque lo único que tocan es estado protegido por `m_mutex` o atómico (`m_stop`) — no necesitan el event loop del worker para ejecutarse con seguridad, y precisamente por eso **funcionan incluso cuando ese event loop no está girando**, como durante la pausa.

`start()`, por el contrario, debe seguir siendo un slot alcanzado mediante `connect()` — porque a diferencia de pause/resume/stop, ella **sí debe ejecutarse realmente en el hilo gestionado por el QThread**, no en el del llamador: es el cuerpo entero del trabajo del worker, no solo un cambio de flag. Una llamada directa a `m_worker->start()` desde el hilo GUI ejecutaría el ciclo completo de 200 pasos **en el propio hilo GUI** — exactamente el freeze que el Módulo 1 te enseñó a curar desde el primer día.

## Paso 3 — El worker: start(), pause(), resume(), stop()

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

El cuerpo del ciclo ya debería resultarte familiar: el control del flag de stop al comienzo, el bloque de pausa con `while` y `wait()`, un pequeño cálculo CPU-bound que representa el "trabajo real" de cada paso, y la emisión del progreso. La última línea, `QCoreApplication::processEvents()`, la explicamos enseguida en el siguiente paso.

Mira `stop()` con atención, porque es la aplicación directa de la lección del Módulo 2 al problema de hoy: escribir `m_stop.store(true)` por sí solo resolvería el caso en que el worker está **activo**, dentro de su propio ciclo de trabajo — en el próximo control del flag, saldría limpiamente. Pero si el worker en ese momento está **dormido dentro de `wait()`** porque está en pausa, esa sola escritura no lo alcanza: seguiría durmiendo para siempre, porque nadie lo despertó para que volviera a comprobar nada, flag de stop incluido. `stop()`, por tanto, no se limita a escribir el flag: también fuerza `m_paused` a `false` y llama a `wakeAll()` — despertando a quien estuviera esperando, que en ese momento volverá a comprobar la condición de su propio `while`, verá `m_stop` en `true`, y saldrá limpiamente del ciclo de espera antes incluso de volver a entrar en el cuerpo del trabajo.

## Paso 4 — setInterval() y currentStep(): la demo de invokeMethod, y por qué se necesita processEvents()

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

Nada sorprendente en la implementación: dos métodos `Q_INVOKABLE`, protegidos por el mismo mutex que el resto del estado. El punto interesante está en **cómo** los llamará la ventana dentro de poco — con `QMetaObject::invokeMethod`, no con un `connect()`. Y esto nos lleva de vuelta a esa línea aislada al final del ciclo de `start()`, `QCoreApplication::processEvents()`.

Tanto `Qt::QueuedConnection` como `Qt::BlockingQueuedConnection` para `invokeMethod` funcionan depositando un evento en la cola del hilo receptor, y ese evento se ejecuta solo cuando el event loop de ese hilo llega a procesarlo. Pero `start()` es **ella misma** un único slot largo que ocupa el hilo del worker de principio a fin del ciclo — mientras corre, ese hilo **no está ejecutando `exec()`** en el sentido en que normalmente lo entiendes: está ejecutando el cuerpo de `start()`, que a su vez fue invocada *desde* un evento procesado por el event loop. Mientras `start()` no retorne, el event loop del worker no vuelve a su propio ciclo de recepción — lo que significa que cualquier evento nuevo que llegue mientras tanto (una llamada `invokeMethod` hacia `setInterval()` o `currentStep()`, por ejemplo) permanecería en cola, sin procesar, hasta el final de los 200 pasos. Para una `Qt::QueuedConnection` esto sería solo un retraso molesto; para una `Qt::BlockingQueuedConnection` sería un **bloqueo de la GUI durante toda la duración del ciclo** — exactamente el tipo de freeze que este curso entero te ha enseñado a evitar, pero esta vez causado no por un cálculo pesado directamente sobre la GUI, sino por un detalle más sutil del event loop del worker.

`QCoreApplication::processEvents()`, llamada una vez por paso, es el remedio: "bombea" manualmente la cola de eventos del hilo actual, dando una ventana de oportunidad a cualquier evento pendiente — incluidos los `invokeMethod` hacia este mismo objeto — para ser procesado antes de proceder al paso siguiente. Es una técnica documentada y legítima para slots largos que necesitan permanecer parcialmente reactivos, pero vale la pena ser honestos sobre sus límites: **no ayuda en absoluto durante la pausa**. Dentro de `wait()`, el hilo está bloqueado a nivel de sistema operativo, no está ejecutando ningún código Qt — no hay ningún punto en el que `processEvents()` pudiera ser llamada, porque el control no está en manos de tu código en ese instante. Y es precisamente por este motivo — no por simetría estilística — que `pause()`, `resume()` y `stop()` siguen siendo llamadas directas: son el único mecanismo que alcanza al worker en **todos** sus estados, pausa incluida, mientras que `invokeMethod` hacia este worker funciona solo porque hemos abierto deliberadamente una ventana para él dentro del ciclo activo.

## Paso 5 — El header de la ventana

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

Observa que hay una sola señal, `requestStart()` — coherente con todo lo que acabas de ver en el Paso 2: es el único comando que realmente necesita pasar por el event loop, porque es el único que debe hacer que se ejecute código **en el hilo del worker** en lugar de limitarse a modificar su estado interno.

## Paso 6 — El constructor: poner en pie al worker, sin arrancarlo de inmediato

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

Observa una diferencia deliberada respecto a los Módulos 1 y 2: aquí **no** conectamos `QThread::started` directamente a `start()`. El worker, una vez arrancado el hilo, permanece inactivo — su event loop ya está activo y listo para recibir comandos (incluidas las llamadas directas a `pause()`/`resume()`/`stop()`, que como sabes ni siquiera lo necesitan) — hasta que el usuario realmente pulsa el botón "Start". Es el estado "Idle" del diagrama de abajo, el previo a cualquier trabajo.

## Paso 7 — Los slots de la ventana, incluidas las dos demostraciones de invokeMethod

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

Y finalmente las dos demostraciones prometidas desde la introducción del módulo:

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

El primero es fire-and-forget: el hilo GUI publica el comando y continúa de inmediato, sin esperar confirmación — perfecto para un cambio de configuración que no necesita ser síncrono. El segundo, en cambio, usa `Qt::BlockingQueuedConnection` con `Q_RETURN_ARG`: el hilo GUI se detiene realmente hasta que `currentStep()` haya ejecutado en el hilo del worker y haya devuelto un valor — que podemos entonces mostrar de inmediato en la etiqueta, con la certeza de que es el dato real de ese instante, no uno obsoleto. Ambas funcionan sin freeze perceptible de la GUI gracias al `QCoreApplication::processEvents()` insertado en el ciclo de `start()` en el Paso 4, que le da al worker, entre un paso y otro, la ocasión de procesar exactamente estos dos comandos.

## Paso 8 — El destructor: la misma disciplina del Módulo 2, aplicada aquí

```cpp
MainWindow::~MainWindow() {
    m_worker->stop();   // direct call: reaches the worker even while paused

    m_thread->quit();
    m_thread->wait();

    delete m_worker;
}
```

Tres líneas, pero cada una hace un trabajo preciso, y es el mismo orden ya visto en el proyecto guiado del Módulo 2: primero nos aseguramos de que el worker nunca pueda quedarse dormido en espera para siempre (`stop()`, que como sabes fuerza `m_paused` a `false` y llama a `wakeAll()` antes incluso de escribir el flag de stop en su totalidad), **luego** pedimos al hilo que se detenga con `quit()`, **luego** esperamos con `wait()` a que realmente lo haya hecho. Si invirtieras el orden — `quit()` antes que `stop()` — y el worker estuviera en ese momento dormido en pausa, el hilo nunca tendría la posibilidad de salir de su propio ciclo para alcanzar el punto en que la solicitud de `quit()` se atiende de verdad, y `wait()` bloquearía el cierre de la ventana para siempre.

## Paso 9 — Compila, ejecuta, y observa el ciclo de vida completo

```bash
cmake -S . -B build
cmake --build build
./build/worker_lifecycle_demo
```

Pulsa "Start": la barra de progreso comienza a avanzar, un paso a la vez, y la etiqueta de estado muestra "Running". Pulsa "Pause" a mitad de camino: el avance se detiene de inmediato, la etiqueta pasa a "Paused" — y si observas el uso de CPU del proceso mientras está en pausa, lo verás bajar casi a cero, la prueba directa de que el worker está durmiendo dentro de `wait()` en lugar de volver a comprobar el flag en un bucle activo que desperdiciaría un núcleo entero sin hacer nada. Pulsa "Resume": el avance continúa exactamente desde donde se había detenido. Prueba también los dos controles de `invokeMethod`: cambia el intervalo con el spin box y pulsa "Aplicar" mientras el worker está en ejecución — verás cambiar la velocidad de avance de la barra desde el siguiente paso, prueba de que el comando ha llegado; pulsa "Consultar paso" y observa que la etiqueta se actualiza de inmediato con el paso exacto, leído de forma síncrona desde el hilo del worker. Finalmente pulsa "Stop" — prueba a hacerlo tanto mientras el worker está en ejecución como mientras está en pausa, para ver con tus propios ojos que en ambos casos el cierre es limpio e inmediato, nunca un bloqueo. Cierra la ventana: la aplicación termina al instante, sea cual sea el estado del worker en ese momento.

![Worker lifecycle diagram: which command triggers each transition, and how it reaches the worker](modulo-04/20-worker-lifecycle-start-pause-stop.png)

El diagrama resume todo el recorrido que acabas de construir: cada transición se dispara con un clic en la GUI, pero el mecanismo con el que alcanza al worker cambia según lo que se necesite — una señal queued para `start()` (que debe ejecutarse en el hilo correcto), llamadas directas para pausa/reanudación/stop (que deben funcionar incluso cuando el event loop del worker no está girando).

## Lo que acabas de demostrarte a ti mismo

Has construido un worker con un ciclo de vida completo y controlable — no solo "arranca y termina solo" como en los módulos anteriores, sino arrancable, pausable, reanudable y detenible bajo demanda, en cualquier combinación, sin bloquearse jamás. Has visto, con un deadlock real reproducido y resuelto, por qué la elección entre "conexión queued" y "llamada directa" no es una cuestión de estilo sino que depende de un hecho preciso: si el hilo receptor tiene en ese momento su propio event loop libre para girar o no. Has usado `QMetaObject::invokeMethod` en sus dos variantes principales, entendiendo por qué la variante bloqueante podría haber congelado tu GUI si no hubieras entendido — y resuelto — el motivo por el que un único slot largo puede hambrear el event loop de su propio hilo.

No es casualidad que el deadlock relatado en este artículo haya nacido precisamente en el punto de encuentro entre dos conceptos que parecían ya adquiridos — la queued connection del Módulo 1, la wait condition del Módulo 2 — aplicados juntos en un contexto nuevo: es casi siempre ahí, en la intersección entre dos herramientas que conoces bien por separado, donde se anidan los bugs más instructivos.

---

*El código fuente completo de este proyecto está disponible en el repositorio que acompaña este curso, en la carpeta `project-F-worker-lifecycle`.*
