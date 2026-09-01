---
title: "Auf ein Ereignis warten, nicht auf einen Lock: QWaitCondition, QSemaphore, und wie man sich damit ins eigene Bein schießt"
description: "Multithreading in C++ mit Qt — Modul 2"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Auf ein Ereignis warten, nicht auf einen Lock: QWaitCondition, QSemaphore, und wie man sich damit ins eigene Bein schießt

Im vorherigen Artikel haben wir gesehen, wie man ein gemeinsam genutztes Datum mit `QMutex` und `QReadWriteLock` schützt. Aber das Producer-Consumer-Problem muss eine andere, subtilere Frage beantworten: "Der Puffer ist voll — ich muss warten, bis sich *etwas ändert*, nicht nur, bis der Lock frei wird." Ein Mutex allein reicht nicht aus, um "warte, bis eine bestimmte Bedingung über die Daten wahr wird" auszudrücken: Entweder du hältst ihn für immer in einer Schleife fest, die ständig neu prüft (aktives Warten, das unnötig CPU verschwendet), oder du brauchst ein Werkzeug, das genau dafür gemacht ist. Dieses Werkzeug ist `QWaitCondition`.

## QWaitCondition: auf ein Ereignis warten, nicht nur auf einen freien Lock

Eine `QWaitCondition` erlaubt es einem Thread, **einzuschlafen**, während er einen Mutex, den er hält, vorübergehend freigibt, in Wartestellung zu bleiben, bis ein anderer Thread ihn explizit **weckt**, und erst dann den Mutex wieder zu erwerben und fortzufahren. Der entscheidende Teil, der sie von einem einfachen "schlafe und prüfe erneut" unterscheidet, ist, dass das Einschlafen und die Freigabe des Mutex als eine einzige atomare Operation ablaufen: Es gibt nie ein Zeitfenster, in dem der Thread den Lock schon freigegeben hat, aber noch nicht als "wartend" registriert ist — ein Fenster, das sonst dazu führen könnte, dass ein genau in diesem Moment gesendetes Aufwecksignal verloren geht (ein klassischer Fehler namens *lost wakeup*, den `QWaitCondition` konstruktionsbedingt verhindert).

Das Verwendungsmuster ist immer dasselbe:

```cpp
QMutex mutex;
QWaitCondition condition;
bool dataReady = false;

// Waiting thread:
QMutexLocker locker(&mutex);
while (!dataReady) {
    condition.wait(&mutex);   // releases the mutex, sleeps, reacquires it on wake-up
}
// the mutex is back in my hands here, and dataReady is true

// Notifying thread:
{
    QMutexLocker locker(&mutex);
    dataReady = true;
}
condition.wakeOne();   // or wakeAll(), if more than one thread must be woken
```

Beachte das `while`, nicht ein einfaches `if`: Das ist Absicht, keine stilistische Pedanterie. Beim Aufwachen **muss** der Code die Bedingung, auf die er gewartet hat, von Neuem prüfen, weil es "spurious wakeups" geben kann (aus internen Gründen des Betriebssystems, ohne dass wirklich jemand `wakeOne()` aufgerufen hat), oder weil — im Fall von `wakeAll()` mit mehreren wartenden Threads — ein anderer Thread dir zuvorgekommen sein und bereits verbraucht haben könnte, worauf du gewartet hast, bevor du wirklich wieder die Kontrolle übernommen hast. Ein `if` anstelle des `while` ist einer der häufigsten und am schwersten zu findenden Fehler in Code, der auf Wait Conditions basiert: Er funktioniert fast immer in Tests und schlägt selten fehl — in der Produktion, in einem Moment, den niemand auf Kommando reproduzieren kann.

`wakeOne()` weckt genau einen wartenden Thread (wenn es mehrere gibt, ist nicht festgelegt, welcher — verlass dich nie auf eine bestimmte Reihenfolge); `wakeAll()` weckt sie alle, von denen jeder trotzdem seine eigene Bedingung erneut prüft (daher, wieder, die Wichtigkeit des `while`) und gegebenenfalls zurück ins Warten geht, falls die Bedingung für ihn noch nicht die richtige ist.

Im praktischen Projekt dieses Moduls wirst du **zwei** verschiedene `QWaitCondition`-Objekte für denselben Puffer verwenden: eine für die Richtung "der Puffer ist voll, der Producer wartet", eine für "der Puffer ist leer, der Consumer wartet". Das ist ein Standardmuster, und es mit eigenen Händen angewendet zu sehen, wird viel mehr klären als jede weitere abstrakte Erklärung.

## QSemaphore: zählen statt auf einen Booleschen Wert warten

Es gibt eine letzte Primitive, die es zu kennen lohnt, auch wenn wir sie heute nicht direkt verwenden werden: `QSemaphore`. Ein Semaphor (im informatischen Sinn des Begriffs, ein Konzept, das auf Dijkstra in den 1960er-Jahren zurückgeht) ist konzeptionell ein nicht-negativer ganzzahliger Zähler mit zwei Operationen: `acquire()`, das den Zähler dekrementiert, aber den Aufrufer **blockiert**, wenn der Zähler bereits bei null steht, und wartet, bis er wieder positiv wird; und `release()`, das den Zähler inkrementiert und eventuell auf `acquire()` wartende Threads weckt.

