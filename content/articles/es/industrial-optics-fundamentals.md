---
title: "Fundamentos de óptica industrial: lo que realmente importa al elegir un objetivo"
description: "Una guía práctica sobre la óptica en visión artificial — campo de visión, distancia de trabajo, profundidad de campo, distancia focal, monturas, número F y los compromisos que deciden si un sistema de inspección realmente funciona."
date: "2026-08-18"
category: "automazione"
tags: ["machine-vision", "optics", "vision-systems", "fundamentals"]
---

## Qué hace realmente un sistema óptico industrial

Un objetivo tiene una única tarea: recoger la luz que rebota en un objeto y reconstruir su imagen sobre un sensor — normalmente un CCD o un CMOS, las dos tecnologías detrás de todo sensor de cámara digital. Tu propio ojo hace lo mismo: la córnea y el cristalino desvían la luz entrante hacia la retina, y es precisamente esa desviación la que te permite reconstruir una imagen. Una cámara industrial hace exactamente lo mismo, con un objetivo en lugar de una córnea y un sensor en lugar de una retina.

En un laboratorio o en un proyecto personal, un encuadre "suficientemente bueno" está bien. En un sistema de inspección industrial no lo está. Si estás comprobando si una pieza mecánica está dentro de tolerancia, o si una etiqueta se imprimió correctamente, necesitas saber exactamente qué tamaño tendrá el objeto en el sensor, qué nitidez necesita y en qué punto exacto del espacio debe situarse para que el sistema funcione. Por eso un puñado de parámetros, tomados en conjunto, describen por completo el comportamiento de un sistema óptico.

## Los parámetros que definen un sistema óptico

- **Campo de visión (FoV)** — el área total que enmarca el objetivo. Si necesitas inspeccionar un objeto de 5 cm, tu FoV tiene que ser de al menos 5 cm.
- **Distancia de trabajo (WD)** — la distancia entre el objeto y el objetivo a la que el objeto queda perfectamente enfocado. No es una distancia arbitraria: la fija el objetivo y su configuración.
- **Profundidad de campo (DoF)** — el rango, por delante y por detrás del plano de enfoque perfecto, dentro del cual el objeto sigue viéndose "aceptablemente" nítido. Es uno de los parámetros más importantes en la práctica.
- **Tamaño del sensor** — el tamaño físico del sensor, en milímetros, obtenido multiplicando el tamaño del píxel (típicamente unos pocos micrómetros) por el número de píxeles.
- **Aumento** — la relación entre el tamaño de la imagen en el sensor y el tamaño real del objeto. Por debajo de 1, el sensor ve menos detalle que la escena real; por encima de 1, está efectivamente ampliando un detalle.
- **Resolución** — la distancia mínima entre dos puntos que el sistema todavía puede distinguir como dos puntos separados, en lugar de una única mancha borrosa. Depende de la combinación de objetivo y sensor, no de uno solo por separado.

Ninguno de estos seis parámetros es independiente. Están vinculados por relaciones precisas, y cambiar uno modifica automáticamente los demás: acerca el objeto al objetivo, y el campo de visión se reduce, el aumento sube y la profundidad de campo baja. Diseñar un sistema óptico significa conocer estas relaciones lo bastante bien como para equilibrarlas de forma deliberada, no por ensayo y error.

## La ecuación de la lente delgada

Para que las matemáticas sean manejables, la óptica básica se apoya en dos simplificaciones:

- **Aproximación paraxial** — solo se consideran los rayos que entran en el objetivo formando un ángulo pequeño con el eje óptico (la línea imaginaria que pasa por el centro del sistema). Los rayos que inciden en los bordes con ángulos pronunciados se ignoran, lo que mantiene la geometría lineal.
- **Aproximación de lente delgada** — el grosor físico de la lente se considera despreciable, de modo que la lente se modela como un único plano en lugar de como un objeto sólido.

Con estas dos simplificaciones se obtiene la ecuación sobre la que se construye todo lo demás en este artículo:

```
1/s' - 1/s = 1/f
```

donde `s` es la posición del objeto respecto al objetivo (negativa por convención, ya que el objeto se sitúa "antes" del objetivo en la dirección de propagación de la luz), `s'` es la posición de la imagen (positiva), y `f` es la distancia focal del objetivo.

