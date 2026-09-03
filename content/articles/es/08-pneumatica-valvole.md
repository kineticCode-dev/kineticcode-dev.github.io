---
title: "Neumática, segunda entrega: las electroválvulas, donde un bit del PLC se convierte en aire en movimiento"
description: "Cómo funcionan las electroválvulas neumáticas 3/2 y 5/2, la simbología ISO 1219, y cómo el PLC realmente comanda un cilindro."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Valves", "PLC", "Automation"]
---

En el artículo anterior seguimos el aire comprimido desde el compresor hasta el umbral de la máquina, limpio, seco y con la presión regulada. Ahora llegamos al componente que realmente conecta tu software con el mundo físico de la neumática: la **electroválvula** (*solenoid valve*). Es el equivalente neumático exacto del contactor que encontraste al hablar del cuadro eléctrico: una salida del PLC de baja potencia (24VDC) comanda una bobina, que a su vez actúa sobre un mecanismo capaz de gestionar un caudal de aire mucho mayor de lo que una señal eléctrica por sí sola podría manejar jamás.

## Cómo funciona por dentro: una aguja que se desplaza

Simplificando, dentro de una electroválvula hay un pequeño elemento móvil — una aguja o un pequeño pistón, llamado *corredera* o *spool* — que, desplazándose pocos milímetros dentro del cuerpo de la válvula, abre o cierra varios canales internos, conectando o desconectando las vías de aire. Cuando la bobina eléctrica se excita, genera un campo magnético que atrae un núcleo metálico conectado a la corredera, desplazándolo de la posición de reposo a la de trabajo. Cuando la bobina se desexcita, un elemento de retorno — casi siempre un muelle mecánico, o en algunos casos la propia presión del aire adecuadamente dirigida (las llamadas válvulas de mando neumático, o *pilotadas*) — devuelve la corredera a la posición de reposo.

Este comportamiento — reposo/trabajo — es exactamente lo que describe la nomenclatura estándar de las válvulas, que ahora podemos descodificar: cuando lees **"válvula 3/2"** o **"válvula 5/2"**, el primer número indica cuántas **vías** (puertos físicos de conexión: alimentación, uso, escape) tiene la válvula, el segundo número indica cuántas **posiciones** puede adoptar la corredera.

## La válvula 3/2: la elección para cilindros de simple efecto

Una **válvula 3/2** tiene tres vías — típicamente indicadas con las letras **P** (alimentación, *pressure*), **A** (uso, hacia el actuador) y **R** (escape, *release*, hacia la atmósfera) — y dos posiciones. En la posición de reposo conecta A con R (el uso está sin presión, descargado); cuando la bobina se excita, conecta P con A (el uso recibe aire a presión), cerrando al mismo tiempo R.

Esta configuración es perfecta para pilotar un **cilindro de simple efecto**: un cilindro que recibe aire comprimido solo por un lado, y vuelve a la posición de reposo mediante un muelle mecánico interno cuando se retira el aire. El PLC solo tiene que gestionar un único bit: excitar la bobina para que el cilindro avance, desexcitarla para que vuelva (por gravedad o por el muelle de retorno).

![Comparison between a 3/2-way valve for single-acting cylinders and a 5/2-way valve for double-acting cylinders, with ISO 1219 style symbols](./img/valve-symbols-3-2-5-2.svg)

## La válvula 5/2: la elección más común, para cilindros de doble efecto

Mucho más extendida en la industria es la **válvula 5/2**: cinco vías (una alimentación P, dos usos A y B, dos escapes distintos, a menudo indicados como R y S) y dos posiciones. En una posición, conecta P con A y B con el escape; en la otra posición (invertida), conecta P con B y A con el escape. El resultado práctico: siempre tienes dos líneas de trabajo, una que empuja el cilindro en un sentido y otra que lo empuja en el sentido opuesto, **ambas activamente presurizadas por turno** — nunca un empuje del muelle, siempre del aire.

Esta es la configuración típica para los **cilindros de doble efecto**, donde el aire comprimido empuja el pistón en ambas direcciones (una cámara para la extensión, otra para la retracción), sin necesidad de ningún muelle mecánico interno. La ventaja práctica es doble: la carrera de retorno está tan activamente controlada como la de ida (útil si se necesita fuerza también en el movimiento de retroceso, no solo de salida), y el cilindro puede colocarse en cualquier orientación — horizontal, vertical, boca abajo — sin depender de la gravedad o de un muelle para completar la carrera de retorno.

Desde el punto de vista del cableado hacia el PLC, una válvula 5/2 con **bobina única** (en la que un muelle mecánico devuelve la corredera a la posición de reposo cuando la bobina se desexcita) se comanda exactamente como una 3/2: un único bit de salida, un único estado "verdadero" para la extensión y "falso" para el reposo. Pero existe también una variante muy extendida, la **5/2 de doble bobina** (*biestable*): no tiene ningún muelle de retorno, y la corredera mantiene su posición incluso cuando ambas bobinas están desexcitadas — un detalle con un impacto práctico enorme, del que hablamos a continuación.

## Monoestable vs. biestable: una elección con consecuencias reales sobre la seguridad

Si una válvula es **monoestable** (con una sola bobina y retorno por muelle), tiene un estado de reposo bien definido: en cuanto se quita la tensión — incluso por una avería, una emergencia, o simplemente porque el PLC pasa a stop — la corredera vuelve siempre a la misma posición predefinida, y con ella el cilindro va a una posición conocida y predecible. Este comportamiento se aprovecha a menudo, deliberadamente, para la seguridad: si el cilindro de una pinza debe *abrirse siempre* en caso de emergencia para liberar a un operario, se elige una válvula monoestable cuyo muelle devuelve la válvula al estado "pinza abierta" por construcción, independientemente del software.

Una válvula **biestable**, en cambio, mantiene la última posición comandada incluso sin alimentación — propiedad valiosa cuando un actuador necesita "quedarse donde estaba" durante una interrupción (por ejemplo, un actuador que sujeta una pieza pesada no debe soltarla de repente solo porque se ha ido la corriente), pero requiere del software un razonamiento más cuidadoso sobre el estado real de la máquina al reiniciar: el PLC, tras un corte de suministro, no puede asumir automáticamente en qué posición se encuentra un actuador biestable — debe verificarlo con los sensores de fin de carrera (hablamos de ellos en el próximo artículo), no con la memoria de su última orden, que mientras tanto podría estar completamente obsoleta.

## Las islas de válvulas: donde encuentras decenas de electroválvulas agrupadas

En la práctica industrial real, raramente encontrarás una única electroválvula aislada: casi siempre están agrupadas en una **isla de válvulas** (*valve island* o *valve manifold*), un bloque compacto que comparte una única alimentación de aire común (a menudo justo aguas abajo de la unidad FRL vista en el artículo anterior) y, cada vez más en las máquinas modernas, una única conexión eléctrica al PLC mediante un módulo de bus de campo integrado directamente en la propia isla — en lugar de cablear individualmente cada bobina hasta el cuadro con un cable dedicado. Es un adelanto de un tema que trataremos con más calma al hablar de buses de campo: ahorrar decenas o cientos de metros de cable, sustituyéndolos por un único cable de bus, es uno de los motores principales detrás de la descentralización de la I/O en las máquinas modernas.

En el próximo artículo cerramos el círculo de la neumática llegando finalmente al componente que realmente pone el aire en movimiento: los cilindros, de simple y doble efecto, cómo se dimensionan y cómo se lee una hoja de datos real.
