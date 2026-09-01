---
title: "Capstone: pool de procesamiento persistente y cancelación cooperativa completa"
description: "Multithreading en C++ con Qt — Módulo 6 (Capstone)"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone: pool de procesamiento persistente y cancelación cooperativa completa

En el artículo anterior viste las dos primeras etapas de la pipeline capstone: un worker de captura persistente (Módulo 1) que produce fotogramas en un buffer limitado (Módulo 2), con la contrapresión como decisión deliberada. Este artículo aborda las etapas 3 y 4: cómo procesar esos fotogramas en paralelo, y — la parte más difícil de todo el curso — cómo detener correctamente una pipeline en la que varias etapas concurrentes pueden estar dormidas en puntos distintos en el mismo instante.

## Etapa 3: procesamiento paralelo, y por qué aquí QThreadPool le gana a QtConcurrent

**Objetivo.** Aplicar a cada fotograma un filtro real ligado a la CPU — en el Proyecto H, un detector de bordes al estilo Sobel — distribuyendo el trabajo entre varios hilos, de modo que el tiempo total de procesamiento escale con el número de núcleos disponibles.

### La decisión de diseño que importa: pool persistente frente a lote finito

El Módulo 3 te enseñó `QtConcurrent::mapped`: das una colección, das una función, obtienes un `QFuture` que te entrega los resultados con un progreso observable vía `QFutureWatcher`. Es la herramienta correcta cada vez que tu problema tiene la forma "tengo *N* elementos, todos disponibles ya, y quiero procesarlos todos". El Proyecto H, sin embargo, **no tiene esa forma**: los fotogramas llegan uno a uno, a un ritmo que no conoces de antemano, durante un tiempo que podría no tener un final fijo (una cámara real nunca te dice de antemano "soy el último fotograma"). `QtConcurrent::mapped` necesita conocer la colección completa antes de empezar — no está pensado para un flujo continuo que crece mientras lo consumes.

La solución adoptada es un pool de **tareas persistentes**: no un `QRunnable` por fotograma (que pagaría el coste de crear y planificar un nuevo objeto por cada fotograma, un overhead que, con fotogramas llegando cada 90 milisegundos, importa), sino un número fijo de `FrameWorkerTask` — típicamente 2, configurable por el usuario en la GUI — cada uno de los cuales permanece en ejecución **durante toda la duración de la pipeline**, extrayendo fotogramas del buffer uno tras otro en su propio bucle interno:

```cpp
void FrameWorkerTask::run() {
    QImage frame;
    int frameNumber = -1;

    while (m_buffer->consume(frame, frameNumber)) {
        // ... process, measure, emit signals ...
        if (m_flag->requested()) break;
    }
}
```

Cada `FrameWorkerTask` hereda tanto de `QObject` (para poder emitir señales hacia la GUI) como de `QRunnable` (para ser planificable por `QThreadPool::start()`) — una doble herencia que en el Módulo 5 aún no habías tenido motivo de usar, porque allí tus `QRunnable` eran puramente computacionales, sin necesidad de comunicar resultados vía señales.

**Trampa — el tamaño del pool debe fijarse *antes* de arrancar las tareas, no después.** `QThreadPool::setMaxThreadCount(N)` debe llamarse antes de `start()`, y con tareas persistentes la secuencia equivocada no es solo subóptima, es potencialmente un estancamiento silencioso: si arrancas `N` tareas pero el pool tiene espacio para menos de `N` hilos simultáneos, las tareas sobrantes quedan en cola interna del pool, esperando a que termine alguna de las que ya están en ejecución — algo que, para una tarea que hace bucle hasta que el buffer se cierra, no ocurre hasta el final de la pipeline. El resultado es un pool que parece "arrancado" pero en el que solo una parte de los workers está realmente consumiendo del buffer, con un throughput reducido y ningún mensaje de error que lo señale.

**Cuándo elegir uno u otro, en tu trabajo real.** Si tu problema es "tengo un lote de 200 imágenes ya en disco, procésalas todas y avísame cuando termines", `QtConcurrent::mapped` con un `QFutureWatcher` sigue siendo la opción más simple y más legible — no la reinventes con un pool persistente solo porque la has visto aquí. Si tu problema es "un flujo continuo de datos entrantes, de duración desconocida, que debe procesarse con un retardo mínimo mientras sigue llegando", el patrón del Proyecto H — pool persistente que extrae de un buffer compartido — es la forma natural del problema.

## Etapa 4: cancelación cooperativa completa — la parte más difícil del curso

Si hay un solo pasaje de este módulo que merece releerse frase por frase dos veces, es este. Detener correctamente **un** worker, como en el Módulo 4, requiere disciplina pero es conceptualmente simple: un flag, un bucle que lo comprueba, un `quit()` + `wait()` final. Detener **una pipeline con tres etapas concurrentes que se pasan datos a través de un buffer bloqueante** es un problema cualitativamente distinto, porque ahora existen varias formas en que un hilo puede estar "ocupado" en el instante exacto en que llega la solicitud de parada, y cada una requiere que alguien más lo despierte físicamente — un flag por sí solo ya no basta.

### El error que cometería una versión ingenua

Imagina escribir, de un tirón, esta secuencia de parada:

```cpp
// NAIVE VERSION -- DO NOT DO THIS
void naiveShutdown() {
    m_flag.requestStop();        // (a)
    m_captureThread->quit();     // (b)
    m_captureThread->wait();     // (c)  <-- can hang here forever
    m_pool->waitForDone();       // (d)
}
```

