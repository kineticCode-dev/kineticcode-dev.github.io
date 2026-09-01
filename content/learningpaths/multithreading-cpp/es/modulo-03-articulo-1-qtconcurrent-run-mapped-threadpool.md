---
title: "QtConcurrent::run, mapped/filtered/reduced, y el QThreadPool detrás de escena"
description: "Multithreading en C++ con Qt — Módulo 3"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QtConcurrent::run, mapped/filtered/reduced, y el QThreadPool detrás de escena

En los tres módulos anteriores construiste, pieza por pieza, el vocabulario y las herramientas con las que Qt gestiona el multithreading "manual": `QThread`, `moveToThread`, señales y slots para hacer que los hilos se comuniquen sin corromper su estado, y luego `QMutex`, `QWaitCondition`, `QReadWriteLock` para proteger y coordinar datos verdaderamente compartidos. Es un recorrido deliberadamente lento, porque cada pieza de ese vocabulario te hace falta para entender *qué pasa por debajo* cuando las cosas se complican: un deadlock, una señal que llega al hilo equivocado, un worker que nunca se detiene.

Hoy cambiamos completamente de registro, y lo hacemos a propósito en el punto del curso en el que puedes apreciar de verdad la diferencia. Si tu primer contacto con el multithreading en Qt fue a través de `QtConcurrent`, usado un poco "a ojo" —copiar un ejemplo, hacerlo correr, seguir adelante sin saber bien por qué funcionaba—, hoy cerramos ese círculo: volverás a ver exactamente las mismas herramientas, pero esta vez sabiendo con precisión qué hace `QThreadPool` bajo el capó, por qué `QFuture` no bloquea (a menos que se lo pidas explícitamente), y en qué momento la comodidad de `QtConcurrent` deja de ser la elección correcta y vuelve a hacer falta el patrón manual de los módulos anteriores.

La pregunta que guía todo el módulo es fácil de enunciar y más sutil de aplicar bien: **¿el trabajo que necesito paralelizar es una transformación independiente aplicada a muchos datos similares, o es un estado que vive en el tiempo y debe coordinarse?** El productor-consumidor del módulo anterior estaba claramente en la segunda categoría: dos hilos persistentes, un búfer compartido, coordinación fina con wait conditions. Hoy trabajamos en la primera categoría, aquella en la que `QtConcurrent` fue diseñado para brillar: tienes una colección de datos (en tu trabajo profesional, casi siempre frames o imágenes de un sistema de visión), y quieres aplicar la misma operación a cada elemento, lo más en paralelo posible, sin tener que escribir un solo `QThread` a mano.

## QtConcurrent::run(): una llamada asíncrona, sin ceremonias

Empieza por el caso más sencillo posible: tienes una única función que tarda un poco, y quieres ejecutarla en otro hilo sin bloquear a quien la llama. En el módulo dedicado a `QThread` esto te costaba, como mínimo: una clase worker derivada de `QObject`, un slot que hiciera el trabajo, un `QThread` dedicado, una `moveToThread()`, la conexión `started` → slot, la gestión ordenada del apagado en el destructor. Cinco o seis líneas de infraestructura, para ejecutar *una* función una sola vez.

`QtConcurrent::run()` hace lo mismo en una línea:

```cpp
QFuture<int> future = QtConcurrent::run([]() {
    // time-consuming work, executed on another thread
    QThread::msleep(500);
    return 42;
});
```

Esa línea hace tres cosas a la vez: toma la función (aquí una lambda, pero puede ser un puntero a función libre, un método miembro, o un funtor), la encola en un hilo tomado prestado de un almacén de hilos ya listos (el `QThreadPool` global, el tema de la próxima sección), y te devuelve inmediatamente un `QFuture<int>`: un objeto manejable que representa "el resultado que llegará", no el resultado en sí. La línea `QtConcurrent::run(...)` **no bloquea**: retorna de inmediato, incluso antes de que la lambda haya empezado a ejecutarse, exactamente igual que `m_thread->start()` no esperaba a que el trabajo del worker thread terminara.

La ganancia es evidente: cero clases nuevas, cero gestión manual del ciclo de vida de un `QThread`, cero riesgo de olvidar `quit()`+`wait()` en el destructor. Para un trabajo "dispara y olvida" —o "dispara y recupera el resultado más tarde"— es casi siempre la elección correcta.

