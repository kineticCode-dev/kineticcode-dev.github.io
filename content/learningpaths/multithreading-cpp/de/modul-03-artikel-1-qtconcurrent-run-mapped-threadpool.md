---
title: "QtConcurrent::run, mapped/filtered/reduced und der QThreadPool hinter den Kulissen"
description: "Multithreading in C++ mit Qt — Modul 3"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QtConcurrent::run, mapped/filtered/reduced und der QThreadPool hinter den Kulissen

In den drei vorangegangenen Modulen hast du dir Stück für Stück das Vokabular und die Werkzeuge erarbeitet, mit denen Qt "manuelles" Multithreading handhabt: `QThread`, `moveToThread`, Signale und Slots, damit Threads kommunizieren können, ohne sich gegenseitig den Zustand zu zerschießen, und dann `QMutex`, `QWaitCondition`, `QReadWriteLock`, um wirklich gemeinsam genutzte Daten zu schützen und zu koordinieren. Das war bewusst ein langsamer Weg, denn jedes Stück dieses Vokabulars brauchst du, um zu verstehen, *was wirklich passiert*, wenn die Dinge kompliziert werden – ein Deadlock, ein Signal, das auf dem falschen Thread ankommt, ein Worker, der einfach nicht aufhört.

Heute wechseln wir das Register komplett, und das tun wir bewusst genau an dieser Stelle des Kurses, an der du den Unterschied wirklich zu schätzen weißt. Wenn dein erster Kontakt mit Multithreading in Qt über `QtConcurrent` lief, ein bisschen "nach Gefühl" – ein Beispiel kopieren, laufen lassen, weitermachen, ohne genau zu wissen, warum es funktionierte –, dann schließen wir heute genau diesen Kreis: Du siehst exakt dieselben Werkzeuge wieder, aber diesmal weißt du präzise, was `QThreadPool` unter der Haube macht, warum `QFuture` nicht blockiert (es sei denn, du verlangst es ausdrücklich), und an welchem Punkt der Komfort von `QtConcurrent` aufhört die richtige Wahl zu sein und man wieder zum manuellen Pattern der vorherigen Module greifen muss.

Die Frage, die das ganze Modul leitet, ist einfach zu formulieren und subtiler, gut anzuwenden: **Ist die Arbeit, die ich parallelisieren will, eine unabhängige Transformation, die auf viele ähnliche Daten angewendet wird, oder ist es ein Zustand, der über die Zeit lebt und koordiniert werden muss?** Das Producer-Consumer-Muster des vorherigen Moduls gehörte klar in die zweite Kategorie – zwei dauerhafte Threads, ein gemeinsamer Puffer, feine Koordination über Wait Conditions. Heute arbeiten wir in der ersten Kategorie, genau der, für die `QtConcurrent` entworfen wurde, um zu glänzen: Du hast eine Sammlung von Daten (in deinem beruflichen Alltag fast immer Frames oder Bilder eines Vision-Systems) und willst dieselbe Operation auf jedes einzelne Element anwenden, so parallel wie möglich, ohne auch nur einen einzigen `QThread` von Hand zu schreiben.

## QtConcurrent::run(): ein asynchroner Aufruf, ohne Umstände

Beginnen wir mit dem denkbar einfachsten Fall: Du hast eine einzelne Funktion, die etwas Zeit braucht, und willst sie auf einem anderen Thread ausführen, ohne den Aufrufer zu blockieren. Im Modul über `QThread` hat dich das mindestens gekostet: eine von `QObject` abgeleitete Worker-Klasse, einen Slot, der die Arbeit erledigt, einen eigenen `QThread`, ein `moveToThread()`, die Verbindung `started` → Slot, das geordnete Herunterfahren im Destruktor. Fünf bis sechs Zeilen Infrastruktur, um *eine* einzige Funktion ein einziges Mal auszuführen.

`QtConcurrent::run()` macht dasselbe in einer Zeile:

```cpp
QFuture<int> future = QtConcurrent::run([]() {
    // time-consuming work, executed on another thread
    QThread::msleep(500);
    return 42;
});
```

