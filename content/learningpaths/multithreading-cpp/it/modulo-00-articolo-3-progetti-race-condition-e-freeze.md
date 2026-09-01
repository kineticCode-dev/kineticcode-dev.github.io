---
title: "Due dimostrazioni, non due racconti: la race condition e il freeze costruiti con le tue mani"
description: "Multithreading in C++ con Qt — Modulo 0 — Progetto"
---

# Due dimostrazioni, non due racconti: la race condition e il freeze costruiti con le tue mani

I due articoli precedenti hanno costruito il vocabolario: thread, concorrenza, race condition, data race, il vincolo del thread unico di Qt. Ora tocca alle mani. Costruiamo insieme due piccoli progetti: il primo isola la race condition in puro C++ standard, senza una sola riga di Qt; il secondo ricrea dal vivo il freeze della UI di cui abbiamo già parlato, e lo cura solo a metà — la cura vera arriva nel prossimo modulo, quando sposteremo il calcolo su un thread separato con `QThread`.

## Progetto A — La race condition, isolata e dal vivo

Vogliamo vedere il fenomeno puro, senza nessun framework sopra. Crea una cartella di lavoro e, dentro, un file `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.16)
project(race_condition_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

add_executable(race_condition_demo main.cpp)
target_link_libraries(race_condition_demo PRIVATE Threads::Threads)
```

`find_package(Threads REQUIRED)` cerca sul sistema la libreria di threading nativa (su Linux è `pthread`; su Windows la gestisce il runtime stesso), e `Threads::Threads` è il target che colleghiamo all'eseguibile: senza questo collegamento esplicito, alcuni sistemi darebbero errori di linking non appena usassimo `std::thread`.

Crea `main.cpp` e comincia con gli include e le costanti:

```cpp
#include <iostream>
#include <thread>
#include <vector>
#include <mutex>

constexpr int THREAD_COUNT = 8;
constexpr int INCREMENTS_PER_THREAD = 1'000'000;
```

Otto thread, un milione di incrementi ciascuno: abbastanza per rendere la race condition quasi certa da osservare (con numeri piccoli, per pura fortuna statistica, potresti non vederla manifestarsi mai — ed è già una buona lezione: "non l'ho vista quindi non c'è" è un ragionamento pericoloso in concorrenza).

Ora la versione pericolosa:

```cpp
long long unprotectedCounter = 0;

void incrementUnprotected() {
    for (int i = 0; i < INCREMENTS_PER_THREAD; ++i) {
        unprotectedCounter++;   // <-- race condition qui
    }
}
```

Nessun trucco: è il codice più ovvio possibile, ed è esattamente per questo che il bug è insidioso. Non salta all'occhio in fase di scrittura, salta all'occhio solo a runtime, e solo se lo osservi nel modo giusto.

Subito sotto, la versione corretta:

```cpp
long long protectedCounter = 0;
std::mutex counterMutex;

void incrementWithMutex() {
    for (int i = 0; i < INCREMENTS_PER_THREAD; ++i) {
        std::lock_guard<std::mutex> lock(counterMutex);
        protectedCounter++;
    }
}
```

`std::lock_guard` è un wrapper **RAII**: acquisisce il lock sul mutex nel costruttore e lo rilascia automaticamente nel distruttore, cioè quando `lock` esce dallo scope alla fine di ogni iterazione. Questo garantisce che il mutex venga rilasciato anche se nel mezzo venisse lanciata un'eccezione — dimenticarsi di farlo con un `lock()`/`unlock()` manuali è un classico modo di introdursi un deadlock da soli.

Nella `main`, lancia prima la versione senza protezione:

```cpp
int main() {
    const long long expected = static_cast<long long>(THREAD_COUNT) * INCREMENTS_PER_THREAD;

    std::cout << "Expected final value in both cases: " << expected << "\n\n";

    {
        std::vector<std::thread> threads;
        for (int i = 0; i < THREAD_COUNT; ++i)
            threads.emplace_back(incrementUnprotected);
        for (auto& t : threads)
            t.join();

        std::cout << "[WITHOUT mutex]  final counter = " << unprotectedCounter << "\n";
    }
```

`t.join()` blocca il thread chiamante finché il thread `t` non ha terminato completamente. È fondamentale chiamarlo su ogni thread creato prima di leggere il risultato finale: leggere `unprotectedCounter` prima che tutti i thread abbiano finito introdurrebbe un'altra race condition, questa volta tra il thread principale che legge e gli altri che stanno ancora scrivendo.

Aggiungi lo stesso blocco per la versione protetta, richiamando `incrementWithMutex` al posto di `incrementUnprotected`, poi chiudi con `return 0;`.

