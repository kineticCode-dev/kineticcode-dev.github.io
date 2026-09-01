---
title: "Der kritische Abschnitt formalisiert: QMutex, QMutexLocker und QReadWriteLock"
description: "Multithreading in C++ mit Qt — Modul 2"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# Der kritische Abschnitt formalisiert: QMutex, QMutexLocker und QReadWriteLock

Im vorherigen Modul hast du gelernt, Arbeit auf einem separaten Thread laufen zu lassen und sie sicher mit der GUI kommunizieren zu lassen — aber wenn du genau hinschaust, hast du nie einen echten Mutex gebraucht. Der Worker und das Fenster haben nie zur gleichen Zeit dieselbe Variable angefasst: Sie haben sich über Signale Nachrichten geschickt, und Qt hat sich darum gekümmert, diese der Reihe nach zuzustellen, eine nach der anderen, ohne Überlappung. Das ist eine elegante Art, das Problem des gemeinsam genutzten Speichers zu umgehen, indem man ihn eben nicht teilt — ein isolierter Worker mit eigenem privaten Zustand, der mit der Außenwelt nur über Signale spricht.

Dieser Artikel behandelt den Fall, in dem diese Eleganz nicht mehr ausreicht: zwei oder mehr Threads, die wirklich dieselbe **Datenstruktur** gleichzeitig lesen und schreiben müssen, weil genau diese gemeinsame Nutzung der Zweck des Programms ist — kein Nebeneffekt, den man vermeiden sollte. Es ist der klassische Fall, uralt in der Geschichte der Betriebssysteme und doch bis heute das tägliche Brot von allen, die ernsthaft nebenläufige Software schreiben: das **Producer-Consumer-Problem**. Ein Thread erzeugt Daten in einem Tempo, das er nicht vollständig kontrolliert (ein Sensor, ein Netzwerk, in einem Bildverarbeitungssystem eine Kamera, die Frames mit einer bestimmten Framerate liefert); ein anderer verarbeitet sie in einem anderen Tempo, fast immer langsamer und unregelmäßiger. Zwischen den beiden ein Lager begrenzter Kapazität — der **Puffer** — der die Geschwindigkeitsunterschiede bis zu einem gewissen Grad auffängt: Wenn der Producer zu schnell läuft, füllt sich das Lager und er muss warten; wenn dem Consumer die Arbeit ausgeht, wartet er.

## Der kritische Abschnitt, formalisiert

Du hast den kritischen Abschnitt bereits als "das Stück Code, das immer nur ein Thread ausführen darf" kennengelernt. Man kann ihn sich als Korridor mit einer einzigen Tür vorstellen, gerade breit genug für eine Person. Wer ankommt und die Tür besetzt vorfindet, wartet draußen in der Schlange; wer drinnen ist, geht, wenn er fertig ist, und erst dann darf der Nächste in der Schlange eintreten.

![The critical section as a one-way corridor](modulo-02/09-critical-section-corridor.png)

Aber "ein Thread nach dem anderen" allein reicht nicht aus, um eine *korrekte* Lösung zu definieren, und es lohnt sich, einmal schriftlich festzuhalten, welche drei Eigenschaften die klassische Betriebssystemtheorie von jedem Synchronisationsmechanismus verlangt — denn jedes Werkzeug, das wir in diesem Modul sehen werden, muss an diesen drei gemessen werden, nicht nur daran, ob es "in meinen Tests funktioniert".

**Wechselseitiger Ausschluss** (Mutual Exclusion): Nie mehr als ein Thread gleichzeitig im kritischen Abschnitt. Das ist die offensichtlichste Eigenschaft, bei der wir bereits verweilt haben, und kein Werkzeug, das wir heute sehen, verletzt sie jemals — es ist das absolute Minimum.

**Fortschritt** (Progress): Wenn der kritische Abschnitt frei ist und ein oder mehrere Threads hinein wollen, darf die Entscheidung, wer eintritt, nicht auf unbestimmte Zeit von Faktoren verschoben werden, die nichts mit der tatsächlichen Nutzung der Ressource zu tun haben. Anders gesagt: Es darf kein Szenario existieren, in dem die Tür frei ist, aber niemand jemals hindurchkommt, wegen eines Fehlers im Mechanismus selbst.

