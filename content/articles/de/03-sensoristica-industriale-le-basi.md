---
title: "PNP, NPN, digital, analog: die Sprache, in der Sensoren mit der SPS reden"
description: "Die Grundlagen der industriellen Sensorik: PNP- und NPN-Ausgänge, digitale und analoge Signale (4-20mA, 0-10V), und warum die Verwechslung dieser Konzepte der häufigste Verdrahtungsfehler ist."
date: "2026-09-01"
category: "automazione"
tags: ["Sensors", "PLC", "Automation", "Fundamentals"]
---

Wenn es einen Fehler gibt, den früher oder später jeder macht, der im Feld arbeitet — vom Elektriker bis zum frisch graduierten Mechatroniker, und ja, auch du —, dann ist es, einen PNP-Sensor dort anzuschließen, wo ein NPN gebraucht wurde, oder umgekehrt, und zwanzig Minuten damit zu verbringen, sich zu fragen, warum die SPS absolut nichts sieht, während die LED des Sensors fröhlich blinkt und meldet, dass er etwas erkennt. Das ist kein dummer Fehler: Er entsteht aus einem subtilen Konzept, das fast immer schlecht erklärt wird, und das ich dir heute ein für alle Mal klären möchte.

## Ein Sensor ist kein Schalter, verhält sich aber wie einer

Beginne mit einem einfachen Bild: Ein industrieller Näherungssensor — ob induktiv, kapazitiv oder optoelektronisch, das sehen wir im nächsten Artikel — tut im Kern genau das, was ein Lichtschalter tut: Er schließt oder öffnet einen elektrischen Kontakt als Reaktion auf etwas (beim Schalter deine Hand, beim Sensor das Vorhandensein eines Objekts). Der Unterschied ist, dass der Lichtschalter ein Metallstück ist, das du mechanisch selbst schließt, während der Sensor eine kleine elektronische Schaltung enthält, die das Schließen eines Kontakts mit einem Transistor als elektronischem Schalter *simuliert*.

Und genau daraus entsteht die Unterscheidung PNP/NPN: Sie hängt davon ab, **mit welcher Seite des Stromkreises der Transistor des Sensors den Ausgang verbindet**.

## PNP: der Sensor "schenkt" das Positive

Ein **PNP**-Sensor (auch *sourcing* genannt, "stromliefernd") verbindet seinen Ausgang im aktiven Zustand mit **+24V** der Versorgung. Praktisch heißt das: Wenn der Sensor das Objekt erkennt, liegen am Ausgang 24V gegenüber Masse an. Der Eingang der SPS muss seinerseits so konfiguriert sein (oder ist bei modernen SPS öfter schon fest verdrahtet), dass er einen High-Pegel am Eingang als "wahr" erkennt, mit der 0V-Referenz gemeinsam angeschlossen.

## NPN: der Sensor "zieht" gegen Masse

Ein **NPN**-Sensor (auch *sinking* genannt, "stromaufnehmend") tut genau das Gegenteil: Im aktiven Zustand verbindet er seinen Ausgang mit **0V** (Masse). Der SPS-Eingang muss in diesem Fall einen Low-Pegel als "wahr" erkennen, wobei +24V gemeinsam auf der Gegenseite anliegt.

![Wiring comparison between a PNP sourcing sensor and an NPN sinking sensor connected to a PLC input](./img/pnp-vs-npn-wiring.svg)

Schau dir das Schema genau an: Der physische Unterschied liegt genau darin, welche Klemme des Sensors — die Signalklemme — beim Schalten des Sensors auf +24V oder auf 0V gezogen wird. Wenn du einen PNP-Sensor an einen SPS-Eingang anschließt, der für NPN verdrahtet ist (also mit dem gemeinsamen Bezug auf +24V statt auf 0V), schließt sich der Stromkreis einfach nie in die richtige Richtung: Der Eingang sieht keine nutzbare Pegeländerung, und für die SPS ist der Sensor "nie aktiv", obwohl er das Objekt physisch einwandfrei erkennt und seine LED es bestätigt.

**Eine praktische Faustregel, die dir Zeit im Feld spart:** In Europa ist aus historischen und normativen Gründen die überwiegende Mehrheit der Industriesensoren und SPSen in **PNP** verdrahtet. Wenn in der I/O-Liste oder auf dem Sensor-Etikett nichts anderes angegeben ist, gehe von PNP aus — prüfe aber immer nach, denn im Automotive-Bereich und in vielen Anlagen amerikanischer oder asiatischer Herkunft findest du noch reichlich NPN, und beide Welten koexistieren häufiger, als du denkst, sogar in derselben Maschine.

