---
title: "Capstone: persistenter Verarbeitungspool und vollständige kooperative Abbruchbehandlung"
description: "Multithreading in C++ mit Qt — Modul 6 (Capstone)"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Capstone: persistenter Verarbeitungspool und vollständige kooperative Abbruchbehandlung

Im vorigen Artikel hast du die ersten beiden Stufen der Capstone-Pipeline gesehen: einen persistenten Erfassungs-Worker (Modul 1), der Frames in einen begrenzten Puffer (Modul 2) einspeist, mit Backpressure als bewusster Entscheidung. Dieser Artikel widmet sich den Stufen 3 und 4: wie man diese Frames parallel verarbeitet und — der schwierigste Teil des gesamten Kurses — wie man eine Pipeline korrekt stoppt, in der mehrere nebenläufige Stufen im selben Augenblick an unterschiedlichen Stellen schlafen können.

## Stufe 3: parallele Verarbeitung, und warum hier QThreadPool QtConcurrent schlägt

**Ziel.** Auf jeden Frame einen echten CPU-lastigen Filter anwenden — in Projekt H einen Sobel-artigen Kantendetektor — und die Arbeit auf mehrere Threads verteilen, sodass die Gesamtverarbeitungszeit mit der Anzahl der verfügbaren Kerne skaliert.

### Die Design-Entscheidung, auf die es ankommt: persistenter Pool gegen endlichen Batch

Modul 3 hat dir `QtConcurrent::mapped` beigebracht: Du gibst eine Sammlung, du gibst eine Funktion, du erhältst ein `QFuture`, das dir die Ergebnisse mit über `QFutureWatcher` beobachtbarem Fortschritt liefert. Das ist das richtige Werkzeug, immer wenn dein Problem die Form „ich habe *N* Elemente, alle bereits verfügbar, und will sie alle verarbeiten" hat. Projekt H hat jedoch **nicht diese Form**: Die Frames treffen einzeln ein, in einem Rhythmus, den du nicht im Voraus kennst, über eine Zeitspanne, die möglicherweise kein festes Ende hat (eine echte Kamera sagt dir nie im Voraus „ich bin der letzte Frame"). `QtConcurrent::mapped` muss die vollständige Sammlung kennen, bevor es startet — es ist nicht für einen kontinuierlichen Strom gedacht, der wächst, während du ihn konsumierst.

Die gewählte Lösung ist ein Pool **persistenter Tasks**: nicht ein `QRunnable` pro Frame (das die Kosten des Erstellens und Einplanens eines neuen Objekts für jeden einzelnen Frame zahlen würde — ein Overhead, der bei Frames, die alle 90 Millisekunden eintreffen, ins Gewicht fällt), sondern eine feste Anzahl von `FrameWorkerTask` — typischerweise 2, in der GUI vom Benutzer konfigurierbar —, von denen jeder **für die gesamte Dauer der Pipeline** läuft und in einer eigenen inneren Schleife Frame für Frame aus dem Puffer entnimmt:

```cpp
void FrameWorkerTask::run() {
    QImage frame;
    int frameNumber = -1;

    while (m_buffer->consume(frame, frameNumber)) {
        // ... process, measure, emit signals ...
        if (m_flag->requested()) break;
    }
}
```

Jeder `FrameWorkerTask` erbt sowohl von `QObject` (um Signale an die GUI senden zu können) als auch von `QRunnable` (um über `QThreadPool::start()` eingeplant werden zu können) — eine doppelte Vererbung, für die du in Modul 5 noch keinen Anlass hattest, weil deine `QRunnable` dort rein rechnerischer Natur waren, ohne Bedarf, Ergebnisse über Signale zu kommunizieren.

**Falle — die Poolgröße muss festgelegt werden, *bevor* die Tasks gestartet werden, nicht danach.** `QThreadPool::setMaxThreadCount(N)` muss vor `start()` aufgerufen werden, und bei persistenten Tasks ist die falsche Reihenfolge nicht nur suboptimal, sondern potenziell ein stiller Stillstand: Startest du `N` Tasks, aber der Pool hat Platz für weniger als `N` gleichzeitige Threads, bleiben die überzähligen Tasks in der internen Warteschlange des Pools stecken, in der Erwartung, dass einer der bereits laufenden Tasks endet — was bei einem Task, der in einer Schleife läuft, bis der Puffer geschlossen wird, bis zum Ende der Pipeline nicht geschieht. Das Ergebnis ist ein Pool, der „gestartet" wirkt, in dem aber nur ein Teil der Worker tatsächlich aus dem Puffer konsumiert, mit reduziertem Durchsatz und ohne jede Fehlermeldung, die darauf hinweist.

