---
title: "Matrixmultiplikation in C++ optimieren — Teil 2: Tiling, Threads und eine ehrliche Überraschung"
description: "Teil 2 der praxisnahen Performance-Engineering-Reihe: warum das Aufteilen der Matrizen in kleine, cachegroße Tiles allein nicht automatisch etwas bringt, und wie ein einziges OpenMP-Pragma einen zweiten CPU-Kern ins Spiel bringt und uns auf einen gemessenen Faktor 4,42x treibt — alles verifiziert, alles reproduzierbar."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "openmp", "cache-tiling", "series-part-2"]
---


Wenn du [Teil 1](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-1/) dieser Serie gelesen hast, kennst du die Pointe bereits: dieselbe Matrixmultiplikation, derselbe Algorithmus, dieselbe Anzahl an Gleitkommaoperationen, ist allein durch das Vertauschen der Reihenfolge dreier `for`-Schleifen von 1,88 GFLOP/s auf 4,16 GFLOP/s gestiegen. Nichts Raffiniertes, kein neues Hardware-Feature, einfach nur Respekt davor, wie Speicher tatsächlich gelesen wird.

Falls du gerade neu einsteigst — willkommen, hier die Zwei-Satz-Version: Matrizen werden als ein einziges, flaches Array in row-major-Reihenfolge (zeilenweise) gespeichert, und dieses Array sequenziell zu lesen ist dramatisch billiger, als darin herumzuspringen, weil CPUs Speicher in Cache-Zeilen holen, nicht einzelne Zahlen. Genau diese Idee wird sich auch in diesem Artikel weiter auszahlen, nur in zwei neuen, weniger offensichtlichen Formen: wie du die Arbeit, die du mit jeder Cache-Zeile erledigst, *gruppierst*, und wie viele CPU-Kerne du dafür einsetzt.

Am Ende dieses Teils werden wir bei **4,42x** schneller liegen als am Ausgangspunkt von Teil 1 — aber der Weg dorthin ist keine gerade Linie, und der Umweg ist interessanter als das Ziel.

Den gesamten Quellcode findest du unter [diesem Link](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)

## Das Umsortieren war nicht das Ende der Geschichte

Stufe 2 hat die *Richtung* korrigiert, in der der Speicher durchlaufen wird. Ein anderes Problem hat sie nicht gelöst: Für jede einzelne Zeile der Ergebnismatrix C durchläuft die umsortierte Schleife weiterhin die *gesamte* Matrix B, von oben nach unten. B selbst ist für eine 1023×1023-Matrix aus `double` etwas über 8 MB groß. Das ist bei Weitem nicht klein genug, um in den L1-Cache (einige Dutzend KB) oder auch nur den L2-Cache (ein paar MB bei den meisten Consumer-CPUs) zu passen — also fängt die CPU bei jeder neuen Zeile von C im Grunde wieder bei null mit B an und verdrängt dabei die nützlichen Daten, die sie gerade erst für die vorherige Zeile geladen hatte.

Das ist eine andere Ausprägung derselben Grundidee aus Teil 1: räumliche Lokalität (Speicher der Reihe nach durchlaufen) ist nicht dasselbe wie zeitliche Lokalität (Daten wiederverwenden, die man gerade erst geladen hat, bevor sie verdrängt werden). Stufe 2 hat die erste perfekt gelöst. Die zweite lässt sie komplett liegen.

## Tiling: an einem Stück arbeiten, das klein genug ist, um liegen zu bleiben

Die Lösung hat einen Namen — **Tiling**, manchmal auch **Blocking** genannt — und die Idee dahinter ist, bevor man auch nur eine Zeile Code schreibt, fast schon peinlich einfach: statt ganze Zeilen und Spalten zu durchlaufen, zerlegt man die Matrizen in kleine quadratische **Tiles**, so bemessen, dass ein Tile bequem in den L1- oder L2-Cache passt, und erledigt für ein Tile alles, was sich erledigen lässt, bevor man zum nächsten übergeht.

