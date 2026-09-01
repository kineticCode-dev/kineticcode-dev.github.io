---
title: "Capstone: Architektur einer Vision-Pipeline — Erfassung und begrenzter Puffer"
description: "Multithreading in C++ mit Qt — Modul 6 (Capstone)"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone: Architektur einer Vision-Pipeline — Erfassung und begrenzter Puffer

Angefangen hast du, sechs Module zuvor, mit einem Button, der ein Fenster blockierte. Ein Klick, eine schwere Berechnung am falschen Ort ausgeführt, und die gesamte Anwendung hörte für ein paar Sekunden auf zu atmen — nicht wegen eines exotischen Bugs, sondern schlicht deshalb, weil genau das passiert, wenn ein einziger Thread sowohl die Arbeit erledigen als auch auf den Benutzer reagieren muss. Von dort aus hast du Stück für Stück ein ganzes Vokabular aufgebaut: `QThread` und die Event-Loop-Architektur (Modul 1), `QMutex` und `QWaitCondition` zur Koordination von echtem geteiltem Zustand (Modul 2), `QtConcurrent` und das Future/Promise-Modell für grobkörnige Arbeit (Modul 3), die präzisen Regeln für Verbindungen über Thread-Grenzen hinweg und die kooperative Abbruchbehandlung (Modul 4), `QThreadPool`, Atomics und die verborgenen Kosten des Cache (Modul 5). Jedes Modul hat ein präzises, isoliertes Problem gelöst, mit einem geführten Projekt, das es für sich allein demonstriert hat.

Dieses Capstone-Modul führt keine neue Technik ein. Seine Aufgabe ist eine andere und, wenn wir ehrlich sind, schwieriger: all diese Teile zu nehmen und sie **gemeinsam**, im selben Programm, gleichzeitig zum Laufen zu bringen — denn genau das ist der Unterschied zwischen „eine Technik kennen" und „ein System bauen können". Ein Thread-Pool, der für sich allein, isoliert, hervorragend funktioniert, kann für immer hängen bleiben, wenn die Reihenfolge, in der du ihn im Verhältnis zu einem vorgelagerten Puffer herunterfährst, die falsche ist. Eine tadellose kooperative Abbruchbehandlung mit nur einem Worker muss von Grund auf neu durchdacht werden, sobald aus den kooperierenden Workern drei nebenläufige Stufen statt einer werden.

Das geführte Projekt dieser letzten Artikel, **Projekt H — Frame-Verarbeitungspipeline in Quasi-Echtzeit**, liegt bewusst nahe an einem realen Fall: ein Erfassungs-Thread, der eine Kamera simuliert, ein begrenzter Puffer, der Erfassung und Verarbeitung entkoppelt, ein Worker-Pool, der auf jeden Frame parallel einen echten Filter anwendet, ein Stopp-Mechanismus, der alles anhalten muss, ohne Daten zu verlieren und ohne hängen zu bleiben, und eine GUI, die von Anfang bis Ende reaktionsfähig bleibt. Fünf Stufen, jede mit der Technik eines bestimmten Moduls gebaut.

## Gesamtüberblick: fünf Stufen, ein einziger Fluss

![End-to-end architecture of the capstone pipeline](modulo-06/25-capstone-pipeline-architecture.png)

Der Fluss ist in Richtung der Daten linear — ein Frame entsteht in Stufe 1, durchläuft Stufe 2, wird in Stufe 3 konsumiert und verarbeitet, und sein Ergebnis erreicht Stufe 5 über Signale —, aber **nicht** linear in der Steuerung: Stufe 4, das kooperative Abbruch-Flag, ist kein fünftes Glied der Kette, sondern eine Linie, die gleichzeitig *alle* anderen vier berührt, denn das Anhalten der Pipeline ist ein Vorgang, der jede Stufe in der richtigen Reihenfolge explizit erreichen muss.

Hier die vollständige Übersicht, welches Modul des Kurses die Technik jeder Stufe vermittelt hat:

