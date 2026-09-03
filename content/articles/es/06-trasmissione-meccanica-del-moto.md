---
title: "Correas, cadenas y husillos de bolas: cómo el movimiento de un motor llega realmente donde hace falta"
description: "El mínimo de mecánica de transmisión que necesita un ingeniero de control para entender por qué una máquina está construida de una cierta manera."
date: "2026-09-01"
category: "automazione"
tags: ["Mechanics", "Machine Design", "Automation", "Fundamentals"]
---

Un motor, por sí solo, sabe hacer una sola cosa: hacer girar su propio eje. Todo lo demás — desplazar una corredera en línea recta, elevar un peso, sincronizar dos ejes que deben moverse en una proporción fija entre sí — es tarea de los **órganos de transmisión**: los componentes mecánicos que toman esa rotación y la transforman en otra cosa. No es un capítulo de mecánica aplicada en sentido académico: es, mucho más pragmáticamente, el motivo por el que una máquina está construida de una cierta manera, y conocerlo te ayuda a entender, mirando una máquina real, por qué ese motor está montado ahí y conectado de ese modo a esa corredera.

![Four common ways to transmit motion: belt and pulley, chain and sprocket, ball screw, and linear guide](./img/mechanical-transmission-types.svg)

## Correas y poleas: ligereza y silencio, con un compromiso

La transmisión por correa es probablemente la más extendida en general para transmitir movimiento entre dos ejes paralelos a distancia corta o media: una correa (de goma reforzada, a menudo dentada para evitar deslizamientos) envuelve dos poleas, una conectada al motor y otra al órgano a mover. Es ligera, económica, silenciosa, y amortigua de forma natural las vibraciones — propiedad valiosa cuando la máquina trabaja a alta velocidad.

El compromiso afecta a la precisión: incluso una correa dentada, por rígida que sea comparada con una lisa, tiene una mínima elasticidad intrínseca y un juego en el engrane con los dientes de la polea. Para una cinta transportadora esto es irrelevante. Para un eje que debe posicionar una herramienta con precisión de décimas de milímetro, esta elasticidad se traduce en un error de posicionamiento que un encoder en el motor, por sí solo, no puede corregir — porque el encoder mide cuánto ha girado el motor, no cuánto se ha desplazado realmente la carga en el otro extremo de la correa. Es uno de los motivos por los que, en los ejes de precisión más críticos, encontrarás a menudo un segundo encoder montado directamente en la parte móvil (una configuración llamada *retroalimentación directa*, o *feedback lineal*), que cierra el lazo de control sobre la posición real de la carga y no sobre la presunta del motor.

## Cadenas y piñones: cuando hace falta fuerza sin compromisos

Donde la correa cede a favor de la robustez, encuentras la cadena: eslabones metálicos articulados que engranan sobre ruedas dentadas (los piñones). A diferencia de la correa, la cadena es prácticamente inextensible y nunca desliza — transmite el movimiento con una relación de transmisión fija y exacta, punto por punto. Es la elección típica para cargas pesadas y entornos exigentes (suciedad, temperaturas elevadas, aceite) donde una correa de goma se degradaría rápidamente: cadenas de elevación, transportadores de cadena para pallets y productos pesados, transmisiones de potencia en prensas y líneas industriales robustas.

El precio de esta robustez es el mantenimiento: una cadena necesita lubricación periódica y, con el tiempo, se alarga ligeramente por el desgaste de las articulaciones (fenómeno llamado *alargamiento por desgaste*), lo que requiere un tensado periódico — una operación que, si la ves en el campo durante una parada programada de la máquina, ahora sabes exactamente por qué se hace.

## El husillo de bolas: la forma elegante de transformar rotación en traslación precisa

Cuando hace falta transformar un movimiento rotatorio en un movimiento lineal — no simplemente transportar algo en círculo, sino desplazar una corredera adelante y atrás a lo largo de un eje —, el órgano más extendido en las aplicaciones de precisión es el **husillo de bolas** (*ball screw*). El principio es, en apariencia, el de un tornillo cualquiera: una tuerca que avanza a lo largo de un eje roscado cuando este gira. La diferencia sustancial, que justifica el nombre, es que entre la tuerca y la rosca del eje no hay contacto directo deslizante, sino una serie de bolas metálicas que ruedan en el canal de la rosca y se recirculan continuamente a través de un canal de retorno interno de la tuerca.

¿Por qué es importante este detalle? Porque en un tornillo tradicional el contacto es de **deslizamiento** (fricción de deslizamiento), con pérdidas por fricción significativas y desgaste con el tiempo; en el husillo de bolas el contacto es de **rodadura** (fricción de rodadura), enormemente más eficiente — rendimientos incluso superiores al 90%, frente al 20-40% de un tornillo tradicional —, y con un juego mecánico mínimo y constante en el tiempo. Por eso prácticamente todos los ejes de precisión lineal en una máquina herramienta, en un sistema de dosificación, en una máquina de envasado de gama alta, usan un husillo de bolas combinado con un servomotor: la unión de los dos componentes — motor en lazo cerrado más transmisión de juego bajísimo — es lo que hace posible posicionar una carga con repetibilidad de pocos micrómetros.

Un parámetro clave que encontrarás en la hoja de datos de un husillo de bolas es el **paso** (en milímetros por vuelta): define cuánto avanza linealmente la tuerca por cada vuelta completa del eje. Con un motor del que sabes exactamente cuánto ha girado (gracias al encoder), y un paso conocido, el cálculo de la posición lineal de la corredera se convierte en una simple proporción — la fórmula que, con toda probabilidad, ya encuentras encapsulada dentro de las funciones de *escalado* del eje en tu software de control de movimiento.

## Las guías lineales: la tarea silenciosa de mantener todo alineado

Un último componente, a menudo pasado por alto porque no "genera" movimiento sino que lo **acompaña**, son las guías lineales: pares de patines que se deslizan sobre raíles, sosteniendo la carga y obligándola a moverse exactamente a lo largo de la dirección deseada, sin desviaciones laterales o verticales. También aquí, la solución más extendida en aplicaciones de precisión usa la rodadura sobre bolas o rodillos encerrados en el patín, por el mismo motivo que el husillo de bolas: fricción mínima, desgaste mínimo, máxima repetibilidad.

¿Por qué es importante saberlo, aunque no sea "eléctrico" y aparentemente esté lejos de tu trabajo? Porque un eje servo que vibra, que no alcanza la posición requerida con la precisión esperada, o que absorbe una corriente anómala durante el movimiento, a veces no tiene nada malo en el software de control ni en el ajuste del regulador: el problema es una guía lineal sucia, desalineada o dañada, que introduce fricción extra o una restricción mecánica que el motor debe vencer de más. Saber que ese componente existe, y qué hace, te da un diagnóstico adicional a considerar antes de pasar horas revisando parámetros PID que, en realidad, ya eran correctos.

En el próximo artículo entramos en un mundo completamente distinto, que probablemente conoces todavía menos que el mecánico: la neumática, empezando por cómo se genera y se trata el aire comprimido que alimenta cada cilindro de la máquina.
