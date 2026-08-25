---
title: "Einen persönlichen Ausgaben-Tracker von Grund auf bauen: Architektur und Datenbankdesign (Teil 1)"
description: "Dieser Artikel zeichnet den Entwurfs- und Entwicklungsprozess einer Webanwendung zur persönlichen Ausgabenverfolgung nach. Ziel ist nicht nur, ein funktionierendes Tool zu bauen, sondern jede technische Entscheidung zu analysieren und das 'Warum' hinter unseren technologischen Entscheidungen zu verstehen."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Datenbank", "Supabase", "Frotend", "BaaS"]
---

Dieser Artikel zeichnet den Entwurfs- und Entwicklungsprozess einer Webanwendung zur persönlichen Ausgabenverfolgung nach. Ziel ist nicht nur, ein funktionierendes Tool zu bauen, sondern jede technische Entscheidung zu analysieren und das „Warum“ hinter unseren technologischen Entscheidungen zu verstehen.

Dieses Projekt soll lehrreich, aber praxisnah sein – mit einem professionellen Ansatz, ohne ins Over-Engineering abzudriften oder sich in unnötigen Funktionen zu verlieren. Los geht's!

[Link zum GitHub-Repository](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Inhaltsverzeichnis
1. [Technische Spezifikationen](#technical-specifications)
2. [Projektarchitektur](#project-architecture)
3. [Datenbankmodellierung](#database-modeling)
4. [Einrichtung der Cloud-Datenbank: Supabase](#cloud-database-setup-supabase)

---

## Technische Spezifikationen

Das Ziel ist einfach: einen persönlichen Ausgaben-Tracker bauen. Die Grundideen sind:
- Eine Datenbank entwickeln, um alle Ausgaben des Nutzers zu speichern.
- Eine Web-App mit zweifachem Zweck bauen:
  - Ausgaben in der Datenbank hinzufügen, entfernen oder bearbeiten.
  - Ein zusammenfassendes Dashboard mit verschiedenen Diagrammen anzeigen (wöchentliche, monatliche Ausgaben usw.).

Der typische Anwendungsfall sieht so aus: die Web-App direkt im Browser öffnen (PC, Tablet, Smartphone), eine Ausgabe eintragen und die finanzielle Entwicklung visualisieren. Damit sie sich wirklich für den täglichen Gebrauch eignet, ist eine cloudbasierte Datenbank die bevorzugte Lösung, damit die App rund um die Uhr erreichbar ist.

Es gibt zwar schon jede Menge Apps zur Ausgabenverfolgung, aber unser Ziel ist es, die dahinterliegende Technologie zu verstehen – und dabei nur das Nötigste für den Zweck des Projekts zu behalten.

## Projektarchitektur

Die Software ist in einzelne Komponenten unterteilt. Ursprünglich war eine klassische 3-Schichten-Architektur angedacht:
- **Frontend:** grafische Oberfläche, erreichbar über den Browser.
- **Backend:** Anwendung, die die Anfragen des Frontends verarbeitet und an die Datenbank weiterleitet.
- **Datenbank:** cloudbasierte Datenquelle.

Durch den Einsatz einer modernen Backend-as-a-Service-(BaaS)-Cloud-Datenbank können wir uns die Entwicklung einer eigenen Backend-API jedoch sparen. Aus Gründen der Einfachheit und Effizienz entwickeln wir nur das Frontend in **Flutter**, das direkt mit unserer Cloud-Datenbank kommuniziert.

## Datenbankmodellierung

In dieser Phase definieren wir die konzeptionelle Datenstruktur, wählen unseren Cloud-Anbieter aus und richten die ersten Tabellen samt Beziehungen ein.

Wir brauchen zwei getrennte Tabellen:
1. **Kategorien-Tabelle** (Tag)
2. **Ausgaben-Tabelle**

### 1. Kategorien-Tabelle
Diese Tabelle enthält die verschiedenen Ausgabentypen.

| id    | category_name   |
| :---- | :-------------- |
| **1** | Lebensmittel |
| **2** | Auto & Transport |
| **3** | Rechnungen & Wohnen |
| **4** | Freizeit |

### 2. Ausgaben-Tabelle
Diese Tabelle erfasst jede einzelne Transaktion.

| expense_id | amount | date | category_id | notes |
| :--- | :--- | :--- | :--- | :--- |
| **101** | 45.50 | 2026-07-06 | **1** | Wocheneinkauf im Supermarkt |
| **102** | 62.00 | 2026-07-07 | **2** | Tankstelle |
| **103** | 12.50 | 2026-07-08 | **4** | Kino mit Freunden |
| **104** | 120.00 | 2026-07-08 | **3** | Stromrechnung |
| **105** | 4.80 | 2026-07-08 | **1** | *leer* |

Zwischen diesen beiden Tabellen besteht eine **1:N-Beziehung (One-to-Many)**: Dieselbe Kategorie kann mehreren Zeilen in der Ausgaben-Tabelle zugeordnet sein. Eine monatliche Hypothekenrate erscheint zum Beispiel $N$ Mal in der Ausgaben-Tabelle, jeweils verknüpft mit derselben Kategorie.

## Einrichtung der Cloud-Datenbank: Supabase

Nachdem unsere Tabellen definiert sind, können wir unsere Datenbank mit **Supabase** einrichten, einer Open-Source-Alternative zu Firebase.

1. Erstelle ein Konto im Supabase-Dashboard und starte ein neues Projekt.
2. Du wirst aufgefordert, ein Datenbank-Passwort einzugeben (das das Frontend zur Kommunikation mit der DB verwendet). Lass die übrigen Parameter auf ihren Standardwerten.
3. Sobald das Projekt erstellt ist, geh zum **Table Editor**, um unsere beiden Tabellen anzulegen. Die Ausgaben-Tabelle erhält einen Foreign Key, der auf die Kategorie-ID verweist.

### Tabellendefinitionen in Supabase:
**Kategorien-Tabelle (`tag`)**
- `id`: eindeutiger Bezeichner (Primary Key)
- `name`: Name der Kategorie (z. B. Hypothek, Benzin, Lebensmittel)

**Ausgaben-Tabelle (`expenses`)**
- `id`: eindeutiger Bezeichner (Primary Key)
- `amount`: numerischer Wert
- `date`: Datum der Transaktion
- `id_tag`: Foreign Key, verknüpft mit der Kategorien-Tabelle
- `notes`: optionaler Text

Mit der fertig erstellten Datenbank können wir uns nun von unserem Frontend aus mit ihr verbinden und mit dem Einfügen von Testdaten beginnen. Die Verbindungsparameter der Datenbank (Host, Port, Datenbankname, Benutzer) findest du im Supabase-Dashboard unter den Verbindungseinstellungen (dort konkret den Transaction Pooler auswählen).

---
*In Teil 2 schauen wir uns an, wie wir unser Flutter-Frontend einrichten, es mit Supabase verbinden und unsere Benutzeroberfläche gestalten. Bleib dran!*
