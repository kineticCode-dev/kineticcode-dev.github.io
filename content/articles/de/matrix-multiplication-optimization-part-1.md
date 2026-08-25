---
title: "Matrixmultiplikation in C++ optimieren — Teil 1: Was die Schleifenreihenfolge wirklich bringt"
description: "Der erste Artikel einer praxisnahen Serie über Performance-Engineering: warum Matrixmultiplikation standardmäßig langsam ist, wie der Arbeitsspeicher eines Computers wirklich funktioniert, und wie das bloße Umordnen von drei for-Schleifen einen 2,2-fachen Geschwindigkeitsgewinn bringt — gemessen, nicht vermutet."
date: "2026-08-23"
category: "software"
tags: ["cpp", "performance-engineering", "matrix-multiplication", "series-part-1"]
---

Ich arbeite seit einiger Zeit auf eigene Faust das *Performance Engineering*-Material des MIT durch, und irgendwann reichte die Theorie einfach nicht mehr aus. Über Cache-Hierarchien und Schleifenreihenfolge zu lesen ist eine Sache; den eigenen Code auf der eigenen Maschine, mit exakt demselben Algorithmus, von knapp unter 2 GFLOP/s auf über 11 GFLOP/s springen zu sehen, ist eine ganz andere. Also habe ich mir ein Problem herausgesucht — die Multiplikation quadratischer Matrizen in C++ — und beschlossen, jeden Optimierungsschritt selbst durchzugehen, an jeder Stelle ehrlich zu messen, statt irgendjemandem zu glauben, was „eigentlich“ schneller sein sollte.

Dies ist der erste Artikel dieser Serie. Er deckt den ersten Teil der Reise ab: warum Matrixmultiplikation überhaupt langsam ist, wie ein moderner Prozessor tatsächlich Daten holt, und die erste echte Optimierung — die den Algorithmus selbst nicht anrührt, keinen einzigen Thread hinzufügt und keine besonderen Compiler-Flags verwendet. Sie ändert lediglich die Reihenfolge dreier `for`-Schleifen. Das Ergebnis ist ein gemessener 2,22-facher Geschwindigkeitsgewinn, und zu verstehen, *warum* das funktioniert, ist das Fundament für alles, was in dieser Serie noch folgt.

