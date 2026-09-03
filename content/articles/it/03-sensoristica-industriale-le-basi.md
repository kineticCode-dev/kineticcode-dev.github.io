---
title: "PNP, NPN, digitale, analogico: il linguaggio con cui i sensori parlano al PLC"
description: "Le basi della sensoristica industriale: uscite PNP e NPN, segnali digitali e analogici (4-20mA, 0-10V), e perché confondere questi concetti è l'errore più comune in cablaggio."
date: "2026-09-01"
category: "automazione"
tags: ["Sensors", "PLC", "Automation", "Fundamentals"]
---

Se c'è un errore che, prima o poi, commette chiunque lavori sul campo — dall'elettricista al neolaureato in meccatronica, passando per te — è collegare un sensore PNP dove serviva un NPN, o viceversa, e passare venti minuti a chiedersi perché il PLC non vede assolutamente nulla mentre il LED del sensore lampeggia allegramente segnalando che sta rilevando qualcosa. Non è un errore stupido: è un errore che nasce da un concetto sottile, spiegato quasi sempre male, che oggi voglio chiarirti una volta per tutte.

## Un sensore non è un interruttore, ma si comporta come uno

Parti da un'immagine semplice: un sensore di prossimità industriale — che sia induttivo, capacitivo o fotoelettrico, lo vedremo nel prossimo articolo — nella sua essenza fa esattamente quello che fa un interruttore a muro: chiude o apre un contatto elettrico in risposta a qualcosa (nel caso dell'interruttore, la tua mano; nel caso del sensore, la presenza di un oggetto). La differenza è che l'interruttore a muro è un pezzo di metallo che chiudi tu meccanicamente, mentre il sensore ha dentro un piccolo circuito elettronico che *simula* la chiusura di un contatto usando un transistor come interruttore elettronico.

Ed è proprio qui che nasce la distinzione PNP/NPN: dipende da **quale lato del circuito il transistor del sensore mette in comunicazione con l'uscita**.

## PNP: il sensore "regala" il positivo

Un sensore **PNP** (si dice anche *sourcing*, "che fornisce corrente") quando è attivo collega la sua uscita al **+24V** dell'alimentazione. In pratica, quando il sensore rileva l'oggetto, sull'uscita trovi 24V rispetto a massa. L'ingresso del PLC, dal canto suo, deve essere configurato (o più spesso, nei PLC moderni, è cablato) per riconoscere come "vero" un livello alto sull'ingresso, con il riferimento a 0V collegato in comune.

## NPN: il sensore "assorbe" verso massa

Un sensore **NPN** (detto anche *sinking*, "che assorbe corrente") fa l'esatto opposto: quando è attivo, collega la sua uscita a **0V** (massa). L'ingresso del PLC in questo caso deve vedere un livello basso come "vero", con il +24V portato in comune sul lato opposto.

![Wiring comparison between a PNP sourcing sensor and an NPN sinking sensor connected to a PLC input](./img/pnp-vs-npn-wiring.svg)

Guarda bene lo schema: la differenza fisica è tutta lì, in quale morsetto del sensore — quello di segnale — viene tirato a +24V oppure a 0V quando il sensore scatta. Se colleghi un sensore PNP a un ingresso PLC cablato per ricevere NPN (cioè con il comune a +24V invece che a 0V), il circuito semplicemente non si chiude mai nella direzione giusta: l'ingresso non vede alcuna variazione di livello utile, e per il PLC il sensore "non è mai attivo", anche se fisicamente sta rilevando perfettamente l'oggetto e il suo LED lo conferma.

**Una regola pratica che ti risparmierà tempo sul campo:** in Europa, per tradizione storica e normativa, la stragrande maggioranza dei sensori industriali e dei PLC è cablata in **PNP**. Se non è specificato altrimenti nella lista I/O o sull'etichetta del sensore, parti dal presupposto che sia PNP — ma verifica sempre, perché nel settore automotive e in molti impianti di derivazione americana o asiatica trovi ancora parecchio NPN, e i due mondi convivono più spesso di quanto ti aspetti, anche nella stessa macchina.

