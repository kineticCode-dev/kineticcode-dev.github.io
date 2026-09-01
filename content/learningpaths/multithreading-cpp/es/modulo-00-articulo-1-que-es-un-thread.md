---
title: "Qué es realmente un thread (y por qué de repente necesitas saberlo)"
description: "Multithreading en C++ con Qt — Módulo 0"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Qué es realmente un thread (y por qué de repente necesitas saberlo)

Hay un momento, en la vida de quien programa, en que `QtConcurrent::run` deja de parecer magia. Antes de ese momento simplemente funciona: pasas una función, esa función se ejecuta "en algún lado", el resultado llega, todos contentos. El problema es que "funcionó" y "entendí por qué funcionó" son dos frases muy distintas, y esa diferencia casi siempre se paga en el peor momento posible: un viernes por la noche, en producción, con un crash que no puedes reproducir a voluntad porque depende de cómo el scheduler del sistema operativo decidió, en ese instante exacto, entrelazar tus threads. No hay forma de evitar este problema con más experiencia en otras áreas de la programación: un bug de lógica secuencial es determinista, siempre lo ves igual; un bug de concurrencia es, por naturaleza, caprichoso.

Este artículo todavía no toca ni una línea de código Qt. Es a propósito: antes de ver cómo Qt resuelve los problemas de la concurrencia, vale la pena entender qué son realmente esos problemas, al desnudo, sin ningún framework encima que esconda los mecanismos. Si primero entiendes la restricción física, cada decisión de diseño que encontrarás más adelante en el recorrido deja de parecerte arbitraria.

## Un proceso no hace nada por sí solo

Cuando lanzas un programa, el sistema operativo crea un **proceso**: un espacio de direcciones, un bloque de memoria virtual que el programa cree que es todo suyo, aislado de cualquier otro proceso que se esté ejecutando en la misma máquina. Si tu programa escribe en la dirección `0x1000` y otro proceso también escribe en `0x1000`, no hay ningún conflicto: son dos direcciones *virtuales*, traducidas por la MMU de la CPU hacia dos páginas de memoria física completamente distintas. Ese aislamiento es uno de los regalos más importantes que te da un sistema operativo moderno: un proceso que se cae, en condiciones normales, no arrastra consigo a los demás.

Pero dentro de ese espacio aislado, el proceso por sí solo no ejecuta nada. Hace falta algo que realmente haga avanzar las instrucciones, una por una. Ese algo es el **thread**. Durante décadas un proceso tenía exactamente un thread, y el concepto de "thread" separado del proceso ni siquiera existía, porque no hacía falta. Nació cuando se identificó un problema muy práctico: crear un proceso entero —nuevo espacio de direcciones, nuevas tablas de páginas, nuevos handles de archivo— es una operación costosa, y si todo lo que quieres es "ejecutar varias cosas a la vez, compartiendo los mismos datos", duplicar el proceso completo es un desperdicio enorme. Hacía falta una unidad de ejecución más liviana, capaz de compartir el espacio de direcciones en lugar de duplicarlo. No por casualidad, en la literatura más antigua, al thread se le llama literalmente "lightweight process".

![Process and thread: what is private and what is shared](modulo-00/01-process-vs-thread.png)

Cada thread dentro del mismo proceso comparte con todos los demás threads el **heap** (la memoria que asignas dinámicamente), las **variables globales y estáticas**, los **archivos abiertos** y el **segmento de código**. Esta es la parte cómoda: dos threads intercambian datos simplemente leyendo y escribiendo la misma variable, sin necesitar los mecanismos pesados que harían falta entre dos procesos separados para comunicarse.