**Beschränktes Warten** (Bounded Waiting): Ein Thread, der darauf wartet einzutreten, muss es früher oder später auch schaffen — es ist nicht erlaubt, dass ihn jemand anderes unbegrenzt weiter überholt. Das ist die subtilste Eigenschaft, und genau sie gerät bei den **Starvation**-Problemen (Aushungerung) in die Krise, denen wir später begegnen: Ein Thread könnte theoretisch eintreten, die Garantie des wechselseitigen Ausschlusses wird nie verletzt, und trotzdem kommt er faktisch nie dran, weil der "Verkehr" im kritischen Abschnitt ihn immer überholt.

Behalte diese drei Eigenschaften als Maßstab im Kopf: Jedes Mal, wenn du ein Synchronisationsschema entwirfst — in diesem Modul oder in deiner echten Arbeit —, sind das die drei Fragen, die du dir in dieser Reihenfolge stellen solltest.

## QMutex und QMutexLocker: das Grundwerkzeug

`QMutex` ist Qts natives Äquivalent zu `std::mutex`, das du bereits im ersten Artikel dieses Kurses verwendet hast. Das konzeptionelle Verhalten ist identisch — `lock()` betritt den kritischen Abschnitt (wartet nötigenfalls), `unlock()` verlässt ihn — mit ein paar praktischen Unterschieden, die es zu kennen lohnt.

Es ist keine überflüssige Redundanz, dass Qt einen eigenen Mutex hat. `QMutex` existierte in Qt schon, bevor `std::mutex` Teil des C++-Standards wurde (erst mit C++11 gekommen), und bleibt heute die naheliegende Wahl in Qt-Code aus ein paar konkreten Gründen: Es integriert sich besser mit den Debug-Werkzeugen von Qt Creator (das den Zustand eines `QMutex` im Debugger lesbarer inspizieren kann), und vor allem bietet Qt, getrennt von `QMutex`, eine Klasse `QRecursiveMutex` für die (seltenen, und mit Misstrauen zu behandelnden) Fälle, in denen ein Thread denselben Lock mehrfach erwerben muss, ohne sich selbst zu blockieren — nützlich in Hierarchien rekursiver Aufrufe, die mehrfach durch denselben kritischen Abschnitt laufen, aber auch fast immer ein Warnsignal dafür, dass sich das Synchronisationsdesign vereinfachen ließe.

Genau wie `std::lock_guard` erwirbt `QMutexLocker` den Lock im Konstruktor und gibt ihn im Destruktor wieder frei:

```cpp
void SharedBuffer::produce(int value) {
    QMutexLocker locker(&m_mutex);
    // ... critical section ...
} // automatic unlock here, whichever way the function exits
```

Der Vorteil des RAII-Musters ist hier nicht nur ästhetischer Natur: Wenn im kritischen Abschnitt ein vorzeitiges `return` steht oder eine Ausnahme geworfen wird, garantiert `QMutexLocker` trotzdem die Entsperrung — ein von Hand geschriebenes `mutex.lock()` / `mutex.unlock()` würde dich in jedem dieser Fälle mit einem für immer blockierten Mutex zurücklassen, einer der heimtückischsten und am schwersten zu diagnostizierenden Fehler in der gesamten nebenläufigen Programmierung, weil das Symptom (das Programm hängt) zeitlich und im Code sehr weit von der Ursache (dem fehlenden `unlock()`) entfernt auftritt.

Neben `lock()` (blockierend, wartet so lange wie nötig) bietet `QMutex` auch `tryLock()`, das versucht, den Lock zu erwerben, und sofort mit `true` oder `false` zurückkehrt, je nachdem, ob es Erfolg hatte, ohne jemals zu blockieren — nützlich, wenn dein Thread eine sinnvolle Alternative hat, falls die Ressource belegt ist, statt sich in die Schlange zu stellen. Es gibt auch eine Variante mit Timeout, `tryLock(milliseconds)`, die höchstens die angegebene Zeit wartet, bevor sie aufgibt. Im praktischen Projekt dieses Moduls werden wir sie nicht benutzen — unser Producer und Consumer *müssen* warten, sie haben keinen Plan B —, aber du wirst ihnen ganz natürlich begegnen, sobald du Code mit strengeren Reaktionsfähigkeitsanforderungen entwirfst.

