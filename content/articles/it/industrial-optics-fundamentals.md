---
title: "Ottica industriale: quello che conta davvero quando scegli un obiettivo"
description: "Una guida pratica all'ottica per la visione industriale — campo visivo, distanza di lavoro, profondità di campo, lunghezza focale, attacchi, numero F e i compromessi che decidono se un sistema di ispezione funziona davvero."
date: "2026-08-18"
category: "automazione"
tags: ["machine-vision", "optics", "vision-systems", "fundamentals"]
---

## Cosa fa davvero un sistema ottico industriale

Un obiettivo ha un solo compito: raccogliere la luce che rimbalza su un oggetto e ricostruirne l'immagine su un sensore — di solito un CCD o un CMOS, le due tecnologie dietro ogni sensore di fotocamera digitale. Anche il tuo occhio fa la stessa cosa: la cornea e il cristallino piegano la luce in ingresso sulla retina, ed è proprio quella deviazione a permetterti di ricostruire un'immagine. Una telecamera industriale fa esattamente lo stesso, con un obiettivo al posto della cornea e un sensore al posto della retina.

In laboratorio o in un progetto amatoriale, un'inquadratura "abbastanza buona" va benissimo. In un sistema di ispezione industriale no. Se stai verificando che un pezzo meccanico rientri in tolleranza, o che un'etichetta sia stampata correttamente, devi sapere esattamente quanto grande apparirà l'oggetto sul sensore, quanto deve essere nitido, ed esattamente dove deve trovarsi nello spazio perché il sistema funzioni. Per questo un piccolo gruppo di parametri, presi insieme, descrive completamente il comportamento di un sistema ottico.

## I parametri che definiscono un sistema ottico

- **Campo visivo (FoV)** — l'area totale inquadrata dall'obiettivo. Se devi ispezionare un oggetto di 5 cm, il tuo FoV deve essere almeno di 5 cm.
- **Distanza di lavoro (WD)** — la distanza tra l'oggetto e l'obiettivo alla quale l'oggetto risulta perfettamente a fuoco. Non è una distanza arbitraria: è fissata dall'obiettivo e da come è configurato.
- **Profondità di campo (DoF)** — l'intervallo, davanti e dietro al piano di perfetto fuoco, entro il quale l'oggetto appare ancora nitido in modo "accettabile". È uno dei parametri più importanti nella pratica.
- **Dimensione del sensore** — la dimensione fisica del sensore, in millimetri, ottenuta moltiplicando la dimensione del pixel (tipicamente pochi micrometri) per il numero di pixel.
- **Ingrandimento** — il rapporto tra la dimensione dell'immagine sul sensore e la dimensione reale dell'oggetto. Sotto 1, il sensore vede meno dettaglio della scena reale; sopra 1, sta di fatto ingrandendo un particolare.
- **Risoluzione** — la distanza minima tra due punti che il sistema riesce ancora a distinguere come due punti separati, e non come un'unica macchia sfocata. Dipende dalla combinazione di obiettivo e sensore, non dall'uno o dall'altro presi da soli.

Nessuno di questi sei parametri è indipendente dagli altri. Sono legati da relazioni precise, e modificarne uno cambia automaticamente gli altri: avvicina l'oggetto all'obiettivo, e il campo visivo si restringe, l'ingrandimento aumenta e la profondità di campo diminuisce. Progettare un sistema ottico significa conoscere queste relazioni abbastanza bene da poterle bilanciare deliberatamente, non per tentativi.

## L'equazione della lente sottile

Per rendere la matematica gestibile, l'ottica di base si appoggia a due semplificazioni:

- **Approssimazione parassiale** — si considerano solo i raggi che entrano nell'obiettivo con un piccolo angolo rispetto all'asse ottico (la linea immaginaria che passa per il centro del sistema). I raggi che colpiscono i bordi con angoli ampi vengono ignorati, il che mantiene la geometria lineare.
- **Approssimazione della lente sottile** — lo spessore fisico della lente viene considerato trascurabile, quindi la lente è modellata come un unico piano anziché come un oggetto solido.

Con queste due semplificazioni si ottiene l'equazione su cui si basa tutto il resto di questo articolo:

```
1/s' - 1/s = 1/f
```

dove `s` è la posizione dell'oggetto rispetto all'obiettivo (negativa per convenzione, dato che l'oggetto si trova "prima" dell'obiettivo lungo la direzione di propagazione della luce), `s'` è la posizione dell'immagine (positiva), e `f` è la lunghezza focale dell'obiettivo.

