---
title: "Optimizando la multiplicación de matrices en C++ — Parte 1: qué te da realmente el orden de los bucles"
description: "El primer artículo de una serie práctica sobre ingeniería de rendimiento: por qué la multiplicación de matrices es lenta por defecto, cómo funciona en realidad la memoria de un ordenador, y cómo reordenar tres bucles for por sí solo consigue una aceleración de 2.2x — medida, no supuesta."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "series-part-1"]
---

He estado repasando por mi cuenta el material de *Performance Engineering* del MIT, y en algún momento la teoría dejó de ser suficiente. Leer sobre jerarquías de caché y orden de bucles es una cosa; ver tu propio código pasar de poco menos de 2 GFLOP/s a más de 11 GFLOP/s en tu propia máquina, con exactamente el mismo algoritmo, es otra muy distinta. Así que elegí un problema — la multiplicación de matrices cuadradas en C++ — y decidí recorrer cada paso de optimización yo mismo, midiendo con honestidad en cada etapa, en lugar de fiarme de lo que alguien diga que "debería" ser más rápido.

Este es el primer artículo de esa serie. Cubre la primera parte del recorrido: por qué la multiplicación de matrices es lenta de entrada, cómo obtiene realmente los datos un procesador moderno, y la primera optimización real — que no toca el algoritmo en absoluto, no añade un solo hilo, y no usa ningún flag especial del compilador. Solo cambia el orden de tres bucles `for`. El resultado es una aceleración medida de 2.22x, y entender *por qué* funciona es la base de todo lo que viene después en esta serie.

Puedes consultar todo el código fuente en este [enlace](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)

## Un problema fácil de enunciar y caro de calcular

Multiplicar dos matrices cuadradas $A$ y $B$, ambas de lado $N$, produce una tercera matriz $C$ donde cada elemento $C_{ij}$ es la suma de los productos entre la fila $i$ de $A$ y la columna $j$ de $B$:

$$
C_{ij} = \sum_{k=0}^{N-1} A_{ik} \cdot B_{kj}
$$

La definición cabe en una línea. El coste no escala ni de lejos con la misma amabilidad: calcular cada elemento de $C$ requiere $N$ multiplicaciones y $N$ sumas, y hay $N^2$ elementos que calcular, así que el total es del orden de $2N^3$ operaciones en coma flotante. Duplica el lado de la matriz, y el trabajo no se duplica — se multiplica por ocho. Ese crecimiento cúbico es precisamente lo que convierte a la multiplicación de matrices en un banco de pruebas tan eficaz para el trabajo de rendimiento: una aceleración que parece insignificante en un problema pequeño, de juguete, se convierte en minutos u horas ahorradas en uno grande — una capa de red neuronal, una simulación física, un sistema de control en espacio de estados.

Tampoco es un ejercicio académico elegido por comodidad. La multiplicación de matrices es, literalmente, el núcleo computacional del entrenamiento y la ejecución de las redes neuronales modernas, de buena parte del cálculo científico, de los gráficos 3D, y de muchos algoritmos de control y estimación usados en automatización. Las bibliotecas que la implementan al extremo (BLAS, cuBLAS, MKL) están entre el software más intensamente optimizado que se ha escrito jamás — entender *por qué* necesitan existir, y qué hacen de forma distinta a una implementación ingenua, es la vía más directa hacia la ingeniería de rendimiento en general, no solo para matrices.

## Cómo vive realmente una matriz en memoria

Antes de hablar de velocidad, hay un detalle de implementación que hay que fijar con precisión, porque todo lo demás en esta serie depende de él: cómo está realmente organizada en memoria una matriz N×N. Un ordenador no tiene ninguna noción nativa de "cuadrícula 2D" — la memoria es, físicamente, una única secuencia lineal larga de bytes. Una matriz bidimensional tiene que ser *aplanada* sobre esa secuencia, y hay exactamente dos formas razonables de hacerlo: **row-major**, donde filas enteras se colocan una tras otra, o **column-major**, lo opuesto, donde columnas enteras se colocan una tras otra. C y C++ usan row-major para los arrays multidimensionales nativos; Fortran, y por extensión buena parte del software numérico histórico, usa column-major. Esto no es una nota de implementación menor — la elección determina, literalmente, qué orden de bucles será rápido y cuál será lento, como demuestra el resto de este artículo.

En el código de esta serie, una matriz N×N se representa como un único `std::vector<double>` de longitud $N^2$, en orden row-major: el elemento lógico $(i, j)$ vive en el índice `i * N + j`.

![Una matriz 3x3 aplanada en un único vector row-major, con la fórmula del índice i*N+j](img/01-row-major-flattening.png)

