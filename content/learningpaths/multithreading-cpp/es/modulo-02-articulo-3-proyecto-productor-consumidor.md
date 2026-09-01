---
title: "Proyecto: productor, consumidor, y el buffer que los mantiene en equilibrio"
description: "Multithreading en C++ con Qt — Módulo 2 — Proyecto"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Proyecto: productor, consumidor, y el buffer que los mantiene en equilibrio

Construyamos una aplicación Qt Widgets con tres threads activos simultáneamente: el thread de la GUI (que ya conoces bien), un thread **Productor** que genera un nuevo valor a intervalos aleatorios y lo inserta en el buffer, y un thread **Consumidor** que lo extrae y simula procesarlo.

![Producer-consumer with a bounded buffer](modulo-02/10-producer-consumer-buffer.png)

Una barra de progreso muestra la ocupación del buffer en tiempo real, y una lista de log registra cada producción y cada consumo.

## Paso 1 — El esqueleto del proyecto

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

Cinco archivos fuente hoy, no tres como en los proyectos anteriores: `SharedBuffer` es una clase aparte, distinta tanto del Productor como del Consumidor, porque — a diferencia del proyecto del módulo anterior, donde todo el estado vivía dentro de un único worker — hoy el estado compartido es precisamente el objeto que *ambos* threads deben poder alcanzar.

## Paso 2 — El buffer compartido: el corazón del proyecto

Crea `sharedbuffer.h`:

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

Detente en la declaración: `produce()` y `consume()` **no son slots**. Son métodos públicos ordinarios, pensados para ser llamados **directamente** desde el código del Productor y del Consumidor — no mediante una señal. Es una diferencia de estilo importante respecto al módulo anterior, donde *todo* pasaba por señales y slots: allí era necesario porque simplemente estábamos intercambiando mensajes entre threads. Aquí, en cambio, `SharedBuffer` es un objeto cuya seguridad en presencia de varios threads está garantizada **internamente**, por su `QMutex` — puede ser llamado directamente desde cualquier thread, en cualquier momento, exactamente como harías con cualquier clase C++ thread-safe escrita sin Qt. Las señales siguen siendo la herramienta adecuada para la *notificación* hacia la GUI (`occupancyChanged`), no para el acceso al dato en sí.

Ahora `sharedbuffer.cpp`:

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

Reconoces el patrón del artículo anterior: el `while`, no el `if`; el mutex siempre adquirido antes de tocar `m_queue` o `m_closed`; el despertar dirigido (`wakeOne`) en los caminos normales, el despertar total (`wakeAll`) solo en `close()`, donde queremos que **cualquiera** que esté esperando, productor o consumidor, despierte y se entere.

## Paso 3 — El Productor

`producer.h`:

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

`producer.cpp`:

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

Nota lo que **falta** respecto al proyecto del módulo anterior: ningún flag de parada dedicado. El ciclo vive mientras `produce()` devuelva `true`, y `produce()` devuelve `false` exactamente cuando (y solo cuando) se ha llamado a `SharedBuffer::close()`. La condición de terminación del thread queda enteramente delegada al objeto compartido — una decisión de diseño que mantiene la lógica del ciclo de vida en un único lugar en vez de repartida entre varias clases.

## Paso 4 — El Consumidor

`consumer.h` y `consumer.cpp` siguen la misma estructura, de forma especular:

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

El consumidor es deliberadamente un poco más lento e irregular que el productor (intervalos 300-1100ms frente a 200-800ms): es lo que te permitirá ver el buffer llenarse visiblemente en la barra de progreso en lugar de quedarse siempre vacío.

## Paso 5 — La ventana: conectar los tres threads

`mainwindow.h`:

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

En el constructor, tras montar los widgets (barra de progreso, lista de log — nada nuevo respecto a los proyectos anteriores), la parte que importa:

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

Observa dónde vive `m_buffer`: se construye con `this` (la ventana) como padre, así que su thread affinity sigue siendo la del thread de la GUI — y está perfectamente bien así, porque como viste en el Paso 2 nadie llama a sus métodos `produce()`/`consume()` mediante señales (donde la affinity importaría para decidir Direct o Queued): se llaman directamente, desde threads distintos, confiando en el `QMutex` interno para la seguridad. La señal `occupancyChanged`, en cambio, se emite desde dentro de `produce()`/`consume()` — por lo tanto desde el thread del Productor o del Consumidor, según quién acaba de actuar — hacia un slot que vive en el thread de la GUI: aquí la thread affinity **sí importa**, y Qt elige automáticamente una conexión queued, exactamente igual que en el módulo anterior, independientemente de dónde "viva" nominalmente el objeto `SharedBuffer` que emitió la señal.

