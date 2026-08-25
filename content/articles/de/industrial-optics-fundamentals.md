---
title: "Grundlagen der industriellen Optik: Was bei der Objektivwahl wirklich zählt"
description: "Eine praxisnahe Einführung in die Optik der Bildverarbeitung — Sichtfeld, Arbeitsabstand, Schärfentiefe, Brennweite, Anschlüsse, Blendenzahl (F-Zahl) und die Kompromisse, die darüber entscheiden, ob ein Inspektionssystem wirklich funktioniert."
date: "2026-08-18"
category: "automazione"
tags: ["machine-vision", "optics", "vision-systems", "fundamentals"]
---

## Was ein industrielles optisches System eigentlich tut

Ein Objektiv hat genau eine Aufgabe: das Licht einzufangen, das von einem Objekt zurückgeworfen wird, und daraus ein Bild dieses Objekts auf einem Sensor zu rekonstruieren — meist ein CCD oder ein CMOS, die beiden Technologien, die in jedem digitalen Kamerasensor stecken. Das eigene Auge macht genau dasselbe: Hornhaut und Linse brechen das einfallende Licht auf die Netzhaut, und genau diese Brechung ermöglicht die Rekonstruktion eines Bildes. Eine Industriekamera tut exakt dasselbe, nur mit einem Objektiv statt einer Hornhaut und einem Sensor statt einer Netzhaut.

Im Labor oder bei einem Hobbyprojekt reicht eine „gut genug“-Bildkomposition aus. In einem industriellen Inspektionssystem reicht sie nicht. Wenn Sie prüfen, ob ein mechanisches Bauteil innerhalb der Toleranz liegt, oder ob ein Etikett korrekt gedruckt wurde, müssen Sie genau wissen, wie groß das Objekt auf dem Sensor erscheinen wird, wie scharf es sein muss und genau wo im Raum es sich befinden muss, damit das System überhaupt funktioniert. Deshalb beschreibt eine Handvoll Parameter, zusammen betrachtet, vollständig, wie sich ein optisches System verhält.

## Die Parameter, die ein optisches System definieren

- **Sichtfeld (FoV)** — der gesamte Bereich, den das Objektiv erfasst. Wenn Sie ein 5 cm großes Objekt inspizieren müssen, muss Ihr FoV mindestens 5 cm betragen.
- **Arbeitsabstand (WD)** — der Abstand zwischen Objekt und Objektiv, bei dem das Objekt perfekt scharf abgebildet wird. Das ist kein beliebiger Abstand: Er wird durch das Objektiv und dessen Konfiguration festgelegt.
- **Schärfentiefe (DoF)** — der Bereich vor und hinter der perfekten Fokusebene, innerhalb dessen das Objekt noch „akzeptabel“ scharf erscheint. Das ist einer der in der Praxis wichtigsten Parameter.
- **Sensorgröße** — die physische Größe des Sensors in Millimetern, berechnet durch Multiplikation der Pixelgröße (typischerweise wenige Mikrometer) mit der Anzahl der Pixel.
- **Abbildungsmaßstab** — das Verhältnis zwischen der Bildgröße auf dem Sensor und der realen Objektgröße. Unter 1 sieht der Sensor weniger Detail als die reale Szene; über 1 wird effektiv in ein Detail hineingezoomt.
- **Auflösung** — der kleinste Abstand zwischen zwei Punkten, den das System noch als zwei getrennte Punkte unterscheiden kann, statt als einen einzigen verschwommenen Fleck. Sie hängt von Objektiv und Sensor gemeinsam ab, nicht von einem der beiden allein.

Keiner dieser sechs Parameter ist unabhängig. Sie sind durch präzise Beziehungen miteinander verknüpft, und die Änderung eines Parameters ändert automatisch die anderen: Rücken Sie das Objekt näher an das Objektiv, schrumpft das Sichtfeld, der Abbildungsmaßstab steigt, und die Schärfentiefe nimmt ab. Ein optisches System zu entwerfen bedeutet, diese Beziehungen so gut zu kennen, dass man sie bewusst gegeneinander abwägen kann, statt durch Ausprobieren.

## Die Gleichung der dünnen Linse

Um die Berechnungen handhabbar zu machen, stützt sich die Grundlagenoptik auf zwei Vereinfachungen:

