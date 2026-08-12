# Leroy — workflow n8n

Undici workflow, in cinque gruppi.

| Gruppo | Workflow |
|---|---|
| Ingestione | `Leroy_Gmail`, `Leroy_Outlook`, `Leroy android` |
| Elaborazione | `Leroy Processa Dati` |
| Interazione | `Telegram_leroy`, `Leroy App`, `Leroy Search` |
| Sorveglianza | `Leroy_Guardiano`, `Attese non avverate`, `Report periodico` |
| Manutenzione | `Archivia` |

---

## Dove stanno i dati

Tutto lo stato del sistema vive nelle **data table di n8n**. Sono quattro.

| Data table | Contiene | Colonne |
|---|---|---|
| `Transactions` | ogni movimento, in qualunque stato | `data_evento` · `data_inserimento` · `fonte` · `tipo` · `importo` · `valuta` · `conto` · `esercente` · `categoria` · `sottocategoria` · `note` · `testo_grezzo` · `hash_dedup` · `confidenza` · `stato` |
| `Category` | l'elenco chiuso delle categorie e i budget | `categoria` · `tipo` · `n_transazioni` · `totale` · `media` · `media_mensile` · `budget_mensile` |
| `Rules` | le regole di categorizzazione apprese dal bot | `pattern` · `categoria` · `conto` · `creata_il` · `utilizzi` |
| `log` | tracce diagnostiche, oggi solo i duplicati scartati | `livello` · `messaggio` |

Il **Google Sheet non è più il database**: è una copia di sicurezza, riscritta
una volta al giorno da `Archivia` e da nessun altro. Nessun workflow lo legge.
Se il foglio sparisce, il sistema continua a funzionare; se sparisce una data
table, si riparte dal foglio.

La differenza pratica rispetto a prima è che le letture non passano più da una
API esterna a quota limitata, quindi i workflow possono filtrare sul server
(`stato`, `fonte`, `hash_dedup`) invece di scaricare tutto il foglio e
scremarlo in JavaScript.

Il campo che tiene insieme tutto è `hash_dedup`: è la chiave con cui ogni
aggiornamento successivo — conferma, riconciliazione, correzione,
eliminazione — ritrova la sua riga.

Gli stati possibili di una riga:

| Stato | Significato |
|---|---|
| `confermata` | movimento avvenuto e ritenuto affidabile |
| `da_verificare` | scritto, ma qualcosa non tornava (importo ambiguo o categoria non valida) |
| `attesa` | addebito soltanto annunciato, non ancora avvenuto |
| `eliminata` | cancellato dall'app; resta in tabella ma esce da ogni conteggio |

Le eliminazioni sono logiche, non fisiche: una riga cancellata per errore è
recuperabile, e la cronologia degli invii resta coerente.

---

## L'impianto

Gli ingestori sono sottili e specializzati; l'elaborazione è unica e condivisa.

```
Leroy_Gmail    ─┐
Leroy_Outlook  ─┼──→  Leroy Processa Dati  ──→  Transactions
Leroy android  ─┘

Telegram_leroy ──→  (logica propria)  ──→  Transactions · Rules
Leroy App      ──→  (logica propria)  ──→  Transactions · Category

Telegram_leroy ─┬──→  Leroy Search  ──→  Transactions (sola lettura)
Leroy App      ─┘

Guardiano · Attese non avverate · Report periodico  ──→  Telegram

Archivia  ──→  Google Sheet (backup)
```

Un ingestore fa una cosa sola: prendere ciò che arriva da un canale e
tradurlo in una struttura comune. Non sa cosa succederà dopo, non contiene
regole di categorizzazione, non scrive niente.

L'elaborazione riceve quella struttura e non sa da dove venga. Estrae i dati,
categorizza, verifica, deduplica, scrive, notifica.

La conseguenza pratica: **aggiungere una fonte costa tre nodi**. Outlook è
stato aggiunto dopo Gmail senza toccare una riga della logica condivisa.

Lo stesso principio vale per la ricerca. `Leroy Search` è un sotto-workflow
senza trigger proprio: riceve un filtro, restituisce totale, conteggio,
ripartizione per categoria ed elenco. Lo chiamano sia l'app che il bot, così
la domanda scritta in italiano su Telegram e il campo di ricerca della PWA
danno per costruzione lo stesso numero.

---

## Ingestione

### `Leroy_Gmail` · `Leroy_Outlook` · `Leroy android`