## Paso 6 — Los slots de la ventana

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

Nada nuevo aquí — son slots normales ejecutados en el thread de la GUI, poblados con seguridad gracias a las conexiones queued mencionadas arriba.

## Paso 7 — El destructor: el orden que realmente importa

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

Este es el punto en el que el ciclo de vida de un worker thread visto en el módulo anterior y las wait conditions de hoy se encuentran, y merece la pena explicar por qué el orden de estas líneas no es intercambiable. Si en este momento el Productor está dormido dentro de `produce()` (buffer lleno, esperando en `notFull`), su `start()` **nunca volverá por sí sola**: está bloqueada ahí, no en su event loop. Esto significa que el thread del Productor no está en condiciones de procesar **ningún otro evento**, incluida una eventual solicitud de `quit()` puesta en cola antes. `close()` es lo que desbloquea físicamente la situación: despierta a quien esté esperando, su `start()` puede por fin evaluar `if (m_closed) return false;` y retornar, y **solo entonces** el thread vuelve a su event loop, libre para recibir y ejecutar `quit()`. Si invirtieras el orden — `quit()` antes de `close()` — no pasaría nada catastrófico (la solicitud de salida simplemente quedaría en cola, inocua), pero el verdadero trabajo de desbloqueo lo seguiría haciendo solo `close()`: es ella, no `quit()`, la clave de un apagado limpio cuando hay wait conditions de por medio.

## Paso 8 — Compila, ejecuta, observa el almacén respirar

```bash
cmake -S . -B build
cmake --build build
./build/producer_consumer_demo
```

Mira la barra de progreso: sube a saltos cuando el Productor inserta un valor, baja cuando el Consumidor extrae uno. Como el Consumidor es en promedio más lento, con el tiempo tenderá a ver el buffer llenarse hacia la capacidad máxima (5) más a menudo que vaciarse del todo — es exactamente el comportamiento que la teoría de los artículos anteriores predice, ahora observable en pantalla. Mira también la lista de log: los valores aparecen siempre en el mismo orden en que fueron producidos, tanto en la columna "Produced" como en la de "Consumed" — el buffer, al ser una cola (`QQueue`, primero en entrar primero en salir), preserva el orden, una propiedad que en tu trabajo con pipelines de imágenes es casi siempre la que quieres (el frame número 10 debe procesarse y emitirse antes que el frame número 11, no después).

Cierra la ventana y observa que la aplicación termina de inmediato, sin quedarse colgada: es la prueba directa de que la secuencia `close()` + `quit()` + `wait()` del Paso 7 funciona como se prometió, incluso si en ese preciso instante uno de los dos threads estaba dormido esperando dentro del buffer.

## Qué acabas de demostrarte a ti mismo

Has construido, y verificado con tus propios ojos, el patrón de sincronización más citado en la historia de los sistemas concurrentes — no como ejercicio de manual, sino con dos threads reales, un mutex real, dos wait conditions reales, y un apagado que no deja nada colgado. También has visto una distinción de diseño importante respecto al módulo anterior: no todo tiene que pasar por señales y slots — un objeto con su propia sincronización interna puede ser llamado directamente desde varios threads, y a menudo es la elección más natural cuando el estado compartido es el punto central del problema, no un detalle a esconder detrás de mensajes.

Si el productor-consumidor de hoy te ha despertado la curiosidad, una excelente forma de profundizar por tu cuenta es extender el proyecto a **varios productores o varios consumidores** sobre el mismo buffer: el código de `SharedBuffer` no cambia ni una línea (ya es correcto para ese caso, `wakeOne()` y el ciclo `while` lo garantizan), pero observar cómo se comporta con tres consumidores en lugar de uno es un ejercicio que vale más que muchas páginas de teoría sobre la starvation.

---

*El código fuente completo de este proyecto está disponible en el repositorio que acompaña a este curso, en la carpeta `project-D-producer-consumer`.*
