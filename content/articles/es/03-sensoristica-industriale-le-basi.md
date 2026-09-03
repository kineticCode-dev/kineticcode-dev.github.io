---
title: "PNP, NPN, digital, analógico: el lenguaje con el que los sensores hablan con el PLC"
description: "Las bases de la sensórica industrial: salidas PNP y NPN, señales digitales y analógicas (4-20mA, 0-10V), y por qué confundir estos conceptos es el error más común en el cableado."
date: "2026-09-01"
category: "automazione"
tags: ["Sensors", "PLC", "Automation", "Fundamentals"]
---

Si hay un error que, tarde o temprano, comete cualquiera que trabaje en el campo — desde el electricista hasta el recién graduado en mecatrónica, pasando por ti —, es conectar un sensor PNP donde hacía falta un NPN, o al revés, y pasar veinte minutos preguntándose por qué el PLC no ve absolutamente nada mientras el LED del sensor parpadea alegremente indicando que está detectando algo. No es un error tonto: nace de un concepto sutil, casi siempre mal explicado, que hoy quiero aclararte de una vez por todas.

## Un sensor no es un interruptor, pero se comporta como uno

Parte de una imagen simple: un sensor de proximidad industrial — sea inductivo, capacitivo o fotoeléctrico, los veremos en el próximo artículo — en su esencia hace exactamente lo que hace un interruptor de pared: cierra o abre un contacto eléctrico en respuesta a algo (en el caso del interruptor, tu mano; en el caso del sensor, la presencia de un objeto). La diferencia es que el interruptor de pared es una pieza de metal que cierras tú mecánicamente, mientras que el sensor tiene dentro un pequeño circuito electrónico que *simula* el cierre de un contacto usando un transistor como interruptor electrónico.

Y es precisamente aquí donde nace la distinción PNP/NPN: depende de **qué lado del circuito conecta el transistor del sensor con la salida**.

## PNP: el sensor "regala" el positivo

Un sensor **PNP** (también llamado *sourcing*, "que suministra corriente") cuando está activo conecta su salida al **+24V** de la alimentación. En la práctica, cuando el sensor detecta el objeto, en la salida encuentras 24V respecto a masa. La entrada del PLC, por su parte, debe estar configurada (o más a menudo, en los PLC modernos, ya viene cableada) para reconocer como "verdadero" un nivel alto en la entrada, con la referencia a 0V conectada en común.

## NPN: el sensor "absorbe" hacia masa

Un sensor **NPN** (también llamado *sinking*, "que absorbe corriente") hace exactamente lo contrario: cuando está activo, conecta su salida a **0V** (masa). La entrada del PLC en este caso debe ver un nivel bajo como "verdadero", con el +24V llevado en común al lado opuesto.

![Wiring comparison between a PNP sourcing sensor and an NPN sinking sensor connected to a PLC input](./img/pnp-vs-npn-wiring.svg)

Mira bien el esquema: la diferencia física está toda ahí, en qué borne del sensor — el de señal — se lleva a +24V o a 0V cuando el sensor conmuta. Si conectas un sensor PNP a una entrada del PLC cableada para recibir NPN (es decir, con el común a +24V en lugar de a 0V), el circuito simplemente nunca se cierra en la dirección correcta: la entrada no ve ninguna variación de nivel útil, y para el PLC el sensor "nunca está activo", aunque físicamente esté detectando el objeto perfectamente y su LED lo confirme.

**Una regla práctica que te ahorrará tiempo en el campo:** en Europa, por tradición histórica y normativa, la gran mayoría de los sensores industriales y de los PLCs está cableada en **PNP**. Si no se especifica lo contrario en la lista de I/O o en la etiqueta del sensor, parte de la base de que es PNP — pero verifícalo siempre, porque en el sector automotriz y en muchas instalaciones de origen americano o asiático todavía encuentras bastante NPN, y los dos mundos conviven más a menudo de lo que esperas, incluso en la misma máquina.

## Digital vs. analógico: una pregunta distinta de PNP/NPN

PNP y NPN se refieren a *cómo* se transporta eléctricamente una señal digital (encendido/apagado, presente/ausente). Pero no todos los sensores dan una respuesta binaria. Muchos — piensa en un sensor de presión, de temperatura, o un transductor de posición lineal — deben comunicar un **valor continuo**: no "hay presión" sino "la presión es 3,7 bar". Para esto hacen falta las señales **analógicas**, y en el mundo industrial encuentras esencialmente dos tipos, casi siempre los mismos vayas donde vayas:

**Corriente 4-20mA.** El sensor hace circular por el circuito una corriente proporcional a la magnitud medida: 4mA corresponde al valor mínimo de la escala (ejemplo: 0 bar), 20mA al valor máximo (ejemplo: 10 bar). Es el estándar más extendido en la industria pesada, y la razón es elegante desde el punto de vista de la ingeniería: al ser una señal de corriente y no de tensión, no se ve afectada por las caídas de tensión a lo largo de cables largos (un problema serio cuando hablamos de decenas o cientos de metros de cableado en una planta), y es inmune a gran parte de las interferencias electromagnéticas que sí afectan a las señales de tensión. Fíjate en un detalle ingenioso del estándar: el valor mínimo no es 0mA sino 4mA. Esto permite al PLC distinguir un valor realmente cero (4mA) de un cable roto o un sensor desconectado (0mA): un fallo genera un valor fuera de escala reconocible en lugar de un error silencioso que parece un dato válido.

**Tensión 0-10V.** Conceptualmente más simple — el sensor genera una tensión proporcional a la magnitud medida —, pero más sensible a las interferencias y a las caídas de tensión en cables largos, por lo que típicamente se reserva a distancias cortas, dentro o cerca del cuadro.

El módulo de entrada analógica del PLC, por su parte, convierte esta señal continua en un número digital mediante un convertidor analógico-digital (ADC), que típicamente te devuelve un valor entero de 12 o 16 bits para reescalar en tu código a la magnitud física real — ahí es donde en tu programa escribes esas funciones de escalado que transforman `raw_value` en `pressure_bar`, con la fórmula lineal que relaciona los dos extremos de la escala.

## NO y NC: la otra distinción que cuenta

Un último par de siglas que encontrarás por todas partes, y que es completamente independiente de PNP/NPN: **NO** (*Normally Open*, normalmente abierto) y **NC** (*Normally Closed*, normalmente cerrado). Describen el estado del contacto — o de la salida electrónica equivalente — cuando el sensor *no* está activo, es decir, en reposo. Un sensor NO no deja pasar señal hasta que detecta el objeto; un sensor NC hace exactamente lo contrario: deja pasar señal siempre, excepto cuando detecta el objeto (o cuando falla, lo que lo convierte en una opción muy común en los circuitos de seguridad — si el cable se corta, el circuito se abre y el sistema lo interpreta correctamente como una alarma, en lugar de un silencio ambiguo).

Junta todas estas siglas — PNP/NPN, NO/NC, digital/analógico — y habrás descodificado la gran mayoría de las indicaciones que encuentras junto a un sensor en un catálogo o en una lista de I/O: `PNP NO digital`, `NPN NC digital`, `4-20mA analog`. Ya no son siglas abstractas: son instrucciones de cableado precisas, y ahora sabes exactamente qué hacer cuando las lees.

En el próximo artículo entramos en detalle en los sensores más comunes que encontrarás físicamente en el campo: inductivos, capacitivos, fotoeléctricos y encoders — cómo funcionan por dentro, y cuándo se elige un tipo en lugar de otro.