**Wann du das eine oder das andere in deiner eigenen Arbeit wählst.** Wenn dein Problem lautet „ich habe einen Batch von 200 Bildern, die bereits auf der Festplatte liegen, verarbeite sie alle und sag mir Bescheid, wenn du fertig bist", bleibt `QtConcurrent::mapped` mit einem `QFutureWatcher` die einfachste und lesbarste Wahl — erfinde sie nicht mit einem persistenten Pool neu, nur weil du ihn hier gesehen hast. Wenn dein Problem lautet „ein kontinuierlicher Strom eintreffender Daten, von unbekannter Dauer, der mit minimaler Verzögerung verarbeitet werden muss, während er weiter eintrifft", ist das Muster von Projekt H — persistenter Pool, der aus einem geteilten Puffer entnimmt — die natürliche Form des Problems.

## Stufe 4: vollständige kooperative Abbruchbehandlung — der schwierigste Teil des Kurses

Wenn es einen einzigen Abschnitt dieses Moduls gibt, bei dem sich zweimaliges Lesen jedes Satzes lohnt, dann diesen. **Einen** Worker korrekt zu stoppen, wie in Modul 4, erfordert Disziplin, ist aber konzeptionell einfach: ein Flag, eine Schleife, die es prüft, ein abschließendes `quit()` + `wait()`. Eine **Pipeline mit drei nebenläufigen Stufen, die sich über einen blockierenden Puffer Daten zureichen**, zu stoppen, ist ein qualitativ anderes Problem, denn jetzt gibt es mehrere Arten, wie ein Thread genau in dem Moment „beschäftigt" sein kann, in dem die Stopp-Anfrage eintrifft, und jede davon erfordert, dass ihn jemand anderes physisch weckt — ein Flag allein reicht nicht mehr aus.

### Der Fehler, den eine naive Version machen würde

Stell dir vor, du schreibst spontan diese Abschaltsequenz:

```cpp
// NAIVE VERSION -- DO NOT DO THIS
void naiveShutdown() {
    m_flag.requestStop();        // (a)
    m_captureThread->quit();     // (b)
    m_captureThread->wait();     // (c)  <-- can hang here forever
    m_pool->waitForDone();       // (d)
}
```

Das wirkt vernünftig, und es ist genau die Art von Code, die einen schnellen Test bestehen würde, bei dem man Stop drückt, während die Pipeline unbelastet ist. Das Problem tritt in einem bestimmten, aber keineswegs seltenen Fall auf: Wenn in dem Moment, in dem `naiveShutdown()` aufgerufen wird, der Erfassungs-Thread *innerhalb* von `m_buffer->produce()` blockiert ist, weil der Puffer voll ist — also genau das Backpressure-Szenario aus dem vorigen Artikel, **normales und erwartetes** Verhalten der Pipeline —, dann nützt Schritt (a) gar nichts: `m_flag` ist eine atomare Variable, aber der Erfassungs-Thread schaut in diesem Moment nicht auf sie, er schläft innerhalb von `QWaitCondition::wait()`, das nur durch ein explizites `wakeOne()`/`wakeAll()` oder durch ein spurious wakeup aufwacht. Schritt (b) reiht eine Ausstiegsanfrage in die Warteschlange, die der Thread nie verarbeiten kann, weil er sich nicht in seiner Event-Loop befindet. Schritt (c), `wait()`, blockiert dann **für immer** — das ist keine Verlangsamung, das ist ein echtes Deadlock.

### Die korrekte Sequenz, Schritt für Schritt

![Full shutdown: the deadlock-free stop ordering](modulo-06/27-full-pipeline-shutdown.png)

Der Schritt, der der naiven Version fehlt, ist `FrameBuffer::close()`, und seine Position in der Sequenz ist nicht verhandelbar: Er muss **vor** jedem blockierenden `wait()` auf Thread oder Pool kommen, denn er ist der einzige der vier Schritte, der **physisch weckt**, wer in einer `QWaitCondition` schläft — genau dieselbe Lektion wie in Modul 2, hier auf drei nebenläufige Stufen statt zwei angewendet:

