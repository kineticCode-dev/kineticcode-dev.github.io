---
title: "Optimizando la multiplicación de matrices en C++ — Parte 2: tiling, hilos y una sorpresa honesta"
description: "Parte 2 de la serie práctica sobre performance engineering: por qué dividir las matrices en pequeños tiles del tamaño de la caché no compensa automáticamente por sí sola, y cómo poner a trabajar un segundo núcleo de la CPU con un solo pragma de OpenMP nos lleva a un 4.42x medido — todo verificado, todo reproducible."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "openmp", "cache-tiling", "series-part-2"]
---


Si leíste la [Parte 1](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-1/) de esta serie, ya conoces el resumen hasta ahora: la misma multiplicación de matrices, exactamente igual, mismo algoritmo, mismo número de operaciones en punto flotante, pasó de 1.88 GFLOP/s a 4.16 GFLOP/s con solo intercambiar el orden de tres bucles `for`. Nada ingenioso, ninguna característica nueva de hardware, solo respetar cómo se lee realmente la memoria.

Si te unes ahora — bienvenido, y aquí va la versión de dos frases: las matrices se almacenan como un único array plano, en orden por filas (row-major), y leer ese array de forma secuencial es drásticamente más barato que saltar de un lado a otro, porque las CPU traen memoria en líneas de caché, no número por número. Esa misma idea va a seguir dando frutos también en este artículo, pero en dos formas nuevas y menos evidentes: cómo *agrupas* el trabajo que haces con cada línea de caché, y cuántos núcleos de CPU le dedicas.

Al final de esta parte estaremos **4.42x** más rápido que el punto de partida de la Parte 1 — pero el camino hasta ahí no es una línea recta, y el desvío es más interesante que el destino.

Puedes revisar todo el código fuente en este [enlace](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)

## Reordenar no fue el final de la historia

El Stage 2 arregló la *dirección* en la que se recorre la memoria. No arregló un problema distinto: para cada fila de la matriz de salida C, el bucle reordenado sigue barriendo la *totalidad* de la matriz B, de arriba a abajo. B, para una matriz 1023×1023 de `double`, pesa poco más de 8 MB. Eso está muy lejos de caber en la caché L1 (decenas de KB) o incluso en la L2 (un par de MB en la mayoría de las CPU de consumo) — así que en cada fila nueva de C, la CPU está, en la práctica, empezando de cero con B, desalojando cualquier dato útil que acabara de terminar de cargar para la fila anterior.

Esta es una variante distinta de la misma idea de fondo de la Parte 1: la localidad espacial (recorrer la memoria en orden) no es lo mismo que la localidad temporal (reutilizar datos que cargaste hace un momento, antes de que sean desalojados). El Stage 2 clavó la primera. Deja la segunda completamente sobre la mesa.

## Tiling: trabajar sobre un trozo lo bastante pequeño como para quedarse quieto

La solución tiene nombre — **tiling**, a veces llamado **blocking** — y la idea, antes de escribir código, es casi vergonzosamente simple: en lugar de barrer filas y columnas enteras, trocear las matrices en pequeños **tiles** cuadrados, dimensionados para que un tile quepa cómodamente en la caché L1 o L2, y terminar todo el trabajo posible con un tile antes de pasar al siguiente.

![Izquierda: el Stage 2 barre toda la matriz B en cada fila, mucho más grande que cualquier nivel de caché. Derecha: el Stage 3 trabaja un tile de BS×BS a la vez, lo bastante pequeño como para permanecer residente en L1/L2 mientras se reutiliza a lo largo de toda una banda de filas.](img/06-tiling-concept.png)

En el código, esto significa que la estructura plana de dos bucles del Stage 2 crece tres bucles más por fuera — uno por cada dimensión, recorrido en pasos de `BS` (block size) en lugar de pasos de 1:

