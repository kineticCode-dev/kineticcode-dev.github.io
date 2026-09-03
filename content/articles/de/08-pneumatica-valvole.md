---
title: "Pneumatik, zweite Folge: Magnetventile, wo ein Bit der SPS zu bewegter Luft wird"
description: "Wie 3/2- und 5/2-Wege-Magnetventile funktionieren, die Symbolik nach ISO 1219, und wie die SPS wirklich einen Zylinder ansteuert."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Valves", "PLC", "Automation"]
---

Im vorherigen Artikel haben wir die Druckluft vom Kompressor bis zur Schwelle der Maschine verfolgt, sauber, trocken und mit geregeltem Druck. Jetzt kommen wir zu der Komponente, die deine Software wirklich mit der physischen Welt der Pneumatik verbindet: das **Magnetventil** (*solenoid valve*). Es ist das exakte pneumatische Gegenstück zum Schütz, dem du beim Thema Schaltschrank begegnet bist: ein SPS-Ausgang mit niedriger Leistung (24VDC) steuert eine Spule an, die wiederum auf einen Mechanismus wirkt, der einen weit größeren Luftdurchsatz bewältigen kann, als es ein elektrisches Signal allein je könnte.

## Wie es innen funktioniert: ein Stift, der sich verschiebt

Vereinfacht gesagt gibt es im Inneren eines Magnetventils ein kleines bewegliches Element — einen Stift oder kleinen Kolben, *Schieber* oder *Spool* genannt —, das sich, indem es sich um wenige Millimeter im Ventilkörper verschiebt, verschiedene interne Kanäle öffnet oder schließt und so die Luftwege verbindet oder trennt. Wird die elektrische Spule erregt, erzeugt sie ein Magnetfeld, das einen mit dem Schieber verbundenen Metallkern anzieht und ihn von der Ruhestellung in die Arbeitsstellung verschiebt. Wird die Spule entregt, bringt ein Rückstellelement — fast immer eine mechanische Feder, oder in manchen Fällen der Luftdruck selbst, entsprechend geleitet (die sogenannten pneumatisch vorgesteuerten Ventile) — den Schieber zurück in die Ruhestellung.

Dieses Verhalten — Ruhe/Arbeit — ist genau das, was die genormte Ventilbezeichnung beschreibt, die wir jetzt entschlüsseln können: Wenn du **"3/2-Wege-Ventil"** oder **"5/2-Wege-Ventil"** liest, gibt die erste Zahl an, wie viele **Wege** (physische Anschlüsse: Zufuhr, Verbraucher, Entlüftung) das Ventil hat, die zweite Zahl gibt an, wie viele **Stellungen** der Schieber einnehmen kann.

## Das 3/2-Wege-Ventil: die Wahl für einfachwirkende Zylinder

Ein **3/2-Wege-Ventil** hat drei Wege — typischerweise mit den Buchstaben **P** (Zufuhr, *pressure*), **A** (Verbraucher, zum Aktor) und **R** (Entlüftung, *release*, zur Atmosphäre) bezeichnet — und zwei Stellungen. In der Ruhestellung verbindet es A mit R (der Verbraucher ist entlüftet, drucklos); wird die Spule erregt, verbindet es P mit A (der Verbraucher erhält Druckluft), während R gleichzeitig geschlossen wird.

Diese Konfiguration ist perfekt, um einen **einfachwirkenden Zylinder** anzusteuern: einen Zylinder, der Druckluft nur auf einer Seite erhält und über eine interne mechanische Feder in die Ruhestellung zurückkehrt, wenn die Luft entnommen wird. Die SPS muss nur ein einziges Bit verwalten: die Spule erregen, um den Zylinder ausfahren zu lassen, sie entregen, damit er zurückkehrt (durch Schwerkraft oder die Rückstellfeder).

![Comparison between a 3/2-way valve for single-acting cylinders and a 5/2-way valve for double-acting cylinders, with ISO 1219 style symbols](./img/valve-symbols-3-2-5-2.svg)

## Das 5/2-Wege-Ventil: die häufigste Wahl, für doppeltwirkende Zylinder

Deutlich weiter verbreitet in der Industrie ist das **5/2-Wege-Ventil**: fünf Wege (eine Zufuhr P, zwei Verbraucher A und B, zwei getrennte Entlüftungen, oft mit R und S bezeichnet) und zwei Stellungen. In einer Stellung verbindet es P mit A und B mit der Entlüftung; in der anderen (umgekehrten) Stellung verbindet es P mit B und A mit der Entlüftung. Das praktische Ergebnis: Du hast immer zwei Arbeitsleitungen, eine, die den Zylinder in die eine Richtung drückt, und eine, die ihn in die entgegengesetzte Richtung drückt, **beide abwechselnd aktiv unter Druck** — nie ein Federschub, immer Luft.

