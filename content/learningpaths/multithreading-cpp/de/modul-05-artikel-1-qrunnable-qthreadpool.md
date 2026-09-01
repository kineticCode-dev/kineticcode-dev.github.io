---
title: "QRunnable und QThreadPool: ein Pool von Aufgaben, nicht ein Thread pro Aufgabe"
description: "Multithreading in C++ mit Qt — Modul 5"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QRunnable und QThreadPool: ein Pool von Aufgaben, nicht ein Thread pro Aufgabe

Im Modul 2 hast du gelernt, geteilten Speicher mit `QMutex` zu schützen und Threads mit `QWaitCondition` zu koordinieren. Das ganze Modul stützte sich auf eine Grundidee, die es jetzt wert ist, explizit gemacht zu werden: Ein Mutex ist ein *allgemeines* Werkzeug, das schützt, was auch immer du hineinlegst, um den Preis eines Mechanismus, der bei jedem Erwerb potenziell den Scheduler des Betriebssystems einbezieht — und einen zum Warten gebrachten Thread wieder zur Ausführung zu bringen, hat reale Kosten, nicht null, wie du im Modul 0 beim Thema Kontextwechsel gesehen hast.

Dieses Modul beginnt mit einer unbequemen, aber ehrlichen Frage: Sind diese Kosten immer notwendig? Die Antwort lautet, wie so oft in der Ingenieurskunst, "es kommt darauf an" — und dieser erste Artikel behandelt die eher organisatorische Ebene des Problems, bevor wir im nächsten auf die physische Ebene von Cache und Speichermodell hinabsteigen.

## Das Problem, das ein dauerhafter QThread nicht gut löst

Denk zurück an das Muster aus den Modulen 1, 2 und 4: ein erzeugter `QThread`, ein mit `moveToThread()` darauf verschobener Worker, ein sorgfältig verwalteter Lebenszyklus (`start()`, `quit()`, `wait()`). Das ist das richtige Muster, wenn die Arbeit *kontinuierlich* ist — ein Producer, der über die gesamte Lebensdauer des Programms läuft, ein Worker, der einen konstanten Strom von Videobildern verarbeitet. Aber was passiert, wenn dein Problem anders gelagert ist: Du hast hundert Bilder, die *einmal*, parallel, verarbeitet werden müssen, und dann ist diese Arbeit erledigt? Hundert `QThread`, einen pro Bild, zu erzeugen, wäre absurd — das Erzeugen eines Betriebssystem-Threads hat nicht zu vernachlässigende Kosten (Stack-Allokation, Registrierung beim Scheduler, typischerweise mehrere Dutzend Mikrosekunden selbst auf einem modernen System), und hundert Threads, die jeweils nur wenige Millisekunden leben, würden einen enormen Anteil ihrer Gesamtzeit einfach mit Entstehen und Vergehen verbringen, nicht mit Arbeiten.

Die klassische Lösung, so alt wie die nebenläufige Programmierung selbst, ist der **Thread-Pool**: eine feste Anzahl von Worker-Threads, einmalig beim Start erzeugt, die am Leben bleiben und sich anstellen, um sich die nächste verfügbare Arbeit aus einer gemeinsamen Warteschlange zu "ziehen" (pull), statt jedes Mal neu erzeugt zu werden.

![QRunnable + QThreadPool: queued tasks consumed by a fixed set of worker threads](modulo-05/21-qrunnable-qthreadpool.png)

## QRunnable: die Aufgabe, nicht der Thread

In Qt schreibt man eine Arbeitseinheit, die an einen Pool übergeben wird, indem man `QRunnable` ableitet und nur eine einzige Methode überschreibt, `run()`:

```cpp
class ImageProcessingTask : public QRunnable {
public:
    explicit ImageProcessingTask(int imageId) : m_imageId(imageId) {}

    void run() override {
        // the actual work, executed on one of the pool's threads
        processImage(m_imageId);
    }

private:
    int m_imageId;
};
```

Beachte den begrifflichen Unterschied zu einem `QObject`-Worker, der mit `moveToThread()` verschoben wird: Ein `QRunnable` **ist kein** `QObject`, hat keine eigenen Signale, hat keine Thread-Affinität in dem Sinn, den du aus Modul 1 kennst. Es ist bewusst ein ärmeres und leichteres Werkzeug: Es repräsentiert *die zu erledigende Arbeit*, nicht *wer sie erledigt*. Das "wer" entscheidet der Pool im laufenden Betrieb, je nachdem, welcher Worker-Thread als Erster frei wird — und das muss nicht bei jeder Ausführung derselbe Thread sein, eine Frage, die sich bei einem dauerhaften `QThread` gar nicht erst stellen würde.

## Die Aufgabe übergeben: QThreadPool

