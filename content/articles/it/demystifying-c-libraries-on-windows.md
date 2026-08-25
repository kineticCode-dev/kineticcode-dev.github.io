---
title: "Fare chiarezza sulle librerie C su Windows: come ispezionare e profilare file .dll sconosciuti"
description: "Una guida pratica per ispezionare e profilare file .dll sconosciuti in ambienti Windows."
date: "2026-07-18"
category: "software"
tags: ["C++", "Windows", "DLL", "Debug"]
---


# Indice
1. [Introduzione: il problema reale](#introduction-the-real-world-problem)
2. [La sfida: informazioni mancanti](#the-challenge-missing-information)
3. [Ispezionare e profilare i binari (.dll e .h)](#inspecting-and-profiling-binaries-dll-and-h)
   1. [Determinare l'architettura della libreria](#determining-the-librarys-architecture)
   2. [Identificare il compilatore utilizzato](#identifying-the-compiler-used)
4. [Riepilogo e regole generali](#summary--general-rules)

---

## Introduzione: il problema reale
L'idea per questo articolo nasce da un problema concreto che ho affrontato di recente. Lavoriamo a stretto contatto con un'azienda partner che ci ha fornito diverse librerie C, che secondo noi potevano tornare utili per l'applicazione a cui stiamo lavorando in questo periodo. Dopo un incontro in cui ci hanno suggerito le librerie più adatte, ci hanno inviato un pacchetto di file `.zip`.

Dentro ogni `.zip` abbiamo trovato:
* File header (`.h`)
* Librerie dinamiche compilate (`.dll`)

## La sfida: informazioni mancanti
Il mio ambiente di sviluppo principale è Windows, e scrivo codice C usando Visual Studio Code. Ho già avuto esperienza nell'importare librerie in Qt e in Visual Studio, ma in quei contesti, insieme ai file `.h` e `.dll`, avevo di solito anche i file di import `.lib`. Qui, invece, mancavano completamente.

C'è poi da considerare una regola d'oro dello sviluppo in C: idealmente si dovrebbe usare per il proprio progetto lo stesso compilatore con cui è stata compilata la libreria fornita.

Tutto questo mi ha lasciato con parecchi dubbi: la libreria che mi hanno dato va bene? Quale compilatore devo usare? E come faccio, in pratica, a importare questa libreria in Visual Studio Code?

Cerchiamo di capirlo insieme, passo dopo passo.

## Ispezionare e profilare i binari (.dll e .h)
La prima cosa da verificare è che la `.dll` sia compilata per la stessa architettura del nostro sistema di sviluppo e del nostro compilatore.

Se proviamo a caricare una `.dll` a 32 bit in un eseguibile a 64 bit, otterremo un errore a livello di sistema operativo (`Bad Image Format, 0xc000007b`). Vale anche il contrario: caricare una `.dll` a 64 bit in un eseguibile a 32 bit produce lo stesso errore `Bad Image Format`.

### Determinare l'architettura della libreria
Per scoprire per quale architettura è stata compilata la libreria, possiamo aprire il **Developer Command Prompt for VS22** su Windows e spostarci nella cartella che contiene la `.dll` con il comando `cd`.

Da lì, eseguiamo questo comando nel terminale:
```cmd
dumpbin /headers your_library_name.dll
```

Cerchiamo la sezione `FILE HEADER VALUES` nell'output. Se troviamo:
* **`14C machine (x86)`**: la libreria è a 32 bit.
* **`8664 machine (x64)`**: la libreria è a 64 bit.

![Architettura](/architecture.png)

*(Nel mio caso, la libreria che stavo cercando di importare si è rivelata a 32 bit.)*

### Identificare il compilatore utilizzato
Per capire con quale compilatore è stata costruita la libreria, possiamo lanciare un altro comando dallo stesso terminale:
```cmd
dumpbin /dependents your_library_name.dll
```

Analizzando la sezione `Image has the following dependencies:`, possiamo dedurre il compilatore usato:

![Compilatore](/compiler.png)

Se vediamo dipendenze come:
* `KERNEL32.dll`
* `msvcrt.dll`
* `libgcc_s_dw2-1.dll`
...allora la libreria è stata molto probabilmente compilata con **MinGW**.

Se invece vediamo dipendenze come:
* `MSVCRXX.dll` (dove XX è un numero di versione)
* `VCRUNTIME140.dll`
* `ucrtbase.dll`
...allora è stata compilata con **Microsoft Visual C++ (MSVC)**.

## Riepilogo e regole generali
Come regola generale quando si ha a che fare con librerie dinamiche su Windows:

* **Se una libreria è stata compilata con MinGW**, di solito bastano due file:
  * Il file header (`.h`)
  * La libreria compilata (`.dll`)
  * *Nota: il linker di MinGW (`ld`) riesce a leggere direttamente i simboli dentro il file `.dll`, senza bisogno di un file di import. Per progetti complessi, però, può comunque servire un file di import come `.dll.a`.*

* **Se una libreria è stata compilata con MSVC**, in genere servono tre file:
  * Il file header (`.h`)
  * La libreria compilata (`.dll`)
  * Il file di import (`.lib`)

Dato che stiamo parlando di librerie a collegamento dinamico, ricordiamoci che tutti i file `.dll` vanno posizionati accanto all'eseguibile, nella cartella di installazione. Se invece si compilasse in modo statico, il codice della libreria verrebbe incorporato direttamente nel file eseguibile.
