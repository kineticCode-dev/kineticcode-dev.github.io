---
title: "QFuture, QFutureWatcher y la pregunta que el vibe coding siempre se salta"
description: "Multithreading en C++ con Qt — Módulo 3"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QFuture, QFutureWatcher y la pregunta que el vibe coding siempre se salta

En el artículo anterior viste cómo lanzar trabajo paralelo con `QtConcurrent::run()` y la familia `mapped`/`filtered`/`reduced()`, y cómo el `QThreadPool` global gestiona los hilos detrás de escena. Cada función de `QtConcurrent` que has visto hasta ahora (en su forma no bloqueante) devuelve un `QFuture<T>`. Vale la pena detenerse a entender bien qué es, porque es un concepto distinto de todo lo visto en los módulos anteriores.

## QFuture: un handle al resultado, no el resultado

Un `QFuture<T>` **no es** el resultado —es un objeto ligero y copiable que representa la *promesa* de un resultado que puede no estar listo todavía. Puedes consultarlo en cualquier momento:

```cpp
QFuture<QImage> future = QtConcurrent::mapped(images, blurImage);

future.isRunning();      // is the work still running?
future.isFinished();     // has it finished (successfully or canceled)?
future.isCanceled();     // was it canceled?
future.resultCount();    // how many results are ready right now?
```

Y puedes, si quieres, **esperar** a que termine, con `waitForFinished()`:

```cpp
future.waitForFinished();
QList<QImage> results = future.results();
```

Detente en esta línea, porque es exactamente el tipo de error que este curso empezó a desmontar desde el primer proyecto práctico. ¿Recuerdas la ventana que se congelaba porque un cálculo largo corría directamente en el slot de un botón, en el hilo de la GUI? `future.waitForFinished()` llamado en el hilo de la GUI produce **exactamente el mismo síntoma**, por la misma razón exacta: estás bloqueando el hilo que debería quedar libre para procesar eventos (redibujados, clics, todo lo demás) hasta que el trabajo en el otro hilo termine.

![Diagram of QFutureWatcher bridging QFuture signals to the GUI thread](modulo-03/14-qfuture-qfuturewatcher-bridge.png)

`waitForFinished()` tiene su lugar legítimo: en un hilo que **no** es el de la GUI (por ejemplo dentro de otro trabajo ya ejecutado con `QtConcurrent::run()`, o en un script de línea de comandos sin interfaz), o cuando sabes con certeza que el trabajo ya terminó o terminará en un tiempo despreciable. En el hilo de la GUI, para un trabajo que dure más de unos milisegundos, nunca debe usarse de esta forma directa. La solución —la que usarás en todo el proyecto práctico de este módulo— es **no esperar nunca**, y dejar que sea Qt quien "toque a la puerta" cuando el resultado esté listo. La herramienta que hace exactamente esto es `QFutureWatcher<T>`.

## QFutureWatcher: el future traducido a señales de Qt

`QFutureWatcher<T>` hace de puente entre el mundo de los `QFuture` (que por sí mismos no emiten señales) y el mundo de señales y slots que ya conoces bien. Un `QFutureWatcher` "observa" un `QFuture` mediante `setFuture()`, y traduce cada evento interno del future en una señal Qt normal, entregada —mediante conexión en cola, exactamente igual que las señales del worker thread— en el hilo al que pertenece el propio watcher (casi siempre el hilo de la GUI, si el watcher se creó allí).

```cpp
QFutureWatcher<QImage> *watcher = new QFutureWatcher<QImage>(this);

connect(watcher, &QFutureWatcher<QImage>::finished, this, [this, watcher]() {
    QList<QImage> results = watcher->future().results();
    // ... use the results, safely, on the GUI thread ...
});

QFuture<QImage> future = QtConcurrent::mapped(images, blurImage);
watcher->setFuture(future);   // the work has ALREADY started: setFuture() just observes it
```

Ningún `QThread`, ninguna `moveToThread()`, ningún mutex: el worker en sí corre en el `QThreadPool` global, el `QFutureWatcher` vive tranquilamente en el hilo de la GUI, y la conexión entre ambos pasa enteramente por señales que Qt entrega en cola —la misma infraestructura de entrega de eventos en la que ya has aprendido a confiar.

`QFutureWatcher<T>` expone un conjunto de señales que reproduce, una a una, el tipo de notificaciones que en el módulo sobre `QThread` tenías que construirte a mano dentro de tu worker:

