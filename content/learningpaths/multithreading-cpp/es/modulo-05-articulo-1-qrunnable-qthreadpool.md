---
title: "QRunnable y QThreadPool: un pool de tareas, no un hilo por trabajo"
description: "Multithreading en C++ con Qt — Módulo 5"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QRunnable y QThreadPool: un pool de tareas, no un hilo por trabajo

En el Módulo 2 aprendiste a proteger memoria compartida con `QMutex` y a coordinar hilos con `QWaitCondition`. Todo ese módulo se apoyaba en una idea de fondo que vale la pena hacer explícita ahora: un mutex es una herramienta *general*, que protege cualquier cosa que pongas dentro, al precio de un mecanismo que, cada vez que se adquiere, involucra potencialmente al scheduler del sistema operativo — y volver a poner en ejecución un hilo que estaba esperando tiene un costo real, no gratuito, como viste en el Módulo 0 al hablar de los cambios de contexto (context switch).

Este módulo parte de una pregunta incómoda pero honesta: ¿ese costo es siempre necesario? La respuesta, como suele ocurrir en ingeniería, es "depende" — y este primer artículo aborda el nivel más organizativo del problema, antes de bajar, en el siguiente, al nivel físico de la caché y el modelo de memoria.

## El problema que un QThread persistente no resuelve bien

Recuerda el patrón usado en los Módulos 1, 2 y 4: un `QThread` creado, un worker movido a él con `moveToThread()`, un ciclo de vida gestionado con cuidado (`start()`, `quit()`, `wait()`). Es el patrón correcto cuando el trabajo es *continuo* — un productor que gira durante toda la vida del programa, un worker que procesa un flujo constante de fotogramas de vídeo. Pero ¿qué pasa si tu problema es distinto: tienes cien imágenes que procesar *una sola vez*, en paralelo, y luego ese trabajo termina? Crear cien `QThread`, uno por imagen, sería absurdo — la creación de un hilo del sistema operativo tiene un costo nada despreciable (asignación de la pila, registro ante el scheduler, típicamente varias decenas de microsegundos incluso en un sistema moderno), y cien hilos que viven pocos milisegundos cada uno gastarían una fracción enorme de su tiempo total simplemente naciendo y muriendo, no trabajando.

La solución clásica, tan antigua como la propia programación concurrente, es el **thread pool** (pool de hilos): un número fijo de hilos worker, creados una sola vez al arrancar, que permanecen vivos y se ponen en cola a "tirar" (pull) del siguiente trabajo disponible desde una cola compartida, en lugar de ser recreados cada vez.

![QRunnable + QThreadPool: queued tasks consumed by a fixed set of worker threads](modulo-05/21-qrunnable-qthreadpool.png)

## QRunnable: la tarea, no el hilo

En Qt, una unidad de trabajo enviada a un pool se escribe subclasificando `QRunnable` y sobrescribiendo un único método, `run()`:

```cpp
class ImageProcessingTask : public QRunnable {
public:
    explicit ImageProcessingTask(int imageId) : m_imageId(imageId) {}

    void run() override {
        // the actual work, executed on one of the pool's threads
        processImage(m_imageId);
    }

private:
    int m_imageId;
};
```

Fíjate en la diferencia conceptual respecto a un worker `QObject` movido con `moveToThread()`: un `QRunnable` **no es** un `QObject`, no tiene señales propias, no tiene afinidad de hilo en el sentido que conoces desde el Módulo 1. Es deliberadamente una herramienta más pobre y más ligera: representa *el trabajo por hacer*, no *quién lo hace*. El "quién" lo decide sobre la marcha el pool, según qué hilo worker se libere primero — y podría no ser siempre el mismo hilo de una ejecución a otra, algo que con un `QThread` persistente ni siquiera tendría sentido plantearse.

## Enviar la tarea: QThreadPool

```cpp
// Qt's shared global pool
QThreadPool *pool = QThreadPool::globalInstance();
pool->start(new ImageProcessingTask(imageId));
```

