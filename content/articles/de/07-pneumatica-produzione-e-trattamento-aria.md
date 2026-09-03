---
title: "Pneumatik, erste Folge: woher die Druckluft, die eine Maschine bewegt, wirklich kommt"
description: "Wie Druckluft in einer Industrieanlage erzeugt und aufbereitet wird: Kompressoren, Druckluftbehälter, Trockner und FRL-Einheiten, erklärt ohne Differentialgleichungen."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Automation", "Fundamentals"]
---

Ab hier beginnen wir einen kleinen Block von drei Artikeln zur Pneumatik, und wenn du aus einer rein informatischen oder elektronischen Ausbildung kommst, ist dies wahrscheinlich das neueste Terrain der ganzen Serie. Und doch: Sobald du eine Produktionshalle betrittst, ist das Hintergrundgeräusch, das du hörst — dieses unterbrochene Zischen, dieses rhythmische "Sssh-Klack" — fast immer Pneumatik bei der Arbeit. Bevor wir zu Ventilen und Zylindern kommen (dazu in den nächsten zwei Artikeln), müssen wir aber eine vorgelagerte Frage beantworten: Woher kommt physisch die Druckluft, die das alles versorgt?

## Der Kompressor: das Herz der Druckluftanlage

Jedes industrielle Pneumatiksystem beginnt mit einem **Kompressor**, fast immer nur einem für die gesamte Anlage, der ein Rohrleitungsnetz speist, das zu allen angeschlossenen Maschinen verteilt ist — ein bisschen so, wie die elektrische Anlage Energie an alle Steckdosen eines Hauses verteilt, ausgehend von einem einzigen Zähler. Der in der Industrie am weitesten verbreitete Typ ist der **Schraubenkompressor** (*rotary screw compressor*): zwei ineinandergreifende, schraubenförmige Rotoren, die sich drehend die Luft in immer kleineren Volumina einschließen und sie kontinuierlich verdichten — anders als der Kolbenkompressor, günstiger, aber typischerweise kleinen oder tragbaren Anlagen vorbehalten, der die Luft in unterbrochenen Stößen verdichtet, mit mehr Lärm und Vibration.

Der Kompressor wird typischerweise so geregelt, dass das Netz auf einem Standard-**Betriebsdruck** gehalten wird — sehr oft rund **6-7 bar** — ein Wert, den es sich zu merken lohnt, weil du ihm in den Datenblättern der pneumatischen Komponenten ständig als Referenz-Nenndruck begegnest. Zu beachten: Das "bar", auf das wir uns hier beziehen, ist fast immer der **relative** Druck (gemessen gegenüber dem Atmosphärendruck, nicht dem absoluten Druck) — ein Detail, das bei Auslegungsberechnungen einen konkreten Unterschied macht, das dir aber im alltäglichen Abnahmegeschäft selten Probleme bereiten wird, weil alle Industriemessgeräte (Manometer, Drucksensoren) darauf kalibriert sind, den relativen Wert direkt anzuzeigen.

## Der Druckluftbehälter: ein Stoßdämpfer, nicht nur ein Behälter

Gleich nach dem Kompressor findest du fast immer einen großen zylindrischen Metalltank, den **Druckluftbehälter** (*receiver tank*). Seine Funktion ist nicht so banal wie "Luft enthalten": Er dient dazu, die kontinuierliche (oder fast kontinuierliche) Produktion des Kompressors von den momentanen Verbrauchsspitzen der Fabrik zu **entkoppeln**. Stell dir ein Dutzend Maschinen vor, die im selben Moment alle zusammen mehrere Pneumatikzylinder betätigen: Der Luftdurchsatzbedarf in diesem Moment kann weit über das hinausgehen, was der Kompressor in Echtzeit produzieren kann. Der Behälter, der in Phasen geringeren Verbrauchs eine Reserve angesammelt hat, dämpft diese Spitzen und hält den Netzdruck stabil. Er hat noch eine zweite, weniger offensichtliche Rolle: Indem er als großes Expansionsvolumen wirkt, erlaubt er der Luft abzukühlen und einem Teil der Restfeuchtigkeit und des Restöls des Kompressors, zu kondensieren und sich am Boden abzusetzen, von wo es periodisch über ein Ablassventil abgelassen wird (heute oft automatisch, zeit- oder niveaugesteuert).