![Links: Stufe 2 durchläuft bei jeder Zeile die gesamte Matrix B, weit größer als jede Cache-Ebene. Rechts: Stufe 3 arbeitet jeweils an einem BS×BS-Tile, klein genug, um in L1/L2 resident zu bleiben, während es über ein ganzes Band von Zeilen hinweg wiederverwendet wird.](img/06-tiling-concept.png)

Im Code bedeutet das: Die flache Zwei-Schleifen-Struktur aus Stufe 2 bekommt drei weitere Schleifen außen herum — eine pro Dimension, in Schritten von `BS` (block size, Blockgröße) statt in Schritten von 1:

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

Schau genau hin, und du wirst merken, dass die drei innersten Schleifen — über i, k, j — *zeichengenau* identisch mit Stufe 2 sind. An der Arithmetik hat sich nichts geändert. Die drei neuen äußeren Schleifen (`ii`, `kk`, `jj`) zerlegen das Problem lediglich in `BS`×`BS`-Unterblöcke und beschränken jeden Durchlauf der inneren Schleifen darauf, jeweils nur innerhalb eines Unterblocks zu arbeiten, sodass dieser Block von B klein genug bleibt, um beim nächsten Bedarf noch im Cache zu liegen. `std::min(ii + BS, N)` ist rein für die Korrektheit da — es begrenzt das letzte, unvollständige Tile, wenn N kein glattes Vielfaches von `BS` ist.

Kompiliert und ausgeführt genau wie vorher:

```bash
g++ -O2 -std=c++17 stage3_blocked.cpp -o stage3_blocked
./stage3_blocked 1023 64
```

```
Stage 3 - blocked ikj        N=1023   time=  0.7194 s      2.976 GFLOP/s
```

## Die Überraschung: langsamer als Stufe 2, nicht schneller

Hier ist es, schwarz auf weiß:

![Balkendiagramm: Stufe 1 bei 1,88 GFLOP/s, Stufe 2 bei 4,16 GFLOP/s, Stufe 3 (mit Tiling, single-threaded) fällt zurück auf 2,98 GFLOP/s — eine Anmerkung weist darauf hin, dass Tiling allein langsamer ist als Stufe 2.](img/07-stage1-2-3-benchmark.png)

Wäre dies ein ordentliches Tutorial, in dem jeder Schritt ein sauberer Gewinn ist, wäre diese Zahl still unter den Tisch gefallen, oder die Blockgröße wäre so lange herumgeschraubt worden, bis sie besser aussah. So wird es hier nicht laufen. **Ein gemessenes Ergebnis, das in die "falsche" Richtung geht, ist kein Fehler, den man verstecken muss — es ist eine Messung**, und gerade diese hier lehrt etwas, das ein monoton steigendes Diagramm nie zeigen würde.

Hier sind gleichzeitig zwei Dinge wahr, und es lohnt sich, sie getrennt zu betrachten.

Erstens hat Tiling reale, nicht verschwindende Kosten: sechs verschachtelte Schleifen statt drei, mit `std::min`, das an jeder Tile-Grenze neu berechnet wird. Dieser Mehraufwand lohnt sich nur, wenn die Cache-Misses, die er eliminiert, ihn mit deutlichem Abstand aufwiegen.

Zweitens — und das ist der maschinenspezifische Teil — beträgt der L2-Cache der für diese Messungen verwendeten CPU 2 MB pro Kern. Eine 1023×1023-Matrix aus `double` ist etwa 8 MB groß — klar, weit größer als L2, aber das *Zugriffsmuster innerhalb einer Zeile* von Stufe 2 war auf genau dieser Hardware von vornherein schon einigermaßen cache-freundlich, was weniger Spielraum lässt für das, was Tiling allein, single-threaded, noch herausholen kann. Auf einer CPU mit kleinerem Cache, oder bei einem größeren Problem, könnte sich genau dieser Vergleich problemlos umkehren. Das ist keine Randbemerkung, über die man hinweglesen sollte — es ist der ganze Grund, warum diese Serie darauf besteht, auf deiner eigenen Maschine zu *messen*, statt einer Faustregel zu vertrauen, die aus einem Blogartikel abgeschrieben wurde (diesen hier eingeschlossen).

