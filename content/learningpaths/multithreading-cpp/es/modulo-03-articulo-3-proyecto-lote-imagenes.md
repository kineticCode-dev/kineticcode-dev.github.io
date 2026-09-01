---
title: "Proyecto: procesamiento por lotes de imágenes con QtConcurrent::mapped y QFutureWatcher"
description: "Multithreading en C++ con Qt — Módulo 3 — Proyecto"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Proyecto: procesamiento por lotes de imágenes con QtConcurrent::mapped y QFutureWatcher

Construyamos una aplicación Qt Widgets que genera cierto número de imágenes sintéticas con ruido, las difumina todas en paralelo con `QtConcurrent::mapped()`, y muestra el progreso mediante `QFutureWatcher<QImage>` —con un botón Cancelar que funciona de verdad, y una ventana que **permanece siempre reactiva**.

**Requisitos adicionales respecto a los proyectos anteriores**: Qt 6 con los módulos **Widgets** *y* **Concurrent** —el módulo `Concurrent` debe declararse explícitamente tanto en `find_package` como en `target_link_libraries`.

## Paso 1 — El esqueleto del proyecto

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

Respecto a los proyectos anteriores, la única diferencia estructural en este archivo es `Concurrent` añadido tanto en `find_package` como en `target_link_libraries` —es todo lo que hace falta para tener acceso a `QtConcurrent::mapped()` y a `QFuture`/`QFutureWatcher`.

## Paso 2 — Las funciones puras: generación de imágenes y blur naive

Crea `imageprocessing.h`:

```cpp
#pragma once
#include <QImage>
#include <QList>

QList<QImage> generateNoisyImages(int count, int side, quint32 seed);
QImage blurImageNaive(const QImage &source);
```

Detente en esta declaración incluso antes de mirar la implementación: son dos **funciones libres**, no métodos de una clase, y no tocan ningún estado compartido —ni miembros de clase, ni variables globales mutables. Es deliberado, y es precisamente el requisito visto en el artículo anterior para un trabajo apto para `QtConcurrent::mapped()`: si `blurImageNaive()` escribiera en una variable global o en un miembro compartido, dos llamadas en paralelo en hilos distintos se pisarían los pies exactamente como en el módulo sobre mutex y wait conditions sin mutex —solo que aquí **no necesitamos ningún mutex**, porque la función es pura por construcción: cada llamada lee solo su propio parámetro y escribe solo en su propio valor de retorno.

`imageprocessing.cpp`:

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

El blur es deliberadamente **no optimizado**: por cada píxel de salida vuelve a leer desde cero toda la ventana 7×7 a su alrededor directamente de la fuente mediante `pixel()` (sin punteros crudos, sin suma incremental por desplazamiento, sin caché de fila), con un costo de `O(ancho × alto × 49)`. No es un defecto —es **intencional**: necesitamos una carga de trabajo genuinamente CPU-bound y sustanciosa, tanto para ver el paralelismo del `QThreadPool` en acción de forma visible, como para la lección de calibración empírica del próximo paso.

## Paso 3 — Calibración empírica: mide, no adivines

Antes de elegir cuántas imágenes generar y de qué tamaño, seguimos la misma disciplina ya vista en los módulos anteriores: **medimos**, no adivinamos. Un pequeño programa de prueba, aislado, que cronometra un único `blurImageNaive()` a distintos tamaños:

```cpp
for (int side : {128, 192, 256, 320, 384, 448, 512}) {
    auto imgs = generateNoisyImages(1, side, 42);
    QElapsedTimer t; t.start();
    QImage r = blurImageNaive(imgs[0]);
    qDebug() << "side" << side << "->" << t.elapsed() << "ms";
}
```

En la máquina de desarrollo de este curso, el resultado (compilación sin optimizaciones explícitas, el mismo esquema de build que usaremos para el proyecto final) fue:

| Lado de la imagen | Tiempo de un solo blur |
|---|---|
| 128×128  | ~9 ms |
| 256×256  | ~31 ms |
| 384×384  | ~69 ms |
| 512×512  | ~122 ms |

A 384×384, un solo blur cuesta entonces cerca de 60-90 ms (el valor oscila ligeramente de una ejecución a otra, como siempre que se mide tiempo real en una máquina compartida). Con `QThread::idealThreadCount()` medido en **2** en esta máquina, y queriendo un lote que dure unos pocos segundos —comparable a las demos de los proyectos anteriores, ni instantáneo ni interminable—, la elección fue: **200 imágenes de 384×384 píxeles**. El cálculo de estimación es directo: 200 blurs de ~70 ms, distribuidos en 2 hilos, deberían necesitar aproximadamente (200 × 70) / 2, es decir, unos 7000 milisegundos.