```cpp
inline void multiply_blocked_ikj(const Matrix& A, const Matrix& B, Matrix& C, int N, int BS = 64) {
    std::fill(C.begin(), C.end(), 0.0);
    for (int ii = 0; ii < N; ii += BS) {
        const int i_max = std::min(ii + BS, N);
        for (int kk = 0; kk < N; kk += BS) {
            const int k_max = std::min(kk + BS, N);
            for (int jj = 0; jj < N; jj += BS) {
                const int j_max = std::min(jj + BS, N);
                for (int i = ii; i < i_max; ++i) {
                    for (int k = kk; k < k_max; ++k) {
                        const double a_ik = A[i * N + k];
                        for (int j = jj; j < j_max; ++j) {
                            C[i * N + j] += a_ik * B[k * N + j];
                        }
                    }
                }
            }
        }
    }
}
```

Mira con atención y notarás que los tres bucles más internos — sobre i, k, j — son *carácter por carácter* idénticos al Stage 2. La aritmética no cambió en nada. Los tres bucles nuevos externos (`ii`, `kk`, `jj`) simplemente recortan el problema en sub-bloques `BS`×`BS` y restringen cada pasada de los bucles internos a trabajar dentro de un sub-bloque a la vez, de modo que ese bloque de B se mantenga lo bastante pequeño como para seguir estando en caché la próxima vez que se necesite. `std::min(ii + BS, N)` está ahí puramente por corrección — recorta el último tile parcial cuando N no es un múltiplo exacto de `BS`.

Compilado y ejecutado igual que antes:

```bash
g++ -O2 -std=c++17 stage3_blocked.cpp -o stage3_blocked
./stage3_blocked 1023 64
```

```
Stage 3 - blocked ikj        N=1023   time=  0.7194 s      2.976 GFLOP/s
```

## La sorpresa: es más lento que el Stage 2, no más rápido

Ahí está, en blanco y negro:

![Gráfico de barras: Stage 1 en 1.88 GFLOP/s, Stage 2 en 4.16 GFLOP/s, Stage 3 (tiled, de un solo hilo) cayendo de vuelta a 2.98 GFLOP/s — con una anotación que señala que el tiling por sí solo es más lento que el Stage 2.](img/07-stage1-2-3-benchmark.png)

Si esto fuera un tutorial impecable donde cada paso es una victoria limpia, este número se habría omitido en silencio, o el tamaño del bloque se habría ajustado hasta que se viera mejor. No va a ser así. **Un resultado medido que va en la dirección "equivocada" no es un error que ocultar — es un dato**, y este en concreto enseña algo que un gráfico monótonamente creciente jamás enseñaría.

Aquí son ciertas dos cosas a la vez, y vale la pena separarlas.

Primero, el tiling tiene un costo real, no nulo: seis bucles anidados en lugar de tres, con `std::min` recalculado en cada límite de tile. Ese overhead solo vale la pena pagarlo si los cache misses que elimina lo superan con un margen sano.

Segundo — y esta es la parte específica de la máquina — la caché L2 de la CPU usada para estas mediciones es de 2 MB por núcleo. Una matriz 1023×1023 de `double` ocupa unos 8 MB — mucho más grande que la L2, sin duda, pero el *patrón de acceso dentro de una fila* del Stage 2 ya era razonablemente amigable con la caché de por sí en este hardware en concreto, dejando menos margen para que el tiling, por su cuenta, con un solo hilo, pudiera recuperar. En una CPU con una caché más pequeña, o en un problema más grande, esta misma comparación podría fácilmente invertirse. No es una advertencia para pasar de largo — es la razón entera por la que esta serie insiste en *medir*, en tu propia máquina, en lugar de confiar en una regla general copiada de una entrada de blog (incluida esta).

**¿Entonces por qué mantener el Stage 3 en la serie**, si pierde frente al Stage 2 por sí solo? Porque el tiling aquí no se trata realmente de velocidad de un solo hilo — se trata de preparar el siguiente movimiento.