**Warum also Stufe 3 überhaupt in der Serie behalten**, wenn sie für sich genommen gegen Stufe 2 verliert? Weil es beim Tiling hier gar nicht in erster Linie um Single-Thread-Geschwindigkeit geht — es geht darum, den nächsten Schritt vorzubereiten.

```{=comment}
(No-Op-Markierung für die zwei Dinge, die dieser Artikel NICHT behauptet: er behauptet nicht, dass Tiling wertlos ist, und er behauptet nicht, dass sich diese Zahl auf jede CPU verallgemeinern lässt.)
```

## Die Arbeit auf mehrere Kerne verteilen

Eine Berechnung, die in Tiles aufgeteilt ist, hat eine Eigenschaft, die die flache Schleife aus Stufe 2 nicht so sauber hatte: Sie ist bereits in unabhängige Häppchen zerlegt. Und unabhängige Arbeitshäppchen sind genau das, was man braucht, um sie an mehr als einen CPU-Kern zu übergeben.

**OpenMP** ist das Werkzeug dafür, und es ist keine Bibliothek, die man separat herunterlädt — es ist ein Compiler-Feature, aktiviert mit einem einzigen Flag (`-fopenmp` bei GCC und Clang), plus einem Standard-Header, `<omp.h>`, der mit dem Compiler selbst ausgeliefert wird. Benutzt wird es in der überwältigenden Mehrheit des echten Codes über **Pragma-Direktiven**: spezielle, kommentarähnliche Zeilen, die der Compiler angewiesen wird, als Anweisungen zu interpretieren statt sie zu ignorieren. Das hat einen schönen Nebeneffekt — Code, der OpenMP-Pragmas verwendet, kompiliert und läuft auch ohne `-fopenmp` weiterhin korrekt; das Pragma wird dann einfach ignoriert, und der Code läuft single-threaded.

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

Vergleiche das mit Stufe 3 oben: Es ist identisch, bis auf die Leerzeichen, bis auf eine einzige Zeile — `#pragma omp parallel for schedule(dynamic)`, direkt über der äußersten Schleife über `ii`. Diese eine Zeile sagt dem Compiler: Verteile die Iterationen dieser Schleife auf die verfügbaren Threads, und führe sie gleichzeitig statt nacheinander aus.

## Warum das tatsächlich sicher ist

Einfach ein `parallel for` auf eine Schleife zu klatschen, ohne es wirklich durchdacht zu haben, ist einer der häufigsten — und, weil intermittierend, gefährlichsten — Fehler in parallelem Code. Wenn zwei Threads ohne Koordination an dieselbe Speicherstelle schreiben, entsteht eine **race condition**, ein Bug, der sich oft nicht bei jedem Durchlauf zeigt, was ihn mit einem klassischen Debugger zum Elend macht.

![Matrix C aufgeteilt in Zeilenblöcke; abwechselnde Blöcke werden Thread 0 und Thread 1 zugeteilt. Bildunterschrift: Jeder Thread schreibt ausschließlich in seine eigenen Zeilen von C — A und B sind für alle nur lesbar — daher gibt es kein gemeinsames Schreiben, keine race condition, keine Locks nötig.](img/08-openmp-row-split.png)

Es lohnt sich, hier tatsächlich durchzugehen, *warum* das sicher ist, statt es einfach zu glauben. Die parallelisierte Schleife ist die über `ii` — Blöcke von *Zeilen* von C. Für welchen Wert von `ii` auch immer einem bestimmten Thread zugeteilt wird, schreibt dieser nur in die Zeilen von C zwischen `ii` und `i_max` — ein Zeilenbereich, den **kein anderer Thread jemals berührt**, weil jeder Wert von `ii` genau einem Thread zugewiesen ist. Es gibt kein gemeinsames Schreiben auf C, und damit ist darauf auch keine race condition möglich. A und B werden dagegen von jedem Thread nur *gelesen*, nie geschrieben — und gleichzeitige Lesezugriffe auf dieselben Daten sind immer sicher, ganz ohne Synchronisation.