Pero cada thread también tiene una porción de estado **privada**, que ningún otro thread toca jamás directamente: el **stack**, donde viven las variables locales y las direcciones de retorno; los **registros de la CPU**, con los valores sobre los que el thread está calculando en ese instante preciso; el **program counter**, que indica la próxima instrucción a ejecutar. Si dos threads ejecutan la misma función al mismo tiempo, cada uno tiene su propio stack con sus propias variables locales, ahí no hay interferencia. Por eso una función que no toca estado compartido es automáticamente segura de llamar desde varios threads a la vez: se dice que es **thread-safe por construcción**, o **reentrante**.

Fija bien este punto, porque es la raíz de todo lo que sigue en este recorrido: **compartir el heap y las variables globales no es un detalle de implementación, es la razón de ser del thread**. Y es, exactamente, la fuente de todos los bugs de concurrencia que vas a encontrar. Un thread es útil porque comparte memoria sin fricción; un thread es peligroso por el mismo motivo exacto. Cada técnica que verás más adelante —mutex, wait condition, atomics, las conexiones queued de Qt— es una forma de disciplinar esa compartición, no de eliminarla (eliminarla significaría volver a procesos separados, perdiendo la ventaja que nos hizo elegir threads en primer lugar).

Una última cosa antes de seguir: quien realmente crea el thread no eres tú, es el sistema operativo. Cuando escribes `std::thread t(function);`, por debajo se dispara una llamada de sistema real —`clone()` en Linux, `CreateThread()` en Windows— y lo que obtienes es un **thread del sistema operativo** (kernel thread). Es el scheduler del kernel quien decide cuándo ese thread corre de verdad en la CPU. La biblioteca estándar de C++ no reinventa su propio scheduler: se apoya directamente en el del sistema operativo, y lo mismo hará `QThread`, que veremos en el próximo artículo.

## El fin de la carrera por la frecuencia, y por qué hoy los núcleos se multiplican

Para entender por qué hoy necesitas saber escribir código multithread si quieres aprovechar de verdad el hardware, hay que remontarse hasta 2004-2005, cuando cambió una regla que se daba por sentada desde hacía treinta años: cada nueva generación de procesadores era simplemente más rápida en frecuencia, y tu programa, sin cambiar una línea, corría más rápido. Después esa carrera se detuvo, por un motivo puramente físico. La potencia dinámica disipada por un circuito sigue, en primera aproximación, esta relación:

$$P \;\propto\; C \cdot V^2 \cdot f$$

donde $C$ es la capacidad eléctrica del circuito, $V$ la tensión de alimentación y $f$ la frecuencia de reloj. El problema es que, para hacer correr los transistores más rápido (más $f$), también hace falta más tensión $V$ para que las señales se estabilicen a tiempo, y como $V$ aparece al cuadrado, la potencia disipada (que se convierte casi toda en calor) crece mucho más que linealmente con la frecuencia. Hacia 2005 los fabricantes chocaron contra un muro térmico real: seguir subiendo la frecuencia habría significado disipar más calor del que un disipador razonable podía evacuar. Este fenómeno pasó a la historia como **power wall**.

La respuesta de la industria fue cambiar de estrategia: en lugar de un solo núcleo cada vez más rápido, muchos núcleos, cada uno a frecuencia moderada. Por eso hoy cualquier CPU —desde el teléfono hasta el servidor— tiene 4, 8, 16 o más núcleos físicos. Y este cambio tiene una consecuencia incómoda para quien escribe software: **un programa de un solo thread no obtiene ningún beneficio de los demás núcleos**. Corre en uno solo, exactamente como hace veinte años, mientras los demás quedan sin usar para ese programa. Si quieres aprovechar de verdad el hardware multicore que compraste, tienes que escribir software capaz de dividir su propio trabajo entre varios threads que se ejecuten en paralelo.

## Concurrencia y paralelismo no son sinónimos