- **Paraxiale Näherung** — es werden nur Strahlen berücksichtigt, die in einem kleinen Winkel zur optischen Achse (der gedachten Linie durch die Mitte des Systems) in das Objektiv eintreten. Strahlen, die den Rand in steilem Winkel treffen, werden ignoriert, wodurch die Geometrie linear bleibt.
- **Näherung der dünnen Linse** — die physische Dicke der Linse wird als vernachlässigbar behandelt, sodass die Linse als eine einzige Ebene modelliert wird statt als solider Körper.

Mit diesen beiden Vereinfachungen erhält man die Gleichung, auf der alles Weitere in diesem Artikel aufbaut:

```
1/s' - 1/s = 1/f
```

wobei `s` die Position des Objekts relativ zur Linse ist (per Konvention negativ, da das Objekt „vor“ der Linse liegt, in Richtung der Lichtausbreitung betrachtet), `s'` die Bildposition (positiv) und `f` die Brennweite der Linse.

Zwei weitere Begriffe, die man klar auseinanderhalten sollte, weil sie in Objektiv-Datenblättern ständig auftauchen: Der **Arbeitsabstand** ist der Abstand zwischen dem Objekt und der Vorderseite des Objektivs, während der **Auflageabstand** (back focal distance) der Abstand zwischen der Rückseite des Objektivs und dem Sensor ist. Sie liegen auf entgegengesetzten Seiten des Objektivs — verwechseln Sie sie nicht.

## Die Brennweite

Strahlen, die in eine Linse eintreten, konvergieren nach der Brechung durch das Glas zu einem einzigen Punkt. Der Abstand zwischen der Linse und diesem Punkt ist die Brennweite. Bei einer sammelnden (positiven) Linse treffen sich die Strahlen tatsächlich in einem reellen Brennpunkt. Bei einer zerstreuenden (negativen) Linse laufen die Strahlen nach der Linse auseinander, es gibt also keinen reellen Brennpunkt — nur einen virtuellen: den Punkt, von dem die Strahlen scheinbar ausgehen, wenn man sie rückwärts verlängert.

![Sammellinse mit reellem Brennpunkt, Zerstreuungslinse mit virtuellem Brennpunkt](./img/focal-length.png)

Jedes in der Bildverarbeitung eingesetzte Objektiv ist in der Gesamtheit ein positives (sammelndes) System: Das Licht muss immer auf der Sensorebene konvergieren, sonst entsteht überhaupt kein Bild. Ein Objektiv kann intern sowohl positive als auch negative Linsenglieder enthalten, um optische Abbildungsfehler zu korrigieren, aber die Baugruppe als Ganzes ist immer sammelnd.

Brennweite und Sichtfeld entwickeln sich gegenläufig: Je länger die Brennweite, desto enger das Sichtfeld. Genau das passiert, wenn Sie mit einer Kamera hineinzoomen — längere Brennweite, weniger Szene im Bild.

Eine Ausnahme ist wichtig: Wenn das Objekt näher als etwa das Zehnfache der Brennweite liegt, verlieren die Standardgleichungen der dünnen Linse ihre Genauigkeit. Das nennt man **Makromodus**, und er erfordert Objektive, die speziell für den Nahbereich konzipiert sind.

## Abbildungsmaßstab und Sichtfeld

Formal ist der Abbildungsmaßstab:

```
M = h' / h
```

wobei `h'` die Bildgröße auf dem Sensor und `h` die reale Objektgröße ist. Ein 10 mm großes Objekt, das ein 5 mm großes Bild auf dem Sensor erzeugt, ergibt M = 0.5.

Eine verwandte Formel verknüpft den Arbeitsabstand direkt mit Brennweite und Abbildungsmaßstab:

```
s = f(M - 1) / M
```

Bei bekannter Brennweite eines Objektivs und dem benötigten Abbildungsmaßstab zeigt diese Formel genau, wo das Objekt platziert werden muss — genau die Berechnung, die man beim Auslegen einer Qualitätskontrollstation durchführt: Man kennt die Bauteilgröße, man kennt die Sensorgröße, man berechnet den benötigten Abbildungsmaßstab, und daraus ergibt sich der erforderliche Arbeitsabstand.

Es gibt außerdem eine Namenskonvention, die sich zu kennen lohnt, weil sie auf einen Blick zeigt, wofür ein Objektiv konzipiert ist:

- **Makro- und telezentrische Objektive** sind für Arbeitsabstände in der Größenordnung ihrer eigenen Brennweite konzipiert („endliche Konjugation“), und werden nach Abbildungsmaßstab klassifiziert und verkauft — „0.5X“, „1X“, „2X“.
- **Objektive mit fester Brennweite** sind für Arbeitsabstände konzipiert, die deutlich größer sind als ihre Brennweite („unendliche Konjugation“ — man denke an parallele Sonnenstrahlen), und werden nach Brennweite klassifiziert und verkauft — „8mm“, „25mm“, „50mm“.

Wird ein Objektiv als „2X“ statt als „50mm“ gelistet, wissen Sie sofort, dass es zur ersten Familie gehört: gebaut für Naharbeit an kleinen Details. Ein „25mm“-Objektiv gehört zur zweiten Familie: gebaut für Arbeit auf Distanz, wie ein gewöhnliches fotografisches Objektiv.

## Anschlüsse und Auflagemaß

Bevor es mit der Optik weitergeht, gibt es eine mechanische Frage, die genauso wichtig ist: Wie wird ein Objektiv physisch an einer Kamera befestigt? Der Abstand zwischen der Anschlussfläche (Flansch) und dem Sensor — das **Auflagemaß** (flange focal distance) — geht in jede der oben genannten optischen Berechnungen ein. Stimmt er nicht, passt die Gleichung der dünnen Linse nicht mehr zur Realität: Das Bild wird nicht dort scharf, wo es sein sollte.

| Anschluss | Auflagemaß | Anmerkungen |
|---|---|---|
| C-Mount | 17.526 mm | Der gängigste Anschluss bei Industriekameras. 1 Zoll Durchmesser, 32 Gewindegänge pro Zoll. |
| CS-Mount | 12.526 mm | 5 mm kürzer als C-Mount. Ein C-Mount-Objektiv auf einer CS-Mount-Kamera (oder umgekehrt) bringt den Sensor auf den falschen Abstand, und das Bild wird nicht scharf. |
| F-Mount | Bajonett (einsetzen und drehen) | Von Nikon entwickelt, für größere Sensoren verwendet. Anders als bei den übrigen Anschlüssen ist der Auflageabstand bei diesem Anschluss nicht einstellbar. |
| Mxx-Anschluss (z. B. M42, M72) | Variabel | Eine Familie von Gewindeanschlüssen, definiert durch Durchmesser, Gewindesteigung und Auflagemaß — verwendet für Sensoren, die noch größer sind als beim F-Mount. |

Bei der Wahl eines Objektivs für eine bestimmte Kamera lautet die erste mechanische Frage immer: „Welchen Anschluss verwendet meine Kamera?“ — liegt man beim Anschluss falsch, kann man das Objektiv entweder physisch gar nicht montieren, oder man montiert es im falschen Abstand, und alles Weitere spielt dann keine Rolle mehr.

Selbst bei einem korrekt passenden Anschluss erreichen reale Kameras selten exakt das nominale Auflagemaß — das Schutzglas über dem Sensor hat eine eigene Dicke, und das Licht, das es durchquert, verschiebt den effektiven Fokuspunkt geringfügig. Deshalb verkaufen Objektivhersteller **Shim-Kits**: dünne Distanzscheiben, die vor allem bei telezentrischen Objektiven eingesetzt werden, um den realen Abstand fein auf seinen optimalen Wert einzustellen. Das ist kein kleines Detail — bei einem telezentrischen Objektiv kann ein Fehler von wenigen Zehntelmillimetern im Auflageabstand den gemessenen Abbildungsmaßstab spürbar verändern, was erheblich ins Gewicht fällt, wenn das Objektiv für eine dimensionale Messung eingesetzt wird und nicht nur zum „Sehen“ des Bauteils.

## Sensorformate

Zwei Referenztabellen tauchen bei der Spezifikation eines Bildverarbeitungssystems ständig auf: eine für **Zeilenscan**-Sensoren (line scan, die das Bild eine Pixelzeile nach der anderen erfassen — typisch für Produktionslinien, bei denen das Objekt unter der Kamera durchläuft), und eine für **Flächenscan**-Sensoren (area scan, die verbreitetere Art, die ein komplettes Bild auf einmal aufnimmt, wie eine gewöhnliche Kamera).

**Zeilenscan-Sensoren (Pixellänge einer einzelnen Zeile)**

