---
title: "QFuture, QFutureWatcher und die Frage, die Vibe Coding immer überspringt"
description: "Multithreading in C++ mit Qt — Modul 3"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QFuture, QFutureWatcher und die Frage, die Vibe Coding immer überspringt

Im vorherigen Artikel hast du gesehen, wie man mit `QtConcurrent::run()` und der Familie `mapped`/`filtered`/`reduced()` parallele Arbeit startet, und wie der globale `QThreadPool` die Threads hinter den Kulissen verwaltet. Jede Funktion von `QtConcurrent`, die du bisher gesehen hast (in der nicht-blockierenden Form), gibt ein `QFuture<T>` zurück. Es lohnt sich, kurz innezuhalten und genau zu verstehen, was das ist, denn es ist ein Konzept, das sich von allem unterscheidet, was du in den vorherigen Modulen gesehen hast.

## QFuture: ein Handle auf das Ergebnis, nicht das Ergebnis

Ein `QFuture<T>` **ist nicht** das Ergebnis – es ist ein leichtgewichtiges, kopierbares Objekt, das das *Versprechen* eines Ergebnisses repräsentiert, das noch nicht bereit sein könnte. Du kannst es jederzeit abfragen:

```cpp
QFuture<QImage> future = QtConcurrent::mapped(images, blurImage);

future.isRunning();      // is the work still running?
future.isFinished();     // has it finished (successfully or canceled)?
future.isCanceled();     // was it canceled?
future.resultCount();    // how many results are ready right now?
```

Und du kannst, wenn du willst, mit `waitForFinished()` **warten**, bis es fertig ist:

```cpp
future.waitForFinished();
QList<QImage> results = future.results();
```

Halte hier kurz inne, denn das ist genau die Art von Fehler, die dieser Kurs von Anfang an, seit dem ersten praktischen Projekt, zu zerlegen begonnen hat. Erinnerst du dich an das Fenster, das einfror, weil eine lange Berechnung direkt im Slot eines Buttons lief, auf dem GUI-Thread? `future.waitForFinished()`, auf dem GUI-Thread aufgerufen, erzeugt **exakt dasselbe Symptom**, aus genau demselben Grund: Du blockierst den Thread, der frei bleiben sollte, um Ereignisse zu verarbeiten (Neuzeichnungen, Klicks, alles andere), bis die Arbeit auf dem anderen Thread fertig ist.

![Diagram of QFutureWatcher bridging QFuture signals to the GUI thread](modulo-03/14-qfuture-qfuturewatcher-bridge.png)

`waitForFinished()` hat durchaus seinen legitimen Platz: auf einem Thread, der **nicht** der GUI-Thread ist (zum Beispiel innerhalb eines anderen Jobs, der bereits über `QtConcurrent::run()` läuft, oder in einem Kommandozeilenskript ohne Benutzeroberfläche), oder wenn du mit Sicherheit weißt, dass die Arbeit schon fertig ist oder in vernachlässigbarer Zeit fertig sein wird. Auf dem GUI-Thread, für Arbeit, die länger als ein paar Millisekunden dauert, sollte es niemals auf diese direkte Weise eingesetzt werden. Die Lösung – die du im gesamten praktischen Projekt dieses Moduls verwenden wirst – lautet: **niemals warten**, sondern Qt "anklopfen" lassen, sobald das Ergebnis bereit ist. Das Werkzeug, das genau das tut, ist `QFutureWatcher<T>`.

## QFutureWatcher: der Future, übersetzt in Qt-Signale

`QFutureWatcher<T>` schlägt eine Brücke zwischen der Welt der `QFuture` (die von sich aus keine Signale aussendet) und der Welt der Signale und Slots, die du gut kennst. Ein `QFutureWatcher` "beobachtet" ein `QFuture` über `setFuture()` und übersetzt jedes interne Ereignis des Futures in ein normales Qt-Signal, das – über eine Queued-Verbindung, genau wie die Signale des Worker-Threads – auf dem Thread zugestellt wird, dem der Watcher selbst angehört (fast immer der GUI-Thread, wenn der Watcher dort erzeugt wurde).