## Der Trockner: der unsichtbare Feind ist die Feuchtigkeit

Die atmosphärische Luft, die der Kompressor ansaugt, um sie zu verdichten, enthält immer eine gewisse Menge Wasserdampf. Wenn diese Luft verdichtet wird und sich dann entlang des Netzes abkühlt, kondensiert dieser Dampf zu flüssigem Wasser — genau wie das Beschlagen an einem kalten Glas an einem feuchten Tag. Dieses Wasser, das durch die Druckluftleitungen bis zu Ventilen und Zylindern reist, ist ein ernstes Problem: Es korrodiert innere Bauteile, spült das Schmiermittel von beweglichen Teilen ab und kann in kalten Klimazonen sogar in den Rohren gefrieren. Deshalb findest du in jeder ernstzunehmenden Industrieanlage nach dem Behälter einen **Trockner** (*air dryer*), fast immer vom Typ **Kältetrockner**: Er kühlt die Luft absichtlich auf wenige Grad über null ab und zwingt die überschüssige Feuchtigkeit zur Kondensation (die abgelassen wird), bevor er sie wieder auf Umgebungstemperatur zurückkehren lässt, nun "trocken" gemäß dem von der Anlage geforderten Standard.

![The journey of compressed air from the compressor through the receiver tank, dryer and FRL unit to the solenoid valve and cylinder](./img/compressed-air-chain.svg)

## Die FRL-Einheit: die letzte Aufbereitung, direkt vor jeder Maschine

Wenn Kompressor, Behälter und Trockner zentrale Anlagen sind, die die gesamte Fabrik versorgen, findet die letzte Aufbereitung stattdessen lokal statt, oft genau am Eingang jeder einzelnen Maschine oder sogar jeder einzelnen Ventilgruppe (*Ventilinsel*, dazu im nächsten Artikel): die **FRL-Einheit**, ein Akronym für **Filter, Regler, Öler** (*Filter, Regulator, Lubricator*), drei Komponenten, fast immer zu einem einzigen kompakten Block zusammengebaut, in jedem Pneumatikschrank auf den ersten Blick erkennbar.

**Der Filter** entfernt restliche Feststoffpartikel und weitere Spuren von Kondensat, die den vorgelagerten Behandlungen entgangen sein könnten, und schützt die empfindlicheren Komponenten (insbesondere Ventile, die sehr enge mechanische Toleranzen haben) vor Verschleiß und Blockaden.

**Der Druckregler** ist vielleicht die funktional wichtigste Komponente: Er erlaubt es, über einen Drehknopf den genauen Betriebsdruck für diese bestimmte Maschine oder Anwendung einzustellen, unabhängig vom Druck des vorgelagerten allgemeinen Netzes (der schwanken kann). Hier stellst du bei der Abnahme den Betriebsdruck der Zylinder ein: Ein zu niedriger Druck, und der Aktor hat nicht genug Kraft, um den Hub gegen die vorgesehene Last zu vollenden; ein zu hoher Druck, und du riskierst, die Mechanik übermäßig zu belasten, sowie Druckluft zu verschwenden (die, vergiss es nie, für das Unternehmen einen realen und alles andere als vernachlässigbaren Energiekostenfaktor darstellt).

**Der Öler** (heute immer öfter weggelassen, weil viele moderne Pneumatikkomponenten so konstruiert sind, dass sie mit trockener Luft ohne zusätzliche Schmierung funktionieren, die sogenannten *oil-free*-Komponenten) vernebelt eine sehr kleine Menge Öl in die durchströmende Luft, um die beweglichen inneren Teile der nachgeschalteten Zylinder und Ventile zu schmieren — ein Detail, das man immer im Handbuch des Herstellers überprüfen sollte, denn das Mischen von geölter Luft und ölfreien Komponenten im selben Kreis kann in manchen Fällen mehr schaden als nützen.

Mit diesem klaren Bild — woher die Luft kommt, wie sie aufbereitet wird und mit welchem Druck sie am Verwendungspunkt ankommt — können wir im nächsten Artikel endlich das Herz der Pneumatiksteuerung öffnen: die Magnetventile, die Komponente, die ein Bit deiner SPS in eine echte physische Bewegung von Luft verwandelt.
