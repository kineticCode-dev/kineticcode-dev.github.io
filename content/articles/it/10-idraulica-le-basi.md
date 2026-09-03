---
title: "Idraulica per chi viene dalla pneumatica: stessa logica, forze molto più grandi"
description: "Le basi dell'idraulica industriale — pompe, motori idraulici, valvole — e quando conviene davvero rispetto alla pneumatica."
date: "2026-09-01"
category: "automazione"
tags: ["Hydraulics", "Pneumatics", "Automation", "Fundamentals"]
---

Dopo tre articoli dedicati alla pneumatica, l'idraulica potrebbe sembrarti a prima vista un capitolo ridondante: pompe, valvole, cilindri — gli stessi nomi, gli stessi concetti, quasi lo stesso vocabolario. Ed è vero: l'architettura concettuale è sorprendentemente simile. Ma la scelta tra i due mondi non è mai casuale, e capire perché un progettista sceglie l'idraulica al posto della pneumatica — o viceversa — ti dà uno strumento diagnostico in più quando ti trovi davanti a una macchina che non hai mai visto prima: guardando quale delle due tecnologie è stata usata, capisci immediatamente qualcosa sui requisiti di forza e precisione che quella parte della macchina doveva soddisfare.

## La differenza di fondo: un fluido che si comprime, uno che non si comprime

La differenza fisica di partenza è semplice da enunciare ma ha conseguenze profonde su tutto il resto: l'aria è un gas, **comprimibile**; l'olio idraulico è un liquido, praticamente **incomprimibile** in condizioni operative normali. Questa singola proprietà spiega quasi tutte le differenze pratiche tra i due sistemi.

Un sistema pneumatico, proprio perché l'aria si comprime, ha un comportamento leggermente "elastico": quando applichi un carico a un cilindro pneumatico fermo, la posizione dello stelo può cedere di una piccola quantità mentre l'aria nella camera si comprime ulteriormente per bilanciare il nuovo carico — un cilindro pneumatico non è mai perfettamente "rigido" sotto carico variabile. Un sistema idraulico, al contrario, essendo l'olio incomprimibile, ha un comportamento quasi perfettamente rigido: applica un carico a un cilindro idraulico fermo (con le valvole chiuse) e la posizione non cede praticamente per nulla, perché non c'è alcun volume di fluido che possa comprimersi per assorbire la variazione. È per questo che, ovunque serva un posizionamento fermo e rigido sotto carichi pesanti e variabili — pensa agli stampi di una pressa a iniezione — l'idraulica è quasi sempre la scelta obbligata.

![Comparison chart between pneumatics and hydraulics: working pressure, fluid type, force scale and typical applications](./img/pneumatics-vs-hydraulics.svg)

## Le pressioni in gioco: un ordine di grandezza diverso

Ricordi la pressione di esercizio tipica della pneumatica, attorno ai 6-7 bar? Un sistema idraulico industriale lavora tipicamente tra i **100 e i 350 bar**, in alcune applicazioni ancora di più. Applicando la stessa formula F = P × A vista parlando dei cilindri pneumatici, capisci immediatamente perché: a parità di area del pistone (quindi a parità di ingombro del cilindro), lavorare a una pressione 20-50 volte superiore genera una forza 20-50 volte superiore. È il motivo per cui un cilindro idraulico relativamente compatto può generare forze dell'ordine delle tonnellate, dove un cilindro pneumatico di dimensioni paragonabili si fermerebbe a poche centinaia di newton.

## La pompa idraulica: il cuore del sistema, sempre acceso

Dove un sistema pneumatico attinge da una rete centralizzata di aria compressa condivisa da tutto lo stabilimento, un sistema idraulico è quasi sempre **autonomo e locale a ogni singola macchina**: una centralina idraulica dedicata (*power pack*), composta da un serbatoio d'olio, una pompa azionata da un motore elettrico, e un blocco di valvole di controllo, tutto montato direttamente sulla macchina o accanto ad essa. La pompa più diffusa nell'industria è la **pompa a ingranaggi** (economica, robusta, adatta a pressioni medie) o, per applicazioni di maggiore precisione e pressioni più elevate, la **pompa a pistoni assiali**, capace di erogare portate variabili regolando l'inclinazione di un piatto oscillante interno — un dettaglio meccanico elegante che permette di modulare la portata d'olio, e quindi la velocità del movimento, senza dover strozzare il flusso con una valvola (soluzione che sprecherebbe energia sotto forma di calore).

