---
title: "La sección crítica formalizada: QMutex, QMutexLocker y QReadWriteLock"
description: "Multithreading en C++ con Qt — Módulo 2"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# La sección crítica formalizada: QMutex, QMutexLocker y QReadWriteLock

En el módulo anterior aprendiste a hacer correr trabajo en un thread separado y a comunicarlo con la GUI de forma segura — pero si te fijas bien, nunca necesitaste un mutex propiamente dicho. El worker y la ventana nunca tocaban la misma variable en el mismo momento: se intercambiaban mensajes mediante señales, y Qt se encargaba de entregarlos en cola, uno a la vez, sin solapamientos. Es una forma elegante de evitar el problema de la memoria compartida evitando, precisamente, compartirla — un worker aislado, con su propio estado privado, que habla con el exterior solo mediante señales.

Este artículo aborda el caso en que esa elegancia ya no basta: dos o más threads que necesitan de verdad leer y escribir la **misma estructura de datos**, en el mismo momento, porque esa compartición es precisamente el objetivo del programa — no un efecto secundario a evitar. Es el caso clásico, antiquísimo en la historia de los sistemas operativos y sin embargo aún hoy el pan de cada día de quien escribe software concurrente en serio: el **productor-consumidor**. Un thread genera datos a un ritmo que no controla del todo (un sensor, una red, en un sistema de visión una cámara que entrega frames a un cierto framerate); otro los procesa a un ritmo distinto, casi siempre más lento y variable. Entre ambos, un almacén de capacidad limitada — el **buffer** — que absorbe las diferencias de velocidad, hasta cierto punto: si el productor corre demasiado, el almacén se llena y debe esperar; si el consumidor se queda sin trabajo, espera él.

## La sección crítica, formalizada

Ya has visto la sección crítica como "el tramo de código que debe ejecutar un thread a la vez". Es útil pensarla como un pasillo con una sola puerta, del ancho justo para una persona. Quien llega y encuentra la puerta ocupada espera en fila fuera; quien está dentro sale cuando termina, y solo entonces el siguiente de la fila puede entrar.

![The critical section as a one-way corridor](modulo-02/09-critical-section-corridor.png)

Pero "un thread a la vez" por sí solo no basta para definir una solución *correcta*, y merece la pena dejar por escrito, una vez, las tres propiedades que la teoría clásica de sistemas operativos exige a cualquier mecanismo de sincronización — porque cada herramienta que veremos en este módulo debe juzgarse respecto a estas tres, no solo respecto a "funciona en mis pruebas".

**Exclusión mutua**: nunca más de un thread dentro de la sección crítica en el mismo instante. Es la propiedad más obvia, la que ya tratamos antes, y ninguna herramienta que veamos hoy la viola jamás — es el mínimo indispensable.

**Progreso**: si la sección crítica está libre y uno o más threads quieren entrar, la decisión de quién entra no puede posponerse indefinidamente por factores que no tienen que ver con el uso real del recurso. En pocas palabras: no debe existir un escenario en el que la puerta esté libre pero nadie logre nunca pasar por un defecto del propio mecanismo.

**Espera limitada**: un thread que espera para entrar debe, tarde o temprano, conseguirlo — no está permitido que otro siga adelantándolo indefinidamente. Esta es la propiedad más sutil, y es precisamente la que entra en crisis en los problemas de **starvation** (inanición) que encontraremos más adelante: un thread técnicamente podría entrar, la garantía de exclusión mutua nunca se viola, y sin embargo de hecho nunca le toca porque el "tráfico" en la sección crítica siempre lo adelanta.

Ten presentes estas tres propiedades como criterio de juicio: cada vez que diseñes un esquema de sincronización — en este módulo o en tu trabajo real — son las tres preguntas que debes hacerte, en ese orden.

## QMutex y QMutexLocker: la herramienta básica

`QMutex` es el equivalente nativo de Qt de `std::mutex`, que ya usaste en el primer artículo de este curso. El funcionamiento conceptual es idéntico — `lock()` entra en la sección crítica (esperando si es necesario), `unlock()` sale de ella — con algunas diferencias prácticas que merece la pena conocer.

No es redundancia gratuita que Qt tenga su propio mutex. `QMutex` existía en Qt desde antes de que `std::mutex` formara parte del estándar de C++ (llegado recién con C++11), y hoy sigue siendo la elección natural en código Qt por un par de razones concretas: se integra mejor con las herramientas de depuración de Qt Creator (que sabe inspeccionar el estado de un `QMutex` en el depurador de forma más legible), y sobre todo Qt ofrece, distinta de `QMutex`, una clase `QRecursiveMutex` para los (raros, y a usar con sospecha) casos en que un thread necesita poder adquirir varias veces el mismo lock sin bloquearse a sí mismo — útil en jerarquías de llamadas recursivas que pasan varias veces por la misma sección crítica, pero también una señal de alarma casi siempre síntoma de un diseño de la sincronización que podría simplificarse.