Otros dos términos que conviene tener bien diferenciados, porque aparecen constantemente en las hojas de datos de los objetivos: la **distancia de trabajo** es la distancia entre el objeto y la parte frontal del objetivo, mientras que la **back focal distance** (distancia focal posterior) es la distancia entre la parte posterior del objetivo y el sensor. Están en lados opuestos del objetivo — no hay que confundirlas.

## Distancia focal

Los rayos que entran en un objetivo convergen hacia un único punto tras ser desviados por el vidrio. La distancia entre el objetivo y ese punto es la distancia focal. En una lente convergente (positiva), los rayos realmente se encuentran en un foco real. En una lente divergente (negativa), los rayos se separan después de la lente, así que no existe un foco real — solo uno virtual, el punto del que los rayos parecen provenir si se prolongan hacia atrás.

![Lente convergente que forma un foco real, lente divergente que forma un foco virtual](./img/focal-length.png)

Todo objetivo usado en visión artificial es, en conjunto, un sistema positivo (convergente): la luz siempre tiene que converger sobre el plano del sensor, o no se forma ninguna imagen. Un objetivo puede contener internamente tanto elementos positivos como negativos para corregir aberraciones ópticas, pero el conjunto en su totalidad siempre es convergente.

La distancia focal y el campo de visión se mueven en direcciones opuestas: cuanto más larga es la focal, más estrecho es el campo de visión. Es exactamente lo que ocurre cuando haces zoom con una cámara — focal más larga, menos escena en el encuadre.

Hay una excepción importante: cuando el objeto se sitúa a una distancia menor de aproximadamente 10 veces la distancia focal, las ecuaciones estándar de la lente delgada dejan de ser precisas. Esto se llama **modo macro**, y requiere objetivos diseñados específicamente para trabajar a corta distancia.

## Aumento y campo de visión

Formalmente, el aumento es:

```
M = h' / h
```

donde `h'` es el tamaño de la imagen en el sensor y `h` es el tamaño real del objeto. Un objeto de 10 mm que produce una imagen de 5 mm en el sensor da M = 0.5.

Una fórmula relacionada vincula directamente la distancia de trabajo con la distancia focal y el aumento:

```
s = f(M - 1) / M
```

Conociendo la distancia focal de un objetivo y el aumento que necesitas, esta fórmula te dice exactamente dónde colocar el objeto — es el cálculo que se hace al dimensionar una estación de control de calidad: conoces el tamaño de la pieza, conoces el tamaño de tu sensor, calculas el aumento que necesitas, y de ahí obtienes la distancia de trabajo requerida.

También existe una convención de nomenclatura que conviene conocer, porque te dice de un vistazo para qué está pensado un objetivo:

- **Los objetivos macro y telecéntricos** están diseñados para trabajar a distancias comparables a su propia distancia focal ("conjugados finitos"), y se clasifican y venden según el aumento — "0.5X", "1X", "2X".
- **Los objetivos de focal fija** están diseñados para distancias de trabajo mucho mayores que su distancia focal ("conjugados infinitos" — piensa en los rayos paralelos de la luz solar), y se clasifican y venden según la distancia focal — "8mm", "25mm", "50mm".

Si un objetivo aparece listado como "2X" en lugar de "50mm", ya sabes a qué familia pertenece: construido para trabajar de cerca, sobre detalles pequeños. Un objetivo "25mm" pertenece a la segunda familia: construido para trabajar a distancia, como un objetivo fotográfico normal.

## Monturas y distancia focal de brida

Antes de seguir avanzando en la óptica, hay una cuestión mecánica igual de importante: ¿cómo se fija físicamente un objetivo a una cámara? La distancia entre la brida de montaje y el sensor — la **distancia focal de brida** (flange focal distance) — interviene en todos los cálculos ópticos anteriores. Si se calcula mal, la ecuación de la lente delgada deja de coincidir con la realidad: la imagen no quedará enfocada donde debería.

