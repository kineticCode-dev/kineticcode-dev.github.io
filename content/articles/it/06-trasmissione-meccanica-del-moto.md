---
title: "Cinghie, catene e viti a ricircolo di sfere: come il moto di un motore arriva davvero dove serve"
description: "Il minimo di meccanica di trasmissione che serve a un ingegnere di controllo per capire perché una macchina è costruita in un certo modo."
date: "2026-09-01"
category: "automazione"
tags: ["Mechanics", "Machine Design", "Automation", "Fundamentals"]
---

Un motore, da solo, sa fare una cosa sola: far ruotare il proprio albero. Tutto il resto — spostare una slitta in linea retta, sollevare un peso, sincronizzare due assi che devono muoversi in proporzione fissa tra loro — è compito degli **organi di trasmissione**: i componenti meccanici che prendono quella rotazione e la trasformano in qualcos'altro. Non è un capitolo di meccanica applicata in senso accademico: è, molto più pragmaticamente, il motivo per cui una macchina è costruita in un certo modo, e conoscerlo ti aiuta a capire, guardando una macchina reale, perché quel motore è montato lì e collegato in quel modo a quella slitta.

![Four common ways to transmit motion: belt and pulley, chain and sprocket, ball screw, and linear guide](./img/mechanical-transmission-types.svg)

## Cinghie e pulegge: leggerezza e silenziosità, con un compromesso

La trasmissione a cinghia è probabilmente la più diffusa in assoluto per trasmettere moto tra due assi paralleli a distanza medio-breve: una cinghia (di gomma rinforzata, spesso dentata per evitare slittamenti) avvolge due pulegge, una collegata al motore e una all'organo da muovere. È leggera, economica, silenziosa, e smorza naturalmente le vibrazioni — proprietà preziosa quando la macchina lavora ad alta velocità.

Il compromesso riguarda la precisione: anche una cinghia dentata, per quanto rigida rispetto a una liscia, ha una minima elasticità intrinseca e un gioco nell'ingranamento con i denti della puleggia. Per un nastro trasportatore questo è irrilevante. Per un asse che deve posizionare un utensile con precisione di decimi di millimetro, questa elasticità si traduce in un errore di posizionamento che un encoder sul motore, da solo, non può correggere — perché l'encoder misura quanto ha girato il motore, non quanto si è effettivamente spostato il carico all'altro capo della cinghia. È uno dei motivi per cui, sugli assi di precisione più critici, trovi spesso un secondo encoder montato direttamente sulla parte mobile (una configurazione chiamata *retroazione diretta*, o *feedback lineare*), che chiude l'anello di controllo sulla posizione reale del carico e non su quella presunta del motore.

## Catene e pignoni: quando serve forza senza compromessi

Dove la cinghia cede in favore della robustezza, trovi la catena: anelli metallici articolati che ingranano su ruote dentate (i pignoni). A differenza della cinghia, la catena è praticamente inestensibile e non slitta mai — trasmette il moto con un rapporto di trasmissione fisso ed esatto, punto per punto. È la scelta tipica per i carichi pesanti e per gli ambienti gravosi (sporco, temperature elevate, olio) dove una cinghia in gomma si degraderebbe rapidamente: catene di sollevamento, trasportatori a catena per pallet e prodotti pesanti, trasmissioni di potenza su presse e linee industriali robuste.

Il prezzo di questa robustezza è la manutenzione: una catena ha bisogno di lubrificazione periodica e, nel tempo, si allunga leggermente per l'usura delle articolazioni (fenomeno chiamato *allungamento per usura*), richiedendo tensionamento periodico — un'operazione che, se vista sul campo durante un fermo macchina programmato, ora sai esattamente perché viene fatta.

## La vite a ricircolo di sfere: il modo elegante di trasformare rotazione in traslazione precisa

Quando serve trasformare un moto rotatorio in un moto lineare — non semplicemente trasportare qualcosa in cerchio, ma spostare una slitta avanti e indietro lungo un asse — l'organo più diffuso nelle applicazioni di precisione è la **vite a ricircolo di sfere** (*ball screw*). Il principio è, in apparenza, quello di una comunissima vite: una madrevite che avanza lungo un albero filettato quando questo ruota. La differenza sostanziale, che giustifica il nome, è che tra la madrevite e la filettatura dell'albero non c'è contatto diretto strisciante, ma una serie di sfere metalliche che rotolano nel canale della filettatura e vengono continuamente ricircolate attraverso un canale di ritorno interno alla madrevite.

Perché è importante questo dettaglio? Perché in una vite tradizionale il contatto è di **strisciamento** (attrito radente), con perdite per attrito significative e usura nel tempo; nella vite a ricircolo di sfere il contatto è di **rotolamento** (attrito volvente), enormemente più efficiente — rendimenti anche superiori al 90%, contro il 20-40% di una vite tradizionale — e con un gioco meccanico minimo e costante nel tempo. È per questo che praticamente ogni asse di precisione lineare in una macchina utensile, in un sistema di dosaggio, in una macchina di confezionamento di fascia alta, usa una vite a ricircolo di sfere abbinata a un servomotore: il connubio dei due componenti — motore ad anello chiuso più trasmissione a bassissimo gioco — è ciò che rende possibile posizionare un carico con ripetibilità di pochi micrometri.

Un parametro chiave che troverai nel datasheet di una vite a ricircolo di sfere è il **passo** (in millimetri per giro): definisce di quanto avanza linearmente la madrevite per ogni giro completo dell'albero. Con un motore che sai esattamente quanto ha ruotato (grazie all'encoder), e un passo noto, il calcolo della posizione lineare della slitta diventa una semplice proporzione — la formula che, con ogni probabilità, trovi già incapsulata dentro le funzioni di *scaling* dell'asse nel tuo software di motion control.

## Le guide lineari: il compito silenzioso di tenere tutto allineato

Un ultimo componente, spesso trascurato perché non "genera" moto ma lo **accompagna**, sono le guide lineari: coppie di pattini che scorrono su rotaie, sostenendo il carico e vincolandolo a muoversi esattamente lungo la direzione voluta, senza deviazioni laterali o verticali. Anche qui, la soluzione più diffusa nelle applicazioni di precisione usa il rotolamento su sfere o rulli racchiusi nel pattino, per lo stesso motivo della vite a ricircolo di sfere: minimo attrito, minima usura, massima ripetibilità.

Perché è importante saperlo, anche se non è "elettrico" e apparentemente lontano dal tuo lavoro? Perché un asse servo che vibra, che non raggiunge la posizione richiesta con la precisione attesa, o che assorbe una corrente anomala durante il movimento, a volte non ha nulla di sbagliato nel software di controllo o nella taratura del regolatore: il problema è una guida lineare sporca, disallineata o danneggiata, che introduce attrito extra o un vincolo meccanico che il motore deve vincere in più. Sapere che quella componente esiste, e cosa fa, ti dà una diagnosi in più da considerare prima di passare ore a rivedere parametri PID che, in realtà, erano già corretti.

Nel prossimo articolo entriamo in un mondo completamente diverso, che probabilmente conosci ancora meno di quello meccanico: la pneumatica, a partire da come si genera e si tratta l'aria compressa che alimenta ogni cilindro della macchina.
