---
title: "Créer un Suivi de Dépenses Personnelles depuis Zéro : Architecture et Conception de la Base de Données (Partie 2)"
description: "Cet article retrace le processus de conception et de développement d'une application web de suivi des dépenses personnelles. L'objectif n'est pas seulement de créer un outil fonctionnel, mais d'analyser chaque décision d'ingénierie et de comprendre le « pourquoi » derrière nos choix technologiques."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Base de données", "Supabase", "Frotend", "BaaS"]
---

Bienvenue de retour ! Dans la **Partie 1**, nous avons vu les choix architecturaux et mis en place notre base de données avec Supabase. Dans cette deuxième partie, nous allons nous plonger dans le développement du frontend avec **Flutter**. Nous allons configurer le projet, le connecter à notre base de données cloud et commencer à construire l'interface utilisateur.

[Lien vers le dépôt Github](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Table des Matières
1. [Configuration du Projet](#project-setup-and-configuration)
2. [Connexion à Supabase](#connecting-to-supabase)
3. [Conception de la Maquette de la Web App](#designing-the-web-app-mockup)
4. [Compilation Web et Tests en Local](#web-compilation-and-local-testing)
5. [Développement de la Vue d'Insertion](#developing-the-insert-view)

---

## Configuration du Projet

Nous utilisons Flutter pour construire une interface web responsive. Si vous n'avez pas Flutter installé, vous trouverez les instructions dans la [documentation officielle](https://docs.flutter.dev/install).

Pour générer le squelette du projet spécifique au web, exécutez la commande suivante dans votre terminal :

```bash
$ flutter create . --platform=web
```

En spécifiant `--platform=web`, on obtient une structure de projet plus légère, sans les dossiers pour Android, iOS ou Windows.

Ensuite, installons le SDK officiel de Supabase pour Flutter :

```bash
$ flutter pub add supabase_flutter
```

Pour vérifier que tout fonctionne, lançons l'app dans Chrome :

```bash
$ flutter run -d chrome
```

Une fenêtre Chrome devrait s'ouvrir automatiquement en affichant la démo par défaut de Flutter. Gardez cette fenêtre ouverte : grâce au **hot reload** de Flutter, la page se mettra à jour automatiquement à chaque fois que nous enregistrerons des modifications dans notre code.

## Connexion à Supabase

Voyons maintenant si notre app Flutter arrive à communiquer avec Supabase. En Flutter, tout est un widget : les boutons, le texte, et même l'alignement sont des widgets. Nous allons modifier l'app de démo pour la connecter à notre base de données et tester l'insertion d'une catégorie.

Pour commencer, récupérez vos identifiants de connexion Supabase. Dans le tableau de bord Supabase, allez dans les paramètres de connexion, sélectionnez Flutter comme framework et copiez vos valeurs `url` et `publishableKey`.

Mettez à jour la fonction `main` de Flutter pour initialiser Supabase au démarrage :

```dart
void main() async {
  // S'assurer que le moteur Flutter est prêt avant d'utiliser les appels réseau
  WidgetsFlutterBinding.ensureInitialized();

  // Initialiser Supabase avec les informations de votre projet
  await Supabase.initialize(
    url: 'YOUR_PROJECT_URL',
    publishableKey: 'YOUR_PUBLISHABLE_KEY',
  );

  // Lancer l'app
  runApp(const MyApp());
}
```

*Remarque : avant d'écrire dans les tables Supabase depuis le client, assurez-vous de configurer correctement la Row Level Security (RLS). Pour les premiers tests, vous pouvez désactiver temporairement la RLS, mais pensez toujours à sécuriser vos tables en production !*

Voici un widget simple pour tester l'écriture dans la base de données :

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

En cliquant sur le bouton, une nouvelle catégorie « flutter » sera ajoutée à notre base de données !

## Compilation Web et Tests en Local

Pour compiler l'app pour la production sur le web, exécutez :

```bash
$ flutter build web --release
```

Cela génère `index.html` et les fichiers JavaScript nécessaires dans le dossier `build/web`.

Pour voir à quoi ressemble la web app sur votre téléphone (à condition qu'il soit sur le même réseau WiFi), vous pouvez démarrer un simple serveur local depuis le dossier `build/web` :

```bash
$ python -m http.server 8080
```

Ensuite, ouvrez le navigateur de votre téléphone et rendez-vous à l'adresse IP locale de votre ordinateur (par exemple, `http://192.168.1.50:8080`).

## Pour Conclure cette Partie 2
Dans cet épisode, nous avons réussi à démarrer notre application web Flutter et établi une connexion directe et fonctionnelle avec notre backend Supabase. Nous pouvons désormais lire et écrire des données en toute sécurité dans notre base de données cloud directement depuis le frontend, ce qui supprime le besoin d'une API intermédiaire personnalisée.

***Que nous réserve la Partie 3 ?*** Maintenant que la plomberie technique est en place, nous pouvons nous concentrer sur l'expérience utilisateur. Dans le prochain article, nous donnerons vie à notre app en explorant les maquettes de l'interface, en construisant les écrans de saisie de données (Vue d'Insertion) et en posant les bases de notre Dashboard interactive. Restez à l'écoute !
