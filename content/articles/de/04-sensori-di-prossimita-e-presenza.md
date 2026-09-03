---
title: "Induktiv, kapazitiv, optoelektronisch, Encoder: vier verschiedene Arten, eine Maschine sehen zu lassen"
description: "Wie die gängigsten industriellen Näherungssensoren wirklich funktionieren, wann man welchen wählt, und wie man ein reales Datenblatt liest."
date: "2026-09-01"
category: "automazione"
tags: ["Sensors", "Encoders", "Automation", "Fundamentals"]
---

In der Software schreibst du, wenn du wissen musst, ob etwas "existiert" oder "im Zustand X ist", eine boolesche Bedingung, und das Problem ist gelöst. In der physischen Welt sind zu wissen, ob ein Metallteil eine bestimmte Position erreicht hat, ob ein durchsichtiger Kunststoffbehälter voll ist, oder wie viele Grad sich eine Motorwelle gedreht hat, drei völlig verschiedene Probleme, die drei verschiedene physikalische Prinzipien erfordern, um zuverlässig gelöst zu werden. Dieser Artikel ist der Leitfaden zu den vier Sensoren, die 90 % der Fälle lösen, denen du begegnen wirst: induktiv, kapazitiv, optoelektronisch und Encoder.

![Comparison of inductive, capacitive, photoelectric sensors and a rotary encoder](./img/sensor-types-comparison.svg)

## Der induktive Sensor: er sieht nur Metalle, aber die sehr gut

Der induktive Sensor ist wahrscheinlich der am weitesten verbreitete Näherungssensor überhaupt in der industriellen Automatisierung, und der Grund ist einfach: Die meisten beweglichen Teile einer Maschine — Zylinder, Schlitten, Arme — sind aus Metall, und der induktive Sensor ist günstig, robust, berührungslos und praktisch unempfindlich gegen Schmutz, Öl und Vibrationen.

Das physikalische Prinzip ist elegant. Im Inneren des Sensors erzeugt eine Spule ein hochfrequentes elektromagnetisches Feld, das aus der Sensorfläche austritt. Tritt ein metallisches Objekt in dieses Feld ein, entstehen darin induzierte Ströme (*Wirbelströme* genannt), die dem Feld Energie entziehen. Die interne Schaltung des Sensors misst diesen Energieverlust — praktisch die Dämpfung der Schwingung der Spule — und wenn er eine bestimmte Schwelle überschreitet, schaltet der Ausgang um. Beachte das wichtige Detail: **der induktive Sensor erkennt nur leitfähige Materialien**, praktisch fast ausschließlich Metalle. Kunststoff, Holz, Glas, Flüssigkeiten: Für den induktiven Sensor sind sie transparent, sie existieren schlicht nicht.

Ein Parameter, den du immer im Datenblatt findest, ist der **nominale Schaltabstand** (`Sn`), typischerweise wenige Millimeter bei den kompakteren Sensoren (die bekannten zylindrischen M8, M12, M18, wobei die Zahl den Gewindedurchmesser in Millimetern angibt) bis zu einigen Zentimetern bei größeren Modellen. Du findest auch eine Unterscheidung zwischen **bündig einbaubar (embeddable)** und **nicht bündig einbaubar (non-embeddable)**: Erstere können vollständig bündig in eine Metallhalterung eingelassen werden, ohne dass dies die Erfassung stört, letztere brauchen freien Raum um die Sensorfläche herum — ein Detail, das bei den mechanischen Zeichnungen der Sensorhalterung wirklich einen Unterschied macht, und das, wenn ignoriert, Sensoren erzeugt, die "ihre eigene Halterung sehen" statt das zu erfassende Werkstück.

## Der kapazitive Sensor: er sieht (fast) alles, sogar durch eine Wand hindurch

Wo der induktive Sensor aufhört, kommt der kapazitive ins Spiel. Er funktioniert konzeptionell ähnlich — er erzeugt ein Feld, diesmal ein elektrisches statt eines magnetischen, und misst dessen Änderung —, ist aber empfindlich gegenüber der **Dielektrizitätskonstante** des sich nähernden Materials, einer Eigenschaft, die fast jedes Material in gewissem Maße besitzt: Kunststoff, Glas, Holz, Flüssigkeiten, sogar die Hand einer Person. Das macht ihn viel vielseitiger, aber auch "rauschanfälliger": Ein schlecht eingestellter kapazitiver Sensor kann durch Luftfeuchtigkeit oder Schmutz auf seiner Sensorfläche auslösen, deshalb haben fast alle Industriemodelle ein Empfindlichkeits-Trimmpoti, das bei der Installation eingestellt werden muss — einer der wenigen Sensoren, der wirklich eine Feldkalibrierung braucht, nicht nur eine mechanische Positionierung.

Die Lehrbuchanwendung ist die Füllstanderkennung durch nichtmetallische Wände: Ein kapazitiver Sensor, der außen an einem Kunststofftank angebracht ist, kann erkennen, ob die Flüssigkeit im Inneren diesen Punkt erreicht hat, ohne dass ein Loch im Tank nötig wäre — eine Lösung, die beim ersten Mal, wenn man sie funktionieren sieht, fast wie Magie wirkt.

## Der optoelektronische Sensor: die größte Reichweite, das intuitivste Prinzip