```cpp
QFutureWatcher<QImage> *watcher = new QFutureWatcher<QImage>(this);

connect(watcher, &QFutureWatcher<QImage>::finished, this, [this, watcher]() {
    QList<QImage> results = watcher->future().results();
    // ... use the results, safely, on the GUI thread ...
});

QFuture<QImage> future = QtConcurrent::mapped(images, blurImage);
watcher->setFuture(future);   // the work has ALREADY started: setFuture() just observes it
```

Kein `QThread`, kein `moveToThread()`, kein Mutex: Der eigentliche Worker läuft im globalen `QThreadPool`, der `QFutureWatcher` lebt ganz entspannt auf dem GUI-Thread, und die Verbindung zwischen beiden läuft vollständig über Signale, die Qt in einer Warteschlange zustellt – dieselbe Zustellinfrastruktur, der du bereits gelernt hast zu vertrauen.

`QFutureWatcher<T>` bietet ein Set von Signalen, das eins zu eins den Benachrichtigungen entspricht, die du im Modul über `QThread` selbst von Hand in deinem Worker bauen musstest:

- **`started()`** – wird ausgelöst, wenn der verbundene Future die Ausführung tatsächlich beginnt.
- **`finished()`** – wird ausgelöst, wenn die gesamte Arbeit abgeschlossen ist, egal ob durch natürliches Ende oder durch Abbruch. Das ist der Punkt, an dem es sicher ist, `watcher->future().results()` aufzurufen, um alle Ergebnisse zu lesen.
- **`canceled()`** – wird (zusätzlich zu `finished()`, nicht an dessen Stelle) ausgelöst, wenn der Future explizit über `watcher->cancel()` abgebrochen wurde.
- **`progressRangeChanged(int minimum, int maximum)`** und **`progressValueChanged(int value)`** – melden den Gesamtfortschritt der Arbeit.
- **`resultReadyAt(int index)`** (und die Variante `resultsReadyAt(int beginIndex, int endIndex)` für einen Bereich) – wird jedes Mal ausgelöst, wenn ein neues Ergebnis verfügbar wird, und gibt an, **welcher** Index der ursprünglichen Sammlung fertig ist.

Es gibt ein Detail, das der vorherige Artikel bereits für die Endergebnisse vorweggenommen hat und das es wert ist, hier für die *Benachrichtigungen* zu wiederholen: `resultReadyAt(index)` sagt dir, welches Element gerade verfügbar geworden ist, garantiert aber **nicht, dass die Indizes in aufsteigender Reihenfolge eintreffen** – wenn zwei Worker parallel an verschiedenen Elementen arbeiten, benachrichtigt derjenige zuerst, der zuerst fertig wird, unabhängig davon, welcher von beiden den niedrigeren Index hatte. Was immer wahr bleibt, ist, dass das zugrunde liegende `QFuture` die Ergebnisse dennoch an der korrekten Position aufbewahrt – `resultAt(i)` (oder `results()` insgesamt) ist immer in der ursprünglichen Reihenfolge, auch wenn die "bereit"-*Benachrichtigungen* in einer anderen Reihenfolge eintrafen.

`watcher->cancel()` (gleichbedeutend mit `watcher->future().cancel()`) fordert den Abbruch der verbleibenden Arbeit an – aber, genau wie das kooperative Flag, das du im nächsten Modul formalisiert sehen wirst, **unterbricht es nicht mitten drin** ein Element, dessen Berechnung bereits auf einem Worker begonnen hat: Dieses Element wird trotzdem seinen einzelnen Schritt zu Ende bringen, es werden einfach keine neuen mehr gestartet, nachdem der Abbruch angefordert wurde. `finished()` löst trotzdem am Ende aus (zusammen mit `canceled()`), und `watcher->future().resultCount()` sagt dir, wie viele Ergebnisse vor der Unterbrechung tatsächlich gesammelt wurden.

## QPromise: wenn du selbst den Future erzeugen willst