| Montura | Distancia focal de brida | Notas |
|---|---|---|
| C-mount | 17.526 mm | La montura más común en cámaras industriales. Diámetro de 1 pulgada, 32 hilos por pulgada. |
| CS-mount | 12.526 mm | 5 mm más corta que el C-mount. Un objetivo C-mount en una cámara CS-mount (o al revés) coloca el sensor a la distancia incorrecta y la imagen no quedará enfocada. |
| F-mount | Bayoneta (insertar y girar) | Desarrollada por Nikon, se usa en sensores más grandes. A diferencia de las demás, en esta montura la back focal distance no es ajustable. |
| Montura Mxx (p. ej. M42, M72) | Variable | Una familia de monturas roscadas definidas por diámetro, paso de rosca y distancia focal de brida — usada en sensores incluso más grandes que el F-mount. |

Al elegir un objetivo para una cámara específica, la primera pregunta mecánica es siempre "¿qué montura usa mi cámara?" — si te equivocas de montura, o no puedes fijar físicamente el objetivo, o lo fijas a la distancia incorrecta y nada de lo que venga después importa.

Incluso con una montura correctamente emparejada, las cámaras reales rara vez alcanzan exactamente la distancia focal de brida nominal — el vidrio de protección que cubre el sensor tiene su propio grosor, y la luz que lo atraviesa desplaza ligeramente el punto de enfoque efectivo. Por eso los fabricantes de objetivos venden **kits de shims**: espaciadores finos que se usan, sobre todo con objetivos telecéntricos, para ajustar con precisión la distancia real a su valor óptimo. No es un detalle menor — en un objetivo telecéntrico, un error de unas pocas décimas de milímetro en la back focal distance puede cambiar de forma perceptible el aumento medido, lo cual importa muchísimo si el objetivo se usa para medición dimensional y no solo para "ver" la pieza.

## Formatos de sensor

Hay dos tablas de referencia que aparecen constantemente al especificar un sistema de visión: una para los sensores **line scan** (que capturan la imagen una fila de píxeles a la vez — típicos de las líneas de producción donde el objeto se mueve bajo la cámara), y otra para los sensores **area scan** (el tipo más habitual, que captura una imagen completa de una sola vez, como una cámara normal).

**Sensores line scan (longitud en píxeles de una sola fila)**

| Resolución × tamaño de píxel | Longitud del sensor |
|---|---|
| 2048 px × 10 µm | 20.5 mm |
| 2048 px × 14 µm | 28.6 mm |
| 4096 px × 7 µm | 28.6 mm |
| 4096 px × 10 µm | 41 mm |
| 6144 px × 7 µm | 43 mm |
| 8192 px × 7 µm | 57.3 mm |
| 12288 px × 5 µm | 62 mm |

**Sensores area scan (formatos estándar)**

| Formato | Ancho | Alto | Diagonal |
|---|---|---|---|
| 1/3″ | 4.8 mm | 3.6 mm | 6.000 mm |
| 1/2.5″ | 5.76 mm | 4.29 mm | 7.182 mm |
| 1/2″ | 6.4 mm | 4.8 mm | 8.000 mm |
| 1/1.8″ | 7.176 mm | 5.319 mm | 8.933 mm |
| 2/3″ | 8.8 mm | 6.6 mm | 11.000 mm |
| 1″ | 12.8 mm | 9.6 mm | 16.000 mm |
| 4/3″ | 18.8 mm | 13.5 mm | 22.500 mm |
| Full frame 35 mm | 36.0 mm | 24.0 mm | 43.300 mm |

Vale la pena señalarlo, porque confunde a casi todo el que empieza: estas etiquetas en "pulgadas" son históricas, no físicas. Un sensor de "1/3 de pulgada" tiene una diagonal de 6 mm, no de 8.47 mm como sugeriría un cálculo literal de un tercio de pulgada. La denominación se remonta a las cámaras de tubo de vacío de los años 50, donde el *diámetro exterior del tubo de vidrio* era, aproximadamente, de una pulgada — mientras que el área útil sensible a la luz era mucho más pequeña que el propio tubo. Cuando llegaron los sensores CCD de estado sólido en los años 80 y 90, los fabricantes mantuvieron la denominación en "pulgadas" por compatibilidad comercial, aunque ya no corresponda directamente a ninguna dimensión física. Nunca deduzcas el tamaño real de un sensor a partir de su etiqueta en pulgadas mediante cálculo directo — comprueba siempre los valores en milímetros de la hoja de datos.

También conviene saber que dos cámaras con el mismo "formato" nominal pueden tener sensores sensiblemente distintos, porque la relación ancho-alto puede variar entre modelos. Al elegir un objetivo para una cámara específica, comprueba las dimensiones reales del sensor en milímetros — nunca te fíes solo del formato nominal.