Lo que has perdido es igual de importante reconocerlo de inmediato, porque es el hilo conductor de todo el módulo: **ya no tienes un objeto persistente con quien hablar mientras el trabajo avanza**. El Productor del módulo anterior vivía en su propio hilo durante toda la duración del programa, recibía señales, emitía otras, podía detenerse de forma ordenada. Una llamada a `QtConcurrent::run()` es, conceptualmente, una función pura que arranca, corre y termina —no un objeto con el que interactúas en medio del proceso. Si tu problema necesita ese tipo de interacción continua (pausa, cancelación fina, notificaciones de progreso granulares durante la ejecución), ya estás vislumbrando por qué *no todo* debe pasar por `QtConcurrent` —volvemos a esto con calma en el próximo artículo.

## mapped, filtered, reduced: el paralelismo sobre datos

`QtConcurrent::run()` ejecuta *una* función una vez. El caso mucho más común en tu trabajo —procesar N imágenes de una inspección, N frames de una secuencia adquirida, N mediciones de un sensor— es aplicar la *misma* función a *cada elemento* de una colección, de forma independiente. Este patrón tiene un nombre preciso en la literatura de cómputo paralelo, **data parallelism** (paralelismo sobre datos, por contraposición al *task parallelism*, donde son operaciones distintas las que corren en paralelo), y es exactamente el caso que cubre `QtConcurrent::mapped()`.

```cpp
QList<QImage> blurredImages = QtConcurrent::blockingMapped(originalImages, blurImage);
```

![Visual diagram of map, filter and reduce data-parallel operations](modulo-03/15-map-filter-reduce-visual.png)

`mapped()` toma una colección (aquí una `QList<QImage>`) y una función de un argumento (aquí `blurImage`, que recibe una `QImage` y devuelve una nueva), y aplica esa función a *cada* elemento, distribuyendo el trabajo entre los hilos disponibles del pool. Cada elemento se procesa **de forma independiente** de los demás —sin estado compartido, sin mutex necesario, porque por definición del problema dos procesamientos nunca se tocan entre sí. Es precisamente la razón por la que este patrón se presta tan bien al paralelismo: la sección crítica del módulo anterior existía porque varios hilos tocaban *el mismo* dato; aquí cada worker toca un elemento distinto, así que la sección crítica simplemente no existe.

Un detalle que vale la pena dejar por escrito porque es fácil darlo por sentado de la forma equivocada: los workers completan los elementos **en cualquier orden**, según cuánto tarde cada uno y qué hilo se lo adjudique —pero la colección de resultados que obtienes al final **conserva siempre el orden original**. `result[i]` corresponde siempre a `f(element[i])`, sin importar qué worker lo haya calculado ni en qué orden se haya calculado. Para tu trabajo con secuencias de frames es una garantía valiosa: el frame número 10 en la lista de resultados es siempre el procesamiento del frame número 10 de partida, nunca el de otro frame que llegó antes por puro accidente de scheduling.

Junto a `mapped()`, `QtConcurrent` ofrece dos variantes del mismo esquema general. **`filtered()`** aplica un predicado (una función que devuelve `bool`) a cada elemento, y devuelve una nueva colección que contiene solo los elementos para los que el predicado es verdadero —calculado en paralelo, con el orden relativo de los elementos supervivientes siempre preservado:

```cpp
QList<QImage> darkImagesOnly = QtConcurrent::blockingFiltered(images, [](const QImage &img) {
    return averageBrightness(img) < DARK_THRESHOLD;
});
```

**`reduced()`** combina todos los resultados de un `mapped()` en un único valor acumulado, mediante una función de combinación asociativa —la suma, el máximo, la concatenación, cualquier operación en la que el orden en que combines los pares no cambie el resultado final:

```cpp
double totalBrightness = QtConcurrent::blockingMappedReduced(
    images,
    computeBrightness,                       // map: QImage -> double
    [](double &accumulator, double value) { accumulator += value; }  // reduce
);
```

Fíjate en `mappedReduced`: es la fusión de map y reduce en una sola pasada, que evita construir y mantener en memoria toda la colección intermedia de resultados mapeados antes de combinarlos —útil cuando esa colección intermedia sería grande y nunca la necesitas como tal, solo el valor final acumulado.

También existe un par de variantes en minúscula, `QtConcurrent::map()` y `QtConcurrent::filter()` (que no hay que confundir con `mapped`/`filtered`), que modifican la colección **en el mismo lugar** en vez de devolver una nueva —útiles cuando no necesitas conservar los datos originales y quieres ahorrarte la memoria de una copia. En el proyecto práctico de este módulo usaremos la forma "no mutante" (`mapped`) porque queremos conservar tanto las imágenes originales como las procesadas, para una comparación —pero ten presente que la alternativa existe, y es la elección correcta cuando lo único que te interesa es el resultado final en el mismo lugar.