Exactamente igual que `std::lock_guard`, `QMutexLocker` adquiere el lock en el constructor y lo libera en el destructor:

```cpp
void SharedBuffer::produce(int value) {
    QMutexLocker locker(&m_mutex);
    // ... critical section ...
} // automatic unlock here, whichever way the function exits
```

La ventaja del patrón RAII aquí no es solo estética: si dentro de la sección crítica hay un `return` anticipado, o si se lanzara una excepción, `QMutexLocker` garantiza igualmente el desbloqueo — un `mutex.lock()` / `mutex.unlock()` escritos a mano te dejarían con un mutex bloqueado para siempre en cada uno de esos casos, uno de los bugs más traicioneros y difíciles de diagnosticar en toda la programación concurrente, porque el síntoma (el programa se cuelga) aparece muy lejos, en el tiempo y en el código, de la causa (el `unlock()` faltante).

Además de `lock()` (bloqueante, espera lo que haga falta), `QMutex` ofrece `tryLock()`, que intenta adquirir el lock y retorna inmediatamente con `true` o `false` según lo haya conseguido, sin bloquearse nunca — útil cuando tu thread tiene una alternativa sensata que hacer si el recurso está ocupado, en lugar de ponerse en cola. Existe también una variante con timeout, `tryLock(milliseconds)`, que espera como máximo el tiempo indicado antes de rendirse. No los usaremos en el proyecto práctico de este módulo — nuestro productor y consumidor *deben* esperar, no tienen un plan B — pero los encontrarás de forma natural el día en que diseñes código con restricciones de capacidad de respuesta más estrictas.

## QReadWriteLock: cuando la mayor parte del tráfico es de lectura

Hay un escenario muy común en el que `QMutex` es más restrictivo de lo necesario: cuando un dato compartido se **lee** muy a menudo por varios threads y se **escribe** raramente. Piensa en una tabla de configuración o en un mapa de calibración de un sistema de visión, cargado una vez y luego consultado continuamente por varios threads de procesamiento: con un `QMutex` ordinario, incluso dos lecturas — operaciones que, por sí solas, nunca se molestan mutuamente, porque ninguna de las dos modifica nada — se verían obligadas a hacer fila una detrás de otra, desperdiciando paralelismo que el hardware te ofrecería gratis.

`QReadWriteLock` distingue explícitamente las dos intenciones. Cuando varios threads quieren solo **leer**, pueden hacerlo todos juntos, en el mismo momento — ninguno bloquea al otro, porque una lectura no altera el estado que otra lectura está observando. En el momento en que un thread quiere **escribir**, en cambio, el lock se vuelve exclusivo en el sentido más estricto: ningún otro thread, sea lector o escritor, puede acceder al dato hasta que el escritor haya terminado.

![QReadWriteLock: concurrent reads, exclusive write](modulo-02/12-readwritelock-readers-writer.png)

El uso práctico sigue el mismo espíritu RAII ya visto: `QReadLocker` para adquirir en lectura, `QWriteLocker` para adquirir en escritura, ambos con liberación automática al final del scope.

```cpp
double readCalibration(int index) const {
    QReadLocker locker(&m_lock);
    return m_calibrationValues.at(index);
}

void updateCalibration(int index, double newValue) {
    QWriteLocker locker(&m_lock);
    m_calibrationValues[index] = newValue;
}
```

Una palabra de cautela, porque es un error conceptual habitual: `QReadWriteLock` **no siempre es más rápido** que `QMutex`, incluso en escenarios de lectura predominante. El mecanismo que lleva la cuenta de "cuántos lectores hay dentro en este momento" tiene un costo interno no nulo, y para secciones críticas muy breves (pocas instrucciones) ese costo de contabilidad puede superar el beneficio del paralelismo ganado — la misma lección de granularidad ya encontrada a propósito de los context switch, reaplicada aquí: la elección correcta depende de cuánto tiempo se pasa realmente dentro de la sección crítica y de cuán desequilibrado está el tráfico entre lecturas y escrituras, no de una intuición genérica sobre qué primitiva "suena" más eficiente.

## Qué queda por entender

Con `QMutex`, `QMutexLocker` y `QReadWriteLock` ya sabes cómo proteger un dato compartido de accesos simultáneos. Pero el productor-consumidor necesita algo más sutil: no solo "¿puedo entrar?", sino "debo esperar a que *cambie algo*, no solo a que el lock se libere". Es el tema del próximo artículo, junto con los peligros clásicos — deadlock, starvation, inversión de prioridad — que toda sincronización seria debe saber reconocer.
