---
title: "Esperar un evento, no un lock: QWaitCondition, QSemaphore, y cómo dispararse en el pie"
description: "Multithreading en C++ con Qt — Módulo 2"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Esperar un evento, no un lock: QWaitCondition, QSemaphore, y cómo dispararse en el pie

En el artículo anterior vimos cómo proteger un dato compartido con `QMutex` y `QReadWriteLock`. Pero el productor-consumidor necesita responder a una pregunta distinta y más sutil: "el buffer está lleno — debo esperar a que *cambie algo*, no solo a que el lock se libere". Un mutex por sí solo no basta para expresar "espera hasta que cierta condición sobre los datos se vuelva verdadera": puedes tenerlo bloqueado para siempre en un ciclo que revisa continuamente (una espera activa, que desperdicia CPU inútilmente), o bien necesitas una herramienta pensada específicamente para esto. Esa herramienta es `QWaitCondition`.

## QWaitCondition: esperar un evento, no solo un lock libre

Una `QWaitCondition` permite a un thread **dormirse** liberando temporalmente un mutex que posee, quedar en espera hasta que otro thread lo **despierte** explícitamente, y solo entonces readquirir el mutex y continuar. La parte crucial, la que la hace diferente de un simple "duerme y vuelve a comprobar", es que el dormirse y el liberar el mutex ocurren como una única operación atómica: nunca hay una ventana de tiempo en la que el thread ya haya liberado el lock pero aún no esté "registrado" como en espera, ventana que de otro modo podría hacer perder un despertar enviado justo en ese instante (un bug clásico llamado *lost wakeup*, que `QWaitCondition` previene por construcción).

El patrón de uso es siempre el mismo:

```cpp
QMutex mutex;
QWaitCondition condition;
bool dataReady = false;

// Waiting thread:
QMutexLocker locker(&mutex);
while (!dataReady) {
    condition.wait(&mutex);   // releases the mutex, sleeps, reacquires it on wake-up
}
// the mutex is back in my hands here, and dataReady is true

// Notifying thread:
{
    QMutexLocker locker(&mutex);
    dataReady = true;
}
condition.wakeOne();   // or wakeAll(), if more than one thread must be woken
```

Fíjate en el `while`, no un simple `if`: es deliberado, y no es una manía estilística. Al despertar, el código **debe volver a comprobar desde cero** la condición que estaba esperando, porque puede haber despertares "espurios" (por razones internas del sistema operativo, sin que nadie haya llamado realmente a `wakeOne()`), o bien porque — en el caso de `wakeAll()` con varios threads en espera — otro thread podría haberse adelantado y haber consumido ya lo que estabas esperando antes de que tú retomaras de verdad el control. Un `if` en lugar del `while` es uno de los errores más comunes y más difíciles de detectar en código basado en wait conditions: funciona casi siempre en las pruebas, y falla raramente, en producción, en un momento que nadie logra reproducir a voluntad.

`wakeOne()` despierta exactamente un thread en espera (si hay más de uno, la elección de cuál no está especificada — nunca confíes en un orden); `wakeAll()` los despierta a todos, cada uno de los cuales volverá igualmente a comprobar su propia condición (de ahí, otra vez, la importancia del `while`) y volverá eventualmente a esperar si la condición todavía no es la adecuada para él.

En el proyecto práctico de este módulo usarás **dos** `QWaitCondition` distintas sobre el mismo buffer: una para la dirección "el buffer está lleno, el productor espera", otra para "el buffer está vacío, el consumidor espera". Es un patrón estándar, y verlo aplicado con tus propias manos aclarará mucho más que cualquier explicación abstracta adicional.

## QSemaphore: contar en lugar de esperar un booleano

Hay una última primitiva que merece la pena conocer, aunque hoy no la usaremos directamente: `QSemaphore`. Un semáforo (en el sentido informático del término, concepto que se remonta a Dijkstra en los años 60) es, conceptualmente, un contador entero no negativo con dos operaciones: `acquire()`, que decrementa el contador pero **bloquea** al llamante si el contador ya está en cero, esperando a que vuelva a ser positivo; y `release()`, que incrementa el contador y despierta a los threads que pudieran estar esperando en `acquire()`.

