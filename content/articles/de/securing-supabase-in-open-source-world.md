---
title: "Supabase in einer Open-Source-Welt absichern"
description: "Wie man den Zugriff auf die Supabase-Datenbank nur autorisierten Accounts erlaubt"
date: "2026-07-19"
category: "software"
tags: ["Datenbank", "Supabase", "RLS"]
---

# Inhaltsverzeichnis
- [1. Das Paradox der API Keys im Frontend](#1-the-paradox-of-api-keys-in-the-frontend)
- [2. Row Level Security (RLS) und Database Policies](#2-row-level-security-rls-and-database-policies)
- [3. Den Authentifizierungs-Flow implementieren](#3-implementing-the-authentication-flow)

## 1. Das Paradox der API Keys im Frontend
In der klassischen Softwareentwicklung kommuniziert das Backend direkt mit der Datenbank und hält dabei sämtliche Verbindungsdaten unter Verschluss. In der Serverless-Welt und bei Backend-as-a-Service-Plattformen (BaaS) wie Supabase ist es aber das Frontend, das direkt mit der Datenbank spricht. Dafür braucht es zwei zentrale Informationen:
* Die Supabase-URL
* Den `anon_key` (anonymen Schlüssel), der Supabase mitteilt: "Dieser Traffic kommt von Webapp X, weise dieser Anfrage die Rolle eines anonymen Nutzers zu."

Das Problem dabei: Sowohl die URL als auch der anonyme Schlüssel landen in den JavaScript-Dateien, die in den Browser des Nutzers heruntergeladen werden. Ein Blick in die Entwicklertools des Browsers (F12) genügt, um beide offenzulegen.

Das Frontend ist damit eine unsichere Umgebung. Wir können nichts in einer JavaScript-Datei verstecken, die clientseitig ausgeführt wird. Und da eine Webapp unter einer öffentlichen URL erreichbar sein muss, um von überall zugänglich zu sein, müssen wir akzeptieren, dass das Frontend für jeden offen liegt. Es versteht sich von selbst, dass Sicherheit nicht allein im Frontend gehandhabt werden kann — sie muss auf Ebene der Datenbank durchgesetzt werden. Genau dafür nutzen wir eine Funktion namens **Row Level Security (RLS)**.

## 2. Row Level Security (RLS) und Database Policies
Klassische Datenbanken arbeiten in der Regel mit horizontaler Zugriffskontrolle: Wer die Login-Daten hat, kommt an die Tabelle heran; wer sie nicht hat, kommt nicht heran.
RLS bringt stattdessen eine vertikale Kontrolle ins Spiel. Stellt die App eine Anfrage, antwortet die Datenbank nicht sofort — sie prüft zunächst Zeile für Zeile, nach einer bestimmten, vom Entwickler definierten Regel. Liefert die Regel `TRUE`, wird die Zeile angezeigt, sonst bleibt sie verborgen.

Aktivieren wir RLS auf Supabase, ohne irgendeine Zugriffs-Policy eingerichtet zu haben, sperrt sich die Datenbank sofort komplett. Selbst wer sich mit der richtigen URL und dem richtigen anonymen Schlüssel verbindet, bekommt nur eine leere Liste zurück.

## 3. Den Authentifizierungs-Flow implementieren
Um wieder sicheren Zugriff auf unsere Daten zu bekommen, muss die Datenbank genau erkennen, wer die Anfrage stellt. Dafür sind Änderungen sowohl in der SQL-Datenbank als auch im Frontend-Code nötig.

### Schritt 1: RLS auf Supabase aktivieren
Geh zunächst ins Supabase-Dashboard, navigiere zu **Database > Tables**, wähle deine Tabellen aus und klicke auf **Enable RLS**. Ab diesem Moment zeigt deine öffentliche URL niemandem mehr Daten an — vorerst auch dir selbst nicht.

### Schritt 2: Einen Nutzer hinzufügen
Geh zum Tab **Authentication** in Supabase und lege einen neuen Nutzer an. E-Mail und Passwort, die du hier festlegst, sind genau die, mit denen du dich später vom Frontend aus einloggst.

### Schritt 3: Eine User-Spalte zur Datenbank hinzufügen
Damit die Datenbank weiß, wem bestimmte Daten gehören, braucht die Tabelle eine Spalte, die mit dem Supabase-Authentifizierungssystem verknüpft ist:
- Lege eine neue Spalte namens `user_id` vom Typ `uuid` an.
- Setze als Standardwert `auth.uid()` (eine native Supabase-Funktion, die die ID des gerade handelnden Nutzers liefert).

### Schritt 4: Das Frontend aktualisieren
Jetzt müssen wir das Frontend so anpassen, dass beim Start der App ein Login-Prozess abläuft. Gibt der Nutzer die richtigen Zugangsdaten ein, verbinden wir uns mit Supabase über folgende Methode (Beispiel in Dart/Flutter):

```dart
await Supabase.instance.client.auth.signInWithPassword(
  email: _emailController.text.trim(),
  password: _passwordController.text.trim(),
);
```

Ab diesem Punkt ist die Verbindung mit einem Passwort authentifiziert. Supabase weiß jetzt, wer wir sind — zeigt die Tabellendaten aber trotzdem erst an, wenn wir die Sicherheits-Policies angelegt haben.

### Schritt 5: Sicherheits-Policies anlegen
Die Sicherheits-Policy können wir direkt im SQL-Editor von Supabase erstellen:

```sql
CREATE POLICY "Allow access only to owner"
ON public.YOUR_TABLE_NAME
FOR ALL -- Gilt für SELECT, INSERT, UPDATE, DELETE
TO authenticated -- Betrifft nur eingeloggte Nutzer
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id); 
```

Mit dieser Policy zeigt die Datenbank die Tabellenzeilen sicher nur noch den jeweils rechtmäßigen Eigentümern an.