Den gesamten Quellcode findest du unter diesem [Link](https://github.com/kineticCode-dev/MatrixMultiplicationOptimization)

## Ein Problem, das leicht zu formulieren und teuer zu berechnen ist

Die Multiplikation zweier quadratischer Matrizen $A$ und $B$, beide mit Seitenlänge $N$, ergibt eine dritte Matrix $C$, bei der jedes Element $C_{ij}$ die Summe der Produkte aus Zeile $i$ von $A$ und Spalte $j$ von $B$ ist:

$$
C_{ij} = \sum_{k=0}^{N-1} A_{ik} \cdot B_{kj}
$$

Die Definition passt in eine Zeile. Die Kosten skalieren bei weitem nicht so freundlich: Die Berechnung jedes Elements von $C$ erfordert $N$ Multiplikationen und $N$ Additionen, und es gibt $N^2$ Elemente zu berechnen, sodass die Gesamtmenge in der Größenordnung von $2N^3$ Gleitkommaoperationen liegt. Verdoppelt man die Seitenlänge der Matrix, verdoppelt sich die Arbeit nicht — sie verachtfacht sich. Genau dieses kubische Wachstum macht Matrixmultiplikation zu einem so wirksamen Spielfeld für Performance-Arbeit: Ein Geschwindigkeitsgewinn, der bei einem kleinen Spielzeugproblem vernachlässigbar wirkt, wird bei einem großen Problem zu Minuten oder Stunden eingesparter Zeit — einer Schicht eines neuronalen Netzes, einer physikalischen Simulation, einem Zustandsraum-Regelungssystem.

Es handelt sich auch nicht um ein akademisches Spielzeug, das nur der Bequemlichkeit halber gewählt wurde. Matrixmultiplikation ist ganz wörtlich der rechnerische Kern des Trainings und Betriebs moderner neuronaler Netze, eines Großteils des wissenschaftlichen Rechnens, der 3D-Grafik und vieler Regelungs- und Schätzalgorithmen, wie sie in der Automatisierungstechnik eingesetzt werden. Die Bibliotheken, die sie im Extremfall implementieren (BLAS, cuBLAS, MKL), gehören zu den am intensivsten optimierten Programmen überhaupt — zu verstehen, *warum* es sie überhaupt braucht und was sie anders machen als eine naive Implementierung, ist der direkteste Weg in das Performance-Engineering im Allgemeinen, nicht nur für Matrizen.

## Wie eine Matrix tatsächlich im Speicher liegt

Bevor man über Geschwindigkeit spricht, muss ein Implementierungsdetail exakt geklärt sein, denn alles Weitere in dieser Serie hängt davon ab: wie eine N×N-Matrix tatsächlich im Speicher abgelegt ist. Ein Computer hat keine native Vorstellung von einem „2D-Gitter“ — Speicher ist physikalisch eine einzige lange, lineare Folge von Bytes. Eine zweidimensionale Matrix muss auf diese Folge *abgeflacht* werden, und dafür gibt es genau zwei sinnvolle Möglichkeiten: **row-major** (zeilenweise), bei der ganze Zeilen nacheinander abgelegt werden, oder **column-major** (spaltenweise), das Gegenteil, bei dem ganze Spalten nacheinander abgelegt werden. C und C++ verwenden für native mehrdimensionale Arrays row-major; Fortran, und in der Folge ein Großteil historischer numerischer Software, verwendet column-major. Das ist keine beiläufige Implementierungsfußnote — diese Wahl bestimmt ganz wörtlich, welche Schleifenreihenfolge schnell und welche langsam sein wird, wie der Rest dieses Artikels zeigt.

Im Code dieser Serie wird eine N×N-Matrix als ein einzelner `std::vector<double>` der Länge $N^2$ dargestellt, in row-major-Reihenfolge: Das logische Element $(i, j)$ liegt an Index `i * N + j`.

![Eine 3x3-Matrix, abgeflacht in einen einzelnen row-major-Vektor, mit der Indexformel i*N+j](img/01-row-major-flattening.png)

**Warum nicht `std::vector<std::vector<double>>`?** Es ist verlockend — ein Vektor von Vektoren liest sich ganz natürlich als „eine Matrix“. Das Problem ist, dass jeder innere Vektor seine eigene, separate Heap-Allokation ist. Die Zeilen landen verstreut im Speicher, ohne jede Garantie, in der Nähe zueinander zu liegen; nur die Elemente *innerhalb* einer Zeile sind garantiert zusammenhängend. Ein einziger flacher Vektor, von Hand indiziert, ist der einzige Weg, um zu garantieren, dass die gesamte Matrix einen zusammenhängenden Speicherblock bildet — und wie der nächste Abschnitt erklärt, ist Zusammenhängigkeit kein nettes Extra, sondern der ganze Punkt der Sache.

![Zusammenhängender einzelner Vektor im Vergleich zu verstreuten Heap-Allokationen eines Vektors von Vektoren](img/02-vector-of-vectors-fragmentation.png)

## Der Prozessor ist keine „Rechenmaschine, die Instruktionen ausführt“ — er ist eine Speicherhierarchie

Das ist die zentrale Idee dieses gesamten Artikels, es lohnt sich also, dabei zu verweilen. Die intuitive Vorstellung eines Prozessors — er liest eine Instruktion, holt die benötigten Daten, verarbeitet sie — ist technisch korrekt, verbirgt aber ein gewaltiges Detail: **das Holen eines Datums hat keine feste Kosten**. Eine moderne CPU liest Daten nicht bei jedem Zugriff direkt aus dem Haupt-RAM; RAM ist viel zu langsam im Vergleich dazu, wie schnell die CPU Daten im Prinzip verarbeiten könnte. Müsste jeder einzelne Lesezugriff auf das RAM warten, würde die CPU den überwältigenden Großteil ihrer Zeit schlicht untätig verbringen, wartend.

Genau deshalb gibt es den **Cache**: eine Reihe zunehmend kleinerer, zunehmend näher (physisch, auf dem Chip) gelegener und damit zunehmend schnellerer Speicher. Ein typischer moderner Prozessor besitzt drei Ebenen: **L1**, winzig (32–64 KB pro Kern), aber fast so schnell wie die Register der CPU selbst; **L2**, größer und immer noch sehr schnell (256 KB – 2 MB pro Kern); **L3**, von allen Kernen des Chips gemeinsam genutzt, deutlich größer (mehrere MB, manchmal Dutzende), aber der langsamste der drei. Nur wenn ein Datum in keiner dieser drei Ebenen gefunden wird, muss der Prozessor es beim Haupt-RAM anfragen — eine Operation, die, gemessen in Taktzyklen, drastisch langsamer ist als ein L1-Treffer.

![CPU-Cache-Hierarchie von den Registern über L1, L2, L3 bis zum Haupt-RAM, mit relativen Größen und Latenzen](img/03-cache-hierarchy.png)

Der Cache arbeitet nicht, indem er einzelne Bytes oder einzelne Zahlen kopiert — er kopiert ganze **Cache-Zeilen**, typischerweise 64 Byte auf einmal (acht `double`-Werte). Das funktioniert wegen einer Wette, dem sogenannten **Lokalitätsprinzip**, die sich in der überwältigenden Mehrheit realer Programme als richtig erweist: Wenn man gerade die Daten an Adresse X benutzt hat, wird man sehr wahrscheinlich bald auch die Daten an benachbarten Adressen benutzen (*räumliche* Lokalität), und man wird die Daten an Adresse X selbst wahrscheinlich in Kürze erneut benutzen (*zeitliche* Lokalität). Ein Programm, das diese Wette einhält — das den Speicher sequenziell durchläuft und wiederverwendet, was es gerade geladen hat —, läuft schnell. Ein Programm, das sie bricht — das im Speicher hin und her springt, jedes Datum einmal berührt und nie wieder —, zahlt den vollen Preis eines RAM-Zugriffs, immer wieder, obwohl es aus Sicht des Algorithmus „die gleiche Menge Arbeit“ verrichtet.

## Wo das bei der Matrixmultiplikation tatsächlich zuschlägt

Zurück zur Formel: $C_{ij} = \sum_k A_{ik} \cdot B_{kj}$. Die „Lehrbuch“-Art, das im Code zu schreiben, verwendet drei verschachtelte Schleifen über die Indizes i, j, k, in dieser Reihenfolge — weil das die Reihenfolge ist, in der sich die mathematische Formel von links nach rechts natürlich liest. Das Problem ist, dass bei row-major-Speicher der Zugriff `A[i * N + k]` sich sequenziell bewegt, wenn k variiert (perfekte räumliche Lokalität), während der Zugriff `B[k * N + j]`, mit k als *innerstem* Index, bei jeder einzelnen Iteration um eine ganze Zeile springt — N Elemente. Das ist das genaue Gegenteil räumlicher Lokalität, und zwar auf der denkbar schlechtesten Seite: Für hinreichend große N landet jeder Sprung von N Elementen außerhalb des L1-Caches, oft auch außerhalb des L2-Caches, und erzwingt bei jeder einzelnen Multiplikation einen langsamen Zugriff.

Genau das ist die Art von Beobachtung, die diese Serie greifbar machen soll, statt sie rein theoretisch zu belassen. Der Rest dieses Artikels schreibt die „Lehrbuch“-Version, misst sie ehrlich und wandelt sie dann um — ohne auch nur ein einziges numerisches Ergebnis zu verändern, das sie produziert — einfach indem die Reihenfolge der drei Schleifen geändert wird. Die Verbesserung wird kein Rundungsfehler im Prozentbereich sein: Sie wird ein messbarer multiplikativer Faktor sein, erzielt ohne eine einzige Zeile „schlaueren“ Algorithmus zu schreiben — nur indem exakt derselbe Algorithmus in der Reihenfolge geschrieben wird, die respektiert, wie Speicher tatsächlich funktioniert.

## Ein kurzes Wort zum Projekt-Setup

Bevor performancekritischer Code geschrieben wird, lohnt sich eine kleine architektonische Entscheidung, die man bewusst treffen sollte, statt aus Gewohnheit in sie hineinzurutschen: Dieses Projekt ist eine **reine C++17-Konsolenanwendung**, gebaut mit **CMake**, **ohne externe numerische Bibliothek**. Kein Eigen, kein BLAS, nichts herunterzuladen oder zu linken — der Sinn dieser Serie ist es zu verstehen, *woher* Geschwindigkeit kommt, nicht sie an eine Bibliothek zu delegieren, die das Problem schon gelöst hat (auch wenn, fairerweise, in einem echten Produktionsprojekt eine gut optimierte BLAS-Bibliothek handgeschriebenen Code fast immer übertreffen wird — mehr dazu in einem späteren Teil beim direkten Vergleich). Modernes C++ bringt hier auch echte, nicht nur kosmetische Vorteile gegenüber klassischem C: `std::vector` bietet eine sichere, automatische Speicherverwaltung ohne manuelles `malloc`/`free` und ohne das Risiko, ein `free` zu vergessen oder uninitialisierten Speicher zu lesen, und Templates erlauben es, dass eine einzige Zeitmessfunktion unverändert für jede Version des Algorithmus funktioniert, die diese Serie noch bauen wird.

## Wie man Zeit misst, ohne sich selbst zu täuschen

Bevor die erste echte Version der Multiplikation geschrieben wird, lohnt es sich, zunächst die Werkzeuge zu bauen, mit denen sie gemessen wird — eine bewusste Reihenfolge. Performance schlecht zu messen ist einfach, und es liefert falsche Schlussfolgerungen mit exakt derselben scheinbaren Sicherheit wie eine korrekte Messung: Eine Zahl auf dem Bildschirm wirkt immer autoritativ, selbst wenn die Methode, die sie hervorgebracht hat, fehlerhaft ist. Drei Fehler sind besonders verbreitet und verdienen es, explizit genannt zu werden, bevor auch nur eine einzige Zeile des eigentlichen Multiplikationscodes betrachtet wird.

**Fehler eins: Messen ohne den Cache vorzuwärmen.** Die allererste Ausführung einer Funktion, auf frisch allokierten Daten, zahlt Kosten, die spätere Ausführungen nicht mehr zahlen: Speicherseiten, die gerade erst allokiert wurden, sind vom Betriebssystem möglicherweise noch nicht physisch eingeblendet (ein *Page Fault*), und der Cache enthält noch nichts Brauchbares. Einen einzelnen „kalten“ Lauf zu messen, misst auch diese einmaligen Kosten, nicht die eingeschwungene Performance des Algorithmus — die fast immer das ist, was tatsächlich zählt, da sie widerspiegelt, wie sich der Code verhält, wenn er eine Weile läuft.

**Fehler zwei: einer einzelnen Messung vertrauen.** Jede reale Maschine betreibt ein Betriebssystem, das mit Dutzenden anderer Prozesse, Hardware-Interrupts und einer Taktfrequenz jongliert, die sich aus thermischen Gründen dynamisch verändern kann. Ein einzelner Lauf kann rein zufällig durch etwas völlig Unabhängiges vom gemessenen Code verlangsamt werden. Die robustere Lösung ist nicht das arithmetische Mittel (das ein einzelner Ausreißer immer noch stark verzerren kann), sondern der **Median**: der mittlere Wert einer sortierten Messreihe, der konstruktionsbedingt die Extreme ignoriert.

**Fehler drei, der hinterhältigste: etwas messen, das nicht das tut, was man denkt.** Ein moderner Compiler geht aggressiv gegen Code vor, der nach seiner Analyse keine beobachtbare Wirkung hat — wenn man ein Ergebnis berechnet und es nie verwendet, kann der Compiler es einfach gar nicht erst berechnen, was einen eine „unmöglich“ schnelle Zeit messen lässt, die keiner echten Arbeit entspricht. In dieser Serie ist das Risiko gering, da jede Version ihr Ergebnis in eine Matrix schreibt, die anschließend explizit auf Korrektheit verglichen wird — eine beobachtbare Wirkung, die den Compiler daran hindert, die Berechnung „wegzutricksen“.

Alle drei landen in einem einzigen gemeinsamen Header, `common.h`, der von jeder Phase des Projekts eingebunden wird:

```cpp
// Hochauflösende Stoppuhr auf Basis von <chrono>.
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

// Führt „func“ wiederholt aus, verwirft den ersten Lauf (Aufwärmen)
// und gibt den MEDIAN der Zeiten der folgenden Läufe zurück.
template <typename Func>
double median_timing_seconds(Func&& func, int repetitions = 5) {
    func();  // Aufwärmen, verworfen

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

Die Zeitmessung verwendet `std::chrono::steady_clock`, nicht `std::chrono::system_clock`: Der Unterschied ist wichtig. `system_clock` repräsentiert die reale Wanduhrzeit und kann springen — eine NTP-Synchronisation, eine manuelle Uhrzeitänderung —, was Dauermessungen in seltenen, aber realen Fällen unzuverlässig machen würde. `steady_clock` ist garantiert monoton: Sie bewegt sich nur vorwärts, mit konstanter Rate — genau die Eigenschaft, die nötig ist, um ein Zeitintervall korrekt zu messen.

Das andere Element, das gezeigt werden sollte, ist, wie aus einer rohen gemessenen Zeit eine Zahl wird, die über verschiedene Problemgrößen hinweg vergleichbar ist: **GFLOP/s**, Milliarden Gleitkommaoperationen pro Sekunde. Wie zuvor festgestellt, benötigt eine N×N-mal-N×N-Multiplikation insgesamt $2N^3$ Gleitkommaoperationen; teilt man durch die gemessene Zeit und dann durch eine Milliarde, erhält man einen Durchsatzwert, der es erlaubt, N=200 mit N=2000 auf gleicher Grundlage zu vergleichen.

```cpp
inline double gflops(int N, double seconds) {
    double flops = 2.0 * static_cast<double>(N) * N * N;
    return (flops / seconds) / 1e9;
}
```

## Stufe 1: die Lehrbuchversion

Hier ist die erste Version — die bereits oben in der Theorie angekündigte. Drei verschachtelte Schleifen, in der Reihenfolge, in der sich die mathematische Formel am natürlichsten liest: i, dann j, dann k.

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

Eine kleine, aber bewusste Implementierungsentscheidung: Die Summe wird in einer lokalen Variablen, `sum`, akkumuliert und erst nach Ende der k-Schleife in `C[i * N + j]` geschrieben, statt bei jeder Iteration direkt in `C[i*N+j] += ...` zu schreiben. `sum` lebt mit sehr hoher Wahrscheinlichkeit während der gesamten inneren Schleife in einem CPU-Register — der schnellstmögliche Zugriff, um Größenordnungen schneller als selbst ein L1-Cache-Treffer. Wiederholt in den Speicher zu schreiben (selbst gecachten Speicher) innerhalb der innersten Schleife wäre eine kleine, leicht vermeidbare selbstverschuldete Verwundung gewesen, die es wert war, schon in der allerersten Version ausgeschlossen zu werden.

Kompiliert mit `g++ -O2 -std=c++17` und ausgeführt mit N = 1023 auf der für diese Serie verwendeten Entwicklungsmaschine (eine Intel-CPU mit 2 verfügbaren Kernen — die vollständige Offenlegung von Hardware und Software folgt mit der vollständigen Vergleichstabelle später in dieser Serie), lautet das Ergebnis:

```
Stage 1 - naive ijk          N=1023   time=  1.1402 s      1.878 GFLOP/s
```

Etwas mehr als eine Sekunde. Merk dir diese Zahl — sie ist die Basislinie, mit der jede spätere Stufe dieser Serie verglichen wird.

## Stufe 2: die Schleifen zu (i, k, j) umordnen

Jetzt ändern wir **nur die Reihenfolge der drei Schleifen**, von (i, j, k) zu (i, k, j). Die berechnete Mathematik ist identisch — dieselbe Formel, $C_{ij} = \sum_k A_{ik} B_{kj}$ — nur die Reihenfolge, in der die einzelnen Multiplizier-und-Addier-Operationen stattfinden, ändert sich:

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

Zwei Unterschiede zu Stufe 1 verdienen einen Kommentar, bevor es zum eigentlichen Punkt geht. Erstens wird das Ergebnis nicht mehr in einer einzigen `sum`-Variable akkumuliert: Jetzt durchläuft die innerste Schleife j, sodass bei jeder Iteration ein *anderes* Element von C aktualisiert wird — es kann nicht mehr in einem einzigen lokalen Register gehalten werden, sondern muss direkt in `C[i*N+j]` akkumuliert werden. Aus diesem Grund muss C jetzt am Anfang explizit auf null gesetzt werden (`std::fill`), was Stufe 1 nicht brauchte, da dort jedes Element genau einmal geschrieben wurde, nicht akkumuliert. Zweitens wird `a_ik` einmal pro (i, k)-Paar außerhalb der j-Schleife herausgezogen: Er ist während der gesamten Dauer dieser inneren Schleife konstant, ihn also einmal statt N-mal zu berechnen, ist eine kleine, im Grunde kostenlose Optimierung.

Aber die Änderung, die wirklich zählt, ist die oben angesprochene: Jetzt, mit j als innerstem Index, werden **sowohl** `B[k*N + j]` **als auch** `C[i*N + j]` sequenziell durchlaufen, ein Element nach dem anderen — genau so, wie sie im row-major-Speicher liegen. Jede geladene Cache-Zeile (64 Byte, acht `double`-Werte) wird für acht aufeinanderfolgende Iterationen der Schleife genutzt, statt nur für eine einzige, wie es beim Zugriff mit großem Sprungabstand auf B in Stufe 1 der Fall war.

![Vergleich der Zugriffsmuster: Stufe 1 springt eine Spalte von B mit Schrittweite N hinab, Stufe 2 durchläuft eine Zeile von B mit Schrittweite 1](img/04-access-pattern-comparison.png)

```
Stage 2 - reordered ikj      N=1023   time=  0.5143 s      4.164 GFLOP/s
```

Von 1,14 Sekunden auf 0,51 Sekunden: mehr als doppelt so schnell, **2,22-mal schneller**, erreicht ohne den Algorithmus zu ändern, ohne Parallelität hinzuzufügen, ohne auch nur ein einziges Compiler-Flag anzurühren — nur indem dieselben drei `for`-Schleifen in anderer Reihenfolge geschrieben werden. Wenn es genau eine Sache gibt, die man aus diesem ganzen Artikel mitnehmen sollte, dann diese: Die Reihenfolge, in der man den Speicher durchläuft, zählt genauso sehr — manchmal sogar mehr — wie der Algorithmus, den man ausführt.

![Balkendiagramm der gemessenen GFLOP/s, Stufe 1 gegen Stufe 2, N=1023](img/05-stage1-vs-stage2-benchmark.png)

**Korrektheitsprüfung, immer.** Bevor man einer Performance-Zahl vertraut: überprüfen, ob das Ergebnis tatsächlich korrekt ist. Der Vergleich der von Stufe 2 erzeugten C-Matrix mit der von Stufe 1 erzeugten, auf denselben Eingabedaten, ergibt eine maximale Differenz von `3.55e-14` — vollständig darauf zurückzuführen, dass Gleitkomma-Addition nicht perfekt assoziativ ist, wenn Operationen in anderer Reihenfolge stattfinden, nicht auf einen logischen Fehler. Ein Fehler dieser Größenordnung ist die erwartete, harmlose Signatur dieses Phänomens; ein um mehrere Größenordnungen größerer Fehler wäre dagegen ein Alarmsignal dafür, dass im umgeschriebenen Algorithmus tatsächlich etwas kaputt ist.

## Was in dieser Serie als Nächstes kommt

Drei Schleifen umzuordnen war der erste Hebel, und für sich genommen ist er genau eine ehrliche Zahl wert: 2,22-fach. Das ist jedoch nicht das Ende der Geschichte — Stufe 2 lässt noch echte Performance auf dem Tisch liegen, und die nächsten Teile dieser Serie setzen genau dort an, wo dieser hier aufhört:

- **Tiling (Blockbildung)** — die Matrizen in kleine Unterblöcke aufteilen, die bequem in den L1/L2-Cache passen, um *zeitliche* Lokalität in größerem Maßstab auszunutzen, zusätzlich zur räumlichen Lokalität, die Stufe 2 bereits einfängt. Hier gibt es eine ehrliche Überraschung in den Messungen: naives Tiling allein schlägt Stufe 2 *nicht* — und genau zu verstehen, warum, ist lehrreicher als die Technik selbst.
- **Parallelität mit OpenMP** — mehr als einen CPU-Kern zum Arbeiten bringen, indem die geblockte Berechnung mit einem einzigen `#pragma` auf mehrere Threads aufgeteilt wird, ohne gemeinsame Schreibzugriffe und damit ohne Race Conditions, über die man nachdenken müsste.
- **Manuelle Vektorisierung mit AVX2 und FMA** — die innerste Schleife von Hand mit Vektorbefehlen umschreiben, die vier `double`-Werte pro Instruktion statt nur einem verarbeiten, für Leser, deren CPU das unterstützt (mit einem automatischen, korrekten Fallback für jene, deren CPU es nicht tut).
- **Der vollständige Vergleich, und zwei weitere ehrliche Überraschungen** — ein vollständiger, methodisch transparenter Vergleich aller fünf Stufen, einschließlich der Frage, warum eine Matrixgröße, die zufällig eine Zweierpotenz ist, dramatisch *langsamer* sein kann als eine benachbarte Größe, die keine ist, und warum es genauso wichtig ist, den Effekt aggressiver Compiler-Flags vom Effekt der Algorithmusänderungen zu trennen, wie die algorithmische Arbeit selbst.
- **Alles in einem konsolidierten Benchmark und einem öffentlichen Repository zusammenführen** — ein Programm, das jede Stufe ausführt, die Korrektheit automatisch verifiziert und die Vergleichstabelle sowie das Diagramm erzeugt, die in dieser ganzen Serie verwendet werden, dazu ein Hinweis darauf, wo klassische algorithmische Ideen (Strassens Algorithmus, cache-oblivious Algorithmen) dort weitermachen, wo diese praxisnahe Serie aufhört.

Der Code zu diesem Artikel — Stufe 1, Stufe 2 und die gemeinsamen Messwerkzeuge, zusammen mit den noch kommenden Stufen — befindet sich im begleitenden GitHub-Repository, bereit zum Klonen, zum Bauen mit CMake und zum Ausführen auf der eigenen Maschine. Deine eigenen Zahlen werden von den hier gemessenen abweichen — andere CPU, andere Kernanzahl, anderer Compiler — und genau das ist der Sinn davon, es selbst auszuführen, statt diesen Zahlen einfach zu glauben.