¿Por qué es útil? Porque expresa naturalmente el concepto de "N recursos intercambiables disponibles" — no "el buffer está lleno o vacío" en sentido booleano, sino "cuántos espacios libres hay en este momento", contados explícitamente. El productor-consumidor de este módulo también se puede resolver de esta manera, y es instructivo ver la correspondencia: dos semáforos, `freeSlots` inicializado a la capacidad del buffer y `usedSlots` inicializado a cero, donde el productor hace `freeSlots.acquire()` antes de insertar y `usedSlots.release()` después, y el consumidor hace exactamente lo contrario. El resultado final es equivalente en comportamiento al que construimos con `QWaitCondition` — es la misma idea, el mismo par de condiciones "lleno" y "vacío", pero expresada con un contador en lugar de con un booleano y dos wait conditions explícitas.

¿Cuál de los dos estilos elegir, en el código real que escribirás después de este curso? `QWaitCondition` (la que usaremos hoy) es la herramienta adecuada cuando la condición de espera es más rica que un simple conteo — por ejemplo "espera hasta que el buffer contenga *un elemento con cierta propiedad*", no solo "espera hasta que no esté vacío". `QSemaphore` es más directo y legible cuando tu problema es, literalmente, un conteo de recursos disponibles — un pool de conexiones, un número fijo de slots de hardware, un límite de cuántas operaciones concurrentes están permitidas. Ninguno de los dos es "superior": elige el que refleje más fielmente la forma real del problema.

## Deadlock: la espera circular

Introducir mutex y wait conditions sin hablar de cómo uno se dispara en el pie con ellos sería deshonesto. Tres trampas, en orden de cuán comunes son en la práctica.

Un **deadlock** se produce cuando dos (o más) threads quedan bloqueados para siempre, cada uno esperando un recurso que otro thread del grupo posee y nunca liberará — porque, a su vez, está esperando algo que el primero posee. El Thread A tiene el Mutex X y espera adquirir el Mutex Y; el Thread B, en el mismo momento, tiene Y y espera X. Ninguno de los dos puede avanzar, ninguno de los dos liberará jamás lo que tiene (porque para liberarlo debería primero terminar su propio trabajo, que está bloqueado), y el programa se queda ahí, silenciosamente, para siempre — sin crash, sin mensaje de error, simplemente dos threads que ya no hacen nada.

![Deadlock: circular waiting](modulo-02/11-deadlock-circular-wait.png)

La condición que hace posible este escenario tiene un nombre en la literatura clásica de sistemas operativos (las "condiciones de Coffman", por el nombre de uno de los autores del artículo de 1971 que las formalizó por primera vez), y son cuatro, todas necesarias simultáneamente para que un deadlock pueda producirse: exclusión mutua (los recursos no se pueden compartir), posesión-y-espera (un thread tiene un recurso mientras espera otro), sin apropiación (un recurso no puede arrebatarse a la fuerza a quien lo posee), y **espera circular** (existe un ciclo de threads, cada uno esperando un recurso que posee el siguiente del ciclo). De las cuatro, las primeras tres son casi siempre intrínsecas al problema que estás resolviendo — no puedes eliminarlas sin desnaturalizar la solución. La cuarta, la espera circular, es en cambio sobre la que tienes palanca práctica, y es por eso que toda guía sobre deadlock converge en la misma recomendación: **establece un orden global fijo en el que los locks siempre se adquieren**, en cada punto del programa, sin excepciones. Si cada thread que necesita tanto X como Y los adquiere siempre en el mismo orden (digamos, siempre primero X y luego Y, nunca al revés), el ciclo se vuelve estructuralmente imposible: no puede existir una espera circular si todos hacen fila en la misma dirección.

