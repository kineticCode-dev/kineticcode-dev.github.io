---
title: "Neumática, primera entrega: de dónde viene realmente el aire comprimido que mueve una máquina"
description: "Cómo se produce y se trata el aire comprimido en una planta industrial: compresores, depósitos, secadores y unidades FRL, explicado sin ecuaciones diferenciales."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Automation", "Fundamentals"]
---

A partir de aquí empezamos un pequeño bloque de tres artículos dedicado a la neumática, y si vienes de una formación puramente informática o electrónica, es probable que este sea el territorio más nuevo de toda la serie. Y sin embargo, en cuanto entras en un área de producción, el sonido de fondo que oyes — ese silbido intermitente, ese "sssh-clack" rítmico — es casi siempre neumática en funcionamiento. Antes de llegar a las válvulas y los cilindros (los veremos en los próximos dos artículos), tenemos que responder a una pregunta anterior: ¿de dónde viene, físicamente, el aire comprimido que alimenta todo esto?

## El compresor: el corazón del sistema neumático

Todo sistema neumático industrial parte de un **compresor**, casi siempre uno solo para toda la planta, que alimenta una red de tuberías distribuida a todas las máquinas conectadas — un poco como la instalación eléctrica distribuye energía a todos los enchufes de una casa, partiendo de un único contador. El tipo más extendido en la industria es el **compresor de tornillo rotativo** (*rotary screw compressor*): dos rotores helicoidales engranados entre sí que, al girar, atrapan progresivamente el aire en volúmenes cada vez más pequeños, comprimiéndolo de forma continua — a diferencia del compresor de pistones, más económico pero típicamente reservado a instalaciones pequeñas o portátiles, que comprime el aire a golpes discontinuos, con más ruido y vibración.

El compresor se regula típicamente para mantener la red a una **presión de trabajo** estándar — muy a menudo alrededor de **6-7 bar** — un valor que vale la pena memorizar porque lo encontrarás constantemente en las hojas de datos de los componentes neumáticos como presión nominal de referencia. Cabe destacar: el "bar" al que nos referimos aquí es casi siempre la presión **relativa** (medida respecto a la presión atmosférica, no a la absoluta) — un detalle que en los cálculos de dimensionamiento marca una diferencia concreta, pero que en la práctica cotidiana de puesta en marcha raramente te creará problemas, porque todos los instrumentos industriales (manómetros, sensores de presión) están calibrados para leer directamente el valor relativo.

## El depósito de acumulación: un amortiguador, no solo un contenedor

Justo después del compresor casi siempre encuentras un gran depósito metálico cilíndrico, el **depósito de acumulación** (*receiver tank*). Su función no es tan banal como "contener aire": sirve para **desacoplar** la producción continua (o casi) del compresor de los picos de consumo instantáneos de la fábrica. Imagina una decena de máquinas que, en el mismo instante, accionan todas juntas varios cilindros neumáticos: la demanda de caudal de aire en ese instante puede superar con creces lo que el compresor logra producir en tiempo real. El depósito, habiendo acumulado una reserva durante los momentos de menor consumo, amortigua estos picos, manteniendo estable la presión de red. Tiene también un segundo papel, menos obvio: actuando como un gran volumen de expansión, permite que el aire se enfríe y que parte de la humedad y del aceite residual del compresor condensen y se depositen en el fondo, de donde se descargan periódicamente mediante una válvula de purga (hoy a menudo automática, temporizada o por nivel).

## El secador: el enemigo invisible es la humedad

El aire atmosférico, el que el compresor aspira para comprimirlo, siempre contiene una cierta cantidad de vapor de agua. Cuando este aire se comprime y luego, a lo largo de la red, se enfría, ese vapor condensa en agua líquida — exactamente como el vaho en un vaso frío en un día húmedo. Esta agua, viajando dentro de las tuberías neumáticas hasta las válvulas y los cilindros, es un problema serio: corroe componentes internos, arrastra el lubricante de las partes en movimiento, y en climas fríos puede incluso congelarse dentro de los tubos. Por eso, en toda instalación industrial seria, después del depósito encuentras un **secador** (*air dryer*), casi siempre de tipo **por refrigeración**: enfría deliberadamente el aire hasta pocos grados por encima de cero, forzando la condensación del exceso de humedad (que se descarga), para luego dejarlo volver a temperatura ambiente, ya "seco" según el estándar requerido por la instalación.

![The journey of compressed air from the compressor through the receiver tank, dryer and FRL unit to the solenoid valve and cylinder](./img/compressed-air-chain.svg)

## La unidad FRL: el último tratamiento, justo antes de cada máquina

Si el compresor, el depósito y el secador son instalaciones centralizadas que sirven a toda la fábrica, el último tratamiento sucede en cambio localmente, a menudo justo a la entrada de cada máquina individual, o incluso de cada grupo individual de válvulas (*isla de válvulas*, hablamos de ella en el próximo artículo): la **unidad FRL**, acrónimo de **Filtro, Regulador, Lubricador** (*Filter, Regulator, Lubricator*), tres componentes casi siempre montados en un único bloque compacto, reconocible a simple vista en cualquier cuadro neumático.

**El filtro** elimina las partículas sólidas residuales y las trazas adicionales de condensado que puedan haberse escapado de los tratamientos aguas arriba, protegiendo los componentes más delicados (las válvulas en particular, que tienen tolerancias mecánicas muy estrechas) del desgaste y de los bloqueos.

**El regulador de presión** es quizás el componente más importante desde un punto de vista funcional: permite ajustar, mediante una perilla, la presión de trabajo exacta para esa máquina o aplicación específica, con independencia de la presión de la red general aguas arriba (que puede oscilar). Aquí es donde, durante la puesta en marcha, ajustas la presión operativa de los cilindros: una presión demasiado baja y el actuador no tiene suficiente fuerza para completar la carrera contra la carga prevista; una presión demasiado alta y arriesgas solicitar excesivamente la mecánica, además de desperdiciar aire comprimido (que, no lo olvides nunca, tiene un coste energético real y para nada despreciable para la empresa).

**El lubricador** (hoy cada vez más a menudo omitido, porque muchos componentes neumáticos modernos están diseñados para funcionar con aire seco sin lubricación adicional, los llamados componentes *oil-free*) nebuliza una cantidad muy pequeña de aceite en el aire en tránsito, para lubricar las partes internas en movimiento de los cilindros y las válvulas aguas abajo — un detalle que siempre conviene verificar en el manual del fabricante, porque mezclar aire lubricado y componentes oil-free en el mismo circuito puede, en algunos casos, causar más daños que beneficios.

Con este cuadro claro — de dónde viene el aire, cómo se trata, y con qué presión llega al punto de uso — en el próximo artículo podemos finalmente abrir el corazón del control neumático: las electroválvulas, el componente que transforma un bit de tu PLC en un movimiento físico real del aire.
