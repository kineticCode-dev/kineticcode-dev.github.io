---
title: "Hidráulica para quien viene de la neumática: misma lógica, fuerzas mucho mayores"
description: "Las bases de la hidráulica industrial — bombas, motores hidráulicos, válvulas — y cuándo conviene realmente frente a la neumática."
date: "2026-09-01"
category: "automazione"
tags: ["Hydraulics", "Pneumatics", "Automation", "Fundamentals"]
---

Después de tres artículos dedicados a la neumática, la hidráulica podría parecer a primera vista un capítulo redundante: bombas, válvulas, cilindros — los mismos nombres, los mismos conceptos, casi el mismo vocabulario. Y es cierto: la arquitectura conceptual es sorprendentemente similar. Pero la elección entre los dos mundos nunca es casual, y entender por qué un diseñador elige la hidráulica en lugar de la neumática — o viceversa — te da una herramienta de diagnóstico adicional cuando te encuentras delante de una máquina que nunca has visto antes: mirando cuál de las dos tecnologías se ha usado, entiendes de inmediato algo sobre los requisitos de fuerza y precisión que esa parte de la máquina debía cumplir.

## La diferencia de fondo: un fluido que se comprime, uno que no se comprime

La diferencia física de partida es simple de enunciar pero tiene consecuencias profundas en todo lo demás: el aire es un gas, **comprimible**; el aceite hidráulico es un líquido, prácticamente **incompresible** en condiciones operativas normales. Esta única propiedad explica casi todas las diferencias prácticas entre los dos sistemas.

Un sistema neumático, precisamente porque el aire se comprime, tiene un comportamiento ligeramente "elástico": cuando aplicas una carga a un cilindro neumático parado, la posición del vástago puede ceder una pequeña cantidad mientras el aire en la cámara se comprime aún más para equilibrar la nueva carga — un cilindro neumático nunca es perfectamente "rígido" bajo una carga variable. Un sistema hidráulico, por el contrario, al ser el aceite incompresible, tiene un comportamiento casi perfectamente rígido: aplica una carga a un cilindro hidráulico parado (con las válvulas cerradas) y la posición prácticamente no cede nada, porque no hay ningún volumen de fluido que pueda comprimirse para absorber la variación. Por eso, en todas partes donde se necesita un posicionamiento firme y rígido bajo cargas pesadas y variables — piensa en los moldes de una prensa de inyección — la hidráulica es casi siempre la elección obligada.

![Comparison chart between pneumatics and hydraulics: working pressure, fluid type, force scale and typical applications](./img/pneumatics-vs-hydraulics.svg)

## Las presiones en juego: un orden de magnitud distinto

¿Recuerdas la presión de trabajo típica de la neumática, alrededor de 6-7 bar? Un sistema hidráulico industrial trabaja típicamente entre **100 y 350 bar**, y en algunas aplicaciones todavía más. Aplicando la misma fórmula F = P × A vista al hablar de los cilindros neumáticos, entiendes de inmediato por qué: a igualdad de área del pistón (es decir, a igualdad de tamaño del cilindro), trabajar a una presión 20-50 veces superior genera una fuerza 20-50 veces superior. Por eso un cilindro hidráulico relativamente compacto puede generar fuerzas del orden de toneladas, donde un cilindro neumático de dimensiones comparables se quedaría en pocos cientos de newtons.

## La bomba hidráulica: el corazón del sistema, siempre encendido

Mientras que un sistema neumático se abastece de una red centralizada de aire comprimido compartida por toda la planta, un sistema hidráulico es casi siempre **autónomo y local a cada máquina individual**: una central hidráulica dedicada (*power pack*), compuesta por un depósito de aceite, una bomba accionada por un motor eléctrico, y un bloque de válvulas de control, todo montado directamente en la máquina o junto a ella. La bomba más extendida en la industria es la **bomba de engranajes** (económica, robusta, adecuada para presiones medias) o, para aplicaciones de mayor precisión y presiones más elevadas, la **bomba de pistones axiales**, capaz de entregar caudales variables regulando la inclinación de un plato oscilante interno — un detalle mecánico elegante que permite modular el caudal de aceite, y por tanto la velocidad del movimiento, sin tener que estrangular el flujo con una válvula (solución que desperdiciaría energía en forma de calor).

