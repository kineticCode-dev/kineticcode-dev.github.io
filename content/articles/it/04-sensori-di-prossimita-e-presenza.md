---
title: "Induttivi, capacitivi, fotoelettrici, encoder: quattro modi diversi di far vedere le cose a una macchina"
description: "Come funzionano davvero i sensori di prossimità industriali più comuni, quando si sceglie l'uno o l'altro, e come leggere un datasheet reale."
date: "2026-09-01"
category: "automazione"
tags: ["Sensors", "Encoders", "Automation", "Fundamentals"]
---

Nel software, quando devi sapere se qualcosa "esiste" o "è nella condizione X", scrivi una condizione booleana e il problema è risolto. Nel mondo fisico, sapere se un pezzo metallico è arrivato in una certa posizione, o se un contenitore di plastica trasparente è pieno, o quanti gradi ha ruotato un albero motore, sono tre problemi completamente diversi, che richiedono tre principi fisici diversi per essere risolti in modo affidabile. Questo articolo è la guida ai quattro sensori che risolvono il 90% dei casi che incontrerai: induttivo, capacitivo, fotoelettrico ed encoder.

![Comparison of inductive, capacitive, photoelectric sensors and a rotary encoder](./img/sensor-types-comparison.svg)

## Il sensore induttivo: vede solo i metalli, ma li vede benissimo

Il sensore induttivo è probabilmente il sensore di prossimità più diffuso in assoluto nell'automazione industriale, e la ragione è semplice: la maggior parte delle parti mobili di una macchina — cilindri, slitte, bracci — sono in metallo, e l'induttivo è economico, robusto, senza contatto, e praticamente insensibile a sporco, olio e vibrazioni.

Il principio fisico è elegante. Dentro il sensore c'è una bobina che genera un campo elettromagnetico ad alta frequenza, che esce dalla faccia sensibile del sensore. Quando un oggetto metallico entra in questo campo, al suo interno si generano delle correnti indotte (dette *correnti parassite* o *correnti di Foucault*) che assorbono energia dal campo. Il circuito interno del sensore misura questo assorbimento di energia — in pratica, lo smorzamento dell'oscillazione della bobina — e quando supera una certa soglia, commuta l'uscita. Nota il dettaglio importante: **il sensore induttivo rileva solo materiali conduttivi**, in pratica quasi solo metalli. Plastica, legno, vetro, liquidi: per l'induttivo sono trasparenti, semplicemente non esistono.

Un parametro che troverai sempre nel datasheet è la **distanza nominale di intervento** (`Sn`), tipicamente pochi millimetri per i sensori più compatti (i famosi cilindrici M8, M12, M18, dove il numero indica il diametro filettato in millimetri) fino a qualche centimetro per i modelli più grandi. Trovi anche una distinzione tra montaggio **filo (o embeddable)** e **non filo (non-embeddable)**: i primi possono essere incassati completamente a filo in un supporto metallico senza che questo interferisca con la lettura, i secondi hanno bisogno di uno spazio libero attorno alla faccia sensibile — un dettaglio che sui disegni meccanici del supporto del sensore fa davvero la differenza, e che se ignorato produce sensori che "vedono" il proprio supporto invece del pezzo da rilevare.

## Il sensore capacitivo: vede (quasi) tutto, anche attraverso una parete

Dove l'induttivo si ferma, entra in gioco il capacitivo. Funziona in modo concettualmente simile — genera un campo, questa volta elettrico anziché magnetico, e ne misura la variazione — ma è sensibile alla **costante dielettrica** del materiale che si avvicina, una proprietà che quasi ogni materiale possiede in qualche misura: plastica, vetro, legno, liquidi, persino la mano di una persona. Questo lo rende molto più versatile ma anche più "rumoroso": un capacitivo mal regolato può scattare per l'umidità dell'aria o per lo sporco che si accumula sulla sua faccia sensibile, quindi quasi tutti i modelli industriali hanno un trimmer di sensibilità da regolare in fase di installazione — uno dei pochi sensori che richiede davvero una taratura sul campo, e non solo un posizionamento meccanico.

L'applicazione da manuale è il rilevamento di livello attraverso pareti non metalliche: un sensore capacitivo appoggiato all'esterno di un serbatoio di plastica può rilevare se il liquido all'interno ha raggiunto quel punto, senza bisogno di alcun foro nel serbatoio — una soluzione che, la prima volta che la vedi funzionare, sembra quasi magia.

