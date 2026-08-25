---
title: "Building a Personal Expense Tracker from Scratch: Architecture and Database Design (Part 2)"
description: "This article retraces the design and development process of a personal expense tracking web application. The goal isn't just to create a working tool, but to analyze every engineering decision and understand the 'why' behind our technological choices."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Database", "Supabase", "Frotend", "BaaS"]
---

Welcome back! In **Part 1**, we covered the architectural choices and set up our database using Supabase. In this second part, we will dive into developing the frontend using **Flutter**. We'll set up the project, connect it to our cloud database, and start building out the user interface.

[Link to Github Repository](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Table of Contents
1. [Project Setup and Configuration](#project-setup-and-configuration)
2. [Connecting to Supabase](#connecting-to-supabase)
3. [Designing the Web App Mockup](#designing-the-web-app-mockup)
4. [Web Compilation and Local Testing](#web-compilation-and-local-testing)
5. [Developing the Insert View](#developing-the-insert-view)

---

## Project Setup and Configuration

We are using Flutter to build a responsive web interface. If you don't have Flutter installed, you can find the instructions on the [official documentation](https://docs.flutter.dev/install).

To generate the project skeleton specifically for the web, run the following command in your terminal:

```bash
$ flutter create . --platform=web
```

By specifying `--platform=web`, we get a leaner project structure without the folders for Android, iOS, or Windows. 

Next, we need to install the official Supabase SDK for Flutter:

```bash
$ flutter pub add supabase_flutter
```

To verify everything is working, let's run the app in Chrome:

```bash
$ flutter run -d chrome
```

A Chrome window should automatically open displaying the default Flutter demo. Keep this window open—thanks to Flutter's **hot reload** feature, the page will automatically update as we save changes to our code.

## Connecting to Supabase

Now let's see if our Flutter app can talk to Supabase. In Flutter, everything is a widget—buttons, text, and even alignment are all widgets. We'll modify the demo app to connect to our database and test inserting a category.

First, grab your Supabase connection details. In your Supabase dashboard, go to the connection settings, select Flutter as your framework, and copy your `url` and `publishableKey`.

Update your `main` function in Flutter to initialize Supabase on startup:

```dart
void main() async {
  // Ensure Flutter engine is ready before using network calls
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize Supabase with your project details
  await Supabase.initialize(
    url: 'YOUR_PROJECT_URL',
    publishableKey: 'YOUR_PUBLISHABLE_KEY',
  );

  // Run the app
  runApp(const MyApp());
}
```

*Note: Before writing to Supabase tables from the client side, ensure you configure Row Level Security (RLS) appropriately. For initial testing, you might temporarily disable RLS, but always secure your tables for production!*

Here is a simple widget to test writing to the database:

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

By clicking the button, a new "flutter" category will be added to our database!

## Web Compilation and Local Testing

To build the app for production on the web, run:

```bash
$ flutter build web --release
```

This generates `index.html` and the necessary JavaScript files in the `build/web` directory.

To test how the web app looks on your mobile phone (provided it's on the same WiFi network), you can start a simple local server from the `build/web` directory:

```bash
$ python -m http.server 8080
```

Then, open your phone's browser and navigate to your computer's local IP address (e.g., `http://192.168.1.50:8080`).

## Wrapping Up Part 2
In this episode, we successfully bootstrapped our Flutter web application and established a direct, working connection to our Supabase backend. We can now securely read and write data to our cloud database straight from the frontend, effectively removing the need for a custom API middleman.

***What’s Next in Part 3?*** Now that the technical plumbing is in place, we are ready to focus on the user experience. In the next article, we will bring our app to life by exploring the UI mockups, building out the data entry screens (Insert View), and laying the groundwork for our interactive Dashboard View. Stay tuned!