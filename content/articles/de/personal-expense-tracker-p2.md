---
title: "Einen persönlichen Ausgaben-Tracker von Grund auf bauen: Architektur und Datenbankdesign (Teil 2)"
description: "Dieser Artikel zeichnet den Design- und Entwicklungsprozess einer Webanwendung zur Verfolgung persönlicher Ausgaben nach. Das Ziel ist nicht nur, ein funktionierendes Tool zu erstellen, sondern jede technische Entscheidung zu analysieren und das „Warum“ hinter unseren technologischen Entscheidungen zu verstehen."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Datenbank", "Supabase", "Frotend", "BaaS"]
---

Willkommen zurück! In **Teil 1** haben wir die architektonischen Entscheidungen besprochen und unsere Datenbank mit Supabase eingerichtet. In diesem zweiten Teil widmen wir uns der Entwicklung des Frontends mit **Flutter**. Wir richten das Projekt ein, verbinden es mit unserer Cloud-Datenbank und beginnen mit dem Aufbau der Benutzeroberfläche.

[Link zum Github-Repository](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Inhaltsverzeichnis
1. [Projekt-Setup und Konfiguration](#project-setup-and-configuration)
2. [Verbindung zu Supabase](#connecting-to-supabase)
3. [Entwurf des Web-App-Mockups](#designing-the-web-app-mockup)
4. [Web-Kompilierung und lokales Testen](#web-compilation-and-local-testing)
5. [Entwicklung der Eingabeansicht](#developing-the-insert-view)

---

## Projekt-Setup und Konfiguration

Wir verwenden Flutter, um eine responsive Weboberfläche zu bauen. Falls du Flutter noch nicht installiert hast, findest du die Anleitung in der [offiziellen Dokumentation](https://docs.flutter.dev/install).

Um das Projektgerüst speziell für Web zu erzeugen, führe folgenden Befehl in deinem Terminal aus:

```bash
$ flutter create . --platform=web
```

Mit `--platform=web` erhalten wir eine schlankere Projektstruktur, ohne die Ordner für Android, iOS oder Windows.

Als Nächstes installieren wir das offizielle Supabase-SDK für Flutter:

```bash
$ flutter pub add supabase_flutter
```

Um zu prüfen, ob alles funktioniert, starten wir die App in Chrome:

```bash
$ flutter run -d chrome
```

Es sollte sich automatisch ein Chrome-Fenster mit der Standard-Flutter-Demo öffnen. Lass dieses Fenster geöffnet – dank Flutters **Hot-Reload**-Funktion aktualisiert sich die Seite automatisch, sobald wir Änderungen am Code speichern.

## Verbindung zu Supabase

Schauen wir jetzt, ob unsere Flutter-App mit Supabase kommunizieren kann. In Flutter ist alles ein Widget – Buttons, Text und sogar die Ausrichtung sind Widgets. Wir passen die Demo-App an, verbinden sie mit unserer Datenbank und testen das Einfügen einer Kategorie.

Hol dir zuerst deine Supabase-Verbindungsdaten. Gehe im Supabase-Dashboard zu den Verbindungseinstellungen, wähle Flutter als Framework aus und kopiere deine Werte für `url` und `publishableKey`.

Aktualisiere deine `main`-Funktion in Flutter, um Supabase beim Start zu initialisieren:

```dart
void main() async {
  // Sicherstellen, dass die Flutter-Engine bereit ist, bevor Netzwerkaufrufe verwendet werden
  WidgetsFlutterBinding.ensureInitialized();

  // Supabase mit den Projektdaten initialisieren
  await Supabase.initialize(
    url: 'YOUR_PROJECT_URL',
    publishableKey: 'YOUR_PUBLISHABLE_KEY',
  );

  // App starten
  runApp(const MyApp());
}
```

*Hinweis: Bevor du client-seitig in Supabase-Tabellen schreibst, stelle sicher, dass du die Row Level Security (RLS) korrekt konfigurierst. Für erste Tests kannst du RLS vorübergehend deaktivieren, aber sichere deine Tabellen für den produktiven Einsatz immer ab!*

Hier ist ein einfaches Widget, um das Schreiben in die Datenbank zu testen:

```dart
class ConnectionTestPage extends StatefulWidget {
  const ConnectionTestPage({super.key});
  @override
  State<ConnectionTestPage> createState() => _ConnectionTestPageState();
}

class _ConnectionTestPageState extends State<ConnectionTestPage> {
  bool _isLoading = false;
  String _resultMessage = 'No test executed yet';

  Future<void> _sendTestData() async {
    setState(() {
      _isLoading = true;
      _resultMessage = 'Sending data...';
    });

    try {
      await Supabase.instance.client
          .from('tag')
          .insert({'name': 'flutter'});

      setState(() {
        _resultMessage = 'Success! Connection and write working.';
      });
    } catch (error) {
      setState(() {
        _resultMessage = 'Error during send: $error';
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Supabase Connection Test')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_resultMessage, style: const TextStyle(fontSize: 18), textAlign: TextAlign.center),
            const SizedBox(height: 20),
            _isLoading
                ? const CircularProgressIndicator()
                : ElevatedButton(
                    onPressed: _sendTestData,
                    child: const Text('Send Test Data'),
                  ),
          ],
        ),
      ),
    );
  }
}
```

Mit einem Klick auf den Button wird der Datenbank eine neue Kategorie „flutter“ hinzugefügt!

## Web-Kompilierung und lokales Testen

Um die App für die Produktion im Web zu kompilieren, führe aus:

```bash
$ flutter build web --release
```

Dadurch werden `index.html` und die notwendigen JavaScript-Dateien im Verzeichnis `build/web` erzeugt.

Um zu testen, wie die Web-App auf deinem Handy aussieht (vorausgesetzt, es ist im selben WLAN), kannst du im Verzeichnis `build/web` einen einfachen lokalen Server starten:

```bash
$ python -m http.server 8080
```

Öffne dann den Browser deines Telefons und rufe die lokale IP-Adresse deines Computers auf (zum Beispiel `http://192.168.1.50:8080`).

## Teil 2 im Rückblick
In dieser Folge haben wir unsere Flutter-Web-App erfolgreich zum Laufen gebracht und eine direkte, funktionierende Verbindung zu unserem Supabase-Backend hergestellt. Wir können jetzt sicher Daten aus unserer Cloud-Datenbank direkt vom Frontend aus lesen und schreiben – ein eigenes API-Zwischenglied ist damit nicht mehr nötig.

***Was erwartet uns in Teil 3?*** Jetzt, wo die technische Grundlage steht, können wir uns auf die Benutzererfahrung konzentrieren. Im nächsten Artikel erwecken wir unsere App zum Leben: Wir schauen uns die UI-Mockups an, bauen die Eingabemasken (Eingabeansicht) und legen den Grundstein für unsere interaktive Dashboard-Ansicht. Bleib dran!
