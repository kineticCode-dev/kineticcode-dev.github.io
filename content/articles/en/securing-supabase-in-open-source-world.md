---
title: "Securing Supabase in an Open Source World"
description: "How to allow access to Supabase Database only to authorized account"
date: "2026-07-19"
category: "software"
tags: ["Database", "Supabase", "RLS"]
---

# Table of Contents
- [1. The Paradox of API Keys in the Frontend](#1-the-paradox-of-api-keys-in-the-frontend)
- [2. Row Level Security (RLS) and Database Policies](#2-row-level-security-rls-and-database-policies)
- [3. Implementing the Authentication Flow](#3-implementing-the-authentication-flow)

## 1. The Paradox of API Keys in the Frontend
In traditional software development, the backend communicates directly with the database, holding all the connection credentials. However, in the Serverless world and with Backend-as-a-Service (BaaS) platforms like Supabase, the frontend talks directly to the database. To do this, it needs two key pieces of information:
* The Supabase URL
* The `anon_key` (anonymous key), which tells Supabase: "This traffic comes from webapp X, assign this request the role of an anonymous user."

The problem is that both the URL and the anonymous key are stored inside the JavaScript files that are downloaded to the user's browser. Simply opening the browser's Developer Tools (F12) reveals them.

Therefore, the frontend is an insecure environment. We cannot hide anything inside a JavaScript file executed on the client side. Since a web app must be hosted on a public URL to be accessible from anywhere, we have to accept that the frontend is open to everyone. It goes without saying that security cannot be handled purely in the frontend—it must be enforced at the database level. To achieve this, we use a feature called **Row Level Security (RLS)**.

## 2. Row Level Security (RLS) and Database Policies
Typically, traditional databases use horizontal access control: if you have the login credentials, you can access the table; if not, you can't. 
RLS introduces vertical control. When the app makes a request, the database does not respond immediately. First, it checks the request row by row, applying a specific rule defined by the developer. If the rule returns `TRUE`, the row is displayed; otherwise, it remains hidden. 

If we enable RLS on Supabase without setting up any access policies, the database locks down instantly. Even if someone connects with the correct URL and anonymous key, they will only receive an empty list.

## 3. Implementing the Authentication Flow
To regain access to our data securely, we need to ensure the database recognizes exactly who is requesting it. This requires changes in both the SQL database and the frontend code.

### Step 1: Enable RLS on Supabase
First, go to your Supabase dashboard, navigate to **Database > Tables**, select your tables, and click **Enable RLS**. From this moment on, your public URL will stop showing data to anyone (including you, for now).

### Step 2: Add a User
Go to the **Authentication** tab in Supabase and add a new user. The email and password you set here will be the ones you use to log in from the frontend.

### Step 3: Add a User Column to the Database
To let the database know who owns specific data, the table must have a column linked to the Supabase authentication system:
- Create a new column named `user_id` of type `uuid`.
- Set its default value to `auth.uid()` (a native Supabase function that retrieves the ID of the user performing the action).

### Step 4: Update the Frontend
Now, we need to modify the frontend to include a login process when the app starts. If the user enters the correct credentials, we connect to Supabase using the following method (example in Dart/Flutter):

```dart
await Supabase.instance.client.auth.signInWithPassword(
  email: _emailController.text.trim(),
  password: _passwordController.text.trim(),
);
```

At this point, the connection is authenticated with a password. Supabase now knows who we are, but it still won't show the table data until we create security policies.

### Step 5: Create Security Policies
We can create the security policy directly from the SQL editor in Supabase:

```sql
CREATE POLICY "Allow access only to owner"
ON public.YOUR_TABLE_NAME
FOR ALL -- Valid for SELECT, INSERT, UPDATE, DELETE
TO authenticated -- Applies only to logged-in users
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id); 
```

With this policy in place, the database securely displays the table rows only to their rightful owners.