Diese eine Zeile erledigt drei Dinge gleichzeitig: Sie nimmt die Funktion (hier eine Lambda, aber es kann auch ein Zeiger auf eine freie Funktion, eine Member-Methode oder ein Funktor sein), reiht sie auf einem Thread ein, der aus einem Lager bereits laufender Threads geliehen wird (dem globalen `QThreadPool` – Thema des nächsten Abschnitts), und gibt dir sofort ein `QFuture<int>` zurück: ein handliches Objekt, das "das Ergebnis, das kommen wird" repräsentiert, nicht das Ergebnis selbst. Die Zeile `QtConcurrent::run(...)` **blockiert nicht** – sie kehrt sofort zurück, noch bevor die Lambda überhaupt zu laufen begonnen hat, genau so wie `m_thread->start()` nicht darauf gewartet hat, dass die Arbeit des Worker-Threads fertig wird.

Der Gewinn ist offensichtlich: keine neuen Klassen, keine manuelle Verwaltung des Lebenszyklus eines `QThread`, kein Risiko, `quit()`+`wait()` im Destruktor zu vergessen. Für eine "Feuer und vergiss"-Arbeit – oder "feuer, und hol das Ergebnis später ab" – ist das fast immer die richtige Wahl.

Was du dabei verlierst, ist genauso wichtig, sofort zu erkennen, denn es ist der rote Faden des ganzen Moduls: **Du hast kein persistentes Objekt mehr, mit dem du sprechen kannst, während die Arbeit läuft.** Der Producer aus dem vorherigen Modul lebte auf seinem eigenen Thread für die gesamte Programmlaufzeit, empfing Signale, sendete welche, konnte geordnet gestoppt werden. Ein Aufruf von `QtConcurrent::run()` ist konzeptionell eine reine Funktion, die startet, läuft und endet – kein Objekt, mit dem du zwischendurch interagierst. Wenn dein Problem diese Art kontinuierlicher Interaktion braucht (Pause, feingranulare Abbruchmöglichkeit, granulare Fortschrittsbenachrichtigungen während der Ausführung), ahnst du bereits, warum *nicht alles* über `QtConcurrent` laufen muss – darauf kommen wir im nächsten Artikel in Ruhe zurück.

## mapped, filtered, reduced: Parallelität auf den Daten

`QtConcurrent::run()` führt *eine* Funktion einmal aus. Der weitaus häufigere Fall in deiner Arbeit – N Bilder einer Inspektion verarbeiten, N Frames einer aufgezeichneten Sequenz, N Messwerte eines Sensors – ist es, *dieselbe* Funktion auf *jedes Element* einer Sammlung anzuwenden, unabhängig voneinander. Dieses Muster hat in der Literatur zum parallelen Rechnen einen genauen Namen, **Data Parallelism** (Datenparallelität, im Gegensatz zum *Task Parallelism*, bei dem verschiedene Operationen parallel laufen), und genau das ist der Fall, den `QtConcurrent::mapped()` abdeckt.

```cpp
QList<QImage> blurredImages = QtConcurrent::blockingMapped(originalImages, blurImage);
```

![Visual diagram of map, filter and reduce data-parallel operations](modulo-03/15-map-filter-reduce-visual.png)

`mapped()` nimmt eine Sammlung (hier eine `QList<QImage>`) und eine einargumentige Funktion (hier `blurImage`, die eine `QImage` entgegennimmt und eine neue zurückgibt) und wendet diese Funktion auf *jedes* Element an, wobei die Arbeit auf die im Pool verfügbaren Threads verteilt wird. Jedes Element wird **unabhängig** von den anderen verarbeitet – kein gemeinsamer Zustand, kein Mutex nötig, denn per Definition des Problems berühren sich zwei Verarbeitungen nie. Genau das ist der Grund, warum sich dieses Muster so gut für Parallelität eignet: Der kritische Abschnitt aus dem vorherigen Modul existierte, weil mehrere Threads *dieselben* Daten anfassten; hier fasst jeder Worker ein anderes Element an, also existiert der kritische Abschnitt schlicht nicht.

Ein Detail, das es wert ist, schriftlich festzuhalten, weil man es leicht auf die falsche Weise für selbstverständlich hält: Die Worker vollenden die Elemente **in beliebiger Reihenfolge**, je nachdem, wie lange jedes einzelne braucht und welcher Thread es sich schnappt – aber die Sammlung von Ergebnissen, die du am Ende erhältst, **bewahrt immer die ursprüngliche Reihenfolge**. `result[i]` entspricht immer `f(element[i])`, unabhängig davon, welcher Worker es berechnet hat oder in welcher Reihenfolge es berechnet wurde. Für deine Arbeit mit Frame-Sequenzen ist das eine wertvolle Garantie: Frame Nummer 10 in der Ergebnisliste ist immer die Verarbeitung von Frame Nummer 10 aus der Ausgangsliste, nie die eines anderen Frames, der rein durch Zufall des Schedulings früher fertig wurde.

