# Schema dei dati

Tutti i dati vivono in un unico Google Sheet, con sette fogli. Le colonne sono
identificate **per nome**, non per posizione: i nodi n8n leggono l'intestazione
di riga 1. Rinominare una colonna rompe i workflow; spostarla no.

| Foglio | Contenuto | Scritto da |
|---|---|---|
| `Transazioni` | movimenti del periodo corrente | workflow e app |
| `Archivio` | anni chiusi, stessa struttura | a mano |
| `Categorie` | elenco chiuso delle categorie e budget | migrazione e app |
| `Regole` | memoria della categorizzazione | conferme Telegram |
| `Ricorrenti` | abbonamenti dedotti dallo storico | workflow ricorrenti |
| `Conti` | elenco degli strumenti di pagamento | a mano |
| `Log` | scarti e anomalie | workflow |

---

## `Transazioni`

Il foglio principale. Una riga per movimento.

| Colonna | Contenuto |
|---|---|
| `id` | UUID generato alla scrittura |
| `data_evento` | quando è avvenuto il movimento, `YYYY-MM-DD` |
| `data_inserimento` | quando è entrato nel sistema, ISO con ora |
| `fonte` | canale di provenienza |
| `tipo` | `spesa` o `entrata` |
| `importo` | sempre positivo, due decimali |
| `valuta` | `EUR` |
| `conto` | strumento di pagamento |
| `esercente` | normalizzato: minuscolo, senza accenti, spazi compattati |
| `categoria` | deve esistere nel foglio `Categorie` |
| `sottocategoria` | non utilizzata, riservata |
| `note` | descrizione libera |
| `testo_grezzo` | contenuto originale, per diagnosi |
| `hash_dedup` | 16 caratteri esadecimali, chiave della riga |
| `confidenza` | da `0.00` a `1.00` |
| `stato` | `confermata`, `da_verificare`, `attesa` o `eliminata` |

### Domini dei valori

**`fonte`** — `1money_import` (storico migrato), `telegram`, `gmail`,
`outlook`, `push`, `app`.

**`conto`** — `banca`, `contante`, `paypal`, `satispay`, `revolut`, più
`storico` per le righe migrate, che erano su conto unico.

**`stato`** — `confermata` è il caso normale. `da_verificare` marca le righe
su cui il sistema ha dei dubbi: categoria non riconosciuta, importo ambiguo,
confidenza sotto soglia. `attesa` è un addebito annunciato ma non ancora
avvenuto, escluso dai totali. `eliminata` è una cancellazione logica: la riga
resta nel foglio ma viene esclusa da ogni lettura.

### Le attese

Un'attesa non è una riga a parte: **è la transazione stessa, scritta in
anticipo**. Quando arriva l'addebito reale, quella riga viene aggiornata invece
di scriverne una nuova.

In stato `attesa`, `data_evento` contiene la **data prevista** dell'addebito.
Alla riconciliazione viene sostituita con quella reale, perché una spesa vale
nel mese in cui i soldi escono.

Categoria, esercente e note sopravvivono alla riconciliazione: sono quelle
dedotte dall'email, che conosceva il fornitore, mentre la notifica bancaria da
sola avrebbe prodotto qualcosa di generico. Per questo il nodo che chiude
un'attesa aggiorna solo data, importo, conto, fonte e stato — un campo mappato
a vuoto cancellerebbe il resto.

Una riga diventa `attesa` solo se il testo contiene una data futura. Se il
modello linguistico la dichiara tale ma quella data non c'è, viene trattata
come un addebito già avvenuto: la classificazione va verificata contro un dato
oggettivo, non accettata sulla parola.

### Note importanti

**`hash_dedup` è la chiave usata da tutto il sistema**, non `id`. I bottoni di
conferma su Telegram e le operazioni dell'app la usano per individuare la riga,
perché le righe si spostano quando ordini il foglio e i loro indici no.
L'hash non cambia mai, nemmeno correggendo l'importo: identifica la riga, non
il suo contenuto.

**`data_inserimento` contiene l'ora** perché la deduplica confronta la distanza
temporale fra movimenti. Le righe dello storico migrato hanno solo la data:
sono vecchie e non entrano mai in un confronto.

**`importo` è memorizzato come testo.** In locale italiano un valore come
`6.00` verrebbe interpretato come un orario e salvato come data. I nodi che
scrivono usano la modalità che non interpreta i valori, e la colonna va
formattata come *Testo normale*. L'aggregazione avviene in n8n, non con le
formule del foglio.

**`esercente` e `note` sono cose diverse.** Il primo è il luogo — `coop
centro`, `da michele` — il secondo cosa hai comprato. Scrivendo dal bot, la
chiocciola separa i due: `12 pizza @da michele`.

---

## `Archivio`

**Struttura identica a `Transazioni`.** Ci si spostano a mano gli anni chiusi,
per alleggerire le letture correnti: ogni chiamata all'API rilegge l'intero
foglio, e oltre qualche migliaio di righe la cosa si sente.

Chi legge cosa:

| Legge solo `Transazioni` | Legge anche `Archivio` |
|---|---|
| riepilogo, movimenti | ricerca, andamento |
| inserimento, correzione, eliminazione | report periodici, ricorrenti |
| deduplica e riconciliazione | |

