---
title: "std::atomic, das C++-Speichermodell, und der Performance-Bug, den man im Code nicht sieht"
description: "Multithreading in C++ mit Qt — Modul 5"
---

Den gesamten Quellcode findest du [hier](https://github.com/kineticCode-dev/MultithreadingLearningPath/tree/main)

# std::atomic, das C++-Speichermodell, und der Performance-Bug, den man im Code nicht sieht

Dieser Artikel widmet sich dem physikalischen Kern des Moduls: `std::atomic` und dem **C++-Speichermodell**. Es ist ein Thema, das die meisten Online-Tutorials schlecht erklären, indem sie `memory_order_relaxed`, `acquire`, `release`, `seq_cst` auflisten, als wären es willkürliche Konfigurationsoptionen, die man nach Gefühl auswählt. Hier erklären wir sie ausgehend davon, was *physikalisch* in einem Multi-Core-Prozessor passiert — L1-Cache pro Kern, Cache-Zeilen, das Protokoll, das sie kohärent hält — denn das ist der einzige Weg, auf dem diese Konzepte aufhören, auswendig zu lernende Regeln zu sein, und stattdessen zu offensichtlichen Konsequenzen dessen werden, wie die Hardware gebaut ist, auf der du läufst.

Von dort aus kommen wir zu einer direkten Konsequenz — vielleicht die überraschendste Lektion des Moduls: Zwei aus logischer Sicht völlig unabhängige `atomic`-Variablen — kein Thread nutzt sie je zusammen, keine Invariante verbindet sie — können sich trotzdem dramatisch gegenseitig ausbremsen, nur weil sie im Speicher nah beieinander liegen. Das ist **False Sharing**.

## Zwei verschiedene Fragen, die nebenläufiger Code immer zusammen stellt

Wenn zwei Threads sich eine Variable teilen, gibt es in Wirklichkeit zwei getrennte Probleme, und die Verwechslung der beiden ist die Quelle von 80% der Missverständnisse rund um das Speichermodell:

**Atomarität**: Die Operation (ein Schreibvorgang, eine Inkrementierung, ein Compare-and-Swap) findet als Ganzes statt, ohne dass irgendein anderer Thread sie jemals "halb fertig" beobachten kann. `zaehler++` auf einem gewöhnlichen `int`, wie du es im Modul 0 gesehen hast, ist *nicht* atomar: Es sind in Wirklichkeit drei getrennte Schritte (lesen, erhöhen, schreiben), und zwei Threads können sich mitten zwischen diese drei Schritte schieben und dabei ein Update verlieren.

**Ordnung und Sichtbarkeit**: Selbst wenn eine Operation atomar ist, bleibt die Frage offen "*wann genau* wird die Wirkung dieses Schreibvorgangs für andere Threads sichtbar, und in welcher garantierten Reihenfolge steht sie zu anderen Operationen im Programm — vorher oder nachher?" Das ist eine völlig andere Frage als die Atomarität, und `std::atomic<T>` löst beide — aber mit getrennten Stellhebeln, und hier kommt `std::memory_order` ins Spiel.

## Warum das Sichtbarkeitsproblem physikalisch existiert: L1-Cache pro Kern

![The C++ memory model: per-core L1 caches and the coherence problem](modulo-05/22-cpp-memory-model.png)

Ein moderner Multi-Core-Prozessor liest und schreibt den Hauptspeicher (das RAM) nicht bei jeder Instruktion direkt: Das wäre um Größenordnungen zu langsam im Vergleich zu der Geschwindigkeit, mit der die CPU Instruktionen ausführt. Jeder Kern hat seinen eigenen **L1-Cache**, klein (typischerweise 32-64 KB) aber sehr schnell (wenige Taktzyklen gegenüber den Hunderten, die man braucht, um das RAM zu erreichen), in dem er lokale Kopien der Daten hält, die er gerade benutzt.

Das Problem ist unmittelbar und physikalisch, kein Implementierungsdetail, das man ignorieren könnte: Wenn Thread A, der auf Core 1 läuft, `x = 1` schreibt, aktualisiert dieser Schreibvorgang zuerst den L1-Cache von Core 1 — **nicht** das gemeinsame RAM, nicht sofort, und nicht notwendigerweise jemals in einer Reihenfolge, die du direkt kontrollierst, indem du `x = 1` in C++ schreibst. Wenn im selben Moment Thread B, auf Core 2, `x` aus seinem eigenen L1-Cache liest, kann er ohne Weiteres noch `0` lesen — die alte Kopie, weil sein Cache keinen automatischen Grund hat zu wissen, dass Core 1 gerade seine Meinung geändert hat, bis ihm das ein expliziter Mechanismus mitteilt. Das ist kein Bug des Prozessors: Es ist der physikalische Preis, den Hardware-Designer bewusst akzeptiert haben, um schnelle lokale Caches statt eines langsamen gemeinsamen Zugriffs auf alles zu haben.

Moderne Prozessoren lösen das mit einem **Cache-Kohärenzprotokoll** (das verbreitetste heißt MESI, nach den Anfangsbuchstaben der vier Zustände, die eine Cache-Zeile annehmen kann — Modified, Exclusive, Shared, Invalid), das die Caches der verschiedenen Kerne *bei Bedarf* untereinander angleicht. Aber "bei Bedarf" ist genau das, was du als Programmierer angeben musst — und du gibst es an, indem du die `memory_order` deiner atomaren Operationen wählst. Ohne diese explizite Angabe haben sowohl der Compiler als auch die CPU die Freiheit, Lese- und Schreiboperationen so umzuordnen, wie es bei Single-Thread-Code das beobachtbare Ergebnis nie verändern würde (dieselbe Freiheit, die der Compiler in Modul 0 genutzt hat, um eine ungeschützte Variable in einem Register zu halten und dadurch die Race zu verschleiern) — die aber bei Multi-Thread-Code Ergebnisse hervorbringen kann, die deine Schreibreihenfolge im Quellcode überhaupt nicht vorgesehen hatte.

## Was std::atomic bezüglich Atomarität garantiert: wie es auf Hardware-Ebene funktioniert

Auf einer x86-64-CPU — der verbreitetsten Prozessorfamilie auf Desktops und Servern, mit ziemlicher Sicherheit derjenigen, auf der du das geführte Projekt kompilieren und ausführen wirst — übersetzt sich eine Operation wie `fetch_add` auf einem `std::atomic<int>` typischerweise in eine einzige Maschineninstruktion mit dem Präfix `LOCK` (zum Beispiel `LOCK XADD`), die dem Speicherbus und dem Kohärenzprotokoll sagt: "Diese Read-Modify-Write-Operation muss als ein einziger unteilbarer Block ablaufen, kein anderer Kern kann sich dazwischenschieben." Auf anderen Architekturen (ARM, sehr verbreitet in eingebetteten Systemen) ändert sich der Mechanismus in seiner Form — typischerweise ein Paar aus Load-Linked/Store-Conditional-Instruktionen (LL/SC), das erkennt, ob jemand anderes zwischenzeitlich dieselbe Speicherstelle angefasst hat, und falls ja, es erneut versucht — aber die letztendliche Garantie, die dir der C++-Standard bietet, ist identisch: `fetch_add`, `compare_exchange` und die anderen Read-Modify-Write-Operationen von `std::atomic` sind unteilbar, egal welche Hardware darunterliegt.

## memory_order_relaxed: nur Atomarität, keinerlei Ordnungsgarantie

```cpp
atomicCounter.fetch_add(1, std::memory_order_relaxed);
```

`relaxed` gibt dir die erste Garantie (die Operation ist unteilbar — es geht nie ein Update verloren) und **sonst nichts**. Es verspricht nichts darüber, wann dieses Inkrement für andere Threads sichtbar wird, noch wie es sich zeitlich zu anderen Lese- oder Schreibvorgängen verhält, atomar oder nicht, die derselbe Thread davor oder danach ausgeführt hat. Es ist die richtige Wahl, wenn dich nur ein korrektes numerisches Zählen interessiert — ein Statistikzähler, ein Ereigniszähler — und kein anderer Teil des Programms irgendetwas aus dem *Zeitpunkt* dieses Inkrements im Verhältnis zu anderem ableiten muss.

## acquire/release: die "happens-before"-Brücke zwischen zwei Threads

```cpp
// Thread A: prepares the data, then publishes it
data.x = 42;
data.y = "result";
// "release": publish everything that precedes
readyFlag.store(true, std::memory_order_release);

// Thread B: waits, then consumes
// "acquire": makes everything before the release visible
while (!readyFlag.load(std::memory_order_acquire)) { }
// guaranteed to see the values written above, not stale ones
readData(data.x, data.y);
```

Der Mechanismus ist das, was in der Literatur **happens-before**-Beziehung genannt wird: Ein `store` mit `memory_order_release` funktioniert wie eine Barriere, die sagt: "Alle Speicherschreibvorgänge, die dieser Thread *vor* dieser Instruktion ausgeführt hat, müssen für jeden sichtbar sein, der auf einem anderen Thread *genau diesen Wert* über ein `load` mit `memory_order_acquire` beobachtet." Es ist buchstäblich die Analogie mit dem Vorhängeschloss, die der Name nahelegt: `release` ist wie ein Vorhängeschloss zuschließen und es dort liegen lassen, wo es ein anderer finden kann, `acquire` ist wie es aufzuheben und zu öffnen — und in dem Moment, in dem du es öffnest, ist alles, was "im Raum" war, bevor der erste zugeschlossen hat, garantiert für dich sichtbar.

## memory_order_seq_cst: die Standardwahl, und warum sie es ist

`seq_cst` (sequentially consistent) gibt alle Garantien von `acquire`/`release` **plus** eine zusätzliche, stärkere: Alle `seq_cst`-Operationen aller Threads des Programms erscheinen so, als würden sie in einer einzigen totalen Ordnung ablaufen — derselben, die von jedem Thread beobachtet wird, der sie sieht. Es ist das Denkmodell, das der Vorstellung "das Programm führt Instruktionen eine nach der anderen aus, abwechselnd zwischen den Threads in irgendeiner Reihenfolge" am nächsten kommt — die naive Intuition, die du wahrscheinlich von Anfang an im Kopf hattest, hier zu einer echten Garantie gemacht. Der Preis ist ein Extra an Hardware-Synchronisation, auf modernen x86-64-CPUs fast immer klein, aber nicht null.

Die praktische Empfehlung: **benutze `seq_cst` (den Standard), es sei denn, du hast einen gemessenen und spezifischen Grund, auf eine schwächere Ordnung herunterzugehen**. `relaxed` und `acquire`/`release` sind echte Werkzeuge, die im Code von Game-Engines, Datenbanken, Betriebssystemen eingesetzt werden — aber sie erfordern eine formale und disziplinierte Überlegung bei jeder einzelnen Verwendung. `seq_cst` ist nicht "die faule Version": Es ist die Version, bei der dein gedankliches Denken tatsächlich einer Garantie der Sprache entspricht.

## Das scheinbare Paradox des False Sharing

Hier ist eine Tatsache, die beim ersten Messen die Intuition zu brechen scheint: Zwei `std::atomic<int>`-Variablen, die von zwei verschiedenen Threads benutzt werden, wobei keiner der beiden jemals die Variable des anderen anfasst, können sich gegenseitig drastisch ausbremsen. Keine Race Condition, keine Korrektheitsverletzung, kein falsches `memory_order`: Das Programm berechnet in beiden Fällen das richtige Ergebnis. Das Problem ist rein eines der Performance, und es liegt vollständig in der eben gesehenen Physik, angewandt auf ein Detail, das irrelevant erscheint: wo im Speicher genau die beiden Variablen zueinander liegen.

Caches bewegen Daten nicht Byte für Byte, auch nicht Variable für Variable. Sie bewegen sich in Blöcken fester Größe, genannt **Cache-Zeilen** (cache lines), typischerweise 64 Byte auf modernen x86-64-CPUs — ein physikalischer Hardware-Wert, keine Compiler-Entscheidung. Wenn ein Kern auch nur ein einziges Byte von einer Adresse liest, lädt die Hardware die gesamte 64-Byte-Zeile, die es enthält, in den Cache — und auch das Kohärenzprotokoll arbeitet auf Ebene der ganzen Zeile, nicht der einzelnen Variable.

Zwei `std::atomic<int>` zu je 4 Byte, nacheinander in einer Struct deklariert, belegen einen winzigen Bruchteil der 64 Byte einer Zeile, also platziert der Compiler sie ohne gegenteilige Anweisung nah beieinander im Speicher — und es ist durchaus plausibel, dass sie in derselben Cache-Zeile landen. Nun führt Thread A `a.fetch_add(1)` aus: Um sie auszuführen, muss sein Kern nach dem MESI-Protokoll exklusiven Zugriff auf die Cache-Zeile haben, die `a` enthält. Und diese Zeile enthält auch `b`. Das Ergebnis: Der Schreibvorgang von A auf seine eigene Variable invalidiert stillschweigend die Kopie der Zeile, die der Kern von B im Cache hielt — obwohl B `a` nie gelesen noch geschrieben hat. Das ist **Phantom-Contention** — erzeugt nicht durch einen echten Zugriff auf dieselben Daten, sondern durch die zufällige physikalische gemeinsame Nutzung der Cache-Zeile, die beide enthält.

## Die Heilung: alignas(64)

```cpp
struct alignas(64) PaddedCounter {
    std::atomic<int> value{0};
    // fills the rest of the line, deliberately unused
    char padding[64 - sizeof(std::atomic<int>)];
};
```

`alignas(64)` sagt dem Compiler: "Jede Instanz dieser Struct muss an einer Speicheradresse beginnen, die ein Vielfaches von 64 ist" — also am Anfang einer Cache-Zeile. Das Feld `padding`, ein Array von Bytes, das nie von irgendjemandem gelesen oder geschrieben wird, existiert mit dem einzigen Zweck, den restlichen Platz der Zeile zu belegen und den Compiler davon abzuhalten, daneben etwas anderes zu platzieren.

![False sharing: two independent atomics sharing one 64-byte cache line, and the alignas(64) fix](modulo-05/23-false-sharing-cache-line.png)

Es ist ein expliziter Kompromiss, der als solcher anerkannt werden muss: Du *verschwendest* Speicher (60 ungenutzte Byte für jedes 4-Byte-`int`, das du schützen willst), um durch Vermeidung der wechselseitigen Invalidierung Geschwindigkeit zu *gewinnen*. Für zwei Zähler sind die Kosten vernachlässigbar; würdest du Tausende kleiner Structs in einem riesigen Array polstern, müsste dieser Kompromiss deutlich sorgfältiger abgewogen werden.

## Lock-free vs. Mutex: wann lohnt es sich, wann nicht

Mit der Cache-Physik im Rücken bist du gerüstet, eine Frage zu beantworten, die Modul 2 offengelassen hatte: Wenn `std::atomic` für eine einfache Operation schneller sein kann als ein Mutex — und das geführte Projekt des nächsten Artikels wird es dir mit echten Zahlen beweisen — warum ersetzt man Mutexe dann nicht *immer* durch Atomics?

Ein `std::atomic<T>` garantiert dir die Atomarität einer einzigen Operation auf einer einzigen Variable. Sobald dein Problem verlangt, **mehrere zusammenhängende Variablen so zu aktualisieren, als wären sie eine einzige unteilbare Operation** — die klassische Invariante aus Modul 2, wo zum Beispiel das Einfügen in eine Warteschlange sowohl das Hinzufügen des Elements als auch die Aktualisierung des Elementzählers bedeutet —, reicht ein einzelnes Atomic nicht mehr aus. Man könnte einen lock-freien Algorithmus konstruieren, der diesen Fall behandelt, typischerweise basierend auf `compare_exchange` in Retry-Schleifen mit nicht-trivialen Techniken, um das *ABA-Problem* zu vermeiden — aber das ist Code, der notorisch schwer korrekt zu schreiben, schwer zu überprüfen und schwer zu testen ist, weil die Bugs, die er einführt, oft extrem selten und vom exakten Timing zwischen den Kernen abhängig sind. Für den überwiegenden Großteil des realen Anwendungscodes bleibt ein `QMutex`, der die gesamte mehrvariablige Invariante schützt, die korrektere, lesbarere und wartungsfreundlichere Wahl.

Es ist eine allzu häufige Vereinfachung, die man explizit korrigieren muss: Ein lock-freier Algorithmus ist nicht automatisch schneller als einer, der auf Mutex basiert. Bei geringer Contention verhalten sich ein moderner Mutex unter Linux (basierend auf Futex, der im üblichen Fall einen Systemaufruf komplett vermeidet) und ein Atomic in Bezug auf die Kosten sehr ähnlich. Bei hoher Contention bleibt eine einzelne atomare Operation tendenziell günstiger als ein vollständiges Lock/Unlock, weil sie die Einbeziehung des Schedulers vermeidet, wenn der Thread das "Rennen" verliert: Er versucht es einfach erneut, statt pausiert und später wieder aufgeweckt zu werden. Aber wenn die geschützte Operation komplex ist, wird ein äquivalenter lock-freier Algorithmus rasch teurer zu entwerfen, teurer auszuführen und viel riskanter als korrekt zu zertifizieren, als es ein gut platzierter Mutex ist.

![Mutex vs lock-free atomics: two tools with different cost and risk profiles, not a ranking](modulo-05/24-lockfree-vs-mutex-tradeoff.png)

Die praktische Regel, die man sich merken sollte: Geh immer von `QMutex` (oder `std::mutex`) als Standard für jeden komplexen oder mehrvariabligen geteilten Zustand aus. Ziehe `std::atomic` nur für einen spezifischen und eng begrenzten Fall in Betracht — einen Zähler, ein boolesches Flag, einen geteilten Zeiger in einem wohlbekannten Muster — und erst, nachdem du **gemessen** hast, dass diese Stelle unter echter Contention tatsächlich ein Flaschenhals ist, nicht nach Intuition.

Mit Speichermodell, False Sharing und dem Vergleich lock-free/Mutex jetzt geklärt, stellt der nächste Artikel alles auf die Probe mit einem geführten Projekt: zwei echte Benchmarks, die diese Effekte mit einer echten Stoppuhr messen, und ThreadSanitizer, der überprüft, dass keine der beiden Versionen eine Race verbirgt.