**¿Por qué no `std::vector<std::vector<double>>`?** Resulta tentador — un vector de vectores se lee de forma natural como "una matriz". El problema es que cada vector interno es su propia asignación de memoria dinámica, independiente. Las filas terminan dispersas por la memoria, sin ninguna garantía de estar cerca unas de otras; solo los elementos *dentro* de una fila tienen garantizado ser contiguos. Un único vector plano, indexado a mano, es la única forma de garantizar que toda la matriz sea un bloque contiguo — y como explica la siguiente sección, la contigüidad no es un lujo, es todo el juego.

![Un único vector contiguo frente a las asignaciones dispersas en el heap de un vector de vectores](img/02-vector-of-vectors-fragmentation.png)

## El procesador no es "una calculadora que ejecuta instrucciones" — es una jerarquía de memoria

Esta es la idea central de todo el artículo, así que merece la pena detenerse en ella. La forma intuitiva de imaginar un procesador — lee una instrucción, obtiene los datos que necesita, los procesa — es técnicamente correcta pero esconde un detalle enorme: **obtener un dato no tiene un coste fijo**. Una CPU moderna no lee los datos directamente de la RAM principal en cada acceso; la RAM es demasiado lenta en relación con la velocidad a la que la CPU podría, en principio, procesar datos. Si cada lectura tuviera que esperar a la RAM, la CPU pasaría la inmensa mayoría de su tiempo simplemente inactiva, esperando.

Por eso existe la **caché**: una serie de memorias progresivamente más pequeñas, progresivamente más cercanas (físicamente, en el chip), y por tanto progresivamente más rápidas. Un procesador moderno típico tiene tres niveles: **L1**, diminuta (32–64 KB por núcleo) pero casi tan rápida como los propios registros de la CPU; **L2**, más grande y todavía muy rápida (256 KB – 2 MB por núcleo); **L3**, compartida entre todos los núcleos del chip, mucho más grande (varios MB, a veces decenas) pero la más lenta de las tres. Solo si un dato no se encuentra en ninguno de estos tres niveles, el procesador tiene que ir a pedirlo a la RAM principal — una operación que, medida en ciclos de reloj, es drásticamente más lenta que un acierto en L1.

![Jerarquía de caché de la CPU desde los registros pasando por L1, L2, L3 hasta la RAM principal, con tamaños y latencias relativos](img/03-cache-hierarchy.png)

La caché no funciona copiando bytes individuales o números individuales — copia **líneas de caché** enteras, típicamente 64 bytes de una vez (ocho valores `double`). Esto funciona por una apuesta, llamada **principio de localidad**, que resulta ganar la inmensa mayoría de las veces en programas reales: si acabas de usar el dato en la dirección X, es muy probable que uses pronto también el dato en direcciones cercanas (localidad *espacial*), y es probable que reutilices el propio dato de la dirección X en breve (localidad *temporal*). Un programa que respeta esta apuesta — que recorre la memoria de forma secuencial y reutiliza lo que acaba de cargar — corre rápido. Un programa que la traiciona — que salta de un lado a otro de la memoria, tocando cada dato una vez y nunca más — paga el precio completo de un acceso a RAM, repetidamente, aunque desde el punto de vista del algoritmo esté haciendo "la misma cantidad de trabajo."

## Dónde muerde esto realmente en la multiplicación de matrices

Volvamos a la fórmula: $C_{ij} = \sum_k A_{ik} \cdot B_{kj}$. La forma "de libro de texto" de escribir esto en código usa tres bucles anidados sobre los índices i, j, k, en ese orden — porque es el orden en que la fórmula matemática se lee de forma natural de izquierda a derecha. El problema es que, con memoria row-major, el acceso `A[i * N + k]` se mueve de forma secuencial al variar k (localidad espacial perfecta), mientras que el acceso `B[k * N + j]`, con k como índice *más interno*, salta una fila entera — N elementos — en cada iteración. Eso es exactamente lo opuesto a la localidad espacial, y del peor lado posible: para N suficientemente grande, cada salto de N elementos cae fuera de la caché L1, y a menudo también fuera de la L2, forzando un acceso lento en cada multiplicación.

Este es precisamente el tipo de observación que esta serie está construida para hacer tangible en lugar de puramente teórica. El resto de este artículo escribe la versión "de libro de texto", la mide con honestidad, y luego la transforma — sin cambiar ni un solo resultado numérico que produce — simplemente cambiando el orden de los tres bucles. La mejora no será un redondeo de unos pocos puntos porcentuales: será un factor multiplicativo medible, obtenido sin escribir ni una línea de algoritmo "más inteligente" — solo escribiendo el mismo algoritmo exacto en el orden que respeta cómo funciona realmente la memoria.

