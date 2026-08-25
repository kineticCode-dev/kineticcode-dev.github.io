---
title: "Qt-qDebug ohne Neukompilieren in eine Datei umleiten: die Klasse LoggerManager"
description: "Ein Absturz im Feld, den ich nicht diagnostizieren konnte, keine Möglichkeit, vor Ort neu zu kompilieren, und die C++/Qt-Klasse, die ich geschrieben habe, um Logs zur Laufzeit abzufangen — mit jedem Linker-Fehler, der mir dabei unterkam."
date: "2026-08-05"
category: "software"
tags: ["cpp", "qt", "debugging", "tooling"]
---

## Das Problem, im Feld

Eine Qt-Anwendung in C++, bereits gebaut und auf der Maschine eines Kunden installiert, fing an abzustürzen. Keinerlei Ausgabe: Die ausführbare Datei war ohne `console` in der `.pro`-Datei gebaut worden, sodass jede `qDebug()`-Zeile in dem Moment, in dem die App sich schloss, einfach verschwand.

Die schnelle Lösung kennt jeder Qt-Entwickler: `CONFIG += console` in die `.pro`-Datei einfügen, neu kompilieren, aus einem Terminal starten und die `qDebug()`-Ausgabe live mitlesen, während die App abstürzt. Das funktionierte, ließ mich aber mit einer unangenehmen Frage zurück: Was, wenn ich nicht neu kompilieren könnte? Ein Kunde wartet nicht darauf, dass man einen Debug-Build vorbereitet und zuschickt — er will die Log-Datei von dem, was gerade jetzt auf seiner Maschine läuft.

Daraus entstand die Idee: eine kleine Bibliothek, die jedes `qDebug()`, `qWarning()`, `qCritical()` einer Qt-Anwendung abfängt und in eine Datei schreibt, zur Laufzeit ein- und ausschaltbar, ohne den bestehenden Code anzufassen oder irgendetwas neu zu kompilieren.

