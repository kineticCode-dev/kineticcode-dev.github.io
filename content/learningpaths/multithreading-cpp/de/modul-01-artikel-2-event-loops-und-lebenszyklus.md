---
title: "Zwei Event-Loops, die sicher miteinander sprechen: Queued-Verbindungen und der Lebenszyklus eines Worker-Threads"
description: "Multithreading in C++ mit Qt — Modul 1"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Zwei Event-Loops, die sicher miteinander sprechen: Queued-Verbindungen und der Lebenszyklus eines Worker-Threads

Im vorherigen Artikel haben wir den Ansatz zu `QThread` umgekehrt: Man unterklassen es nicht, man benutzt es so, wie es ist, und die Logik kommt in einen separaten Worker, der mit `moveToThread()` verschoben wird. Es bleibt eine offensichtliche praktische Frage: Wenn der Worker jetzt auf einem anderen Thread als dem der GUI lebt, wie kommuniziert man in beide Richtungen, ohne die Race Conditions wieder einzuführen, die wir bereits gelernt haben zu fürchten?

## Zwei Event-Loops, und wie sie ohne Risiko miteinander sprechen

Die Antwort ist, dass du es nicht manuell machst: Qt macht es, automatisch, über denselben Signal-Slot-Mechanismus, den du bereits kennst, mit einem zusätzlichen Verhalten, das still einsetzt, wenn Sender und Empfänger auf unterschiedlichen Threads leben. Jeder Thread, der eine Event-Loop ausführt — sei es der GUI-Thread, sei es ein von einem `QThread` verwalteter Thread, der `run()` nicht überschrieben hat — hat eine eigene **Ereigniswarteschlange**, unabhängig von der jedes anderen Threads. Wenn du `connect()` zwischen einem Objekt, das auf Thread A lebt, und einem, das auf Thread B lebt, aufrufst, vergleicht Qt die beiden Thread-Affinitäten im Moment der Signal-Emission und, wenn sie unterschiedlich sind, **ruft es den Slot nicht direkt auf**: Es verpackt den Aufruf (den Methodennamen, die Argumente, alles) in ein Ereignis und legt es in der Warteschlange des Threads ab, dem der Empfänger gehört. Dieser Thread, wenn er in seiner Event-Loop an der Reihe ist, entnimmt das Ereignis aus der Warteschlange und führt **erst dann** den Slot wirklich aus — auf seinem eigenen Thread, mit seinen eigenen Daten, ohne dass irgendein anderer Thread im selben Moment diesen Speicher berührt.

![Two event loops connected by a queued connection](modulo-01/06-two-event-loops-queued-connection.png)

Diese Art von Verbindung hat einen genauen Namen, den wir mit allen technischen Details später im Kurs wiedersehen werden: Sie heißt **QueuedConnection** und ist eine der vier Verbindungsarten, die Qt anbietet (die anderen sind `DirectConnection`, `BlockingQueuedConnection` und `AutoConnection` — letztere ist das Standardverhalten, das automatisch Direct wählt, wenn Sender und Empfänger denselben Thread teilen, sonst Queued — genau das Verhalten, das wir heute nutzen, ohne es jemals explizit angeben zu müssen). Der konzeptionelle Punkt, den du heute mitnehmen solltest, ist dieser: **Eine normale Signal-Slot-Verbindung zwischen Objekten auf unterschiedlichen Threads ist bereits von sich aus thread-safe**, weil das Signal niemals Code des Empfängers "an Ort und Stelle" ausführt — es hinterlässt lediglich eine Nachricht in dessen Briefkasten, und der Empfänger selbst ist es, der sie liest und ausführt, wenn es ihm passt. Du brauchst keinen `QMutex`, um diesen Austausch abzusichern: Qt hat ihn bereits für dich sicher gemacht, vorausgesetzt, du kommunizierst immer über Signale und Slots und nicht etwa, indem du direkt eine öffentliche Methode des Workers von außen aufrufst oder seine Member-Variablen von einem anderen Thread aus berührst — das wäre wieder, ganz einfach, eine Data Race.

