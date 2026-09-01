---
title: "std::atomic, el modelo de memoria de C++, y el bug de rendimiento que no se ve en el código"
description: "Multithreading en C++ con Qt — Módulo 5"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# std::atomic, el modelo de memoria de C++, y el bug de rendimiento que no se ve en el código

Este artículo aborda el núcleo físico del módulo: `std::atomic` y el **modelo de memoria de C++**. Es un tema que la mayoría de los tutoriales en línea explican mal, enumerando `memory_order_relaxed`, `acquire`, `release`, `seq_cst` como si fueran opciones de configuración arbitrarias que se eligen a ojo. Aquí los explicamos partiendo de lo que ocurre *físicamente* dentro de un procesador multinúcleo — caché L1 por núcleo, líneas de caché, el protocolo que las mantiene coherentes — porque es la única manera en que estos conceptos dejan de ser reglas para memorizar y pasan a ser consecuencias obvias de cómo está hecho el hardware sobre el que corres.

De ahí llegamos a una consecuencia directa, y quizás la lección más sorprendente del módulo: dos variables `atomic` completamente independientes desde el punto de vista lógico — ningún hilo las usa nunca juntas, ninguna invariante las liga — pueden aun así ralentizarse mutuamente de forma dramática, solo por el hecho de estar cerca en memoria. Es el **false sharing** (comparación falsa, o "compartición falsa" de la caché).

## Dos preguntas distintas que el código concurrente siempre plantea juntas

Cuando dos hilos comparten una variable, en realidad hay dos problemas distintos, y la confusión entre ambos es la fuente del 80% de los malentendidos sobre el modelo de memoria:

**Atomicidad**: la operación (una escritura, un incremento, una comparación-e-intercambio) ocurre por completo, sin que ningún otro hilo pueda observarla nunca "a medias". `contador++` sobre un `int` normal, como viste en el Módulo 0, *no* es atómico: en realidad son tres pasos separados (leer, incrementar, escribir), y dos hilos pueden entrelazarse en medio de esos tres pasos, perdiendo una actualización.

**Orden y visibilidad**: incluso si una operación es atómica, queda abierta la pregunta de "*cuándo*, exactamente, el efecto de esa escritura se vuelve visible para los demás hilos, y respecto a qué otras operaciones del programa está garantizado que ocurra antes o después". Esta es una pregunta completamente distinta de la atomicidad, y `std::atomic<T>` resuelve ambas — pero con palancas de control separadas, y es aquí donde entra `std::memory_order`.

## Por qué el problema de la visibilidad existe físicamente: caché L1 por núcleo

![The C++ memory model: per-core L1 caches and the coherence problem](modulo-05/22-cpp-memory-model.png)

Un procesador moderno multinúcleo no lee ni escribe la memoria principal (la RAM) directamente en cada instrucción: sería demasiado lento, por órdenes de magnitud, respecto a la velocidad con la que la CPU ejecuta instrucciones. Cada núcleo tiene su propia **caché L1**, pequeña (típicamente 32-64 KB) pero muy rápida (pocos ciclos de reloj frente a los cientos necesarios para llegar a la RAM), donde guarda copias locales de los datos que está usando.

El problema es inmediato y físico, no es un detalle de implementación que se pueda ignorar: si el Hilo A, ejecutándose en el Núcleo 1, escribe `x = 1`, esa escritura lo primero que hace es actualizar la caché L1 del Núcleo 1 — **no** la RAM compartida, no de inmediato, y no necesariamente nunca en un orden que tú controles directamente al escribir `x = 1` en C++. Si en ese mismo instante el Hilo B, en el Núcleo 2, lee `x` desde su propia caché L1, perfectamente puede leer todavía `0` — la copia antigua, porque su caché no tiene ningún motivo automático para saber que el Núcleo 1 acaba de cambiar de idea, hasta que un mecanismo explícito se lo comunique. Esto no es un bug del procesador: es el precio físico, aceptado deliberadamente por los diseñadores de hardware, a cambio de tener cachés locales rápidas en lugar de un acceso compartido lento a todo.

Los procesadores modernos resuelven esto con un **protocolo de coherencia de caché** (el más extendido se llama MESI, por las iniciales de los cuatro estados que puede adoptar una línea de caché — Modified, Exclusive, Shared, Invalid) que mantiene alineadas entre sí las cachés de los distintos núcleos *cuando hace falta*. Pero "cuando hace falta" es precisamente lo que tú, como programador, tienes que especificar — y lo especificas eligiendo el `memory_order` de tus operaciones atómicas. Sin esa especificación explícita, tanto el compilador como la CPU tienen libertad para reordenar las operaciones de lectura y escritura de maneras que, en código de un solo hilo, nunca cambiarían el resultado observable (es la misma libertad que en el Módulo 0 viste usada por el compilador para mantener una variable no protegida en un registro, enmascarando la race) — pero que en código multihilo pueden producir resultados que el orden de escritura de tu código fuente no preveía en absoluto.

## Qué garantiza std::atomic sobre la atomicidad: cómo funciona a nivel de hardware

