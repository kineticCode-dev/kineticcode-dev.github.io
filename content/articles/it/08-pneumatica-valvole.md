---
title: "Pneumatica, seconda puntata: le elettrovalvole, dove un bit del PLC diventa aria in movimento"
description: "Come funzionano le elettrovalvole pneumatiche 3/2 e 5/2, la simbologia ISO 1219, e come il PLC comanda davvero un cilindro."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Valves", "PLC", "Automation"]
---

Nell'articolo precedente abbiamo seguito l'aria compressa dal compressore fino alla soglia della macchina, pulita, secca e a pressione regolata. Ora arriviamo al componente che collega davvero il tuo software al mondo fisico della pneumatica: l'**elettrovalvola** (*solenoid valve*). È l'equivalente pneumatico esatto del contattore che hai incontrato parlando di quadro elettrico: un'uscita PLC a bassa potenza (24VDC) comanda una bobina, che a sua volta agisce su un meccanismo capace di gestire una portata d'aria ben più grande di quanto un segnale elettrico da solo potrebbe mai fare.

## Come funziona, dentro: uno spillo che si sposta

Semplificando, dentro un'elettrovalvola c'è un piccolo elemento mobile — uno spillo o un pistoncino, chiamato *cursore* o *spool* — che, spostandosi di pochi millimetri all'interno del corpo valvola, apre o chiude diversi canali interni, collegando o scollegando le vie d'aria. Quando la bobina elettrica viene eccitata, genera un campo magnetico che attira un nucleo metallico collegato al cursore, spostandolo dalla posizione di riposo a quella di lavoro. Quando la bobina si diseccita, un elemento di richiamo — quasi sempre una molla meccanica, o in alcuni casi la pressione dell'aria stessa opportunamente indirizzata (le cosiddette valvole a comando pneumatico, o *pilotate*) — riporta il cursore alla posizione di riposo.

Questo comportamento — riposo/lavoro — è esattamente ciò che descrive la nomenclatura standard delle valvole, che ora possiamo decodificare: quando leggi **"valvola 3/2"** o **"valvola 5/2"**, il primo numero indica quante **vie** (porte fisiche di collegamento: alimentazione, utilizzo, scarico) ha la valvola, il secondo numero indica quante **posizioni** può assumere il cursore.

## La valvola 3/2: la scelta per i cilindri a semplice effetto

Una **valvola 3/2** ha tre vie — tipicamente indicate con le lettere **P** (alimentazione, *pressure*), **A** (utilizzo, verso l'attuatore) e **R** (scarico, *release*, verso l'atmosfera) — e due posizioni. Nella posizione di riposo collega A a R (l'utilizzo è scaricato, senza pressione); quando la bobina è eccitata, collega P ad A (l'utilizzo riceve aria in pressione), chiudendo contemporaneamente R.

Questa configurazione è perfetta per pilotare un **cilindro a semplice effetto**: un cilindro che ha l'aria compressa da un solo lato, e torna nella posizione di riposo tramite una molla meccanica interna quando l'aria viene tolta. Il PLC deve gestire un solo bit: eccitare la bobina per far avanzare il cilindro, diseccitarla per farlo tornare (per gravità o per la molla di richiamo).

![Comparison between a 3/2-way valve for single-acting cylinders and a 5/2-way valve for double-acting cylinders, with ISO 1219 style symbols](./img/valve-symbols-3-2-5-2.svg)

## La valvola 5/2: la scelta più comune, per i cilindri a doppio effetto

Molto più diffusa nell'industria è la **valvola 5/2**: cinque vie (una alimentazione P, due utilizzi A e B, due scarichi distinti, spesso indicati come R e S) e due posizioni. In una posizione, collega P ad A e B allo scarico; nell'altra posizione (invertita), collega P a B e A allo scarico. Il risultato pratico: hai sempre due linee di lavoro, una che spinge il cilindro in un senso e una che lo spinge nel senso opposto, **entrambe attivamente pressurizzate a turno** — mai una spinta dalla molla, sempre dall'aria.