## Il sensore fotoelettrico: la portata più lunga, il principio più intuitivo

Il fotoelettrico usa un raggio di luce — quasi sempre infrarossa, invisibile all'occhio ma perfettamente funzionante nel principio — e ne misura l'interruzione o il riflesso. Ne esistono tre configurazioni principali, ed è importante distinguerle perché cambiano radicalmente il modo in cui progetti il loro montaggio sulla macchina:

**A sbarramento (through-beam).** Un trasmettitore e un ricevitore separati, montati uno di fronte all'altro: quando qualcosa interrompe il raggio, il ricevitore lo rileva. È la configurazione più affidabile e a lunga portata (anche decine di metri), ma richiede l'allineamento e il cablaggio di due componenti distinti.

**Retroriflettore (retro-reflective).** Trasmettitore e ricevitore nello stesso corpo, con un catadiottro (un riflettore prismatico passivo, economico e senza bisogno di alimentazione) montato dall'altra parte: il raggio va, rimbalza sul riflettore e torna. Un solo componente attivo da cablare, portata intermedia.

**A diffusione (diffuse).** Il sensore stesso emette luce e ne rileva il riflesso diretto sull'oggetto, senza alcun riflettore dedicato. È il più semplice da installare (un solo componente, nessun riflettore) ma il più sensibile al colore e alla finitura superficiale dell'oggetto: una superficie nera opaca riflette molta meno luce di una superficie bianca lucida, e questo può cambiare drasticamente la portata utile — un dettaglio da tenere bene a mente quando la macchina deve gestire prodotti di colori diversi.

## L'encoder: quando non basta sapere "sì o no", ma serve sapere "quanto"

Tutti i sensori visti finora rispondono a una domanda binaria: presente o assente. L'encoder risponde a una domanda completamente diversa: quanto ha ruotato (o traslato) qualcosa, e a volte a quale velocità. È il sensore che troverai sull'albero di un motore, su un asse di posizionamento, su qualunque parte della macchina di cui serva conoscere la posizione esatta e non solo un paio di stati.

Il tipo più comune è l'**encoder incrementale ottico**: un disco forato solidale all'albero rotante passa tra un emettitore e un ricevitore di luce, generando un treno di impulsi ogni volta che un foro passa. Contando gli impulsi, il PLC (o più spesso un modulo di conteggio veloce dedicato, perché la frequenza di questi impulsi può superare abbondantemente la velocità di scansione ciclica normale del PLC) ricostruisce quanto l'albero ha ruotato. Gli encoder incrementali di qualità hanno tipicamente due canali sfasati di 90 gradi (chiamati A e B), che permettono non solo di contare gli impulsi ma anche di determinare la **direzione** di rotazione dalla sequenza con cui i due canali commutano — un dettaglio elegante di ingegneria che vale la pena capire, perché è lo stesso principio usato ovunque serva rilevare un verso di movimento da due segnali digitali sfasati.

L'alternativa è l'**encoder assoluto**, che invece di contare impulsi relativi restituisce direttamente, in ogni istante, la posizione assoluta corrente (tipicamente come valore digitale su un bus di comunicazione), anche subito dopo un'accensione — una proprietà preziosissima per gli assi che non possono permettersi una fase di "azzeramento" a ogni riavvio della macchina, come i grandi assi di posizionamento su una linea di produzione continua.

## Leggere un datasheet reale: cosa cercare per primo

Quando ricevi un componente fisico da collaudare, o devi verificarne uno da sostituire, il datasheet del costruttore (Omron, Sick, Balluff, Pepperl+Fuchs sono nomi che incontrerai spessissimo) ha sempre una struttura simile. I parametri da guardare per primi, in ordine di priorità pratica: la tensione di alimentazione (quasi sempre 10-30VDC, con 24VDC nominale), il tipo di uscita (PNP/NPN, NO/NC — quello che hai imparato nell'articolo precedente), la distanza nominale di intervento e, per l'induttivo e il capacitivo, se è filo o non filo. Se dopo aver letto queste quattro righe sai già rispondere "questo sensore va bene per quella posizione sulla macchina", hai imparato esattamente quello che serve per lavorare sul campo con sicurezza.

Nel prossimo articolo passiamo dal "percepire" al "muovere": motori asincroni, servomotori e inverter, e cosa cambia davvero, dal punto di vista del software di controllo, tra questi tre mondi.