En una CPU x86-64 — la familia de procesadores más común en escritorios y servidores, casi con toda seguridad aquella en la que compilarás y ejecutarás el proyecto guiado — una operación como `fetch_add` sobre un `std::atomic<int>` se traduce típicamente en una sola instrucción de máquina con el prefijo `LOCK` (por ejemplo `LOCK XADD`), que le dice al bus de memoria y al protocolo de coherencia de caché: "esta operación de lectura-modificación-escritura debe ocurrir como un único bloque indivisible, ningún otro núcleo puede meterse en medio". En arquitecturas distintas (ARM, muy común en sistemas embebidos) el mecanismo cambia de forma — típicamente un par de instrucciones load-linked/store-conditional (LL/SC) que detecta si alguien más ha tocado la misma posición mientras tanto y, si es así, reintenta — pero la garantía final que te ofrece el estándar de C++ es idéntica: `fetch_add`, `compare_exchange` y las demás operaciones de lectura-modificación-escritura de `std::atomic` son indivisibles, sea cual sea el hardware por debajo.

## memory_order_relaxed: solo atomicidad, cero garantías de orden

```cpp
atomicCounter.fetch_add(1, std::memory_order_relaxed);
```

`relaxed` te da la primera garantía (la operación es indivisible — nunca se pierde ninguna actualización) y **no te da nada más**. No promete nada sobre cuándo ese incremento se hará visible a otros hilos, ni sobre cómo se relaciona en el tiempo con otras lecturas o escrituras, atómicas o no, que el mismo hilo haya hecho antes o después. Es la elección correcta cuando lo único que te importa es un recuento numérico correcto — un contador de estadísticas, un contador de eventos — y ninguna otra parte del programa necesita deducir nada del *momento* en que ese incremento ocurrió respecto a otra cosa.

## acquire/release: el puente "happens-before" entre dos hilos

```cpp
// Thread A: prepares the data, then publishes it
data.x = 42;
data.y = "result";
// "release": publish everything that precedes
readyFlag.store(true, std::memory_order_release);

// Thread B: waits, then consumes
// "acquire": makes everything before the release visible
while (!readyFlag.load(std::memory_order_acquire)) { }
// guaranteed to see the values written above, not stale ones
readData(data.x, data.y);
```

El mecanismo es el que en la literatura se llama relación **happens-before**: una `store` con `memory_order_release` funciona como una barrera que dice "todas las escrituras en memoria hechas por este hilo *antes* de esta instrucción deben ser visibles para cualquiera que, en otro hilo, observe *este mismo valor* mediante una `load` con `memory_order_acquire`". Es literalmente la analogía del candado que sugiere el nombre: `release` es como cerrar un candado y dejarlo donde otro pueda encontrarlo, `acquire` es como recogerlo y abrirlo — y en el momento en que lo abres, todo lo que estaba "dentro de la habitación" antes de que el primero la cerrara está garantizado que es visible para ti.

## memory_order_seq_cst: la elección por defecto, y por qué lo es

`seq_cst` (sequentially consistent, secuencialmente consistente) da todas las garantías de `acquire`/`release` **más** una adicional, más fuerte: todas las operaciones `seq_cst` de todos los hilos del programa parecen ocurrir en un único orden total, el mismo orden exacto visto por cada hilo que las observa. Es el modelo de razonamiento más cercano a "el programa ejecuta las instrucciones una a una, alternando entre hilos en algún orden" — la intuición ingenua que probablemente tenías en mente desde el principio, convertida aquí en una garantía real. El precio es un extra de sincronización de hardware casi siempre pequeño en las CPUs x86-64 modernas, pero no nulo.

La recomendación práctica: **usa `seq_cst` (el valor por defecto) a menos que tengas una razón medida y específica para bajar a un ordenamiento más débil**. `relaxed` y `acquire`/`release` son herramientas reales, usadas en el código de motores de videojuegos, bases de datos, sistemas operativos — pero exigen un razonamiento formal y disciplinado en cada uso individual. `seq_cst` no es "la versión perezosa": es la versión en la que tu razonamiento mental corresponde de verdad a una garantía del lenguaje.

## La paradoja aparente del false sharing

Este es un hecho que, la primera vez que lo ves medido, parece romper la intuición: dos variables `std::atomic<int>`, usadas por dos hilos distintos, sin que ninguno de los dos toque nunca la variable del otro, pueden ralentizarse mutuamente de forma drástica. Ninguna carrera crítica, ninguna violación de corrección, ningún `memory_order` equivocado: el programa calcula el resultado correcto en ambos casos. El problema es puramente de rendimiento, y está todo en la física que acabamos de ver, aplicada a un detalle que parece irrelevante: dónde, exactamente, viven en memoria las dos variables una respecto a la otra.

Las cachés no mueven datos byte a byte, ni variable a variable. Se mueven en bloques de tamaño fijo llamados **líneas de caché** (cache line), típicamente de 64 bytes en las CPUs x86-64 modernas — un valor físico del hardware, no una elección del compilador. Cuando un núcleo lee aunque sea un solo byte de una dirección, el hardware carga en caché la línea entera de 64 bytes que lo contiene — y el protocolo de coherencia de caché también trabaja a nivel de línea completa, no de variable individual.