Der optoelektronische Sensor nutzt einen Lichtstrahl — fast immer infrarot, für das Auge unsichtbar, aber im Prinzip perfekt funktionierend — und misst dessen Unterbrechung oder Reflexion. Es gibt drei Hauptkonfigurationen, und es ist wichtig, sie zu unterscheiden, weil sie die Art und Weise, wie du ihre Montage an der Maschine planst, grundlegend verändern:

**Einweglichtschranke (through-beam).** Ein getrennter Sender und Empfänger, einander gegenüber montiert: Unterbricht etwas den Strahl, erkennt der Empfänger das. Es ist die zuverlässigste Konfiguration mit der größten Reichweite (auch Dutzende Meter), erfordert aber die Ausrichtung und Verkabelung zweier getrennter Komponenten.

**Reflexionslichtschranke (retro-reflective).** Sender und Empfänger im selben Gehäuse, mit einem Reflektor (einem passiven, günstigen Prismenreflektor ohne eigene Stromversorgung) auf der gegenüberliegenden Seite: Der Strahl geht hin, prallt am Reflektor ab und kehrt zurück. Nur eine aktive Komponente zu verkabeln, mittlere Reichweite.

**Diffuser Taster (diffuse).** Der Sensor selbst sendet Licht aus und erkennt dessen direkte Reflexion am Objekt, ohne dedizierten Reflektor. Er ist am einfachsten zu installieren (nur eine Komponente, kein Reflektor), aber am empfindlichsten gegenüber Farbe und Oberflächenbeschaffenheit des Objekts: Eine matte schwarze Oberfläche reflektiert viel weniger Licht als eine glänzend weiße, und das kann die nutzbare Reichweite drastisch verändern — ein Detail, das man gut im Kopf behalten sollte, wenn die Maschine Produkte unterschiedlicher Farben verarbeiten muss.

## Der Encoder: wenn "ja oder nein" nicht reicht, sondern man wissen muss, "wie viel"

Alle bisher gesehenen Sensoren beantworten eine binäre Frage: vorhanden oder nicht vorhanden. Der Encoder beantwortet eine völlig andere Frage: um wie viel sich etwas gedreht (oder verschoben) hat, und manchmal mit welcher Geschwindigkeit. Es ist der Sensor, den du an einer Motorwelle findest, an einer Positionierachse, an jedem Teil der Maschine, bei dem die genaue Position wichtig ist und nicht nur ein paar Zustände.

Der häufigste Typ ist der **inkrementale optische Encoder**: eine mit der rotierenden Welle verbundene gelochte Scheibe läuft zwischen einem Lichtsender und -empfänger hindurch und erzeugt bei jedem durchlaufenden Loch einen Impuls. Durch Zählen der Impulse rekonstruiert die SPS (oder öfter ein dediziertes Schnellzählermodul, weil die Frequenz dieser Impulse die normale zyklische Scanrate der SPS deutlich übersteigen kann), wie viel sich die Welle gedreht hat. Qualitativ hochwertige Inkrementalencoder haben typischerweise zwei um 90 Grad phasenverschobene Kanäle (A und B genannt), die es erlauben, nicht nur die Impulse zu zählen, sondern auch die **Drehrichtung** aus der Reihenfolge zu bestimmen, in der die beiden Kanäle schalten — ein elegantes technisches Detail, das es sich zu verstehen lohnt, weil es dasselbe Prinzip ist, das überall verwendet wird, wo eine Bewegungsrichtung aus zwei phasenverschobenen digitalen Signalen erkannt werden muss.

Die Alternative ist der **Absolutwertgeber**, der statt relativer Impulse direkt zu jedem Zeitpunkt die aktuelle absolute Position zurückgibt (typischerweise als digitalen Wert auf einem Kommunikationsbus), auch unmittelbar nach dem Einschalten — eine sehr wertvolle Eigenschaft für Achsen, die sich keine "Nullpunktfahrt" bei jedem Neustart der Maschine leisten können, wie die großen Positionierachsen auf einer kontinuierlichen Produktionslinie.

## Ein reales Datenblatt lesen: worauf zuerst achten

Wenn du ein physisches Bauteil zur Abnahme erhältst oder eines zum Austausch prüfen musst, hat das Datenblatt des Herstellers (Omron, Sick, Balluff, Pepperl+Fuchs sind Namen, denen du sehr oft begegnen wirst) immer eine ähnliche Struktur. Die Parameter, die man zuerst ansieht, in praktischer Prioritätsreihenfolge: die Versorgungsspannung (fast immer 10-30VDC, mit 24VDC nominal), der Ausgangstyp (PNP/NPN, NO/NC — was du im vorherigen Artikel gelernt hast), der nominale Schaltabstand und, bei induktiven und kapazitiven Sensoren, ob er bündig oder nicht bündig einbaubar ist. Wenn du nach dem Lesen dieser vier Zeilen schon antworten kannst "dieser Sensor passt für diese Position an der Maschine", hast du genau das gelernt, was du brauchst, um sicher im Feld zu arbeiten.

Im nächsten Artikel wechseln wir vom "Wahrnehmen" zum "Bewegen": Asynchronmotoren, Servomotoren und Frequenzumrichter, und was sich aus Sicht der Steuerungssoftware zwischen diesen drei Welten wirklich ändert.