```{=comment}
(marcador no-op para las dos cosas que este artículo NO afirma: no afirma que el tiling sea inútil, y no afirma que este número se generalice a todas las CPU.)
```

## Repartir el trabajo entre núcleos

Un cálculo tiled tiene una propiedad que el bucle plano del Stage 2 no tenía de forma tan clara: ya está troceado en fragmentos independientes. Y fragmentos de trabajo independientes son exactamente lo que hace falta para repartir entre más de un núcleo de CPU.

**OpenMP** es la herramienta para esto, y no es una librería que se descarga aparte — es una característica del compilador, activada con una sola flag (`-fopenmp` para GCC y Clang), más un header estándar, `<omp.h>`, que viene incluido con el propio compilador. La forma en que realmente se usa, en la inmensa mayoría del código real, es mediante **directivas pragma**: líneas parecidas a comentarios que se le indica al compilador interpretar como instrucciones en lugar de ignorar. Eso tiene un efecto colateral agradable — el código que usa pragmas de OpenMP sigue compilando y funcionando correctamente sin `-fopenmp`; el pragma simplemente se ignora y el código corre en un solo hilo.

```cpp
inline void multiply_blocked_parallel(const Matrix& A, const Matrix& B, Matrix& C, int N, int BS = 64) {
    std::fill(C.begin(), C.end(), 0.0);
    #pragma omp parallel for schedule(dynamic)
    for (int ii = 0; ii < N; ii += BS) {
        const int i_max = std::min(ii + BS, N);
        for (int kk = 0; kk < N; kk += BS) {
            const int k_max = std::min(kk + BS, N);
            for (int jj = 0; jj < N; jj += BS) {
                const int j_max = std::min(jj + BS, N);
                for (int i = ii; i < i_max; ++i) {
                    for (int k = kk; k < k_max; ++k) {
                        const double a_ik = A[i * N + k];
                        for (int j = jj; j < j_max; ++j) {
                            C[i * N + j] += a_ik * B[k * N + j];
                        }
                    }
                }
            }
        }
    }
}
```

Compáralo con el Stage 3 de arriba: es idéntico, hasta en los espacios en blanco, salvo por una línea — `#pragma omp parallel for schedule(dynamic)`, justo encima del bucle más externo sobre `ii`. Esa única línea le dice al compilador: divide las iteraciones de este bucle entre los hilos disponibles, y ejecútalas de forma concurrente en lugar de una tras otra.

## Por qué esto es realmente seguro

Colocar un `parallel for` en un bucle sin pensarlo bien es uno de los errores más comunes — y más peligrosos precisamente por ser intermitentes — en código paralelo. Si dos hilos escriben en la misma posición de memoria sin coordinarse, se produce una **race condition** (condición de carrera), un bug que a menudo no aparece en todas las ejecuciones, lo que lo convierte en un infierno para depurar con un depurador tradicional.

![Matriz C dividida en bloques de filas; bloques alternos se asignan al Thread 0 y al Thread 1. Pie de imagen: cada hilo solo escribe en sus propias filas de C — A y B son de solo lectura para todos — así que no hay escritura compartida, ninguna condición de carrera, no se necesitan locks.](img/08-openmp-row-split.png)

Aquí vale la pena recorrer de verdad *por qué* es seguro, en lugar de darlo por hecho. El bucle que se paraleliza es el de `ii` — bloques de *filas* de C. Para cualquier valor de `ii` que se le asigne a un hilo dado, ese hilo solo escribe en las filas de C entre `ii` e `i_max` — un rango de filas que **ningún otro hilo toca jamás**, porque cada valor de `ii` se asigna a exactamente un hilo. No hay escritura compartida sobre C, y por lo tanto no hay posible condición de carrera sobre ella. A y B, mientras tanto, solo son *leídas* por cada hilo, nunca escritas — y las lecturas concurrentes de los mismos datos siempre son seguras, sin necesidad de ninguna sincronización.