Dos `std::atomic<int>` de 4 bytes cada uno, declarados uno seguido del otro en una struct, ocupan una fracción minúscula de los 64 bytes de una línea, así que el compilador, sin ninguna instrucción en contra, los coloca cerca en memoria — y es perfectamente plausible que acaben en la misma línea de caché. Ahora el Hilo A ejecuta `a.fetch_add(1)`: para ejecutarla, su núcleo debe tener acceso exclusivo a la línea de caché que contiene `a`, según el protocolo MESI. Y esa línea contiene también `b`. El resultado: la escritura de A sobre su propia variable invalida silenciosamente la copia de la línea que el núcleo de B tenía en caché — aunque B nunca haya leído ni escrito `a`. Es **contención fantasma**, generada no por un acceso real al mismo dato, sino por la compartición física accidental de la línea de caché que los contiene a ambos.

## La cura: alignas(64)

```cpp
struct alignas(64) PaddedCounter {
    std::atomic<int> value{0};
    // fills the rest of the line, deliberately unused
    char padding[64 - sizeof(std::atomic<int>)];
};
```

`alignas(64)` le dice al compilador: "cada instancia de esta struct debe empezar en una dirección de memoria múltiplo de 64" — es decir, al comienzo de una línea de caché. El campo `padding`, un array de bytes que nunca será leído ni escrito por nadie, existe con el único propósito de ocupar el espacio restante de la línea, impidiendo que el compilador coloque otra cosa justo al lado.

![False sharing: two independent atomics sharing one 64-byte cache line, and the alignas(64) fix](modulo-05/23-false-sharing-cache-line.png)

Es un compromiso explícito y hay que reconocerlo como tal: estás *desperdiciando* memoria (60 bytes sin usar por cada `int` de 4 bytes que quieres proteger) para *ganar* velocidad evitando la invalidación cruzada. Para dos contadores es un costo irrisorio; si estuvieras rellenando miles de pequeñas estructuras en un array enorme, ese compromiso habría que sopesarlo con más cuidado.

## Lock-free vs mutex: cuándo conviene, cuándo no

Con la física de la caché a las espaldas, estás preparado para responder a una pregunta que el Módulo 2 había dejado abierta: si `std::atomic` puede ser más rápido que un mutex para una operación sencilla — y el proyecto guiado del próximo artículo te lo demostrará con números reales — ¿por qué no sustituir *siempre* los mutex por atómicos?

Un `std::atomic<T>` te garantiza la atomicidad de una única operación sobre una única variable. En el momento en que tu problema requiere actualizar **varias variables relacionadas como si fueran una única operación indivisible** — la invariante clásica del Módulo 2, donde por ejemplo insertar en una cola significa tanto añadir el elemento como actualizar el recuento de elementos — un atómico por sí solo ya no basta. Podrías construir un algoritmo lock-free que maneje ese caso, típicamente basado en `compare_exchange` en bucles de reintento con técnicas no triviales para evitar el *problema ABA* — pero es código notoriamente difícil de escribir correctamente, difícil de revisar y difícil de probar, porque los bugs que introduce suelen ser rarísimos y dependientes del timing exacto entre núcleos. Para la inmensa mayoría del código de aplicación real, un `QMutex` que protege toda la invariante multivariable sigue siendo la elección más correcta, más legible y más fácil de mantener.

Es una simplificación demasiado común, y conviene corregirla explícitamente: un algoritmo lock-free no es automáticamente más rápido que uno basado en mutex. Bajo baja contención, un mutex moderno en Linux (basado en futex, que en el caso común evita por completo una llamada al sistema) y un atómico se comportan de forma muy similar en términos de costo. Bajo alta contención, una única operación atómica tiende a seguir siendo más barata que un lock/unlock completo, porque evita involucrar al scheduler cuando el hilo pierde la "carrera": simplemente reintenta, en lugar de ser pausado y despertado más tarde. Pero si la operación protegida es compleja, un algoritmo lock-free equivalente se vuelve rápidamente más costoso de diseñar, más costoso de ejecutar y mucho más arriesgado de certificar como correcto de lo que lo es un mutex bien colocado.

![Mutex vs lock-free atomics: two tools with different cost and risk profiles, not a ranking](modulo-05/24-lockfree-vs-mutex-tradeoff.png)

La regla práctica que vale la pena llevarse: parte siempre de `QMutex` (o `std::mutex`) como opción por defecto para cualquier estado compartido complejo o multivariable. Considera `std::atomic` solo para un caso específico y acotado — un contador, un flag booleano, un puntero compartido en un patrón bien conocido — y solo después de haber **medido** que esa sección es realmente un cuello de botella bajo contención real, no por intuición.

Con el modelo de memoria, el false sharing y la comparación lock-free/mutex ya claros, el próximo artículo pone todo a prueba con un proyecto guiado: dos benchmarks reales que miden estos efectos con un cronómetro de verdad, y ThreadSanitizer verificando que ninguna de las dos versiones esconde una race.
