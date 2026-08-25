---
title: "Créer un suivi de dépenses personnelles de zéro : architecture et conception de la base de données (Partie 1)"
description: "Cet article retrace le processus de conception et de développement d'une application web de suivi des dépenses personnelles. L'objectif n'est pas seulement de créer un outil fonctionnel, mais d'analyser chaque décision d'ingénierie et de comprendre le « pourquoi » derrière nos choix technologiques."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Base de données", "Supabase", "Frotend", "BaaS"]
---

Cet article retrace le processus de conception et de développement d'une application web de suivi des dépenses personnelles. L'objectif n'est pas seulement de créer un outil fonctionnel, mais d'analyser chaque décision d'ingénierie et de comprendre le « pourquoi » derrière nos choix technologiques.

Ce projet se veut pédagogique mais concret, avec une approche professionnelle, sans tomber dans l'over-engineering ni se perdre dans des fonctionnalités superflues. C'est parti !

[Lien vers le dépôt GitHub](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Sommaire
1. [Spécifications Techniques](#technical-specifications)
2. [Architecture du Projet](#project-architecture)
3. [Modélisation de la Base de Données](#database-modeling)
4. [Configuration de la Base de Données Cloud : Supabase](#cloud-database-setup-supabase)

---

## Spécifications Techniques

L'objectif est simple : créer un suivi de dépenses personnelles. Les idées principales sont les suivantes :
- Développer une base de données pour stocker toutes les dépenses de l'utilisateur.
- Construire une web app à double usage :
  - Ajouter, supprimer ou modifier des dépenses dans la base de données.
  - Afficher un tableau de bord récapitulatif avec différents graphiques (dépenses hebdomadaires, mensuelles, etc.).

Le cas d'usage typique est le suivant : ouvrir la web app directement depuis un navigateur (PC, tablette, smartphone), ajouter une dépense et visualiser l'évolution financière. Pour garantir qu'elle soit vraiment utilisable au quotidien, une base de données dans le cloud est la solution privilégiée, afin que l'app reste accessible 24 heures sur 24, 7 jours sur 7.

Il existe déjà de nombreuses applications de suivi de dépenses, mais notre objectif ici est d'apprendre la technologie sous-jacente, en ne gardant que ce qui est essentiel pour l'objectif du projet.

## Architecture du Projet

Le logiciel est structuré en composants distincts. Au départ, une architecture standard à 3 niveaux avait été envisagée :
- **Frontend :** interface graphique accessible via le navigateur.
- **Backend :** application qui gère les requêtes du frontend et les redirige vers la base de données.
- **Base de données :** source de données hébergée dans le cloud.

Cependant, en utilisant une base de données cloud moderne de type Backend-as-a-Service (BaaS), on peut se passer du développement d'une API backend sur mesure. Par souci de simplicité et d'efficacité, nous développerons uniquement le frontend, en **Flutter**, qui communiquera directement avec notre base de données cloud.

## Modélisation de la Base de Données

Dans cette phase, nous définissons la structure conceptuelle des données, choisissons notre fournisseur cloud, et configurons les tables initiales ainsi que leurs relations.

Il nous faut deux tables distinctes :
1. **Table des Catégories** (Tag)
2. **Table des Dépenses**

### 1. Table des Catégories
Cette table contient les différents types de dépenses.

| id    | category_name   |
| :---- | :-------------- |
| **1** | Alimentation |
| **2** | Voiture et transports |
| **3** | Factures et logement |
| **4** | Loisirs |

### 2. Table des Dépenses
Cette table enregistre chaque transaction.

| expense_id | amount | date | category_id | notes |
| :--- | :--- | :--- | :--- | :--- |
| **101** | 45.50 | 2026-07-06 | **1** | Courses hebdomadaires |
| **102** | 62.00 | 2026-07-07 | **2** | Station-service |
| **103** | 12.50 | 2026-07-08 | **4** | Cinéma entre amis |
| **104** | 120.00 | 2026-07-08 | **3** | Facture d'électricité |
| **105** | 4.80 | 2026-07-08 | **1** | *vide* |

Il existe une **relation 1:N (un-à-plusieurs)** entre ces deux tables : une même catégorie peut être associée à plusieurs lignes de la table des dépenses. Par exemple, la mensualité d'un prêt immobilier apparaîtra $N$ fois dans la table des dépenses, toujours reliée à la même catégorie.

## Configuration de la Base de Données Cloud : Supabase

Nos tables étant définies, nous pouvons configurer notre base de données avec **Supabase**, une alternative open source à Firebase.

1. Créez un compte sur le dashboard de Supabase et démarrez un nouveau projet.
2. Il vous sera demandé de saisir un mot de passe de base de données (que le frontend utilisera pour communiquer avec la BD). Laissez les autres paramètres à leurs valeurs par défaut.
3. Une fois le projet créé, rendez-vous dans le **Table Editor** pour créer nos deux tables. La table des dépenses aura une foreign key pointant vers l'ID de la catégorie.

### Définition des Tables dans Supabase :
**Table des Catégories (`tag`)**
- `id` : identifiant unique (Primary Key)
- `name` : nom de la catégorie (ex. : prêt immobilier, essence, courses)

**Table des Dépenses (`expenses`)**
- `id` : identifiant unique (Primary Key)
- `amount` : valeur numérique
- `date` : date de la transaction
- `id_tag` : Foreign Key liée à la table des Catégories
- `notes` : texte optionnel

La base de données étant créée, nous sommes prêts à nous y connecter depuis notre frontend et à commencer à insérer des données de test. Vous trouverez les paramètres de connexion à la base de données (host, port, nom de la base, utilisateur) dans le dashboard de Supabase, au niveau des paramètres de connexion (en sélectionnant en particulier le transaction pooler).

---
*Dans la Partie 2, nous verrons comment configurer notre frontend Flutter, le connecter à Supabase et concevoir notre interface utilisateur. Restez connectés !*
