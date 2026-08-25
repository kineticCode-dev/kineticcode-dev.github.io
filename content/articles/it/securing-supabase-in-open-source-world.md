---
title: "Mettere in sicurezza Supabase in un mondo open source"
description: "Come consentire l'accesso al Database Supabase solo agli account autorizzati"
date: "2026-07-19"
category: "software"
tags: ["Database", "Supabase", "RLS"]
---

# Indice
- [1. Il paradosso delle API Key nel frontend](#1-the-paradox-of-api-keys-in-the-frontend)
- [2. Row Level Security (RLS) e Database Policies](#2-row-level-security-rls-and-database-policies)
- [3. Implementare il flusso di autenticazione](#3-implementing-the-authentication-flow)

## 1. Il paradosso delle API Key nel frontend
Nello sviluppo software tradizionale, è il backend a comunicare direttamente con il database, ed è lui a custodire tutte le credenziali di connessione. Nel mondo Serverless, però, e con le piattaforme Backend-as-a-Service (BaaS) come Supabase, è il frontend a parlare direttamente con il database. Per farlo, ha bisogno di due informazioni fondamentali:
* L'URL di Supabase
* La `anon_key` (chiave anonima), che dice a Supabase: "Questo traffico arriva dalla webapp X, assegna a questa richiesta il ruolo di utente anonimo."

Il problema è che sia l'URL sia la chiave anonima finiscono dentro i file JavaScript che vengono scaricati nel browser dell'utente. Basta aprire gli strumenti per sviluppatori del browser (F12) per vederli entrambi.

Il frontend, quindi, è un ambiente insicuro. Non possiamo nascondere nulla dentro un file JavaScript che viene eseguito lato client. E dato che una web app deve stare su un URL pubblico per essere raggiungibile da qualsiasi parte, dobbiamo accettare che il frontend sia aperto a chiunque. Va da sé che la sicurezza non può essere gestita solo nel frontend: deve essere imposta a livello di database. Per farlo, usiamo una funzionalità chiamata **Row Level Security (RLS)**.

## 2. Row Level Security (RLS) e Database Policies
I database tradizionali usano tipicamente un controllo degli accessi orizzontale: se hai le credenziali di login, accedi alla tabella; se non le hai, non accedi.
RLS introduce invece un controllo verticale. Quando l'app fa una richiesta, il database non risponde subito: prima controlla riga per riga, applicando una regola specifica definita dallo sviluppatore. Se la regola restituisce `TRUE`, la riga viene mostrata; altrimenti resta nascosta.

Se abilitiamo RLS su Supabase senza aver impostato alcuna policy di accesso, il database si blocca all'istante. Anche connettendosi con l'URL e la chiave anonima corretti, si riceverà soltanto una lista vuota.

## 3. Implementare il flusso di autenticazione
Per riottenere l'accesso ai nostri dati in modo sicuro, dobbiamo far sì che il database riconosca esattamente chi sta facendo la richiesta. Questo richiede modifiche sia nel database SQL sia nel codice del frontend.

### Passo 1: Abilita RLS su Supabase
Per prima cosa, vai nella dashboard di Supabase, entra in **Database > Tables**, seleziona le tue tabelle e clicca su **Enable RLS**. Da questo momento, il tuo URL pubblico smetterà di mostrare dati a chiunque (te compreso, per ora).

### Passo 2: Aggiungi un utente
Vai nella scheda **Authentication** di Supabase e aggiungi un nuovo utente. L'email e la password che imposti qui saranno quelle che userai per accedere dal frontend.

### Passo 3: Aggiungi una colonna utente al database
Per far sapere al database a chi appartengono determinati dati, la tabella deve avere una colonna collegata al sistema di autenticazione di Supabase:
- Crea una nuova colonna chiamata `user_id` di tipo `uuid`.
- Imposta come valore predefinito `auth.uid()` (una funzione nativa di Supabase che recupera l'ID dell'utente che sta eseguendo l'azione).

### Passo 4: Aggiorna il frontend
Ora dobbiamo modificare il frontend per includere un processo di login all'avvio dell'app. Se l'utente inserisce le credenziali corrette, ci connettiamo a Supabase usando il seguente metodo (esempio in Dart/Flutter):

```dart
await Supabase.instance.client.auth.signInWithPassword(
  email: _emailController.text.trim(),
  password: _passwordController.text.trim(),
);
```

A questo punto, la connessione è autenticata con una password. Supabase sa chi siamo, ma non mostrerà comunque i dati della tabella finché non creiamo le policy di sicurezza.

### Passo 5: Crea le policy di sicurezza
Possiamo creare la policy di sicurezza direttamente dall'editor SQL di Supabase:

```sql
CREATE POLICY "Allow access only to owner"
ON public.YOUR_TABLE_NAME
FOR ALL -- Valida per SELECT, INSERT, UPDATE, DELETE
TO authenticated -- Si applica solo agli utenti autenticati
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id); 
```

Con questa policy in vigore, il database mostra in modo sicuro le righe della tabella solo ai rispettivi proprietari.