Y aquí viene una distinción que en el lenguaje cotidiano se aplana, pero que en la práctica tiene consecuencias muy concretas. **Concurrencia** significa que varios flujos de ejecución avanzan en el mismo intervalo de tiempo, pero no necesariamente en el mismo instante físico: en un solo núcleo, dos threads pueden ser concurrentes alternándose rapidísimo —un poco de A, luego un poco de B, luego otra vez A— dando la ilusión de simultaneidad, pero en cada instante concreto hay **una sola** instrucción ejecutándose en ese núcleo. **Paralelismo**, en cambio, significa que varios flujos corren físicamente en el mismo instante, en núcleos distintos: requiere hardware con varias unidades de cálculo reales, no se consigue por arte de magia de software en un solo núcleo.

![Concurrency versus parallelism](modulo-00/02-concurrency-vs-parallelism.png)

En la mitad superior del esquema, un solo núcleo ejecuta el Thread A y el Thread B en fracciones alternadas: concurrencia pura, sin superposición temporal real. En la mitad inferior, dos núcleos distintos ejecutan A y B durante toda la duración, realmente juntos: paralelismo.

¿Por qué importa de verdad esta distinción? Porque **puedes escribir código concurrente incluso en una máquina con un solo núcleo**, y tiene sentido hacerlo, por un motivo que no tiene nada que ver con la velocidad de cálculo pura: la **capacidad de respuesta**. Si tu programa tiene que responder a un click mientras espera una respuesta de red que tarda dos segundos, no necesitas más potencia de cálculo: necesitas que el thread que gestiona el click no se quede bloqueado esperando esa respuesta. Es exactamente el caso de uso más común por el que, en el próximo artículo, introduciremos `QThread`: no (solo) ir más rápido, sino seguir siendo reactivo. El paralelismo real —el que termina un cálculo pesado en una cuarta parte del tiempo usando cuatro núcleos— es un objetivo distinto, ligado a `QtConcurrent` y a los thread pools, y necesita hardware multicore real para manifestarse.

## El scheduler, el time slicing, y el precio oculto del context switch

¿Cómo hace el scheduler del sistema operativo para dar la ilusión de que decenas de threads corren "al mismo tiempo" en un puñado de núcleos físicos? Con el **time slicing**: le asigna a cada thread listo una pequeña fracción de tiempo de CPU —unos pocos milisegundos, el orden de magnitud exacto depende del scheduler— y cuando esa fracción se agota, lo interrumpe a la fuerza y pone a ejecutar a otro thread en cola. Esa interrupción forzada se llama **context switch**, y no es nada gratis.

![The cost of a context switch](modulo-00/03-context-switch-cost.png)

Cuando el scheduler pasa del Thread A al Thread B, primero tiene que **guardar** el estado completo de A —registros, program counter— en algún lugar de la memoria, luego **cargar** el estado guardado anteriormente de B en esos mismos registros físicos, y solo entonces la CPU puede retomar la ejecución de instrucciones de B desde donde las había dejado.

Hay un costo adicional, a menudo más insidioso: la **caché de la CPU**. Mientras A corría, la caché se había llenado con sus datos y sus instrucciones "calientes". Cuando entra B, que trabaja con datos distintos, esas líneas de caché van siendo reemplazadas poco a poco: cuando A retome, dentro de algunas fracciones de tiempo, encontrará la caché "fría" para sus datos y tendrá que releerlos desde la RAM, mucho más lenta. Este fenómeno se llama **cache pollution** por context switch, y a menudo es el verdadero motivo por el que "demasiados threads" empeoran el rendimiento en lugar de mejorarlo: no es el costo de guardar unos cuantos registros, es la caché vaciándose y llenándose de nuevo continuamente.

La consecuencia práctica es que **crear un thread para cada pedacito minúsculo de trabajo es casi siempre una mala idea**. Si el trabajo útil que un thread tiene que hacer dura menos que el tiempo que hace falta para crearlo, arrancarlo y hacer que compita por CPU con context switches continuos, gastaste más energía en administración que en cálculo real. Este principio —la granularidad de la tarea debe compensar el overhead de gestionarla en un thread separado— lo volverás a encontrar cuando hablemos de thread pools más adelante en el recorrido.

