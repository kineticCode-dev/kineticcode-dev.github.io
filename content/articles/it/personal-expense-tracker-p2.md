---
title: "Costruire un Tracker di Spese Personali da Zero: Architettura e Progettazione del Database (Parte 2)"
description: "Questo articolo ripercorre il processo di progettazione e sviluppo di un'applicazione web per il tracciamento delle spese personali. L'obiettivo non è solo creare uno strumento funzionante, ma analizzare ogni decisione tecnica e capire il 'perché' dietro le nostre scelte tecnologiche."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Database", "Supabase", "Frotend", "BaaS"]
---

Bentornati! Nella **Parte 1** abbiamo affrontato le scelte architetturali e impostato il nostro database con Supabase. In questa seconda parte ci addentriamo nello sviluppo del frontend con **Flutter**. Configureremo il progetto, lo collegheremo al nostro database cloud e inizieremo a costruire l'interfaccia utente.

[Link al repository Github](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Indice
1. [Configurazione e Impostazione del Progetto](#project-setup-and-configuration)
2. [Connessione a Supabase](#connecting-to-supabase)
3. [Progettazione del Mockup della Web App](#designing-the-web-app-mockup)
4. [Compilazione Web e Test in Locale](#web-compilation-and-local-testing)
5. [Sviluppo della Vista di Inserimento](#developing-the-insert-view)

---

## Configurazione e Impostazione del Progetto

Stiamo usando Flutter per costruire un'interfaccia web responsive. Se non hai Flutter installato, trovi le istruzioni nella [documentazione ufficiale](https://docs.flutter.dev/install).

Per generare lo scheletro del progetto specifico per il web, esegui questo comando nel terminale:

```bash
$ flutter create . --platform=web
```

Specificando `--platform=web`, otteniamo una struttura di progetto più snella, senza le cartelle per Android, iOS o Windows.

Ora installiamo l'SDK ufficiale di Supabase per Flutter:

```bash
$ flutter pub add supabase_flutter
```

Per verificare che tutto funzioni, avviamo l'app in Chrome:

```bash
$ flutter run -d chrome
```

Dovrebbe aprirsi automaticamente una finestra di Chrome con la demo predefinita di Flutter. Tieni aperta questa finestra: grazie alla funzione di **hot reload** di Flutter, la pagina si aggiornerà automaticamente ogni volta che salviamo delle modifiche al codice.

## Connessione a Supabase

Vediamo ora se la nostra app Flutter riesce a comunicare con Supabase. In Flutter, tutto è un widget: pulsanti, testo e persino l'allineamento sono widget. Modificheremo l'app demo per collegarla al nostro database e testare l'inserimento di una categoria.

Per prima cosa, recupera i dettagli di connessione a Supabase. Nella dashboard di Supabase, vai nelle impostazioni di connessione, seleziona Flutter come framework e copia i valori di `url` e `publishableKey`.

Aggiorna la funzione `main` in Flutter per inizializzare Supabase all'avvio:

```dart
void main() async {
  // Assicurati che il motore di Flutter sia pronto prima di usare le chiamate di rete
  WidgetsFlutterBinding.ensureInitialized();

  // Inizializza Supabase con i dettagli del tuo progetto
  await Supabase.initialize(
    url: 'YOUR_PROJECT_URL',
    publishableKey: 'YOUR_PUBLISHABLE_KEY',
  );

  // Avvia l'app
  runApp(const MyApp());
}
```

*Nota: prima di scrivere sulle tabelle di Supabase lato client, assicurati di configurare correttamente la Row Level Security (RLS). Per i primi test potresti disabilitare temporaneamente la RLS, ma ricordati sempre di proteggere le tue tabelle in produzione!*

Ecco un semplice widget per testare la scrittura sul database:

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

Cliccando sul pulsante, verrà aggiunta una nuova categoria "flutter" al nostro database!

## Compilazione Web e Test in Locale

Per compilare l'app per la produzione web, esegui:

```bash
$ flutter build web --release
```

Questo genera `index.html` e i file JavaScript necessari nella cartella `build/web`.

Per vedere come appare la web app sul tuo cellulare (a patto che sia sulla stessa rete WiFi), puoi avviare un semplice server locale dalla cartella `build/web`:

```bash
$ python -m http.server 8080
```

Poi apri il browser del telefono e vai all'indirizzo IP locale del tuo computer (ad esempio, `http://192.168.1.50:8080`).

## Conclusione della Parte 2
In questo episodio abbiamo avviato con successo la nostra applicazione web Flutter e stabilito una connessione diretta e funzionante con il nostro backend Supabase. Ora possiamo leggere e scrivere dati in modo sicuro sul nostro database cloud direttamente dal frontend, eliminando di fatto la necessità di un'API intermedia personalizzata.

***Cosa ci aspetta nella Parte 3?*** Ora che l'infrastruttura tecnica è a posto, siamo pronti a concentrarci sull'esperienza utente. Nel prossimo articolo daremo vita alla nostra app esplorando i mockup dell'interfaccia, costruendo le schermate di inserimento dati (Vista di Inserimento) e gettando le basi per la nostra Dashboard interattiva. Restate sintonizzati!
