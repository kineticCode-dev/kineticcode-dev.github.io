---
title: "Matrixmultiplikation in C++ optimieren — Teil 3: Vektorisierung, die große Enthüllung und zwei ehrliche Überraschungen"
description: "Der letzte Teil der Serie: Wir schreiben AVX2- + FMA-Vektorinstruktionen von Hand, um vier Multiplikations-Additionen in eine einzige zu quetschen, vergleichen alle fünf Stufen von 1,88 bis 11,49 GFLOP/s im direkten Vergleich – und stoßen dabei auf zwei gemessene Überraschungen: eine Matrixgröße mit Zweierpotenz, die 6,5-mal langsamer läuft als ihre Nachbarn, und eine Beschleunigung um 2,12x, die keine einzige Zeile Code kostet."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "avx2", "simd", "series-part-3"]
---

Wer diese Serie seit [Teil 1](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-1/) verfolgt, sollte sich jetzt einen Stuhl heranziehen, denn hier läuft alles zusammen. Wir sind bei 1.88 GFLOP/s gestartet, mit der Matrixmultiplikation, die jeder Einführungskurs in Informatik lehrt – drei verschachtelte Schleifen, nichts Ausgefallenes. [Teil 2](https://kineticcode-dev.github.io/astro-pulsar/blog/matrix-multiplication-optimization-part-2/) hat uns über einen Umweg durch das Blocking geführt (das, ehrlich gemessen, die Sache für sich genommen sogar *schlechter* gemacht hat) und uns dann auf 8.30 GFLOP/s gebracht, sobald wir mit einem einzigen OpenMP-Pragma einen zweiten CPU-Kern ins Spiel gebracht haben.

Heute drehen wir an einem letzten Hebel – wir bringen der innersten Schleife bei, vier Zahlen auf einmal zu verarbeiten statt einer – und lehnen uns dann zurück, um die gesamte Reise im Ganzen zu betrachten. Dabei tauchten zwei Dinge in den Messungen auf, die eigentlich niemanden hätten überraschen dürfen, der Teil 1 aufmerksam gelesen hat, und die trotzdem überraschten: eine Matrixgröße, die ohne jeden algorithmischen Grund langsamer ist als ihre Nachbarn, und eine Beschleunigung um 2,12x, für die exakt null Zeilen Quellcode geändert werden mussten.

Den gesamten Quellcode findet ihr unter diesem [Link](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)
## Der CPU beibringen, vier Multiplikations-Additionen auf einmal zu erledigen

Jede bisherige Version tut im innersten Kern im Grunde dasselbe: zwei `double`-Werte multiplizieren, das Ergebnis auf einen Akkumulator addieren, eine Zahl nach der anderen. Das liegt nicht daran, dass die CPU nur eine Zahl auf einmal verarbeiten könnte – sondern daran, dass wir sie nie um etwas anderes gebeten haben. Moderne CPUs unterstützen **SIMD**-Instruktionen (Single Instruction, Multiple Data): eine einzige Maschineninstruktion, die dieselbe Operation gleichzeitig auf mehrere Zahlen anwendet. Die konkrete SIMD-Erweiterung, die wir hier verwenden, heißt **AVX2** und arbeitet mit 256-Bit-Registern – breit genug, um vier 64-Bit-`double`-Werte nebeneinander unterzubringen. Dazu kommt **FMA** (Fused Multiply-Add), eine Instruktion, die `a * b + c` in einem einzigen Schritt berechnet statt in zwei getrennten – was zufällig *exakt* die Operation ist, die im Zentrum der innersten Schleife jeder Stufe dieser Serie steckt. Schwer, sich eine Instruktion vorzustellen, die passgenauer für dieses Problem geschnitten wäre.

![Links: Die skalare Version verarbeitet einen Double nach dem anderen – acht einzelne Schritte für acht Elemente. Rechts: AVX2 + FMA lädt vier Doubles in ein 256-Bit-Register und führt die Multiplikations-Addition für alle vier in einer einzigen Instruktion aus – zwei Schritte statt acht.](img/10-avx2-simd.png)

Woher kommen diese Instruktionen? Nicht aus einer externen Bibliothek – es sind **Intrinsics**, C++-Funktionen, die im Standard-Header `<immintrin.h>` deklariert sind, der mit jeder modernen Installation von GCC, Clang oder MSVC mitgeliefert wird. Es sind dünne Hüllen, die fast eins zu eins einzelnen Maschineninstruktionen entsprechen; der Compiler übersetzt sie direkt, praktisch ohne den Overhead, den ein normaler Funktionsaufruf mit sich bringen würde.

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

Gehen wir von außen nach innen vor: Die Blockstruktur und das OpenMP-Pragma sind **identisch** mit Stufe 4. Die Vektorisierung betrifft nur die innerste Schleife, die über `j` – die lohnt es sich also, Zeile für Zeile zu lesen.

`__m256d` ist der C++-Typ, der ein 256-Bit-AVX-Register mit vier `double`-Werten repräsentiert. `_mm256_set1_pd(a_ik)` baut ein Register, in dem `a_ik` viermal wiederholt vorliegt – nötig, weil `a_ik` ein einfacher Skalar ist, konstant über den gesamten Durchlauf über `j` (genau wie in jeder vorherigen Stufe), AVX-Instruktionen aber auf vollständigen Registern arbeiten, weshalb der Wert erst auf alle vier Lanes „verteilt“ werden muss, bevor er an einer Vektoroperation teilnehmen kann.

Die Schleife `for (; j + 4 <= j_max; j += 4)` rückt **vier auf einmal** vor statt eins nach dem anderen: Jede Iteration verarbeitet vier zusammenhängende Spalten in einem Rutsch. `_mm256_loadu_pd` lädt vier aufeinanderfolgende `double`-Werte aus dem Speicher in ein AVX-Register (das `u` steht für *unaligned*, unausgerichtet – es funktioniert auch, wenn die Startadresse nicht 32-Byte-ausgerichtet ist, zu einem kleinen Performance-Preis gegenüber der ausgerichteten Variante; eine bewusste Entscheidung für Einfachheit und Robustheit statt für das letzte Prozent Leistung). `_mm256_fmadd_pd(a_vec, b_vec, c_vec)` berechnet in einer einzigen Instruktion `a_vec * b_vec + c_vec` über alle vier Lanes gleichzeitig – vier Gleitkommamultiplikationen und vier Additionen in einem (im Idealfall) einzigen Taktzyklus. `_mm256_storeu_pd` schreibt das Ergebnis zurück.

Die zweite Schleife, `for (; j < j_max; ++j)`, ist der **skalare Rest**: Sie behandelt das, was übrig bleibt, wenn die Breite der aktuellen Kachel (`j_max - jj`) kein exaktes Vielfaches von vier ist. Bei einer Blockgröße von 64 (immer ein Vielfaches von 4) greift dieser Rest nur bei N-Werten, die selbst kein Vielfaches von `BS` sind – aber er muss trotzdem vorhanden sein, damit die Korrektheit für jedes N und jedes BS gewährleistet ist, das jemand tatsächlich einsetzt.

## Ein Kompilierungsdetail, das man nicht überspringen kann

Anders als bei OpenMP, wo ein vergessenes `-fopenmp` immer noch ein korrektes, still und leise serielles Programm ergibt, führt ein vergessenes AVX2-Flag hier dazu, dass der Code **überhaupt nicht kompiliert** – `<immintrin.h>` sperrt seine eigenen Funktionen hinter Makros, die an die Compiler-Flags gekoppelt sind:

```bash
g++ -O2 -std=c++17 -fopenmp -mavx2 -mfma stage5_avx2.cpp -o stage5_avx2
./stage5_avx2 1023 64
```

```
AVX2/FMA active at compile time.
Stage 5 - blocked AVX2+FMA   N=1023   time=  0.1863 s      11.493 GFLOP/s
```

Gegenüber Stufe 4 (0.258 s) ist das **1.39x schneller** – ein realer Gewinn, aber deutlich unter den 4x, die man naiv von „vier Zahlen auf einmal statt einer“ erwarten könnte. Diese Lücke verdient eine ehrliche Erklärung statt eines stillschweigenden Übergehens: Die Vektorisierung beschleunigt nur die reine Arithmetik. Die gesamte Laufzeit umfasst auch den Speicherverkehr (immer noch vier `double`-Werte pro Ladevorgang, keine augenblickliche Operation) und den Verwaltungsaufwand rund um die Blöcke. Eine theoretische 4x-Obergrenze gilt strikt für den arithmetischen Anteil, nicht für das Gesamtbild – gut zu merken, immer wenn eine Beschleunigung auf dem Papier geschätzt wird, bevor sie real gemessen wurde.

## Die große Enthüllung

Fünf Stufen, ein durchgängig konsistenter Messaufbau, dieselbe N = 1023-Matrix, dieselbe Hardware über die gesamte Serie hinweg:

| Stage | Time (s) | GFLOP/s | Speedup vs Stage 1 |
|---|---|---|---|
| Stage 1 — naive ijk | 1.140 | 1.88 | 1.00x |
| Stage 2 — reordered ikj | 0.514 | 4.16 | 2.22x |
| Stage 3 — blocked ikj | 0.719 | 2.98 | 1.58x |
| Stage 4 — blocked + OpenMP | 0.258 | 8.30 | 4.42x |
| Stage 5 — blocked + OpenMP + AVX2/FMA | 0.186 | 11.49 | **6.12x** |

![Balkendiagramm aller fünf Stufen, GFLOP/s steigt von 1,88 auf 11,49, mit der Annotation 6,12x gegenüber Stufe 1.](img/11-full-comparison.png)

Bevor man dieser Tabelle noch weiter vertraut, hier die vollständige Offenlegung, die jede dieser Zahlen verdient: g++ 13.3.0 unter Ubuntu, 2 verfügbare CPU-Kerne, AVX2/FMA hardwareseitig unterstützt, OpenMP funktionsfähig, `-O2` für jede Stufe, sofern nicht ausdrücklich anders angegeben (der nächste Abschnitt). **Eine Performance-Zahl ohne den Hardware- und Software-Kontext, in dem sie gemessen wurde, sagt fast nichts aus** – wer das selbst auf anderer Hardware nachvollzieht, sollte andere absolute Zahlen erwarten; die relative Form sollte sich halten, mit der einen Ausnahme, die schon in Teil 2 ehrlich für Stufe 3 markiert wurde.

Von knapp unter 2 GFLOP/s auf fast 11,5 – ein Faktor über sechs – durch vier eigenständige, sich kumulierende Änderungen, jede durch ein anderes zugrunde liegendes Prinzip begründet: Speicherzugriffsreihenfolge (Stufe 2), cachegroße Arbeitsmengen (Stufe 3, Umweg inklusive), mehrere Kerne (Stufe 4), Vektorinstruktionen (Stufe 5). Keine davon hat angerührt, *was* berechnet wird – nur *wie*.

## Überraschung 1: die Zweierpotenz-Falle

Beim Zusammenstellen dieser Serie tauchte etwas auf, das nicht geplant war – und es ist ein zu gutes Beispiel dafür, wie die Cache-Theorie aus Teil 1 auf die Praxis prallt, um es wegzulassen. Beim Messen von Stufe 1 – der schlichten naiven Version – auf drei direkt benachbarten Matrixgrößen:

```
N = 1023 (not a power of two):  time = 1.309 s
N = 1024 (a power of two):      time = 8.488 s
N = 1025:                       time = 1.382 s
```

![Balkendiagramm: N=1023 bei 1,31s, N=1024 schnellt auf 8,49s hoch, N=1025 fällt wieder auf 1,38s – annotiert mit „Zweierpotenz ⇒ Cache-Set-Konflikte“.](img/13-power-of-two-trap.png)

**N = 1024 braucht fast 6,5-mal so lange wie N = 1023 oder N = 1025**, obwohl es kaum größer ist – N = 1024 leistet nur etwa 0,3 % mehr Arithmetik als N = 1023. Nichts in der Komplexitätstheorie mit $O(N^3)$ sagt eine solche Klippe voraus; sie sagt eine glatte Kurve voraus. Die Erklärung ist wieder cachebezogen, aber ein subtilerer Mechanismus als der aus Teil 1.

![Links: Bei N=1023 landen sechs aufeinanderfolgende Zeilenanfänge verteilt auf sechs unterschiedliche Cache-Sets – normales Verhalten. Rechts: Bei N=1024 kollidieren alle sechs Zeilenanfänge im exakt selben Cache-Set, das bei jedem Zugriff verdrängt und neu geladen wird.](img/12-cache-conflict.png)

Reale Caches sind als **satzassoziative** (set-associative) Strukturen organisiert: Eine gegebene Speicheradresse kann nur in einer ganz bestimmten Teilmenge der verfügbaren Cache-Lines landen, bestimmt durch die niederwertigen Bits ihrer Adresse. Wenn die Länge einer Matrixzeile *exakt* eine Zweierpotenz ist (oder ein großes Vielfaches davon), bilden die Adressen, die die innerste Schleife von Stufe 1 nacheinander berührt – man erinnere sich, `B[k*N + j]`, mit `k` als der Schleife, die bei jedem Schritt um `N` Elemente springt – wiederholt auf dieselbe **identische Teilmenge** von Cache-Lines ab, statt sich zu verteilen. Das Ergebnis ist ein **Cache-Conflict-Miss**: Der Cache hat anderswo durchaus noch freien Platz, aber genau diese eine Teilmenge wird immer wieder überschrieben – als wäre der gesamte Cache viel kleiner, als er tatsächlich ist.

Dieser Effekt ist spezifisch für das Stride-N-Zugriffsmuster von Stufe 1 – genau das „Worst-Case“-Zugriffsmuster, das schon in Teil 1 markiert wurde, hier durch einen Ausrichtungszufall pathologisch verschärft. Die späteren Stufen, mit sequenziellem oder gekacheltem Zugriff, reagieren darauf deutlich weniger empfindlich. Trotzdem ist es eine nützliche generelle Lektion: Wenn eine Matrix- oder Array-Dimension unter der eigenen Kontrolle steht und das Zugriffsmuster nicht rein sequenziell ist, ist das Vermeiden exakter Zweierpotenzen (oder ein leichtes Auffüllen der Zeile, um die Ausrichtung zu brechen) eine echte, in produktivem Hochleistungscode eingesetzte Technik – keine bloße Lehrbuch-Kuriosität. Wer es selbst sehen will, sollte es einfach ausprobieren – `./stage1_naive 1023`, dann `1024`, dann `1025` – eines der unmittelbar überzeugendsten Experimente, das diese ganze Serie zu bieten hat.

## Überraschung 2: den Effekt der Compiler-Flags isolieren

Alle bisherigen Messungen haben `-O2` konstant gehalten, gezielt damit sich Änderungen am Algorithmus nicht mit Änderungen an der eigenen Optimierungsstufe des Compilers vermischen. Aber wie viel liegt allein bei den Flags auf dem Tisch, bei völlig unverändertem Quellcode? Nehmen wir den Quellcode von Stufe 4 (geblockt + OpenMP) – **keine einzige Zeile geändert** – und kompilieren ihn auf zwei verschiedene Arten:

```bash
g++ -O2 -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_O2
g++ -O3 -march=native -ffast-math -std=c++17 -fopenmp stage4_parallel.cpp -o stage4_O3native
```

`-O3` schaltet aggressivere Optimierungen ein als `-O2`, einschließlich des eigenen Versuchs des Compilers zur automatischen Vektorisierung. `-march=native` weist den Compiler an, Code zu erzeugen, der genau auf die CPU zugeschnitten ist, auf der kompiliert wird (einschließlich, sofern verfügbar, der automatischen Nutzung von AVX2 – ganz ohne Intrinsics) statt generischen Code, der auf jedem x86-Prozessor läuft – ein echter Trade-off, denn das resultierende Binary läuft womöglich überhaupt nicht mehr auf einer anderen Maschine mit älterem Befehlssatz. `-ffast-math` lockert einige der strengen Gleitkommaregeln von IEEE 754 – konkret erlaubt es dem Compiler, Additionen umzuordnen, was er normalerweise nicht darf, weil das Ergebnis dadurch um einen winzigen Betrag verändert würde – genau die zusätzliche Freiheit, die eine Akkumulationsschleife wie unsere für eine aggressive automatische Vektorisierung braucht.

```
Stage 4 with -O2:                              0.3176 s     6.741 GFLOP/s
Stage 4 with -O3 -march=native -ffast-math:    0.1497 s    14.308 GFLOP/s
```

![Balkendiagramm: -O2 bei 6,74 GFLOP/s gegenüber -O3 -march=native -ffast-math bei 14,31 GFLOP/s auf identischem Quellcode – annotiert mit 2,12x, null Zeilen geändert.](img/14-compiler-flags.png)

**2,12x schneller, exakt dieselbe Quelldatei.** Das lohnt sich, neben alles andere in dieser Serie zu stellen: Das Umsortieren der Schleifen (Teil 1) brachte 2,22x. Compiler-Flags allein, auf einer bereits gut geschriebenen Schleife, bringen noch einmal 2,12x – eine Erinnerung, die man griffbereit halten sollte, bevor man Zeit in handgeschriebene Optimierung steckt: **zu prüfen, ob die Compiler-Flags tatsächlich zur Zielhardware passen, ist oft der günstigste Performance-Gewinn, den es gibt**, und das gehört an den Anfang des Prozesses, nicht als nachträglicher Gedanke, nachdem der Algorithmus schon von Hand umgeschrieben wurde.

Wir haben bewusst darauf verzichtet, schon in der allerersten Stufe von Teil 1 mit `-O3 -march=native -ffast-math` zu kompilieren. Den Effekt der Compiler-Flags mit dem Effekt algorithmischer Änderungen zu vermischen, hätte es unmöglich gemacht zu sagen, welcher der beiden für eine gegebene Verbesserung tatsächlich verantwortlich war – jeweils eine Variable zu isolieren, hier die Flags gegenüber einem festen Quellcode, ist dieselbe Messdisziplin, die diese ganze Serie durchgängig vorzuleben versucht hat.

## Alles zusammenführen: ein Benchmark, ein Repository

Jede Stufe lebte bisher in ihrem eigenen kleinen ausführbaren Programm – praktisch, um Schritt für Schritt mitzuverfolgen, weniger praktisch, wenn man einfach alle fünf mit einem einzigen Befehl vergleichen will. Genau dafür gibt es `benchmark_all.cpp` im Repository: Es baut ein Paar Eingabematrizen (derselbe Seed für jede Version, damit jede Stufe auf identischen Daten gemessen wird), berechnet einmal mit Stufe 1 ein Referenzergebnis und führt dann jede andere Version aus und stoppt die Zeit, wobei jedes Ergebnis vor der Auswertung mit einer `max_abs_diff`-Korrektheitsprüfung gegen diese Referenz abgeglichen wird.

```bash
g++ -O2 -std=c++17 -fopenmp -mavx2 -mfma benchmark_all.cpp -o benchmark_all
./benchmark_all 1023 64
```

Es druckt dieselbe Vergleichstabelle wie oben gezeigt – Zeit, GFLOP/s, Beschleunigung gegenüber Stufe 1 und den maximalen Fehler gegenüber der Referenz (in der Größenordnung von $10^{-14}$ für jede Stufe, genau das, was die Gleitkommarundung vorhersagt) – und schreibt daneben eine `benchmark_results.csv`, bereit für das Diagrammwerkzeug eigener Wahl.

Der vollständige Quellcode für jede Stufe dieser Serie – `common.h`, `kernels.h`, alle fünf `stageN_*.cpp`-Dateien, `benchmark_all.cpp`, eine `CMakeLists.txt` und ein `build_and_run.sh` – liegt im begleitenden GitHub-Repository, verlinkt aus Teil 1. Klont es, baut es, lasst die Zahlen auf der eigenen Maschine laufen – andere CPU, andere Kernzahl, anderer Compiler, andere Zahlen – und das selbst zu sehen ist mehr wert, als irgendeiner Tabelle in einem Blogbeitrag zu vertrauen, auch dieser hier.

## Was noch offen ist

Keine ehrliche technische Serie endet mit „und das war schon alles“. Ein paar Dinge wurden bewusst ausgelassen, sowohl aus Gründen des Umfangs als auch als Fingerzeig, wo es weitergehen kann. Wir haben **Strassens Algorithmus** und seine Verwandten nicht angefasst, die die asymptotische Komplexität *unter* $O(N^3)$ senken, indem sie den Algorithmus selbst ändern, statt wie diese ganze Serie die Implementierung eines festen Algorithmus zu optimieren. Wir haben **cache-oblivious Algorithmen** nicht erkundet, die gutes Cache-Verhalten durch rekursives Teile-und-herrsche statt durch eine handgewählte Blockgröße wie unser `BS` erreichen – theoretisch ein eleganterer Ansatz, weil er die Cache-Größen der Zielprozessoren nie im Voraus kennen muss. Und wir haben nicht gegen eine professionell optimierte BLAS-Bibliothek (OpenBLAS, Intel MKL und Vergleichbares) gemessen – es wäre ehrlich zu erwarten, dass eine davon selbst Stufe 5 noch deutlich schlägt, geschrieben von Spezialisten und über Jahrzehnte auf unzähligen Architekturen abgestimmt. Der Sinn dieser Serie war nie, mit diesem Grad an Ingenieurskunst zu konkurrieren – sondern zu verstehen, Schritt für gemessenen Schritt, woher diese Art von Performance eigentlich kommt.

## Eine letzte Sache

Die dauerhafteste Erkenntnis hier ist nicht die Zahl 6,12x – es ist die Gewohnheit, für die sie steht: messen, bevor man optimiert, nach jeder einzelnen Änderung erneut messen, bei jedem Schritt die Korrektheit prüfen, und erst danach eine Schlussfolgerung ziehen. Diese Gewohnheit reicht weit über die Matrixmultiplikation hinaus – eine langsame Datenbankabfrage, eine Regelschleife, die ihre Zykluszeit ständig verfehlt, eine Bildverarbeitungspipeline, die mit dem Takt der Fertigungslinie nicht mithalten kann, sie alle belohnen genau dieselbe Disziplin. Der Code ändert sich von einer Domäne zur nächsten. Die Methode – Theorie, um zu wissen, wonach man suchen muss, ehrliche Messung, um es zu prüfen, Korrektheit, die bei jedem Schritt verifiziert wird – ändert sich nicht.

Danke, dass ihr bei allen drei Teilen dabeigeblieben seid. Geht und messt etwas.
