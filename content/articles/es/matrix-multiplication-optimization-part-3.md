---
title: "Optimizar la multiplicación de matrices en C++ — Parte 3: vectorización, la revelación completa y dos sorpresas honestas"
description: "La parte final de la serie: escribir a mano instrucciones vectoriales AVX2 + FMA para comprimir cuatro multiplicaciones-sumas en una sola, la comparación completa de cinco etapas de 1.88 a 11.49 GFLOP/s, y dos sorpresas medidas — un tamaño de matriz potencia de dos que corre 6.5 veces más lento que sus vecinos, y una mejora de 2.12x que no cuesta ni una línea de código."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "avx2", "simd", "series-part-3"]
---

Si has seguido la serie desde la [Parte 1](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-1/), ponte cómodo, porque este es el capítulo donde todo se ata. Empezamos en 1.88 GFLOP/s con la multiplicación de matrices que enseña cualquier curso introductorio de programación — tres bucles anidados, nada sofisticado. La [Parte 2](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-2/) nos llevó por un desvío a través del tiling (que, medido con honestidad, empeoraba las cosas por sí solo) y luego hasta 8.30 GFLOP/s al poner a trabajar un segundo núcleo de la CPU con una sola directiva de OpenMP.

Hoy tiramos de una palanca más — enseñamos al bucle más interno a procesar cuatro números a la vez en lugar de uno — y luego nos sentamos a mirar todo el recorrido en conjunto. Por el camino aparecieron en las mediciones dos cosas que no deberían haber sorprendido a quien hubiera leído con atención la Parte 1, y sin embargo lo hicieron: un tamaño de matriz más lento que sus vecinos sin ninguna razón algorítmica, y una mejora de 2.12x que no requirió cambiar ni una sola línea de código fuente.

Puedes consultar todo el código fuente en este [enlace](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)
## Enseñarle a la CPU a hacer cuatro multiplicaciones-sumas de una vez

Cada versión vista hasta ahora, en su núcleo más interno, hace lo mismo: multiplica dos valores `double`, suma el resultado a un acumulador, un número a la vez. No porque la CPU solo sea capaz de manejar un número a la vez, sino porque nunca le pedimos que hiciera otra cosa. Las CPU modernas admiten instrucciones **SIMD** (Single Instruction, Multiple Data): una sola instrucción de máquina que aplica la misma operación a varios números simultáneamente. La extensión SIMD concreta que usaremos es **AVX2**, que opera sobre registros de 256 bits — lo bastante anchos como para contener cuatro valores `double` de 64 bits uno junto al otro. Junto a ella está **FMA** (Fused Multiply-Add), una instrucción que calcula `a * b + c` en un solo paso en lugar de dos por separado — que resulta ser *exactamente* la operación que se encuentra en el bucle más interno de cada etapa de esta serie. Es difícil imaginar una instrucción más hecha a medida para este problema.

![A la izquierda: la versión escalar procesa un double a la vez — ocho pasos separados para ocho elementos. A la derecha: AVX2 + FMA carga cuatro double en un único registro de 256 bits y realiza la multiplicación-suma de los cuatro en una sola instrucción — dos pasos en lugar de ocho.](img/10-avx2-simd.png)

¿De dónde salen estas instrucciones? No de una biblioteca externa — son **intrínsecas** (intrinsics), funciones de C++ declaradas en el header estándar `<immintrin.h>`, incluido en cualquier instalación moderna de GCC, Clang o MSVC. Son envoltorios finos que corresponden casi uno a uno con instrucciones de máquina individuales; el compilador las traduce directamente, sin prácticamente ninguno de los costes que llevaría una llamada de función normal.