- **`started()`** — emitida cuando el future conectado empieza efectivamente su ejecución.
- **`finished()`** — emitida cuando todo el trabajo ha concluido, ya sea que haya llegado a su término natural o que haya sido cancelado. Es el punto en el que es seguro llamar a `watcher->future().results()` para leer todos los resultados.
- **`canceled()`** — emitida (además de `finished()`, no en su lugar) cuando el future ha sido cancelado explícitamente mediante `watcher->cancel()`.
- **`progressRangeChanged(int minimum, int maximum)`** y **`progressValueChanged(int value)`** — informan el avance global del trabajo.
- **`resultReadyAt(int index)`** (y la variante `resultsReadyAt(int beginIndex, int endIndex)` para un intervalo) — emitida cada vez que un nuevo resultado está disponible, indicando **qué** índice de la colección original está listo.

Hay un detalle que el artículo anterior ya adelantó para los resultados finales, y que vale la pena repetir aquí para las *notificaciones*: `resultReadyAt(index)` te dice qué elemento acaba de estar disponible, pero **no garantiza que los índices lleguen en orden creciente** —si dos workers están trabajando en paralelo sobre elementos distintos, el que termina primero notifica primero, sin importar cuál de los dos tenía el índice más bajo. Lo que sigue siendo siempre cierto es que el `QFuture` subyacente conserva los resultados en la posición correcta —`resultAt(i)` (o `results()` en conjunto) está siempre en el orden original, aunque las *notificaciones* de "listo" hayan llegado en un orden distinto.

`watcher->cancel()` (equivalente a `watcher->future().cancel()`) solicita la anulación del trabajo restante —pero, exactamente igual que la bandera cooperativa que verás formalizada en el próximo módulo, **no interrumpe a mitad de camino** un elemento cuyo cálculo ya arrancó en un worker: ese elemento termina de todas formas su paso individual, simplemente no se inician nuevos después de la solicitud de cancelación. `finished()` se dispara igualmente al final (junto con `canceled()`), y `watcher->future().resultCount()` te dice cuántos resultados se recogieron efectivamente antes de la interrupción.

## QPromise: cuando quieres ser tú quien produce el future

Todo lo que has visto hasta ahora parte de un `QFuture` que `QtConcurrent` construye por ti. Hay un caso, más avanzado y menos frecuente en el trabajo cotidiano, en el que quieres la relación inversa: escribir tú mismo una función asíncrona personalizada que se comporte como las de `QtConcurrent` —devuelve un `QFuture`, soporta cancelación y progreso— sin pasar por `mapped`/`filtered`/`reduced`. La herramienta, introducida en Qt 6, es `QPromise<T>`.

```cpp
QFuture<int> processWithProgress(const QList<int> &data) {
    return QtConcurrent::run([data](QPromise<int> &promise) {
        promise.setProgressRange(0, data.size());
        int accumulator = 0;

        for (int i = 0; i < data.size(); ++i) {
            if (promise.isCanceled()) break;   // cooperative cancellation, as always

            accumulator += processSingleItem(data[i]);
            promise.setProgressValue(i + 1);
        }

        promise.addResult(accumulator);
    });
}
```

`QtConcurrent::run()` reconoce que la lambda acepta un `QPromise<int>&` como primer parámetro, y te pasa un objeto ya conectado al `QFuture<int>` que la función devuelve: dentro de la lambda controlas tú mismo el progreso (`setProgressValue`), la cancelación cooperativa (`isCanceled()`, verificada en cada iteración —el mismo patrón del `while` visto para las wait conditions, aplicado aquí a un bucle), y el resultado final (`addResult`). Desde fuera, quien llama a `processWithProgress()` recibe un `QFuture<int>` completamente indistinguible del de un `QtConcurrent::mapped()` —puede conectarle un `QFutureWatcher` exactamente como acabas de aprender.

No usaremos `QPromise` en el proyecto práctico de hoy —nuestro caso de uso (blur de imágenes) encaja perfectamente en el patrón `mapped()` ya disponible— pero es una herramienta que vale la pena conocer por su nombre: el día que tengas que envolver una librería de terceros bloqueante (un SDK de una cámara, por ejemplo, con su API síncrona) en algo que se integre limpiamente en el ecosistema `QFuture`/`QFutureWatcher`, `QPromise` es el camino correcto.

## Excepciones a través de QFuture

Una última cosa que hay que saber antes del proyecto práctico, porque es fácil olvidarla y descubrirla de la peor manera en producción: ¿qué pasa si la función que le pasas a `QtConcurrent::run()` o `mapped()` lanza una excepción de C++? No desaparece silenciosamente, y no hace que el programa crashee de inmediato desde un hilo arbitrario del pool —Qt la **captura** en el hilo worker y la **relanza** cuando alguien consulta el future para obtener el resultado:

```cpp
QFuture<int> future = QtConcurrent::run([]() -> int {
    if (errorCondition()) throw std::runtime_error("invalid data");
    return 42;
});

try {
    int value = future.result();   // or after waitForFinished()
} catch (const std::exception &e) {
    qWarning() << "Exception from worker:" << e.what();
}
```

La excepción se relanza en el punto en que **lees** el resultado (`result()`, `results()`, o el acceso correspondiente tras `waitForFinished()`) —no en el punto en que fue lanzada originalmente. Si en cambio estás usando el patrón `QFutureWatcher` (el del proyecto práctico de hoy), el lugar natural para el `try`/`catch` es dentro del slot conectado a `finished()`, justo en el momento en que accedes a los resultados.

## ¿QtConcurrent o QThread manual? La pregunta que el vibe coding se salta

Llegamos al punto que de verdad cierra el círculo con el que empezaste este módulo. `QtConcurrent` es cómodo —lo bastante cómodo como para ser, históricamente, la primera herramienta de multithreading de Qt que muchos desarrolladores encuentran, a menudo sin saber bien qué eligen *no* usar al hacerlo.

![Comparison diagram of QtConcurrent versus manual QThread usage](modulo-03/16-qtconcurrent-vs-manual-qthread.png)

La pregunta correcta que hacerte, cada vez, antes de escribir una línea de código concurrente en Qt, es **"¿mi trabajo es una transformación sin estado sobre una colección de datos?"**

Si la respuesta es sí —tienes N elementos, aplicas la misma operación a cada uno, cada procesamiento es independiente de los demás, no necesitas coordinación fina durante la ejecución, y cuando todo termina te bastan los resultados—, entonces `QtConcurrent::mapped`/`filtered`/`reduced` (o `run()` para un único trabajo) es casi siempre la elección correcta. Obtienes paralelismo real, gestión del pool de hilos gratis, ningún mutex que escribir, ningún ciclo de vida de `QThread` que gestionar a mano. Es exactamente el proyecto práctico de hoy.

Si en cambio tu trabajo tiene cualquiera de estas características, `QtConcurrent` se convierte en la herramienta equivocada, no porque "no funcione", sino porque te obliga a forzar dentro de una caja sin estado algo que es stateful por naturaleza:

Un **worker que vive mucho tiempo y mantiene estado entre una operación y otra** —el Productor y el Consumidor del módulo anterior no eran "transformaciones sobre una colección": eran objetos con vida propia, que seguían trabajando hasta que el programa los detenía. Un **productor-consumidor, pipeline con varias etapas** —cuando el resultado de una etapa alimenta continuamente la siguiente, y la coordinación entre ambas (lleno/vacío, backpressure) es el corazón del problema, no un detalle. La **necesidad de pausa, parada, cancelación de grano fino durante la ejecución** (no solo "cancela todo lo que queda", como el `cancel()` cooperativo de `QFutureWatcher`, sino "suspende ahora, retoma después, con control preciso de dónde te encuentras") —es exactamente el tema del próximo módulo. Y la **coordinación mediante mutex/wait condition entre hilos que de verdad necesitan hablarse durante el trabajo**, no solo intercambiar un resultado final.

En todos estos casos, el patrón `QThread` + objeto worker + `moveToThread()` + señales/slots (con, si hace falta, `QMutex`/`QWaitCondition` para el estado compartido) que construiste en los módulos anteriores sigue siendo la herramienta correcta —no un recurso "menos moderno". `QtConcurrent` no sustituye ese patrón: lo *exime* de los casos en los que sería innecesariamente pesado, es decir, exactamente el caso de la transformación de datos que ves hoy.

Mantener firme esta distinción —y saber reconocerla en treinta segundos al mirar un problema nuevo, en vez de arrancar "a ojo" hacia la herramienta que mejor conoces— es precisamente la competencia que este módulo quería darte.

## De la teoría a las manos sobre el teclado

Ahora tienes todo el vocabulario para usar `QtConcurrent` con conocimiento de causa: `QFuture` como handle no bloqueante, `QFutureWatcher` para las notificaciones seguras en el hilo de la GUI, `QPromise` para los casos avanzados, la gestión de excepciones y, sobre todo, el criterio para decidir cuándo esta herramienta es la correcta y cuándo no. En el próximo artículo lo ponemos todo en práctica con un batch de procesamiento de imágenes real, con una lección de medición que vale por sí sola todo el artículo.