En el proyecto práctico de hoy el riesgo de deadlock es bajo porque usamos un solo mutex (el interno del buffer) — pero es un riesgo que crece rápidamente en cuanto un proyecto real empieza a tener varios recursos protegidos por separado, y es el motivo por el que merece la pena fijar bien el principio desde ahora, antes de que lo necesites bajo presión con un depurador abierto y un programa que ya no responde.

## Starvation: técnicamente vivo, de hecho olvidado

La **starvation** (inanición) es más sutil que el deadlock porque no bloquea todo: un thread específico, simplemente, nunca obtiene el recurso que necesita, aunque no exista ningún ciclo de espera que lo impida en teoría — siempre es adelantado por otros threads más "afortunados" o más frecuentes en sus solicitudes. Es exactamente la violación de la tercera propiedad vista en el artículo anterior, la espera limitada. `wakeOne()` sobre una `QWaitCondition` con muchos threads en espera, por ejemplo, no garantiza un orden de despertar equitativo (no es necesariamente FIFO) — en escenarios con contención muy alta y patrones de acceso desequilibrados, es teóricamente posible que el mismo thread quede desafortunado durante más tiempo del que esperarías. Para nuestro proyecto práctico, con un solo productor y un solo consumidor, este riesgo es nulo por construcción (no hay a quién adelantar); se convierte en un factor real a considerar cuando tu sistema crece a varios productores o varios consumidores sobre el mismo buffer.

## Inversión de prioridad: cuando el sistema operativo añade un tercero incómodo

Una última trampa, más rara pero que merece la pena conocer por su nombre porque cuando ocurre es particularmente difícil de diagnosticar: la **inversión de prioridad**. Sucede cuando un thread de **baja prioridad** posee un lock que necesita un thread de **alta prioridad**; este último se bloquea esperando, lo cual ya sería normal — pero si mientras tanto un tercer thread de prioridad **media** (que no necesita ese lock) mantiene ocupada la CPU, el scheduler sigue dándole espacio en detrimento del thread de baja prioridad que posee el lock, el cual no logra terminar su trabajo y liberarlo. El resultado neto es que el thread de alta prioridad queda bloqueado indirectamente por uno de prioridad media, una inversión completa del orden de prioridad que el sistema debería haber respetado.

Es un problema bastante real como para haber causado, históricamente, el casi-fracaso de la misión Mars Pathfinder de la NASA en 1997 — un caso de estudio citado con muchísima frecuencia en la literatura precisamente por esto. Cuento los detalles en un artículo aparte, porque merece la pena entender exactamente cómo un problema de sincronización en un rover a 225 millones de kilómetros de distancia se convirtió en un reinicio periódico de todo el sistema, y cómo se diagnosticó y resolvió — ver *"Mars Pathfinder: cuando la inversión de prioridad llega a Marte"*.

La mitigación clásica a nivel de sistema operativo se llama *priority inheritance* (herencia de prioridad): temporalmente, el thread de baja prioridad que posee el lock disputado "hereda" la prioridad del thread más alto que lo está esperando, de modo que el scheduler lo favorece lo suficiente como para que termine el trabajo y libere el lock. Qt no gestiona esto automáticamente a nivel de aplicación — es típicamente responsabilidad del scheduler del sistema operativo subyacente — pero saber que el fenómeno existe, y reconocer sus síntomas (un thread de alta prioridad misteriosamente lento, en presencia de carga de threads de prioridad intermedia), te ahorrará horas de depuración el día en que lo encuentres en un sistema con restricciones de tiempo real.

## De la teoría a las manos sobre el teclado

Ahora tienes todas las herramientas para proteger y coordinar estado compartido de verdad: `QMutex`, `QReadWriteLock`, `QWaitCondition`, `QSemaphore`, y el vocabulario para reconocer deadlock, starvation e inversión de prioridad cuando los encuentres. En el próximo artículo juntamos todo construyendo un verdadero productor-consumidor, con dos threads persistentes que se disputan un buffer limitado ante tus ojos.