| Auflösung × Pixelgröße | Sensorlänge |
|---|---|
| 2048 px × 10 µm | 20.5 mm |
| 2048 px × 14 µm | 28.6 mm |
| 4096 px × 7 µm | 28.6 mm |
| 4096 px × 10 µm | 41 mm |
| 6144 px × 7 µm | 43 mm |
| 8192 px × 7 µm | 57.3 mm |
| 12288 px × 5 µm | 62 mm |

**Flächenscan-Sensoren (Standardformate)**

| Format | Breite | Höhe | Diagonale |
|---|---|---|---|
| 1/3″ | 4.8 mm | 3.6 mm | 6.000 mm |
| 1/2.5″ | 5.76 mm | 4.29 mm | 7.182 mm |
| 1/2″ | 6.4 mm | 4.8 mm | 8.000 mm |
| 1/1.8″ | 7.176 mm | 5.319 mm | 8.933 mm |
| 2/3″ | 8.8 mm | 6.6 mm | 11.000 mm |
| 1″ | 12.8 mm | 9.6 mm | 16.000 mm |
| 4/3″ | 18.8 mm | 13.5 mm | 22.500 mm |
| Full frame 35 mm | 36.0 mm | 24.0 mm | 43.300 mm |

Ein Punkt, den man hervorheben sollte, weil er fast jeden Einsteiger auf dem falschen Fuß erwischt: Diese „Zoll“-Bezeichnungen sind historisch, nicht physikalisch. Ein „1/3-Zoll“-Sensor hat eine Diagonale von 6 mm, nicht 8.47 mm, wie eine wörtliche Ein-Drittel-Zoll-Rechnung nahelegen würde. Die Bezeichnung stammt aus den Vakuumröhrenkameras der 1950er-Jahre, bei denen der *Außendurchmesser der Glasröhre* ungefähr einen Zoll betrug — während die tatsächlich lichtempfindliche Fläche viel kleiner war als die Röhre selbst. Als in den 1980er- und 90er-Jahren Halbleiter-CCD-Sensoren aufkamen, behielten die Hersteller die „Zoll“-Bezeichnung aus Gründen der kommerziellen Kompatibilität bei, obwohl sie sich nicht mehr direkt auf eine physikalische Abmessung übertragen lässt. Leiten Sie die reale Größe eines Sensors niemals durch direkte Umrechnung aus der Zoll-Bezeichnung ab — prüfen Sie immer die Millimeterwerte im Datenblatt.

Es lohnt sich außerdem zu wissen, dass zwei Kameras mit demselben nominalen „Format“ trotzdem spürbar unterschiedliche Sensoren haben können, weil das Verhältnis von Breite zu Höhe zwischen Modellen variieren kann. Prüfen Sie bei der Objektivwahl für eine bestimmte Kamera die tatsächlichen Sensormaße in Millimetern — verlassen Sie sich niemals allein auf das nominale Format.

## Blende (F-Zahl) und Schärfentiefe

Das ist der dichteste Teil des Themas, und zugleich der praxisrelevanteste: wie „offen“ oder „geschlossen“ ein Objektiv ist, und was das verändert.

### Die F-Zahl

Die Blende eines Objektivs — wie groß das „Loch“ ist, durch das das Licht fällt, ganz genau wie sich die Pupille Ihres Auges weitet oder verengt — wird als F-Zahl ausgedrückt, unter Standardbedingungen definiert als:

```
F/# = f / d
```

wobei `d` der Blendendurchmesser und `f` die Brennweite ist. Das ist zunächst kontraintuitiv: Eine **höhere** F-Zahl bedeutet eine **kleinere** Blendenöffnung, weil `d` im Nenner steht. F/16 ist eine deutlich kleinere Öffnung als F/2.

Standardwerte, die auf jedem Objektiv zu finden sind, sind F/1.0, F/1.4, F/2, F/2.8, F/4, F/5.6, F/8, F/11, F/16, F/22. Jede Stufe nach oben (kleinere Öffnung) **halbiert** die Lichtmenge, die in das Objektiv eintritt.

![Blendenöffnung, die von F/2 über F/8 bis F/16 abnimmt](./img/aperture-fnumber.png)

Für Makro- oder telezentrische Objektive (die Familie mit endlicher Konjugation, oben beschrieben) wird eine korrigierte Variante verwendet, die **working F-number**:

```
wF/# = (1 + M) × F/#
```

Die Korrektur berücksichtigt, dass der Abbildungsmaßstab selbst, wenn das Objekt nah ist (wie bei diesen Objektiven), verändert, wie „geschlossen“ sich die Blende effektiv verhält.