## Der Lebenszyklus eines Worker-Threads, und die Falle von deleteLater()

Einen Worker-Thread aufzustellen ist nur die halbe Arbeit: Die andere Hälfte, die robusten Code von Code trennt, der Speicher verliert oder beim Beenden der Anwendung abstürzt, ist es, seine Entstehung und vor allem sein Ende korrekt zu verwalten.

Ein sehr verbreitetes Pattern, und genau das, das wir im praktischen Projekt verwenden werden, ist es, das Signal `QThread::started` — das automatisch ausgelöst wird, sobald der verwaltete Thread seine eigene Event-Loop tatsächlich gestartet hat — mit dem Slot des Workers zu verbinden, der die Arbeit beginnt:

```cpp
connect(thread, &QThread::started, worker, &Worker::start);
```

Beachte, dass diese Verbindung wiederum zwischen Objekten auf unterschiedlichen Threads besteht (das Signal wird *vom* verwalteten Thread emittiert, sobald er startet, aber du schreibst die connect-Anweisung selbst vom GUI-Thread aus, und der Worker lebt ohnehin auf dem verwalteten Thread) — also automatisch queued, und die Ausführung von `start()` erfolgt sicher auf dem richtigen Thread.

Um einen verwalteten Thread sauber zu stoppen, ist die richtige Methode `QThread::quit()` (ein Pseudo-Synonym für `exit(0)`): Sie legt eine Beendigungsanfrage in der Ereigniswarteschlange dieses Threads ab, die die Event-Loop verarbeitet, sobald sie an der Reihe ist, indem sie `exec()` verlässt — an diesem Punkt kehrt `run()` zurück, und der Betriebssystem-Thread endet auf natürliche Weise. Das unterscheidet sich grundlegend von `QThread::terminate()`, einer Methode, die existiert, aber fast immer vermieden werden sollte: Sie erzwingt das sofortige Anhalten des Threads genau an der Stelle, an der er sich gerade befindet, ohne ihm die Möglichkeit zu geben, Ressourcen freizugeben, Mutexe zu entsperren, die er möglicherweise hält, oder einen halb geschriebenen Dateizugriff abzuschließen — es ist im Thread-Kontext das Äquivalent dazu, einem Computer den Stecker zu ziehen, statt ihn über das Betriebssystem herunterzufahren, und die möglichen Kollateralschäden sind von derselben Art.

Nach `quit()`, wenn du sicher sein willst, dass der Thread **wirklich** beendet ist, bevor du fortfährst (zum Beispiel, bevor du den Worker zerstörst), rufst du `wait()` auf, was den aufrufenden Thread blockiert, bis der verwaltete Thread wirklich fertig ist. Das ist genau die Sequenz, die wir gleich im Destruktor unseres Fensters verwenden werden: `thread->quit(); thread->wait();` — zuerst bitte ich höflich um Beendigung, dann warte ich, bis das wirklich geschehen ist, und erst dann ist es sicher, den Zustand des Workers wieder vom GUI-Thread aus zu berühren.

Ein Pattern, das du sehr häufig in der offiziellen Dokumentation und in Qt-Beispielen findest, um einen Worker sicher zu zerstören, wenn sein Thread endet, ist dieses:

```cpp
connect(thread, &QThread::finished, worker, &QObject::deleteLater);
```

`deleteLater()` zerstört das Objekt nicht sofort: Es legt ein verzögertes Lösch-Ereignis in der Ereigniswarteschlange **des Threads, dem das Objekt in diesem Moment gehört**, ab — nicht des aufrufenden Threads —, das bei der ersten sich bietenden Gelegenheit von dieser Event-Loop verarbeitet und ausgeführt wird. Es ist ein Mechanismus, der eigens dafür gedacht ist, auch von einem anderen Thread aus sicher aufgerufen werden zu können, und deshalb taucht er so häufig in nebenläufigem Qt-Code auf.