## Una breve nota sobre la configuración del proyecto

Antes de escribir código sensible al rendimiento, hay una pequeña decisión arquitectónica que merece la pena declarar explícitamente en lugar de dejarla caer por costumbre: este proyecto es una **aplicación de consola en C++17 puro**, construida con **CMake**, **sin ninguna biblioteca numérica externa**. Nada de Eigen, nada de BLAS, nada que descargar y enlazar — el objetivo de esta serie es entender *de dónde* viene la velocidad, no delegarla en una biblioteca que ya resolvió el problema (aunque, para ser justos, en un proyecto de producción real una biblioteca BLAS bien optimizada casi siempre superará al código escrito a mano — más sobre esa comparación en una parte posterior). El C++ moderno también aporta beneficios reales, no solo cosméticos, frente al C clásico en este contexto: `std::vector` ofrece una gestión de memoria segura y automática, sin `malloc`/`free` manuales y sin riesgo de olvidar un `free` o leer memoria no inicializada, y las plantillas permiten que una única función de medición funcione, sin cambios, con cada versión del algoritmo que esta serie irá construyendo.

## Cómo medir el tiempo sin engañarte a ti mismo

Antes de escribir la primera versión real de la multiplicación, merece la pena construir las herramientas usadas para medirla — una elección de orden deliberada. Medir mal el rendimiento es fácil, y produce conclusiones equivocadas con exactamente la misma aparente seguridad que una medición correcta: un número en la pantalla siempre parece autorizado, incluso cuando el método que lo produjo está roto. Hay tres errores en particular lo bastante comunes como para merecer una mención explícita, antes incluso de mirar una sola línea del código real de multiplicación.

**Error uno: medir sin calentar la caché.** La primerísima ejecución de una función, sobre datos recién asignados, paga costes que las ejecuciones posteriores no pagan: las páginas de memoria recién asignadas puede que todavía no estén físicamente mapeadas por el sistema operativo (un *page fault*), y la caché todavía no contiene nada útil. Medir una única ejecución "en frío" también mide estos costes puntuales, no el rendimiento en régimen estacionario del algoritmo — que es casi siempre lo que realmente importa, porque refleja cómo se comporta el código cuando lleva un rato ejecutándose.

**Error dos: fiarse de una sola medición.** Cualquier máquina real ejecuta un sistema operativo que hace malabares con docenas de otros procesos, interrupciones de hardware, y una velocidad de reloj que puede variar dinámicamente por razones térmicas. Una sola ejecución puede, por pura casualidad, verse ralentizada por algo completamente ajeno al código que se está midiendo. El remedio más robusto no es la media aritmética (a la que un único valor atípico todavía puede distorsionar mucho), sino la **mediana**: el valor central de una serie de mediciones ordenada, que por construcción ignora los extremos.

**Error tres, el más traicionero: medir algo que no hace lo que crees que hace.** Un compilador moderno es agresivo eliminando código que, según su análisis, no tiene ningún efecto observable — si calculas un resultado y nunca lo usas, el compilador puede simplemente no calcularlo en absoluto, dejándote medir un tiempo "imposiblemente" rápido que no corresponde a ningún trabajo real. En esta serie el riesgo es bajo, porque cada versión escribe su resultado en una matriz que luego se compara explícitamente para verificar su corrección — un efecto observable que impide al compilador "hacer trampa" eliminando el cálculo.

Los tres acaban en una única cabecera compartida, `common.h`, incluida por cada etapa del proyecto:

```cpp
// High-resolution stopwatch based on <chrono>.
class Stopwatch {
public:
    void start() { t0_ = std::chrono::steady_clock::now(); }
    double stop_seconds() {
        auto t1 = std::chrono::steady_clock::now();
        return std::chrono::duration<double>(t1 - t0_).count();
    }
private:
    std::chrono::steady_clock::time_point t0_;
};

// Runs "func" repeatedly, discards the first run (warm-up), and returns
// the MEDIAN of the following runs' timings.
template <typename Func>
double median_timing_seconds(Func&& func, int repetitions = 5) {
    func();  // warm-up, discarded

    std::vector<double> times;
    times.reserve(repetitions);
    Stopwatch sw;
    for (int r = 0; r < repetitions; ++r) {
        sw.start();
        func();
        times.push_back(sw.stop_seconds());
    }
    std::sort(times.begin(), times.end());
    return times[times.size() / 2];
}
```

