---
title: "Capstone-Projekt: Frame-Verarbeitungspipeline in Quasi-Echtzeit"
description: "Multithreading in C++ mit Qt — Modul 6 — Abschlussprojekt"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone-Projekt: Frame-Verarbeitungspipeline in Quasi-Echtzeit

In den vorigen Artikeln hast du die vier „unsichtbaren" Stufen der Capstone-Pipeline gesehen: Erfassung (Modul 1), begrenzter Puffer mit Backpressure (Modul 2), persistenter Verarbeitungspool (Modul 5, verglichen mit `QtConcurrent` aus Modul 3), und die vollständige Sequenz der kooperativen Abbruchbehandlung (Modul 4). Dieser Artikel schließt den Kreis mit der fünften Stufe — der GUI-Integration — und führt durch das vollständige geführte Projekt: wie es aufgebaut ist, wie man es kompiliert, und was zu beobachten ist, wenn man es tatsächlich ausführt.

## Stufe 5: die GUI, der Fortschritt, und Fehler, die nichts zu Fall bringen

**Ziel.** Ein Fenster, das in Echtzeit und ohne je zu blockieren die Auslastung des Puffers zeigt (die Backpressure sichtbar gemacht), die Anzahl erfasster/verarbeiteter Frames, und ein Log, das normale Ereignisse von Fehlern unterscheidet — dabei stets reaktionsfähig, selbst unter der stärksten Last, die die Pipeline erzeugen kann.

Jeder `FrameWorkerTask` sendet für jeden von ihm behandelten Frame genau eines von zwei Signalen, nie beide:

```cpp
try {
    QImage result = processFrame(frame, frameNumber);
    emit frameProcessed(m_workerId, frameNumber, timer.elapsed());
} catch (const std::exception &e) {
    emit frameError(m_workerId, frameNumber, QString::fromStdString(e.what()));
}
```

![Per-frame errors and progress, without ever bringing the pipeline down](modulo-06/28-error-handling-progress-signals.png)

Projekt H simuliert bewusst alle dreizehn Frames eine „beschädigte Nutzlast" — man denke an einen durch einen Übertragungsfehler auf einem echten Bus tatsächlich beschädigten Frame, ein alles andere als hypothetisches Szenario in einem industriellen Erfassungssystem —, indem innerhalb von `processFrame()` eine Ausnahme geworfen wird. Das umgebende `try`/`catch` stellt sicher, dass **nur dieser eine Frame** fehlschlägt, ohne dass der Worker, der Pool oder die Pipeline als Ganzes darunter leiden: Die Schleife in `run()` fährt sofort mit dem nächsten Frame fort. Es ist dieselbe Robustheitsphilosophie, die du in jede Produktionspipeline mitnehmen solltest: Ein verlorener Frame darf niemals ein Grund sein, die gesamte Linie anzuhalten — er sollte ein zusätzlicher Datenpunkt sein, den man protokolliert und, wenn nötig, später untersucht.

**Falle — wohin die Fehlerzählung geht.** In der GUI erhöht `onFrameError()` einen sichtbaren Zähler, der von dem der erfolgreich verarbeiteten Frames getrennt ist, und schreibt einen rot markierten Eintrag ins Log — niemals still ignoriert, niemals mit dem Erfolgszähler zu einer einzigen Zahl vermischt, die das Problem verbergen würde. Das ist eine im Code winzige, im Design aber keineswegs kleine Entscheidung: Ein System, das „24 Frames verarbeitet" meldet, während in Wahrheit 3 still fehlgeschlagen sind, ist ein System, das lügt — auf eine besonders gefährliche Weise, weil der Bediener keinen Anlass hat, daran zu zweifeln.

**Warum alles sicher ist, ohne einen einzigen Mutex in der GUI.** Jedes Signal, das von einem `CaptureWorker` oder einem `FrameWorkerTask` gesendet wird — die jeweils auf dem Erfassungs-Thread bzw. auf einem Thread des Pools leben —, erreicht einen Slot von `MainWindow`, das auf dem GUI-Thread lebt. Qt vergleicht die Thread-Zugehörigkeit von Sender und Empfänger im Moment der Emission und wählt automatisch eine queued Verbindung (Modul 4): Das Ereignis wird in die Event-Loop des GUI-Threads eingereiht und dort nacheinander verarbeitet, ohne je einen gleichzeitigen Schreibzugriff auf die Widgets. Es ist dasselbe Prinzip, das dir Modul 1 mit nur einem Worker gezeigt hat, hier verifiziert mit vier oder mehr Quell-Threads, die alle auf denselben Ziel-Thread zulaufen, ohne dass du auch nur eine einzige Zeile manuellen Synchronisationscode geschrieben hast — vorausgesetzt, du erzwingst nie eine `Direct`-Verbindung zwischen unterschiedlichen Threads.

## Einrichtung & Voraussetzungen