Compila ed esegui, prima in Release:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/race_condition_demo
```

C'è una possibilità concreta che il contatore "senza mutex" risulti corretto anche in questa esecuzione. Non significa che il codice sia sicuro: significa che il compilatore — avendo il diritto di assumere che nessuna data race avvenga — ha probabilmente tenuto `unprotectedCounter` in un registro per l'intera durata del ciclo di ciascun thread, mascherando il problema invece di risolverlo.

Ora ricompila in Debug:

```bash
rm -rf build
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
./build/race_condition_demo
```

Con le ottimizzazioni disattivate, ogni singolo incremento passa davvero attraverso una lettura e una scrittura in memoria a ogni iterazione, ed è molto più probabile che due thread si intreccino nel modo sbagliato. Su una macchina di verifica a due core, il contatore "senza mutex" è arrivato a perdere oltre cinque milioni di incrementi su otto milioni attesi — un errore del 60%, non un arrotondamento trascurabile. Provalo più volte: il numero esatto di incrementi persi cambierà ogni volta, perché dipende da come lo scheduler ha intrecciato i thread in quella specifica esecuzione. Non deterministico, per definizione — è di nuovo il punto centrale dell'articolo precedente.

Hai appena dimostrato a te stesso che un'istruzione apparentemente atomica (`counter++`) non lo è affatto a livello di esecuzione macchina, che il compilatore può nascondere il problema invece di risolverlo se non sincronizzi esplicitamente, e che un semplice `std::mutex` con `std::lock_guard` basta a riportare il risultato all'esattezza matematica attesa, ogni volta, senza eccezioni.

## Progetto B — Il freeze della UI, dal vivo

Questo è il progetto che vale più di ogni paragrafo di teoria per capire perché questo intero corso esiste. Costruiamo una piccola finestra Qt Widgets con un "battito cardiaco" visivo — un numero che sale ogni decimo di secondo, la prova che la finestra è viva — e poi lo blocchiamo di proposito, a comando, premendo un bottone.

Crea una nuova cartella di lavoro e un `CMakeLists.txt`:

```cmake
cmake_minimum_required(VERSION 3.16)
project(ui_freeze_demo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets)

add_executable(ui_freeze_demo
    main.cpp
    mainwindow.h
    mainwindow.cpp
)

target_link_libraries(ui_freeze_demo PRIVATE Qt6::Widgets)
```

`CMAKE_AUTOMOC ON` invoca automaticamente, dietro le quinte, il Meta-Object Compiler di Qt su ogni classe che usa la macro `Q_OBJECT` — il moc genera codice aggiuntivo che rende possibile il meccanismo di segnali e slot. Non dovrai mai invocarlo a mano.

Crea `mainwindow.h`:

```cpp
#pragma once

#include <QMainWindow>
#include <QLabel>
#include <QPushButton>
#include <QTimer>
#include <QElapsedTimer>
#include <QStatusBar>

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

private slots:
    void updateHeartbeat();
    void runHeavyComputation();

private:
    QLabel *m_labelHeartbeat;
    QLabel *m_labelInstructions;
    QPushButton *m_blockButton;
    QTimer *m_heartbeatTimer;
    int m_heartbeatCount = 0;

    long long countPrimes(long long limit);
};
```

La macro `Q_OBJECT` è quella che rende questa classe compatibile con il sistema di segnali e slot di Qt: qualunque classe che voglia usare `connect()` deve averla.

Crea `mainwindow.cpp` e comincia con il costruttore:

```cpp
#include "mainwindow.h"
#include <QWidget>
#include <QVBoxLayout>
#include <QFont>