`schedule(dynamic)` también merece una mención aparte: le dice a OpenMP que reparta bloques de iteraciones entre los hilos a medida que quedan libres, en lugar de dividir el trabajo en fragmentos fijos e iguales de antemano. Con bloques de tamaño bastante uniforme como estos, la diferencia práctica respecto al scheduling estático por defecto es pequeña — pero `dynamic` es la opción por defecto más robusta en general, ya que sigue siendo eficiente aunque la carga de trabajo por bloque no sea perfectamente pareja (por ejemplo, el último tile parcial cuando N no es múltiplo de `BS`).

## Midiéndolo

```bash
g++ -O2 -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_parallel
./stage4_parallel 1023 64
```

```
OpenMP active: 2 threads available.
Stage 4 - blocked parallel   N=1023   time=  0.2580 s      8.298 GFLOP/s
```

![Gráfico de barras con cuatro stages: 1.88, 4.16, 2.98, 8.30 GFLOP/s, con el Stage 4 anotado como 4.42x más rápido que el Stage 1.](img/09-stage1-4-benchmark.png)

Eso es un speedup de **4.42x** respecto al Stage 1 — merece una lectura atenta, porque a primera vista parece desproporcionado para una máquina con solo 2 núcleos. La comparación honesta, sin embargo, no es contra el Stage 1 — es contra el Stage 3 (0.719 s), el mismo algoritmo tiled corriendo en un solo núcleo: `0.719 / 0.258 ≈ 2.79`, un speedup un poco *por encima* del 2x teórico que cabría esperar al duplicar el número de núcleos — probablemente porque repartir el trabajo también alivia la presión sobre la caché L3 compartida, un efecto secundario que se suma al paralelismo puro. Frente al Stage 2 (0.514 s), la comparación más justa entre iguales, el número es un mucho más creíble **1.99x** — casi exactamente la duplicación que cabría esperar de 2 núcleos, y la forma más justa de juzgar "cuánto nos dio realmente el paralelismo en sí" en esta máquina en concreto.

**Una limitación honesta, dicha sin rodeos.** Estos números se midieron en una máquina con solo 2 núcleos de CPU. El mismo código, exactamente igual — sin cambiar ni una línea — escalaría considerablemente más en una máquina con 8 o 16 núcleos, acercándose (sin llegar nunca del todo, por el overhead de sincronización y el ancho de banda de memoria compartida) a un speedup proporcional al número de núcleos. Si tienes más núcleos disponibles, volver a ejecutar `benchmark_all` por tu cuenta es la forma más directa de ver cuánto margen deja realmente el paralelismo sobre la mesa, más allá de lo que esta máquina en concreto pudo mostrar.

## Lo que todavía queda pendiente

Cuatro datos honestos hasta ahora: 1.88 → 4.16 → 2.98 (el desvío) → 8.30 GFLOP/s. Todavía quedan dos grandes palancas sin tocar, y la Parte 3 recoge ambas:

- **Vectorización manual con AVX2 y FMA** — escribir a mano el bucle más interno con instrucciones vectoriales que procesan cuatro valores `double` por instrucción en lugar de uno.
- **La comparación completa, y dos sorpresas honestas más** — por qué un tamaño de matriz que resulta ser una potencia de dos puede correr *dramáticamente* más lento que un tamaño vecino que no lo es, y por qué aislar el efecto de las flags de compilación agresivas del efecto de los cambios algorítmicos termina importando casi tanto como el propio trabajo sobre el algoritmo.

El código completo y compilable de cada stage de esta serie — incluidos los que todavía están por llegar — vive en el repositorio de GitHub enlazado desde la Parte 1. Clónalo, compílalo con CMake, y corre los números en tu propio hardware; los tuyos serán distintos a estos, y precisamente ese es el punto.