## La ley de Amdahl: el límite que ningún núcleo puede superar

Queda una pregunta práctica obvia: si paralelizo bien un programa, ¿cuánto acelero agregando núcleos? La respuesta rigurosa es la **ley de Amdahl**, formulada en 1967, y probablemente es la fórmula más importante de toda la programación concurrente porque dice algo que a primera vista parece contraintuitivo: hay un límite infranqueable al speedup que se puede obtener, sin importar cuántos núcleos agregues, y ese límite depende de una sola característica de tu programa.

$$S(N) = \dfrac{1}{(1-P) + \dfrac{P}{N}}$$

Detente un momento en lo que representa físicamente cada símbolo. $S(N)$ es el **speedup**: cuántas veces más rápido corre el programa usando $N$ núcleos comparado con uno solo; si $S(N) = 3$, el programa tarda un tercio del tiempo original. $N$ es el número de núcleos paralelos usados. $P$ es la fracción del tiempo total de ejecución que es efectivamente **paralelizable**, un número entre 0 y 1. Y $(1-P)$, la parte que en el denominador no se divide entre $N$, es la parte **serial**: trabajo que, por su naturaleza lógica, tiene que ejecutarse en un solo thread a la vez —la inicialización, la lectura secuencial de un archivo, un paso final que tiene que combinar los resultados parciales de todos los demás threads.

El punto conceptual es qué pasa cuando $N$ tiende a infinito: el término $P/N$ tiende a cero, y queda

$$S(\infty) = \dfrac{1}{1-P}$$

El speedup máximo teórico, con infinitos núcleos disponibles, está limitado exclusivamente por la fracción serial del programa. Si solo el 90% es paralelizable ($P = 0{,}9$, que ya suena altísimo), el speedup máximo que podrás obtener *alguna vez* es $1 / (1 - 0{,}9) = 10\times$: no un millón de veces más rápido solo porque tienes un millón de núcleos, sino diez veces, y punto. Si solo el 50% es paralelizable, el techo es apenas $2\times$.

![Amdahl's law](modulo-00/05-amdahls-law.png)

Un ejemplo concreto, ligado al mundo de la visión artificial: imagina una pipeline que captura un frame, aplica un filtro de preprocesamiento paralelizable en distintos bloques de la imagen, y por último ejecuta un paso de postprocesamiento secuencial que necesita ver la imagen entera ya recompuesta antes de decidir si la pieza inspeccionada cumple con lo esperado. Si ese paso final ocupa el 20% del tiempo total ($P = 0{,}8$ paralelizable), el límite teórico de speedup es $1/0{,}2 = 5\times$, sin importar cuántos núcleos le pongas debajo. Saber esto *antes* de comprar hardware más potente, o de inventar arquitecturas cada vez más complejas para paralelizar el último 5% del programa, ahorra meses de trabajo persiguiendo una ganancia que la matemática ya dice que está casi agotada. Por eso, en el mundo real, el primer paso antes de paralelizar cualquier cosa es siempre **medir dónde se va realmente el tiempo**, no intuirlo: es la fracción serial oculta, muchas veces en un lugar inesperado, la que decide cuánto esfuerzo de paralelización valdrá realmente la pena.

## Qué queda por entender

Llegados aquí ya sabes qué es un thread, por qué existe, por qué importa hoy más que nunca, y cuánto puedes esperar razonablemente ganar al paralelizar. Todavía falta la pieza más peligrosa: qué pasa cuando dos threads tocan la misma variable sin disciplina, y por qué Qt, para su interfaz gráfica, decidió prohibir por completo ese problema imponiendo un thread único. Ese es el tema del próximo artículo, y desde ahí vamos directo a los dos proyectos prácticos de este módulo, donde el freeze de una ventana Qt deja de ser una frase y se convierte en algo que ves suceder ante tus propios ojos.