Questa è la configurazione tipica per i **cilindri a doppio effetto**, dove l'aria compressa spinge il pistone in entrambe le direzioni (una camera per l'estensione, una per la retrazione), senza bisogno di alcuna molla meccanica interna. Il vantaggio pratico è duplice: la corsa di ritorno è attivamente controllata quanto quella di andata (utile se serve una forza anche nel movimento di rientro, non solo di uscita), e il cilindro può essere posizionato in qualsiasi orientamento — orizzontale, verticale, capovolto — senza dipendere dalla gravità o da una molla per completare la corsa di ritorno.

Dal punto di vista del cablaggio verso il PLC, una valvola 5/2 con **bobina singola** (in cui una molla meccanica riporta il cursore in posizione di riposo quando la bobina si diseccita) si comanda esattamente come una 3/2: un solo bit d'uscita, un solo stato "vero" per l'estensione e "falso" per il riposo. Ma esiste anche una variante molto diffusa, la **5/2 a doppia bobina** (*bistabile*): non ha alcuna molla di richiamo, e il cursore mantiene la sua posizione anche quando entrambe le bobine sono diseccitate — è un dettaglio con un impatto pratico enorme, di cui parliamo tra un momento.

## Monostabile vs bistabile: una scelta con conseguenze reali sulla sicurezza

Se una valvola è **monostabile** (con una sola bobina e un ritorno a molla), ha uno stato di riposo ben definito: appena togli tensione — anche per un guasto, un'emergenza, o semplicemente perché il PLC va in stop — il cursore torna sempre nella stessa posizione predefinita, e con essa il cilindro va in una posizione nota e prevedibile. Questo comportamento è spesso, deliberatamente, sfruttato per la sicurezza: se il cilindro di una pinza deve *sempre* aprirsi in caso di emergenza per liberare un operatore, si sceglie una valvola monostabile con la molla che riporta la valvola nello stato "pinza aperta" per costruzione, indipendentemente dal software.

Una valvola **bistabile**, invece, mantiene l'ultima posizione comandata anche in assenza di alimentazione — proprietà preziosa quando serve che un attuatore "resti dov'era" durante un'interruzione (ad esempio, un attuatore che tiene bloccato un pezzo pesante non deve rilasciarlo di colpo solo perché è saltata la corrente), ma che richiede al software un ragionamento più attento sullo stato reale della macchina al riavvio: il PLC, dopo un blackout, non può assumere automaticamente in che posizione si trova un attuatore bistabile — deve verificarlo con i sensori di fine corsa (ne parliamo nel prossimo articolo), non con la memoria del proprio ultimo comando, che nel frattempo potrebbe essere del tutto obsoleta.

## Le isole di valvole: dove trovi decine di elettrovalvole raggruppate

Nella pratica industriale reale, raramente troverai una singola elettrovalvola isolata: quasi sempre sono raggruppate in una **isola di valvole** (*valve island* o *valve manifold*), un blocco compatto che condivide un'unica alimentazione d'aria comune (spesso proprio a valle del gruppo FRL visto nell'articolo precedente) e, sempre più spesso nelle macchine moderne, un'unica connessione elettrica al PLC tramite un modulo di bus di campo integrato direttamente sull'isola stessa — invece di cablare individualmente ogni singola bobina fino al quadro con un cavo dedicato. È un'anticipazione di un argomento che tratteremo con più calma parlando di bus di campo: risparmiare decine o centinaia di metri di cavo, sostituendoli con un unico cavo bus, è uno dei motori principali dietro la decentralizzazione dell'I/O nelle macchine moderne.

Nel prossimo articolo chiudiamo il cerchio della pneumatica arrivando finalmente al componente che l'aria mette davvero in movimento: i cilindri, a semplice e doppio effetto, come si dimensionano e come si legge un datasheet reale.