Parece razonable, y es exactamente el tipo de código que superaría una prueba rápida hecha pulsando Stop mientras la pipeline está descargada. El problema surge en un caso concreto pero nada raro: si, en el momento en que se llama a `naiveShutdown()`, el hilo de captura está bloqueado *dentro* de `m_buffer->produce()` porque el buffer está lleno — es decir, exactamente el escenario de contrapresión del artículo anterior, comportamiento **normal y esperado** de la pipeline — entonces el paso (a) no sirve de nada: `m_flag` es una variable atómica, pero el hilo de captura no la está mirando en este momento, está durmiendo dentro de `QWaitCondition::wait()`, que solo se despierta con una `wakeOne()`/`wakeAll()` explícita o con un despertar espurio. El paso (b) encola una solicitud de salida que el hilo nunca podrá procesar, porque no está en su event loop. El paso (c), `wait()`, se bloquea entonces **para siempre** — no es una ralentización, es un estancamiento (deadlock) real.

### La secuencia correcta, paso a paso

![Full shutdown: the deadlock-free stop ordering](modulo-06/27-full-pipeline-shutdown.png)

El paso que le falta a la versión ingenua es `FrameBuffer::close()`, y su posición en la secuencia no es negociable: debe venir **antes** de cualquier `wait()` bloqueante sobre hilos o pool, porque es el único de los cuatro pasos que **despierta físicamente** a quien está dormido en una `QWaitCondition` — exactamente la misma lección del Módulo 2, aquí aplicada a tres etapas concurrentes en lugar de dos:

```cpp
void MainWindow::startShutdownSequence(const QString &reason, bool earlyCancellation) {
    if (m_stopInProgress || !m_running) return;
    m_stopInProgress = true;

    if (earlyCancellation) {
        m_flag.requestStop();    // stop producing NEW frames
    }
    m_buffer->close();           // WAKES anyone blocked in wait() -- the step that matters

    // wait for real termination, but NEVER on the GUI thread (see below)
    QThread *captureThread = m_captureThread;
    QThreadPool *pool = m_pool;
    QFuture<void> future = QtConcurrent::run([captureThread, pool]() {
        captureThread->quit();
        captureThread->wait();
        pool->waitForDone();
    });
    // ... QFutureWatcher signals onPipelineFullyStopped() when done ...
}
```

Con `close()` llamado antes, el hilo de captura bloqueado en `produce()` se despierta de inmediato (`m_notFull.wakeAll()` dentro de `close()`), ve `m_closed == true`, y `produce()` devuelve `false` — su `start()` sale del bucle y termina, el hilo vuelve a su propio event loop, y es solo en ese momento cuando el `quit()` encolado antes tiene efecto real. Lo mismo ocurre, de forma especular, con cualquier `FrameWorkerTask` que estuviera bloqueado en `consume()` sobre un buffer vacío.

### Por qué la espera final no puede estar en el hilo de la GUI

Hay una segunda trampa, menos dramática que un estancamiento pero no menos importante: tanto `QThread::wait()` como `QThreadPool::waitForDone()` son llamadas **bloqueantes**. Incluso una vez resuelto el problema del estancamiento con `close()`, llamarlas directamente desde el slot conectado al botón Stop bloquearía el hilo de la GUI durante toda la duración del drenaje — que, con workers todavía a mitad de un fotograma de 200 milisegundos, puede ser perceptible. Es la misma lección exacta del Módulo 0, el primerísimo capítulo de todo el curso ("nunca bloquees el hilo de la GUI"), que aquí vuelve a escala de pipeline completa: la solución es sacar la espera del hilo de la GUI con `QtConcurrent::run()` (Módulo 3, usado aquí para una tarea distinta de aquella para la que lo aprendiste — no procesar datos, sino *esperar* a que otros hilos terminen) y un `QFutureWatcher` que llama a `onPipelineFullyStopped()` cuando el drenaje realmente ha terminado, con una conexión queued hacia el hilo de la GUI (Módulo 4).

### Parada anticipada frente a parada natural: no son lo mismo

Una última distinción, sutil pero real: cuando el usuario pulsa Stop a mitad de la pipeline, se levanta el flag cooperativo, y cada `FrameWorkerTask` lo comprueba después de terminar el fotograma que tiene entre manos — es decir, deja de extraer más, aunque el buffer todavía contenga algunos. Es una decisión de capacidad de respuesta: el usuario ha pedido detenerse *ahora*, no "cuando hayas terminado todo el trabajo ya en cola". Cuando, en cambio, la captura termina por sí sola porque ha alcanzado el número de fotogramas solicitado, no existe una urgencia análoga: el flag **no** se levanta, y los workers siguen drenando `consume()` hasta que el buffer está realmente vacío — se garantiza que todo fotograma capturado llegue a procesarse. Dos caminos de parada, misma secuencia `close()` → espera asíncrona → notificación, pero una sola diferencia deliberada, y es la diferencia entre "detente ya" y "termina lo que empezaste": en el trabajo con sistemas de visión, es casi siempre una distinción que el operador de la máquina espera poder controlar, no un detalle de implementación.

Con el procesamiento paralelo y la cancelación cooperativa completa ya claros, el último artículo de este módulo — y del curso — recorre la integración con la GUI y el proyecto guiado completo: cómo construirlo, cómo compilarlo, y qué observar cuando lo ejecutas de verdad.