### Schärfentiefe

Die Schärfentiefe lässt sich nun präzise definieren: Es ist der Bereich zwischen dem nächstgelegenen und dem am weitesten entfernten Punkt, an dem ein Objekt noch akzeptabel scharf erscheint.

Es gibt eine Feinheit, bei der es sich lohnt zu verweilen: Physikalisch gibt es genau eine einzige Ebene im Objektraum, die perfekt zur Sensorebene konjugiert ist — eine einzige Ebene, die ein mathematisch perfektes Bild erzeugt. Alles andere, was man „Schärfentiefe“ nennt, ist in Wirklichkeit eine Frage der *Akzeptanz*, nicht der Perfektion: Wie viel Unschärfe noch als „akzeptabel“ gilt, hängt vollständig von der Anwendung ab. Eine präzise dimensionale Prüfung (ein Bauteil auf ein Hundertstel Millimeter genau vermessen) verlangt weit mehr Schärfe als eine allgemeine Sichtprüfung (nur kontrollieren, ob ein Etikett vorhanden und lesbar ist).

![Schärfentiefe als Zone um eine einzige perfekt fokussierte Ebene](./img/depth-of-field.png)

Eine praktische Formel zur Abschätzung der Schärfentiefe:

```
DoF [mm] = wF/# × p[µm] × k / M²
```

wobei `p` die Pixelgröße des Sensors in Mikrometern, `M` der Abbildungsmaßstab des Objektivs und `k` ein dimensionsloser, anwendungsabhängiger Faktor ist — typischerweise **0.008** für Anwendungen der dimensionalen Messung (bei denen Schärfe am wichtigsten ist) und **0.015** für Anwendungen der Fehlerinspektion (bei denen etwas mehr Toleranz akzeptabel ist).

**Durchgerechnetes Beispiel.** Abbildungsmaßstab des Objektivs M = 0.25X, working F-number wF/# = 8, Pixelgröße des Sensors p = 5.5 µm, Fehlerinspektionsanwendung, also k = 0.015.

1. M² = 0.25 × 0.25 = 0.0625
2. Zähler: wF/# × p × k = 8 × 5.5 × 0.015 = 0.66
3. DoF = 0.66 / 0.0625 = 10.56 mm ≈ **10.5 mm**

Eine kurze ehrliche Anmerkung zu den Einheiten: Die Pixelgröße in dieser Formel ist in Mikrometern angegeben, während das Ergebnis direkt in Millimetern ausgedrückt wird — ein Sprung um drei Größenordnungen, den die Formel nicht explizit macht. In der Praxis steckt in der Konstante `k` mit sehr hoher Wahrscheinlichkeit sowohl ein dimensionaler Umrechnungsfaktor als auch ein empirisches Kriterium für akzeptable Unschärfe, kalibriert anhand realer Tests statt aus ersten Prinzipien hergeleitet. Das macht die Formel nicht falsch — die Zahlen gehen auf —, aber es lohnt sich zu wissen, dass es sich um eine ingenieurmäßige Abkürzung handelt, nicht um eine Herleitung aus ersten Prinzipien, damit man nicht versucht, sie von Grund auf neu herzuleiten und einen eigenen Rechenfehler vermutet, wenn die eigene Rechnung nicht sauber darauf führt.

Zur Wahl der F-Zahl: F/8 ist ein häufig verwendeter Sweet Spot. Kleinere Blendenöffnungen (höhere F-Zahlen, wie F/16 oder F/22) beginnen unter **Beugung** (Diffraktion) zu leiden — einem Welleneffekt der Optik, bei dem sich das Licht ausbreitet, sobald die Öffnung sehr klein wird, was paradoxerweise die Schärfe verschlechtert, obwohl die Schärfentiefe weiter zunimmt. Größere Blendenöffnungen (niedrigere F-Zahlen, wie F/1.4 oder F/2) neigen stärker zu **optischen Abbildungsfehlern und Verzeichnung**, Unvollkommenheiten, die jedem Objektivdesign innewohnen und bei voller Öffnung stärker sichtbar werden.