Alles, was du bisher gesehen hast, geht von einem `QFuture` aus, das `QtConcurrent` für dich konstruiert. Es gibt einen fortgeschritteneren, im Alltag selteneren Fall, in dem du das umgekehrte Verhältnis willst: selbst eine eigene asynchrone Funktion schreiben, die sich verhält wie die von `QtConcurrent` – ein `QFuture` zurückgibt, Abbruch und Fortschritt unterstützt – ohne über `mapped`/`filtered`/`reduced` zu gehen. Das Werkzeug, in Qt 6 eingeführt, ist `QPromise<T>`.

```cpp
QFuture<int> processWithProgress(const QList<int> &data) {
    return QtConcurrent::run([data](QPromise<int> &promise) {
        promise.setProgressRange(0, data.size());
        int accumulator = 0;

        for (int i = 0; i < data.size(); ++i) {
            if (promise.isCanceled()) break;   // cooperative cancellation, as always

            accumulator += processSingleItem(data[i]);
            promise.setProgressValue(i + 1);
        }

        promise.addResult(accumulator);
    });
}
```

`QtConcurrent::run()` erkennt, dass die Lambda ein `QPromise<int>&` als ersten Parameter akzeptiert, und übergibt dir ein bereits mit dem `QFuture<int>`, das die Funktion zurückgibt, verbundenes Objekt: Innerhalb der Lambda kontrollierst du selbst den Fortschritt (`setProgressValue`), den kooperativen Abbruch (`isCanceled()`, bei jeder Iteration geprüft – dasselbe Muster wie die `while`-Schleife bei den Wait Conditions, hier auf eine Schleife angewandt) und das Endergebnis (`addResult`). Von außen erhält, wer `processWithProgress()` aufruft, ein `QFuture<int>`, das von dem einer `QtConcurrent::mapped()` völlig ununterscheidbar ist – man kann einen `QFutureWatcher` daran anschließen, genau wie du es eben gelernt hast.

Wir werden `QPromise` im heutigen praktischen Projekt nicht verwenden – unser Anwendungsfall (Bild-Blur) passt perfekt in das bereits fertige Muster `mapped()` –, aber es ist ein Werkzeug, das man sich merken sollte: Am Tag, an dem du eine blockierende Drittanbieter-Bibliothek (etwa ein SDK einer Kamera mit synchroner API) in etwas einwickeln musst, das sich sauber in das `QFuture`/`QFutureWatcher`-Ökosystem einfügt, ist `QPromise` der richtige Weg.

## Ausnahmen durch QFuture hindurch

Eine letzte Sache, die man vor dem praktischen Projekt wissen sollte, denn man vergisst sie leicht und entdeckt sie dann auf die schlimmste Weise in Produktion: Was passiert, wenn die Funktion, die du an `QtConcurrent::run()` oder `mapped()` übergibst, eine C++-Exception wirft? Sie verschwindet nicht stillschweigend, und sie lässt das Programm auch nicht sofort von einem beliebigen Thread des Pools aus abstürzen – Qt **fängt sie** auf dem Worker-Thread ab und **wirft sie erneut**, wenn jemand den Future nach dem Ergebnis befragt:

```cpp
QFuture<int> future = QtConcurrent::run([]() -> int {
    if (errorCondition()) throw std::runtime_error("invalid data");
    return 42;
});

try {
    int value = future.result();   // or after waitForFinished()
} catch (const std::exception &e) {
    qWarning() << "Exception from worker:" << e.what();
}
```

Die Exception wird an der Stelle erneut ausgelöst, an der du das Ergebnis **liest** (`result()`, `results()`, oder der entsprechende Zugriff nach `waitForFinished()`) – nicht an der Stelle, an der sie ursprünglich geworfen wurde. Verwendest du hingegen das `QFutureWatcher`-Muster (das des heutigen praktischen Projekts), ist der natürliche Ort für `try`/`catch` innerhalb des mit `finished()` verbundenen Slots, genau in dem Moment, in dem du auf die Ergebnisse zugreifst.

## QtConcurrent oder manuelles QThread? Die Frage, die Vibe Coding überspringt

Wir kommen zu dem Punkt, der den Kreis wirklich schließt, mit dem du dieses Modul begonnen hast. `QtConcurrent` ist bequem – bequem genug, um historisch das erste Multithreading-Werkzeug von Qt zu sein, dem viele Entwickler begegnen, oft ohne genau zu wissen, was sie dabei bewusst *nicht* nutzen.

