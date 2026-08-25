---
title: "Construire un Suivi de Dépenses Personnelles à Partir de Zéro : Architecture et Conception de la Base de Données (Partie 3)"
description: "Cet article retrace le processus de conception et de développement d'une application web de suivi des dépenses personnelles. L'objectif n'est pas seulement de créer un outil fonctionnel, mais d'analyser chaque décision d'ingénierie et de comprendre le « pourquoi » derrière nos choix technologiques."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Base de données", "Supabase", "Frotend", "BaaS"]
---

Bon retour ! Dans la **Partie 2**, nous avons abordé le développement du frontend avec **Flutter**. Nous avons configuré le projet, l'avons connecté à notre base de données cloud, et avons commencé à construire l'interface utilisateur.

[Lien vers le dépôt Github](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Maquettes de la Webapp
La webapp sera composée de deux écrans différents :
* Un dashboard : où nous afficherons des graphiques en barres et des graphiques circulaires.
* Un écran de saisie : où nous pourrons ajouter des dépenses à notre base de données.

La maquette du dashboard ressemble à ceci :
![Vue Principale](./img/mainView.png)

La maquette de la vue de saisie ressemble à ceci :
![Vue de Saisie](./img/insertView.png)

## Développement de la Vue de Saisie
Dans cette section, nous allons développer la vue de saisie qui nous permet d'ajouter une dépense à la base de données.
L'utilisateur devra saisir :
* Le montant de la dépense/du revenu. Les dépenses seront enregistrées avec des montants négatifs, et les revenus avec des montants positifs.
* La date à laquelle la dépense a eu lieu.
* La catégorie à laquelle elle appartient.
* Des notes.

L'interface finale ressemble à ceci :
![Vue de Saisie](./img/insert_view.png)

## Développement de la Vue Dashboard
Nous allons maintenant développer la Vue Dashboard, qui sera l'écran récapitulatif de nos finances. L'idée est d'insérer quelques graphiques pour montrer immédiatement notre situation financière. Nous devons tenir compte du fait qu'elle sera utilisée principalement depuis un mobile, donc l'écran sera petit. Il est très important d'organiser l'espace du mieux possible. Une bonne idée pourrait être : je n'affiche qu'un seul graphique à la fois, et j'ai d'une certaine manière la possibilité de changer de vue.

Commençons par installer le paquet Flutter qui nous permet de dessiner des graphiques :

```bash
$ flutter pub add fl_chart
```

Ensuite, nous importons le paquet :

```dart 
import 'package:fl_chart/fl_chart.dart';
```

Le premier graphique que nous allons développer sera celui des dépenses du mois en cours. Pour cela, nous utiliserons un graphique circulaire classique.
Pour calculer les dépenses mensuelles, nous avons deux approches possibles :
* Je lis toutes les dépenses du mois depuis la base de données vers Flutter, et à l'intérieur de Flutter, je parcours dépense par dépense et je calcule ce dont j'ai besoin, comme le montant final et le montant par catégorie.
* J'agrège les données directement dans la base de données et je manipule une partie des données déjà agrégées.

Nous suivrons cette deuxième voie. Cela nous permet de déléguer à la base de données autant de travail lourd et de filtrage que possible, car une base de données est un outil né précisément pour faire des agrégations.
Pour cela, nous utiliserons une Stored Procedure. Une `Stored Procedure`, ou `Function`, est un bloc de code écrit en langage SQL qui est enregistré et exécuté directement à l'intérieur de la base de données. On peut la considérer comme une véritable fonction logicielle, avec des arguments en entrée et une valeur de retour, qui vit sur le serveur de la base de données. Chaque client qui se connecte à la base de données a ces fonctions à sa disposition.

Pourquoi vaut-il mieux utiliser une Stored Procedure dans notre cas ? Voici les raisons :
* **Efficacité réseau :** si un utilisateur a enregistré 200 dépenses dans un mois, une requête standard téléchargerait 200 enregistrements JSON sur internet. Avec la stored procedure, la base de données calcule les sommes en interne et ne renvoie que quelques lignes (une par catégorie active, par exemple 5 lignes). Moins de données qui circulent signifie une application plus rapide.
* **Performance :** le moteur SQL de PostgreSQL est hautement optimisé pour parcourir et agréger des enregistrements. Exécuter la somme (`SUM`) et le regroupement (`GROUP BY`) nativement sur le serveur est infiniment plus rapide que de faire la même opération en parcourant une liste en Dart sur le CPU d'un smartphone.
* **Surmonter les limites de l'API client :** les bibliothèques client de Supabase sont excellentes pour les opérations CRUD simples, mais elles ne supportent pas nativement la clause SQL `GROUP BY`. Créer une fonction sur la base de données nous permet d'exploiter toute la puissance du langage SQL (PL/pgSQL) en l'exposant à Flutter via un appel très simple.

Tout cela vaut également pour les dépenses hebdomadaires, alors créons une stored procedure générique qui prend en entrée :
* l'année
* le mois/la semaine
* la granularité (mensuelle/hebdomadaire)

Et qui renvoie, pour ce mois/cette semaine spécifique :
* la catégorie de dépense
* le montant

Pour cela, nous allons dans Supabase, dans l'éditeur SQL, et nous écrivons ce code :

```sql
CREATE OR REPLACE FUNCTION get_aggregated_expenses(
    req_year INT,
    req_value INT, -- Mois (1-12) ou semaine (1-53)
    time_frame TEXT -- Peut être 'monthly' ou 'weekly'
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

Côté client, pour connaître la liste des dépenses d'un mois spécifique, il suffit de faire :

```sql
SELECT * FROM get_aggregated_expenses(2026, 7, 'monthly');
```

Et pour connaître la liste des dépenses d'une semaine spécifique :

```sql
SELECT * FROM get_aggregated_expenses(2026, 28, 'weekly');
```

Et la base de données répondra avec les données demandées.

Le Dashboard final ressemble à ceci :

![Dashboard](./img/dashboard_view.png)

![Dashboard2](./img/dashboard_view2.png)

## Publier la webapp en ligne
Pour héberger notre application web Flutter, nous utiliserons GitHub Pages comme service d'hébergement pour site statique, qui est entièrement gratuit. Une fois compilée, notre webapp n'est rien de plus qu'un ensemble de fichiers `HTML, CSS, JavaScript et assets`.

Voyons les étapes pour le faire. Les prérequis sont :
* Un compte GitHub
* Git installé sur le PC
* Le build de la webapp

### Étape 1 : Modifier le `base href` dans Flutter
Ouvrons le terminal à la racine du projet Flutter, là où se trouve le fichier `pubspec.yaml`, et exécutons la commande suivante dans le terminal :
```bash
flutter build web --release --base-href "/<name-of-your-repo>/" --pwa-strategy=none
```

À ce stade, la compilation démarrera à l'intérieur du dossier `/build/web`. Une fois terminée, nous trouverons les fichiers `index.html`, `main.dart.js`, `flutter_bootstrap.js` et `flutter_service_worker.js`.

### Étape 2 : Créer le Dépôt sur GitHub
1. Allons sur GitHub et créons un nouveau dépôt.
2. Choisissons le nom (le même que celui utilisé dans le `--base-href`).
3. Définissons le dépôt comme public, ce qui est nécessaire pour avoir GitHub Pages gratuitement.
4. Laissons décochées les options "`Add a README`" ou "`.gitignore`".

### Étape 3 : L'astuce du 404 pour les SPA
Pour résoudre le problème des rafraîchissements de page, nous appliquons la solution suivante :
1. Nous naviguons jusqu'au dossier `build/web` sur notre PC.
2. Nous dupliquons le fichier `index.html` et le renommons en `404.html`.
Ainsi, si un utilisateur recharge la page sur une URL profonde, GitHub ne trouvera pas la page, il chargera le fichier `404.html` (identique à `index.html`), et Flutter prendra le contrôle en lisant l'URL et en redirigeant l'utilisateur vers le bon écran.

### Étape 4 : Téléverser les fichiers
Nous ajoutons l'ensemble du dossier `build/web` au dépôt GitHub que nous venons de créer.

### Étape 5 : Activer GitHub Pages
1. Rendons-nous sur notre dépôt GitHub.
2. Cliquons sur **Settings** en haut à droite.
3. Dans le menu de gauche, cliquons sur **Pages**.
4. Sous **Build and deployment**, nous définissons la source sur **Deploy from a branch**.
5. Sous **Branch**, nous sélectionnons `main` et le dossier `/ (root)`, puis nous cliquons sur **Save**.
6. GitHub Actions construira la page. Nous trouverons l'URL finale en haut de la même section Pages dès que le processus sera terminé, ce qui prend quelques minutes.