Das ist die typische Konfiguration für **doppeltwirkende Zylinder**, bei denen die Druckluft den Kolben in beide Richtungen drückt (eine Kammer zum Ausfahren, eine zum Einfahren), ohne dass eine interne mechanische Feder nötig wäre. Der praktische Vorteil ist zweifach: Der Rückhub ist genauso aktiv gesteuert wie der Vorhub (nützlich, wenn auch bei der Rückbewegung Kraft gebraucht wird, nicht nur beim Ausfahren), und der Zylinder kann in jeder Ausrichtung montiert werden — horizontal, vertikal, überkopf —, ohne von der Schwerkraft oder einer Feder abhängig zu sein, um den Rückhub zu vollenden.

Aus Sicht der Verdrahtung zur SPS wird ein 5/2-Wege-Ventil mit **Einzelspule** (bei dem eine mechanische Feder den Schieber in die Ruhestellung zurückbringt, wenn die Spule entregt wird) genau wie ein 3/2 angesteuert: ein einziges Ausgangsbit, ein "wahr"-Zustand für das Ausfahren und "falsch" für die Ruhe. Es gibt aber auch eine sehr verbreitete Variante, das **5/2 mit doppelter Spule** (*bistabil*): Es hat gar keine Rückstellfeder, und der Schieber behält seine Position auch dann bei, wenn beide Spulen entregt sind — ein Detail mit enormer praktischer Bedeutung, dazu gleich mehr.

## Monostabil vs. bistabil: eine Wahl mit realen Sicherheitsauswirkungen

Wenn ein Ventil **monostabil** ist (mit einer einzigen Spule und Federrückstellung), hat es einen klar definierten Ruhezustand: Sobald die Spannung entfällt — auch durch einen Fehler, einen Notfall, oder einfach, weil die SPS in Stopp geht — kehrt der Schieber immer in dieselbe vordefinierte Stellung zurück, und mit ihm der Zylinder in eine bekannte, vorhersehbare Position. Dieses Verhalten wird oft bewusst für die Sicherheit genutzt: Wenn der Zylinder einer Zange im Notfall *immer* öffnen muss, um einen Bediener zu befreien, wählt man ein monostabiles Ventil, dessen Feder das Ventil konstruktiv in den Zustand "Zange offen" zurückbringt, unabhängig von der Software.

Ein **bistabiles** Ventil dagegen hält die zuletzt befohlene Stellung auch ohne Versorgung — eine wertvolle Eigenschaft, wenn ein Aktor bei einer Unterbrechung "dort bleiben" muss, wo er war (zum Beispiel darf ein Aktor, der ein schweres Werkstück festhält, es nicht plötzlich loslassen, nur weil der Strom ausgefallen ist), erfordert aber von der Software eine sorgfältigere Überlegung zum tatsächlichen Zustand der Maschine beim Neustart: Die SPS kann nach einem Blackout nicht automatisch annehmen, in welcher Position sich ein bistabiler Aktor befindet — sie muss es mit den Endlagensensoren überprüfen (dazu im nächsten Artikel), nicht mit der Erinnerung an ihren letzten Befehl, der inzwischen völlig veraltet sein könnte.

## Ventilinseln: wo du Dutzende Magnetventile gruppiert findest

In der realen industriellen Praxis findest du selten ein einzelnes, isoliertes Magnetventil: Fast immer sind sie in einer **Ventilinsel** (*valve island* oder *valve manifold*) gruppiert, einem kompakten Block, der eine einzige gemeinsame Luftzufuhr teilt (oft direkt nach der im vorherigen Artikel gesehenen FRL-Einheit) und, in modernen Maschinen zunehmend, eine einzige elektrische Verbindung zur SPS über ein direkt auf der Insel integriertes Feldbusmodul — statt jede einzelne Spule individuell mit einem eigenen Kabel bis zum Schaltschrank zu verdrahten. Das ist ein Vorgeschmack auf ein Thema, das wir beim Feldbus-Artikel ausführlicher behandeln: Dutzende oder Hunderte Meter Kabel zu sparen, indem man sie durch ein einziges Buskabel ersetzt, ist einer der Haupttreiber hinter der Dezentralisierung der I/O in modernen Maschinen.

Im nächsten Artikel schließen wir den Kreis der Pneumatik, indem wir endlich zu der Komponente kommen, die die Luft wirklich in Bewegung versetzt: Zylinder, einfach- und doppeltwirkend, wie sie dimensioniert werden und wie man ein reales Datenblatt liest.
