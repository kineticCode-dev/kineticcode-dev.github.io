---
title: "QThread ist nicht der Thread: er ist eine Fernbedienung (und warum ihn zu unterklassen täuscht)"
description: "Multithreading in C++ mit Qt — Modul 1"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# QThread ist nicht der Thread: er ist eine Fernbedienung (und warum ihn zu unterklassen täuscht)

Im vorherigen Artikel hast du das Problem mit eigenen Augen gesehen: ein Button, der beim Klick den Herzschlag des Fensters für einige Sekunden zum Stillstand bringt, weil der Slot, der auf den Klick reagiert, eine schwere Berechnung direkt auf dem Thread ausführt, der die Event-Loop der GUI besitzt. Dieser Artikel beginnt die Behandlung, und es lohnt sich, gleich von Anfang an ehrlich zu einer Sache zu sein: `QThread` ist wahrscheinlich die in ihrer Geschichte am meisten missverstandene Klasse der gesamten Qt-Bibliothek — nicht aus Schuld derer, die sie benutzen, sondern wegen eines präzisen historischen Unfalls. Jahrelang haben die offizielle Qt-Dokumentation selbst und ihre Beispiele eine Verwendungsweise gelehrt, die ein Ingenieur des Qt-Teams persönlich in einem Artikel aus dem Jahr 2010, der in der Qt-Community legendär geworden ist, öffentlich mit *"You're doing it wrong"* betitelt hat — "du machst es falsch" — bezogen auf die Art, wie sogar die offiziellen Beispiele des Frameworks sie bis dahin präsentierten. Wenn du irgendwo gelesen hast, oder dich aus einem vor Jahren gesehenen Tutorial erinnerst, dass "man, um QThread zu benutzen, davon eine Unterklasse erstellen und `run()` überschreiben muss", ist es nicht deine Schuld, dass es wie der natürliche Weg erschien: es war, buchstäblich, das, was Qt selbst lehrte.

## QThread ist nicht "der Thread": es ist eine Fernbedienung

Beginne mit einem Intuitionsfehler, der so verbreitet ist, dass es sich lohnt, ihn sofort zu entlarven, bevor du auch nur eine Zeile Code schreibst: Wenn du ein `QThread`-Objekt erzeugst, **ist** dieses Objekt nicht der Betriebssystem-Thread. Es ist ein `QObject` — eine C++-Klasse wie jede andere, mit ihrem Konstruktor, ihren Methoden, ihrer Position im Qt-Verwandtschaftsbaum — die einen Betriebssystem-Thread **repräsentiert und steuert**, ein bisschen wie die Fernbedienung eines Fernsehers nicht der Fernseher selbst ist: du schaltest ihn ein, aus, wechselst den Kanal, aber die Fernbedienung selbst liegt bequem auf deinem Sofa, nicht im Gerät.

Wenn du `QThread *thread = new QThread(this);` schreibst, sagen wir, im Konstruktor deiner `MainWindow`, entsteht und lebt diese `QThread`-Instanz **auf dem Thread, auf dem du sie erzeugt hast** — fast immer der Hauptthread der GUI, genau wie jedes andere `QObject`, das du dort konstruierst. Sie hat eine Handvoll Methoden, die ihr "Bedienfeld" bilden: `start()`, um den von ihr verwalteten Betriebssystem-Thread zu starten, `quit()`, um ihn höflich zu bitten, seine Event-Loop zu beenden, `wait()`, um zu blockieren, bis dieser Thread wirklich beendet ist, `isRunning()`, um seinen Status abzufragen. Diese Methoden vom Hauptthread aus aufzurufen ist sicher, gerade weil das `QThread`-Objekt selbst dort lebt.