![Comparison diagram of QtConcurrent versus manual QThread usage](modulo-03/16-qtconcurrent-vs-manual-qthread.png)

Die richtige Frage, die du dir jedes Mal stellen solltest, bevor du eine Zeile nebenläufigen Code in Qt schreibst, lautet: **"Ist meine Arbeit eine zustandslose Transformation auf einer Sammlung von Daten?"**

Wenn die Antwort ja ist – du hast N Elemente, wendest dieselbe Operation auf jedes an, jede Verarbeitung ist unabhängig von den anderen, du brauchst keine feine Koordination während der Ausführung, und wenn alles fertig ist, genügen dir die Ergebnisse –, dann ist `QtConcurrent::mapped`/`filtered`/`reduced` (oder `run()` für einen einzelnen Job) fast immer die richtige Wahl. Du erhältst echte Parallelität, kostenlose Verwaltung des Thread-Pools, keine Mutexe, die du schreiben müsstest, keinen `QThread`-Lebenszyklus, den du von Hand verwalten müsstest. Genau das ist das heutige praktische Projekt.

Hat deine Arbeit hingegen eine der folgenden Eigenschaften, wird `QtConcurrent` zum falschen Werkzeug – nicht weil es "nicht funktioniert", sondern weil es dich zwingt, etwas, das seiner Natur nach zustandsbehaftet ist, in eine zustandslose Schachtel zu pressen:

Ein **lange lebender Worker, der Zustand zwischen einzelnen Operationen behält** – der Producer und der Consumer des vorherigen Moduls waren keine "Transformationen auf einer Sammlung": Es waren Objekte mit einem eigenen Leben, die weiterarbeiteten, bis das Programm sie stoppte. Ein **Producer-Consumer-Muster, eine Pipeline mit mehreren Stufen** – wenn das Ergebnis einer Stufe kontinuierlich die nächste speist, und die Koordination zwischen beiden (voll/leer, Backpressure) der Kern des Problems ist, nicht nur ein Detail. Das **Bedürfnis nach Pause, Stopp, feingranularem Abbruch während der Ausführung** (nicht nur "brich alles ab, was übrig ist", wie das kooperative `cancel()` von `QFutureWatcher`, sondern "pausiere jetzt, setze später fort, mit präziser Kontrolle darüber, wo du gerade stehst") – das ist genau das Thema des nächsten Moduls. Und die **Koordination über Mutex/Wait Conditions zwischen Threads, die wirklich während der Arbeit miteinander sprechen müssen**, nicht nur ein Endergebnis austauschen.

In all diesen Fällen bleibt das Muster `QThread` + Worker-Objekt + `moveToThread()` + Signale/Slots (mit, wenn nötig, `QMutex`/`QWaitCondition` für gemeinsamen Zustand), das du in den vorherigen Modulen aufgebaut hast, das korrekte Werkzeug – kein "weniger moderner" Notbehelf. `QtConcurrent` ersetzt dieses Muster nicht: Es *entlastet* es von den Fällen, in denen es unnötig schwerfällig wäre, also genau dem Fall der Datentransformation, den du heute siehst.

Diese Unterscheidung im Kopf zu behalten – und sie in dreißig Sekunden zu erkennen, wenn man vor einem neuen Problem steht, statt "aus dem Bauch heraus" zum Werkzeug zu greifen, das man am besten kennt – ist genau die Kompetenz, die dieses Modul dir vermitteln wollte.

## Von der Theorie zu den Händen auf der Tastatur

Du hast jetzt das gesamte Vokabular, um `QtConcurrent` mit vollem Verständnis zu nutzen: `QFuture` als nicht-blockierendes Handle, `QFutureWatcher` für sichere Benachrichtigungen auf dem GUI-Thread, `QPromise` für die fortgeschrittenen Fälle, den Umgang mit Ausnahmen, und – vor allem – das Kriterium, um zu entscheiden, wann dieses Werkzeug das richtige ist und wann nicht. Im nächsten Artikel setzen wir alles in die Praxis um, mit einer echten Bild-Batch-Verarbeitung und einer Lektion über Messung, die den ganzen Artikel für sich allein wert ist.