La regola è semplice: chi guarda il presente resta su `Transazioni`, chi
guarda indietro nel tempo legge entrambi. **Aggiungendo un workflow che fa
confronti storici, ricordati del secondo foglio**: senza, restituisce zero sui
periodi vecchi senza segnalare nulla.

---

## `Categorie`

L'elenco chiuso delle categorie ammesse e i budget.

| Colonna | Contenuto |
|---|---|
| `categoria` | nome, così come apparirà ovunque |
| `tipo` | `spesa` o `entrata` |
| `n_transazioni` | conteggio storico alla migrazione |
| `totale` | somma storica |
| `media` | media per transazione |
| `media_mensile` | media mensile sul periodo migrato |
| `budget_mensile` | budget, modificabile dall'app |

A runtime vengono usate solo `categoria`, `tipo` e `budget_mensile`. Le altre
sono il riferimento statistico prodotto dalla migrazione, utile per impostare
i budget su dati reali invece che a intuito.

**Questo foglio è la fonte della verità sulle categorie.** Il sistema verifica
ogni categorizzazione proposta dal modello linguistico contro questo elenco: se
non corrisponde a nessuna voce, il movimento entra con categoria vuota e stato
`da_verificare`. Serve a impedire che nel tempo si accumulino varianti dello
stesso concetto.

Aggiungere una categoria significa aggiungere una riga: viene usata subito,
senza toccare nulla.

---

## `Regole`

La memoria del sistema. Si popola da sola.

| Colonna | Contenuto |
|---|---|
| `pattern` | testo da cercare, minuscolo |
| `categoria` | categoria da assegnare |
| `conto` | conto predefinito, opzionale |
| `creata_il` | data di creazione |
| `utilizzi` | contatore, attualmente non incrementato |

Il confronto è per sottostringa sul testo normalizzato del movimento. Ogni
volta che confermi una categoria dai bottoni di Telegram, viene scritta una
regola: la volta successiva quel movimento non passa più dal modello
linguistico.

Puoi aggiungere righe a mano per i posti che già frequenti.

**Tieni i pattern lunghi almeno due o tre caratteri.** Un pattern molto corto
corrisponde a troppe cose, e uno vuoto corrisponderebbe a tutto, spegnendo di
fatto la categorizzazione automatica.

---

## `Ricorrenti`

Gli abbonamenti, dedotti dallo storico e riscritti ogni giorno.

| Colonna | Contenuto |
|---|---|
| `esercente` | chiave di raggruppamento, normalizzata |
| `categoria` | quella dell'ultima occorrenza |
| `cadenza` | `settimanale`, `mensile`, `bimestrale`, `trimestrale`, `semestrale`, `annuale` |
| `giorni` | intervallo tipico in giorni |
| `importo_tipico` | mediana degli importi |
| `occorrenze` | quante volte è comparso |
| `ultima_data` | ultima occorrenza registrata |
| `prossima_attesa` | quando dovrebbe ripresentarsi |
| `ignora` | `si` per escluderlo dagli avvisi |
| `aggiornata_il` | ultimo ricalcolo |

Una ricorrenza si riconosce da almeno tre occorrenze a intervalli regolari,
valutati sulla **mediana** e non sulla media: un pagamento in ritardo isolato
non deve cancellare un pattern.

**`ignora` è la sola colonna tua.** Il workflow la legge ma non la scrive mai,
quindi resta com'è a ogni ricalcolo. Serve per gli esercenti che frequenti con
regolarità senza che siano abbonamenti — il supermercato del sabato è
regolarissimo, ma non è qualcosa da sorvegliare.

---

## `Conti`

| Colonna | Contenuto |
|---|---|
| `conto` | identificativo |
| `descrizione` | testo libero |
| `attivo` | `si` o `no` |

Attualmente **non è letto dai workflow**: l'elenco dei conti è definito nel
codice dell'API. Il foglio resta come punto naturale in cui spostarlo, se un
domani i conti cambieranno abbastanza spesso da giustificarlo.

---

## `Log`

| Colonna | Contenuto |
|---|---|
| `timestamp` | quando |
| `livello` | `duplicato`, `errore`, `avviso`, `info` |
| `messaggio` | descrizione |

Ci finisce tutto ciò che il sistema ha scartato e il perché. È il primo posto
da guardare quando i conti non tornano: se un movimento non compare fra le
transazioni, o è stato riconosciuto come duplicato, o è stato scartato durante
l'elaborazione — e in entrambi i casi qui c'è scritto.

È il contraltare dello scarto automatico: si può cancellare senza chiedere,
purché resti traccia di cosa e perché.

---

## Manutenzione

**Formattazione.** La colonna `importo` va impostata su *Testo normale*
(Formato → Numero → Testo normale), sia in `Transazioni` sia in `Archivio`.
Conviene fare lo stesso su `hash_dedup`, che può capitare sia composto di sole
cifre e verrebbe convertito in notazione scientifica.

**Convalida.** Sulla colonna `categoria` si può impostare una convalida dati
con elenco da intervallo puntato al foglio `Categorie`: protegge dagli errori
di battitura nelle correzioni manuali.

**Archiviazione.** A inizio anno, sposta le righe dell'anno chiuso da
`Transazioni` ad `Archivio`. Le letture correnti si alleggeriscono e nulla si
perde: i confronti storici leggono entrambi i fogli.