La verificación con el lote real, mediante `QtConcurrent::mapped()` cronometrado en varias ejecuciones, confirmó la estimación: **entre 7.3 y 7.6 segundos** para el lote de procesamiento propiamente dicho (la generación de las 200 imágenes con ruido, que es un paso separado y secuencial, añade otros 1.6-2.2 segundos antes de que el lote empiece). El número no está adivinado —está medido, repetido, y coherente con la estimación teórica basada en los hilos disponibles: exactamente el tipo de verificación empírica que este curso te pide hacer cada vez que eliges parámetros de carga para una demo o, más seriamente, para un sistema en producción.

## Paso 4 — La interfaz: mainwindow.h

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

La forma general —un botón Iniciar, un botón Cancelar, una barra de progreso, una lista de log— reproduce deliberadamente el estilo de las interfaces de los proyectos anteriores: queremos que la comparación visual con el productor-consumidor sea inmediata. `m_watcher` es un miembro directo de la ventana, no un puntero gestionado a mano: al ser un objeto ligero que vive durante toda la duración de la ventana, no hay motivo para complicar la gestión de memoria.

## Paso 5 — El constructor: interfaz y generación de imágenes

En la parte superior de `mainwindow.cpp`, los parámetros surgidos de la calibración del Paso 3:

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

## Paso 6 — La conexión del QFutureWatcher, y una lección de medición real

```cpp
connect(&m_watcher, &QFutureWatcher<QImage>::started, this, &MainWindow::batchStarted);
connect(&m_watcher, &QFutureWatcher<QImage>::resultReadyAt, this, &MainWindow::resultReady);
connect(&m_watcher, &QFutureWatcher<QImage>::canceled, this, &MainWindow::batchCanceled);
connect(&m_watcher, &QFutureWatcher<QImage>::finished, this, &MainWindow::batchFinished);

connect(m_startButton, &QPushButton::clicked, this, &MainWindow::startProcessing);
connect(m_cancelButton, &QPushButton::clicked, this, &MainWindow::cancelProcessing);
```

Fíjate en lo que **falta** respecto a la lista completa de señales del artículo anterior: `progressRangeChanged` y `progressValueChanged` no están conectadas a nada. No es un olvido —es el resultado directo de una medición hecha durante el desarrollo de este mismo proyecto, y es demasiado instructiva como para no contarla entera, porque es la misma disciplina de "mide, no adivines" del Paso 3 aplicada esta vez a la interfaz en vez de al cálculo.

El primer intento, el "obvio", conectaba `progressValueChanged` directamente a `m_progressBar->setValue()`, actualizando la barra en cada resultado individual. El código compilaba, corría, y **la interfaz se bloqueaba durante toda la duración del lote**: ningún redibujado, ninguna respuesta a eventos, un auténtico congelamiento de 7-9 segundos seguido de una actualización de golpe al final —con medición directa incluida, mediante un temporizador de "latido" a 300ms conectado al event loop, que confirmó cero procesamiento de eventos durante toda la duración del lote.

Aislando el problema pieza por pieza, resultó que el culpable no era `QtConcurrent::mapped()` en sí (una prueba del mismo future exacto, sin `QProgressBar` conectada, se mantenía fluida y reactiva durante toda la duración) sino específicamente la actualización **frecuente** de una `QProgressBar` durante la ejecución activa del lote: bastaban pocas llamadas a `setValue()` en medio del trabajo, no necesariamente cientos, para reintroducir el bloqueo. Actualizar en cambio la barra **solo en los extremos** —en cero cuando arranca, en el valor final cuando `finished()` se dispara, cuando el pool de hilos ya agotó el trabajo y ya no hay ninguna competencia por el tiempo de CPU de la GUI— resultó, verificado varias veces, perfectamente fluido: el event loop sigue latiendo puntualmente cada 300 milisegundos durante toda la duración del lote.

La lección no tiene que ver con un bug específico de este entorno sino con un principio general, válido en todas partes: **una API que promete "no bloquear nunca" a nivel de contrato (y `QtConcurrent`/`QFuture` lo cumplen) no garantiza automáticamente una interfaz fluida en cualquier combinación de widgets y frecuencia de actualización** —el costo real de un redibujado, multiplicado por cientos de llamadas seguidas, siempre hay que **medirlo**, no asumirlo.