Un dettaglio operativo da non sottovalutare mai in fase di collaudo: a differenza della pneumatica, dove l'aria in eccesso viene semplicemente scaricata in atmosfera (da qui il caratteristico sibilo), un sistema idraulico è un **circuito chiuso**: l'olio, dopo aver mosso l'attuatore, deve tornare al serbatoio attraverso una linea di ritorno dedicata. Questo significa che ogni valvola idraulica, a differenza di quella pneumatica, ha sempre bisogno di un percorso di ritorno esplicito verso il serbatoio, e una perdita d'olio non è solo uno spreco (come lo sarebbe una piccola perdita d'aria) ma una contaminazione ambientale concreta da gestire con attenzione — uno dei motivi per cui la manutenzione predittiva sui sistemi idraulici (controllo periodico di guarnizioni, filtri, livello e qualità dell'olio) è molto più rigorosa che nella pneumatica.

## Il motore idraulico: quando serve rotazione continua ad alta forza

Oltre ai cilindri lineari — concettualmente identici a quelli pneumatici visti nell'articolo precedente, solo dimensionati per pressioni molto più alte e con guarnizioni più robuste — l'idraulica offre anche i **motori idraulici**, l'equivalente rotativo del cilindro: invece di generare una corsa lineare, l'olio in pressione fa ruotare continuamente un albero, generando una coppia molto elevata anche a basso numero di giri — una caratteristica preziosa in applicazioni come gli argani di sollevamento o gli azionamenti di grandi ruote dentate, dove un motore elettrico equivalente richiederebbe una riduzione meccanica molto più ingombrante per ottenere la stessa coppia a bassa velocità.

## Come si comanda dal PLC: la stessa logica, valvole diverse

La buona notizia, per te che devi programmare il software di controllo, è che dal punto di vista logico il comando di un sistema idraulico dal PLC segue esattamente lo stesso schema concettuale della pneumatica: elettrovalvole (qui chiamate più spesso **valvole direzionali idrauliche**, ma con la stessa simbologia ISO 1219 e la stessa nomenclatura a vie/posizioni che hai già imparato) pilotate da uscite digitali del PLC, che indirizzano il flusso di fluido verso l'una o l'altra camera dell'attuatore. La differenza principale che incontrerai nella pratica è che le applicazioni idrauliche di fascia alta usano spesso **valvole proporzionali**, comandate non da un semplice segnale on/off ma da un segnale analogico (tipicamente 0-10V o 4-20mA, gli stessi standard visti parlando di sensori analogici), che permette di modulare con continuità l'apertura della valvola e quindi la velocità e la forza dell'attuatore — un livello di controllo fine che nella pneumatica, dato il costo contenuto dei componenti, si trova più raramente.

## Quando scegliere l'una, quando l'altra

Una regola pratica, semplificata ma utile sul campo: se serve velocità, ciclo rapido, forza contenuta, pulizia (nessuna perdita di olio possibile in ambiente alimentare o farmaceutico) — pneumatica. Se serve forza molto elevata, rigidità sotto carico, controllo fine e continuo della velocità anche sotto carichi pesanti — idraulica. Non è raro, anzi è la norma, trovare entrambe le tecnologie sulla stessa macchina: pneumatica per le funzioni ausiliarie veloci e leggere (pinze, espulsori), idraulica per l'organo principale che deve generare la forza di lavoro vera e propria — pensa a una pressa, dove lo stampo è mosso da un grande cilindro idraulico, ma l'espulsione del pezzo finito è affidata a un piccolo cilindro pneumatico.

Nel prossimo articolo lasciamo la potenza e la forza per un argomento altrettanto critico ma di natura diversa: la sicurezza funzionale, e il modo specifico — molto diverso da come pensi normalmente al software — in cui l'industria la progetta.