MainWindow::MainWindow(QWidget *parent) : QMainWindow(parent) {
    setWindowTitle("Project B - UI Freeze Demonstration");
    resize(480, 220);

    auto *centralWidget = new QWidget(this);
    auto *layout = new QVBoxLayout(centralWidget);

    m_labelInstructions = new QLabel(
        "Watch the counter below: it updates every 100 ms.\n"
        "Then press the button and see what happens.", centralWidget);
    m_labelInstructions->setWordWrap(true);

    m_labelHeartbeat = new QLabel("Heartbeat: 0", centralWidget);
    QFont heartbeatFont = m_labelHeartbeat->font();
    heartbeatFont.setPointSize(18);
    heartbeatFont.setBold(true);
    m_labelHeartbeat->setFont(heartbeatFont);

    m_blockButton = new QPushButton("Run heavy computation (BLOCKING)", centralWidget);

    layout->addWidget(m_labelInstructions);
    layout->addWidget(m_labelHeartbeat);
    layout->addWidget(m_blockButton);
    centralWidget->setLayout(layout);
    setCentralWidget(centralWidget);
    statusBar()->showMessage("Ready.");

    m_heartbeatTimer = new QTimer(this);
    connect(m_heartbeatTimer, &QTimer::timeout, this, &MainWindow::updateHeartbeat);
    m_heartbeatTimer->start(100);

    connect(m_blockButton, &QPushButton::clicked,
            this, &MainWindow::runHeavyComputation);
}
```

Nota `new QWidget(this)`: passare `this` come genitore dice a Qt "questo oggetto vive finché vive la finestra, e quando la finestra viene distrutta, distruggi anche lui" — è il sistema di gestione della memoria a albero di parentela di Qt, che risparmia quasi sempre `delete` manuali sui widget. `connect()` collega un **segnale** (`QTimer::timeout`, emesso ogni volta che il timer scade; `QPushButton::clicked`, emesso al click) a uno **slot** (una funzione membro che reagisce) — è il meccanismo con cui, in Qt, un evento comunica con il codice che deve reagirci, e su cui costruiremo la comunicazione sicura tra thread nei moduli successivi.

Lo slot innocuo, il battito:

```cpp
void MainWindow::updateHeartbeat() {
    m_heartbeatCount++;
    m_labelHeartbeat->setText(QString("Heartbeat: %1").arg(m_heartbeatCount));
}
```

Niente di speciale: ogni 100 ms il numero sale di uno e l'etichetta si aggiorna. È il tuo sensore visivo per capire se il thread della GUI sta ancora respirando.

Il lavoro pesante, deliberatamente ingenuo:

```cpp
long long MainWindow::countPrimes(long long limit) {
    long long count = 0;
    for (long long n = 2; n < limit; ++n) {
        bool isPrime = true;
        for (long long d = 2; d * d <= n; ++d) {
            if (n % d == 0) { isPrime = false; break; }
        }
        if (isPrime) ++count;
    }
    return count;
}
```

Non ci interessa che sia efficiente, ci interessa solo che occupi la CPU per qualche secondo in modo riproducibile.

Lo slot che blocca tutto:

```cpp
void MainWindow::runHeavyComputation() {
    statusBar()->showMessage("Computing... (the UI is blocked, on purpose)");

    QElapsedTimer stopwatch;
    stopwatch.start();

    long long result = countPrimes(30'000'000);

    qint64 elapsedMs = stopwatch.elapsed();
    statusBar()->showMessage(
        QString("Done: %1 primes found in %2 ms. The heartbeat above did not move.")
            .arg(result).arg(elapsedMs));
}
```

Questo slot è collegato al `clicked()` di un `QPushButton`, quindi viene eseguito sul thread che possiede quel bottone — il thread principale, lo stesso che fa girare l'event loop e che aggiorna `m_labelHeartbeat`. Finché `countPrimes` non ritorna, quel thread non può fare **nient'altro**: non ridisegnare la finestra, non processare il timer del battito, non rispondere al sistema operativo. Aumenta o diminuisci `30'000'000` a seconda di quanto la tua macchina è veloce, finché il calcolo non dura almeno 3-4 secondi.

Infine `main.cpp`:

```cpp
#include <QApplication>
#include "mainwindow.h"

int main(int argc, char *argv[]) {
    QApplication app(argc, argv);

    MainWindow window;
    window.show();

    return app.exec();
}
```

`app.exec()` è, letteralmente, l'event loop di cui abbiamo parlato nell'articolo precedente: da qui in avanti, finché l'applicazione non si chiude, è questo ciclo — non il tuo codice — a decidere quando ogni slot viene chiamato.

Compila ed esegui:

```bash
cmake -S . -B build
cmake --build build
./build/ui_freeze_demo
```

Lascia la finestra aperta qualche secondo e osserva il numero salire regolarmente. Poi premi il bottone "Run heavy computation": il numero si ferma **esattamente** nell'istante del click, la finestra probabilmente ingrigisce (specialmente se provi a trascinarla o ridimensionarla mentre il calcolo è in corso — prova, è istruttivo), e solo quando il calcolo finisce vedi il numero riprendere a salire da dove si era fermato, tutto in un colpo solo, come se il tempo passato nel mezzo non fosse mai esistito per il thread della GUI.

Non un concetto astratto: hai visto con i tuoi occhi che "un thread unico" non è un limite teorico di Qt, ma un comportamento fisico osservabile del tuo programma. Nel prossimo modulo riprendiamo questo stesso identico file `mainwindow.cpp` e lo modifichiamo per spostare `countPrimes` su un `QThread` separato, usando il pattern del worker object con `moveToThread()`: vedrai il battito continuare a salire, imperturbato, mentre il calcolo gira in background — la cura per la malattia che hai appena diagnosticato con le tue mani.

---

*Il codice sorgente completo di entrambi i progetti è disponibile nella repository che accompagna questo corso, nelle cartelle `project-A-race-condition` e `project-B-ui-freeze`.*
