---
title: "Costruire un Tracker di Spese Personali da Zero: Architettura e Progettazione del Database (Parte 3)"
description: "Questo articolo ripercorre il processo di progettazione e sviluppo di una web app per il tracciamento delle spese personali. L'obiettivo non è solo creare uno strumento funzionante, ma analizzare ogni decisione ingegneristica e capire il 'perché' dietro le nostre scelte tecnologiche."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Database", "Supabase", "Frotend", "BaaS"]
---

Bentornati! Nella **Parte 2** abbiamo trattato lo sviluppo del frontend usando **Flutter**. Abbiamo impostato il progetto, lo abbiamo collegato al nostro database cloud e abbiamo iniziato a costruire l'interfaccia utente.

[Link al Repository Github](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Mockup della Webapp
La webapp sarà composta da due schermate diverse:
* Una dashboard: dove mostreremo grafici a barre e a torta.
* Una schermata di inserimento: dove potremo aggiungere le spese al nostro database.

Il mockup della dashboard è questo:
![Vista Principale](./img/mainView.png)

Il mockup della vista di inserimento è questo:
![Vista di Inserimento](./img/insertView.png)

## Sviluppo della Vista di Inserimento
In questa sezione svilupperemo la vista di inserimento, che ci permette di aggiungere una spesa al database.
L'utente dovrà inserire:
* L'importo della spesa/entrata. Le spese verranno inserite come importi negativi, mentre le entrate come importi positivi.
* La data in cui la spesa è avvenuta.
* La categoria a cui appartiene.
* Note.

L'interfaccia finale è questa:
![Vista di Inserimento](./img/insert_view.png)

## Sviluppo della Vista Dashboard
Ora svilupperemo la Vista Dashboard, che sarà la schermata riassuntiva delle nostre finanze. L'idea è inserire alcuni grafici per mostrare immediatamente il nostro stato finanziario. Dobbiamo considerare che verrà usata principalmente da mobile, quindi lo schermo sarà piccolo. È molto importante organizzare lo spazio nel modo migliore possibile. Una buona idea potrebbe essere: mostro un solo grafico alla volta, e in qualche modo ho la possibilità di cambiare vista.

Iniziamo installando il pacchetto Flutter che ci permette di disegnare i grafici:

```bash
$ flutter pub add fl_chart
```

Poi importiamo il pacchetto:

```dart 
import 'package:fl_chart/fl_chart.dart';
```

Il primo grafico che svilupperemo sarà quello delle spese del mese corrente. Per farlo useremo un classico grafico a torta.
Quando calcoliamo le spese mensili, abbiamo due approcci possibili:
* Leggo tutte le spese del mese dal database dentro Flutter, e all'interno di Flutter scorro spesa per spesa e calcolo ciò che mi serve, come l'importo finale e l'importo per categoria.
* Aggrego i dati direttamente dentro il database e manipolo una parte di dati già aggregati.

Seguiremo questa seconda strada. Questo ci permette di delegare al database quanto più lavoro pesante e filtraggio possibile, perché un database è uno strumento nato proprio per fare aggregazioni.
Per farlo useremo una Stored Procedure. Una `Stored Procedure`, o `Function`, è un blocco di codice scritto in linguaggio SQL che viene salvato ed eseguito direttamente dentro il database. Possiamo pensarla come una vera e propria funzione software, con argomenti in ingresso e un valore di ritorno, che vive sul server del database. Ogni client che si connette al database ha queste funzioni a disposizione.

Perché è meglio usare una Stored Procedure nel nostro caso? Ecco i motivi:
* **Efficienza di rete:** se un utente ha registrato 200 spese in un mese, una query standard scaricherebbe 200 record JSON attraverso internet. Con la stored procedure, il database calcola le somme internamente e restituisce solo poche righe (una per ogni categoria attiva, ad esempio 5 righe). Meno dati in viaggio significa un'app più veloce.
* **Performance:** il motore SQL di PostgreSQL è altamente ottimizzato per scorrere e aggregare record. Eseguire la somma (`SUM`) e il raggruppamento (`GROUP BY`) nativamente sul server è infinitamente più veloce che fare la stessa operazione scorrendo una lista in Dart sulla CPU di uno smartphone.
* **Superare i limiti delle API client:** le librerie client di Supabase sono ottime per le operazioni CRUD semplici, ma non supportano nativamente la clausola SQL `GROUP BY`. Creare una funzione sul database ci permette di sfruttare tutta la potenza del linguaggio SQL (PL/pgSQL), esponendola a Flutter con una chiamata molto semplice.

Tutto questo vale anche per le spese settimanali, quindi creiamo una stored procedure generica che prende in input:
* anno
* mese/settimana
* granularità (mensile/settimanale)

E restituisce, per quel mese/settimana specifico:
* categoria di spesa
* importo

Per farlo, andiamo su Supabase, nell'SQL editor, e scriviamo questo codice:

```sql
CREATE OR REPLACE FUNCTION get_aggregated_expenses(
    req_year INT,
    req_value INT, -- Mese (1-12) o settimana (1-53)
    time_frame TEXT -- Può essere 'monthly' o 'weekly'
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

Lato client, per conoscere l'elenco delle spese di un mese specifico, dobbiamo semplicemente fare:

```sql
SELECT * FROM get_aggregated_expenses(2026, 7, 'monthly');
```

E per conoscere l'elenco delle spese di una settimana specifica:

```sql
SELECT * FROM get_aggregated_expenses(2026, 28, 'weekly');
```

E il database risponderà con i dati richiesti.

La Dashboard finale è questa:

![Dashboard](./img/dashboard_view.png)

![Dashboard2](./img/dashboard_view2.png)

## Pubblicare la webapp online
Per ospitare la nostra Flutter web app, useremo GitHub Pages come servizio di hosting per siti statici, che è completamente gratuito. Una volta compilata, la nostra webapp non è altro che un insieme di file `HTML, CSS, JavaScript e asset`.

Vediamo i passaggi per farlo. I prerequisiti sono:
* Un account GitHub
* Git installato sul PC
* La build della webapp

### Passo 1: Modificare il `base href` in Flutter
Apriamo il terminale nella root del progetto Flutter, dove si trova il file `pubspec.yaml`, ed eseguiamo il seguente comando nel terminale:
```bash
flutter build web --release --base-href "/<name-of-your-repo>/" --pwa-strategy=none
```

A questo punto la compilazione partirà all'interno della cartella `/build/web`. Quando sarà terminata, troveremo i file `index.html`, `main.dart.js`, `flutter_bootstrap.js` e `flutter_service_worker.js`.

### Passo 2: Creare il Repository su GitHub
1. Andiamo su GitHub e creiamo un nuovo repository.
2. Scegliamo il nome (lo stesso usato nel `--base-href`).
3. Impostiamo il repository come pubblico, il che è necessario per avere GitHub Pages gratuitamente.
4. Lasciamo deselezionate le opzioni "`Add a README`" o "`.gitignore`".

### Passo 3: Il trucco del 404 per le SPA
Per risolvere il problema con i refresh di pagina, applichiamo la seguente soluzione:
1. Navighiamo nella cartella `build/web` sul nostro PC.
2. Duplichiamo il file `index.html` e lo rinominiamo in `404.html`.
In questo modo, se un utente ricarica la pagina su un URL profondo, GitHub non troverà la pagina, caricherà il file `404.html` (identico a `index.html`), e Flutter prenderà il controllo leggendo l'URL e portando l'utente alla schermata corretta.

### Passo 4: Caricare i file
Aggiungiamo l'intera cartella `build/web` al repository GitHub appena creato.

### Passo 5: Abilitare GitHub Pages
1. Andiamo sul nostro repository GitHub.
2. Clicchiamo su **Settings** in alto a destra.
3. Nel menu a sinistra, clicchiamo su **Pages**.
4. Sotto **Build and deployment**, impostiamo la sorgente su **Deploy from a branch**.
5. Sotto **Branch**, selezioniamo `main` e la cartella `/ (root)`, poi clicchiamo su **Save**.
6. GitHub Actions costruirà la pagina. Troveremo l'URL finale in cima alla stessa sezione Pages non appena il processo sarà terminato: ci vogliono un paio di minuti.