Habrás notado que los ejemplos de arriba usan `QtConcurrent::blockingMapped()`, no `QtConcurrent::mapped()`. La diferencia es exactamente lo que el nombre sugiere: la versión `blocking*` ejecuta el trabajo en paralelo en los otros hilos pero **espera** (bloqueando el hilo que llama) a que todo termine antes de devolver directamente la colección de resultados —cómoda para un script de línea de comandos o para código que ya corre en un hilo secundario, pero **a evitar en el hilo de la GUI** por la misma razón exacta que formaliza el próximo artículo. La versión sin prefijo, `QtConcurrent::mapped()`, devuelve inmediatamente un `QFuture<T>` sin esperar nada —y es la que usaremos en el proyecto práctico.

## El QThreadPool global: el almacén de hilos detrás de escena

Ninguna de las llamadas a `QtConcurrent::run()`, `mapped()`, `filtered()` o `reduced()` que has visto hasta ahora especifica explícitamente *en qué hilos* correr el trabajo. No es magia: detrás hay un `QThreadPool`, y por defecto es el global, compartido por toda la aplicación, accesible mediante `QThreadPool::globalInstance()`.

![Diagram of the implicit global QThreadPool shared by QtConcurrent operations](modulo-03/13-global-thread-pool.png)

En el modelo de los módulos anteriores, cada trabajo que querías ejecutar en un hilo separado implicaba crear un `QThread` nuevo —un objeto del sistema operativo, con su propio stack, su propia identidad, un costo de creación y destrucción nada despreciable. Está perfectamente bien para un worker que vive mucho tiempo (tu Productor o Consumidor, vivos durante toda la duración del programa), pero se convierte en un desperdicio evidente si el "trabajo" dura pocos milisegundos y llegan cientos de ellos: crearías y destruirías cientos de hilos del sistema operativo, pagando cada vez el costo completo, por un trabajo que en el mejor de los casos ocupa una pequeña fracción de ese tiempo.

El `QThreadPool` resuelve el problema manteniendo un número fijo de hilos **ya creados y listos**, y reciclándolos: cuando encolas un trabajo (mediante `QtConcurrent::run()` o uno de los algoritmos `mapped`/`filtered`/`reduced`), el pool lo asigna al primer hilo worker libre; cuando ese hilo termina, **no muere** —vuelve a estar disponible para el siguiente trabajo en cola. El costo de creación del hilo del sistema operativo lo pagas una sola vez, al arrancar, no en cada trabajo individual.

El tamaño por defecto del pool es `QThread::idealThreadCount()` —típicamente el número de núcleos lógicos disponibles en la máquina (en la máquina de desarrollo de este curso, medido con `qDebug() << QThread::idealThreadCount();`, el valor es **2**: lo verás citado varias veces en el proyecto práctico, porque es uno de los números que determina cuánto tarda realmente nuestro batch de imágenes). La idea es que, para un trabajo genuinamente CPU-bound como nuestro blur, tener más hilos activos que núcleos físicos disponibles no ayuda —al contrario, solo introduce overhead de cambio de contexto—, así que el pool se dimensiona para aprovechar exactamente el paralelismo que ofrece el hardware, ni más ni menos.

Puedes cambiar este tamaño con `QThreadPool::globalInstance()->setMaxThreadCount(n)`, y también puedes crear tu propio `QThreadPool` privado (pasándolo como primer argumento a `QtConcurrent::run()`/`mapped()` en sobrecargas dedicadas) si quieres aislar cierto tipo de trabajo del resto de la aplicación —útil, por ejemplo, si tienes un subsistema de baja prioridad que nunca debe competir por hilos con el procesamiento principal. En el proyecto práctico de hoy usaremos siempre el pool global por defecto: para una aplicación con un solo tipo de trabajo CPU-bound como la nuestra, no hay motivo para complicar las cosas con varios pools.

De aquí en adelante, una regla sencilla: si tu trabajo es **divisible en trabajos breves y numerosos**, deja que sea el `QThreadPool` quien los gestione —es literalmente el problema para el que fue diseñado. Si en cambio necesitas **un único worker que vive mucho tiempo y mantiene estado entre una operación y otra** (de nuevo, el Productor/Consumidor del módulo anterior), un `QThread` dedicado sigue siendo la herramienta correcta —no todo tiene que pasar por el pool global.

## Qué queda por entender

Ya sabes cómo lanzar trabajo paralelo con `QtConcurrent::run()` y `mapped()`/`filtered()`/`reduced()`, y qué sucede detrás de escena en el `QThreadPool` global. Queda por entender cómo obtener notificaciones de progreso sin bloquear nunca el hilo de la GUI —el papel de `QFuture` y sobre todo de `QFutureWatcher`— y en qué casos exactos conviene volver al patrón manual de los módulos anteriores. Es el tema del próximo artículo.