Altri due termini che vale la pena tenere ben distinti, perché compaiono di continuo nelle schede tecniche degli obiettivi: la **distanza di lavoro** è la distanza tra l'oggetto e la parte anteriore dell'obiettivo, mentre la **back focal distance** (distanza focale posteriore) è la distanza tra la parte posteriore dell'obiettivo e il sensore. Si trovano su lati opposti dell'obiettivo — non vanno confuse.

## Lunghezza focale

I raggi che entrano in un obiettivo convergono verso un unico punto dopo essere stati deviati dal vetro. La distanza tra l'obiettivo e quel punto è la lunghezza focale. In una lente convergente (positiva), i raggi si incontrano davvero in un fuoco reale. In una lente divergente (negativa), i raggi si allontanano tra loro dopo la lente, quindi non esiste un fuoco reale — solo uno virtuale, il punto da cui i raggi sembrano provenire se li si prolunga all'indietro.

![Lente convergente che forma un fuoco reale, lente divergente che forma un fuoco virtuale](./img/focal-length.png)

Ogni obiettivo usato in visione industriale è, nel complesso, un sistema positivo (convergente): la luce deve sempre convergere sul piano del sensore, altrimenti non si forma alcuna immagine. Un obiettivo può contenere internamente sia elementi positivi che negativi per correggere le aberrazioni ottiche, ma l'assieme nel suo complesso è sempre convergente.

Lunghezza focale e campo visivo si muovono in direzioni opposte: più lunga è la focale, più stretto è il campo visivo. È esattamente ciò che succede quando fai zoom con una fotocamera — focale più lunga, meno scena inquadrata.

C'è un'eccezione importante: quando l'oggetto si trova più vicino di circa 10 volte la lunghezza focale, le equazioni standard della lente sottile smettono di essere accurate. Questa condizione si chiama **modalità macro**, e richiede obiettivi progettati appositamente per il lavoro a distanza ravvicinata.

## Ingrandimento e campo visivo

Formalmente, l'ingrandimento è:

```
M = h' / h
```

dove `h'` è la dimensione dell'immagine sul sensore e `h` è la dimensione reale dell'oggetto. Un oggetto di 10 mm che produce un'immagine di 5 mm sul sensore dà M = 0.5.

Una formula collegata lega direttamente la distanza di lavoro alla lunghezza focale e all'ingrandimento:

```
s = f(M - 1) / M
```

Conoscendo la lunghezza focale di un obiettivo e l'ingrandimento richiesto, questa formula ti dice esattamente dove posizionare l'oggetto — è il calcolo che si fa quando si dimensiona una stazione di controllo qualità: conosci la dimensione del pezzo, conosci la dimensione del tuo sensore, calcoli l'ingrandimento necessario, e da lì ottieni la distanza di lavoro richiesta.

C'è anche una convenzione di denominazione che vale la pena conoscere, perché ti dice a colpo d'occhio per cosa è progettato un obiettivo:

- **Gli obiettivi macro e telecentrici** sono progettati per lavorare a distanze paragonabili alla propria lunghezza focale ("coniugati finiti"), e vengono classificati e venduti in base all'ingrandimento — "0.5X", "1X", "2X".
- **Gli obiettivi a focale fissa** sono progettati per distanze di lavoro molto maggiori della propria lunghezza focale ("coniugati infiniti" — pensa ai raggi paralleli della luce solare), e vengono classificati e venduti in base alla lunghezza focale — "8mm", "25mm", "50mm".

Se un obiettivo è indicato come "2X" invece che "50mm", sai già a quale famiglia appartiene: costruito per lavorare da vicino, su piccoli dettagli. Un obiettivo "25mm" appartiene alla seconda famiglia: costruito per lavorare a distanza, come un normale obiettivo fotografico.

## Attacchi e distanza flangia-sensore

Prima di addentrarci ulteriormente nell'ottica, c'è una questione meccanica altrettanto importante: come si fissa fisicamente un obiettivo a una telecamera? La distanza tra la flangia di montaggio e il sensore — la **flange focal distance** (distanza flangia-sensore) — entra in gioco in ogni calcolo ottico visto finora. Sbagliarla significa che l'equazione della lente sottile smette di corrispondere alla realtà: l'immagine non risulterà a fuoco dove dovrebbe.