## Apertura (número F) y profundidad de campo

Esta es la parte más densa del tema, y también la más práctica: cuán "abierto" o "cerrado" está un objetivo, y qué cambia con eso.

### El número F

La apertura de un objetivo — lo grande que es el "agujero" por el que pasa la luz, exactamente igual que la pupila de tu ojo al dilatarse o contraerse — se expresa como número F, definido en condiciones estándar como:

```
F/# = f / d
```

donde `d` es el diámetro de la apertura y `f` es la distancia focal. Al principio resulta contraintuitivo: un número F **más alto** significa una apertura **más pequeña**, porque `d` está en el denominador. F/16 es una apertura mucho más pequeña que F/2.

Los valores estándar que aparecen en todo objetivo son F/1.0, F/1.4, F/2, F/2.8, F/4, F/5.6, F/8, F/11, F/16, F/22. Cada paso hacia arriba (apertura más pequeña) **reduce a la mitad** la cantidad de luz que entra en el objetivo.

![Tamaño de la apertura disminuyendo de F/2 a F/8 a F/16](./img/aperture-fnumber.png)

Para objetivos macro o telecéntricos (la familia de conjugados finitos descrita más arriba), se usa una variante corregida, el **número F de trabajo**:

```
wF/# = (1 + M) × F/#
```

La corrección tiene en cuenta que, cuando el objeto está cerca (como ocurre con estos objetivos), el propio aumento cambia cuán "cerrada" se comporta efectivamente la apertura.

### Profundidad de campo

Ahora ya se puede definir la profundidad de campo con precisión: es el rango entre el punto más cercano y el más lejano en el que un objeto todavía se ve aceptablemente enfocado.

Hay un matiz en el que vale la pena detenerse: físicamente existe un único plano, en el espacio del objeto, perfectamente conjugado con el plano del sensor — un único plano que produce una imagen matemáticamente perfecta. Todo lo demás que llamamos "profundidad de campo" es en realidad una cuestión de *aceptabilidad*, no de perfección: cuánto desenfoque cuenta como "todavía aceptable" depende por completo de la aplicación. Un control dimensional de precisión (medir una pieza con una tolerancia de una centésima de milímetro) exige muchísima más nitidez que una inspección visual genérica (solo comprobar que una etiqueta está presente y es legible).

![La profundidad de campo como la zona alrededor de un único plano perfectamente enfocado](./img/depth-of-field.png)

Una fórmula práctica para estimar la profundidad de campo:

```
DoF [mm] = wF/# × p[µm] × k / M²
```

donde `p` es el tamaño del píxel del sensor en micrómetros, `M` es el aumento del objetivo, y `k` es un factor adimensional que depende de la aplicación — típicamente **0.008** para aplicaciones de medición dimensional (donde la nitidez es lo que más importa) y **0.015** para aplicaciones de inspección de defectos (donde se acepta algo más de tolerancia).

**Ejemplo resuelto.** Aumento del objetivo M = 0.25X, número F de trabajo wF/# = 8, tamaño de píxel del sensor p = 5.5 µm, aplicación de inspección de defectos, así que k = 0.015.

1. M² = 0.25 × 0.25 = 0.0625
2. numerador: wF/# × p × k = 8 × 5.5 × 0.015 = 0.66
3. DoF = 0.66 / 0.0625 = 10.56 mm ≈ **10.5 mm**

Una breve nota honesta sobre las unidades: el tamaño de píxel en esa fórmula está en micrómetros, mientras que el resultado se expresa directamente en milímetros — un salto de tres órdenes de magnitud que la fórmula no explicita. En la práctica, la constante `k` casi con toda seguridad incorpora tanto un factor de conversión dimensional como un criterio empírico de desenfoque aceptable, calibrado a partir de pruebas reales más que derivado de primeros principios. Eso no hace que la fórmula esté mal — los números cuadran — pero conviene saber que es un atajo de ingeniería, no una derivación desde primeros principios, para que no intentes rederivarla desde cero y pienses que te has equivocado cuando tus propios cálculos no la reproducen de forma limpia.

