---
title: "Pneumatica, prima puntata: da dove viene davvero l'aria compressa che muove una macchina"
description: "Come si produce e si tratta l'aria compressa in uno stabilimento industriale: compressori, serbatoi, essiccatori e gruppi FRL, spiegati senza equazioni differenziali."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Automation", "Fundamentals"]
---

Da qui iniziamo un piccolo blocco di tre articoli dedicato alla pneumatica, e se vieni da un percorso di studi puramente informatico o elettronico, è probabile che questo sia il territorio più nuovo di tutta la serie. Eppure, appena entri in un reparto produttivo, il suono che senti di sottofondo — quel sibilo intermittente, quel "sssh-clack" ritmico — è quasi sempre pneumatica al lavoro. Prima di arrivare alle valvole e ai cilindri (li vedremo nei prossimi due articoli), dobbiamo però rispondere a una domanda a monte: da dove arriva, fisicamente, l'aria compressa che alimenta tutto questo?

## Il compressore: il cuore dell'impianto pneumatico

Ogni sistema pneumatico industriale parte da un **compressore**, quasi sempre uno solo per l'intero stabilimento, che alimenta una rete di tubazioni distribuita a tutte le macchine collegate — un po' come l'impianto elettrico distribuisce energia a tutte le prese di una casa, partendo da un unico contatore. Il tipo più diffuso nell'industria è il **compressore a vite rotativa** (*rotary screw compressor*): due rotori elicoidali ingranati tra loro che, ruotando, intrappolano progressivamente l'aria in volumi sempre più piccoli, comprimendola in modo continuo — a differenza del compressore a pistoni, più economico ma tipicamente riservato a impianti piccoli o portatili, che comprime l'aria a colpi discontinui, con maggiore rumorosità e vibrazione.

Il compressore viene tipicamente regolato per mantenere la rete a una **pressione di esercizio** standard — molto spesso attorno ai **6-7 bar** — un valore che vale la pena memorizzare perché lo ritroverai costantemente nei datasheet dei componenti pneumatici come pressione nominale di riferimento. Da notare: il "bar" a cui ci riferiamo qui è quasi sempre la pressione **relativa** (misurata rispetto alla pressione atmosferica, non a quella assoluta) — un dettaglio che nei calcoli di dimensionamento fa una differenza concreta, ma che nella pratica quotidiana di collaudo raramente ti creerà problemi, perché tutti gli strumenti industriali (manometri, sensori di pressione) sono tarati per leggere direttamente il valore relativo.

## Il serbatoio di accumulo: un ammortizzatore, non solo un contenitore

Subito dopo il compressore trovi quasi sempre un grande serbatoio metallico cilindrico, il **serbatoio di accumulo** (*receiver tank*). La sua funzione non è banale come "contenere aria": serve a **disaccoppiare** la produzione continua (o quasi) del compressore dai picchi di consumo istantanei della fabbrica. Immagina una decina di macchine che, nello stesso istante, azionano tutte insieme diversi cilindri pneumatici: la richiesta di portata d'aria in quell'istante può superare di molto quello che il compressore riesce a produrre in tempo reale. Il serbatoio, avendo accumulato una riserva durante i momenti di minor consumo, ammortizza questi picchi, mantenendo la pressione di rete stabile. Ha anche un secondo ruolo, meno ovvio: agendo da grande volume di espansione, permette all'aria di raffreddarsi e a parte dell'umidità e dell'olio residuo del compressore di condensare e depositarsi sul fondo, dove viene periodicamente scaricata da una valvola di spurgo (oggi spesso automatica, temporizzata o a livello).

## L'essiccatore: il nemico invisibile è l'umidità

L'aria atmosferica, quella che il compressore aspira per comprimerla, contiene sempre una certa quantità di vapore acqueo. Quando questa aria viene compressa e poi, lungo la rete, si raffredda, quel vapore condensa in acqua liquida — esattamente come l'appannamento su un bicchiere freddo in una giornata umida. Questa acqua, viaggiando dentro le tubazioni pneumatiche fino alle valvole e ai cilindri, è un problema serio: corrode i componenti interni, dilava il lubrificante dalle parti in movimento, e nei climi freddi può persino congelare dentro i tubi. Per questo, in ogni impianto industriale serio, dopo il serbatoio trovi un **essiccatore** (*air dryer*), quasi sempre di tipo **a refrigerazione**: raffredda deliberatamente l'aria fino a pochi gradi sopra lo zero, forzando la condensazione dell'umidità in eccesso (che viene scaricata), per poi lasciarla ritornare a temperatura ambiente, ormai "asciutta" secondo lo standard richiesto dall'impianto.

![The journey of compressed air from the compressor through the receiver tank, dryer and FRL unit to the solenoid valve and cylinder](./img/compressed-air-chain.svg)

## Il gruppo FRL: l'ultimo trattamento, proprio prima di ogni macchina

Se il compressore, il serbatoio e l'essiccatore sono impianti centralizzati che servono l'intero stabilimento, l'ultimo trattamento avviene invece localmente, spesso proprio all'ingresso di ogni singola macchina, o addirittura di ogni singolo gruppo di valvole (*isola di valvole*, ne parliamo nel prossimo articolo): il **gruppo FRL**, acronimo che sta per **Filtro, Regolatore, Lubrificatore** (*Filter, Regulator, Lubricator*), tre componenti quasi sempre assemblati in un unico blocco compatto, riconoscibilissimo a vista in qualunque quadro pneumatico.

**Il filtro** rimuove le particelle solide residue e ulteriori tracce di condensa che potrebbero essere sfuggite ai trattamenti a monte, proteggendo i componenti più delicati (le valvole in particolare, che hanno tolleranze meccaniche molto strette) da usura e blocchi.

**Il regolatore di pressione** è forse il componente più importante da un punto di vista funzionale: permette di impostare, tramite una manopola, la pressione di esercizio esatta per quella specifica macchina o quella specifica applicazione, indipendentemente dalla pressione della rete generale a monte (che può oscillare). È qui che, in fase di collaudo, regoli la pressione operativa dei cilindri: una pressione troppo bassa e l'attuatore non ha abbastanza forza per completare la corsa contro il carico previsto; una pressione troppo alta e rischi di sollecitare eccessivamente la meccanica, oltre a sprecare aria compressa (che, non dimenticarlo mai, ha un costo energetico reale e tutt'altro che trascurabile per l'azienda).

**Il lubrificatore** (oggi sempre più spesso omesso, perché molti componenti pneumatici moderni sono progettati per funzionare con aria secca senza lubrificazione aggiuntiva, i cosiddetti componenti *oil-free*) nebulizza una piccolissima quantità di olio nell'aria in transito, per lubrificare le parti interne in movimento dei cilindri e delle valvole a valle — un dettaglio da verificare sempre sul manuale del costruttore, perché mescolare aria lubrificata e componenti oil-free nello stesso circuito può, in alcuni casi, causare più danni che benefici.

Con questo quadro chiaro — da dove viene l'aria, come viene trattata, e con quale pressione arriva al punto di utilizzo — nel prossimo articolo possiamo finalmente aprire il cuore del controllo pneumatico: le elettrovalvole, il componente che trasforma un bit del tuo PLC in un vero movimento fisico dell'aria.
