---
title: "Reindirizzare i qDebug di Qt su file senza ricompilare: la classe LoggerManager"
description: "Un crash sul campo che non riuscivo a diagnosticare, nessuna possibilità di ricompilare sul posto, e la classe C++/Qt che ho scritto per intercettare i log a runtime — con ogni errore di linking incontrato lungo la strada."
date: "2026-08-05"
category: "software"
tags: ["cpp", "qt", "debug", "strumenti"]
---

## Il problema, sul campo

Un'applicazione Qt in C++, già compilata e installata sulla macchina di un cliente, aveva iniziato a andare in crash. Nessun output: l'eseguibile era stato compilato senza `console` nel file `.pro`, quindi ogni riga di `qDebug()` spariva nel nulla nel momento stesso in cui l'app si chiudeva.

La soluzione rapida la conosce qualsiasi sviluppatore Qt: aggiungere `CONFIG += console` al file `.pro`, ricompilare, lanciare da terminale e leggere l'output di `qDebug()` in diretta mentre l'app va in crash. Ha funzionato, ma mi ha lasciato con una domanda scomoda: e se non avessi potuto ricompilare? Un cliente non aspetta che tu prepari una build di debug e gliela mandi — vuole il file di log di quello che sta già girando sulla sua macchina, adesso.

Da lì è nata l'idea: una piccola libreria che intercetta ogni `qDebug()`, `qWarning()`, `qCritical()` di un'applicazione Qt e li scrive su file, attivabile e disattivabile a runtime, senza toccare il codice esistente né ricompilare nulla.