Neben `mapped()` bietet `QtConcurrent` zwei Varianten desselben allgemeinen Schemas. **`filtered()`** wendet ein Prädikat (eine Funktion, die `bool` zurückgibt) auf jedes Element an und liefert eine neue Sammlung, die nur die Elemente enthält, für die das Prädikat wahr ist – berechnet parallel, wobei die relative Reihenfolge der überlebenden Elemente stets erhalten bleibt:

```cpp
QList<QImage> darkImagesOnly = QtConcurrent::blockingFiltered(images, [](const QImage &img) {
    return averageBrightness(img) < DARK_THRESHOLD;
});
```

**`reduced()`** kombiniert alle Ergebnisse eines `mapped()` zu einem einzigen akkumulierten Wert, mittels einer assoziativen Kombinationsfunktion – der Summe, dem Maximum, der Konkatenation, jeder Operation, bei der die Reihenfolge, in der man Paare kombiniert, das Endergebnis nicht verändert:

```cpp
double totalBrightness = QtConcurrent::blockingMappedReduced(
    images,
    computeBrightness,                       // map: QImage -> double
    [](double &accumulator, double value) { accumulator += value; }  // reduce
);
```

Beachte `mappedReduced`: Es ist die Verschmelzung von Map und Reduce in einem einzigen Durchgang, der es vermeidet, die gesamte Zwischensammlung der gemappten Ergebnisse aufzubauen und im Speicher zu halten, bevor sie kombiniert werden – nützlich, wenn diese Zwischensammlung groß wäre und du sie als solche nie brauchst, sondern nur den finalen akkumulierten Wert.

Es gibt auch ein Paar kleingeschriebener Varianten, `QtConcurrent::map()` und `QtConcurrent::filter()` (nicht mit `mapped`/`filtered` zu verwechseln), die die Sammlung **an Ort und Stelle** verändern, statt eine neue zurückzugeben – nützlich, wenn du die Originaldaten nicht behalten musst und dir den Speicher einer Kopie sparen willst. Im praktischen Projekt dieses Moduls verwenden wir die "nicht mutierende" Form (`mapped`), weil wir sowohl die Originalbilder als auch die verarbeiteten für einen Vergleich behalten wollen – aber wisse, dass die Alternative existiert, und sie ist die richtige Wahl, wenn dich nur das Endergebnis in-place interessiert.

Dir ist sicher aufgefallen, dass die obigen Beispiele `QtConcurrent::blockingMapped()` verwenden, nicht `QtConcurrent::mapped()`. Der Unterschied ist genau das, was der Name nahelegt: Die `blocking*`-Version führt die Arbeit parallel auf den anderen Threads aus, **wartet** aber (blockiert dabei den aufrufenden Thread), bis alles fertig ist, bevor sie die Ergebnissammlung direkt zurückgibt – praktisch für ein Kommandozeilenskript oder für Code, der bereits auf einem sekundären Thread läuft, aber **auf dem GUI-Thread zu vermeiden**, aus genau dem Grund, den der nächste Artikel formalisiert. Die Version ohne Präfix, `QtConcurrent::mapped()`, gibt sofort ein `QFuture<T>` zurück, ohne auf irgendetwas zu warten – und diese verwenden wir im praktischen Projekt.

## Der globale QThreadPool: das Threadlager hinter den Kulissen

Keiner der Aufrufe von `QtConcurrent::run()`, `mapped()`, `filtered()` oder `reduced()`, die du bisher gesehen hast, gibt jemals explizit an, *auf welchen Threads* die Arbeit laufen soll. Das ist keine Magie: dahinter steckt ein `QThreadPool`, und standardmäßig ist es der globale, von der gesamten Anwendung geteilte, erreichbar über `QThreadPool::globalInstance()`.

![Diagram of the implicit global QThreadPool shared by QtConcurrent operations](modulo-03/13-global-thread-pool.png)

