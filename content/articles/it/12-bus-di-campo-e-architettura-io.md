---
title: "Bus di campo: perché nessuno cablea più ogni sensore fino al quadro centrale"
description: "Come e perché l'I/O di una macchina moderna è decentralizzato tramite bus di campo come Profinet ed EtherCAT, invece di essere cablato punto-punto fino al PLC."
date: "2026-09-01"
category: "automazione"
tags: ["Fieldbus", "Profinet", "EtherCAT", "Automation"]
---

Immagina una macchina di medie dimensioni con duecento sensori e attuatori sparsi su una struttura di dieci metri. Se ogni singolo segnale dovesse essere cablato individualmente fino al PLC nel quadro centrale — un filo dedicato per ogni sensore, andata e ritorno — parliamo di centinaia di cavi, alcuni lunghi anche dieci o quindici metri, ognuno con il proprio percorso in canalina, il proprio numero identificativo, il proprio morsetto dedicato. È un'architettura che, fino a qualche decennio fa, era semplicemente la norma — e che oggi, se la incontri ancora, riconosci immediatamente come "vecchio stile". La soluzione moderna, quasi universale, è il **bus di campo**.

![Comparison between centralized home-run wiring, with one dedicated cable per sensor back to the PLC, and distributed fieldbus wiring through local remote I/O blocks](./img/centralized-vs-distributed-io.svg)

## L'idea di fondo: un cavo solo, tanti dispositivi

Un bus di campo è, concettualmente, una rete di comunicazione digitale dedicata all'automazione industriale: invece di collegare ogni sensore e ogni attuatore con un cavo dedicato fino al PLC, si collegano gruppi di dispositivi vicini fisicamente a un modulo di **I/O remoto** (o *I/O decentrato*), posizionato direttamente sulla macchina, vicino ai dispositivi che serve. Questo modulo remoto comunica poi con il PLC centrale attraverso un **unico cavo bus**, su cui viaggiano digitalmente, in rapida sequenza, tutti gli stati di tutti i sensori e tutti i comandi per tutti gli attuatori collegati a quel modulo.

Il risparmio di cablaggio è enorme, ma non è l'unico vantaggio. Un modulo di I/O remoto tipicamente offre anche funzioni diagnostiche molto più ricche di un semplice contatto cablato: puoi sapere non solo se un sensore è attivo o meno, ma anche se il suo cavo si è interrotto, se sta assorbendo una corrente anomala, se un canale di uscita è in corto circuito — informazioni che, con il cablaggio tradizionale punto-punto, richiederebbero circuiti diagnostici dedicati e costosi per ogni singolo segnale, mentre su un bus di campo arrivano "gratis", incluse nel protocollo di comunicazione stesso.

## I protocolli che incontrerai di più: Profinet ed EtherCAT

Il mondo dei bus di campo ha avuto, storicamente, una frammentazione notevole (Profibus, DeviceNet, CANopen, e molti altri, ognuno con i propri sostenitori industriali), ma negli ultimi anni si è consolidato pesantemente attorno a soluzioni basate su **Ethernet industriale**, che sfruttano lo stesso hardware fisico della rete Ethernet che conosci già dal mondo IT, con protocolli e temporizzazioni specifiche per garantire il determinismo richiesto dal controllo di macchina in tempo reale (una proprietà che l'Ethernet "da ufficio" standard non garantisce di per sé).

**Profinet**, sviluppato dal consorzio legato a Siemens, è probabilmente il più diffuso in Europa in ambito industriale generale: usa pacchetti Ethernet standard con estensioni per garantire tempi di ciclo prevedibili, ed è relativamente semplice da configurare e diagnosticare, anche con strumenti di rete generici.

**EtherCAT**, sviluppato da Beckhoff, adotta un approccio tecnicamente più raffinato: invece che ogni dispositivo riceva e risponda a un pacchetto Ethernet separato (con l'inevitabile overhead di elaborazione per ognuno), un unico pacchetto Ethernet attraversa in sequenza tutti i dispositivi collegati sul bus, e ognuno "legge al volo" i dati che gli competono e "scrive al volo" i propri dati nello stesso pacchetto, mentre questo lo attraversa fisicamente al volo, quasi senza ritardo introdotto — un meccanismo che gli permette di raggiungere tempi di ciclo estremamente bassi (frazioni di millisecondo per centinaia di dispositivi), motivo per cui lo trovi spesso nelle applicazioni di motion control più esigenti, dove serve sincronizzare più assi servo con una precisione temporale molto stretta.

Non serve, per il tuo lavoro quotidiano, conoscere i dettagli implementativi profondi di questi protocolli — quello è terreno degli sviluppatori dei moduli hardware stessi. Quello che ti serve è riconoscerli quando li vedi in uno schema o in una configurazione hardware del PLC, e sapere che dietro la sigla c'è esattamente il meccanismo che abbiamo appena descritto: un cavo, tanti dispositivi, comunicazione digitale ciclica e deterministica.

## Cosa cambia, concretamente, nel tuo lavoro di programmazione

Dal punto di vista del tuo codice applicativo, la buona notizia è che l'astrazione resta quasi identica a prima: nel software di configurazione del PLC (il *tool di ingegneria*, che sia TIA Portal, CODESYS, o altri), configuri i moduli remoti collegati sul bus esattamente come configureresti dei moduli I/O locali nel telaio del PLC, e nel tuo programma continui a leggere e scrivere variabili booleane o analogiche con gli stessi identici meccanismi — l'astrazione del bus è, quasi sempre, completamente trasparente alla logica applicativa. Quello che cambia, e che vale la pena sapere per il collaudo sul campo, è la **diagnostica di rete**: se un modulo remoto perde comunicazione (un cavo bus danneggiato, un'interferenza elettromagnetica, un'alimentazione del modulo remoto mancante), tutti i segnali che passano da quel modulo diventano contemporaneamente indisponibili, e il PLC segnala tipicamente un errore di comunicazione specifico e distinto da un semplice sensore guasto — un errore che, la prima volta che lo vedi, capirai immediatamente essere di natura completamente diversa da un problema di logica applicativa, proprio perché ora sai cosa c'è fisicamente dietro quella comunicazione.

## Un'ultima osservazione: anche la sicurezza ha il suo bus

Vale la pena chiudere questo articolo collegandolo a quello precedente sulla sicurezza funzionale: anche i circuiti di sicurezza, che un tempo erano quasi sempre cablati in modo tradizionale con relè dedicati, oggi sempre più spesso viaggiano su varianti *safety* degli stessi bus di campo (**Profisafe** su Profinet, **FSoE** — *Fail Safe over EtherCAT* — su EtherCAT), che aggiungono al protocollo standard meccanismi di controllo aggiuntivi (codici di ridondanza, numeri di sequenza, timeout stretti) capaci di garantire che un guasto di comunicazione sul bus non passi mai inosservato, mantenendo così, anche in un'architettura di rete condivisa, la stessa garanzia di sicurezza intrinseca del cablaggio dedicato che avevi visto nell'articolo precedente — un bell'esempio di come un principio ingegneristico solido (la ridondanza e l'autodiagnosi) si adatti a tecnologie diverse senza perdere la propria sostanza.

Arriviamo così all'ultimo articolo della serie: mettiamo insieme tutto quello che abbiamo visto — meccanica, quadro elettrico, sensori, motori, pneumatica, idraulica, sicurezza, bus di campo — dissezionando insieme una macchina reale, dall'inizio alla fine.