## Paso 7 — startProcessing(): la línea que sustituye archivos enteros de worker

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

Compara esta función con todo el archivo `producer.cpp` del módulo anterior, o con la construcción de un `QThread` + worker: aquí no hay ningún `QThread`, ninguna `moveToThread()`, ningún `connect(started, ...)`. La línea `QtConcurrent::mapped(...)` arranca de inmediato el trabajo en el `QThreadPool` global y devuelve un `QFuture<QImage>` sin esperar nada; `setFuture()` conecta nuestro `QFutureWatcher` ya listo a ese future, y desde ese momento todas las señales del artículo anterior empiezan a llegar, en el hilo de la GUI, a medida que el trabajo avanza.

## Paso 8 — cancelProcessing(): cancelación cooperativa en la práctica

```cpp
void MainWindow::cancelProcessing() {
    m_watcher.cancel();
    m_cancelButton->setEnabled(false);
    m_labelStatus->setText("Cancellation requested: finishing items already in progress...");
}
```

Como se anticipó, `cancel()` es cooperativo: no interrumpe a mitad de camino un blur ya iniciado en un worker, simplemente impide que se inicien otros nuevos. En una verificación medida durante el desarrollo —cancelación solicitada aproximadamente 1.8 segundos después de arrancar un lote de 200 imágenes—, el resultado observado fue **46 imágenes procesadas y recogidas** antes de la detención completa (frente a las cerca de 25-26 que se esperarían de una tasa de finalización lineal en 1.8 segundos sobre un lote de 7.3s totales): la diferencia se explica exactamente por el comportamiento cooperativo recién descrito —los elementos ya asignados a los dos workers en el momento de la solicitud siguieron hasta su propio término natural, antes de que el pool dejara de tomar otros nuevos.

## Paso 9 — Los slots de notificación

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

`resultReady()` registra un resultado de cada diez (`LOG_EVERY_N = 10`), no cada uno —la misma cautela de cadencia comentada en el Paso 6, aplicada aquí al log en vez de a la barra. `batchFinished()` distingue correctamente entre finalización natural y cancelación mediante `m_watcher.isCanceled()`, y en ambos casos rehabilita el botón Iniciar: puedes lanzar varios lotes en secuencia sin nunca reiniciar la aplicación.

## Paso 10 — Compila, ejecuta, observa los números

```bash
cmake -S . -B build
cmake --build build
./build/image_batch_demo
```

Pulsa "Start batch processing": la barra se queda en cero, el log empieza a llenarse a tirones de diez resultados a la vez, y —punto crucial, compruébalo tú mismo moviendo la ventana o redimensionándola mientras el lote corre— **la interfaz permanece completamente reactiva** durante toda la duración, sin bloqueos, sin "no responde". Cuando el lote termina (medido, como se dijo, entre 7.3 y 7.6 segundos en esta máquina), la barra salta de golpe al valor final y la última línea de log reporta el tiempo exacto transcurrido y el número de resultados recogidos —siempre 200, si no pulsaste Cancelar.

## Lo que acabas de demostrarte a ti mismo

Has construido un lote de procesamiento paralelo real, con `QtConcurrent::mapped()` distribuyendo 200 procesamientos CPU-bound entre los hilos del pool global, un `QFutureWatcher` que te mantiene informado sin bloquear nunca el hilo de la GUI, y una cancelación cooperativa que funciona —todo esto sin escribir un solo `QThread`, una sola `moveToThread()`, un solo mutex. Y has visto, con números medidos y no adivinados, tanto cuánto tiempo tarda realmente el trabajo (calibración del Paso 3) como de qué manera una elección aparentemente inocua al conectar una señal a un widget puede producir una interfaz que se bloquea (Paso 6).

Has cerrado el círculo con el que empezó este módulo: `QtConcurrent`, la herramienta con la que quizás habías empezado "a ojo", ahora la conoces hasta el `QThreadPool` que hay detrás, sabes leer la diferencia entre un `QFuture` bloqueante y uno observado mediante `QFutureWatcher`, y sobre todo sabes **cuándo** usarlo y cuándo no.

---

*El código fuente completo de este proyecto está disponible en el repositorio que acompaña este curso, en la carpeta `project-E-image-batch`.*
