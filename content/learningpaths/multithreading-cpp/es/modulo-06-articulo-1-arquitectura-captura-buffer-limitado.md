---
title: "Capstone: arquitectura de una pipeline de visión — captura y buffer limitado"
description: "Multithreading en C++ con Qt — Módulo 6 (Capstone)"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone: arquitectura de una pipeline de visión — captura y buffer limitado

Empezaste, seis módulos atrás, con un botón que bloqueaba una ventana. Un clic, un cálculo pesado ejecutado en el lugar equivocado, y toda la aplicación dejaba de respirar durante unos segundos — no por un bug exótico, sino porque eso es sencillamente lo que ocurre cuando un solo hilo tiene que hacer a la vez el trabajo y responder al usuario. Desde ahí has ido construyendo, pieza a pieza, todo un vocabulario: `QThread` y la arquitectura de event loop (Módulo 1), `QMutex` y `QWaitCondition` para coordinar estado compartido real (Módulo 2), `QtConcurrent` y el modelo Future/Promise para trabajo de grano grueso (Módulo 3), las reglas precisas de las conexiones entre hilos y la cancelación cooperativa (Módulo 4), `QThreadPool`, los atómicos y el coste oculto de la caché (Módulo 5). Cada módulo resolvió un problema concreto y aislado, con un proyecto guiado que lo demostraba por sí solo.

Este módulo capstone no introduce uno nuevo. Su tarea es distinta y, si somos honestos, más difícil: tomar todas esas piezas y hacer que funcionen **juntas**, en el mismo programa, al mismo tiempo — porque esa es exactamente la diferencia entre "conocer una técnica" y "saber construir un sistema". Un thread pool que funciona perfectamente bien por sí solo, en aislamiento, puede quedarse bloqueado para siempre si el orden en que lo apagas respecto a un buffer aguas arriba es el equivocado. Una cancelación cooperativa impecable con un solo worker hay que repensarla desde cero cuando los workers cooperantes pasan de ser uno a ser tres etapas concurrentes.

El proyecto guiado de estos últimos artículos, **Proyecto H — Pipeline de procesamiento de fotogramas en tiempo casi real**, está deliberadamente cerca de un caso real: un hilo de captura que simula una cámara, un buffer limitado que desacopla captura y procesamiento, un pool de workers que aplica un filtro real a cada fotograma en paralelo, un mecanismo de parada que debe detenerlo todo sin perder datos y sin quedarse colgado, y una GUI que permanece reactiva de principio a fin. Cinco etapas, cada una construida con la técnica de un módulo concreto.

## Vista de conjunto: cinco etapas, un solo flujo

![End-to-end architecture of the capstone pipeline](modulo-06/25-capstone-pipeline-architecture.png)

El flujo es lineal en la dirección de los datos — un fotograma nace en la Etapa 1, atraviesa la Etapa 2, es consumido y procesado en la Etapa 3, y su resultado llega a la Etapa 5 mediante señales — pero **no** es lineal en el control: la Etapa 4, el flag de cancelación cooperativa, no es un quinto eslabón de la cadena, es una línea que toca a *las otras cuatro* al mismo tiempo, porque detener la pipeline es una operación que debe tocar cada etapa en el orden correcto, de forma explícita.

Aquí está el mapa completo de qué módulo del curso enseñó la técnica de cada etapa:

- **Etapa 1 — Captura**: un `QThread` persistente con un worker movido mediante `moveToThread()`, nunca una subclase de `QThread`. Técnica del **Módulo 1**.
- **Etapa 2 — Buffer compartido**: `QMutex` + dos `QWaitCondition`, una cola limitada, el mismo esquema productor-consumidor visto anteriormente. Técnica del **Módulo 2**.
- **Etapa 3 — Procesamiento paralelo**: un pool de tareas persistentes sobre `QThreadPool`, con una alternativa a `QtConcurrent` discutida y justificada. Técnica del **Módulo 5** (con una comparación explícita respecto al **Módulo 3**).
- **Etapa 4 — Cancelación cooperativa**: un flag atómico compartido, extendido para coordinar correctamente tres etapas concurrentes en lugar de una. Técnica del **Módulo 4**.
- **Etapa 5 — Integración con la GUI**: señales con conexión queued hacia el hilo principal, que nunca se bloquea. Técnica del **Módulo 0** aplicada de nuevo a escala de sistema completo.

## Etapa 1: la captura, un worker persistente que no sabe nada del resto

**Objetivo.** Un hilo separado que genera fotogramas sintéticos a un ritmo regular y controlado, exactamente como haría el driver de una cámara real — sin tocar nunca directamente la GUI, sin saber nada de cómo se procesarán los fotogramas.

El patrón es el del Módulo 1: ninguna subclase de `QThread`, un `QObject` worker (`CaptureWorker`) movido con `moveToThread()` a un `QThread` puro, arrancado cuando el hilo emite `started`. Lo nuevo es qué hace el worker una vez arrancado: no procesa nada él mismo, se limita a generar una `QImage` sintética y a entregarla a la siguiente etapa:

```cpp
void CaptureWorker::start() {
    int frameNumber = 0;

    while (!m_flag->requested() && frameNumber < m_targetFrameCount) {
        QThread::msleep(m_intervalMs);
        if (m_flag->requested()) break;   // re-check even after the sleep

        QImage frame = generateSyntheticFrame(frameNumber);
        if (!m_buffer->produce(frame, frameNumber)) break;

        emit frameCaptured(frameNumber);
        ++frameNumber;
    }

    emit captureFinished(frameNumber);
}
```