```cpp
inline void multiply_blocked_avx2(const Matrix& A, const Matrix& B, Matrix& C, int N, int BS = 64) {
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
                        __m256d a_vec = _mm256_set1_pd(a_ik);

                        int j = jj;
                        for (; j + 4 <= j_max; j += 4) {
                            double* c_ptr = &C[i * N + j];
                            const double* b_ptr = &B[k * N + j];
                            __m256d c_vec = _mm256_loadu_pd(c_ptr);
                            __m256d b_vec = _mm256_loadu_pd(b_ptr);
                            c_vec = _mm256_fmadd_pd(a_vec, b_vec, c_vec);
                            _mm256_storeu_pd(c_ptr, c_vec);
                        }
                        for (; j < j_max; ++j) {
                            C[i * N + j] += a_ik * B[k * N + j];
                        }
                    }
                }
            }
        }
    }
}
```

Empecemos de fuera hacia dentro: la estructura de tiling y la directiva de OpenMP son **idénticas** a la Etapa 4. La vectorización toca solo el bucle más interno, el de `j` — así que esa es la parte que merece la pena leer línea por línea.

`__m256d` es el tipo de C++ que representa un registro AVX de 256 bits que contiene cuatro valores `double`. `_mm256_set1_pd(a_ik)` construye un registro con `a_ik` repetido cuatro veces — necesario porque `a_ik` es un escalar simple, constante durante todo el barrido sobre `j` (exactamente igual que en todas las etapas anteriores), pero las instrucciones AVX operan sobre registros completos, así que hay que "repartirlo" entre los cuatro carriles (lanes) antes de que pueda participar en una operación vectorial.

El bucle `for (; j + 4 <= j_max; j += 4)` avanza **de cuatro en cuatro** en lugar de uno: cada iteración procesa cuatro columnas contiguas de una sola vez. `_mm256_loadu_pd` carga cuatro valores `double` consecutivos de memoria en un registro AVX (la `u` significa *unaligned*, sin alinear — funciona incluso cuando la dirección de inicio no está alineada a 32 bytes, con un pequeño coste de rendimiento respecto a la variante alineada; una decisión que prioriza simplicidad y robustez frente a exprimir el último punto porcentual). `_mm256_fmadd_pd(a_vec, b_vec, c_vec)` calcula, en una sola instrucción, `a_vec * b_vec + c_vec` en los cuatro carriles a la vez — cuatro multiplicaciones en punto flotante y cuatro sumas en un único ciclo de reloj (en el caso ideal). `_mm256_storeu_pd` escribe el resultado de vuelta en memoria.

El segundo bucle, `for (; j < j_max; ++j)`, es la **cola escalar**: se encarga de lo que sobra cuando el ancho del tile actual (`j_max - jj`) no es un múltiplo exacto de cuatro. Con un tamaño de bloque de 64 (siempre múltiplo de 4), esta cola solo entra en acción con valores de N que no son a su vez múltiplos de `BS` — pero tiene que estar ahí de todos modos, para garantizar la corrección con cualquier N y BS que alguien use realmente.

## Un detalle de compilación que no se puede pasar por alto

A diferencia de OpenMP, donde olvidar `-fopenmp` sigue dando un programa correcto, silenciosamente serial, aquí olvidar los flags de AVX2 significa que el código **directamente no compila** — `<immintrin.h>` bloquea sus propias funciones detrás de macros ligadas a los flags del compilador:

```bash
g++ -O2 -std=c++17 -fopenmp -mavx2 -mfma stage5_avx2.cpp -o stage5_avx2
./stage5_avx2 1023 64
```

```
AVX2/FMA active at compile time.
Stage 5 - blocked AVX2+FMA   N=1023   time=  0.1863 s      11.493 GFLOP/s
```

Frente a la Etapa 4 (0.258 s), es **1.39 veces más rápido** — una ganancia real, pero claramente por debajo del 4x que uno podría esperar ingenuamente de "cuatro números a la vez en lugar de uno". Esa diferencia merece una explicación honesta y no un pase de puntillas: la vectorización solo acelera la aritmética pura. El tiempo total medido también incluye el tráfico de memoria (cargar cuatro valores `double` sigue sin ser una operación instantánea) y la sobrecarga de gestión de bloques que lo rodea. Un techo teórico de 4x se aplica estrictamente a la parte aritmética, no al panorama completo — vale la pena recordarlo cada vez que se estima una mejora sobre el papel antes de medirla de verdad.