Auch `schedule(dynamic)` verdient eine eigene Erwähnung: Es weist OpenMP an, Blöcke von Iterationen an Threads zu verteilen, sobald diese frei werden, statt die Arbeit von vornherein in gleich große, feste Häppchen aufzuteilen. Bei so gleichmäßig großen Blöcken wie diesen ist der praktische Unterschied zum standardmäßigen statischen Scheduling gering — aber `dynamic` ist generell die robustere Standardeinstellung, weil sie auch dann effizient bleibt, wenn die Last pro Block nicht perfekt gleichmäßig ist (zum Beispiel beim letzten, unvollständigen Tile, wenn N kein Vielfaches von `BS` ist).

## Die Messung

```bash
g++ -O2 -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_parallel
./stage4_parallel 1023 64
```

```
OpenMP active: 2 threads available.
Stage 4 - blocked parallel   N=1023   time=  0.2580 s      8.298 GFLOP/s
```

![Balkendiagramm, vier Stufen: 1,88, 4,16, 2,98, 8,30 GFLOP/s, wobei Stufe 4 als 4,42x schneller als Stufe 1 markiert ist.](img/09-stage1-4-benchmark.png)

Das ist eine Beschleunigung um **4,42x** gegenüber Stufe 1 — eine Zahl, die man sich genau ansehen sollte, denn auf den ersten Blick wirkt sie für eine Maschine mit nur 2 Kernen unverhältnismäßig hoch. Der ehrliche Vergleich läuft aber nicht gegen Stufe 1, sondern gegen Stufe 3 (0,719 s), denselben getilten Algorithmus auf einem einzigen Kern: `0.719 / 0.258 ≈ 2.79`, eine Beschleunigung etwas *über* dem theoretischen 2x, das man durch die Verdopplung der Kernzahl erwarten würde — vermutlich weil das Aufteilen der Arbeit auch den Druck auf den gemeinsamen L3-Cache verringert, ein sekundärer Effekt, der sich zum reinen Parallelismus addiert. Im Vergleich zu Stufe 2 (0,514 s), dem faireren Vergleich, ist die Zahl mit **1,99x** deutlich glaubwürdiger — praktisch genau die Verdopplung, die man von 2 Kernen erwarten würde, und die fairste Art zu beurteilen, was der Parallelismus selbst auf dieser konkreten Maschine tatsächlich gebracht hat.

**Eine ehrliche Einschränkung, klar ausgesprochen.** Diese Zahlen wurden auf einer Maschine mit nur 2 CPU-Kernen gemessen. Genau derselbe Code — keine einzige Zeile geändert — würde auf einer Maschine mit 8 oder 16 Kernen erheblich weiter skalieren, bis hin zu (ohne es dank Synchronisations-Overhead und gemeinsam genutzter Speicherbandbreite je ganz zu erreichen) einer zur Kernzahl proportionalen Beschleunigung. Wenn du mehr Kerne zur Verfügung hast, ist `benchmark_all` selbst noch einmal laufen zu lassen der direkteste Weg zu sehen, wie viel Spielraum der Parallelismus tatsächlich lässt — über das hinaus, was diese konkrete Maschine zeigen konnte.

## Was noch offen ist

Vier ehrliche Messpunkte bisher: 1,88 → 4,16 → 2,98 (der Umweg) → 8,30 GFLOP/s. Zwei große Hebel sind noch unangetastet, und Teil 3 nimmt sich beide vor:

- **Manuelle Vektorisierung mit AVX2 und FMA** — die innerste Schleife von Hand mit Vektorinstruktionen schreiben, die pro Instruktion vier `double`-Werte statt nur einen verarbeiten.
- **Der vollständige Vergleich, und zwei weitere ehrliche Überraschungen** — warum eine Matrixgröße, die zufällig eine Zweierpotenz ist, *dramatisch* langsamer laufen kann als eine benachbarte Größe, die es nicht ist, und warum es sich als fast genauso wichtig herausstellt, den Effekt aggressiver Compiler-Flags von dem algorithmischer Änderungen zu trennen, wie die Arbeit am Algorithmus selbst.

Der vollständige, kompilierbare Code für jede Stufe dieser Serie — einschließlich der noch kommenden — liegt in dem GitHub-Repository, das von Teil 1 aus verlinkt ist. Klone es, baue es mit CMake, und lass die Zahlen auf deiner eigenen Hardware laufen; deine werden anders ausfallen als diese hier, und genau darum geht es.