Der zugrunde liegende Kompromiss lohnt sich zu verinnerlichen: Eine kleine Blendenöffnung (hohe F-Zahl) braucht mehr Licht, liefert aber mehr Schärfentiefe und weniger Abbildungsfehler; eine große Blendenöffnung (niedrige F-Zahl) braucht weniger Licht, liefert aber weniger Schärfentiefe und mehr Abbildungsfehler/Verzeichnung. Es gibt keine universell „richtige“ Blende — F/8 ist ein vernünftiger Standardwert, aber die richtige Wahl hängt immer davon ab, wie viel Licht tatsächlich zur Verfügung steht und wie viel Schärfentiefe die Anwendung im Verhältnis zur maximalen Schärfe benötigt.

## Vier weitere Begriffe, die man kennen sollte

Eine Handvoll Konzepte werden rund um die industrielle Optik ständig erwähnt, ohne dass sie immer vollständig erklärt werden:

- **MTF (Modulation Transfer Function, Modulationsübertragungsfunktion)** — die Standardmethode, um objektiv zu messen, wie „scharf“ ein Objektiv ist, über verschiedene Detailgrade hinweg. Statt allgemein zu sagen, ein Objektiv sei „scharf“, gibt die MTF numerisch an, wie gut das System den Kontrast zwischen immer feineren Linien wiedergibt — es ist das Werkzeug, das Hersteller tatsächlich verwenden, um die Objektivqualität rigoros zu vergleichen.
- **Telezentrizität** — ein normales („entozentrisches“) Objektiv lässt Objekte kleiner erscheinen, je weiter sie entfernt sind, genau wie die menschliche Wahrnehmung von Perspektive. Ein **telezentrisches** Objektiv ist speziell dafür konzipiert, diesen Effekt innerhalb eines bestimmten Distanzbereichs zu eliminieren: Ein Objekt erscheint im Bild gleich groß, unabhängig davon, wo genau es sich innerhalb der Schärfentiefe befindet. Deshalb sind telezentrische Objektive die Standardwahl für präzise dimensionale Messungen, bei denen sich ein kleiner Positionierfehler nicht in einen Messfehler übersetzen darf.
- **Perizentrische Optik** — eine weniger verbreitete dritte Familie, konzipiert, um die Innenflächen eines hohlen Objekts (zum Beispiel das Innere eines Rohrs) aus einer leicht schrägen statt frontalen Perspektive abzubilden.
- **Verzeichnung** — eine geometrische Verformung des Bildes gegenüber der Realität: Gerade Linien in der realen Szene erscheinen im Bild gekrümmt (tonnenförmige Verzeichnung, die nach außen krümmt; kissenförmige Verzeichnung, die nach innen krümmt). Das ist ein Fehler, der für Messanwendungen relevant ist und, wenn nötig, softwareseitig korrigiert wird, weil er die Genauigkeit jeder aus dem Bild abgeleiteten dimensionalen Messung direkt beeinflusst.

## Wie alles zusammenpasst

1. Die **Brennweite (f)** bestimmt zusammen mit dem Objektabstand, wo das Bild entsteht (die Gleichung der dünnen Linse) und wie groß das **Sichtfeld (FoV)** ist.
2. Das Verhältnis zwischen Bildgröße und realer Objektgröße definiert den **Abbildungsmaßstab (M)**, der wiederum den benötigten **Arbeitsabstand (WD)** eines gegebenen Objektivs festlegt.
3. Der **Blendendurchmesser**, ins Verhältnis zur Brennweite gesetzt, ergibt die **F-Zahl** — die sowohl steuert, wie viel Licht einfällt, als auch, zusammen mit Abbildungsmaßstab und Pixelgröße, wie groß die **Schärfentiefe (DoF)** ist.
4. All das muss sich mit der Mechanik vereinbaren lassen: Der **Anschluss** und das korrekte **Auflagemaß** bestimmen, ob die Ebene, in der das Bild „eigentlich“ entstehen soll, tatsächlich mit der physischen Sensorebene zusammenfällt.
5. Wie gut sich das alles schließlich in ein wirklich brauchbares Bild übersetzt, hängt außerdem von **Auflösung, MTF, Telezentrizität und Verzeichnung** ab — Faktoren, die über die Grundparameter hinausgehen, in einem realen System aber genauso wichtig sind.

Wenn Sie nur zwei Themen vertiefen möchten, dann diese: Telezentrizität und MTF. Es sind die Konzepte, die am häufigsten nur beiläufig erwähnt werden, und doch stehen sie im Zentrum jeder realen industriellen Anwendung mit Mess- oder Qualitätskontrollbezug — sie gut zu verstehen ist das, was ein Objektiv-Datenblatt wirklich lesbar macht.