## La revelación completa

Cinco etapas, una única configuración de medición coherente, la misma matriz N = 1023, el mismo hardware durante toda la serie:

| Etapa | Tiempo (s) | GFLOP/s | Mejora vs Etapa 1 |
|---|---|---|---|
| Etapa 1 — ijk ingenuo | 1.140 | 1.88 | 1.00x |
| Etapa 2 — ikj reordenado | 0.514 | 4.16 | 2.22x |
| Etapa 3 — ikj por bloques | 0.719 | 2.98 | 1.58x |
| Etapa 4 — por bloques + OpenMP | 0.258 | 8.30 | 4.42x |
| Etapa 5 — por bloques + OpenMP + AVX2/FMA | 0.186 | 11.49 | **6.12x** |

![Gráfico de barras de las cinco etapas, con los GFLOP/s subiendo de 1.88 a 11.49, anotado con 6.12x respecto a la Etapa 1.](img/11-full-comparison.png)

Antes de confiar más en esta tabla, aquí está la transparencia completa que merece cada uno de estos números: g++ 13.3.0 en Ubuntu, 2 núcleos de CPU disponibles, AVX2/FMA soportados por hardware, OpenMP funcionando, `-O2` en todas las etapas salvo donde se indique explícitamente lo contrario (la sección siguiente). **Un número de rendimiento sin el contexto de hardware y software en el que se midió no dice casi nada** — si vuelves a ejecutar esto tú mismo en otro hardware, espera números absolutos distintos; la forma relativa debería mantenerse, con la única excepción ya señalada honestamente en la Parte 2 para la Etapa 3.

De apenas menos de 2 GFLOP/s a casi 11.5 — un factor superior a seis — a través de cuatro cambios distintos y acumulativos, cada uno justificado por un principio subyacente diferente: orden de acceso a memoria (Etapa 2), working sets del tamaño de la caché (Etapa 3, desvío incluido), múltiples núcleos (Etapa 4), instrucciones vectoriales (Etapa 5). Ninguno de ellos tocó *qué* se calcula — solo *cómo*.

## Sorpresa 1: la trampa de la potencia de dos

Mientras armaba esta serie, apareció algo que no estaba planeado, pero es un ejemplo demasiado bueno del choque entre la teoría de caché de la Parte 1 y la práctica como para dejarlo fuera. Cronometrando la Etapa 1 — la versión ingenua pura — en tres tamaños de matriz consecutivos:

```
N = 1023 (not a power of two):  time = 1.309 s
N = 1024 (a power of two):      time = 8.488 s
N = 1025:                       time = 1.382 s
```

![Gráfico de barras: N=1023 en 1.31s, N=1024 con un pico a 8.49s, N=1025 de vuelta a 1.38s — anotado "potencia de dos ⇒ cache-set thrashing".](img/13-power-of-two-trap.png)

**N = 1024 tarda casi 6.5 veces más que N = 1023 o N = 1025**, a pesar de ser apenas un poco más grande — N = 1024 hace aproximadamente un 0.3% más de aritmética que N = 1023. Nada en la teoría de complejidad $O(N^3)$ predice un precipicio así; predice una curva suave. La explicación vuelve a estar relacionada con la caché, pero con un mecanismo más sutil que el de la Parte 1.

![A la izquierda: con N=1023, seis inicios de fila consecutivos caen repartidos entre seis cache sets distintos — comportamiento normal. A la derecha: con N=1024, los seis inicios de fila colisionan exactamente en el mismo cache set, que se desaloja y se recarga en cada acceso.](img/12-cache-conflict.png)

