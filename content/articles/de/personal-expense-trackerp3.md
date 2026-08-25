---
title: "Einen persönlichen Ausgaben-Tracker von Grund auf bauen: Architektur und Datenbankdesign (Teil 3)"
description: "Dieser Artikel zeichnet den Design- und Entwicklungsprozess einer Webanwendung zur Verfolgung persönlicher Ausgaben nach. Das Ziel ist nicht nur, ein funktionierendes Tool zu bauen, sondern jede technische Entscheidung zu analysieren und das Warum hinter unseren technologischen Entscheidungen zu verstehen."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Datenbank", "Supabase", "Frotend", "BaaS"]
---

Willkommen zurück! In **Teil 2** haben wir die Entwicklung des Frontends mit **Flutter** behandelt. Wir haben das Projekt aufgesetzt, es mit unserer Cloud-Datenbank verbunden und angefangen, die Benutzeroberfläche zu bauen.

[Link zum Github-Repository](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Webapp-Mockups
Die Webapp besteht aus zwei verschiedenen Bildschirmen:
* Ein Dashboard: auf dem wir Balken- und Kreisdiagramme anzeigen.
* Ein Eingabebildschirm: auf dem wir Ausgaben in unsere Datenbank eintragen können.

Das Mockup des Dashboards sieht so aus:
![Hauptansicht](./img/mainView.png)

Das Mockup der Eingabeansicht sieht so aus:
![Eingabeansicht](./img/insertView.png)

## Entwicklung der Eingabeansicht
In diesem Abschnitt entwickeln wir die Eingabeansicht, mit der wir eine Ausgabe in die Datenbank eintragen können.
Der Nutzer muss Folgendes eingeben:
* Den Betrag der Ausgabe/Einnahme. Ausgaben werden als negative Beträge erfasst, Einnahmen als positive.
* Das Datum, an dem die Ausgabe angefallen ist.
* Die Kategorie, zu der sie gehört.
* Notizen.

Die endgültige Oberfläche sieht so aus:
![Eingabeansicht](./img/insert_view.png)

## Entwicklung der Dashboard-Ansicht
Jetzt entwickeln wir die Dashboard-Ansicht, die der zusammenfassende Bildschirm unserer Finanzen sein wird. Die Idee ist, einige Diagramme einzufügen, um unseren finanziellen Status sofort sichtbar zu machen. Wir müssen bedenken, dass die App hauptsächlich mobil genutzt wird, der Bildschirm also klein ist. Es ist sehr wichtig, den Platz so gut wie möglich zu nutzen. Eine gute Idee könnte sein: Ich zeige jeweils nur ein Diagramm, und habe irgendwie die Möglichkeit, die Ansicht zu wechseln.

Beginnen wir damit, das Flutter-Paket zu installieren, mit dem wir Diagramme zeichnen können:

```bash
$ flutter pub add fl_chart
```

Dann importieren wir das Paket:

```dart 
import 'package:fl_chart/fl_chart.dart';
```

Das erste Diagramm, das wir entwickeln, ist das für die Ausgaben des aktuellen Monats. Dafür verwenden wir ein klassisches Kreisdiagramm.
Bei der Berechnung der monatlichen Ausgaben gibt es zwei mögliche Ansätze:
* Ich lese alle monatlichen Ausgaben aus der Datenbank in Flutter ein und durchlaufe innerhalb von Flutter Ausgabe für Ausgabe, um zu berechnen, was ich brauche, etwa den Gesamtbetrag und den Betrag pro Kategorie.
* Ich aggregiere die Daten direkt in der Datenbank und arbeite mit einem Teil der Daten, der bereits aggregiert ist.

Wir gehen den zweiten Weg. So können wir möglichst viel der schweren Arbeit und Filterung an die Datenbank delegieren, denn eine Datenbank ist genau für Aggregationen gemacht.
Dafür verwenden wir eine Stored Procedure. Eine `Stored Procedure`, oder `Function`, ist ein Codeblock in SQL, der direkt in der Datenbank gespeichert und ausgeführt wird. Man kann sie sich wie eine echte Softwarefunktion vorstellen, mit Eingabeargumenten und einem Rückgabewert, die auf dem Datenbankserver lebt. Jeder Client, der sich mit der Datenbank verbindet, hat diese Funktionen zur Verfügung.

Warum ist es in unserem Fall besser, eine Stored Procedure zu verwenden? Hier die Gründe:
* **Netzwerkeffizienz:** Wenn ein Nutzer in einem Monat 200 Ausgaben erfasst hat, würde eine Standardabfrage 200 JSON-Datensätze über das Internet herunterladen. Mit der Stored Procedure berechnet die Datenbank die Summen intern und gibt nur wenige Zeilen zurück (eine pro aktiver Kategorie, z. B. 5 Zeilen). Weniger übertragene Daten bedeuten eine schnellere App.
* **Performance:** Die SQL-Engine von PostgreSQL ist hochgradig für das Durchlaufen und Aggregieren von Datensätzen optimiert. Die Summenbildung (`SUM`) und Gruppierung (`GROUP BY`) nativ auf dem Server auszuführen ist unendlich viel schneller, als dieselbe Operation durch das Durchlaufen einer Liste in Dart auf der CPU eines Smartphones zu erledigen.
* **Die Grenzen der Client-API überwinden:** Die Client-Bibliotheken von Supabase sind hervorragend für einfache CRUD-Operationen, unterstützen aber die SQL-Klausel `GROUP BY` nicht nativ. Mit einer Funktion in der Datenbank können wir die volle Leistungsfähigkeit von SQL (PL/pgSQL) nutzen und sie Flutter über einen sehr einfachen Aufruf zur Verfügung stellen.

All das gilt auch für wöchentliche Ausgaben, also erstellen wir eine generische Stored Procedure, die als Eingabe entgegennimmt:
* Jahr
* Monat/Woche
* Granularität (monatlich/wöchentlich)

Und für diesen bestimmten Monat/diese Woche zurückgibt:
* Ausgabenkategorie
* Betrag

Dazu gehen wir in Supabase, in den SQL-Editor, und schreiben diesen Code:

```sql
CREATE OR REPLACE FUNCTION get_aggregated_expenses(
    req_year INT,
    req_value INT, -- Monat (1-12) oder Woche (1-53)
    time_frame TEXT -- Kann 'monthly' oder 'weekly' sein
)
RETURNS TABLE (category_name TEXT, total_amount NUMERIC) AS $$
BEGIN
    IF time_frame = 'weekly' THEN
        RETURN QUERY
        SELECT
            t.name::TEXT as category_name,
            SUM(e.importo)::NUMERIC as total_amount
        FROM expenses e
        JOIN tag t ON e.id_tag = t.id
        WHERE EXTRACT(YEAR FROM e.data) = req_year
          AND EXTRACT(WEEK FROM e.data) = req_value
        GROUP BY t.name;
    ELSE
        RETURN QUERY
        SELECT
            t.name::TEXT as category_name,
            SUM(e.importo)::NUMERIC as total_amount
        FROM expenses e
        JOIN tag t ON e.id_tag = t.id
        WHERE EXTRACT(YEAR FROM e.data) = req_year
          AND EXTRACT(MONTH FROM e.data) = req_value
        GROUP BY t.name;
    END IF;
END;
$$ LANGUAGE plpgsql;
```

Client-seitig müssen wir, um die Liste der Ausgaben für einen bestimmten Monat zu erhalten, einfach Folgendes tun:

```sql
SELECT * FROM get_aggregated_expenses(2026, 7, 'monthly');
```

Und um die Liste der Ausgaben für eine bestimmte Woche zu erhalten:

```sql
SELECT * FROM get_aggregated_expenses(2026, 28, 'weekly');
```

Und die Datenbank antwortet mit den angeforderten Daten.

Das fertige Dashboard sieht so aus:

![Dashboard](./img/dashboard_view.png)

![Dashboard2](./img/dashboard_view2.png)

## Die Webapp online veröffentlichen
Um unsere Flutter-Webapp zu hosten, verwenden wir GitHub Pages als Hosting-Dienst für statische Websites, der vollkommen kostenlos ist. Einmal kompiliert, ist unsere Webapp nichts anderes als eine Sammlung von `HTML-, CSS-, JavaScript- und Asset`-Dateien.

Sehen wir uns die dafür nötigen Schritte an. Die Voraussetzungen sind:
* Ein GitHub-Konto
* Git auf dem PC installiert
* Der Build der Webapp

### Schritt 1: Den `base href` in Flutter ändern
Öffnen wir das Terminal im Root-Verzeichnis des Flutter-Projekts, wo sich die Datei `pubspec.yaml` befindet, und führen den folgenden Befehl im Terminal aus:
```bash
flutter build web --release --base-href "/<name-of-your-repo>/" --pwa-strategy=none
```

Jetzt beginnt die Kompilierung innerhalb des Ordners `/build/web`. Wenn sie abgeschlossen ist, finden wir die Dateien `index.html`, `main.dart.js`, `flutter_bootstrap.js` und `flutter_service_worker.js`.

### Schritt 2: Das Repository auf GitHub erstellen
1. Gehen wir zu GitHub und erstellen ein neues Repository.
2. Wählen wir den Namen (denselben, der im `--base-href` verwendet wurde).
3. Stellen wir das Repository auf öffentlich, was notwendig ist, um GitHub Pages kostenlos zu nutzen.
4. Lassen wir die Optionen "`Add a README`" oder "`.gitignore`" deaktiviert.

### Schritt 3: Der 404-Trick für SPAs
Um das Problem mit Seiten-Neuladen zu lösen, wenden wir folgende Lösung an:
1. Wir navigieren auf unserem PC zum Ordner `build/web`.
2. Wir duplizieren die Datei `index.html` und benennen sie in `404.html` um.
Auf diese Weise findet GitHub die Seite nicht, wenn ein Nutzer die Seite bei einer tiefen URL neu lädt, sondern lädt die Datei `404.html` (die identisch mit `index.html` ist), und Flutter übernimmt die Kontrolle, liest die URL aus und bringt den Nutzer zum richtigen Bildschirm.

### Schritt 4: Dateien hochladen
Wir fügen den gesamten Ordner `build/web` zum neu erstellten GitHub-Repository hinzu.

### Schritt 5: GitHub Pages aktivieren
1. Gehen wir zu unserem GitHub-Repository.
2. Klicken wir oben rechts auf **Settings**.
3. Im linken Menü klicken wir auf **Pages**.
4. Unter **Build and deployment** stellen wir die Quelle auf **Deploy from a branch**.
5. Unter **Branch** wählen wir `main` und den Ordner `/ (root)`, dann klicken wir auf **Save**.
6. GitHub Actions baut die Seite. Wir finden die endgültige URL oben im selben Pages-Abschnitt, sobald der Vorgang abgeschlossen ist – das dauert ein paar Minuten.
