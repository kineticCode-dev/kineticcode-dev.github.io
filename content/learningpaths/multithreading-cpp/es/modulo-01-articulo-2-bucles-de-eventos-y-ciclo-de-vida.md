---
title: "Dos event loops que se hablan con seguridad: conexiones queued y el ciclo de vida de un worker thread"
description: "Multithreading en C++ con Qt — Módulo 1"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Dos event loops que se hablan con seguridad: conexiones queued y el ciclo de vida de un worker thread

En el artículo anterior le dimos la vuelta al enfoque de `QThread`: no se subclasifica, se usa tal cual, y la lógica va en un worker separado movido con `moveToThread()`. Queda una pregunta práctica obvia: si el worker ahora vive en un thread distinto del de la GUI, ¿cómo se comunica en ambas direcciones sin reintroducir las race conditions que ya hemos aprendido a temer?

## Dos event loops, y cómo se hablan entre sí sin correr riesgos

La respuesta es que no lo haces tú manualmente: lo hace Qt, automáticamente, a través del mismo mecanismo de señales y slots que ya conoces, con un comportamiento adicional que se activa en silencio cuando emisor y destinatario viven en threads distintos. Cada thread que ejecuta un event loop —tanto el thread de la GUI como un thread gestionado por un `QThread` que no ha sobrescrito `run()`— tiene su propia **cola de eventos**, independiente de la de cualquier otro thread. Cuando llamas a `connect()` entre un objeto que vive en el thread A y otro que vive en el thread B, Qt compara las dos afinidades de thread en el momento de emitir la señal y, si son distintas, **no llama al slot directamente**: empaqueta la llamada (el nombre del método, los argumentos, todo) en un evento y lo deposita en la cola del thread que posee al destinatario. Ese thread, cuando le llega su turno en el ciclo de su event loop, extrae el evento de la cola y **solo entonces** ejecuta de verdad el slot —en su propio thread, con sus propios datos, sin que ningún otro thread esté tocando esa memoria en el mismo instante.

![Two event loops connected by a queued connection](modulo-01/06-two-event-loops-queued-connection.png)

Este tipo de conexión tiene un nombre preciso, que repasaremos con todos los detalles técnicos más adelante en el recorrido: se llama **QueuedConnection**, y es uno de los cuatro modos de conexión que ofrece Qt (los otros son `DirectConnection`, `BlockingQueuedConnection`, y `AutoConnection` —este último es el comportamiento por defecto, que elige automáticamente Direct si emisor y destinatario comparten el mismo thread, y Queued en caso contrario, exactamente el comportamiento que estamos aprovechando hoy sin tener que especificarlo nunca de forma explícita). El punto conceptual que hay que llevarse hoy es este: **una conexión normal señal-slot entre objetos en threads distintos ya es, de por sí, thread-safe**, porque la señal nunca ejecuta código del destinatario "en el sitio" —se limita a dejar un mensaje en su buzón, y es el propio destinatario, cuando le toca, quien lo lee y lo ejecuta. No necesitas un `QMutex` para proteger este intercambio: Qt ya lo ha hecho seguro por ti, siempre que comuniques siempre a través de señales y slots y no, por ejemplo, llamando directamente a un método público del worker desde fuera o tocando sus variables miembro desde otro thread —eso volvería a ser, sin más, una data race.

## El ciclo de vida de un worker thread, y la trampa de deleteLater()

Montar un worker thread es solo la mitad del trabajo: la otra mitad, la que separa el código robusto del que pierde memoria o falla al cerrar la aplicación, es gestionar correctamente su nacimiento y, sobre todo, su final.

Un patrón muy común, y es el que usaremos en el proyecto práctico, es conectar la señal `QThread::started` —emitida automáticamente en cuanto el thread gestionado ha arrancado de verdad su propio event loop— al slot del worker que da inicio al trabajo:

```cpp
connect(thread, &QThread::started, worker, &Worker::start);
```

Nota que esta conexión es, una vez más, entre objetos en threads distintos (la señal se emite *desde* el thread gestionado nada más arrancar, pero la propia connect la estás escribiendo desde el thread de la GUI, y en cualquier caso el worker vive en el thread gestionado) —así que automáticamente es queued, y la ejecución de `start()` ocurre de forma segura en el thread correcto.