Las cachés reales están organizadas como estructuras **set-associative**: una dirección de memoria dada solo puede caer en un subconjunto específico de las líneas de caché disponibles, determinado por los bits de menor orden de su dirección. Cuando la longitud de una fila de la matriz es *exactamente* una potencia de dos (o un múltiplo grande de una), las direcciones que el bucle más interno de la Etapa 1 toca en secuencia — recordemos, `B[k*N + j]`, con `k` como el bucle que salta `N` elementos en cada paso — se mapean repetidamente sobre el **mismo subconjunto idéntico** de líneas de caché en lugar de repartirse. El resultado es un **cache conflict miss**: la caché todavía tiene espacio libre en otras zonas, pero ese subconjunto concreto se sobrescribe una y otra vez, como si toda la caché fuera mucho más pequeña de lo que realmente es.

Este efecto es específico del patrón de acceso con paso N (stride-N) de la Etapa 1 — precisamente el patrón de acceso de "peor caso" señalado en la Parte 1, vuelto patológico por una coincidencia de alineación. Las etapas posteriores, con acceso secuencial o por tiles, son mucho menos sensibles a esto. Aun así es una lección general útil: cuando una dimensión de matriz o array está bajo tu control y el patrón de acceso no es puramente secuencial, evitar potencias de dos exactas (o añadir un pequeño padding a la fila para romper la alineación) es una técnica real usada en código de alto rendimiento en producción, no solo una curiosidad de manual. Pruébalo tú mismo si quieres verlo de primera mano — `./stage1_naive 1023`, luego `1024`, luego `1025` — es uno de los experimentos más inmediatamente convincentes que ofrece toda esta serie.

## Sorpresa 2: aislar el efecto de los flags del compilador

Cada medición hasta ahora ha mantenido `-O2` constante, específicamente para que los cambios en el algoritmo no se mezclaran con cambios en el nivel de optimización del compilador. Pero, ¿cuánto queda sobre la mesa solo con los flags, con el código fuente completamente fijo? Tomemos el código de la Etapa 4 (por bloques + OpenMP) — **sin cambiar ni una sola línea** — y compilémoslo de dos formas distintas:

```bash
g++ -O2 -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_O2
g++ -O3 -march=native -ffast-math -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_O3native
```

`-O3` activa optimizaciones más agresivas que `-O2`, incluido el propio intento del compilador de vectorización automática. `-march=native` le dice al compilador que genere código específico para la CPU exacta sobre la que está compilando (incluyendo, si está disponible, el uso automático de AVX2 — sin necesidad de intrínsecas) en lugar de código genérico que corre en cualquier procesador x86 — una compensación real, ya que el binario resultante puede no funcionar en absoluto en otra máquina con un conjunto de instrucciones más antiguo. `-ffast-math` relaja algunas de las reglas estrictas de IEEE 754 para punto flotante — en concreto, permite al compilador reordenar sumas, algo que normalmente no puede hacer porque cambiaría el resultado en una cantidad mínima — que es exactamente la libertad extra que un bucle de acumulación como el nuestro necesita para una vectorización automática agresiva.

```
Stage 4 with -O2:                              0.3176 s     6.741 GFLOP/s
Stage 4 with -O3 -march=native -ffast-math:    0.1497 s    14.308 GFLOP/s
```

![Gráfico de barras: -O2 a 6.74 GFLOP/s frente a -O3 -march=native -ffast-math a 14.31 GFLOP/s sobre el mismo código fuente idéntico — anotado 2.12x, cero líneas cambiadas.](img/14-compiler-flags.png)

**2.12 veces más rápido, el mismo archivo fuente exacto.** Vale la pena ponerlo junto a todo lo demás de esta serie: reordenar los bucles (Parte 1) aportó un 2.22x. Solo los flags del compilador, sobre un bucle ya bien escrito, aportan otro 2.12x — un recordatorio que conviene tener presente antes de invertir tiempo en optimización manual: **comprobar que los flags del compilador realmente coinciden con el hardware de destino suele ser la mejora de rendimiento más barata disponible**, y pertenece al inicio del proceso, no como ocurrencia tardía una vez que el algoritmo ya se reescribió a mano.

No compilamos deliberadamente con `-O3 -march=native -ffast-math` desde la primerísima etapa en la Parte 1. Mezclar el efecto de los flags del compilador con el efecto de los cambios algorítmicos habría hecho imposible saber cuál de los dos era realmente responsable de una mejora dada — aislar una variable a la vez, aquí los flags frente a un código fuente fijo, es la misma disciplina de medición que toda esta serie ha intentado ejemplificar de principio a fin.