| Attacco | Distanza flangia-sensore | Note |
|---|---|---|
| C-mount | 17.526 mm | L'attacco più comune nelle telecamere industriali. Diametro 1 pollice, 32 filetti per pollice. |
| CS-mount | 12.526 mm | 5 mm più corto del C-mount. Un obiettivo C-mount su una telecamera CS-mount (o viceversa) porta il sensore alla distanza sbagliata e l'immagine non sarà a fuoco. |
| F-mount | Baionetta (inserimento e rotazione) | Sviluppato da Nikon, usato per sensori più grandi. A differenza degli altri, su questo attacco la back focal distance non è regolabile. |
| Mxx-mount (es. M42, M72) | Variabile | Una famiglia di attacchi filettati definiti da diametro, passo del filetto e distanza flangia-sensore — usata per sensori ancora più grandi del F-mount. |

Quando si sceglie un obiettivo per una telecamera specifica, la prima domanda meccanica è sempre "che attacco usa la mia telecamera?" — sbagliare l'attacco significa non riuscire a fissare fisicamente l'obiettivo, oppure fissarlo alla distanza sbagliata, rendendo irrilevante tutto quello che viene dopo.

Anche con un attacco correttamente abbinato, le telecamere reali raramente rispettano esattamente la distanza flangia-sensore nominale — il vetro di protezione che copre il sensore ha il proprio spessore, e la luce che lo attraversa sposta leggermente il punto di fuoco effettivo. Per questo i produttori di obiettivi vendono gli **shim kit**: sottili spessori usati, soprattutto con gli obiettivi telecentrici, per mettere a punto la distanza reale sul suo valore ottimale. Non è un dettaglio da poco — su un obiettivo telecentrico, un errore di pochi decimi di millimetro nella back focal distance può cambiare in modo percepibile l'ingrandimento misurato, il che conta moltissimo se l'obiettivo viene usato per misure dimensionali e non solo per "vedere" il pezzo.

## Formati dei sensori

Due tabelle di riferimento tornano continuamente utili quando si specifica un sistema di visione: una per i sensori **line scan** (che catturano l'immagine una riga di pixel alla volta — tipici delle linee di produzione dove l'oggetto si muove sotto la telecamera), e una per i sensori **area scan** (il tipo più comune, che cattura un'immagine completa in un'unica volta, come una fotocamera normale).

**Sensori line scan (lunghezza in pixel di una singola riga)**

| Risoluzione × dimensione pixel | Lunghezza sensore |
|---|---|
| 2048 px × 10 µm | 20.5 mm |
| 2048 px × 14 µm | 28.6 mm |
| 4096 px × 7 µm | 28.6 mm |
| 4096 px × 10 µm | 41 mm |
| 6144 px × 7 µm | 43 mm |
| 8192 px × 7 µm | 57.3 mm |
| 12288 px × 5 µm | 62 mm |

**Sensori area scan (formati standard)**

| Formato | Larghezza | Altezza | Diagonale |
|---|---|---|---|
| 1/3″ | 4.8 mm | 3.6 mm | 6.000 mm |
| 1/2.5″ | 5.76 mm | 4.29 mm | 7.182 mm |
| 1/2″ | 6.4 mm | 4.8 mm | 8.000 mm |
| 1/1.8″ | 7.176 mm | 5.319 mm | 8.933 mm |
| 2/3″ | 8.8 mm | 6.6 mm | 11.000 mm |
| 1″ | 12.8 mm | 9.6 mm | 16.000 mm |
| 4/3″ | 18.8 mm | 13.5 mm | 22.500 mm |
| Full frame 35 mm | 36.0 mm | 24.0 mm | 43.300 mm |

Vale la pena segnalarlo, perché frega quasi tutti quelli che iniziano: queste etichette in "pollici" sono storiche, non fisiche. Un sensore "1/3 di pollice" ha una diagonale di 6 mm, non di 8.47 mm come suggerirebbe un calcolo letterale di un terzo di pollice. La denominazione risale alle telecamere a tubo sottovuoto degli anni '50, dove il *diametro esterno del tubo di vetro* era, all'incirca, di un pollice — mentre l'area utile sensibile alla luce era molto più piccola del tubo stesso. Quando negli anni '80 e '90 sono arrivati i sensori CCD allo stato solido, i produttori hanno mantenuto la denominazione in "pollici" per compatibilità commerciale, anche se ormai non corrisponde più direttamente a nessuna dimensione fisica. Non ricavare mai la dimensione reale di un sensore dalla sua etichetta in pollici tramite calcolo diretto — controlla sempre i valori in millimetri sulla scheda tecnica.

