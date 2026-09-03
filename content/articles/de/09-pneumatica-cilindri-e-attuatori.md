---
title: "Pneumatik, dritte Folge: Zylinder und Aktoren, wo Luft endlich zu Bewegung wird"
description: "Wie einfach- und doppeltwirkende Pneumatikzylinder funktionieren, magnetische Endlagensensoren, Grundauslegung und das Lesen eines realen Datenblatts."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Cylinders", "Sensors", "Automation"]
---

Wir schließen den Pneumatik-Block mit der sichtbarsten Komponente von allen ab, derjenigen, die jeder, auch ohne jede technische Vorbildung, auf einer Maschine auf Anhieb erkennen würde: den **Pneumatikzylinder**. Hier verwandelt sich alles, was wir in den vorherigen zwei Artikeln aufgebaut haben — die aufbereitete und geregelte Luft, das Magnetventil, das ihren Fluss lenkt — endlich in einen echten mechanischen Schub.

## Anatomie eines Zylinders: ein Kolben in einem Rohr

Ein Pneumatikzylinder ist in seiner häufigsten Form konzeptionell einfach: ein zylindrisches Rohr (das *Zylinderrohr*), an beiden Enden von Zylinderdeckeln verschlossen, in dessen Inneren ein Kolben läuft, der mit einer Kolbenstange (*rod*) verbunden ist, die aus einem der beiden Deckel austritt und sich mechanisch mit der zu bewegenden Last verbindet — einer Zange, einem Schlitten, einem Schieber. Die Druckluft, die in eine der beiden durch den Kolben getrennten Kammern eingeleitet wird, drückt diesen und erzeugt Kraft und Bewegung.

![Cross-section of a double-acting pneumatic cylinder showing air ports A and B, and magnetic proximity sensors mounted on the tie rods](./img/cylinder-cross-section.svg)

Wir hatten schon beim Thema Ventile zwischen **einfachwirkenden** Zylindern (Luft von einer Seite, Federrückstellung) und **doppeltwirkenden** (Luft aktiv auf beiden Seiten) unterschieden. Es lohnt sich, eine praktische Überlegung hinzuzufügen, wann man das eine oder das andere wählt: Der einfachwirkende ist günstiger und einfacher anzusteuern und die naheliegende Wahl, wenn eine automatische und "konstruktiv" zuverlässige Rückstellung auch ohne Signal gebraucht wird — denk an eine Sicherheitsklemme, die sich öffnen muss, sobald Luft oder Strom fehlen. Der doppeltwirkende, insgesamt viel verbreiteter, ist die Wahl, wenn aktive Steuerung in beide Richtungen, Kraft auch bei der Rückbewegung, oder ein langer Hub gebraucht wird (die Feder eines einfachwirkenden Zylinders würde ab einer gewissen Länge sperrig werden und eine über den ganzen Hub wenig gleichmäßige Rückstellkraft haben).

## Die Endlagensensoren: wie die SPS weiß, ob der Zylinder angekommen ist

Ein Pneumatikzylinder allein sagt der SPS nicht, wo er sich befindet: Er ist ein Aktor, kein Sensor. Um zu wissen, ob ein Zylinder vollständig ausgefahren oder vollständig eingefahren ist — eine Information, die fast immer unerlässlich ist, bevor man die logische Sequenz der Maschine zum nächsten Schritt weiterschaltet —, braucht man dedizierte Sensoren, und die Standardlösung, elegant und in der Industrie fast universell, sind **magnetische Näherungssensoren** (oft einfach *magnetische Endlagensensoren* genannt, oder mit dem historischen Handelsnamen *Reed-Schalter*, auch wenn die heute verbreitetste Technologie auf dem Hall-Effekt beruht).

Der konstruktive Trick ist folgender: Der Kolben im Inneren des Zylinders trägt einen in seine Struktur integrierten Permanentmagnetring. Das Zylinderrohr selbst besteht nicht aus ferromagnetischem Material, sondern aus einer Legierung (typischerweise eloxiertes Aluminium), die das Magnetfeld ungeschirmt durchlässt. Die Magnetsensoren werden, statt im Inneren des Zylinders montiert zu werden (was komplexe und wenig zuverlässige interne Verkabelung erfordern würde), **von außen** auf eigens dafür vorgesehenen Nutführungen entlang des Zylinderrohrs befestigt und erfassen den Durchgang des Magnetfelds des Kolbens, wenn dieser ihre Position passiert — ohne jeden physischen Kontakt, ohne Loch im Zylinderrohr, ohne interne Verkabelung. Es ist genau dasselbe physikalische Prinzip des induktiven Sensors, dem du schon begegnet bist, angewandt in einer spezifischen Konfiguration.