- **Stufe 1 — Erfassung**: ein persistenter `QThread` mit einem über `moveToThread()` verschobenen Worker, niemals eine Unterklasse von `QThread`. Technik aus **Modul 1**.
- **Stufe 2 — Geteilter Puffer**: `QMutex` + zwei `QWaitCondition`, eine begrenzte Warteschlange, dasselbe Erzeuger-Verbraucher-Schema wie zuvor. Technik aus **Modul 2**.
- **Stufe 3 — Parallele Verarbeitung**: ein Pool persistenter Tasks auf einem `QThreadPool`, mit einer diskutierten und begründeten Alternative über `QtConcurrent`. Technik aus **Modul 5** (mit explizitem Vergleich zu **Modul 3**).
- **Stufe 4 — Kooperative Abbruchbehandlung**: ein geteiltes atomares Flag, erweitert um korrekt drei nebenläufige Stufen statt nur einer zu koordinieren. Technik aus **Modul 4**.
- **Stufe 5 — GUI-Integration**: Signale mit queued Verbindung zum Hauptthread, der nie blockiert. Technik aus **Modul 0**, hier erneut im Maßstab des gesamten Systems angewendet.

## Stufe 1: die Erfassung, ein persistenter Worker, der nichts vom Rest weiß

**Ziel.** Ein separater Thread, der in regelmäßigem, kontrolliertem Rhythmus synthetische Frames erzeugt, genau wie es der Treiber einer echten Kamera tun würde — ohne je direkt die GUI zu berühren, ohne irgendetwas darüber zu wissen, wie die Frames verarbeitet werden.

Das Muster entspricht dem aus Modul 1: keine Unterklasse von `QThread`, ein `QObject`-Worker (`CaptureWorker`), der mit `moveToThread()` auf einen reinen `QThread` verschoben wird und startet, sobald der Thread `started` sendet. Neu ist, was der Worker tut, sobald er gestartet ist: Er verarbeitet selbst nichts, sondern erzeugt lediglich ein synthetisches `QImage` und übergibt es an die nächste Stufe:

```cpp
void CaptureWorker::start() {
    int frameNumber = 0;

    while (!m_flag->requested() && frameNumber < m_targetFrameCount) {
        QThread::msleep(m_intervalMs);
        if (m_flag->requested()) break;   // re-check even after the sleep

        QImage frame = generateSyntheticFrame(frameNumber);
        if (!m_buffer->produce(frame, frameNumber)) break;

        emit frameCaptured(frameNumber);
        ++frameNumber;
    }

    emit captureFinished(frameNumber);
}
```

**Falle 1 — die erneute Prüfung nach der Sleep.** Beachte das zweite `if (m_flag->requested()) break;`, direkt nach `QThread::msleep()`. Ohne diese Zeile könnte genau in dem Zeitfenster zwischen einer Stopp-Anfrage und dem Erwachen aus dem Sleep noch ein „überflüssiger" Frame erzeugt werden — kein katastrophaler Bug, aber Disziplin: Jede Stelle, an der der Thread nach einem Warten wieder die Kontrolle übernimmt, ist eine Stelle, an der es sich lohnt, erneut zu fragen „sollte ich hier überhaupt noch sein?" — genau der Geist des `while` (nicht `if`), den Modul 2 dir für `QWaitCondition` beigebracht hat.

**Falle 2 — zwei unabhängige Abbruchbedingungen.** Die Schleife endet aus zwei verschiedenen Gründen, und beide zählen: das Abbruch-Flag (Modul 4) oder das erreichte Frame-Ziel. Ein häufiger Fehler bei der Integration mehrerer Stufen ist die Annahme, es genüge *eine* der beiden Bedingungen — aber der Fall „die Erfassung hat ihre Arbeit einfach beendet" ist keineswegs identisch mit dem Fall „der Benutzer hat alles mittendrin abgebrochen": Wir werden später sehen, dass die korrekte Abschaltsequenz in beiden Fällen unterschiedlich ist.

**Falle 3 — was passiert, wenn `produce()` `false` zurückgibt.** Der Erfassungs-Worker prüft den Zustand des Puffers nie direkt: Ihm genügt der Rückgabewert von `produce()`. Hat jemand anderes den Puffer bereits geschlossen, während der Worker auf freien Platz wartete, gibt der Aufruf `false` zurück, und die Schleife endet sauber. Es ist dasselbe Kapselungsprinzip aus Modul 2: Die Schließungslogik lebt an einer einzigen Stelle, nicht verstreut über die Threads, die sie nutzen.

## Stufe 2: der begrenzte Puffer, und Backpressure als bewusste Entscheidung

