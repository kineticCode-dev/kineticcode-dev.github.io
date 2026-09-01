---
title: "Proyecto Capstone: pipeline de procesamiento de fotogramas en tiempo casi real"
description: "Multithreading en C++ con Qt — Módulo 6 — Proyecto final"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Proyecto Capstone: pipeline de procesamiento de fotogramas en tiempo casi real

En los artículos anteriores viste las cuatro etapas "invisibles" de la pipeline capstone: captura (Módulo 1), buffer limitado con contrapresión (Módulo 2), pool de procesamiento persistente (Módulo 5, comparado con `QtConcurrent` del Módulo 3), y la secuencia de cancelación cooperativa completa (Módulo 4). Este artículo cierra el círculo con la quinta etapa — la integración con la GUI — y recorre el proyecto guiado completo: cómo está compuesto, cómo se compila, y qué observar cuando lo ejecutas de verdad.

## Etapa 5: la GUI, el progreso, y los errores que no tumban nada

**Objetivo.** Una ventana que muestra, en tiempo real y sin bloquearse nunca, la ocupación del buffer (la contrapresión hecha visible), el recuento de fotogramas capturados/procesados, y un log que distingue eventos normales de errores — permaneciendo siempre reactiva, incluso bajo la carga más sostenida que la pipeline puede generar.

Cada `FrameWorkerTask` emite una de dos señales por cada fotograma que gestiona, nunca ambas:

```cpp
try {
    QImage result = processFrame(frame, frameNumber);
    emit frameProcessed(m_workerId, frameNumber, timer.elapsed());
} catch (const std::exception &e) {
    emit frameError(m_workerId, frameNumber, QString::fromStdString(e.what()));
}
```

![Per-frame errors and progress, without ever bringing the pipeline down](modulo-06/28-error-handling-progress-signals.png)

El Proyecto H simula deliberadamente, cada trece fotogramas, un "payload corrupto" — piensa en un fotograma realmente dañado por un error de transferencia en un bus real, un escenario nada hipotético en un sistema de adquisición industrial — lanzando una excepción dentro de `processFrame()`. El `try`/`catch` que lo rodea garantiza que **ese único fotograma** falle sin que el worker, el pool, o la pipeline en su conjunto se vean afectados: el bucle de `run()` continúa de inmediato con el siguiente fotograma. Es la misma filosofía de robustez que deberías llevar a cualquier pipeline de producción: un fotograma perdido nunca debe ser motivo para detener toda la línea, debe ser un dato más que registrar y, si hace falta, investigar después.

**Trampa — dónde va el recuento de errores.** En la GUI, `onFrameError()` incrementa un contador visible separado del de fotogramas procesados con éxito, y escribe una entrada coloreada en rojo en el log — nunca ignorada silenciosamente, nunca mezclada con el recuento de éxito en un único número que ocultaría el problema. Es una decisión minúscula en el código pero no en el diseño: un sistema que informa "24 fotogramas procesados" cuando en realidad 3 han fallado silenciosamente es un sistema que miente, de un modo particularmente peligroso porque el operador no tiene motivo para dudar de ello.

**Por qué todo es seguro sin un solo mutex en la GUI.** Cada señal emitida por `CaptureWorker` o por un `FrameWorkerTask` — que viven, respectivamente, en el hilo de captura y en un hilo del pool — llega a un slot de `MainWindow`, que vive en el hilo de la GUI. Qt compara la afinidad de hilo del emisor y del destinatario en el momento de la emisión y elige automáticamente una conexión queued (Módulo 4): el evento se encola en el event loop del hilo de la GUI y se procesa allí, uno a uno, sin que haya nunca una escritura concurrente sobre los widgets. Es el mismo principio que el Módulo 1 te mostró con un solo worker, verificado hoy con cuatro o más hilos de origen que convergen todos en el mismo hilo de destino sin una sola línea de código de sincronización manual escrita por ti — siempre que nunca fuerces una conexión `Direct` entre hilos distintos.

## Configuración y prerrequisitos

- Compilador C++17 (verificado con GCC 13.3 en Linux).
- CMake ≥ 3.16.
- Qt 6, componentes **Widgets** y **Concurrent** (este último solo hace falta para `QtConcurrent::run()`, usado en la secuencia de parada asíncrona — no para el procesamiento de fotogramas, que sigue siendo `QThreadPool` puro).
- Ninguna biblioteca de visión externa: el filtro de detección de bordes está implementado desde cero sobre los datos crudos de una `QImage` en escala de grises.