Im Modell der vorherigen Module bedeutete jeder Job, den du auf einem separaten Thread ausführen wolltest, die Erzeugung eines neuen `QThread` – ein Objekt des Betriebssystems, mit eigenem Stack, eigener Identität, nicht vernachlässigbaren Kosten für Erzeugung und Zerstörung. Das ist völlig in Ordnung für einen Worker, der lange lebt (dein Producer oder Consumer, die für die gesamte Programmlaufzeit leben), wird aber zur offensichtlichen Verschwendung, wenn der "Job" nur wenige Millisekunden dauert und hunderte davon eintreffen: Du würdest Hunderte von Betriebssystem-Threads erzeugen und wieder zerstören, jedes Mal die vollen Kosten zahlend, für Arbeit, die bestenfalls einen kleinen Bruchteil dieser Zeit beansprucht.

Der `QThreadPool` löst das Problem, indem er eine feste Anzahl **bereits erzeugter und einsatzbereiter** Threads unterhält und sie wiederverwendet: Wenn du einen Job einreihst (über `QtConcurrent::run()` oder einen der Algorithmen `mapped`/`filtered`/`reduced`), weist der Pool ihn dem ersten freien Worker-Thread zu; wenn dieser Thread fertig ist, **stirbt er nicht** – er wird wieder verfügbar für den nächsten Job in der Warteschlange. Die Erzeugungskosten des Betriebssystem-Threads zahlst du nur einmal, beim Start, nicht bei jedem einzelnen Job.

Die Standardgröße des Pools ist `QThread::idealThreadCount()` – typischerweise die Anzahl der auf der Maschine verfügbaren logischen Kerne (auf der Entwicklungsmaschine dieses Kurses, gemessen mit `qDebug() << QThread::idealThreadCount();`, liegt der Wert bei **2**: Du wirst ihn im praktischen Projekt mehrfach erwähnt sehen, weil er eine der Zahlen ist, die bestimmt, wie lange unser Bild-Batch tatsächlich braucht). Die Idee dahinter: Für genuin CPU-gebundene Arbeit wie unseren Blur hilft es nicht, mehr aktive Threads als physische Kerne zur Verfügung zu haben – im Gegenteil, das führt nur zu zusätzlichem Overhead durch Kontextwechsel – also dimensioniert sich der Pool so, dass er genau den von der Hardware gebotenen Parallelismus nutzt, weder mehr noch weniger.

Du kannst diese Größe mit `QThreadPool::globalInstance()->setMaxThreadCount(n)` ändern und auch einen eigenen privaten `QThreadPool` erzeugen (indem du ihn als ersten Parameter an dedizierte Overloads von `QtConcurrent::run()`/`mapped()` übergibst), wenn du eine bestimmte Art von Arbeit vom Rest der Anwendung isolieren willst – nützlich zum Beispiel, wenn du ein Subsystem mit niedriger Priorität hast, das niemals mit der Hauptverarbeitung um Threads konkurrieren soll. Im heutigen praktischen Projekt verwenden wir immer den standardmäßigen globalen Pool: Für eine Anwendung mit nur einer Art CPU-gebundener Arbeit wie der unseren gibt es keinen Grund, die Dinge mit mehreren Pools zu verkomplizieren.

Von hier an eine einfache Regel: Wenn deine Arbeit sich **in kurze und zahlreiche Jobs zerlegen lässt**, lass den `QThreadPool` sie verwalten – genau dafür wurde er entworfen. Brauchst du hingegen **einen einzelnen, lange lebenden Worker, der Zustand zwischen Operationen behält** (wieder das Producer/Consumer-Beispiel des vorherigen Moduls), bleibt ein dedizierter `QThread` das richtige Werkzeug – nicht alles muss über den globalen Pool laufen.

## Was noch zu klären bleibt

Du weißt jetzt, wie man mit `QtConcurrent::run()` und `mapped()`/`filtered()`/`reduced()` parallele Arbeit startet, und was hinter den Kulissen im globalen `QThreadPool` passiert. Offen bleibt, wie man Fortschrittsbenachrichtigungen erhält, ohne jemals den GUI-Thread zu blockieren – die Rolle von `QFuture` und vor allem von `QFutureWatcher` – und in welchen Fällen genau man stattdessen zum manuellen Muster der vorherigen Module zurückkehrt. Das ist das Thema des nächsten Artikels.