Vale anche la pena sapere che due telecamere con lo stesso "formato" nominale possono comunque avere sensori sensibilmente diversi, perché il rapporto larghezza-altezza può variare da un modello all'altro. Quando scegli un obiettivo per una telecamera specifica, controlla le dimensioni reali del sensore in millimetri — non affidarti mai al solo formato nominale.

## Apertura (numero F) e profondità di campo

Questa è la parte più densa dell'argomento, ma anche la più pratica: quanto è "aperto" o "chiuso" un obiettivo, e cosa cambia di conseguenza.

### Il numero F

L'apertura di un obiettivo — quanto è grande il "foro" attraverso cui passa la luce, esattamente come la pupilla del tuo occhio che si dilata o si restringe — si esprime come numero F, definito in condizioni standard come:

```
F/# = f / d
```

dove `d` è il diametro dell'apertura e `f` è la lunghezza focale. Sulle prime è controintuitivo: un numero F **più alto** significa un'apertura **più piccola**, perché `d` sta al denominatore. F/16 è un'apertura molto più piccola di F/2.

I valori standard presenti su ogni obiettivo sono F/1.0, F/1.4, F/2, F/2.8, F/4, F/5.6, F/8, F/11, F/16, F/22. Ogni scatto verso l'alto (apertura più piccola) **dimezza** la quantità di luce che entra nell'obiettivo.