Un detalle operativo que nunca hay que subestimar durante la puesta en marcha: a diferencia de la neumática, donde el exceso de aire simplemente se descarga a la atmósfera (de ahí el característico silbido), un sistema hidráulico es un **circuito cerrado**: el aceite, después de haber movido el actuador, debe volver al depósito a través de una línea de retorno dedicada. Esto significa que cada válvula hidráulica, a diferencia de una neumática, siempre necesita un recorrido de retorno explícito hacia el depósito, y una fuga de aceite no es solo un desperdicio (como lo sería una pequeña fuga de aire) sino una contaminación ambiental concreta que hay que gestionar con cuidado — uno de los motivos por los que el mantenimiento predictivo en los sistemas hidráulicos (control periódico de juntas, filtros, nivel y calidad del aceite) es mucho más riguroso que en la neumática.

## El motor hidráulico: cuando hace falta rotación continua con alta fuerza

Además de los cilindros lineales — conceptualmente idénticos a los neumáticos vistos en el artículo anterior, solo que dimensionados para presiones mucho más altas y con juntas más robustas —, la hidráulica ofrece también los **motores hidráulicos**, el equivalente rotativo del cilindro: en lugar de generar una carrera lineal, el aceite a presión hace girar continuamente un eje, generando un par muy elevado incluso a bajas revoluciones — una característica valiosa en aplicaciones como los cabrestantes de elevación o los accionamientos de grandes ruedas dentadas, donde un motor eléctrico equivalente necesitaría una reducción mecánica mucho más voluminosa para obtener el mismo par a baja velocidad.

## Cómo se comanda desde el PLC: la misma lógica, válvulas distintas

La buena noticia, para ti que tienes que programar el software de control, es que desde el punto de vista lógico el comando de un sistema hidráulico desde el PLC sigue exactamente el mismo esquema conceptual que la neumática: electroválvulas (aquí llamadas más a menudo **válvulas direccionales hidráulicas**, pero con la misma simbología ISO 1219 y la misma nomenclatura de vías/posiciones que ya aprendiste) pilotadas por salidas digitales del PLC, que dirigen el flujo de fluido hacia una u otra cámara del actuador. La diferencia principal que encontrarás en la práctica es que las aplicaciones hidráulicas de gama alta usan a menudo **válvulas proporcionales**, comandadas no por una simple señal on/off sino por una señal analógica (típicamente 0-10V o 4-20mA, los mismos estándares vistos al hablar de sensores analógicos), que permite modular con continuidad la apertura de la válvula y por tanto la velocidad y la fuerza del actuador — un nivel de control fino que en la neumática, dado el coste contenido de los componentes, se encuentra más raramente.

## Cuándo elegir una, cuándo la otra

Una regla práctica, simplificada pero útil en el campo: si hace falta velocidad, ciclo rápido, fuerza contenida, limpieza (ninguna fuga de aceite posible en un entorno alimentario o farmacéutico) — neumática. Si hace falta fuerza muy elevada, rigidez bajo carga, control fino y continuo de la velocidad incluso bajo cargas pesadas — hidráulica. No es raro, de hecho es la norma, encontrar ambas tecnologías en la misma máquina: neumática para las funciones auxiliares rápidas y ligeras (pinzas, expulsores), hidráulica para el órgano principal que debe generar la fuerza de trabajo propiamente dicha — piensa en una prensa, donde el molde es movido por un gran cilindro hidráulico, pero la expulsión de la pieza acabada está a cargo de un pequeño cilindro neumático.

En el próximo artículo dejamos la potencia y la fuerza para un tema igual de crítico pero de naturaleza distinta: la seguridad funcional, y el modo específico — muy distinto de cómo normalmente piensas en el software — en que la industria la diseña.