Gmail e Outlook leggono le rispettive caselle con polling al minuto — Gmail
filtrando per etichetta, Outlook per cartella — ed estraggono il testo degli
eventuali allegati PDF prima di passare oltre. A fine corsa marcano il
messaggio come lavorato (etichetta rimossa su Gmail, spostamento di cartella
su Outlook), che è ciò che impedisce di rielaborarlo al giro successivo.

`Leroy android` riceve via webhook autenticato il testo delle notifiche
bancarie inoltrate dal telefono, e scarta subito quelle prive di un importo.

Tutti e tre terminano richiamando l'elaborazione condivisa con gli stessi sei
campi: `fonte`, `id_esterno`, `mittente`, `oggetto`, `testo`, `data`.

---

## Elaborazione

### `Leroy Processa Dati`

Il cuore. Riceve la struttura comune ed esegue in sequenza: estrazione,
categorizzazione, verifica di plausibilità, distinzione fra annuncio e
addebito, controllo duplicati, scrittura, notifica.

L'estrazione procede per livelli. Prima gli estrattori deterministici, legati
al singolo mittente, che sono gratuiti e sempre identici a se stessi. Poi una
ricerca generica del totale ancorata alle formule ricorrenti dei documenti
italiani. Solo per ciò che resta si chiama il modello linguistico, al quale
vengono comunque passati gli indizi già raccolti: il totale ancorato, gli
altri importi trovati nel testo, l'eventuale data di scadenza.

Riconoscere il mittente ma non il formato non è un motivo per scartare la
mail: si passa comunque all'AI, perché i template cambiano senza preavviso.

Ogni risposta del modello viene verificata contro dati reali: la categoria
deve esistere in `Category`, l'importo deve essere coerente con quanto trovato
nel testo, e un annuncio deve avere una data futura — altrimenti viene
trattato come un addebito già avvenuto, qualunque cosa dica il modello. Se
qualcosa non torna, il movimento entra ugualmente ma marcato `da_verificare`,
con l'indicazione di cosa non convinceva.

Il controllo finale decide fra tre esiti: **scartare** un duplicato,
**riconciliare** un addebito annunciato in precedenza, o **scrivere** una riga
nuova. Le finestre di tolleranza sono dichiarate in testa al nodo: sei ore fra
canali diversi, tre minuti per un reinvio dello stesso canale, dodici giorni
di scarto ammesso sulla data di un'attesa, due centesimi sull'importo.

I duplicati scartati finiscono nella data table `log`. Non generano una
notifica — sarebbero rumore — ma restano leggibili se un giorno un movimento
manca all'appello e serve capire perché.

---

## Interazione

### `Telegram_leroy`

Il bot. Riceve messaggi scritti a mano, li interpreta, scrive la riga e
risponde. La categoria si decide prima con le regole locali di `Rules`, che
sono gratuite e istantanee; solo se nessuna corrisponde si chiama il modello.
Quando la categoria resta incerta il bot propone dei bottoni, e la risposta
diventa una nuova riga in `Rules`: è il workflow che alimenta il meccanismo di
apprendimento del sistema.

Gestisce anche le **domande in italiano**. Il riconoscimento avviene prima di
quello dell'importo, altrimenti una frase come "quanto ho speso per i tre
caffè" verrebbe registrata come una spesa. Il modello traduce la domanda in un
filtro strutturato, che viene validato campo per campo — la categoria deve
esistere, le date devono essere ISO, un intervallo invertito viene raddrizzato
— e poi passato a `Leroy Search`. Un filtro completamente vuoto viene
rifiutato: restituirebbe tutto lo storico spacciandolo per una risposta.

Lo stesso trigger raccoglie i `callback_query`, quindi anche i bottoni
prodotti da `Attese non avverate` tornano qui: registrare o annullare
un'attesa scaduta è un aggiornamento di `stato` sulla riga con quel
`hash_dedup`.

### `Leroy App`

Un unico endpoint POST autenticato che espone i dati alla PWA, con il campo
`azione` che seleziona l'operazione:

| `azione` | Effetto |
|---|---|
| `riepilogo` | totali del periodo, per categoria, con budget |
| `movimenti` | elenco filtrato per periodo |
| `cerca` | delega a `Leroy Search` |
| `andamento` | serie a dodici mesi |
| `inserisci` | nuova riga in `Transactions` |
| `correggi` | aggiorna importo, categoria e stato per `hash_dedup` |
| `elimina` | porta lo stato a `eliminata` |
| `budget` | aggiorna `budget_mensile` in `Category` |