- C++17-Compiler (getestet mit GCC 13.3 unter Linux).
- CMake ≥ 3.16.
- Qt 6, Komponenten **Widgets** und **Concurrent** (letztere wird nur für `QtConcurrent::run()` in der asynchronen Abschaltsequenz benötigt — nicht für die Frame-Verarbeitung, die auf reinem `QThreadPool` bleibt).
- Keine externe Vision-Bibliothek: Der Kantendetektionsfilter ist von Grund auf auf den Rohdaten eines `QImage` in Graustufen implementiert.

```bash
cd project-H-vision-pipeline-capstone
cmake -S . -B build
cmake --build build
./build/vision_pipeline_capstone
```

## Die Dateistruktur

Sechs Quelldateien plus der geteilte Header für das Abbruch-Flag:

- `pipelinestate.h` — `CancellationFlag`, ein schlanker Wrapper um `std::atomic<bool>` mit `requestStop()`/`requested()`/`reset()`.
- `framebuffer.h/.cpp` — Stufe 2: die begrenzte Warteschlange von `QImage`.
- `captureworker.h/.cpp` — Stufe 1: Erzeugung der synthetischen Frames.
- `frameworkertask.h/.cpp` — Stufe 3: der Sobel-Filter und die persistente Schleife auf dem Pool.
- `mainwindow.h/.cpp` — Stufen 4 und 5: Orchestrierung, Abschaltsequenz, Widgets.
- `main.cpp` — elf Zeilen, keine Überraschungen: erzeugt `QApplication`, erzeugt `MainWindow`, ruft `exec()` auf.

Im Interface findest du zwei numerische Steuerelemente — Anzahl der zu erfassenden Frames und Anzahl paralleler Worker —, die eigens dafür gedacht sind, dass du das Backpressure-Experiment selbst nachvollziehen kannst: Senke die Worker-Anzahl auf 1 und beobachte, wie sich der Puffer schneller füllt und länger voll bleibt; erhöhe sie auf 4 und beobachte, wie die Backpressure fast verschwindet.

## Empirische Kalibrierung: messen, nicht schätzen

Der Kurs hat dir in jedem Modul dieselbe Disziplin eingebläut — messen, bevor man eine Konstante festlegt, nicht nach Gefühl kalibrieren —, und dieses Projekt macht keine Ausnahme. Bevor die endgültigen Zahlen festgelegt wurden, wurden die realen Kosten eines einzelnen Durchlaufs des Sobel-Filters auf einem synthetischen Frame isoliert gemessen:

| Frame-Größe | 1 Durchlauf | 3 Durchläufe | 5 Durchläufe |
|---|---|---|---|
| 128×96 | 0,05 ms | 0,15 ms | 0,25 ms |
| 256×192 | 0,20 ms | 0,65 ms | 1,25 ms |
| 1536×1152 | — | 28,8 ms | — |

Bemerkenswert ist, wie *schnell* ein direkt implementierter Sobel-Filter bei für einen preisgünstigen Sensor realistischen Frame-Größen ist: Selbst bei 1536×1152 (über 1,7 Megapixel) kosten drei Durchläufe weniger als 30 Millisekunden. Ein echtes Vision-System bleibt jedoch selten bei der reinen Kantendetektion stehen: Feature-Extraktion, Klassifikation, Tracking haben Kosten, die hier nicht implementiert werden (das würde über den Rahmen eines Kurses zur Nebenläufigkeit hinausgehen), die aber ehrlicherweise explizit simuliert werden sollten — im selben Geist, in dem der Verbraucher aus Modul 2 `QThread::msleep()` nutzte, um eine realistische Verarbeitungszeit darzustellen. Projekt H verwendet Frames mit 256×192, drei echte Sobel-Durchläufe (~0,65 ms, authentische und gemessene CPU-lastige Arbeit) plus eine explizite Wartezeit von 350–450 ms, um die nicht implementierten nachfolgenden Stufen darzustellen.

Mit diesen Werten und einem Erfassungsintervall von 90 ms/Frame übersteigt die Produktion (≈11 Frames/s) stabil die aggregierte Verarbeitungskapazität von zwei Workern (≈2 Frames alle ~400 ms ≈ 5 Frames/s): Die von der Theorie vorhergesagte Backpressure zeigt sich pünktlich, experimentell verifiziert, nicht nur auf dem Papier.

## Ausführungsverifikation

Kompiliert mit g++ 13.3 unter Qt 6.4.2, headless ausgeführt (`QT_QPA_PLATFORM=offscreen`) mit einer temporären instrumentierten Kopie, um die GUI ohne echtes Display zu steuern:

