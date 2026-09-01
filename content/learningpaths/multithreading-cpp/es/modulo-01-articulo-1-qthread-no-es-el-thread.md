---
title: "QThread no es el thread: es un mando a distancia (y por qué subclasificarlo engaña)"
description: "Multithreading en C++ con Qt — Módulo 1"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QThread no es el thread: es un mando a distancia (y por qué subclasificarlo engaña)

En el artículo anterior viste el problema con tus propios ojos: un botón que, al hacer clic, detiene el latido de la ventana durante varios segundos, porque el slot que reacciona al clic ejecuta un cálculo pesado directamente en el thread que posee el event loop de la GUI. Este artículo empieza la cura, y vale la pena ser honestos sobre algo desde el principio: `QThread` es probablemente la clase de toda la librería Qt más malinterpretada de su historia, y no por culpa de quien la usa, sino por un incidente histórico muy concreto. Durante años, la propia documentación oficial de Qt y sus ejemplos enseñaron una forma de usarla que, en un artículo de 2010 que se volvió legendario en la comunidad Qt, un ingeniero del propio equipo de Qt tituló públicamente *"You're doing it wrong"* — "lo estás haciendo mal" — refiriéndose a cómo incluso los ejemplos oficiales del framework la presentaban hasta ese momento. Si ya has leído por ahí, o recuerdas de algún tutorial visto hace años, que "para usar QThread hay que crear una subclase y sobrescribir `run()`", no es culpa tuya que pareciera el camino natural: era, literalmente, lo que el propio Qt enseñaba.

## QThread no es "el thread": es un mando a distancia

Parte de un error de intuición tan común que vale la pena desmontarlo de inmediato, antes de escribir una sola línea de código: cuando creas un objeto `QThread`, ese objeto **no es** el thread del sistema operativo. Es un `QObject` —una clase C++ como cualquier otra, con su constructor, sus métodos, su posición en el árbol de parentesco de Qt— que **representa y controla** un thread del sistema operativo, un poco como el mando a distancia de un televisor no es el televisor: lo enciendes, lo apagas, le cambias de canal, pero el mando en sí se queda tranquilamente en tu sofá, no dentro del aparato.

Cuando escribes `QThread *thread = new QThread(this);` dentro, digamos, del constructor de tu `MainWindow`, esa instancia de `QThread` **nace y vive en el thread en el que la creaste** —casi siempre el thread principal de la GUI, exactamente igual que cualquier otro `QObject` que construyas ahí. Tiene un puñado de métodos que forman su "panel de control": `start()` para arrancar el thread del sistema operativo que gestiona, `quit()` para pedirle que detenga amablemente su propio event loop, `wait()` para bloquearse hasta que ese thread haya terminado de verdad, `isRunning()` para consultar su estado. Llamar a estos métodos es seguro desde el thread principal precisamente porque el propio objeto `QThread` vive ahí.