**Ziel.** Das Tempo der Erfassung von dem der Verarbeitung entkoppeln, sodass beide Stufen mit unterschiedlichen Geschwindigkeiten voranschreiten können, ohne dass die eine Schritt für Schritt auf die andere warten muss — aber mit einer klaren Grenze dafür, wie weit die beiden „auseinanderdriften" dürfen.

`FrameBuffer` ist bewusst eine Neufassung desselben geteilten Puffer-Musters aus Modul 2 — nicht kopiert, sondern neu durchdacht, um `QImage` statt Integer zu transportieren: derselbe `QMutex`, dieselben zwei `QWaitCondition` (`m_notFull` für den Erzeuger, `m_notEmpty` für die Verbraucher), dieselbe `while`-Schleife zur erneuten Prüfung, dieselbe RAII-Disziplin mit `QMutexLocker`.

```cpp
bool FrameBuffer::consume(QImage &frameOut, int &frameNumberOut) {
    QMutexLocker locker(&m_mutex);

    while (m_queue.isEmpty() && !m_closed) {
        m_notEmpty.wait(&m_mutex);
    }

    if (m_queue.isEmpty()) return false;   // closed AND empty: really done

    Entry e = m_queue.dequeue();
    frameOut = e.frame;
    frameNumberOut = e.number;
    emit occupancyChanged(m_queue.size(), m_capacity);

    m_notFull.wakeOne();
    return true;
}
```

**Falle — die Rückgabebedingung von `consume()` ist nicht symmetrisch zu der von `produce()`, und das ist Absicht.** Sieh dir die Zeile `if (m_queue.isEmpty()) return false;` genau an: Geprüft wird nur die leere Warteschlange, nicht zusätzlich `m_closed`. Das bedeutet: Sobald der Puffer geschlossen ist, gibt `consume()` **weiterhin `true`** zurück, solange noch Frames in der Warteschlange stehen — das Schließen des Puffers verwirft nichts von dem, was bereits erzeugt wurde. Das ist eine Design-Entscheidung, die man explizit machen sollte: Die entgegengesetzte Wahl (alles sofort verwerfen, sobald `close()` eintrifft) wäre genauso leicht zu schreiben gewesen, aber in einem echten Vision-System weitaus gefährlicher, wo ein verworfener Frame ein nicht erkanntes Ereignis bedeuten kann.

### Warum die Begrenzung

![Backpressure: the bounded buffer fills up and the producer waits](modulo-06/26-backpressure-bounded-buffer.png)

Bei fester Kapazität und einem Erfassungstempo, das schneller ist als das aggregierte Verarbeitungstempo, füllt sich der Puffer während des Projektablaufs regelmäßig, und `CaptureWorker::start()` blockiert erwartungsgemäß innerhalb von `m_buffer->produce()`, während er auf freien Platz wartet. Das ist der Punkt, an dem es sich lohnt, innezuhalten und in Systembegriffen zu denken, nicht nur in Code-Begriffen: Backpressure ist kein Designfehler, sondern die **bewusste und überlegene Alternative** zu einer unbegrenzten Warteschlange. Bei einer unbegrenzt wachsenden Warteschlange würde ein Erzeuger, der schneller als der Verbraucher ist, nie warten müssen — aber der Speicher, der von wartenden Frames belegt wird, würde unter anhaltender Last unbegrenzt wachsen, die Verzögerung zwischen „Frame erfasst" und „Frame verarbeitet" würde beliebig groß werden und, vor allem, unsichtbar bleiben, bis irgendwann die verfügbaren Ressourcen erschöpft sind. Ein begrenzter Puffer verwandelt ein latentes, stilles Problem in eine sofortige, messbare Verlangsamung — und, was für ein System, das rund um die Uhr auf eingebetteter Hardware laufen muss, am wichtigsten ist: mit einer im Voraus bekannten Speichergrenze.

Nachdem Erfassung und begrenzter Puffer eingeordnet sind, widmet sich der nächste Artikel dem heikelsten Teil des gesamten Moduls: wie man Frames parallel mit einem persistenten Pool verarbeitet und wie man eine Pipeline korrekt stoppt, in der drei nebenläufige Stufen im selben Augenblick an unterschiedlichen Stellen schlafen können.