## QReadWriteLock: wenn der meiste Verkehr lesend ist

Es gibt ein sehr verbreitetes Szenario, in dem `QMutex` restriktiver ist, als nötig wäre: wenn ein gemeinsam genutztes Datum sehr häufig von mehreren Threads **gelesen** und selten **geschrieben** wird. Denk an eine Konfigurationstabelle oder eine Kalibrierungskarte eines Bildverarbeitungssystems, die einmal geladen und dann ständig von mehreren Verarbeitungs-Threads konsultiert wird: Mit einem gewöhnlichen `QMutex` müssten sich sogar zwei Lesevorgänge — Operationen, die sich für sich genommen nie gegenseitig stören, weil keiner von beiden etwas verändert — hintereinander in eine Schlange stellen und dabei Parallelität verschenken, die die Hardware kostenlos anbieten würde.

`QReadWriteLock` unterscheidet explizit zwischen den beiden Absichten. Wenn mehrere Threads nur **lesen** wollen, können sie das alle gleichzeitig tun, zur selben Zeit — keiner blockiert den anderen, weil ein Lesevorgang den Zustand nicht verändert, den ein anderer Lesevorgang gerade beobachtet. In dem Moment, in dem ein Thread **schreiben** will, wird der Lock hingegen im striktesten Sinn exklusiv: Kein anderer Thread, weder Leser noch Schreiber, kann auf das Datum zugreifen, bis der Schreiber fertig ist.

![QReadWriteLock: concurrent reads, exclusive write](modulo-02/12-readwritelock-readers-writer.png)

Die praktische Verwendung folgt demselben RAII-Geist, den du schon kennst: `QReadLocker` zum lesenden Erwerb, `QWriteLocker` zum schreibenden Erwerb, beide mit automatischer Freigabe am Ende des Gültigkeitsbereichs.

```cpp
double readCalibration(int index) const {
    QReadLocker locker(&m_lock);
    return m_calibrationValues.at(index);
}

void updateCalibration(int index, double newValue) {
    QWriteLocker locker(&m_lock);
    m_calibrationValues[index] = newValue;
}
```

Ein Wort der Vorsicht, weil es ein verbreiteter konzeptioneller Irrtum ist: `QReadWriteLock` ist **nicht immer schneller** als `QMutex`, selbst in leseüberwiegenden Szenarien. Der Mechanismus, der Buch darüber führt, "wie viele Leser gerade drin sind", hat einen nicht zu vernachlässigenden internen Aufwand, und bei sehr kurzen kritischen Abschnitten (wenige Anweisungen) kann dieser Buchführungsaufwand den Nutzen der gewonnenen Parallelität übersteigen — dieselbe Lehre zur Granularität, die wir schon bei den Context Switches kennengelernt haben, hier erneut angewandt: Die richtige Wahl hängt davon ab, wie viel Zeit man tatsächlich im kritischen Abschnitt verbringt und wie unausgewogen das Verhältnis von Lese- zu Schreibzugriffen ist — nicht von einer allgemeinen Intuition darüber, welche Primitive "effizienter klingt".

## Was noch offen bleibt

Mit `QMutex`, `QMutexLocker` und `QReadWriteLock` weißt du bereits, wie man ein gemeinsam genutztes Datum vor gleichzeitigen Zugriffen schützt. Aber das Producer-Consumer-Problem braucht etwas Subtileres: nicht nur "darf ich eintreten?", sondern "muss ich warten, bis sich *etwas ändert*, nicht nur, bis der Lock frei wird". Das ist das Thema des nächsten Artikels, zusammen mit den klassischen Gefahren — Deadlock, Starvation, Prioritätsinversion —, die jede ernsthafte Synchronisation erkennen können muss.