## Digitale vs analogico: una domanda diversa da PNP/NPN

PNP e NPN riguardano *come* un segnale digitale (acceso/spento, presente/assente) viene trasportato elettricamente. Ma non tutti i sensori danno una risposta binaria. Molti — pensa a un sensore di pressione, di temperatura, o un trasduttore di posizione lineare — devono comunicare un **valore continuo**: non "c'è pressione" ma "la pressione è 3.7 bar". Per questo servono i segnali **analogici**, e nel mondo industriale ne trovi essenzialmente due tipi, quasi sempre gli stessi ovunque tu vada:

**Corrente 4-20mA.** Il sensore fa scorrere nel circuito una corrente proporzionale alla grandezza misurata: 4mA corrisponde al valore minimo della scala (esempio: 0 bar), 20mA al valore massimo (esempio: 10 bar). È lo standard più diffuso nell'industria pesante, e la ragione è elegante dal punto di vista ingegneristico: essendo un segnale in corrente e non in tensione, non risente delle cadute di tensione lungo cavi lunghi (un problema serio quando parli di decine o centinaia di metri di cablaggio in uno stabilimento), ed è immune a gran parte dei disturbi elettromagnetici che affliggono invece i segnali in tensione. Nota bene un dettaglio furbo dello standard: il valore minimo non è 0mA ma 4mA. Questo permette al PLC di distinguere un valore realmente a zero (4mA) da un cavo rotto o un sensore scollegato (0mA): un guasto genera un valore fuori scala riconoscibile invece di un errore silenzioso che sembra un dato valido.

**Tensione 0-10V.** Più semplice concettualmente — il sensore genera una tensione proporzionale alla grandezza misurata — ma più sensibile ai disturbi e alle cadute di tensione su cavi lunghi, quindi tipicamente riservata a distanze brevi, dentro o vicino al quadro.

Il modulo di ingresso analogico del PLC, dal canto suo, converte questo segnale continuo in un numero digitale attraverso un convertitore analogico-digitale (ADC), che tipicamente ti restituisce un valore intero su 12 o 16 bit da riscalare nel tuo codice sulla grandezza fisica reale — è lì che nel tuo programma scrivi quelle funzioni di scaling che trasformano `raw_value` in `pressure_bar`, con la formula lineare che lega i due estremi della scala.

## NO e NC: l'altra distinzione che conta

Un'ultima coppia di sigle che troverai ovunque, e che è del tutto indipendente da PNP/NPN: **NO** (*Normally Open*, normalmente aperto) e **NC** (*Normally Closed*, normalmente chiuso). Descrivono lo stato del contatto — o dell'uscita elettronica equivalente — quando il sensore *non* è attivo, cioè a riposo. Un sensore NO non lascia passare segnale finché non rileva l'oggetto; un sensore NC fa l'esatto contrario: lascia passare segnale sempre, tranne quando rileva l'oggetto (o quando si guasta, cosa che lo rende una scelta molto comune nei circuiti di sicurezza — se il cavo si taglia, il circuito si apre e il sistema lo interpreta correttamente come un allarme, invece di un silenzio ambiguo).

Metti insieme tutte queste sigle — PNP/NPN, NO/NC, digitale/analogico — e avrai decodificato la stragrande maggioranza delle diciture che trovi accanto a un sensore in un catalogo o in una lista I/O: `PNP NO digital`, `NPN NC digital`, `4-20mA analog`. Non sono più sigle astratte: sono istruzioni di cablaggio precise, e ora sai esattamente cosa fare quando le leggi.

Nel prossimo articolo entriamo nel merito dei sensori più comuni che incontrerai fisicamente sul campo: induttivi, capacitivi, fotoelettrici ed encoder — come funzionano dentro, e quando un tipo si sceglie al posto di un altro.