Warum ist das nützlich? Weil es auf natürliche Weise das Konzept "N austauschbare Ressourcen verfügbar" ausdrückt — nicht "der Puffer ist voll oder leer" im booleschen Sinn, sondern "wie viele freie Plätze gibt es gerade", explizit gezählt. Das Producer-Consumer-Problem dieses Moduls lässt sich auch auf diese Weise lösen, und es ist lehrreich, die Entsprechung zu sehen: zwei Semaphoren, `freeSlots`, initialisiert auf die Kapazität des Puffers, und `usedSlots`, initialisiert auf null, wobei der Producer `freeSlots.acquire()` vor dem Einfügen und `usedSlots.release()` danach aufruft, und der Consumer genau das Gegenteil tut. Das Endergebnis ist verhaltensmäßig äquivalent zu dem, was wir mit `QWaitCondition` bauen — es ist dieselbe Idee, dasselbe Paar von Bedingungen "voll" und "leer", nur ausgedrückt mit einem Zähler statt mit einem Booleschen Wert und zwei expliziten Wait Conditions.

Welchen der beiden Stile solltest du im echten Code wählen, den du nach diesem Kurs schreibst? `QWaitCondition` (die wir heute verwenden) ist das richtige Werkzeug, wenn die Wartebedingung reichhaltiger ist als eine bloße Zählung — zum Beispiel "warte, bis der Puffer *ein Element mit einer bestimmten Eigenschaft* enthält", nicht nur "warte, bis er nicht mehr leer ist". `QSemaphore` ist direkter und lesbarer, wenn dein Problem buchstäblich eine Zählung verfügbarer Ressourcen ist — ein Verbindungspool, eine feste Anzahl von Hardware-Slots, eine Obergrenze für die Anzahl gleichzeitig erlaubter Operationen. Keines von beiden ist "überlegen": Wähle das, was die tatsächliche Form des Problems treuer widerspiegelt.

## Deadlock: das zirkuläre Warten

Mutex und Wait Condition einzuführen, ohne darüber zu sprechen, wie man sich damit ins eigene Bein schießt, wäre unredlich. Drei Fallstricke, geordnet danach, wie häufig sie in der Praxis auftreten.

Ein **Deadlock** tritt auf, wenn zwei (oder mehr) Threads für immer blockiert bleiben, jeder wartend auf eine Ressource, die ein anderer Thread der Gruppe hält und nie freigeben wird — weil er seinerseits auf etwas wartet, das der erste hält. Thread A hält Mutex X und wartet darauf, Mutex Y zu erwerben; Thread B hält zur gleichen Zeit Y und wartet auf X. Keiner von beiden kann fortfahren, keiner von beiden wird jemals das freigeben, was er hat (weil er dafür erst seine eigene Arbeit beenden müsste, die aber blockiert ist), und das Programm bleibt einfach still stehen, für immer — kein Absturz, keine Fehlermeldung, einfach zwei Threads, die nichts mehr tun.

![Deadlock: circular waiting](modulo-02/11-deadlock-circular-wait.png)

Die Bedingung, die dieses Szenario ermöglicht, hat in der klassischen Betriebssystemliteratur einen Namen (die "Coffman-Bedingungen", benannt nach einem der Autoren des Artikels von 1971, der sie erstmals formalisiert hat), und es sind vier, alle gleichzeitig notwendig, damit ein Deadlock auftreten kann: wechselseitiger Ausschluss (die Ressourcen können nicht geteilt werden), Halten-und-Warten (ein Thread hält eine Ressource, während er auf eine andere wartet), keine Präemption (eine Ressource kann ihrem Besitzer nicht mit Gewalt entrissen werden), und **zirkuläres Warten** (es existiert ein Zyklus von Threads, von denen jeder auf eine Ressource wartet, die der nächste im Zyklus hält). Von diesen vier sind die ersten drei fast immer dem Problem, das du löst, inhärent — du kannst sie nicht eliminieren, ohne die Lösung zu verfälschen. Die vierte, das zirkuläre Warten, ist hingegen diejenige, auf die du praktisch Einfluss hast, und deshalb läuft jeder Leitfaden zum Thema Deadlock auf dieselbe Empfehlung hinaus: **Lege eine feste, globale Reihenfolge fest, in der Locks immer erworben werden**, an jeder Stelle des Programms, ohne Ausnahmen. Wenn jeder Thread, der sowohl X als auch Y braucht, sie immer in derselben Reihenfolge erwirbt (sagen wir, immer zuerst X, dann Y, nie umgekehrt), wird der Zyklus strukturell unmöglich: Es kann kein zirkuläres Warten geben, wenn sich alle in dieselbe Richtung anstellen.

