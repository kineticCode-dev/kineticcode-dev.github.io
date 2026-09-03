---
title: "Buses de campo: por qué ya nadie cablea cada sensor hasta el cuadro central"
description: "Cómo y por qué la I/O de una máquina moderna se descentraliza mediante buses de campo como Profinet y EtherCAT, en lugar de cablearse punto a punto hasta el PLC."
date: "2026-09-01"
category: "automazione"
tags: ["Fieldbus", "Profinet", "EtherCAT", "Automation"]
---

Imagina una máquina de tamaño medio con doscientos sensores y actuadores repartidos sobre una estructura de diez metros. Si cada señal individual tuviera que cablearse por separado hasta el PLC en el cuadro central — un cable dedicado para cada sensor, de ida y vuelta —, hablamos de cientos de cables, algunos de hasta diez o quince metros de largo, cada uno con su propio recorrido en canaleta, su propio número identificativo, su propio borne dedicado. Es una arquitectura que, hasta hace unas décadas, era simplemente la norma — y que hoy, si todavía te la encuentras, reconoces de inmediato como "de estilo antiguo". La solución moderna, casi universal, es el **bus de campo**.

![Comparison between centralized home-run wiring, with one dedicated cable per sensor back to the PLC, and distributed fieldbus wiring through local remote I/O blocks](./img/centralized-vs-distributed-io.svg)

## La idea de fondo: un solo cable, muchos dispositivos

Un bus de campo es, conceptualmente, una red de comunicación digital dedicada a la automatización industrial: en lugar de conectar cada sensor y cada actuador con un cable dedicado hasta el PLC, se conectan grupos de dispositivos físicamente cercanos a un módulo de **I/O remota** (o *I/O descentralizada*), colocado directamente en la máquina, cerca de los dispositivos a los que sirve. Este módulo remoto se comunica luego con el PLC central a través de un **único cable de bus**, por el que viajan digitalmente, en rápida secuencia, todos los estados de todos los sensores y todas las órdenes para todos los actuadores conectados a ese módulo.

El ahorro de cableado es enorme, pero no es la única ventaja. Un módulo de I/O remota típicamente ofrece también funciones de diagnóstico mucho más ricas que un simple contacto cableado: puedes saber no solo si un sensor está activo o no, sino también si su cable se ha cortado, si está absorbiendo una corriente anómala, si un canal de salida está en cortocircuito — información que, con el cableado tradicional punto a punto, requeriría circuitos de diagnóstico dedicados y costosos para cada señal individual, mientras que en un bus de campo llega "gratis", incluida en el propio protocolo de comunicación.

## Los protocolos que encontrarás más a menudo: Profinet y EtherCAT

El mundo de los buses de campo ha tenido, históricamente, una fragmentación notable (Profibus, DeviceNet, CANopen, y muchos otros, cada uno con sus propios defensores industriales), pero en los últimos años se ha consolidado fuertemente en torno a soluciones basadas en **Ethernet industrial**, que aprovechan el mismo hardware físico de la red Ethernet que ya conoces del mundo IT, con protocolos y temporizaciones específicas para garantizar el determinismo requerido por el control de máquina en tiempo real (una propiedad que el Ethernet "de oficina" estándar no garantiza por sí mismo).

**Profinet**, desarrollado por el consorcio vinculado a Siemens, es probablemente el más extendido en Europa en el ámbito industrial general: usa paquetes Ethernet estándar con extensiones para garantizar tiempos de ciclo predecibles, y es relativamente simple de configurar y diagnosticar, incluso con herramientas de red genéricas.

**EtherCAT**, desarrollado por Beckhoff, adopta un enfoque técnicamente más refinado: en lugar de que cada dispositivo reciba y responda a un paquete Ethernet separado (con el inevitable overhead de procesamiento para cada uno), un único paquete Ethernet atraviesa en secuencia todos los dispositivos conectados en el bus, y cada uno "lee al vuelo" los datos que le corresponden y "escribe al vuelo" sus propios datos en ese mismo paquete, mientras este lo atraviesa físicamente, casi sin retraso introducido — un mecanismo que le permite alcanzar tiempos de ciclo extremadamente bajos (fracciones de milisegundo para cientos de dispositivos), por lo que lo encontrarás a menudo en las aplicaciones de control de movimiento más exigentes, donde hace falta sincronizar varios ejes servo con una precisión temporal muy estrecha.

No hace falta, para tu trabajo diario, conocer los detalles de implementación profundos de estos protocolos — eso es terreno de los desarrolladores de los propios módulos de hardware. Lo que necesitas es reconocerlos cuando los ves en un esquema o en una configuración de hardware del PLC, y saber que detrás de la sigla está exactamente el mecanismo que acabamos de describir: un cable, muchos dispositivos, comunicación digital cíclica y determinista.

## Qué cambia, concretamente, en tu trabajo de programación

Desde el punto de vista de tu código de aplicación, la buena noticia es que la abstracción permanece casi idéntica a antes: en el software de configuración del PLC (la *herramienta de ingeniería*, sea TIA Portal, CODESYS, u otras), configuras los módulos remotos conectados en el bus exactamente como configurarías módulos de I/O locales en el chasis del PLC, y en tu programa sigues leyendo y escribiendo variables booleanas o analógicas con los mismos mecanismos — la abstracción del bus es, casi siempre, completamente transparente para la lógica de aplicación. Lo que cambia, y que vale la pena saber para la puesta en marcha en el campo, es el **diagnóstico de red**: si un módulo remoto pierde comunicación (un cable de bus dañado, una interferencia electromagnética, una alimentación del módulo remoto ausente), todas las señales que pasan por ese módulo se vuelven indisponibles al mismo tiempo, y el PLC típicamente señala un error de comunicación específico y distinto de una simple avería de sensor — un error que, la primera vez que lo veas, entenderás de inmediato que es de naturaleza completamente distinta de un problema de lógica de aplicación, precisamente porque ahora sabes qué hay físicamente detrás de esa comunicación.

## Una última observación: también la seguridad tiene su bus

Vale la pena cerrar este artículo conectándolo con el anterior sobre seguridad funcional: también los circuitos de seguridad, que antes casi siempre se cableaban de forma tradicional con relés dedicados, hoy cada vez más a menudo viajan sobre variantes *safety* de los mismos buses de campo (**Profisafe** sobre Profinet, **FSoE** — *Fail Safe over EtherCAT* — sobre EtherCAT), que añaden al protocolo estándar mecanismos de control adicionales (códigos de redundancia, números de secuencia, timeouts estrictos) capaces de garantizar que un fallo de comunicación en el bus nunca pase desapercibido, manteniendo así, incluso en una arquitectura de red compartida, la misma garantía de seguridad intrínseca del cableado dedicado que viste en el artículo anterior — un buen ejemplo de cómo un principio de ingeniería sólido (la redundancia y el autodiagnóstico) se adapta a tecnologías distintas sin perder su sustancia.

Llegamos así al último artículo de la serie: uniremos todo lo que hemos visto — mecánica, cuadro eléctrico, sensores, motores, neumática, hidráulica, seguridad, buses de campo — diseccionando juntos una máquina real, de principio a fin.