## Digital vs. analog: eine andere Frage als PNP/NPN

PNP und NPN betreffen, *wie* ein digitales Signal (an/aus, vorhanden/nicht vorhanden) elektrisch transportiert wird. Aber nicht alle Sensoren liefern eine binäre Antwort. Viele — denk an einen Drucksensor, einen Temperatursensor oder einen linearen Positionsgeber — müssen einen **kontinuierlichen Wert** übermitteln: nicht "es gibt Druck", sondern "der Druck beträgt 3,7 bar". Dafür braucht man **analoge** Signale, und in der Industriewelt findest du im Wesentlichen zwei Typen, fast überall dieselben:

**4-20mA-Strom.** Der Sensor lässt einen Strom durch den Stromkreis fließen, der proportional zur gemessenen Größe ist: 4mA entspricht dem Minimalwert der Skala (Beispiel: 0 bar), 20mA dem Maximalwert (Beispiel: 10 bar). Es ist der in der Schwerindustrie am weitesten verbreitete Standard, und der Grund dafür ist ingenieurtechnisch elegant: Da es ein Stromsignal und kein Spannungssignal ist, leidet es nicht unter Spannungsabfällen entlang langer Kabel (ein ernstes Problem, wenn man von Dutzenden oder Hunderten Metern Verkabelung in einer Anlage spricht), und es ist gegen die meisten elektromagnetischen Störungen immun, die Spannungssignale dagegen plagen. Beachte ein cleveres Detail des Standards: Der Minimalwert ist nicht 0mA, sondern 4mA. Das erlaubt der SPS, einen tatsächlichen Nullwert (4mA) von einem gebrochenen Kabel oder einem getrennten Sensor (0mA) zu unterscheiden: Ein Fehler erzeugt einen erkennbaren Wert außerhalb der Skala, statt eines stillen Fehlers, der wie ein gültiger Wert aussieht.

**0-10V-Spannung.** Konzeptionell einfacher — der Sensor erzeugt eine Spannung proportional zur gemessenen Größe —, aber empfindlicher gegenüber Störungen und Spannungsabfällen bei langen Kabeln, deshalb typischerweise für kurze Distanzen reserviert, im oder in der Nähe des Schaltschranks.

Das analoge Eingangsmodul der SPS wandelt seinerseits dieses kontinuierliche Signal über einen Analog-Digital-Wandler (ADC) in eine digitale Zahl um, die dir typischerweise einen 12- oder 16-Bit-Ganzzahlwert liefert, den du in deinem Code auf die reale physikalische Größe umskalieren musst — dort schreibst du die Skalierungsfunktionen, die `raw_value` in `pressure_bar` umwandeln, mit der linearen Formel, die die beiden Enden der Skala verbindet.

## NO und NC: die andere Unterscheidung, die zählt

Ein letztes Kürzelpaar, das dir überall begegnet und das völlig unabhängig von PNP/NPN ist: **NO** (*Normally Open*, Öffner... nein, tatsächlich Schließer in Ruhestellung offen) und **NC** (*Normally Closed*, in Ruhestellung geschlossen). Sie beschreiben den Zustand des Kontakts — oder des äquivalenten elektronischen Ausgangs — wenn der Sensor *nicht* aktiv ist, also im Ruhezustand. Ein NO-Sensor lässt kein Signal durch, bis er das Objekt erkennt; ein NC-Sensor macht genau das Gegenteil: Er lässt immer ein Signal durch, außer wenn er das Objekt erkennt (oder wenn er ausfällt, was ihn zu einer sehr gängigen Wahl in Sicherheitskreisen macht — wird das Kabel durchtrennt, öffnet sich der Kreis, und das System interpretiert das korrekt als Alarm, statt als mehrdeutige Stille).

Setze all diese Kürzel zusammen — PNP/NPN, NO/NC, digital/analog — und du hast die überwiegende Mehrheit der Angaben entschlüsselt, die du neben einem Sensor in einem Katalog oder einer I/O-Liste findest: `PNP NO digital`, `NPN NC digital`, `4-20mA analog`. Es sind keine abstrakten Kürzel mehr: Es sind präzise Verdrahtungsanweisungen, und jetzt weißt du genau, was zu tun ist, wenn du sie liest.

Im nächsten Artikel gehen wir auf die häufigsten Sensoren ein, denen du physisch im Feld begegnest: induktive, kapazitive, optoelektronische Sensoren und Encoder — wie sie innen funktionieren und wann man den einen statt den anderen wählt.