La medición usa `std::chrono::steady_clock`, no `std::chrono::system_clock`: la diferencia importa. `system_clock` representa el tiempo real de pared, y puede saltar — una sincronización NTP, un cambio manual del reloj — lo que haría poco fiables las mediciones de duración en casos raros pero reales. `steady_clock` está garantizado como monótono: solo avanza hacia adelante, a un ritmo constante, que es exactamente la propiedad necesaria para medir correctamente un intervalo de tiempo.

La otra pieza que merece la pena mostrar es cómo un tiempo medido en bruto se convierte en un número comparable entre distintos tamaños de problema: los **GFLOP/s**, miles de millones de operaciones en coma flotante por segundo. Como se estableció antes, una multiplicación N×N por N×N requiere en total $2N^3$ operaciones en coma flotante; dividiendo por el tiempo medido, y luego por mil millones, se obtiene una cifra de throughput que permite comparar N=200 con N=2000 en igualdad de condiciones.

```cpp
inline double gflops(int N, double seconds) {
    double flops = 2.0 * static_cast<double>(N) * N * N;
    return (flops / seconds) / 1e9;
}
```

## Etapa 1: la versión de libro de texto

Aquí está la primera versión — la ya anticipada arriba en teoría. Tres bucles anidados, en el orden en que la fórmula matemática se lee de forma más natural: i, luego j, luego k.

```cpp
inline void multiply_naive_ijk(const Matrix& A, const Matrix& B, Matrix& C, int N) {
    for (int i = 0; i < N; ++i) {
        for (int j = 0; j < N; ++j) {
            double sum = 0.0;
            for (int k = 0; k < N; ++k) {
                sum += A[i * N + k] * B[k * N + j];
            }
            C[i * N + j] = sum;
        }
    }
}
```

Una decisión de implementación pequeña pero deliberada: la suma se acumula en una variable local, `sum`, y se escribe en `C[i * N + j]` solo cuando termina el bucle k, en lugar de escribir directamente en `C[i*N+j] += ...` en cada iteración. `sum` casi con toda seguridad vive en un registro de la CPU durante toda la duración del bucle interno — el acceso más rápido posible, órdenes de magnitud más rápido incluso que un acierto en caché L1. Escribir repetidamente en memoria (incluso memoria cacheada) dentro del bucle más interno habría sido una pequeña herida autoinfligida y fácilmente evitable, que merece la pena descartar desde la primera versión.

Compilado con `g++ -O2 -std=c++17` y ejecutado con N = 1023 en la máquina de desarrollo usada para esta serie (una CPU Intel con 2 núcleos disponibles — la ficha completa de hardware y software llega junto con la tabla comparativa completa más adelante en la serie), el resultado es:

```
Stage 1 - naive ijk          N=1023   time=  1.1402 s      1.878 GFLOP/s
```

Poco más de un segundo. Guarda ese número en la cabeza — es la línea base con la que se compara cada etapa posterior de esta serie.

## Etapa 2: reordenando los bucles a (i, k, j)

Ahora cambia **solo el orden de los tres bucles**, de (i, j, k) a (i, k, j). Las matemáticas que se calculan son idénticas — la misma fórmula, $C_{ij} = \sum_k A_{ik} B_{kj}$ — solo cambia la secuencia en la que ocurren las operaciones individuales de multiplicar-y-sumar:

```cpp
inline void multiply_reordered_ikj(const Matrix& A, const Matrix& B, Matrix& C, int N) {
    std::fill(C.begin(), C.end(), 0.0);
    for (int i = 0; i < N; ++i) {
        for (int k = 0; k < N; ++k) {
            const double a_ik = A[i * N + k];
            for (int j = 0; j < N; ++j) {
                C[i * N + j] += a_ik * B[k * N + j];
            }
        }
    }
}
```

Dos diferencias respecto a la Etapa 1 merecen un comentario antes del punto principal. Primero, el resultado ya no se acumula en una única variable `sum`: ahora el bucle más interno recorre j, así que en cada iteración se actualiza un elemento *distinto* de C — ya no se puede mantener en un único registro local, así que hay que acumularlo directamente en `C[i*N+j]`. Por esta razón, ahora C necesita ponerse a cero explícitamente al principio (`std::fill`), algo que la Etapa 1 no necesitaba, ya que allí cada elemento se escribía exactamente una vez, no se acumulaba. Segundo, `a_ik` se extrae una sola vez por cada par (i, k), fuera del bucle j: es constante durante toda la duración de ese bucle interno, así que calcularlo una vez en lugar de N veces es una optimización pequeña y esencialmente gratuita.

