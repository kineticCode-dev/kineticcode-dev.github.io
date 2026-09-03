---
title: "Inductivos, capacitivos, fotoeléctricos, encoder: cuatro formas distintas de hacer que una máquina vea"
description: "Cómo funcionan realmente los sensores de proximidad industriales más comunes, cuándo se elige uno u otro, y cómo leer una hoja de datos real."
date: "2026-09-01"
category: "automazione"
tags: ["Sensors", "Encoders", "Automation", "Fundamentals"]
---

En el software, cuando necesitas saber si algo "existe" o "está en la condición X", escribes una condición booleana y el problema queda resuelto. En el mundo físico, saber si una pieza metálica ha llegado a una cierta posición, si un contenedor de plástico transparente está lleno, o cuántos grados ha girado un eje motor, son tres problemas completamente distintos, que requieren tres principios físicos diferentes para resolverse de forma fiable. Este artículo es la guía de los cuatro sensores que resuelven el 90% de los casos que encontrarás: inductivo, capacitivo, fotoeléctrico y encoder.

![Comparison of inductive, capacitive, photoelectric sensors and a rotary encoder](./img/sensor-types-comparison.svg)

## El sensor inductivo: solo ve metales, pero los ve muy bien

El sensor inductivo es probablemente el sensor de proximidad más extendido en la automatización industrial, y la razón es simple: la mayoría de las partes móviles de una máquina — cilindros, correderas, brazos — son de metal, y el inductivo es económico, robusto, sin contacto, y prácticamente insensible a la suciedad, el aceite y las vibraciones.

El principio físico es elegante. Dentro del sensor hay una bobina que genera un campo electromagnético de alta frecuencia, que sale por la cara sensible del sensor. Cuando un objeto metálico entra en este campo, en su interior se generan corrientes inducidas (llamadas *corrientes parásitas* o *corrientes de Foucault*) que absorben energía del campo. El circuito interno del sensor mide esta absorción de energía — en la práctica, el amortiguamiento de la oscilación de la bobina — y cuando supera un cierto umbral, conmuta la salida. Fíjate en el detalle importante: **el sensor inductivo solo detecta materiales conductores**, en la práctica casi exclusivamente metales. Plástico, madera, vidrio, líquidos: para el inductivo son transparentes, simplemente no existen.

Un parámetro que siempre encontrarás en la hoja de datos es la **distancia nominal de detección** (`Sn`), típicamente pocos milímetros en los sensores más compactos (los conocidos cilíndricos M8, M12, M18, donde el número indica el diámetro roscado en milímetros) hasta algunos centímetros en los modelos más grandes. También encontrarás una distinción entre montaje **enrasable (embeddable)** y **no enrasable (non-embeddable)**: los primeros pueden empotrarse completamente a ras en un soporte metálico sin que esto interfiera con la lectura, los segundos necesitan un espacio libre alrededor de la cara sensible — un detalle que en los planos mecánicos del soporte del sensor marca realmente la diferencia, y que si se ignora produce sensores que "ven" su propio soporte en lugar de la pieza a detectar.

## El sensor capacitivo: ve (casi) todo, incluso a través de una pared

Donde el inductivo se detiene, entra en juego el capacitivo. Funciona de forma conceptualmente similar — genera un campo, esta vez eléctrico en lugar de magnético, y mide su variación —, pero es sensible a la **constante dieléctrica** del material que se aproxima, una propiedad que casi cualquier material posee en cierta medida: plástico, vidrio, madera, líquidos, incluso la mano de una persona. Esto lo hace mucho más versátil pero también más "ruidoso": un capacitivo mal regulado puede activarse por la humedad del aire o por la suciedad que se acumula en su cara sensible, por lo que casi todos los modelos industriales tienen un trimmer de sensibilidad que ajustar durante la instalación — uno de los pocos sensores que realmente requiere calibración en campo, y no solo un posicionamiento mecánico.

La aplicación de manual es la detección de nivel a través de paredes no metálicas: un sensor capacitivo colocado en el exterior de un depósito de plástico puede detectar si el líquido en el interior ha alcanzado ese punto, sin necesidad de ningún orificio en el depósito — una solución que, la primera vez que la ves funcionar, parece casi magia.