Un'azione non riconosciuta cade sul ramo di errore invece di restituire una
risposta vuota che il client interpreterebbe come "nessun dato".

L'aggregazione avviene qui, non sul client: ha senso restituire poche decine
di numeri anziché migliaia di righe, anche adesso che leggere non costa più
una chiamata a Google.

Contratto completo in [`../docs/api.md`](../docs/api.md).

### `Leroy Search`

Nessun trigger, nessuna scrittura. Riceve `q`, `da`, `a`, `categoria`, `tipo`,
`min`, `max` e restituisce l'aggregato. Le righe `eliminata` e `attesa` sono
escluse a monte: non sono spese avvenute e falserebbero ogni totale.

La ricerca testuale richiede che **tutte** le parole compaiano da qualche
parte fra esercente, note, categoria e conto — cercando "bar michele" non
voglio tutti i bar.

---

## Sorveglianza

Questo gruppo non produce dati: produce fiducia. Serve a sapere che il sistema
sta funzionando, invece di sperarlo.

### `Leroy_Guardiano`

Due trigger nello stesso workflow.

Il primo è un **Error Trigger**: va designato nelle impostazioni di ogni altro
workflow, e riceve i fallimenti. Notifica su Telegram, con un silenzio di
mezz'ora per workflow — senza, un guasto su un flusso schedulato al minuto
genererebbe più di mille messaggi al giorno e finiresti per silenziare il bot,
che è l'opposto di quello che serve. Il silenzio è tenuto nella static data
del workflow, quindi sopravvive fra un'esecuzione e l'altra.

Il secondo è **schedulato** (ogni giorno alle 11) e sorveglia tre cose: le
fonti silenziose da più giorni del previsto, i movimenti `da_verificare` che
si accumulano senza che nessuno li guardi, e le attese scadute da oltre dieci
giorni. Telegram e app non sono sorvegliate: sei tu a scriverle, il silenzio è
normale.

Tace quando tutto va bene — un messaggio quotidiano che dice "ok" verrebbe
ignorato dopo tre giorni — e la conferma che sia vivo arriva dal report
settimanale, che chiude con lo stato delle fonti.

### `Attese non avverate`

Ogni mattina alle 9 cerca le righe in stato `attesa` la cui data prevista è
passata da più di tre giorni, e le segnala con due bottoni: registrarle
comunque, oppure annullarle. Al massimo cinque per volta, per non trasformare
un arretrato in un bombardamento.

Copre il caso in cui la conferma non arriva mai. Senza, una spesa annunciata e
mai riconciliata resterebbe fuori dai conti in silenzio.

### `Report periodico`

Un trigger giornaliero alle 20, due formati. Il primo del mese produce la
chiusura del mese precedente; il lunedì, il riepilogo della settimana. Il
mensile ha la precedenza quando le due date coincidono, così non ricevi due
messaggi in fila un paio di volte l'anno.

Il settimanale confronta la spesa con la media delle quattro settimane
precedenti e segnala le categorie che stanno correndo più in fretta del
proprio budget, proporzionato ai giorni già trascorsi nel mese. Il mensile
mette ogni categoria accanto alla propria mediana degli ultimi dodici mesi: il
confronto più utile non è col budget ma con te stesso. La mediana serve a
evitare che una singola spesa straordinaria faccia sembrare normale un mese
che non lo è.

---

## Manutenzione

### `Archivia`

Ogni notte alle 3 riversa le data table su un Google Sheet. Per ciascuna:
svuota il foglio tenendo l'intestazione, rilegge la tabella, riscrive tutto.

| Data table | Foglio |
|---|---|
| `Transactions` | `Transazioni` |
| `Rules` | `Regole` |
| `log` | `Log` |

È un backup, non un archivio: il foglio è sempre una copia completa dello
stato corrente, non la parte vecchia che è stata tolta di mezzo. Nessun altro
workflow lo legge, e nessuna logica dipende da lui.

Svuotare prima di riscrivere significa che, se il flusso si interrompe a metà,
il foglio resta parziale fino alla notte successiva. È accettabile per un
backup di secondo livello, ma è il motivo per cui non va usato come fonte di
verità.

`Category` **non** viene copiata: contiene i budget, che si impostano dall'app
e cambiano di rado. Se ti serve anche quella, è un blocco di tre nodi in più,
identico agli altri.

---

## Importare i workflow

