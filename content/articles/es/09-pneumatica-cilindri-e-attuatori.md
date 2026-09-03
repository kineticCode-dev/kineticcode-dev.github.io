---
title: "Neumática, tercera entrega: cilindros y actuadores, donde el aire finalmente se convierte en movimiento"
description: "Cómo funcionan los cilindros neumáticos de simple y doble efecto, los sensores magnéticos de fin de carrera, el dimensionamiento básico y la lectura de una hoja de datos real."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Cylinders", "Sensors", "Automation"]
---

Cerramos el bloque dedicado a la neumática con el componente más visible de todos, el que cualquiera, incluso sin ninguna formación técnica, reconocería a simple vista en una máquina: el **cilindro neumático**. Aquí es donde todo lo que hemos construido en los dos artículos anteriores — el aire tratado y regulado, la electroválvula que dirige su flujo — se transforma finalmente en un empuje mecánico real.

## Anatomía de un cilindro: un émbolo dentro de un tubo

Un cilindro neumático, en su forma más común, es conceptualmente simple: un tubo cilíndrico (la *camisa*), cerrado en los dos extremos por culatas, en cuyo interior se desliza un pistón conectado a un vástago (*rod*) que sale por una de las dos culatas y se conecta mecánicamente a la carga a mover — una pinza, una corredera, un empujador. El aire comprimido, introducido en una de las dos cámaras separadas por el pistón, lo empuja, generando fuerza y movimiento.

![Cross-section of a double-acting pneumatic cylinder showing air ports A and B, and magnetic proximity sensors mounted on the tie rods](./img/cylinder-cross-section.svg)

Ya habíamos distinguido, al hablar de las válvulas, entre cilindros de **simple efecto** (aire por un lado, retorno por muelle) y de **doble efecto** (aire activo en ambos lados). Vale la pena añadir una consideración práctica sobre cuándo se elige uno u otro: el simple efecto es más económico y simple de comandar, y es la elección natural cuando se necesita un retorno automático y fiable "por construcción" incluso en ausencia de señal — piensa en una mordaza de seguridad que debe volver a abrirse en cuanto falta el aire o la corriente. El doble efecto, mucho más extendido en general, es la elección cuando se necesita control activo en ambas direcciones, fuerza también en el movimiento de retorno, o cuando la carrera es larga (el muelle de un cilindro de simple efecto, más allá de cierta longitud, se volvería voluminoso y con una fuerza de retorno poco uniforme a lo largo de toda la carrera).

## Los sensores de fin de carrera: cómo sabe el PLC si el cilindro ha llegado

Un cilindro neumático, por sí solo, no le dice al PLC dónde está: es un actuador, no un sensor. Para saber si un cilindro está completamente extendido o completamente retraído — una información casi siempre indispensable antes de hacer avanzar la secuencia lógica de la máquina al paso siguiente —, hacen falta sensores dedicados, y la solución estándar, elegante y casi universal en la industria, son los **sensores magnéticos de proximidad** (a menudo llamados simplemente *sensores de fin de carrera magnéticos*, o con el nombre comercial histórico *reed switch*, aunque hoy la tecnología más extendida es de efecto Hall).

El truco constructivo es este: el pistón dentro del cilindro monta un anillo magnético permanente, integrado en su estructura. La camisa del cilindro, por su parte, no es de material ferromagnético sino de una aleación (típicamente aluminio anodizado) que deja pasar el campo magnético sin apantallarlo. Los sensores magnéticos, en lugar de montarse dentro del cilindro (lo que requeriría cableados internos complejos y poco fiables), se enganchan **externamente** sobre guías ranuradas a lo largo de la camisa, y detectan el paso del campo magnético del pistón cuando este transita por su posición — sin ningún contacto físico, ningún orificio en la camisa, ningún cableado interno. Es exactamente el mismo principio físico del sensor inductivo que ya conociste, aplicado en una configuración específica.