![QThread is not the thread: it's a remote control](modulo-01/05-qthread-is-a-remote-control.png)

Wenn du `thread->start()` aufrufst, geschieht etwas Eigenständiges und Getrenntes: Qt führt den Systemaufruf aus, der wirklich einen neuen Betriebssystem-Thread erzeugt (derselbe zugrundeliegende Mechanismus wie `std::thread`, dem du bereits zuvor begegnet bist), und auf diesem neuen Thread startet es die Ausführung der virtuellen Methode `QThread::run()`. Wenn du sie nicht überschrieben hast — und im Pattern, das wir in diesem Artikel übernehmen, werden wir sie nie überschreiben —, tut die Standardimplementierung von `run()` einfach eines: Sie ruft `exec()` auf, das heißt, sie startet eine **Event-Loop** auf diesem neuen Thread, konzeptionell identisch mit der, die der Hauptthread mit `QApplication::exec()` beim Start der Anwendung startet. Von diesem Moment an existiert dieser Betriebssystem-Thread für einen genauen Zweck: auf Ereignisse zu warten (in diesem Fall fast immer Signale, die von anderen Threads eintreffen) und sie eines nach dem anderen, der Reihe nach, zu verarbeiten — genau wie der GUI-Thread, nur dass diese zweite Event-Loop nun auf einem völlig getrennten Thread läuft.

## Das alte Pattern: QThread unterklassen (und warum es täuscht)

Der natürliche Instinkt, wenn du Code auf einem separaten Thread mithilfe einer objektorientierten Klasse wie `QThread` laufen lassen willst, ist dieser: Ich erstelle eine eigene Klasse, die von `QThread` erbt, packe die Logik hinein, die auf dem separaten Thread laufen soll, vielleicht auch ein paar Slots, um Befehle zu empfangen. Im Code:

```cpp
class MyThread : public QThread {
    Q_OBJECT
public:
    void run() override {
        // heavy work here
    }

public slots:
    void otherMethod() {
        // ... here comes the surprise
    }
};
```

Dieser Code kompiliert, und der Teil in `run()` läuft genau dort, wo du es erwartest: auf dem Betriebssystem-Thread, den diese Instanz verwaltet, weil `run()` genau die Methode ist, die Qt auf diesem Thread aufruft, sobald er startet. So weit, ganz der Intuition entsprechend. Das Problem, das den Artikel "You're doing it wrong" und Jahre verwirrter Bug-Reports in Qt-Foren hervorgebracht hat, betrifft `otherMethod()`: Es ist ein in derselben Klasse deklarierter Slot, läuft aber **überhaupt nicht auf dem von dieser Instanz verwalteten Thread**. Er läuft auf dem Thread, der das `MyThread`-Objekt selbst **besitzt** — also fast immer der Hauptthread, der es mit `new MyThread()` erzeugt hat. Der Grund ist derselbe wie zuvor: Ein `QObject` (und `QThread` ist trotzdem ein `QObject`, mit der gesamten Signal-Slot-Infrastruktur, die das mit sich bringt) führt seine eigenen Slots auf dem Thread aus, dem es **gehört** — seine Thread-Affinität — nicht auf dem Thread, den es eventuell als "Inhalt" von `run()` verwaltet. `run()` ist ein Sonderfall, die einzige Methode, bei der Qt garantiert, dass sie wirklich auf dem verwalteten Thread läuft; jeder andere Slot derselben Klasse folgt der allgemeinen Regel, nicht dieser Ausnahme.

Historisch hat das Entwickler dazu gebracht, Code zu schreiben, der in einfachen Fällen zu funktionieren schien — wenn das Einzige, was gebraucht wird, ein isolierter Berechnungsblock ist, ohne dass später Befehle über Signale empfangen werden müssen — und still zu brechen, sobald dieser Thread während der Ausführung auch auf externe Ereignisse reagieren musste, mit Race Conditions oder unerklärlichem Verhalten, das niemand diagnostizieren konnte, ohne eben jenen Artikel von 2010 gelesen zu haben.

## Das empfohlene Pattern: Worker-Objekt und moveToThread()

Die Lösung, die die Qt-Community (und heute die offizielle Dokumentation selbst) empfiehlt, kehrt den Ansatz um: **`QThread` niemals unterklassen**. Benutze es immer so, wie es ist, identisch in jedem Projekt — die Fernbedienung von vorhin, unverändert. Die Geschäftslogik hingegen kommt in eine separate Klasse, die nur von `QObject` erbt — wir nennen sie üblicherweise den **Worker** — und die nichts von Threads oder `QThread` weiß, noch sich dafür interessiert. Sie ist ein reines Stück Logik. Dann erledigt eine einzige Methode die ganze Magie:

```cpp
worker->moveToThread(thread);
```

`moveToThread()` ändert die **Thread-Affinität** des `worker`-Objekts: Ab diesem Moment "gehört" dieses Objekt zu `thread` statt zu dem Thread, der es erzeugt hat, und — das ist der entscheidende Teil — **jeder seiner Slots, aufgerufen über eine queued Verbindung, läuft auf dem von `thread` verwalteten Thread**, ohne Ausnahmen, ohne Sonderfälle, die man sich merken müsste.

![Thread affinity before and after moveToThread](modulo-01/08-thread-affinity-before-after.png)

Es gibt eine technische Einschränkung, die du kennen solltest, weil du sie gleich im praktischen Projekt antreffen wirst: Ein `QObject` **mit einem Elternobjekt** (im Sinne des Qt-Verwandtschaftsbaums, `new Worker(this)`) **kann nicht** mit `moveToThread()` verschoben werden — der Aufruf schlägt still mit einer Laufzeitwarnung fehl, nicht mit einem Kompilierfehler, was ihn zu einer leicht zu übersehenden Falle macht. Der Grund ist logisch, sobald man darüber nachdenkt: Der Qt-Verwandtschaftsbaum geht davon aus, dass ein Elternobjekt und seine Kinder auf demselben Thread leben (so funktioniert zum Beispiel die kaskadierende Zerstörung); ein Kind auf einen anderen Thread als den des Elternobjekts zu verschieben würde diese Garantie brechen. Die praktische Konsequenz ist, dass dein Worker **ohne Elternobjekt** konstruiert werden muss — `new PrimeCalculator()`, nicht `new PrimeCalculator(this)` —, und sein Lebenszyklus explizit von dir verwaltet wird, wie wir im nächsten Artikel zum Thema Lebenszyklus sehen werden.

![Comparing the two patterns: subclassing QThread versus worker plus moveToThread](modulo-01/07-subclass-vs-movetothread-comparison.png)

Mit diesem Pattern bleibt `QThread` ein anonymes, nie angepasstes Objekt, identisch wiederverwendbar in jedem Qt-Projekt, das du von nun an schreibst; der Worker, eine ganz normale `QObject`-Klasse mit ihren Slots und Signalen, trägt die gesamte Logik — und **jeder** seiner Slots läuft, ohne Ausnahmen, die man sich merken müsste, korrekt auf dem verwalteten Thread. Genau das ist das Pattern, das wir gemeinsam im praktischen Projekt dieses Moduls aufbauen.

## Was noch zu verstehen bleibt

Du kennst jetzt den Unterschied zwischen dem `QThread`-Objekt und dem Thread, den es verwaltet, und warum das Unterklassen von `QThread` fast immer die falsche Wahl gegenüber dem Pattern Worker + `moveToThread()` ist. Es bleibt eine offensichtliche praktische Frage: Wenn der Worker jetzt auf einem anderen Thread lebt, wie sage ich ihm vom GUI-Thread aus "beginne die Berechnung", und wie lasse ich mir von ihm "ich bin fertig" zurück auf die GUI melden, ohne die Race Conditions wieder einzuführen, die wir studiert haben? Das ist das Thema des nächsten Artikels, zusammen mit dem vollständigen Lebenszyklus eines Worker-Threads — und dann, endlich, Hand an die Tastatur, um den Freeze aus dem vorherigen Modul wirklich zu heilen.