Sobre qué número F elegir: F/8 es un punto óptimo habitual. Las aperturas más pequeñas (números F más altos, como F/16 o F/22) empiezan a sufrir **difracción** — un efecto de óptica ondulatoria por el que la luz se dispersa cuando la apertura se vuelve muy pequeña, lo que paradójicamente perjudica la nitidez aunque la profundidad de campo siga aumentando. Las aperturas más grandes (números F más bajos, como F/1.4 o F/2) son más propensas a **aberraciones ópticas y distorsión**, imperfecciones inherentes a cualquier diseño óptico que se vuelven más visibles al usar la apertura completa.

Merece la pena interiorizar el compromiso de fondo: una apertura pequeña (número F alto) necesita más luz pero ofrece más profundidad de campo y menos aberraciones; una apertura grande (número F bajo) necesita menos luz pero ofrece menos profundidad de campo y más aberraciones/distorsión. No existe una apertura universalmente "correcta" — F/8 es un valor por defecto razonable, pero la elección adecuada siempre depende de cuánta luz tienes realmente disponible y cuánta profundidad de campo necesita la aplicación en relación con la nitidez máxima.

## Otros cuatro términos que conviene conocer

Hay un puñado de conceptos que se mencionan constantemente al hablar de óptica industrial sin que siempre se expliquen del todo:

- **MTF (Modulation Transfer Function, función de transferencia de modulación)** — la manera estándar de medir objetivamente cuán "nítido" es un objetivo, a distintos niveles de detalle. En lugar de decir en términos genéricos que un objetivo es "nítido", la MTF indica numéricamente qué tan bien reproduce el sistema el contraste entre líneas cada vez más finas — es la herramienta que los fabricantes usan realmente para comparar la calidad de los objetivos con rigor.
- **Telecentricidad** — un objetivo normal ("entocéntrico") hace que los objetos se vean más pequeños a medida que se alejan, exactamente igual que la percepción de perspectiva humana. Un objetivo **telecéntrico** está diseñado específicamente para eliminar este efecto dentro de un determinado rango de distancia: un objeto mide lo mismo en la imagen sin importar exactamente en qué punto de la profundidad de campo se encuentre. Por eso los objetivos telecéntricos son la opción estándar para medición dimensional de precisión, donde un pequeño error de posicionamiento no debe traducirse en un error de medida.
- **Ópticas pericéntricas** — una tercera familia menos habitual, diseñada para captar las superficies internas de un objeto hueco (el interior de un tubo, por ejemplo) desde una vista ligeramente angulada en lugar de frontal.
- **Distorsión** — una deformación geométrica de la imagen respecto a la realidad: las líneas rectas de la escena real aparecen curvadas en la imagen (distorsión de barril, que curva hacia fuera, y distorsión de cojín, que curva hacia dentro). Es un defecto que importa en aplicaciones de medición y, cuando es necesario, se corrige por software, porque afecta directamente a la precisión de cualquier medida dimensional tomada a partir de la imagen.

## Cómo encaja todo

1. La **distancia focal (f)**, junto con la distancia del objeto, determina dónde se forma la imagen (la ecuación de la lente delgada) y cuán grande es el **campo de visión (FoV)**.
2. La relación entre el tamaño de la imagen y el tamaño real del objeto define el **aumento (M)**, que a su vez determina la **distancia de trabajo (WD)** que necesita un objetivo dado.
3. El **diámetro de la apertura**, en relación con la distancia focal, da el **número F** — que controla tanto cuánta luz entra como, junto con el aumento y el tamaño de píxel, cuán grande es la **profundidad de campo (DoF)**.
4. Todo esto tiene que encajar con la mecánica: la **montura** y la **back focal distance** correcta determinan si el plano donde la imagen "debería" formarse coincide realmente con el plano físico del sensor.
5. Por último, que todo esto se traduzca en una imagen realmente útil también depende de la **resolución, la MTF, la telecentricidad y la distorsión** — factores que van más allá de los parámetros básicos pero que importan igual de mucho en un sistema real.

Si solo tuvieras que elegir dos hilos para profundizar, serían la telecentricidad y la MTF. Son los conceptos que más a menudo se mencionan solo de pasada, y sin embargo son centrales en cualquier aplicación industrial real que implique medición o control de calidad — entenderlos bien es lo que hace que una hoja de datos de un objetivo resulte realmente legible.
