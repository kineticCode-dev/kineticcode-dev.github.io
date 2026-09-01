---
title: "Cuando la memoria compartida muerde: race condition, data race y el hilo único de Qt"
description: "Multithreading en C++ con Qt — Módulo 0"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Cuando la memoria compartida muerde: race condition, data race y el hilo único de Qt

En el artículo anterior vimos por qué existen los threads y por qué conviene usarlos: comparten memoria sin fricción, y eso los hace cómodos y eficientes. Ahora llega la parte incómoda de la misma historia, porque esa comodidad tiene un precio preciso: la misma memoria compartida que hace útiles a los threads es, exactamente, la que los hace peligrosos. No puedes simplemente "tirar threads" a tu problema y esperar que salga bien.

## Race condition: cuando el resultado depende de quién llega primero

Una **race condition** ocurre cada vez que el resultado final de un programa depende del orden relativo —no controlado por ti, decidido por el scheduler— en que varios threads ejecutan operaciones sobre los mismos datos compartidos. El caso de manual es un contador compartido incrementado por varios threads. La instrucción, en C++, parece inocente y atómica solo porque cabe en una sola línea:

```cpp
counter++;
```

Pero "parece una sola operación" y "es una sola operación a nivel de CPU" son dos afirmaciones distintas, y la segunda es falsa. A nivel de instrucciones máquina, ese incremento típicamente se descompone en tres pasos: **leer** el valor actual de la memoria hacia un registro; **incrementar** el valor dentro de ese registro; **escribir** el registro de vuelta en memoria. Mientras un solo thread ejecute esta secuencia a la vez, no hay problema. Pero si dos threads ejecutan estos tres pasos de forma entrelazada, puede pasar esto:

![Race condition: a lost update](modulo-00/04-race-condition-lost-update.png)

Mira con atención la secuencia: ambos threads leen el mismo valor inicial (10) antes de que ninguno de los dos haya tenido oportunidad de escribir su resultado. Cada uno calcula correctamente "el valor viejo más uno" en su propio registro privado —los registros son privados de cada thread, así que ahí todavía no hay conflicto. El conflicto estalla en el momento de escribir: el Thread B escribe al final, y su `11` sobrescribe el `11` que había escrito poco antes el Thread A, que en cambio debería haber producido un `12` final (dos incrementos partiendo de 10). Un incremento entero desapareció en la nada, sin errores, sin excepciones, sin un solo mensaje de log que te avise: el programa simplemente calculó un número equivocado. Este fenómeno tiene un nombre preciso, **lost update** (actualización perdida), y probablemente es el bug de concurrencia más común de todos.

## Data race: qué dice realmente el estándar de C++

Vale la pena hacer una distinción técnica precisa. Una **race condition** es el fenómeno general que acabamos de describir: el resultado depende del orden de entrelazado no controlado. Una **data race** es la definición formal y más estricta que el estándar de C++ le da a un caso específico de race condition: dos o más threads acceden a la misma ubicación de memoria, al menos uno de esos accesos es una escritura, y ninguno de los dos accesos está sincronizado respecto al otro.

Aquí está el punto que sorprende a casi todos la primera vez: el estándar de C++ dice explícitamente que **una data race es undefined behavior**. No "un bug", no "un comportamiento erróneo pero predecible": *undefined behavior*, la misma categoría de gravedad que un acceso fuera de los límites de un arreglo. La consecuencia práctica es que el compilador está legalmente autorizado a asumir que en tu programa nunca ocurre una data race, y a optimizar en consecuencia. Con las optimizaciones activas, el compilador puede decidir mantener un contador en un registro de la CPU durante toda la duración de un ciclo, escribiéndolo en memoria una sola vez al final, algo perfectamente legítimo *si* ningún otro thread estuviera leyendo o escribiendo esa variable mientras tanto, suposición que el compilador tiene derecho a dar por sentada precisamente porque el código, al violar la sincronización requerida, ya rompió el contrato con el estándar.

El resultado práctico es que el mismo código exacto "con bugs" puede parecer funcionar perfectamente en una build optimizada, y mostrar su verdadero comportamiento solo en una build de debug, lo cual es motivo de mayor preocupación, no menor: un bug que "parece desaparecer" con las optimizaciones no desapareció en absoluto, solo se volvió invisible precisamente en las condiciones en las que más probablemente lo habrías probado.

## Sección crítica y exclusión mutua

El remedio conceptual se llama **sección crítica**: un tramo de código que accede a datos compartidos y que debe ser ejecutado por un solo thread a la vez, no porque el código sea lento o peligroso, sino porque el acceso a los datos que toca tiene que seguir siendo **atómico**, en el sentido estricto del término (del griego "que no se puede cortar"): o ya ocurrió por completo, o todavía no empezó, nunca visto a medias. Garantizar que todos los threads respeten una sección crítica se llama imponer la **exclusión mutua**, y es exactamente el papel de un **mutex** (contracción de *mutual exclusion*): la herramienta más elemental —y la que usarás primero en el proyecto práctico de este módulo— para transformar una secuencia de operaciones peligrosamente separable en un bloque indivisible a los ojos de los demás threads.

## Por qué Qt impone un hilo único para la GUI