```cpp
void MainWindow::startShutdownSequence(const QString &reason, bool earlyCancellation) {
    if (m_stopInProgress || !m_running) return;
    m_stopInProgress = true;

    if (earlyCancellation) {
        m_flag.requestStop();    // stop producing NEW frames
    }
    m_buffer->close();           // WAKES anyone blocked in wait() -- the step that matters

    // wait for real termination, but NEVER on the GUI thread (see below)
    QThread *captureThread = m_captureThread;
    QThreadPool *pool = m_pool;
    QFuture<void> future = QtConcurrent::run([captureThread, pool]() {
        captureThread->quit();
        captureThread->wait();
        pool->waitForDone();
    });
    // ... QFutureWatcher signals onPipelineFullyStopped() when done ...
}
```

Wird `close()` zuerst aufgerufen, wacht der in `produce()` blockierte Erfassungs-Thread sofort auf (`m_notFull.wakeAll()` innerhalb von `close()`), sieht `m_closed == true`, und `produce()` gibt `false` zurück — seine `start()` verlässt die Schleife und kehrt zurück, der Thread kehrt zu seiner eigenen Event-Loop zurück, und erst jetzt entfaltet das zuvor eingereihte `quit()` seine tatsächliche Wirkung. Dasselbe gilt spiegelbildlich für jeden `FrameWorkerTask`, der eventuell in `consume()` bei leerem Puffer blockiert ist.

### Warum die abschließende Wartezeit nicht auf dem GUI-Thread stehen darf

Es gibt eine zweite Falle, weniger dramatisch als ein Deadlock, aber nicht weniger wichtig: sowohl `QThread::wait()` als auch `QThreadPool::waitForDone()` sind **blockierende** Aufrufe. Selbst nachdem das Deadlock-Problem mit `close()` gelöst ist, würde ein direkter Aufruf im mit dem Stop-Button verbundenen Slot den GUI-Thread für die gesamte Dauer des Abflusses blockieren — was bei Workern, die noch mitten in einem 200-Millisekunden-Frame stecken, spürbar sein kann. Es ist genau dieselbe Lektion aus Modul 0, dem allerersten Kapitel des gesamten Kurses („den GUI-Thread niemals blockieren"), die hier im Maßstab der gesamten Pipeline zurückkehrt: Die Lösung besteht darin, das Warten mit `QtConcurrent::run()` aus dem GUI-Thread herauszunehmen (Modul 3, hier für eine andere Aufgabe verwendet als die, für die du es gelernt hast — nicht Daten verarbeiten, sondern *warten*, bis andere Threads fertig sind) und mit einem `QFutureWatcher`, der `onPipelineFullyStopped()` aufruft, sobald der Abfluss wirklich abgeschlossen ist, über eine queued Verbindung zum GUI-Thread (Modul 4).

### Vorzeitiger Abbruch gegen natürliches Ende: nicht dasselbe

Eine letzte, feine, aber reale Unterscheidung: Drückt der Benutzer mitten in der Pipeline Stop, wird das kooperative Flag gesetzt, und jeder `FrameWorkerTask` prüft es, nachdem er den Frame beendet hat, den er gerade bearbeitet — er hört also auf, weitere zu entnehmen, selbst wenn der Puffer noch welche enthält. Das ist eine Entscheidung für Reaktionsfähigkeit: Der Benutzer hat verlangt, *jetzt* zu stoppen, nicht „wenn du die gesamte bereits eingereihte Arbeit erledigt hast". Endet die Erfassung dagegen von selbst, weil die gewünschte Frame-Anzahl erreicht ist, gibt es keine vergleichbare Dringlichkeit: Das Flag wird **nicht** gesetzt, und die Worker fahren fort, `consume()` zu leeren, bis der Puffer wirklich leer ist — jeder erfasste Frame gelangt garantiert zur Verarbeitung. Zwei Abschaltwege, dieselbe Sequenz `close()` → asynchrones Warten → Benachrichtigung, aber ein einziger bewusster Unterschied, und das ist der Unterschied zwischen „sofort anhalten" und „zu Ende bringen, was begonnen wurde": In der Arbeit mit Vision-Systemen ist das fast immer eine Unterscheidung, die der Maschinenbediener kontrollieren können möchte, kein Implementierungsdetail.

Nachdem die parallele Verarbeitung und die vollständige kooperative Abbruchbehandlung nun geklärt sind, führt dich der letzte Artikel dieses Moduls — und dieses Kurses — durch die GUI-Integration und das vollständige geführte Projekt: wie man es baut, wie man es kompiliert, und was man beobachten kann, wenn man es tatsächlich ausführt.
