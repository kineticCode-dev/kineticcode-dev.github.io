---
title: "Sécuriser Supabase dans un monde open source"
description: "Comment autoriser l'accès à la Base de données Supabase uniquement aux comptes autorisés"
date: "2026-07-19"
category: "software"
tags: ["Base de données", "Supabase", "RLS"]
---

# Table des matières
- [1. Le paradoxe des API Key dans le frontend](#1-the-paradox-of-api-keys-in-the-frontend)
- [2. Row Level Security (RLS) et Database Policies](#2-row-level-security-rls-and-database-policies)
- [3. Mettre en place le flux d'authentification](#3-implementing-the-authentication-flow)

## 1. Le paradoxe des API Key dans le frontend
Dans le développement logiciel traditionnel, c'est le backend qui communique directement avec la base de données, et c'est lui qui détient toutes les informations de connexion. Mais dans le monde Serverless, avec les plateformes Backend-as-a-Service (BaaS) comme Supabase, c'est le frontend qui parle directement à la base de données. Pour cela, il a besoin de deux informations essentielles :
* L'URL de Supabase
* La `anon_key` (clé anonyme), qui indique à Supabase : "Ce trafic vient de la webapp X, attribue à cette requête le rôle d'utilisateur anonyme."

Le problème, c'est que l'URL et la clé anonyme se retrouvent toutes les deux dans les fichiers JavaScript téléchargés dans le navigateur de l'utilisateur. Il suffit d'ouvrir les outils de développement du navigateur (F12) pour les voir apparaître.

Le frontend est donc, par nature, un environnement non sécurisé. On ne peut rien cacher dans un fichier JavaScript exécuté côté client. Et comme une web app doit être hébergée sur une URL publique pour être accessible de partout, il faut accepter que le frontend soit ouvert à tout le monde. Il va sans dire que la sécurité ne peut pas reposer uniquement sur le frontend : elle doit être appliquée au niveau de la base de données. C'est exactement ce que permet une fonctionnalité appelée **Row Level Security (RLS)**.

## 2. Row Level Security (RLS) et Database Policies
Les bases de données traditionnelles utilisent en général un contrôle d'accès horizontal : si vous avez les identifiants de connexion, vous accédez à la table ; sinon, non.
RLS introduit un contrôle vertical. Quand l'app fait une requête, la base de données ne répond pas immédiatement : elle vérifie d'abord ligne par ligne, en appliquant une règle précise définie par le développeur. Si la règle renvoie `TRUE`, la ligne s'affiche ; sinon, elle reste cachée.

Si l'on active RLS sur Supabase sans avoir défini la moindre policy d'accès, la base de données se verrouille instantanément. Même en se connectant avec la bonne URL et la bonne clé anonyme, on ne récupère qu'une liste vide.

## 3. Mettre en place le flux d'authentification
Pour retrouver un accès sécurisé à nos données, il faut que la base de données sache précisément qui fait la requête. Cela demande des modifications à la fois dans la base de données SQL et dans le code du frontend.

### Étape 1 : Activer RLS sur Supabase
Rendez-vous d'abord dans le dashboard Supabase, allez dans **Database > Tables**, sélectionnez vos tables et cliquez sur **Enable RLS**. À partir de ce moment, votre URL publique cessera d'afficher des données à qui que ce soit (vous y compris, pour l'instant).

### Étape 2 : Ajouter un utilisateur
Allez dans l'onglet **Authentication** de Supabase et ajoutez un nouvel utilisateur. L'email et le mot de passe définis ici seront ceux utilisés pour se connecter depuis le frontend.

### Étape 3 : Ajouter une colonne utilisateur à la base de données
Pour que la base de données sache à qui appartiennent certaines données, la table doit avoir une colonne liée au système d'authentification de Supabase :
- Créez une nouvelle colonne nommée `user_id` de type `uuid`.
- Définissez sa valeur par défaut sur `auth.uid()` (une fonction native de Supabase qui récupère l'ID de l'utilisateur effectuant l'action).

### Étape 4 : Mettre à jour le frontend
Il faut maintenant modifier le frontend pour inclure un processus de connexion au démarrage de l'app. Si l'utilisateur saisit les bons identifiants, on se connecte à Supabase avec la méthode suivante (exemple en Dart/Flutter) :

```dart
await Supabase.instance.client.auth.signInWithPassword(
  email: _emailController.text.trim(),
  password: _passwordController.text.trim(),
);
```

À ce stade, la connexion est authentifiée par mot de passe. Supabase sait désormais qui nous sommes, mais il n'affichera toujours pas les données de la table tant qu'on n'a pas créé les policies de sécurité.

### Étape 5 : Créer les policies de sécurité
On peut créer la policy de sécurité directement depuis l'éditeur SQL de Supabase :

```sql
CREATE POLICY "Allow access only to owner"
ON public.YOUR_TABLE_NAME
FOR ALL -- Valable pour SELECT, INSERT, UPDATE, DELETE
TO authenticated -- S'applique uniquement aux utilisateurs connectés
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id); 
```

Avec cette policy en place, la base de données n'affiche en toute sécurité les lignes de la table qu'à leurs propriétaires légitimes.