Im heutigen praktischen Projekt ist das Deadlock-Risiko gering, weil wir nur einen Mutex verwenden (den internen des Puffers) — aber es ist ein Risiko, das rasch wächst, sobald ein reales Projekt anfängt, mehrere separat geschützte Ressourcen zu haben, und deshalb lohnt es sich, das Prinzip schon jetzt fest zu verankern, bevor du es unter Druck brauchst, mit geöffnetem Debugger und einem Programm, das nicht mehr reagiert.

## Starvation: technisch am Leben, faktisch vergessen

**Starvation** (Aushungerung) ist heimtückischer als Deadlock, weil sie nicht alles blockiert: Ein bestimmter Thread bekommt einfach nie die Ressource, die er braucht, obwohl es theoretisch keinen Wartezyklus gibt, der das verhindert — er wird immer von anderen, "glücklicheren" oder in ihren Anfragen häufigeren Threads überholt. Es ist genau die Verletzung der dritten Eigenschaft aus dem vorherigen Artikel, des beschränkten Wartens. `wakeOne()` auf einer `QWaitCondition` mit vielen wartenden Threads garantiert zum Beispiel keine faire Aufweckreihenfolge (sie ist nicht notwendigerweise FIFO) — in Szenarien mit sehr hoher Konkurrenz und unausgewogenen Zugriffsmustern ist es theoretisch möglich, dass derselbe Thread länger unglücklich bleibt, als man erwarten würde. Für unser praktisches Projekt, mit nur einem Producer und einem Consumer, ist dieses Risiko konstruktionsbedingt null (es gibt niemanden zu überholen); es wird zu einem realen Faktor, sobald dein System auf mehrere Producer oder mehrere Consumer am selben Puffer wächst.

## Prioritätsinversion: wenn das Betriebssystem einen dritten Störenfried hinzufügt

Ein letzter Fallstrick, seltener, aber es lohnt sich, ihn beim Namen zu kennen, weil er, wenn er auftritt, besonders schwer zu diagnostizieren ist: die **Prioritätsinversion**. Sie passiert, wenn ein Thread mit **niedriger Priorität** einen Lock hält, den ein Thread mit **hoher Priorität** braucht; letzterer blockiert im Warten, was für sich genommen schon normal wäre — aber wenn währenddessen ein dritter Thread mit **mittlerer Priorität** (der diesen Lock gar nicht braucht) die CPU besetzt hält, räumt der Scheduler ihm weiterhin Platz ein, auf Kosten des Threads mit niedriger Priorität, der den Lock hält und seine Arbeit nicht beenden und ihn freigeben kann. Das Nettoergebnis ist, dass der Thread mit hoher Priorität indirekt von einem mit mittlerer Priorität blockiert wird — eine vollständige Umkehrung der Prioritätsordnung, die das System eigentlich hätte respektieren sollen.

Es ist ein Problem, das real genug ist, um historisch das Beinahe-Scheitern der NASA-Mission Mars Pathfinder im Jahr 1997 verursacht zu haben — ein Fallbeispiel, das in der Literatur genau deshalb sehr häufig zitiert wird. Die Details erzähle ich in einem eigenen Artikel, weil es sich lohnt, genau zu verstehen, wie ein Synchronisationsproblem auf einem Rover in 225 Millionen Kilometer Entfernung sich in einen periodischen Reset des gesamten Systems verwandelte, und wie es diagnostiziert und gelöst wurde — siehe *"Mars Pathfinder: Wenn Prioritätsinversion den Mars erreicht"*.

Die klassische Abhilfe auf Betriebssystemebene heißt *Priority Inheritance* (Prioritätsvererbung): Vorübergehend "erbt" der Thread mit niedriger Priorität, der den umkämpften Lock hält, die Priorität des höherpriorisierten Threads, der auf ihn wartet, sodass der Scheduler ihn ausreichend bevorzugt, damit er die Arbeit beenden und den Lock freigeben kann. Qt handhabt das nicht automatisch auf Anwendungsebene — es ist typischerweise Aufgabe des Schedulers des zugrundeliegenden Betriebssystems —, aber zu wissen, dass das Phänomen existiert, und seine Symptome zu erkennen (ein rätselhaft langsamer Thread hoher Priorität bei Last durch Threads mittlerer Priorität), wird dir Stunden Debugging ersparen, an dem Tag, an dem du ihm in einem System mit Echtzeitanforderungen begegnest.

## Von der Theorie zu den Händen auf der Tastatur

Du hast jetzt alle Werkzeuge, um echten gemeinsam genutzten Zustand zu schützen und zu koordinieren: `QMutex`, `QReadWriteLock`, `QWaitCondition`, `QSemaphore`, und das Vokabular, um Deadlock, Starvation und Prioritätsinversion zu erkennen, wenn du ihnen begegnest. Im nächsten Artikel fügen wir alles zusammen, indem wir einen echten Producer-Consumer bauen, mit zwei dauerhaften Threads, die sich vor deinen Augen um einen begrenzten Puffer streiten.