Para detener un thread gestionado de forma limpia, el método correcto es `QThread::quit()` (un pseudo-sinónimo de `exit(0)`): publica una solicitud de salida en la cola de eventos de ese thread, que el event loop procesa en cuanto le llega su turno, saliendo de `exec()` —en ese momento `run()` retorna, y el thread del sistema operativo termina de forma natural. Esto es fundamentalmente distinto de `QThread::terminate()`, un método que existe pero que casi siempre hay que evitar: fuerza la detención inmediata del thread en el punto exacto en que se encuentra, sin darle la posibilidad de liberar recursos, desbloquear mutex que pudiera estar reteniendo, o completar una escritura a medias en un archivo —es el equivalente, en el ámbito de los threads, a desenchufar un ordenador en lugar de apagarlo desde el sistema operativo, y los daños colaterales posibles son de la misma naturaleza.

Después de `quit()`, si quieres estar seguro de que el thread ha terminado **de verdad** antes de seguir adelante (por ejemplo, antes de destruir el worker), llamas a `wait()`, que bloquea al thread llamante hasta que el gestionado haya terminado de verdad. Es exactamente la secuencia que usaremos dentro de poco en el destructor de nuestra ventana: `thread->quit(); thread->wait();` —primero pido amablemente que salga, luego espero a que haya ocurrido de verdad, y solo entonces es seguro volver a tocar el estado del worker desde el thread de la GUI.

Un patrón que encontrarás muchísimo en la documentación oficial y en los ejemplos de Qt, para destruir de forma segura un worker cuando su thread termina, es este:

```cpp
connect(thread, &QThread::finished, worker, &QObject::deleteLater);
```

`deleteLater()` no destruye el objeto de inmediato: publica un evento de eliminación diferida en la cola de eventos **del thread al que el objeto pertenece en ese momento** —no del thread llamante— que será procesado y ejecutado en la primera ocasión útil por ese event loop. Es un mecanismo pensado precisamente para ser seguro de llamar incluso desde otro thread, y por eso aparece tan a menudo en código concurrente de Qt.

Pero aquí se esconde una trampa concreta: **si el thread al que pertenece el objeto ya ha dejado de ejecutar su propio event loop, ese evento de eliminación nunca se procesará**, y el objeto nunca se destruirá —una fuga silenciosa, sin crash, sin aviso, solo memoria que nunca vuelve. Es una situación sorprendentemente fácil de sufrir: si por error llamas a `quit()` sobre el thread *antes* de que se haya procesado el evento de `deleteLater()`, o si estructuras el orden de tus conexiones de manera que el evento de eliminación llegue después de que el thread ya haya empezado a detenerse, te encuentras con un objeto fantasma que nadie destruirá jamás.

En el proyecto práctico de hoy **evitamos deliberadamente esta complicación**: nuestro worker thread permanece vivo durante toda la duración de la aplicación (es un worker "persistente", no "de usar y tirar" —hablamos de esto en un momento), y cuando la ventana se cierra detenemos el thread con `quit()` + `wait()` y destruimos el worker con un `delete` directo y ordinario, que es perfectamente seguro en ese momento preciso porque, después de que `wait()` haya retornado, tienes la certeza matemática de que ningún otro thread está ya ejecutando código que toque ese objeto. El patrón completo con `deleteLater()` para workers "de usar y tirar" —esos que nacen, hacen un trabajo, y deben eliminarse automáticamente— lo veremos con toda la atención que merece más adelante en el recorrido, cuando hablemos de cancelación cooperativa y ciclos de vida más elaborados.

## Worker persistente frente a worker de usar y tirar

Una última distinción conceptual, antes del proyecto práctico, porque volverás a encontrarla más adelante en el curso: un worker **persistente** se crea una vez, se mueve una vez a su thread con `moveToThread()`, y desde ahí recibe, a lo largo de la vida de la aplicación, tantas solicitudes de trabajo como haga falta, mediante señales repetidas —es el patrón que usaremos hoy, adecuado cuando sabes que el usuario pulsará ese botón una y otra vez en la misma sesión. Un worker **de usar y tirar**, por el contrario, nace para hacer un único trabajo, se apaga (con la secuencia `quit()` + `deleteLater()` de antes) al terminar, y si hace falta otro cálculo se crea uno nuevo desde cero. Ninguno de los dos es "el correcto" en sentido absoluto: la elección depende de cuántas veces prevés que ese trabajo deba repetirse y de cuánto cuesta, en términos de recursos, mantener un thread inactivo a la espera en lugar de recrearlo cada vez —el mismo principio de granularidad que ya encontraste antes, aplicado aquí a la escala de un thread entero en vez de a una sola instrucción.

## De la teoría a las manos en el teclado

Ya tienes todo el vocabulario para construir un worker thread robusto: la diferencia entre `QThread` y el thread gestionado, el patrón worker + `moveToThread()`, las conexiones queued que hacen que la comunicación entre threads sea automáticamente segura, y la secuencia correcta de arranque y apagado. En el próximo artículo lo juntamos todo, retomando exactamente la ventana con el freeze del módulo anterior y curándola de verdad.