La enorme ventaja práctica de este sistema es que los sensores son **posicionables manualmente**, deslizándolos a lo largo de la ranura externa de la camisa y fijándolos con un pequeño tornillo cuando están en la posición deseada — una operación que realizarás concretamente durante la puesta en marcha, cuando tengas que ajustar con precisión el punto exacto en el que el PLC debe considerar "alcanzada" la posición extendida o retraída de cada cilindro individual de la máquina.

## El dimensionamiento: cuánta fuerza genera realmente un cilindro

Normalmente no es tarea tuya dimensionar los cilindros de una máquina — es un trabajo que hace la oficina técnica del fabricante, en la fase de diseño mecánico, mucho antes de que recibas la lista de I/O. Pero entender el razonamiento básico te ayuda enormemente a "notar" si algo no cuadra cuando, en el campo, un cilindro parece demasiado lento o incapaz de completar su carrera contra una cierta carga.

La fuerza teórica generada por un cilindro de doble efecto en fase de **extensión** se calcula con una fórmula muy simple, la misma lógica de la presión hidrostática que probablemente ya hayas visto en otro lugar:

**F = P × A**

donde **F** es la fuerza (en newtons), **P** es la presión del aire (en pascales, o más prácticamente convertida desde bar), y **A** es el área de la superficie del pistón sobre la que empuja el aire (en metros cuadrados). Conceptualmente, ¿qué dice esta fórmula? Que la misma presión aplicada sobre una superficie mayor genera una fuerza proporcionalmente mayor — por eso, a igualdad de presión de red disponible (los conocidos 6-7 bar vistos en el primer artículo de esta serie), un cilindro con un diámetro mayor genera una fuerza mayor, simplemente porque ofrece más superficie al aire sobre la que empujar.

Un detalle interesante, y a menudo fuente de errores de valoración por parte de quien nunca ha hecho este cálculo: en fase de **retracción**, la fuerza es ligeramente menor a igualdad de presión, porque el vástago que atraviesa la culata "roba" una porción del área útil del pistón en ese lado — el aire, en esa cámara, empuja sobre un área en forma de corona circular, no sobre un círculo completo. Para la mayoría de las aplicaciones la diferencia es despreciable, pero en los catálogos de los fabricantes (Festo, SMC, Camozzi son nombres que encontrarás por todas partes en Europa) siempre encuentras dos valores de fuerza distintos, uno para la extensión y otro para la retracción, precisamente por este motivo.

## Un ejemplo concreto de lectura de hoja de datos

Imagina que tienes que verificar si un cilindro SMC serie CDQ2, diámetro 32mm, alimentado a la presión de red estándar de 6 bar, tiene suficiente fuerza para empujar una carga que opone una resistencia estimada de 350N. La hoja de datos te da el área del pistón (para un diámetro de 32mm, unos 8 cm², es decir 0,0008 m²). Aplicando la fórmula: F = 600.000 Pa × 0,0008 m² ≈ 480N de fuerza teórica. Parece suficiente respecto a los 350N requeridos — pero aquí entra una última consideración práctica que todo técnico de puesta en marcha aprende pronto en el campo: la fuerza teórica calculada así es la **estática ideal**, sin considerar las fricciones internas del cilindro, las pérdidas de carga en las tuberías, y sobre todo sin ningún margen de seguridad. La regla empírica extendida en el sector es no superar, en condiciones operativas reales, alrededor del 70-80% de la fuerza teórica calculada — en nuestro ejemplo, un margen operativo real en torno a los 340-380N, ya bastante cerca del límite requerido como para aconsejarte, cuando menos, durante la puesta en marcha, un cilindro de diámetro mayor o una presión de trabajo más alta, antes de que el problema se presente en producción en forma de un ciclo demasiado lento o de un cilindro que, con el desgaste, deja de completar la carrera.

Con esto se cierra el bloque sobre neumática. En el próximo artículo vemos, por contraste y para completar el cuadro, a la hermana mayor de la neumática cuando hacen falta fuerzas realmente grandes: la hidráulica.