Aquí hay una restricción que, vista sin contexto, parece un capricho de la biblioteca: Qt impone que **todos los widgets de tu interfaz gráfica sean creados y manipulados exclusivamente por el thread principal del programa**, muchas veces llamado "GUI thread". No es una invención arbitraria: hereda una restricción que viene de mucho más abajo en la pila de software, de los toolkits gráficos nativos del sistema operativo: en Windows el subsistema Win32/GDI, en Linux X11 o Wayland, en macOS Cocoa. Estos toolkits fueron diseñados bajo la suposición de que existe un único "message loop" que recibe los eventos del sistema operativo (un click, la pulsación de una tecla, una solicitud de redibujado) y los distribuye uno a la vez, en secuencia, a los widgets involucrados. Permitir que threads distintos manipularan simultáneamente las mismas estructuras gráficas nativas habría requerido sincronización pesada en cada nivel del toolkit, con un costo enorme para una interfaz que, en el fondo, solo tiene que reaccionar a eventos humanos, lentos comparados con los tiempos de la CPU. La decisión histórica, casi universal en todos los toolkits gráficos de escritorio, fue: un solo thread puede tocar la GUI, punto, y a cambio ese thread puede mantenerse simple y eficiente porque nunca tiene que preocuparse por ser interrumpido a mitad de una operación por otro thread que toca la misma ventana.

Qt formaliza explícitamente esta restricción con el concepto de **event loop**: el thread principal, después de crear las ventanas, entra en un ciclo (`app.exec()`) que hace exactamente una cosa, sin parar, hasta que la aplicación se cierra: espera el próximo evento, lo procesa **hasta el final**, y luego vuelve a esperar el siguiente. La palabra clave es "hasta el final": si el código que procesa un evento decide ejecutar un cálculo que dura cuatro segundos en lugar de cuatro milisegundos, el event loop se queda bloqueado dentro de ese único evento durante cuatro segundos enteros, y durante ese tiempo no puede procesar **ningún otro evento**: ni un click, ni un timer, ni siquiera el evento que el sistema operativo manda periódicamente para verificar que la aplicación siga "viva".

![The window freezes: the GUI thread is busy](modulo-00/06-gui-thread-blocked.png)

Este es exactamente el fenómeno que veremos en vivo dentro de poco, y es precisamente el problema que en el próximo módulo resolveremos introduciendo `QThread` y el patrón del worker object: sacar el cálculo largo *fuera* del thread que posee el event loop de la GUI, de modo que este último quede siempre libre para responder en pocos milisegundos. No es un detalle de implementación de Qt: es una consecuencia directa e inevitable de todo lo que acabas de leer, aplicada al caso específico de una interfaz de usuario.

## Cuándo conviene usar un thread (y cuándo no)

Antes de escribir código, vale la pena poner por escrito una brújula que será útil para el resto del recorrido, porque "un thread más" nunca es gratis y nunca es automáticamente la decisión correcta.

La primera distinción que hay que hacer es si el trabajo que quieres encargarle a un thread es **CPU-bound** o **I/O-bound**. Un trabajo es CPU-bound cuando el cuello de botella es puramente de cálculo —la CPU está siempre ocupada, sin pausas, como el conteo de números primos o un filtro de procesamiento de imágenes aplicado píxel por píxel. Un trabajo es I/O-bound cuando, en cambio, el thread, la mayor parte del tiempo, no calcula nada: está *esperando*: una respuesta de red, una lectura de disco, la captura de un frame de una cámara con su tiempo físico de exposición. Para el trabajo CPU-bound, el beneficio del multithreading depende estrictamente de cuántos núcleos físicos tienes realmente disponibles (aquí vuelve la ley de Amdahl del artículo anterior: más threads que núcleos físicos libres no da más velocidad, solo da más context switch). Para el trabajo I/O-bound, en cambio, incluso en un solo núcleo el multithreading tiene sentido, porque el thread que espera no está "desperdiciando" un núcleo: simplemente está dejando que el scheduler le dé ese tiempo a alguien más, típicamente al thread de la GUI, que mientras tanto sigue siendo reactivo.

La segunda brújula es la **granularidad**, que ya encontramos al hablar de context switch: un thread que vive menos tiempo del que hace falta para crearlo, arrancarlo, hacerlo competir por CPU con los demás y luego destruirlo, es un mal negocio. Por eso, más adelante en el recorrido, preferiremos un **thread pool** —donde los threads se crean una sola vez y se reutilizan para muchas tareas— antes que crear un thread nuevo para cada pedacito de trabajo.

Y por último, la pregunta más simple y más frecuentemente saltada: **¿tu programa realmente necesita ser más rápido, o solo necesita seguir siendo reactivo?** Son dos problemas distintos, con soluciones distintas. Si el problema es la capacidad de respuesta de la UI durante una operación larga pero aislada, basta con *un* worker thread; no hace falta un thread pool ni preocuparse por aprovechar todos los núcleos de la máquina. Si en cambio el problema es "este cálculo tarda demasiado y quiero dividirlo para terminar antes", entonces estás en el territorio del paralelismo real, con todo lo que la ley de Amdahl ya dijo sobre sus límites. Confundir estos dos objetivos es, en la práctica, la causa más común de arquitecturas de concurrencia innecesariamente complicadas para problemas que habrían necesitado una solución mucho más simple.

## De la teoría a las manos en el teclado

Ahora tienes un vocabulario preciso —race condition, data race, sección crítica, exclusión mutua, event loop— y sabes por qué Qt tomó la decisión que tomó para su GUI. Solo falta una cosa: verlo suceder de verdad, con tus propias manos en el teclado. Eso es exactamente lo que hacemos en el próximo artículo, con dos pequeños proyectos guiados: uno en C++ puro, sin Qt, y otro que recrea en vivo el freeze de la ventana del que acabamos de hablar.