- **Natürlicher Abschluss** (Ziel: 24 Frames, 2 Worker): 24 erfasst, 23 erfolgreich verarbeitet, 1 fehlgeschlagen (der simulierte beschädigte Frame #13, wie erwartet — ein Fehler alle 13 Frames). Maximal beobachtete Pufferauslastung: 5/5 — Backpressure visuell bestätigt. Kein Frame verloren: `23 + 1 = 24`. Vollständiges Herunterfahren in etwa 5 Sekunden ab Start, kein Blockieren, kein Absturz, Exit-Code 0.
- **Vorzeitiger Stopp** (Stop gedrückt 900 ms nach dem Start, Puffer bereits gesättigt): 9 Frames erfasst, 5 verarbeitet vor dem Abbruch — der Rest bewusst design-bedingt verworfen (reaktionsfähiger Abbruch). Kein Blockieren, kein Absturz, Puffer nie über der konfigurierten Kapazität beobachtet.
- **Doppelter Zyklus** (Start → natürlicher Abschluss → Neustart → natürlicher Abschluss): identisches, deterministisches Verhalten in beiden Zyklen, kein beobachtbarer Ressourcenverlust, kein Restzustand zwischen den Zyklen — die Pipeline lässt sich aus demselben Fenster heraus sicher neu starten.

In keinem der Durchläufe traten Qt-Laufzeitwarnungen auf.

## Wohin von hier aus

Projekt H ist bewusst ein Spielzeugsystem, das sich wie ein echtes verhält — und der Abstand zwischen beiden ist kürzer, als er scheint. Einige konkrete Richtungen, um es weiterzuführen:

**Die simulierte Erfassung durch eine reale Quelle ersetzen.** `CaptureWorker::generateSyntheticFrame()` ist die einzige Stelle im Programm, die „so tut als ob": Ersetze sie durch einen Aufruf an eine echte Erfassungsbibliothek — einen industriellen Framegrabber, eine GenICam-Schnittstelle, oder auch nur eine Webcam über `QCamera` — und der Rest der Pipeline, Puffer, Pool, Abbruchbehandlung, GUI, benötigt keine einzige Änderung. Das ist der praktische Beweis dafür, dass sich das Entkoppeln der Stufen über eine klare Schnittstelle genau in diesem Moment auszahlt.

**OpenCV anstelle des handgeschriebenen Sobel integrieren.** Der in diesem Modul von Grund auf geschriebene Filter dient didaktischen Zwecken, aber in der Produktion würdest du fast sicher `cv::Sobel` oder Äquivalente verwenden, die oft intern vektorisiert und mehrthreadig sind. Achtung bei einem in diesem Fall nicht trivialen Detail: Wenn die verwendete Vision-Bibliothek bereits eine eigene interne Parallelität besitzt, kann das naive Aufaddieren zur Parallelität deines eigenen `QThreadPool` mehr Threads erzeugen, als du Kerne hast — ein konkreter Fall der Lektion über die Kosten von Kontextwechseln aus Modul 0, hier auf Systemebene angewendet.

**Die Poolgröße auf die reale Hardware neu kalibrieren.** In der Produktion würdest du vermutlich bei `QThread::idealThreadCount()` beginnen und dann messen — dieselbe Disziplin der empirischen Kalibrierung aus diesem Kapitel, angewendet auf die Anzahl der Worker statt auf die Verarbeitungszeit, vielleicht mit einem kleinen Benchmark im Geist von Projekt G aus Modul 5.

**Unter anhaltender Last profilieren, nicht nur in einer wenige Sekunden dauernden Demo.** Ein Test mit 24 Frames in fünf Sekunden zeigt die Korrektheit des Designs, nicht seine Belastbarkeit über Stunden kontinuierlichen Betriebs. Insbesondere ThreadSanitizer sollte auf diesem erweiterten Projekt erneut laufen gelassen werden, und ein Langzeit-Profiling ist die einzige ehrliche Methode, um zu wissen, ob Pufferkapazität und Poolgröße der realen Last wirklich standhalten.

## Fazit des Moduls — und des Kurses

Sechs Module zuvor bestand das Problem aus einem Button, der ein Fenster blockierte. Heute hast du, mit echten Messungen und nicht nur mit Intuition verifiziert, ein fünfstufiges System mit drei gleichzeitig aktiven Thread-Kategorien gebaut — ein persistenter Worker, ein dynamischer Pool, der GUI-Thread —, koordiniert durch einen begrenzten Puffer und eine Abschaltsequenz, die nie etwas hängen lässt, selbst im heikelsten Fall, in dem eine Stufe genau in dem Moment, in dem man sie zum Anhalten auffordert, in einer Wait-Condition schläft. Das ist keine Lehrbuchübung: Es ist, in seiner architektonischen Substanz, dieselbe Art von System, der du in der Arbeit an industriellen Vision-Systemen begegnen wirst.

Was man von diesem Weg mitnimmt, ist nicht die Syntax von `QThread` oder `QMutex` — die findet man in jeder Dokumentation in dreißig Sekunden wieder. Es ist das mentale Modell, mit dem man einem neuen nebenläufigen System gegenübertritt und weiß, die richtigen Fragen in der richtigen Reihenfolge zu stellen: welche Daten wirklich geteilt sind, und von wem; welche Abschaltreihenfolge niemanden für immer schlafen lässt; wo die GUI zu blockieren droht, und wie man dieses Risiko auf einen Thread verlagert, der es nicht bezahlt. Der Rest — die konkrete Klasse, der genaue Methodenname — ist Detail, das man nachschlägt, wenn man es braucht, keine Theorie, die man auswendig lernen muss.

---

*Der vollständige Quellcode dieses Projekts ist im Repository verfügbar, das diesen Kurs begleitet, im Ordner `project-H-vision-pipeline-capstone`.*