**Trampa 1 — la reverificación después del sleep.** Fíjate en el segundo `if (m_flag->requested()) break;`, justo después de `QThread::msleep()`. Si no estuviera, podría producirse un fotograma "de más" precisamente en la ventana de tiempo entre una solicitud de parada y el despertar del sleep — no es un bug catastrófico, pero es disciplina: cada punto en el que el hilo recupera el control tras una espera es un punto en el que vale la pena preguntarse de nuevo "¿debería seguir aquí?", exactamente el espíritu del `while` (no `if`) que el Módulo 2 te enseñó para las `QWaitCondition`.

**Trampa 2 — dos condiciones de terminación independientes.** El bucle termina por dos razones distintas, y ambas importan: el flag de cancelación (Módulo 4) o el objetivo de fotogramas alcanzado. Un error común al integrar varias etapas es pensar que basta con *una* de las dos condiciones — pero el caso "la captura simplemente terminó su trabajo" no es en absoluto igual al caso "el usuario interrumpió todo a mitad de camino": más adelante veremos que la secuencia de apagado correcta es distinta en cada caso.

**Trampa 3 — qué pasa si `produce()` devuelve `false`.** El worker de captura nunca comprueba directamente el estado del buffer: le basta el valor de retorno de `produce()`. Si alguien más ya ha cerrado el buffer mientras el worker estaba bloqueado esperando espacio libre, la llamada devuelve `false` y el bucle sale limpio. Es el mismo principio de encapsulación del Módulo 2: la lógica de cierre vive en un solo lugar, no dispersa entre los hilos que la usan.

## Etapa 2: el buffer limitado, y la contrapresión como decisión deliberada

**Objetivo.** Desacoplar el ritmo de captura del de procesamiento, de modo que ambas etapas puedan avanzar a velocidades distintas sin que una tenga que esperar a la otra paso a paso — pero con un límite claro a cuánta "distancia" puede crecer entre ambas.

`FrameBuffer` es, deliberadamente, una reescritura del mismo patrón de buffer compartido construido en el Módulo 2, no copiada sino repensada para transportar `QImage` en lugar de enteros: mismo `QMutex`, mismas dos `QWaitCondition` (`m_notFull` para el productor, `m_notEmpty` para los consumidores), mismo bucle `while` de reverificación, misma disciplina RAII con `QMutexLocker`.

```cpp
bool FrameBuffer::consume(QImage &frameOut, int &frameNumberOut) {
    QMutexLocker locker(&m_mutex);

    while (m_queue.isEmpty() && !m_closed) {
        m_notEmpty.wait(&m_mutex);
    }

    if (m_queue.isEmpty()) return false;   // closed AND empty: really done

    Entry e = m_queue.dequeue();
    frameOut = e.frame;
    frameNumberOut = e.number;
    emit occupancyChanged(m_queue.size(), m_capacity);

    m_notFull.wakeOne();
    return true;
}
```

**Trampa — la condición de retorno de `consume()` no es simétrica a la de `produce()`, y es intencional.** Mira bien la línea `if (m_queue.isEmpty()) return false;`: la comprobación es solo sobre la cola vacía, no también sobre `m_closed`. Eso significa que, una vez cerrado el buffer, `consume()` **sigue devolviendo `true`** mientras aún queden fotogramas en cola — cerrar el buffer no descarta nada de lo que ya se produjo. Es una decisión de diseño que merece hacerse explícita: la opción contraria (descartar todo en cuanto llega `close()`) habría sido igual de fácil de escribir y mucho más peligrosa en un sistema de visión real, donde un fotograma descartado puede significar un evento no detectado.

### El porqué del límite

![Backpressure: the bounded buffer fills up and the producer waits](modulo-06/26-backpressure-bounded-buffer.png)

Con una capacidad fija y un ritmo de captura más rápido que el ritmo de procesamiento agregado, el buffer se llena con regularidad durante la ejecución del proyecto, y `CaptureWorker::start()` se bloquea dentro de `m_buffer->produce()` esperando espacio, tal como estaba previsto. Este es un punto en el que vale la pena detenerse a pensar en términos de sistema, no solo de código: la contrapresión (backpressure) no es un defecto de diseño, es **la alternativa deliberada y superior** a una cola ilimitada. Con una cola que puede crecer sin límite, un productor más rápido que el consumidor nunca esperaría — pero la memoria ocupada por los fotogramas en espera crecería sin límite bajo carga sostenida, el retraso entre "fotograma capturado" y "fotograma procesado" se volvería arbitrariamente grande y, sobre todo, invisible hasta que algo agote los recursos disponibles. Un buffer limitado convierte un problema latente y silencioso en una ralentización inmediata, medible, y — lo que es más importante para un sistema que debe funcionar 24 horas al día sobre hardware embebido — con un límite de memoria conocido de antemano.

Con la captura y el buffer limitado ya encuadrados, el próximo artículo aborda la parte más delicada de todo el módulo: cómo procesar los fotogramas en paralelo con un pool persistente, y cómo detener correctamente una pipeline en la que tres etapas concurrentes pueden estar dormidas en puntos distintos en el mismo instante.