```cpp
// Qt's shared global pool
QThreadPool *pool = QThreadPool::globalInstance();
pool->start(new ImageProcessingTask(imageId));
```

`QThreadPool::globalInstance()` liefert einen von der gesamten Anwendung gemeinsam genutzten Pool zurück, standardmäßig bemessen nach der Anzahl der logischen Kerne der Maschine (`QThread::idealThreadCount()`) — dieselbe physische Kennzahl wie `std::thread::hardware_concurrency()`, die dir im geführten Projekt des nächsten Artikels wiederbegegnen wird. Du kannst auch einen eigenen, unabhängigen `QThreadPool` konstruieren, wenn du eine bestimmte Art von Arbeit vom Rest isolieren willst (zum Beispiel um zu verhindern, dass die Bildverarbeitung im Hintergrund mit dringenderen Aufgaben konkurriert, die über den globalen Pool laufen):

```cpp
QThreadPool dedicatedPool;
dedicatedPool.setMaxThreadCount(4);
dedicatedPool.start(new ImageProcessingTask(imageId));
```

## Wer zerstört das QRunnable? setAutoDelete

Hier gibt es ein Detail der Speicherverwaltung, das, wenn man es ignoriert, entweder ein Leck oder einen Absturz durch doppeltes `delete` erzeugt. Standardmäßig ist `QRunnable::autoDelete()` `true`: Der Pool zerstört das Objekt nach Abschluss von `run()` selbst mit `delete`. Deshalb schreiben wir im obigen Beispiel `new ImageProcessingTask(...)` und kümmern uns nicht weiter darum — der Pool übernimmt das. Wenn du hingegen dasselbe `QRunnable` mehrfach wiederverwenden musst, oder es nach der Ausführung am Leben halten willst, um ein Ergebnis auszulesen, musst du dieses Verhalten explizit deaktivieren, **bevor** du es übergibst:

```cpp
ImageProcessingTask *task = new ImageProcessingTask(imageId);
task->setAutoDelete(false);
pool->start(task);
pool->waitForDone();      // wait for all submitted tasks to finish
delete task;              // the responsibility is yours again now
```

`waitForDone()` blockiert den Aufrufer, bis der Pool alle in der Warteschlange befindlichen Aufgaben abgearbeitet hat — nützlich in einem Batch-Kontext, wo ein klarer Synchronisationspunkt gebraucht wird, deutlich weniger nützlich in einem reaktiven Kontext, in dem die GUI am Leben bleiben soll (in diesem Fall wirst du, wie im Modul 3 mit `QFutureWatcher`, einen benachrichtigungsbasierten Mechanismus einer blockierenden Wartezeit vorziehen).

## Die Verbindung zu QtConcurrent, jetzt explizit gemacht

Im Modul 3 hast du `QtConcurrent::run()` und `QtConcurrent::mapped()` verwendet, ohne je ein `QRunnable` oder einen `QThreadPool` zu Gesicht zu bekommen — und genau das ist der Punkt: **Du hast sie nicht gesehen, weil Qt sie für dich hinter den Kulissen erzeugt**. Jeder Aufruf von `QtConcurrent::run(funktion)` verpackt intern `funktion` in ein automatisch generiertes `QRunnable` und übergibt es an `QThreadPool::globalInstance()` — genau denselben Pool, den du gerade in diesem Artikel gelernt hast, von Hand zu benutzen. `QtConcurrent::mapped()` macht dasselbe, vervielfacht für jedes Element der zu verarbeitenden Sequenz, mit dem einzigen Zusatz der Logistik, um die Teilergebnisse in einem `QFuture` zu sammeln. Das ist keine ähnliche Implementierung, das ist **derselbe Motor**: Wenn du `pool->start(new ImageProcessingTask(...))` schreibst, tust du von Hand und explizit genau das, was `QtConcurrent::run()` implizit für dich erledigt.

Das zu wissen sagt dir auch, wann es sich lohnt, auf die Ebene von direktem `QRunnable` hinabzusteigen, statt bei `QtConcurrent` zu bleiben: wenn du unterschiedliche Prioritäten zwischen Aufgaben brauchst (`QThreadPool::start()` akzeptiert einen optionalen Prioritätsparameter), oder einen eigenen, vom globalen getrennten Pool, oder eine feinere Kontrolle über den Lebenszyklus der einzelnen Aufgabe — alles Dinge, die die bequemere, aber undurchsichtigere Schnittstelle von `QtConcurrent` nicht offenlegt.

Mit `QRunnable` und `QThreadPool` eingeordnet, und ihrer Verbindung zu `QtConcurrent` endlich explizit gemacht, steigt der nächste Artikel eine Ebene tiefer: Was garantiert `std::atomic` wirklich, erklärt nicht als Liste von Schlüsselwörtern zum Auswendiglernen, sondern ausgehend davon, was physisch in einem Mehrkern-Prozessor passiert.