![Dimensione dell'apertura che diminuisce da F/2 a F/8 a F/16](./img/aperture-fnumber.png)

Per gli obiettivi macro o telecentrici (la famiglia a coniugati finiti descritta sopra), si usa una variante corretta, il **numero F di lavoro**:

```
wF/# = (1 + M) × F/#
```

La correzione tiene conto del fatto che, quando l'oggetto è vicino (come accade con questi obiettivi), l'ingrandimento stesso modifica quanto "chiusa" si comporta effettivamente l'apertura.

### Profondità di campo

A questo punto la profondità di campo si può definire con precisione: è l'intervallo tra il punto più vicino e quello più lontano in cui un oggetto appare ancora accettabilmente a fuoco.

C'è una sottigliezza su cui vale la pena soffermarsi: fisicamente esiste un solo piano, nello spazio oggetto, perfettamente coniugato al piano del sensore — un unico piano che produce un'immagine matematicamente perfetta. Tutto il resto di quella che chiamiamo "profondità di campo" è in realtà una questione di *accettabilità*, non di perfezione: quanta sfocatura conta come "ancora accettabile" dipende interamente dall'applicazione. Un controllo dimensionale di precisione (misurare un pezzo con una tolleranza di un centesimo di millimetro) richiede una nitidezza molto maggiore rispetto a un'ispezione visiva generica (verificare solo che un'etichetta sia presente e leggibile).

![La profondità di campo come zona attorno a un unico piano perfettamente a fuoco](./img/depth-of-field.png)

Una formula pratica per stimare la profondità di campo:

```
DoF [mm] = wF/# × p[µm] × k / M²
```

dove `p` è la dimensione del pixel del sensore in micrometri, `M` è l'ingrandimento dell'obiettivo, e `k` è un fattore adimensionale che dipende dall'applicazione — tipicamente **0.008** per applicazioni di misura dimensionale (dove la nitidezza conta più di tutto) e **0.015** per applicazioni di ispezione difetti (dove è accettabile un po' più di tolleranza).

**Esempio svolto.** Ingrandimento dell'obiettivo M = 0.25X, numero F di lavoro wF/# = 8, dimensione pixel del sensore p = 5.5 µm, applicazione di ispezione difetti quindi k = 0.015.

1. M² = 0.25 × 0.25 = 0.0625
2. numeratore: wF/# × p × k = 8 × 5.5 × 0.015 = 0.66
3. DoF = 0.66 / 0.0625 = 10.56 mm ≈ **10.5 mm**

Una piccola nota di onestà sulle unità di misura: la dimensione del pixel in questa formula è in micrometri, mentre il risultato è espresso direttamente in millimetri — un salto di tre ordini di grandezza che la formula non esplicita. In pratica, la costante `k` quasi certamente incorpora sia un fattore di conversione dimensionale sia un criterio empirico di sfocatura accettabile, calibrato su test reali più che derivato da principi primi. Questo non rende la formula sbagliata — i numeri tornano — ma vale la pena sapere che è una scorciatoia ingegneristica, non una derivazione da principi primi, così non ti metti a ricavarla da zero pensando di aver sbagliato qualcosa quando i tuoi calcoli non la riproducono in modo pulito.

Su quale numero F scegliere: F/8 è un punto di equilibrio comune. Le aperture più piccole (numeri F più alti, come F/16 o F/22) iniziano a soffrire di **diffrazione** — un effetto di ottica ondulatoria per cui la luce si sparpaglia quando l'apertura diventa molto piccola, il che paradossalmente peggiora la nitidezza anche se la profondità di campo continua ad aumentare. Le aperture più grandi (numeri F più bassi, come F/1.4 o F/2) sono più soggette ad **aberrazioni ottiche e distorsione**, imperfezioni intrinseche a qualsiasi progetto ottico che diventano più visibili quando si usa l'apertura piena.

Vale la pena interiorizzare il compromesso di fondo: apertura piccola (numero F alto) richiede più luce ma dà più profondità di campo e meno aberrazioni; apertura grande (numero F basso) richiede meno luce ma dà meno profondità di campo e più aberrazioni/distorsione. Non esiste un'apertura universalmente "corretta" — F/8 è una scelta ragionevole di default, ma quella giusta dipende sempre da quanta luce hai davvero a disposizione e da quanta profondità di campo richiede l'applicazione rispetto alla massima nitidezza.

## Altri quattro termini da conoscere

Un piccolo gruppo di concetti viene citato di continuo parlando di ottica industriale, senza però essere sempre spiegato per intero:

- **MTF (Modulation Transfer Function, funzione di trasferimento della modulazione)** — il metodo standard per misurare oggettivamente quanto sia "nitido" un obiettivo, ai diversi livelli di dettaglio. Invece di dire genericamente che un obiettivo è "nitido", l'MTF indica numericamente quanto bene il sistema riproduce il contrasto tra linee sempre più fini — è lo strumento che i produttori usano davvero per confrontare rigorosamente la qualità degli obiettivi.
- **Telecentricità** — un obiettivo normale ("entocentrico") fa apparire gli oggetti più piccoli man mano che si allontanano, esattamente come la visione prospettica umana. Un obiettivo **telecentrico** è progettato appositamente per eliminare questo effetto entro un certo intervallo di distanza: un oggetto misura la stessa dimensione nell'immagine indipendentemente dalla posizione esatta in cui si trova all'interno della profondità di campo. Per questo gli obiettivi telecentrici sono la scelta standard per le misure dimensionali di precisione, dove un piccolo errore di posizionamento non deve tradursi in un errore di misura.
- **Ottiche pericentriche** — una terza famiglia meno comune, progettata per riprendere le superfici interne di un oggetto cavo (l'interno di un tubo, per esempio) con una vista leggermente angolata anziché frontale.
- **Distorsione** — una deformazione geometrica dell'immagine rispetto alla realtà: le linee rette della scena reale appaiono curve nell'immagine (distorsione a barile che curva verso l'esterno, distorsione a cuscinetto che curva verso l'interno). È un difetto rilevante per le applicazioni di misura e, quando necessario, viene corretto via software, perché influisce direttamente sull'accuratezza di qualsiasi misura dimensionale ricavata dall'immagine.

## Come si incastra tutto

1. La **lunghezza focale (f)**, insieme alla distanza dell'oggetto, determina dove si forma l'immagine (l'equazione della lente sottile) e quanto è grande il **campo visivo (FoV)**.
2. Il rapporto tra la dimensione dell'immagine e la dimensione reale dell'oggetto definisce l'**ingrandimento (M)**, che a sua volta determina la **distanza di lavoro (WD)** richiesta da un dato obiettivo.
3. Il **diametro dell'apertura**, rapportato alla lunghezza focale, dà il **numero F** — che controlla sia quanta luce entra sia, insieme a ingrandimento e dimensione del pixel, quanto è grande la **profondità di campo (DoF)**.
4. Tutto questo deve fare i conti con la meccanica: l'**attacco** e la corretta **back focal distance** determinano se il piano in cui l'immagine "dovrebbe" formarsi coincide davvero con il piano fisico del sensore.
5. Infine, quanto bene tutto questo si traduce in un'immagine davvero utile dipende anche da **risoluzione, MTF, telecentricità e distorsione** — fattori che vanno oltre i parametri di base ma che contano altrettanto in un sistema reale.

Se dovessi sceglierne solo due da approfondire, sono telecentricità e MTF. Sono i concetti citati più spesso solo di passaggio, eppure sono centrali in qualsiasi applicazione industriale reale che coinvolga misure o controllo qualità — capirli bene è ciò che rende davvero leggibile la scheda tecnica di un obiettivo.