Der enorme praktische Vorteil dieses Systems ist, dass die Sensoren **manuell positionierbar** sind, indem man sie entlang der äußeren Nut des Zylinderrohrs verschiebt und mit einer kleinen Schraube fixiert, wenn sie in der gewünschten Position sind — ein Vorgang, den du bei der Abnahme konkret ausführen wirst, wenn du präzise den genauen Punkt einstellen musst, an dem die SPS die ausgefahrene oder eingefahrene Position jedes einzelnen Zylinders der Maschine als "erreicht" betrachten soll.

## Die Auslegung: wie viel Kraft ein Zylinder wirklich erzeugt

Es ist normalerweise nicht deine Aufgabe, die Zylinder einer Maschine auszulegen — das macht das technische Büro des Herstellers, in der Phase der mechanischen Konstruktion, lange bevor du die I/O-Liste erhältst. Aber die grundlegende Überlegung zu verstehen, hilft dir enorm zu "spüren", ob etwas nicht stimmt, wenn im Feld ein Zylinder zu langsam wirkt oder seinen Hub gegen eine bestimmte Last nicht vollenden kann.

Die theoretische Kraft, die ein doppeltwirkender Zylinder beim **Ausfahren** erzeugt, berechnet sich mit einer sehr einfachen Formel, derselben Logik wie beim hydrostatischen Druck, dem du wahrscheinlich schon anderswo begegnet bist:

**F = P × A**

wobei **F** die Kraft (in Newton), **P** der Luftdruck (in Pascal, praktischer aus bar umgerechnet) und **A** die Fläche der Kolbenoberfläche ist, auf die die Luft drückt (in Quadratmetern). Was sagt diese Formel konzeptionell aus? Dass derselbe Druck, auf eine größere Fläche angewandt, eine proportional größere Kraft erzeugt — deshalb erzeugt bei gleichem verfügbarem Netzdruck (die bekannten 6-7 bar aus dem ersten Artikel dieser Serie) ein Zylinder mit größerem Durchmesser eine größere Kraft, einfach weil er der Luft mehr Fläche zum Drücken bietet.

Ein interessantes Detail, oft eine Fehlerquelle bei der Bewertung durch alle, die diese Rechnung noch nie gemacht haben: Beim **Einfahren** ist die Kraft bei gleichem Druck etwas geringer, weil die durch den Deckel führende Kolbenstange auf dieser Seite einen Teil der nutzbaren Kolbenfläche "stiehlt" — die Luft drückt in dieser Kammer auf eine kreisringförmige Fläche, nicht auf einen vollen Kreis. Für die meisten Anwendungen ist der Unterschied vernachlässigbar, aber in den Katalogen der Hersteller (Festo, SMC, Camozzi sind Namen, denen du in Europa überall begegnest) findest du deshalb immer zwei getrennte Kraftwerte, einen für das Ausfahren und einen für das Einfahren.

## Ein konkretes Beispiel zum Lesen eines Datenblatts

Stell dir vor, du musst prüfen, ob ein Zylinder der SMC-Serie CDQ2, Durchmesser 32mm, versorgt mit dem Standard-Netzdruck von 6 bar, genug Kraft hat, um eine Last mit einem geschätzten Widerstand von 350N zu schieben. Das Datenblatt gibt dir die Kolbenfläche an (bei 32mm Durchmesser etwa 8 cm², also 0,0008 m²). Mit der Formel: F = 600.000 Pa × 0,0008 m² ≈ 480N theoretische Kraft. Das scheint gegenüber den geforderten 350N ausreichend — aber hier kommt eine letzte praktische Überlegung, die jeder Inbetriebnehmer schnell im Feld lernt: Die so berechnete theoretische Kraft ist der **statische Idealwert**, ohne Berücksichtigung innerer Reibung des Zylinders, Druckverluste in den Leitungen, und vor allem ganz ohne Sicherheitsmarge. Die in der Praxis verbreitete Faustregel ist, unter realen Betriebsbedingungen etwa 70-80 % der berechneten theoretischen Kraft nicht zu überschreiten — in unserem Beispiel eine reale Betriebsmarge von etwa 340-380N, schon nah genug an der geforderten Grenze, um dir bei der Abnahme zumindest zu einem Zylinder mit größerem Durchmesser oder einem höheren Betriebsdruck zu raten, bevor sich das Problem in der Produktion in Form eines zu langsamen Zyklus oder eines Zylinders zeigt, der mit der Zeit seinen Hub nicht mehr vollendet.

Damit schließt sich der Block zur Pneumatik. Im nächsten Artikel sehen wir uns, zum Vergleich und zur Vollständigkeit, die große Schwester der Pneumatik an, wenn wirklich große Kräfte gebraucht werden: die Hydraulik.