## El sensor fotoeléctrico: el mayor alcance, el principio más intuitivo

El fotoeléctrico usa un haz de luz — casi siempre infrarroja, invisible al ojo pero funcionando perfectamente en principio — y mide su interrupción o su reflejo. Existen tres configuraciones principales, y es importante distinguirlas porque cambian radicalmente el modo en que diseñas su montaje en la máquina:

**Barrera (through-beam).** Un emisor y un receptor separados, montados uno frente al otro: cuando algo interrumpe el haz, el receptor lo detecta. Es la configuración más fiable y de mayor alcance (incluso decenas de metros), pero requiere alinear y cablear dos componentes distintos.

**Retrorreflectivo (retro-reflective).** Emisor y receptor en el mismo cuerpo, con un catadióptrico (un reflector prismático pasivo, económico y sin necesidad de alimentación) montado en el lado opuesto: el haz va, rebota en el reflector y vuelve. Un único componente activo que cablear, alcance intermedio.

**Difuso (diffuse).** El propio sensor emite luz y detecta su reflejo directo sobre el objeto, sin ningún reflector dedicado. Es el más simple de instalar (un único componente, ningún reflector) pero el más sensible al color y al acabado superficial del objeto: una superficie negra mate refleja mucha menos luz que una superficie blanca brillante, y esto puede cambiar drásticamente el alcance útil — un detalle a tener muy en cuenta cuando la máquina debe gestionar productos de colores distintos.

## El encoder: cuando no basta saber "sí o no", sino que hace falta saber "cuánto"

Todos los sensores vistos hasta ahora responden a una pregunta binaria: presente o ausente. El encoder responde a una pregunta completamente distinta: cuánto ha girado (o trasladado) algo, y a veces a qué velocidad. Es el sensor que encontrarás en el eje de un motor, en un eje de posicionamiento, en cualquier parte de la máquina de la que se necesite conocer la posición exacta y no solo un par de estados.

El tipo más común es el **encoder incremental óptico**: un disco perforado solidario al eje giratorio pasa entre un emisor y un receptor de luz, generando un tren de impulsos cada vez que pasa un orificio. Contando los impulsos, el PLC (o más a menudo un módulo de conteo rápido dedicado, porque la frecuencia de estos impulsos puede superar ampliamente la velocidad de escaneo cíclico normal del PLC) reconstruye cuánto ha girado el eje. Los encoders incrementales de calidad tienen típicamente dos canales desfasados 90 grados (llamados A y B), que permiten no solo contar los impulsos sino también determinar la **dirección** de rotación a partir de la secuencia con la que conmutan los dos canales — un detalle elegante de ingeniería que vale la pena entender, porque es el mismo principio usado en todas partes donde haga falta detectar un sentido de movimiento a partir de dos señales digitales desfasadas.

La alternativa es el **encoder absoluto**, que en lugar de contar impulsos relativos devuelve directamente, en cada instante, la posición absoluta actual (típicamente como valor digital en un bus de comunicación), incluso inmediatamente después de un encendido — una propiedad muy valiosa para los ejes que no pueden permitirse una fase de "puesta a cero" en cada reinicio de la máquina, como los grandes ejes de posicionamiento en una línea de producción continua.

## Leer una hoja de datos real: qué buscar primero

Cuando recibes un componente físico para poner en marcha, o tienes que verificar uno para sustituirlo, la hoja de datos del fabricante (Omron, Sick, Balluff, Pepperl+Fuchs son nombres que encontrarás con muchísima frecuencia) siempre tiene una estructura similar. Los parámetros a mirar primero, en orden de prioridad práctica: la tensión de alimentación (casi siempre 10-30VDC, con 24VDC nominal), el tipo de salida (PNP/NPN, NO/NC — lo que aprendiste en el artículo anterior), la distancia nominal de detección y, para el inductivo y el capacitivo, si es enrasable o no enrasable. Si después de leer estas cuatro líneas ya sabes responder "este sensor sirve para esa posición en la máquina", has aprendido exactamente lo que hace falta para trabajar con seguridad en el campo.

En el próximo artículo pasamos de "percibir" a "mover": motores asíncronos, servomotores y variadores de frecuencia, y qué cambia realmente, desde el punto de vista del software de control, entre estos tres mundos.