Pero el cambio que realmente importa es el descrito arriba: ahora, con j como índice más interno, **tanto** `B[k*N + j]` **como** `C[i*N + j]` se recorren en secuencia, un elemento tras otro — exactamente como se sitúan en memoria row-major. Cada línea de caché cargada (64 bytes, ocho valores `double`) se aprovecha durante ocho iteraciones consecutivas del bucle, en lugar de solo una, como ocurría con el acceso a saltos sobre B en la Etapa 1.

![Comparación del patrón de acceso: la Etapa 1 salta por una columna de B con stride N, la Etapa 2 recorre una fila de B con stride 1](img/04-access-pattern-comparison.png)

```
Stage 2 - reordered ikj      N=1023   time=  0.5143 s      4.164 GFLOP/s
```

De 1.14 segundos a 0.51 segundos: más del doble, **2.22x más rápido**, obtenido sin cambiar el algoritmo, sin añadir paralelismo, sin tocar un solo flag del compilador — simplemente escribiendo los mismos tres bucles `for` en un orden distinto. Si hay exactamente una cosa que merece la pena recordar de todo este artículo, es esta: el orden en que recorres la memoria importa tanto como — a veces más que — el algoritmo que estás ejecutando.

![Gráfico de barras de GFLOP/s medidos, Etapa 1 frente a Etapa 2, N=1023](img/05-stage1-vs-stage2-benchmark.png)

**Comprobación de corrección, siempre.** Antes de fiarte de un número de rendimiento, verifica que el resultado sea realmente correcto: comparando la matriz C producida por la Etapa 2 con la producida por la Etapa 1, sobre la misma entrada, se obtiene una diferencia máxima de `3.55e-14` — atribuible por completo a que la suma en coma flotante no es perfectamente asociativa cuando las operaciones ocurren en un orden distinto, no a un error de lógica. Un error de ese orden de magnitud es la firma esperada e inofensiva de este fenómeno; un error muchos órdenes de magnitud mayor sería en cambio una señal de alarma de que algo está realmente roto en el algoritmo reescrito.

## Qué viene a continuación en esta serie

Reordenar tres bucles fue la primera palanca, y por sí sola vale exactamente un número honesto: 2.22x. Sin embargo, esto no es el final de la historia — la Etapa 2 todavía deja rendimiento real sobre la mesa, y las próximas partes de esta serie retoman exactamente donde esta se detiene:

- **Tiling (bloqueo)** — dividir las matrices en pequeños subbloques que quepan cómodamente en la caché L1/L2, para explotar la localidad *temporal* a una escala mayor, además de la localidad espacial que la Etapa 2 ya captura. Esta trae una sorpresa honesta en las mediciones: el tiling ingenuo, por sí solo, *no* supera a la Etapa 2 — y entender exactamente por qué es más instructivo que la propia técnica.
- **Paralelismo con OpenMP** — poner a trabajar más de un núcleo de la CPU, repartiendo el cálculo con tiling entre hilos con un único `#pragma`, sin escrituras compartidas y por tanto sin condiciones de carrera de las que preocuparse.
- **Vectorización manual con AVX2 y FMA** — escribir a mano el bucle más interno con instrucciones vectoriales que procesan cuatro valores `double` por instrucción en lugar de uno, para los lectores cuya CPU lo soporte (con un respaldo automático y correcto para quienes no).
- **La comparación completa, y dos sorpresas honestas más** — una comparación completa y metodológicamente transparente de las cinco etapas, incluyendo por qué un tamaño de matriz que resulta ser una potencia de dos puede ser drásticamente *más lento* que un tamaño vecino que no lo es, y por qué aislar el efecto de los flags de compilación agresivos del efecto de los cambios de algoritmo importa tanto como el propio trabajo sobre el algoritmo.
- **Envolviendo todo en un benchmark consolidado y un repositorio público** — un solo programa que ejecuta cada etapa, verifica la corrección automáticamente, y produce la tabla y el gráfico comparativos usados a lo largo de toda la serie, más una referencia a dónde retoman las ideas algorítmicas clásicas (el algoritmo de Strassen, los algoritmos cache-oblivious) justo donde esta serie práctica lo deja.

El código de este artículo — Etapa 1, Etapa 2, y las utilidades de medición compartidas, junto con las etapas todavía por venir — está en el repositorio de GitHub adjunto, listo para clonar, compilar con CMake y ejecutar en tu propia máquina. Tus propios números serán distintos de los medidos aquí — CPU distinta, número de núcleos distinto, compilador distinto — y ese es exactamente el objetivo de ejecutarlo tú mismo en lugar de dar por buenos estos números sin más.