```bash
cd project-H-vision-pipeline-capstone
cmake -S . -B build
cmake --build build
./build/vision_pipeline_capstone
```

## La estructura de los archivos

Seis archivos fuente más el header compartido del flag de cancelación:

- `pipelinestate.h` — `CancellationFlag`, un envoltorio fino alrededor de `std::atomic<bool>` con `requestStop()`/`requested()`/`reset()`.
- `framebuffer.h/.cpp` — la Etapa 2: la cola limitada de `QImage`.
- `captureworker.h/.cpp` — la Etapa 1: generación de los fotogramas sintéticos.
- `frameworkertask.h/.cpp` — la Etapa 3: el filtro Sobel y el bucle persistente sobre el pool.
- `mainwindow.h/.cpp` — las Etapas 4 y 5: orquestación, secuencia de parada, widgets.
- `main.cpp` — once líneas, sin sorpresas: crea `QApplication`, crea `MainWindow`, llama a `exec()`.

En la interfaz encuentras dos controles numéricos — número de fotogramas a capturar y número de workers paralelos — pensados a propósito para que puedas reproducir tú mismo el experimento de la contrapresión: baja el número de workers a 1 y observa cómo el buffer se llena más rápido y permanece lleno más tiempo; súbelo a 4 y observa cómo la contrapresión casi desaparece.

## Calibración empírica: mide, no adivines

El curso te ha repetido en cada módulo la misma disciplina — mide antes de fijar una constante, no la ajustes a ojo — y este proyecto no es la excepción. Antes de fijar los números finales, el coste real de una sola pasada del filtro Sobel sobre un fotograma sintético, medido de forma aislada:

| Tamaño del fotograma | 1 pasada | 3 pasadas | 5 pasadas |
|---|---|---|---|
| 128×96 | 0.05 ms | 0.15 ms | 0.25 ms |
| 256×192 | 0.20 ms | 0.65 ms | 1.25 ms |
| 1536×1152 | — | 28.8 ms | — |

El dato interesante es lo *rápido* que resulta un filtro Sobel escrito de forma directa sobre un fotograma de tamaño realista para un sensor económico: incluso a 1536×1152 (más de 1.7 megapíxeles), tres pasadas cuestan menos de 30 milisegundos. Un sistema de visión real, sin embargo, rara vez se detiene en la mera detección de bordes: extracción de características, clasificación, seguimiento tienen un coste que aquí no implementamos (se saldría del alcance de un curso sobre concurrencia), pero que es honesto simular explícitamente, con el mismo espíritu con que el Consumidor del Módulo 2 usaba `QThread::msleep()` para representar un tiempo de procesamiento realista. El Proyecto H usa fotogramas de 256×192, tres pasadas Sobel reales (~0.65 ms, trabajo CPU-bound auténtico y medido) más una espera explícita de 350-450 ms para representar las etapas posteriores no implementadas.

Con estos números, y un intervalo de captura de 90 ms/fotograma, la producción (≈11 fotogramas/s) supera de forma estable la capacidad de procesamiento agregada de dos workers (≈2 fotogramas cada ~400 ms ≈ 5 fotogramas/s): la contrapresión prevista por la teoría se manifiesta puntualmente, verificada de forma experimental, no solo sobre el papel.

## Verificación de ejecución

Compilado con g++ 13.3 sobre Qt 6.4.2, ejecutado sin interfaz visible (`QT_QPA_PLATFORM=offscreen`) con una copia instrumentada temporal para pilotar la GUI sin una pantalla real:

- **Finalización natural** (24 fotogramas objetivo, 2 workers): 24 capturados, 23 procesados con éxito, 1 fallido (el fotograma corrupto simulado #13, como se esperaba — un error cada 13 fotogramas). Ocupación máxima del buffer observada: 5/5 — contrapresión confirmada visualmente. Ningún fotograma perdido: `23 + 1 = 24`. Parada completa en unos 5 segundos desde el arranque, sin bloqueos, sin caídas, código de salida 0.
- **Parada anticipada** (Stop pulsado a los 900 ms del arranque, buffer ya saturado): 9 fotogramas capturados, 5 procesados antes de la parada — el resto abandonado por diseño (parada responsiva). Sin bloqueos, sin caídas, buffer nunca observado por encima de la capacidad configurada.
- **Doble ciclo** (arranque → parada natural → reinicio → parada natural): comportamiento idéntico y determinista en ambos ciclos, ninguna fuga de recursos observable, ningún estado residual entre un ciclo y otro — la pipeline se puede reiniciar con seguridad desde la misma ventana.

En ninguna de las ejecuciones aparecieron warnings de runtime de Qt.

## Hacia dónde ir desde aquí

El Proyecto H es, deliberadamente, un sistema de juguete que se comporta como uno real — y la distancia entre ambos es más corta de lo que parece. Algunas direcciones concretas para llevarlo más allá:

**Sustituir la captura simulada por una fuente real.** `CaptureWorker::generateSyntheticFrame()` es el único punto del programa que "finge": sustitúyelo por una llamada a una biblioteca de adquisición real — un frame grabber industrial, una GenICam, o incluso solo una webcam vía `QCamera` — y el resto de la pipeline, buffer, pool, cancelación, GUI, no requiere ninguna modificación. Es la prueba práctica de que desacoplar las etapas con una interfaz clara paga precisamente en este momento.

**Integrar OpenCV en lugar del Sobel escrito a mano.** El filtro escrito desde cero en este módulo tiene un propósito didáctico, pero en producción usarías casi con toda seguridad `cv::Sobel` o equivalentes, a menudo vectorizados y multi-hilo internamente. Cuidado con un detalle no trivial en ese caso: si la biblioteca de visión que usas ya tiene su propio paralelismo interno, sumarlo ingenuamente al paralelismo de tu `QThreadPool` puede producir más hilos de los núcleos que tienes — un caso concreto de la lección sobre el coste de los cambios de contexto del Módulo 0, aquí aplicada a escala de sistema.

**Recalibrar el tamaño del pool según el hardware real.** En producción querrías probablemente partir de `QThread::idealThreadCount()` y luego medir — la misma disciplina de calibración empírica de este capítulo, aplicada al número de workers en lugar de al tiempo de procesamiento, quizá con un pequeño benchmark que replique el espíritu del Proyecto G del Módulo 5.

**Perfilar bajo carga sostenida, no solo en una demo de pocos segundos.** Una prueba de 24 fotogramas en cinco segundos demuestra la corrección del diseño, no su resistencia bajo horas de funcionamiento continuo. ThreadSanitizer, en particular, merece volver a lanzarse sobre este proyecto extendido, y un perfilado a largo plazo es la única forma honesta de saber si la capacidad del buffer y el tamaño del pool aguantan de verdad la carga real.

## Conclusiones del módulo — y del curso

Seis módulos atrás el problema era un botón que bloqueaba una ventana. Hoy has construido, verificado con medidas reales y no solo con intuición, un sistema de cinco etapas con tres categorías de hilos activas simultáneamente — un worker persistente, un pool dinámico, el hilo de la GUI — coordinadas por un buffer limitado y una secuencia de parada que nunca deja nada colgado, incluso en el caso más insidioso en que una etapa está dormida dentro de una wait condition justo en el momento en que le pides que se detenga. No es un ejercicio de manual: es, en su sustancia arquitectónica, el mismo tipo de sistema que encontrarás en el trabajo con sistemas de visión industrial.

Lo que uno se lleva de este recorrido no es la sintaxis de `QThread` o de `QMutex` — esa se encuentra en cualquier documentación en treinta segundos. Es el modelo mental que permite, ante un sistema concurrente nuevo, saber hacer las preguntas correctas en el orden correcto: qué datos están realmente compartidos, y por quién; cuál es el orden de apagado que no deja a nadie dormido para siempre; dónde corre riesgo de bloquearse la GUI, y cómo trasladar ese riesgo a un hilo que no lo pague. El resto — la clase específica, el nombre exacto del método — es un detalle que se consulta cuando hace falta, no teoría que haya que memorizar.

---

*El código fuente completo de este proyecto está disponible en el repositorio que acompaña a este curso, en la carpeta `project-H-vision-pipeline-capstone`.*