[Repository](https://github.com/kineticCode-dev/qDebugRedirection)

## Die Design-Vorgabe

Um auf einem bestehenden Projekt tatsächlich brauchbar zu sein, musste die Lösung zwei Bedingungen erfüllen:

- **fast kein Eingriff in den Code des Host-Projekts**: einen Header einbinden und zwei Zeilen in `main` hinzufügen, mehr nicht.
- **kein Neukompilieren, um das Logging ein- oder auszuschalten**: das Verhalten muss von außen steuerbar sein, über Umgebungsvariablen.

Qt gibt uns dafür bereits den passenden Haken an die Hand: `qInstallMessageHandler()`. Das ist eine Funktion auf Systemebene, gebaut, um *jede* Nachricht des Frameworks (`qDebug`, `qWarning`, `qCritical`, `qFatal`) abzufangen und umzuleiten, wohin man will, noch bevor sie überhaupt die Konsole erreicht.

## Die erste Falle: C-artige Callbacks haben kein `this`

Der erste Prototyp war eine einzelne freie Funktion, die an `qInstallMessageHandler` übergeben wurde. Sie funktionierte, war aber nicht sauber: Ich wollte sie in eine Klasse einwickeln, sodass ich in `main` einfach schreiben konnte

```cpp
LoggerManager lm;
lm.init();
```

anstatt eine nackte Funktion frei im globalen Scope schweben zu lassen. Genau hier tauchte die erste nicht offensichtliche technische Einschränkung auf: `qInstallMessageHandler` erwartet einen Funktionszeiger mit fester Signatur,

```cpp
void (*)(QtMsgType, const QMessageLogContext &, const QString &)
```

Eine normale Instanzmethode hat unter der Haube einen zusätzlichen, versteckten Parameter: den `this`-Zeiger. Die beiden Signaturen passen nicht zusammen, und der Compiler wandelt eine Instanzmethode nicht in diese Art von Funktionszeiger um. Qt verlässt sich für diese Art von System-Hook immer noch auf altmodische C-Funktionszeiger, ohne Wrapper wie `std::function` oder eine erfassende Lambda.

Die praktische Konsequenz: `messageHandler` muss `static` bleiben (oder eine freie Funktion außerhalb der Klasse sein), und folglich muss auch jeder Zustand, den diese Funktion liest — in unserem Fall der Name der Log-Datei — `static` sein. `init()` dagegen kann eine normale Instanzmethode bleiben: dort wird der Pfad aufgebaut, werden die Umgebungsvariablen gelesen und die Entscheidung getroffen, den Handler zu installieren.

## Der zweite Stolperstein: LNK2019

Nach der Umschreibung der Klasse schlug der Build mit einem klassischen `LNK2019: unresolved external symbol` beim statischen Member `m_fileName` fehl. Der Grund: In C++ (bis C++17) erklärt die Deklaration eines `static`-Members im Header nur, dass es *existiert* — es wird kein Speicher dafür reserviert. Man braucht eine explizite Definitionszeile in der `.cpp`-Datei:

```cpp
QString LoggerManager::m_fileName = "app_debug.log";
```

Ein Lehrbuchdetail, aber genau die Art von Fehler, die man erst ernst nimmt, wenn man sie im Linker eines echten Projekts auftauchen sieht, nicht in einem Tutorial.

## Zur Laufzeit aktivieren, ohne `.ini`-Datei

Um nicht von einer externen Konfigurationsdatei abhängig zu sein — die in einem industriellen Deployment fehlen, überschrieben werden oder schreibgeschützt enden könnte —, habe ich Umgebungsvariablen als Schalter gewählt:

- `ENABLE_FILE_LOG=1` schaltet das Datei-Logging ein. Fehlt sie oder ist sie auf einen anderen Wert als `1` gesetzt, verhält sich die Anwendung genau wie vorher: null Overhead, keine Datei wird angelegt.
- `MAX_LOG_COUNT` legt fest, wie viele Log-Dateien in der Rotation gehalten werden (Standard: 10).


Ein nicht offensichtliches Detail, das man beim Testen aus Qt Creator heraus im Hinterkopf behalten sollte: `QProcessEnvironment::systemEnvironment()` liefert einen Schnappschuss der Umgebung des *Elternprozesses*, aufgenommen beim Start. Setzt man die Variable erst, nachdem die IDE bereits geöffnet wurde, erbt die Kindanwendung trotzdem noch die alte Umgebung. Man muss sie unter *Projects → Run → Environment* setzen oder die IDE komplett neu starten.

## Wo die Datei am Ende wirklich landet

Ein relativer Pfad wie `QFile file("app_debug.log")` wird gegen das *Arbeitsverzeichnis* des Prozesses aufgelöst, das **nicht immer** mit dem Ordner der ausführbaren Datei übereinstimmt: aus einem Terminal heraus meistens schon, aus Qt Creator heraus hängt es vom im Projekt eingestellten Build-Ordner ab, und bei einem Linux-Dienst (`systemd`) kann es `/` oder `/root` sein, oft schreibgeschützt.

Um ein vorhersehbares Verhalten zu bekommen, habe ich den Pfad relativ zum Ordner der ausführbaren Datei erzwungen, mit `QCoreApplication::applicationDirPath()`, und `QDir::filePath()` statt manueller String-Verkettung verwendet — das vermeidet Probleme mit Trennzeichen (`/` unter Linux/macOS, `\` unter Windows) und doppelte Schrägstriche, wenn `applicationDirPath()` bereits mit einem Trennzeichen endet.

## Log-Rotation: der Bug mit dem hängenden Zähler

Die erste Version der Rotationslogik zählte die `.log`-Dateien im Ordner und überschrieb, sobald der Schwellenwert `m_maxLogFiles` erreicht war, immer `logFile_1.log`. Das sah korrekt aus, bis man durchdenkt, was beim nächsten Lauf passiert: Beim Start ist die Dateianzahl im Ordner wieder gleich dem Maximum, also wählt die Logik erneut `logFile_1.log` — `logFile_2.log` und `logFile_3.log` werden nie wieder angerührt. Ein stiller Bug: kein Absturz, nur eine Rotation, die klammheimlich aufhört zu rotieren.

Die Lösung bestand darin, die Dateien nach Änderungsdatum zu sortieren und immer die älteste zu recyceln (eine FIFO-Strategie), unabhängig von den Dateinamen:

```cpp
QString LoggerManager::getNextLogFileName(const QString &folderPath)
{
    QDir dir(folderPath);
    dir.setNameFilters(QStringList() << "*.log");
    dir.setFilter(QDir::Files);

    // erstes Element: das älteste
    dir.setSorting(QDir::Time | QDir::Reversed);

    QFileInfoList logFiles = dir.entryInfoList();

    if (logFiles.size() < m_maxLogFiles) {
        return QString("logFile_%1.log").arg(logFiles.size() + 1);
    }

    return logFiles.first().fileName();
}
```

Auf diese Weise recycelt das System, sobald die maximale Anzahl an Dateien erreicht ist, immer die zuletzt am wenigsten aktualisierte — ohne je den konfigurierten Platz zu überschreiten — und ohne von einem Nummerierungsschema abzuhängen, das der Nutzer durch manuelles Löschen einer Datei durcheinanderbringen könnte.

## Das Ergebnis: zwei Zeilen in main

Diese ganze Kapselungsarbeit existiert aus einem einzigen Grund: Wer die Bibliothek in ein anderes Projekt einbindet, soll sich darüber keine Gedanken machen müssen.

```cpp
#include "loggermanager.h"

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);

    // Muss nach QApplication a(argc, argv) stehen
    LoggerManager lm;
    lm.init();

    MainWindow w;
    w.show();

    return a.exec();
}
```

Standardverhalten: keine Umgebungsvariable gesetzt, keine Datei angelegt, kein Unterschied zum ursprünglichen Projekt. Im Feld, angesichts eines Absturzes, den man nicht reproduzieren kann, setzt man einfach `ENABLE_FILE_LOG=1`, bevor man die ausführbare Datei neu startet, und holt sich die `.log`-Datei aus dem Ordner neben der `.exe` — ohne eine einzige Codezeile anzufassen oder irgendetwas neu zu kompilieren.

## Was ich daraus mitnehme

Der Wert dieses Werkzeugs liegt nicht in der Klasse selbst — ein paar Dutzend Zeilen —, sondern in den Zwängen, die sie geformt haben: keine Abhängigkeit von externen Dateien, kein Eingriff ins Host-Projekt, wenn es abgeschaltet ist, und eine Log-Rotation, die nach dem ersten Zyklus nicht still und leise kaputtgeht. Genau solche Details sind es, die bei einem System in Produktion den Unterschied ausmachen zwischen einem Werkzeug, das man wirklich benutzt, und einem, das man einmal schreibt und dann vergisst.

Der Code liegt im Projekte-Repository; falls er für eines eurer eigenen Qt-Projekte nützlich ist, dauert die Integration buchstäblich zwei Zeilen: [Repository](https://github.com/kineticCode-dev/qDebugRedirection)