## Poniéndolo todo junto: un solo benchmark, un solo repositorio

Hasta ahora cada etapa ha vivido en su propio pequeño ejecutable — cómodo para seguir el proceso paso a paso, menos cómodo si simplemente quieres comparar las cinco con un único comando. Para eso está `benchmark_all.cpp` en el repositorio: construye un único par de matrices de entrada (misma semilla para cada versión, de modo que cada etapa se mide sobre datos idénticos), calcula una vez un resultado de referencia con la Etapa 1, y luego ejecuta y cronometra cada una de las demás versiones, verificando cada resultado frente a esa referencia con una comprobación de corrección `max_abs_diff` antes de confiar en ninguno de los números.

```bash
g++ -O2 -std=c++17 -fopenmp -mavx2 -mfma benchmark_all.cpp -o benchmark_all
./benchmark_all 1023 64
```

Imprime la misma tabla comparativa mostrada arriba — tiempo, GFLOP/s, mejora respecto a la Etapa 1, y el error máximo respecto a la referencia (del orden de $10^{-14}$ para cada etapa, exactamente lo que predice el redondeo en punto flotante) — y escribe junto a ella un archivo `benchmark_results.csv`, listo para la herramienta de gráficos que prefieras.

El código fuente completo de cada etapa de esta serie — `common.h`, `kernels.h`, los cinco archivos `stageN_*.cpp`, `benchmark_all.cpp`, un `CMakeLists.txt`, y un `build_and_run.sh` — vive en el repositorio de GitHub que acompaña la serie, enlazado desde la Parte 1. Clónalo, compílalo, y corre los números en tu propia máquina; CPU distinta, número de núcleos distinto, compilador distinto, números distintos — y verlo con tus propios ojos vale más que confiar en cualquier tabla de un post de blog, este incluido.

## Lo que queda pendiente

Ninguna serie técnica honesta termina con "y eso es todo". Algunas cosas se dejaron fuera deliberadamente, tanto por una cuestión de alcance como para señalar por dónde seguir. No tocamos el **algoritmo de Strassen** ni sus parientes, que reducen la complejidad asintótica *por debajo* de $O(N^3)$ cambiando el propio algoritmo, en lugar de optimizar la implementación de un algoritmo fijo como ha hecho toda esta serie. No exploramos los **algoritmos cache-oblivious**, que logran un buen comportamiento de caché mediante divide y vencerás recursivo en lugar de un tamaño de bloque elegido a mano como nuestro `BS` — un enfoque en teoría más elegante, ya que nunca necesita conocer de antemano el tamaño de caché de la CPU de destino. Y no hicimos benchmark contra una biblioteca BLAS optimizada profesionalmente (OpenBLAS, Intel MKL y similares) — sería honesto esperar que alguna de ellas siga superando de forma significativa incluso a la Etapa 5, al estar escritas por especialistas y ajustadas durante décadas en incontables arquitecturas. El objetivo de esta serie nunca fue competir con ese nivel de ingeniería — era entender, un paso medido a la vez, de dónde sale realmente ese tipo de rendimiento.

## Una última cosa

La lección más duradera aquí no es el número 6.12x — es el hábito que representa: medir antes de optimizar, medir de nuevo después de cada cambio, verificar la corrección en cada paso, y solo entonces sacar una conclusión. Ese hábito se aplica mucho más allá de la multiplicación de matrices — una consulta de base de datos lenta, un bucle de control que sigue fallando su tiempo de ciclo, un pipeline de visión que no logra seguir el ritmo de la línea de producción, todos recompensan exactamente la misma disciplina. El código cambia de un dominio a otro. El método — teoría para saber qué buscar, medición honesta para comprobarlo, corrección verificada en cada paso — no.

Gracias por quedarte hasta el final en las tres partes. Ve a medir algo.