1. In n8n: menu del workflow → *Import from File*
2. Crea le quattro data table (`Transactions`, `Category`, `Rules`, `log`) con
   le colonne elencate sopra, **prima** di aprire i workflow: i nodi Data
   Table risolvono le colonne al caricamento
3. Popola `Category` con l'elenco delle categorie. È un elenco chiuso: una
   categoria che non c'è viene rifiutata dalla validazione, e il movimento
   nasce `da_verificare`
4. Ricollega le credenziali, che non vengono esportate
5. Sostituisci i placeholder elencati sotto
6. Attiva prima `Leroy Processa Dati` e `Leroy Search`, poi tutto il resto: un
   richiamo verso un workflow inattivo fallisce
7. Nelle impostazioni di ogni workflow, imposta `Leroy_Guardiano` come *Error
   Workflow* — tranne che nel guardiano stesso. Se ne salti uno, i suoi errori
   restano invisibili

Nota: n8n non richiama l'Error Workflow per le esecuzioni **manuali**. Per
provare che funzioni serve un fallimento partito da un trigger vero.

## Cosa è stato rimosso

| Campo | Azione |
|---|---|
| `webhookId` | rimosso — n8n lo rigenera automaticamente all'import |
| `meta.instanceId` | rimosso |

## Cosa è stato sostituito

| Placeholder | Cosa devi rimettere |
|---|---|
| `DATATABLE_TRANSACTIONS` · `DATATABLE_CATEGORY` | id delle data table `Transactions` e `Category` |
| `PROJECT_ID` | id del progetto n8n che contiene le data table |
| `YOUR_GOOGLE_SHEET_ID` | id del foglio di backup in `Archivia.json` (18 occorrenze) |
| `YOUR_OUTLOOK_FOLDER_ID` | id cartella "Elaborate da Leroy" in `Leroy_Outlook.json` |
| `YOUR_GMAIL_LABEL_ID` | id etichetta Gmail in `Leroy_Gmail.json` |
| `PATH` | path dei webhook in `Leroy_App.json` e `Leroy_android.json` |
| `CRED_TELEGRAM` · `CRED_GMAIL` · `CRED_OUTLOOK` · `CRED_GOOGLE_SERVICE_ACCOUNT` · `CRED_GEMINI` · `CRED_HEADER_AUTH_ANDROID` | id delle credenziali n8n |
| `WF_PROCESSA_DATI` · `WF_SEARCH` · `WF_GUARDIANO` · `WF_TELEGRAM` · `WF_APP` · `WF_GMAIL` · `WF_OUTLOOK` · `WF_ANDROID` · `WF_ARCHIVIA` · `WF_ATTESE` · `WF_REPORT_PERIODICO` | id dei workflow |

### Valori rimasti espliciti

Due cose non sono state trasformate in placeholder e vanno cambiate a mano.

Gli id delle data table `Rules` e `log` compaiono in chiaro: `WL0zzKbwnzieSs6y`
(6 occorrenze, in `Telegram_leroy.json` e `Archivia.json`) e `beloXwMTxcj50rGi`
(4 occorrenze, in `Leroy_Processa_Dati.json` e `Archivia.json`).

Il **chat id Telegram** del destinatario è scritto nei workflow che notificano:
`Telegram_leroy`, `Leroy_Guardiano`, `Leroy Processa Dati`, `Report periodico`,
`Attese non avverate`. In quest'ultimo compare due volte, una nel nodo Telegram
e una in testa al codice.

---

## Credenziali necessarie

| Credenziale | Serve a |
|---|---|
| Telegram API | bot: ricezione e invio |
| Gmail OAuth2 | lettura della casella Gmail |
| Microsoft Outlook OAuth2 | lettura della casella Outlook |
| Query Auth | chiave del modello linguistico (Gemini) |
| Header Auth | protezione dei webhook in ingresso (app e android) |
| Google Sheets (service account) | **solo** `Archivia`: scrittura del backup |

Per Google Sheets conviene un **service account** anziché OAuth: le
applicazioni in stato di test hanno un token di aggiornamento che scade dopo
una settimana, e il backup si romperebbe con cadenza settimanale. Ricorda di
condividere il foglio con l'indirizzo del service account.

Per Gmail il service account non è utilizzabile su una casella personale:
serve OAuth, e l'applicazione va portata in produzione per lo stesso motivo.

Se non ti interessa il backup, `Archivia` è l'unico workflow da non attivare e
la credenziale Google diventa superflua: tutti gli altri girano senza.
