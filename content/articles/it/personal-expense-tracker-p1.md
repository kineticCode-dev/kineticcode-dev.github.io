---
title: "Costruire un tracker di spese personali da zero: architettura e progettazione del database (Parte 1)"
description: "Questo articolo ripercorre il processo di progettazione e sviluppo di una web app per il tracciamento delle spese personali. L'obiettivo non è solo creare uno strumento funzionante, ma analizzare ogni scelta ingegneristica e capire il 'perché' dietro le nostre decisioni tecnologiche."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Database", "Supabase", "Frotend", "BaaS"]
---

Questo articolo ripercorre il processo di progettazione e sviluppo di una web app per il tracciamento delle spese personali. L'obiettivo non è solo creare uno strumento funzionante, ma analizzare ogni scelta ingegneristica e capire il "perché" dietro le nostre decisioni tecnologiche.

Questo progetto vuole essere didattico ma pratico, mantenendo un approccio professionale senza scadere nell'over-engineering o perdersi in funzionalità superflue. Cominciamo!

[Link alla repository GitHub](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Indice
1. [Specifiche Tecniche](#technical-specifications)
2. [Architettura del Progetto](#project-architecture)
3. [Modellazione del Database](#database-modeling)
4. [Configurazione del Database Cloud: Supabase](#cloud-database-setup-supabase)

---

## Specifiche Tecniche

L'obiettivo è semplice: costruire un tracker di spese personali. Le idee di base sono:
- Sviluppare un database per memorizzare tutte le spese dell'utente.
- Costruire una web app con un duplice scopo:
  - Aggiungere, rimuovere o modificare le spese nel database.
  - Mostrare una dashboard riepilogativa con vari grafici (spese settimanali, mensili, ecc.).

Il caso d'uso tipico è questo: aprire la web app direttamente dal browser (PC, tablet, smartphone), aggiungere una spesa e visualizzare l'andamento finanziario. Per garantire che sia utilizzabile nell'uso quotidiano, un database basato su cloud è la soluzione preferita, così l'app resta accessibile 24 ore su 24, 7 giorni su 7.

Anche se esistono già tante app per il tracciamento delle spese, il nostro obiettivo è imparare la tecnologia che c'è dietro, mantenendo solo ciò che è essenziale allo scopo del progetto.

## Architettura del Progetto

Il software è strutturato in componenti distinti. Inizialmente avevamo considerato un'architettura standard a 3 livelli:
- **Frontend:** interfaccia grafica accessibile via browser.
- **Backend:** applicazione che gestisce le richieste del frontend e le instrada verso il database.
- **Database:** sorgente dati basata su cloud.

Tuttavia, utilizzando un moderno database cloud Backend-as-a-Service (BaaS), possiamo evitare di sviluppare un'API di backend personalizzata. Per semplicità ed efficienza, svilupperemo solo il frontend in **Flutter**, che comunicherà direttamente con il nostro database cloud.

## Modellazione del Database

In questa fase definiamo la struttura concettuale dei dati, scegliamo il nostro cloud provider e configuriamo le tabelle iniziali e le relative relazioni.

Ci servono due tabelle distinte:
1. **Tabella delle Categorie** (Tag)
2. **Tabella delle Spese**

### 1. Tabella delle Categorie
Questa tabella contiene le diverse tipologie di spesa.

| id    | category_name   |
| :---- | :-------------- |
| **1** | Generi alimentari |
| **2** | Auto e trasporti |
| **3** | Bollette e casa |
| **4** | Svago |

### 2. Tabella delle Spese
Questa tabella registra ogni transazione.

| expense_id | amount | date | category_id | notes |
| :--- | :--- | :--- | :--- | :--- |
| **101** | 45.50 | 2026-07-06 | **1** | Spesa settimanale al Conad |
| **102** | 62.00 | 2026-07-07 | **2** | Benzina |
| **103** | 12.50 | 2026-07-08 | **4** | Cinema con gli amici |
| **104** | 120.00 | 2026-07-08 | **3** | Bolletta della luce |
| **105** | 4.80 | 2026-07-08 | **1** | *vuoto* |

Tra queste due tabelle esiste una **relazione 1:N (uno-a-molti)**: la stessa categoria può essere associata a più righe della tabella delle spese. Ad esempio, la rata mensile del mutuo comparirà $N$ volte nella tabella delle spese, collegata sempre alla stessa categoria.

## Configurazione del Database Cloud: Supabase

Con le tabelle definite, possiamo configurare il nostro database usando **Supabase**, un'alternativa open source a Firebase.

1. Crea un account sulla dashboard di Supabase e avvia un nuovo progetto.
2. Ti verrà chiesto di inserire una password del database (che il frontend userà per comunicare con il DB). Lascia gli altri parametri ai valori predefiniti.
3. Una volta creato il progetto, vai al **Table Editor** per creare le nostre due tabelle. La tabella delle spese avrà una foreign key che punta all'ID della categoria.

### Definizione delle Tabelle in Supabase:
**Tabella delle Categorie (`tag`)**
- `id`: identificatore univoco (Primary Key)
- `name`: nome della categoria (es. mutuo, benzina, spesa)

**Tabella delle Spese (`expenses`)**
- `id`: identificatore univoco (Primary Key)
- `amount`: valore numerico
- `date`: data della transazione
- `id_tag`: Foreign Key collegata alla tabella delle Categorie
- `notes`: testo opzionale

Con il database creato, siamo pronti a connetterci da frontend e iniziare a inserire dati di prova. Puoi trovare i parametri di connessione al database (host, porta, nome del database, utente) nella dashboard di Supabase, nelle impostazioni di connessione (selezionando in particolare il transaction pooler).

---
*Nella Parte 2 vedremo come configurare il nostro frontend Flutter, collegarlo a Supabase e progettare l'interfaccia utente. Restate sintonizzati!*
