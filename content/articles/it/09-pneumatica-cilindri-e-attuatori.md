---
title: "Pneumatica, terza puntata: cilindri e attuatori, dove l'aria diventa finalmente movimento"
description: "Come funzionano i cilindri pneumatici a semplice e doppio effetto, i sensori magnetici di fine corsa, il dimensionamento base e la lettura di un datasheet reale."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Cylinders", "Sensors", "Automation"]
---

Chiudiamo il blocco dedicato alla pneumatica con il componente più visibile di tutti, quello che chiunque, anche senza alcuna preparazione tecnica, riconoscerebbe a colpo d'occhio su una macchina: il **cilindro pneumatico**. È qui che tutto quello che abbiamo costruito nei due articoli precedenti — l'aria trattata e regolata, l'elettrovalvola che ne indirizza il flusso — si trasforma finalmente in una spinta meccanica reale.

## Anatomia di un cilindro: uno stantuffo dentro un tubo

Un cilindro pneumatico, nella sua forma più comune, è concettualmente semplice: un tubo cilindrico (la *canna*), chiuso alle due estremità da testate, al cui interno scorre un pistone collegato a uno stelo (*rod*) che esce da una delle due testate e si collega meccanicamente al carico da muovere — una pinza, una slitta, un pusher. L'aria compressa, introdotta in una delle due camere separate dal pistone, spinge quest'ultimo, generando forza e movimento.

![Cross-section of a double-acting pneumatic cylinder showing air ports A and B, and magnetic proximity sensors mounted on the tie rods](./img/cylinder-cross-section.svg)

Avevamo già distinto, parlando delle valvole, i cilindri a **semplice effetto** (aria da un lato, ritorno a molla) e a **doppio effetto** (aria attiva su entrambi i lati). Vale la pena aggiungere una considerazione pratica su quando si sceglie l'uno o l'altro: il semplice effetto è più economico e semplice da comandare, ed è la scelta naturale quando serve un ritorno automatico e affidabile "per costruzione" anche in assenza di segnale — pensa a un morsetto di sicurezza che deve tornare aperto appena manca l'aria o la corrente. Il doppio effetto, molto più diffuso in generale, è la scelta quando serve controllo attivo in entrambe le direzioni, forza anche nel movimento di ritorno, o quando la corsa è lunga (la molla di un cilindro a semplice effetto, oltre una certa lunghezza, diventerebbe ingombrante e con una forza di richiamo poco uniforme lungo tutta la corsa).

## I sensori di fine corsa: come il PLC sa se il cilindro è arrivato

Un cilindro pneumatico, da solo, non dice al PLC dove si trova: è un attuatore, non un sensore. Per sapere se un cilindro è completamente esteso o completamente retratto — un'informazione quasi sempre indispensabile prima di far avanzare la sequenza logica della macchina al passo successivo — servono sensori dedicati, e la soluzione standard, elegante e quasi universale nell'industria, sono i **sensori magnetici di prossimità** (spesso chiamati semplicemente *sensori di finecorsa magnetici*, o con il nome commerciale storico *reed switch*, anche se oggi la tecnologia più diffusa è a effetto Hall).

Il trucco costruttivo è questo: il pistone all'interno del cilindro monta un anello magnetico permanente, integrato nella sua struttura. La canna del cilindro, dal canto suo, non è in materiale ferromagnetico ma in una lega (tipicamente alluminio anodizzato) che lascia passare il campo magnetico senza schermarlo. I sensori magnetici, invece di essere montati all'interno del cilindro (cosa che richiederebbe cablaggi interni complessi e poco affidabili), vengono agganciati **esternamente** su apposite guide scanalate lungo la canna, e rilevano il passaggio del campo magnetico del pistone quando questo transita nella loro posizione — senza nessun contatto fisico, nessun foro nella canna, nessun cablaggio interno. È lo stesso identico principio fisico del sensore induttivo che hai già incontrato, applicato in una configurazione specifica.