![QThread is not the thread: it's a remote control](modulo-01/05-qthread-is-a-remote-control.png)

Cuando llamas a `thread->start()`, ocurre algo distinto y separado: Qt realiza la llamada al sistema que crea de verdad un nuevo thread del sistema operativo (el mismo mecanismo de fondo que `std::thread`, que ya conociste antes), y en ese nuevo thread arranca la ejecución del método virtual `QThread::run()`. Si no lo has sobrescrito —y en el patrón que adoptaremos en este artículo nunca lo sobrescribiremos— la implementación por defecto de `run()` hace simplemente una cosa: llama a `exec()`, es decir, arranca un **event loop** en ese nuevo thread, conceptualmente idéntico al que el thread principal arranca con `QApplication::exec()` cuando la aplicación se inicia. A partir de este momento, ese thread del sistema operativo existe con un propósito preciso: esperar eventos (en este caso, casi siempre señales que llegan de otros threads) y procesarlos uno a uno, en orden —exactamente como el thread de la GUI, solo que ahora este segundo event loop corre en un thread completamente separado.

## El patrón antiguo: subclasificar QThread (y por qué engaña)

El instinto natural, cuando quieres hacer correr código en un thread separado usando una clase orientada a objetos como `QThread`, es este: creo mi propia clase que hereda de `QThread`, meto dentro la lógica que debe correr en el thread separado, quizá también algún slot para recibir órdenes. En código:

```cpp
class MyThread : public QThread {
    Q_OBJECT
public:
    void run() override {
        // heavy work here
    }

public slots:
    void otherMethod() {
        // ... here comes the surprise
    }
};
```

Este código compila, y la parte dentro de `run()` se ejecuta exactamente donde esperas: en el thread del sistema operativo gestionado por esta instancia, porque `run()` es precisamente el método que Qt invoca en ese thread nada más arrancar. Hasta aquí, todo según la intuición. El problema, el que dio origen al artículo "You're doing it wrong" y a años de informes de bugs confusos en los foros de Qt, tiene que ver con `otherMethod()`: es un slot declarado en la misma clase, pero **no se ejecuta en absoluto en el thread gestionado por esta instancia**. Se ejecuta en el thread que **posee** al propio objeto `MyThread` —es decir, casi siempre, el thread principal que lo creó con `new MyThread()`. La razón es la misma de antes: un `QObject` (y `QThread` sigue siendo un `QObject`, con toda la infraestructura de señales y slots que eso implica) ejecuta sus propios slots en el thread al que **pertenece** —su afinidad de thread— y no en el thread que eventualmente gestiona como "contenido" de `run()`. `run()` es un caso especial, el único método que Qt garantiza que se ejecuta de verdad en el thread gestionado; cualquier otro slot de la misma clase sigue la regla general, no esa excepción.

Históricamente, esto ha llevado a desarrolladores a escribir código que parecía funcionar en los casos simples —cuando lo único que se necesita es hacer correr un bloque de cálculo aislado, sin necesidad de recibir órdenes posteriores vía señales— y a romperse en silencio en el momento en que ese thread también tenía que reaccionar a eventos externos durante la ejecución, con race conditions o comportamientos inexplicables que nadie sabía diagnosticar sin haber leído, precisamente, aquel artículo de 2010.

## El patrón recomendado: worker object y moveToThread()

La solución que la comunidad Qt (y hoy la propia documentación oficial) recomienda le da la vuelta al enfoque: **nunca subclasificar `QThread`**. Úsala siempre tal cual, idéntica en cada proyecto —el mando a distancia de antes, sin modificaciones. La lógica de negocio, en cambio, va en una clase separada que hereda únicamente de `QObject` —la llamamos por convención el **worker**— y que no sabe nada, ni le importa nada, de threads ni de `QThread`. Es una pieza de lógica pura. Después, un único método hace toda la magia:

```cpp
worker->moveToThread(thread);
```

`moveToThread()` cambia la **afinidad de thread** del objeto `worker`: a partir de este momento, ese objeto "pertenece" a `thread` en lugar de al thread que lo había creado, y —esta es la parte que importa— **cada uno de sus slots, invocado a través de una conexión queued, se ejecutará en el thread gestionado por `thread`**, sin excepciones, sin casos particulares que memorizar.

![Thread affinity before and after moveToThread](modulo-01/08-thread-affinity-before-after.png)

Hay una restricción técnica que conviene conocer, porque la encontrarás en el proyecto práctico dentro de poco: un `QObject` **con un padre** (en el sentido del árbol de parentesco de Qt, `new Worker(this)`) **no puede moverse** con `moveToThread()` —la llamada falla silenciosamente con un aviso en tiempo de ejecución, no un error de compilación, lo que la convierte en una trampa fácil de pasar por alto. La razón es lógica en cuanto lo piensas: el árbol de parentesco de Qt asume que un padre y sus hijos viven en el mismo thread (así es, por ejemplo, como funciona la destrucción en cascada); mover un hijo a un thread distinto del de su padre rompería esta garantía. La consecuencia práctica es que tu worker debe construirse **sin padre** —`new PrimeCalculator()`, no `new PrimeCalculator(this)`— y su vida gestionada explícitamente por ti, como veremos en el próximo artículo a propósito del ciclo de vida.

![Comparing the two patterns: subclassing QThread versus worker plus moveToThread](modulo-01/07-subclass-vs-movetothread-comparison.png)

Con este patrón, `QThread` se queda como un objeto anónimo y nunca personalizado, reutilizable idéntico en cada proyecto Qt que escribas de aquí en adelante; es el worker, una clase `QObject` completamente normal con sus slots y señales, quien lleva toda la lógica —y **cada** uno de sus slots, sin excepciones que recordar, se ejecuta correctamente en el thread gestionado. Es precisamente el patrón que construimos juntos en el proyecto práctico de este módulo.

## Qué queda por entender

Ya sabes la diferencia entre el objeto `QThread` y el thread que gestiona, y por qué subclasificar `QThread` es casi siempre la elección equivocada frente al patrón worker + `moveToThread()`. Queda una pregunta práctica obvia: si el worker ahora vive en un thread distinto, ¿cómo le digo "empieza el cálculo" desde el thread de la GUI, y cómo hago que me diga "he terminado" volviendo a la GUI, sin reintroducir las race conditions que hemos estudiado? Es el tema del próximo artículo, junto con el ciclo de vida completo de un worker thread —y luego, por fin, manos al teclado para curar de verdad el freeze del módulo anterior.
