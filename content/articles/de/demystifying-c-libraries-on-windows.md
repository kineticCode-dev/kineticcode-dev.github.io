---
title: "C-Bibliotheken unter Windows entmystifiziert: Wie man unbekannte .dll-Dateien untersucht und profiliert"
description: "Ein praktischer Leitfaden zum Untersuchen und Profilieren unbekannter .dll-Dateien in Windows-Umgebungen."
date: "2026-07-18"
category: "software"
tags: ["C++", "Windows", "DLL", "Debugging"]
---


# Inhaltsverzeichnis
1. [Einleitung: Das reale Problem](#introduction-the-real-world-problem)
2. [Die Herausforderung: Fehlende Informationen](#the-challenge-missing-information)
3. [Binärdateien untersuchen und profilieren (.dll und .h)](#inspecting-and-profiling-binaries-dll-and-h)
   1. [Die Architektur der Bibliothek bestimmen](#determining-the-librarys-architecture)
   2. [Den verwendeten Compiler identifizieren](#identifying-the-compiler-used)
4. [Zusammenfassung & allgemeine Regeln](#summary--general-rules)

---

## Einleitung: Das reale Problem
Die Idee zu diesem Artikel entstand aus einem konkreten Problem, auf das ich vor Kurzem gestoßen bin. Wir arbeiten eng mit einem Partnerunternehmen zusammen, das uns mehrere C-Bibliotheken zur Verfügung gestellt hat, die unserer Meinung nach für die Anwendung nützlich sein könnten, an der wir gerade arbeiten. Nach einem Meeting, in dem man uns die am besten geeigneten Bibliotheken empfohlen hat, schickten sie uns ein Paket von `.zip`-Dateien.

In jeder `.zip`-Datei fanden wir:
* Header-Dateien (`.h`)
* Kompilierte dynamische Bibliotheken (`.dll`)

## Die Herausforderung: Fehlende Informationen
Meine Hauptentwicklungsumgebung ist Windows, ich schreibe C-Code mit Visual Studio Code. Ich hatte bereits Erfahrung mit dem Importieren von Bibliotheken in Qt und Visual Studio, aber in diesen Umgebungen hatte ich neben den `.h`- und `.dll`-Dateien normalerweise auch die `.lib`-Importdateien zur Verfügung. Hier fehlten diese vollständig.

Hinzu kommt eine goldene Regel der C-Entwicklung: Im Idealfall sollte man für sein Projekt denselben Compiler verwenden, mit dem auch die bereitgestellte Bibliothek kompiliert wurde.

Das ließ mich mit einigen Fragen zurück: Ist die bereitgestellte Bibliothek überhaupt geeignet? Welchen Compiler soll ich verwenden? Und wie importiere ich diese Bibliothek überhaupt in Visual Studio Code?

Das klären wir jetzt gemeinsam, Schritt für Schritt.

## Binärdateien untersuchen und profilieren (.dll und .h)
Als Erstes müssen wir prüfen, ob die `.dll` für dieselbe Architektur kompiliert wurde wie unser Entwicklungssystem und unser Compiler.

Versuchen wir, eine 32-Bit-`.dll` in eine 64-Bit-ausführbare Datei zu laden, erhalten wir einen Fehler auf Betriebssystemebene (`Bad Image Format, 0xc000007b`). Dasselbe gilt umgekehrt: Das Laden einer 64-Bit-`.dll` in eine 32-Bit-ausführbare Datei liefert denselben `Bad Image Format`-Fehler.

### Die Architektur der Bibliothek bestimmen
Um herauszufinden, für welche Architektur die Bibliothek kompiliert wurde, können wir unter Windows die **Developer Command Prompt for VS22** öffnen und mit dem Befehl `cd` in den Ordner wechseln, der die `.dll` enthält.

Dort führen wir im Terminal folgenden Befehl aus:
```cmd
dumpbin /headers your_library_name.dll
```

Wir suchen in der Ausgabe nach dem Abschnitt `FILE HEADER VALUES`. Finden wir:
* **`14C machine (x86)`**: Die Bibliothek ist 32-Bit.
* **`8664 machine (x64)`**: Die Bibliothek ist 64-Bit.

![Architektur](/architecture.png)

*(In meinem Fall stellte sich heraus, dass die Bibliothek, die ich importieren wollte, 32-Bit war.)*

### Den verwendeten Compiler identifizieren
Um herauszufinden, mit welchem Compiler die Bibliothek gebaut wurde, können wir im selben Terminal einen weiteren Befehl ausführen:
```cmd
dumpbin /dependents your_library_name.dll
```

Durch die Analyse des Abschnitts `Image has the following dependencies:` können wir auf den Compiler schließen:

![Compiler](/compiler.png)

Sehen wir Abhängigkeiten wie:
* `KERNEL32.dll`
* `msvcrt.dll`
* `libgcc_s_dw2-1.dll`
...dann wurde die Bibliothek höchstwahrscheinlich mit **MinGW** kompiliert.

Sehen wir stattdessen Abhängigkeiten wie:
* `MSVCRXX.dll` (wobei XX eine Versionsnummer ist)
* `VCRUNTIME140.dll`
* `ucrtbase.dll`
...dann wurde sie mit **Microsoft Visual C++ (MSVC)** kompiliert.

## Zusammenfassung & allgemeine Regeln
Als allgemeine Faustregel im Umgang mit dynamischen Bibliotheken unter Windows gilt:

* **Wurde eine Bibliothek mit MinGW kompiliert**, braucht man meist nur zwei Dateien:
  * Die Header-Datei (`.h`)
  * Die kompilierte Bibliothek (`.dll`)
  * *Hinweis: Der MinGW-Linker (`ld`) kann die Symbole direkt aus der `.dll`-Datei lesen, ohne dass eine Importdatei nötig ist. Bei komplexen Projekten kann jedoch trotzdem eine Importdatei wie `.dll.a` erforderlich sein.*

* **Wurde eine Bibliothek mit MSVC kompiliert**, braucht man in der Regel drei Dateien:
  * Die Header-Datei (`.h`)
  * Die kompilierte Bibliothek (`.dll`)
  * Die Importdatei (`.lib`)

Da wir hier von dynamisch gelinkten Bibliotheken sprechen: Denkt daran, dass alle `.dll`-Dateien neben der ausführbaren Datei im Installationsordner liegen müssen. Würde man stattdessen statisch kompilieren, wäre der Code der Bibliothek direkt in die ausführbare Datei eingebettet.