[Repository](https://github.com/kineticCode-dev/qDebugRedirection)

## Il vincolo di progettazione

Per essere davvero utile su un progetto già esistente, la soluzione doveva rispettare due condizioni:

- **impatto quasi nullo sul codice del progetto ospitante**: includere un header e aggiungere due righe in `main`, niente di più.
- **nessuna ricompilazione per attivare o disattivare il logging**: il comportamento deve essere controllabile dall'esterno, tramite variabili d'ambiente.

Qt ci mette già a disposizione l'aggancio giusto per questo: `qInstallMessageHandler()`. È una funzione a livello di sistema costruita per intercettare *ogni* messaggio del framework (`qDebug`, `qWarning`, `qCritical`, `qFatal`) e reindirizzarlo dove si vuole, prima ancora che arrivi alla console.

## La prima trappola: le callback in stile C non hanno `this`

Il primo prototipo era una singola funzione libera passata a `qInstallMessageHandler`. Funzionava, ma non era pulito: volevo incapsularla in una classe, così da poter scrivere semplicemente, in `main`,

```cpp
LoggerManager lm;
lm.init();
```

invece di lasciare una funzione nuda a fluttuare nello scope globale. È qui che è saltato fuori il primo vincolo tecnico non ovvio: `qInstallMessageHandler` si aspetta un puntatore a funzione con firma fissa,

```cpp
void (*)(QtMsgType, const QMessageLogContext &, const QString &)
```

Un normale metodo d'istanza ha un parametro extra nascosto sotto il cofano: il puntatore `this`. Le due firme non combaciano, e il compilatore non converte un metodo d'istanza in quel tipo di puntatore a funzione. Qt per questo genere di aggancio di sistema si affida ancora a puntatori a funzione in stile C vecchia scuola, senza wrapper come `std::function` o lambda che catturano il contesto.

La conseguenza pratica: `messageHandler` deve rimanere `static` (o essere una funzione libera fuori dalla classe), e di conseguenza anche qualsiasi stato letto da quella funzione — nel nostro caso, il nome del file di log — deve essere `static`. `init()`, invece, può restare un normale metodo d'istanza: è lì che viene costruito il percorso, lette le variabili d'ambiente, e presa la decisione di installare l'handler.

## Il secondo inciampo: LNK2019

Con la classe riscritta, la build falliva con un classico `LNK2019: unresolved external symbol` sul membro statico `m_fileName`. Il motivo: in C++ (fino a C++17), dichiarare un membro `static` nell'header dichiara soltanto che *esiste*, non ne alloca la memoria. Serve una riga di definizione esplicita nel file `.cpp`:

```cpp
QString LoggerManager::m_fileName = "app_debug.log";
```

Un dettaglio da manuale, ma è esattamente il tipo di errore che prendi sul serio solo dopo averlo visto comparire nel linker su un progetto reale, non su un tutorial.

## Attivarlo a runtime, senza un file `.ini`

Per evitare di dipendere da un file di configurazione esterno — che in un deployment industriale potrebbe mancare, venire sovrascritto, o finire in sola lettura — ho scelto le variabili d'ambiente come interruttore:

- `ENABLE_FILE_LOG=1` attiva il logging su file. Se manca o è impostata a qualsiasi valore diverso da `1`, l'applicazione si comporta esattamente come prima: overhead zero, nessun file creato.
- `MAX_LOG_COUNT` imposta quanti file di log tenere in rotazione (default: 10).


C'è un dettaglio non ovvio da tenere presente quando si fanno test da Qt Creator: `QProcessEnvironment::systemEnvironment()` restituisce uno snapshot dell'ambiente del *processo padre*, catturato al suo avvio. Se imposti la variabile dopo aver già aperto l'IDE, l'app figlia erediterà comunque il vecchio ambiente. Bisogna impostarla in *Projects → Run → Environment*, oppure riavviare l'IDE da zero.

## Dove finisce davvero il file

Un percorso relativo come `QFile file("app_debug.log")` viene risolto rispetto alla *working directory* del processo, che **non coincide sempre** con la cartella dell'eseguibile: da terminale di solito sì, da Qt Creator dipende dalla cartella di build impostata nel progetto, e su un servizio Linux (`systemd`) può essere `/` o `/root`, spesso in sola lettura.

Per ottenere un comportamento prevedibile, ho forzato il percorso relativo alla cartella dell'eseguibile usando `QCoreApplication::applicationDirPath()`, e ho usato `QDir::filePath()` invece della concatenazione manuale di stringhe — evita problemi di separatore (`/` su Linux/macOS, `\` su Windows) e doppi slash quando `applicationDirPath()` termina già con un separatore.

## Rotazione dei log: il bug del contatore bloccato

La prima versione della logica di rotazione contava i file `.log` nella cartella e, una volta raggiunta la soglia `m_maxLogFiles`, sovrascriveva sempre `logFile_1.log`. Sembrava corretta finché non ci pensi bene: al successivo avvio, il conteggio dei file nella cartella è di nuovo uguale al massimo, quindi la logica sceglie di nuovo `logFile_1.log` — `logFile_2.log` e `logFile_3.log` non vengono più toccati. Un bug silenzioso: nessun crash, solo una rotazione che smette di ruotare senza dirlo a nessuno.

La correzione è stata ordinare i file per data di modifica e riciclare sempre il più vecchio (una politica FIFO), indipendentemente dai nomi dei file:

```cpp
QString LoggerManager::getNextLogFileName(const QString &folderPath)
{
    QDir dir(folderPath);
    dir.setNameFilters(QStringList() << "*.log");
    dir.setFilter(QDir::Files);

    // primo elemento: il più vecchio
    dir.setSorting(QDir::Time | QDir::Reversed);

    QFileInfoList logFiles = dir.entryInfoList();

    if (logFiles.size() < m_maxLogFiles) {
        return QString("logFile_%1.log").arg(logFiles.size() + 1);
    }

    return logFiles.first().fileName();
}
```

In questo modo, una volta raggiunto il numero massimo di file, il sistema ricicla sempre quello aggiornato meno di recente, senza mai superare lo spazio configurato — e senza dipendere da uno schema di numerazione che l'utente potrebbe rompere cancellando un file a mano.

## Il risultato: due righe in main

Tutto questo lavoro di incapsulamento esiste per un unico motivo: chi integra la libreria in un altro progetto non deve doversene preoccupare.

```cpp
#include "loggermanager.h"

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);

    // Deve venire dopo QApplication a(argc, argv)
    LoggerManager lm;
    lm.init();

    MainWindow w;
    w.show();

    return a.exec();
}
```

Comportamento di default: nessuna variabile d'ambiente impostata, nessun file creato, nessuna differenza rispetto al progetto originale. Sul campo, davanti a un crash che non riesci a riprodurre, ti basta impostare `ENABLE_FILE_LOG=1` prima di rilanciare l'eseguibile e recuperare il file `.log` dalla cartella accanto all'`.exe` — senza toccare una sola riga di codice né ricompilare nulla.

## Cosa mi porto a casa

Il valore di questo strumento non sta nella classe in sé — poche decine di righe — ma nei vincoli che l'hanno plasmata: nessuna dipendenza da file esterni, nessun impatto sul progetto ospitante quando è disattivato, e una rotazione dei log che non si rompe silenziosamente dopo il primo ciclo. Sono esattamente questo tipo di dettagli che, su un sistema in produzione, fanno la differenza tra uno strumento che usi davvero e uno che scrivi una volta e poi dimentichi.

Il codice vive nel repository dei progetti; se può tornarti utile su uno dei tuoi progetti Qt, integrarlo richiede letteralmente due righe: [Repository](https://github.com/kineticCode-dev/qDebugRedirection)
