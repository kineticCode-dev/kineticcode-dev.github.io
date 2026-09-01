---
title: "Proyecto: benchmark mutex vs atomic, false sharing, y verificación con ThreadSanitizer"
description: "Multithreading en C++ con Qt — Módulo 5 — Proyecto"
---

Puedes encontrar todo el código fuente [aquì](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Proyecto: benchmark mutex vs atomic, false sharing, y verificación con ThreadSanitizer

A diferencia de los proyectos guiados de los módulos anteriores, hoy **no construimos una aplicación Qt Widgets**. Es una elección deliberada: el tema de este módulo —atómicos, memory model, cache— vive al nivel de la CPU y de la biblioteca estándar de C++, por debajo de cualquier framework que construyas encima. Construir el proyecto como un programa de consola con `std::thread`, `std::atomic` y `std::mutex` puros elimina cualquier distracción relacionada con Qt y te deja mirar directamente el mecanismo desnudo — exactamente como en el Proyecto A del Módulo 0, donde la elección de partir de `std::thread` puro estaba motivada por la misma necesidad de claridad.

**Requisitos**: un compilador C++20 (verificado con GCC 13.3.0), la biblioteca pthread enlazada en tiempo de ejecución (`-pthread` en Linux/macOS), CMake ≥ 3.16 (opcional pero cómodo), ninguna dependencia de Qt. Para la sección de ThreadSanitizer, un compilador GCC o Clang con `-fsanitize=thread` disponible.

Una nota honesta sobre el entorno en el que se escribió y midió este módulo: la máquina de desarrollo usada para compilar y cronometrar los números que leerás en breve expone **2 núcleos lógicos** (`std::thread::hardware_concurrency()` devuelve `2`) —probablemente menos núcleos de los disponibles en tu máquina de trabajo real. No cambia nada en la sustancia de lo que estás a punto de observar, pero verás que los números exactos oscilan más de lo que esperarías de una máquina física dedicada — un entorno virtualizado comparte los núcleos físicos subyacentes con otros procesos que no controlas. Es en sí misma una lección práctica de benchmarking: **mide siempre más de una vez**, y desconfía de un único número aislado tanto como desconfiarías de una sola muestra estadística.

## Paso 1 — El esqueleto del proyecto

El proyecto está compuesto por dos programas independientes, cada uno centrado en una sola demostración, más un `CMakeLists.txt` común:

```cmake
cmake_minimum_required(VERSION 3.16)
project(project_g_benchmark LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()
set(CMAKE_CXX_FLAGS_RELEASE "-O2")

find_package(Threads REQUIRED)

# Project G.1 -- mutex vs atomic under contention
add_executable(counter_benchmark counter_benchmark.cpp)
target_link_libraries(counter_benchmark PRIVATE Threads::Threads)

# Project G.2 -- false sharing and the alignas(64) fix
add_executable(false_sharing false_sharing.cpp)
target_link_libraries(false_sharing PRIVATE Threads::Threads)

# --------------------------------------------------------------------------
# Optional target with ThreadSanitizer enabled (see this module's articles).
# Usage: cmake -S . -B build_tsan -DCMAKE_BUILD_TYPE=Debug -DENABLE_TSAN=ON
# --------------------------------------------------------------------------
option(ENABLE_TSAN "Build with -fsanitize=thread" OFF)
if(ENABLE_TSAN)
    add_compile_options(-fsanitize=thread -g -O1)
    add_link_options(-fsanitize=thread)
endif()
```

Fíjate en el `-O2` explícito en `CMAKE_CXX_FLAGS_RELEASE`: para un benchmark de rendimiento, compilar sin optimizaciones (`-O0`, el valor por defecto si no especificas nada) produciría números carentes de sentido — un incremento no optimizado incluye overhead que ningún programa real, compilado para uso normal, arrastraría consigo. Medir sin optimizaciones activas es un error de método tan común como insidioso en este tipo de comparaciones.

## Paso 2 — El primer benchmark: mutex contra atomic bajo contención

Construyamos `counter_benchmark.cpp` por partes, empezando por la versión protegida con mutex — la que ya conoces del Módulo 2, aquí con `std::mutex` en lugar de `QMutex` porque estamos en territorio C++ puro:

```cpp
#include <atomic>
#include <chrono>
#include <cstdio>
#include <mutex>
#include <thread>
#include <vector>

static long long mutexCounter = 0;
static std::mutex counterMutex;

void incrementWithMutex(int incrementsPerThread) {
    for (int i = 0; i < incrementsPerThread; ++i) {
        std::lock_guard<std::mutex> lock(counterMutex);
        ++mutexCounter;
    }
}
```

Nada nuevo aquí respecto a lo que ya sabes: `std::lock_guard` es el equivalente estándar de `QMutexLocker`, mismo RAII, misma garantía de desbloqueo automático. Ahora la versión atómica, escrita deliberadamente al lado para la comparación:

```cpp
static std::atomic<long long> atomicCounter{0};

void incrementWithAtomic(int incrementsPerThread) {
    for (int i = 0; i < incrementsPerThread; ++i) {
        atomicCounter.fetch_add(1, std::memory_order_seq_cst);
    }
}
```

Uso deliberadamente `memory_order_seq_cst` de forma explícita (aunque es el valor por defecto, y podría omitirlo) para que resulte inmediatamente visible, al releer el código, qué garantía de ordenamiento estamos eligiendo — coherente con la recomendación del artículo anterior de no dejar la elección implícita en código que otros (incluido tú mismo, dentro de seis meses) tendrán que releer.

El motor del benchmark es una pequeña plantilla que acepta la función a cronometrar:

```cpp
template <typename Function>
double runBenchmark(Function work, int numThreads, int incrementsPerThread) {
    std::vector<std::thread> threads;
    threads.reserve(numThreads);

    auto start = std::chrono::steady_clock::now();
    for (int t = 0; t < numThreads; ++t) {
        threads.emplace_back(work, incrementsPerThread);
    }
    for (auto &th : threads) {
        th.join();
    }
    auto end = std::chrono::steady_clock::now();

    return std::chrono::duration<double, std::milli>(end - start).count();
}
```

Observa `std::chrono::steady_clock`, no `system_clock`: para medir un intervalo de tiempo transcurrido, `steady_clock` es la elección correcta porque está garantizada como monótona (nunca retrocede, a diferencia del reloj del sistema, que puede ser corregido por un servicio NTP justo mientras estás midiendo) — un detalle pequeño pero que, si se pasa por alto, puede producir benchmarks con números negativos absurdos en casos raros y poco afortunados.

Finalmente el `main()`, que dimensiona el número de hilos según la máquina real y verifica la corrección del resultado, no solo el tiempo:

```cpp
int main() {
    unsigned int hw = std::thread::hardware_concurrency();
    int numThreads = (hw >= 2) ? static_cast<int>(hw) : 4;
    const int incrementsPerThread = 5'000'000;
    const long long expected =
        static_cast<long long>(numThreads) * incrementsPerThread;

    double msMutex = runBenchmark(incrementWithMutex, numThreads,
                                   incrementsPerThread);
    bool okMutex = (mutexCounter == expected);
    std::printf("[mutex]  time: %8.2f ms   final counter: %lld   %s\n",
                msMutex, mutexCounter, okMutex ? "(correct)" : "(WRONG!)");

    double msAtomic = runBenchmark(incrementWithAtomic, numThreads,
                                    incrementsPerThread);
    bool okAtomic = (atomicCounter.load() == expected);
    std::printf("[atomic] time: %8.2f ms   final counter: %lld   %s\n",
                msAtomic, atomicCounter.load(),
                okAtomic ? "(correct)" : "(WRONG!)");

    if (msAtomic > 0.0) {
        std::printf("\nmutex/atomic ratio: %.2fx\n", msMutex / msAtomic);
    }
    return 0;
}
```

Verificar `counter == expected` no es un detalle decorativo: es la contraprueba de que ambas versiones son realmente correctas (ninguna actualización perdida), lo que hace significativa la comparación de tiempos — no tendría sentido presumir la velocidad de una versión que, de forma encubierta, también está perdiendo incrementos.

## Paso 3 — Compila y ejecuta el primer benchmark

```bash
g++ -std=c++20 -O2 -pthread counter_benchmark.cpp -o counter_benchmark
./counter_benchmark
```

Aquí está la salida real, medida en este curso (máquina de 2 núcleos lógicos, 5.000.000 de incrementos por hilo, es decir 10.000.000 en total):

```
=== Project G.1 - Benchmark mutex vs atomic ===
hardware_concurrency() detected: 2 -> using 2 threads
Increments per thread: 5000000 (expected total: 10000000)

[mutex]  time:   194.64 ms   final counter: 10000000   (correct)
[atomic] time:    66.01 ms   final counter: 10000000   (correct)

mutex/atomic ratio: 2.95x
```

Repitiendo la ejecución otras dos veces, para no fiarnos de una sola muestra:

```
[run 2] mutex: 198.76 ms   atomic: 66.57 ms   ratio: 2.99x
[run 3] mutex: 208.17 ms   atomic: 68.35 ms   ratio: 3.05x
```

El patrón es estable: la versión atómica corre **aproximadamente 3 veces más rápido** que la versión con mutex, en esta máquina, para esta carga de trabajo (un único incremento por operación — el caso más favorable posible para un atómico, y no es casualidad que el proyecto lo aísle así). La explicación es exactamente la del artículo anterior: cada `lock_guard` que entra en una sección crítica disputada por otro hilo corre el riesgo de requerir la intervención del planificador del sistema operativo, mientras que `fetch_add` sigue siendo una única instrucción de máquina bloqueada por el bus de memoria durante un puñado de ciclos de reloj — ningún planificador involucrado, ningún hilo puesto en pausa. Ambas versiones, nótese, resultan correctas: la ventaja del atómico aquí es puramente de rendimiento, no de corrección.

## Paso 4 — El segundo archivo: false sharing, primero sin cuidado

Pasemos a `false_sharing.cpp`. Primero el layout "ingenuo", dos contadores adyacentes en la misma struct:

```cpp
#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>

constexpr int ITERATIONS = 200'000'000;
constexpr std::size_t CACHE_LINE_SIZE = 64;

struct AdjacentCounters {
    std::atomic<int> a{0};
    std::atomic<int> b{0};
};
```

`sizeof(AdjacentCounters)` es 8 bytes — dos `int` de 4 bytes cada uno, uno junto al otro, bien dentro de una única línea de cache de 64 bytes, exactamente el escenario patológico descrito en el artículo anterior.

## Paso 5 — El layout correcto, con alignas(64)

```cpp
struct alignas(CACHE_LINE_SIZE) PaddedCounter {
    std::atomic<int> value{0};
    char padding[CACHE_LINE_SIZE - sizeof(std::atomic<int>)];
};

struct PaddedCounters {
    PaddedCounter a;
    PaddedCounter b;
};
```

`sizeof(PaddedCounter)` sube a 64 bytes — una línea de cache entera para un único `int` útil, el desperdicio explícito ya comentado— y `sizeof(PaddedCounters)` pasa por tanto a 128 bytes: dos líneas de cache separadas, garantizadas como tales por el alineamiento impuesto por `alignas`.

## Paso 6 — La prueba: dos hilos, dos contadores independientes, ambos layouts

```cpp
template <typename Layout>
double runTest(Layout &data) {
    auto start = std::chrono::steady_clock::now();

    std::thread t1([&] {
        for (int i = 0; i < ITERATIONS; ++i) {
            if constexpr (std::is_same_v<Layout, AdjacentCounters>) {
                data.a.fetch_add(1, std::memory_order_relaxed);
            } else {
                data.a.value.fetch_add(1, std::memory_order_relaxed);
            }
        }
    });
    std::thread t2([&] {
        for (int i = 0; i < ITERATIONS; ++i) {
            if constexpr (std::is_same_v<Layout, AdjacentCounters>) {
                data.b.fetch_add(1, std::memory_order_relaxed);
            } else {
                data.b.value.fetch_add(1, std::memory_order_relaxed);
            }
        }
    });

    t1.join();
    t2.join();

    auto end = std::chrono::steady_clock::now();
    return std::chrono::duration<double, std::milli>(end - start).count();
}
```

Aquí uso deliberadamente `memory_order_relaxed`, a diferencia del primer benchmark: cada hilo actualiza solo su propio contador, nunca necesita observar ni sincronizarse con el otro, así que no hay ninguna relación happens-before que establecer — es exactamente el caso de uso honesto de `relaxed` descrito en el artículo anterior, no un atajo arbitrario. `if constexpr` (C++17) selecciona en tiempo de compilación qué campo tocar según el tipo de `Layout`, de modo que la misma plantilla gestiona ambos experimentos sin duplicar la lógica del bucle.

## Paso 7 — Compila, ejecuta, y mira a la cache mentirte

```bash
g++ -std=c++20 -O2 -pthread false_sharing.cpp -o false_sharing
./false_sharing
```

Primera salida real medida:

```
=== Project G.2 - False sharing and the alignas(64) fix ===
Iterations per thread: 200000000
sizeof(AdjacentCounters) = 8 bytes
sizeof(PaddedCounter)    = 64 bytes
sizeof(PaddedCounters)   = 128 bytes

[adjacent, same cache line]       time:  5703.52 ms
[alignas(64), separate lines]     time:  1302.42 ms

Speedup from eliminating false sharing: 4.38x
```

Repitiendo la ejecución, por la razón ya comentada en el Setup:

```
[run 2] adjacent: 3667.79 ms   padded: 2648.09 ms   speedup: 1.39x
[run 3] adjacent: 4523.37 ms   padded: 1306.76 ms   speedup: 3.46x
```

Aquí la variabilidad entre ejecuciones es más marcada que la observada en el Paso 3 — de nuevo, la máquina virtualizada de 2 núcleos compartidos con otras cargas deja su huella. Pero fíjate en lo que **no** cambia nunca, en ninguna de las tres ejecuciones: la dirección del efecto. El layout con padding es siempre más rápido que el adyacente, jamás lo contrario, con una ganancia que va de un +39% a más de 4 veces según el ruido de fondo de esa ejecución en particular. Es exactamente el tipo de lectura honesta que exige un buen benchmark: el número exacto oscila con el entorno, pero el fenómeno físico que estás observando —la invalidación cruzada de la línea de cache compartida— es real y repetible, no un artefacto estadístico aislado.

## Paso 8 — ThreadSanitizer: verifica que ninguna de las dos versiones esconde una race

Porque "funcionó en mis pruebas" nunca basta en concurrencia: una data race puede permanecer invisible durante meses de pruebas en una máquina y aparecer el primer día en un hardware distinto, con un número de núcleos diferente, o simplemente con el sistema más cargado de lo habitual. **ThreadSanitizer** (TSan) es una herramienta de análisis dinámico integrada en GCC y Clang: instrumenta cada acceso a memoria durante la ejecución real del programa, registrando qué hilo leyó o escribió cada ubicación y con qué sincronización. Si detecta dos hilos que acceden a la misma ubicación, al menos uno de ellos en escritura, sin una relación de sincronización reconocida por el estándar C++ entre ambos accesos, lo señala de inmediato con la traza de pila de ambos.

Compilemos ambos programas con la instrumentación activa:

```bash
g++ -std=c++20 -O1 -g -fsanitize=thread -pthread \
    counter_benchmark.cpp -o counter_benchmark_tsan
g++ -std=c++20 -O1 -g -fsanitize=thread -pthread \
    false_sharing.cpp -o false_sharing_tsan
./counter_benchmark_tsan
./false_sharing_tsan
```

Nota el `-O1` en lugar de `-O2`: es una recomendación práctica al usar TSan — con optimizaciones más agresivas, algunas reordenaciones de instrucciones pueden hacer que las trazas de pila del sanitizer sean menos legibles, sin ganancia real (con este tamaño de programa, la ralentización del propio TSan domina de todos modos el tiempo total).

Resultado real, medido en este curso — **ningún warning de data race, en ninguno de los dos programas**:

```
=== Project G.1 - Benchmark mutex vs atomic ===
[mutex]  time:  2716.48 ms   final counter: 10000000   (correct)
[atomic] time:  1131.94 ms   final counter: 10000000   (correct)
mutex/atomic ratio: 2.40x
```

```
=== Project G.2 - False sharing and the alignas(64) fix ===
[adjacent, same cache line]       time:  9321.87 ms
[alignas(64), separate lines]     time:  4011.17 ms
Speedup from eliminating false sharing: 2.32x
```

Dos observaciones merecen la pena. La primera: la ralentización impuesta por TSan es enorme y bien visible al comparar estos tiempos con los de los Pasos 3 y 7 (el benchmark mutex/atomic pasa de ~200/~67 ms a ~2716/~1132 ms, un factor aproximadamente entre 14x y 17x) — y es precisamente la razón por la que TSan se usa en fase de verificación y no en el binario de producción. La segunda, más importante: **la ausencia de cualquier reporte de race es en sí misma un resultado**, no un "no pasó nada" carente de significado. Es la contraprueba experimental de que tanto `std::mutex` como `std::atomic`, usados tal como los has visto en este proyecto, protegen de verdad el estado compartido en cada ejecución observada por el sanitizer.

Para comparar, y para cerrar el círculo con el Módulo 0: si en este mismo proyecto el contador se hubiera incrementado sin ninguna sincronización —`++counter` directo, como en la versión "peligrosa" del Módulo 0—, TSan lo habría señalado de inmediato, con un reporte del tipo `WARNING: ThreadSanitizer: data race`, con la línea exacta y los dos hilos en conflicto. No lo hemos incluido en este proyecto precisamente porque ambos programas aquí son correctos por construcción — pero tenerlo presente sigue siendo la razón práctica para compilar siempre, como práctica habitual, una build con TSan activo sobre cualquier código concurrente nuevo que escribas, en lugar de esperar a que un bug de este tipo emerja por sí solo en un momento imprevisible.

## Lo que acabas de demostrarte a ti mismo

Has medido —no supuesto, medido con un cronómetro real— tres hechos que en la mayoría de los cursos de concurrencia quedan como afirmaciones abstractas: que un atómico puede ser sensiblemente más rápido que un mutex para una operación simple bajo contención; que dos variables lógicamente independientes pueden ralentizarse mutuamente de forma dramática solo por su posición física en memoria, y que `alignas(64)` es una cura concreta y verificable; y que ThreadSanitizer puede confirmar, con la misma seriedad con la que una prueba unitaria confirma la corrección lógica, que tu código concurrente está realmente libre de las races que en teoría podría esconder. Son tres herramientas que permanecerán en tu caja de herramientas mucho más allá de este curso — el primer paso, cada vez que optimizas código concurrente, es siempre el mismo: mide antes, mide después, y usa un sanitizer para verificar que la velocidad ganada no ha llegado al precio de la corrección.

---

*El código fuente completo de este proyecto está disponible en el repositorio que acompaña a este curso, en la carpeta `project-G-benchmark-mutex-atomic`.*