Aber hier verbirgt sich eine konkrete Falle: **Wenn der Thread, dem das Objekt gehört, bereits aufgehört hat, seine Event-Loop auszuführen, wird jenes Lösch-Ereignis niemals verarbeitet**, und das Objekt wird niemals zerstört — ein stiller Leak, kein Absturz, keine Warnung, nur Speicher, der nie zurückkommt. Es ist eine überraschend leicht zu erreichende Situation: Wenn du versehentlich `quit()` auf dem Thread aufrufst, *bevor* das `deleteLater()`-Ereignis verarbeitet wurde, oder wenn du die Reihenfolge deiner Verbindungen so strukturierst, dass das Lösch-Ereignis eintrifft, nachdem der Thread bereits begonnen hat sich zu beenden, findest du dich mit einem Phantomobjekt wieder, das niemand jemals zerstören wird.

Im heutigen praktischen Projekt **vermeiden wir diese Komplikation bewusst**: Unser Worker-Thread bleibt für die gesamte Lebensdauer der Anwendung am Leben (er ist ein "persistenter" Worker, kein "Einweg"-Worker — dazu gleich mehr), und wenn das Fenster geschlossen wird, stoppen wir den Thread mit `quit()` + `wait()` und zerstören den Worker mit einem direkten, gewöhnlichen `delete`, was in genau diesem Moment vollkommen sicher ist, weil du, nachdem `wait()` zurückgekehrt ist, mathematisch sicher sein kannst, dass kein anderer Thread mehr Code ausführt, der dieses Objekt berührt. Das vollständige Pattern mit `deleteLater()` für "Einweg"-Worker — solche, die entstehen, eine Arbeit erledigen und danach automatisch entsorgt werden müssen — sehen wir mit der Aufmerksamkeit, die es verdient, später im Kurs, wenn wir über kooperative Cancellation und komplexere Lebenszyklen sprechen.

## Persistenter Worker gegen Einweg-Worker

Eine letzte konzeptionelle Unterscheidung vor dem praktischen Projekt, weil du ihr im Kursverlauf wieder begegnen wirst: Ein **persistenter** Worker wird einmal erzeugt, einmal mit `moveToThread()` auf seinen Thread verschoben, und erhält von dort im Laufe der Lebensdauer der Anwendung so viele Arbeitsanfragen wie nötig, über wiederholte Signale — das ist das Pattern, das wir heute verwenden, geeignet, wenn du weißt, dass der Benutzer diesen Button innerhalb derselben Sitzung immer wieder drücken wird. Ein **Einweg**-Worker hingegen entsteht, um eine einzelne Arbeit zu erledigen, schaltet sich am Ende ab (mit der Sequenz `quit()` + `deleteLater()` von vorhin), und wenn eine weitere Berechnung nötig ist, wird ein neuer von Grund auf erzeugt. Keiner der beiden ist im absoluten Sinn "der Richtige": Die Wahl hängt davon ab, wie oft du erwartest, dass sich diese Arbeit wiederholen muss, und wie teuer es in Bezug auf Ressourcen ist, einen inaktiven Thread wartend zu halten, statt ihn jedes Mal neu zu erzeugen — dasselbe Granularitätsprinzip, dem wir bereits zuvor begegnet sind, hier angewandt auf die Skala eines ganzen Threads statt einer einzelnen Anweisung.

## Von der Theorie zu den Händen auf der Tastatur

Du hast jetzt das gesamte Vokabular, um einen robusten Worker-Thread aufzubauen: den Unterschied zwischen `QThread` und dem verwalteten Thread, das Pattern Worker + `moveToThread()`, die Queued-Verbindungen, die die Kommunikation zwischen Threads automatisch sicher machen, und die richtige Sequenz von Start und Abschaltung. Im nächsten Artikel setzen wir alles zusammen und greifen genau das Fenster mit dem Freeze aus dem vorherigen Modul wieder auf, um es diesmal wirklich zu heilen.