`QThreadPool::globalInstance()` devuelve un pool compartido por toda la aplicación, dimensionado por defecto según el número de núcleos lógicos de la máquina (`QThread::idealThreadCount()`) — la misma métrica física que `std::thread::hardware_concurrency()`, que volverás a ver en el proyecto guiado del próximo artículo. También puedes construir tu propio `QThreadPool`, independiente, si quieres aislar cierto tipo de trabajo del resto (por ejemplo para que el procesamiento de imágenes en segundo plano no compita con tareas más urgentes que pasan por el pool global):

```cpp
QThreadPool dedicatedPool;
dedicatedPool.setMaxThreadCount(4);
dedicatedPool.start(new ImageProcessingTask(imageId));
```

## ¿Quién destruye el QRunnable? setAutoDelete

Aquí hay un detalle de gestión de memoria que, si lo ignoras, produce o bien una fuga (leak) o bien un crash por doble `delete`. Por defecto, `QRunnable::autoDelete()` es `true`: el pool, al terminar `run()`, destruye por sí solo el objeto con `delete`. Por eso en el ejemplo anterior escribimos `new ImageProcessingTask(...)` y no nos preocupamos más — el pool se encarga de ello. Si en cambio necesitas reutilizar el mismo `QRunnable` varias veces, o mantenerlo vivo después de la ejecución para leer un resultado, debes desactivar este comportamiento explícitamente **antes** de enviarlo:

```cpp
ImageProcessingTask *task = new ImageProcessingTask(imageId);
task->setAutoDelete(false);
pool->start(task);
pool->waitForDone();      // wait for all submitted tasks to finish
delete task;              // the responsibility is yours again now
```

`waitForDone()` bloquea al llamante hasta que el pool haya agotado todas las tareas en cola — útil en un contexto por lotes (batch) donde se necesita un punto de sincronización claro, mucho menos útil en un contexto reactivo donde quieres que la interfaz gráfica siga viva (en ese caso, como en el Módulo 3 con `QFutureWatcher`, preferirás un mecanismo de notificación en lugar de una espera bloqueante).

## El vínculo con QtConcurrent, ahora explícito

En el Módulo 3 usaste `QtConcurrent::run()` y `QtConcurrent::mapped()` sin ver nunca un `QRunnable` ni un `QThreadPool` — y ese es exactamente el punto: **no los veías porque Qt los crea por ti, entre bastidores**. Cada llamada a `QtConcurrent::run(función)` empaqueta internamente `función` en un `QRunnable` generado automáticamente y lo envía a `QThreadPool::globalInstance()` — el mismo pool exacto que acabas de aprender a usar a mano en este artículo. `QtConcurrent::mapped()` hace lo mismo, multiplicado por cada elemento de la secuencia a procesar, con el añadido de la logística necesaria para recoger los resultados parciales en un `QFuture`. No es una implementación parecida, es **el mismo motor**: cuando escribes `pool->start(new ImageProcessingTask(...))` estás haciendo a mano, de forma explícita, exactamente lo que `QtConcurrent::run()` hace por ti de forma implícita.

Saber esto también te dice cuándo conviene bajar al nivel de `QRunnable` directo en lugar de quedarte con `QtConcurrent`: cuando necesitas prioridades distintas entre tareas (`QThreadPool::start()` acepta un parámetro de prioridad opcional), o un pool dedicado separado del global, o un control más fino sobre el ciclo de vida de cada tarea individual — todo ello algo que la interfaz más cómoda pero más opaca de `QtConcurrent` no expone.

Con `QRunnable` y `QThreadPool` ya encuadrados, y su vínculo con `QtConcurrent` finalmente explícito, el próximo artículo baja un nivel más: qué garantiza realmente `std::atomic`, explicado no como una lista de palabras clave para memorizar, sino partiendo de lo que ocurre físicamente dentro de un procesador multinúcleo.