Il vantaggio pratico enorme di questo sistema è che i sensori sono **posizionabili manualmente**, facendoli scorrere lungo la scanalatura esterna della canna e bloccandoli con una piccola vite quando sono nella posizione desiderata — un'operazione che farai concretamente in fase di collaudo, quando devi regolare con precisione il punto esatto in cui il PLC deve considerare "raggiunta" la posizione estesa o retratta di ogni singolo cilindro della macchina.

## Il dimensionamento: quanta forza genera davvero un cilindro

Non è compito tuo, di solito, dimensionare i cilindri di una macchina — è un lavoro che fa l'ufficio tecnico del costruttore, in fase di progettazione meccanica, ben prima che tu riceva la lista I/O. Ma capire il ragionamento di base ti aiuta enormemente a "sentire" se qualcosa non torna quando, sul campo, un cilindro sembra troppo lento o incapace di completare la sua corsa contro un certo carico.

La forza teorica generata da un cilindro a doppio effetto in fase di **estensione** si calcola con una formula semplicissima, la stessa identica logica della pressione idrostatica che probabilmente hai già visto altrove:

**F = P × A**

dove **F** è la forza (in newton), **P** è la pressione dell'aria (in pascal, o più praticamente convertita da bar), e **A** è l'area della superficie del pistone su cui l'aria spinge (in metri quadrati). Concettualmente, cosa dice questa formula? Che la stessa identica pressione applicata su una superficie più grande genera una forza proporzionalmente maggiore — è il motivo per cui, a parità di pressione di rete disponibile (i famosi 6-7 bar visti nel primo articolo della serie), un cilindro con un diametro maggiore genera una forza maggiore, semplicemente perché offre più superficie all'aria su cui spingere.

Un dettaglio interessante, e spesso fonte di errori di valutazione da parte di chi non ha mai fatto questo conto: in fase di **retrazione**, la forza è leggermente minore a parità di pressione, perché lo stelo che attraversa la testata "ruba" una porzione dell'area utile del pistone su quel lato — l'aria, in quella camera, spinge su un'area a forma di corona circolare, non su un cerchio pieno. Per la maggior parte delle applicazioni la differenza è trascurabile, ma nei catalghi dei costruttori (Festo, SMC, Camozzi sono i nomi che troverai ovunque in Europa) trovi sempre due valori di forza distinti, uno per l'estensione e uno per la retrazione, proprio per questo motivo.

## Un esempio concreto di lettura datasheet

Immagina di dover verificare se un cilindro SMC serie CDQ2, diametro 32mm, alimentato alla pressione di rete standard di 6 bar, ha abbastanza forza per spingere un carico che oppone una resistenza stimata di 350N. Il datasheet ti dà l'area del pistone (per un diametro di 32mm, circa 8 cm², cioè 0.0008 m²). Applicando la formula: F = 600.000 Pa × 0.0008 m² ≈ 480N di forza teorica. Sembra sufficiente rispetto ai 350N richiesti — ma qui entra un'ultima considerazione pratica che ogni collaudatore impara presto sul campo: la forza teorica calcolata così è quella **statica ideale**, senza considerare attriti interni del cilindro, perdite di carico nelle tubazioni, e soprattutto senza alcun margine di sicurezza. La regola empirica diffusa nell'ambiente è di non superare, in condizioni operative reali, circa il 70-80% della forza teorica calcolata — nel nostro esempio, un margine operativo reale attorno ai 340-380N, già abbastanza vicino al limite richiesto da farti quantomeno consigliare, in fase di collaudo, un cilindro di diametro superiore o una pressione di esercizio più alta, prima che il problema si presenti in produzione sotto forma di un ciclo troppo lento o di un cilindro che, con l'usura, smette di completare la corsa.

Con questo si chiude il blocco sulla pneumatica. Nel prossimo articolo vediamo, per contrasto e completezza, la sorella maggiore della pneumatica quando servono forze davvero grandi: l'idraulica.
