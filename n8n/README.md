# Leroy — workflow n8n

Quindici workflow, in sei gruppi. La fonte di verità è
l'istanza n8n: in questa cartella non ci sono più gli export JSON (vanno
riesportati dall'istanza quando servono). Il punto di ripristino delle
versioni sta in [`backup/`](backup/BACKUP_2026-10-22.md).

| Gruppo | Workflow |
|---|---|
| Ingestione | `Leroy_Gmail`, `Leroy_Outlook`, `Leroy android` |
| Elaborazione | `Leroy Processa Dati` |
| Interazione | `Telegram_leroy`, `Leroy App`, `Leroy Search`, `Leroy Chiedi` |
| Sorveglianza | `Leroy_Guardiano`, `Attese non avverate`, `Report periodico` |
| Manutenzione | `Archivia` |
| Servizio | `Leroy Scrivi`, `Leroy Config`, `Leroy LLM` |

`Leroy Search`, `Leroy Chiedi`, `Leroy Scrivi`, `Leroy Config`, `Leroy LLM` e
`Leroy Processa Dati` non hanno un trigger proprio: li chiamano gli altri.

---

## Dove stanno i dati

Tutto lo stato vive nelle **data table di n8n**. Sono quattro.

| Data table | Contiene | Colonne |
|---|---|---|
| `Transactions` | ogni movimento, in qualunque stato | `data_evento` · `data_inserimento` · `fonte` · `tipo` · `importo` · `valuta` · `conto` · `esercente` · `categoria` · `sottocategoria` · `note` · `testo_grezzo` · `hash_dedup` · `confidenza` · `stato` |
| `Category` | l'elenco chiuso delle categorie e i budget | `categoria` · `tipo` · `budget_mensile` |
| `Rules` | le regole di categorizzazione apprese dal bot | `pattern` · `categoria` · `conto` · `creata_il` · `utilizzi` |
| `log` | tracce diagnostiche, oggi solo i duplicati scartati | `livello` · `messaggio` |

`Category` non ha più le statistiche storiche (`n_transazioni`, `totale`,
`media`, `media_mensile`): erano ferme all'import e nessun workflow le leggeva.
I confronti con le abitudini li calcola `Report periodico` al volo.

Il **Google Sheet** è una copia di sicurezza, scritta ogni notte da `Archivia`
e da nessun altro. Nessun workflow lo legge. Se il foglio sparisce il sistema
continua a funzionare; se sparisce una data table si riparte dal foglio.

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
recuperabile.

### Letture filtrate

Nessun workflow scarica più l'intera tabella per scremarla in JavaScript:
le data table filtrano sul server (uguaglianza, `like`, `gte`/`lte` su stringhe
ISO, ordinamento per `id`). Ogni lettura prende soltanto ciò che le serve:

| Dove | Cosa legge |
|---|---|
| `Leroy Scrivi` | l'hash cercato, le righe `attesa`, le ultime 300 righe |
| `Leroy Search` | stato, intervallo di date, categoria e tipo nella query |
| `Leroy App` | `riepilogo`: il periodo richiesto più le attese · `andamento`: gli ultimi 13 mesi · `movimenti`: il periodo |
| `Leroy_Guardiano` | gli ultimi 60 giorni più `da_verificare` e `attesa` |
| `Report periodico` | dall'inizio dell'anno scorso più `attesa` e `da_verificare`, e solo il primo del mese e il lunedì |

---

## L'impianto

```
Leroy_Gmail    ─┐
Leroy_Outlook  ─┼──→  Leroy Processa Dati ──→ Leroy Scrivi ──→ Transactions · log
Leroy android  ─┘                                                  ↑
                                                                   │
Telegram_leroy ─┬── scrive ──→ Leroy Scrivi (modo diretto) ────────┤
Leroy App      ─┘                                                  │
Telegram_leroy ──→ Leroy Chiedi ─┐                                 │
Leroy App ───────────────────────┴──→ Leroy Search (sola lettura) ─┘

Guardiano · Attese non avverate · Report periodico  ──→  Telegram
Archivia  ──→  Google Sheet (backup)
Leroy Config  ← chat id, utente, conti, finestre (letto da quasi tutti)
Leroy LLM     ← unica uscita verso il modello (Processa Dati, Telegram_leroy, Leroy Chiedi)
```

Gli ingestori sono sottili e specializzati; l'elaborazione è unica e condivisa.
**Aggiungere una fonte costa tre nodi.** Un ingestore fa una cosa sola:
prendere ciò che arriva da un canale e tradurlo in una struttura comune.

### Leroy Config

Un sotto-workflow di un nodo che restituisce l'elemento in ingresso con in più
la chiave `cfg`:

| Chiave | Valore |
|---|---|
| `cfg.chat_id` | chat Telegram del destinatario |
| `cfg.utente_id` | utente autorizzato a scrivere al bot |
| `cfg.fuso` | `Europe/Rome` |
| `cfg.conti` · `cfg.conto_default` | conti ammessi e predefinito |
| `cfg.finestre` | tolleranze della deduplica (vedi `Leroy Scrivi`) |

Il chat id non è più scritto nei nodi Telegram: si cambia in un solo posto. Lo
chiamano `Telegram_leroy` (subito dopo il trigger), `Leroy Processa Dati`,
`Leroy_Guardiano`, `Attese non avverate`, `Report periodico` e `Leroy Scrivi`.

Una conseguenza da ricordare: `Leroy_Guardiano` per avvisarti di un guasto
chiama `Leroy Config`. Se fosse proprio quello a rompersi, l'allerta non parte.

### Leroy LLM

L'**unica uscita verso il modello linguistico**. Riceve `body_json` — il corpo di
una richiesta `generateContent` già costruito dal chiamante — e restituisce la
risposta del modello nella stessa forma (`candidates[0].content.parts[0].text`).
Modello, credenziale, tentativi (tre, a cinque secondi l'uno dall'altro) e
gestione dell'errore stanno solo qui: se la chiamata fallisce restituisce
l'oggetto d'errore invece di una risposta, e il chiamante decide che fare.

Lo chiamano `Leroy Processa Dati`, `Telegram_leroy` e `Leroy Chiedi`, ciascuno
nel nodo che si chiama ancora `Gemini` o `Gemini domanda`: il nome è rimasto
perché il codice a valle legge `$('Gemini')`. Costruiscono il prompt e leggono
la risposta da sé; il contratto è volutamente quello di Gemini, così cambiare
fornitore significa tradurre richiesta e risposta dentro questo workflow, senza
toccare i tre chiamanti.

---

## Ingestione

### `Leroy_Gmail` · `Leroy_Outlook` · `Leroy android`

Gmail e Outlook leggono le rispettive caselle con polling al minuto — Gmail
filtrando per etichetta, Outlook tenendo soltanto i mittenti noti — ed
estraggono il testo degli eventuali allegati PDF. A fine corsa marcano il
messaggio come lavorato (etichetta rimossa su Gmail, spostamento di cartella su
Outlook): è ciò che impedisce di rielaborarlo.

Il filtro dei mittenti di Outlook guarda il **dominio**, per etichette intere:
`octopus` vale per `octopusenergy.it`, ma `eni` non lascia più passare `menu.it`.

`Leroy android` riceve via webhook autenticato il testo delle notifiche
bancarie inoltrate dal telefono e scarta subito quelle prive di un importo e le
prove di MacroDroid con i segnaposto non sostituiti. L'`id_esterno` include il
timestamp della notifica: due acquisti identici nello stesso giorno restano
distinti, mentre un reinvio della stessa notifica (stesso timestamp) viene
riconosciuto come duplicato.

Tutti e tre terminano richiamando l'elaborazione condivisa con gli stessi sei
campi: `fonte`, `id_esterno`, `mittente`, `oggetto`, `testo`, `data`.

---

## Elaborazione

### `Leroy Processa Dati`

Riceve la struttura comune ed esegue in sequenza: estrazione, categorizzazione,
verifica di plausibilità, distinzione fra annuncio e addebito, scrittura (tramite
`Leroy Scrivi`), notifica.

L'estrazione procede per livelli. Prima gli estrattori deterministici, legati al
singolo mittente (oggi PayPal), gratuiti e sempre identici a se stessi. Poi una
ricerca generica del totale ancorata alle formule ricorrenti dei documenti
italiani. Solo per ciò che resta si chiama Gemini, al quale vengono comunque
passati gli indizi già raccolti. Riconoscere il mittente ma non il formato non è
un motivo per scartare la mail: si passa all'AI.

**Le regole apprese valgono qui come su Telegram.** Prima della validazione si
cerca in `Rules` un pattern nell'esercente o nell'oggetto: se la categoria della
regola esiste ancora, vince su quella di Gemini e, se l'importo non ha avvisi, la
confidenza sale ad almeno 0,9. A ogni uso `utilizzi` cresce di uno.

Ogni risposta del modello viene verificata contro dati reali: la categoria deve
esistere in `Category`, l'importo deve essere coerente con quanto trovato nel
testo, e un annuncio deve avere una data futura — altrimenti viene trattato come
un addebito già avvenuto. Se qualcosa non torna, il movimento entra comunque ma
marcato `da_verificare`, con l'indicazione di cosa non convinceva. Le date sono
giorni di calendario a Roma.

Un messaggio che **non è una transazione** non restituisce più una lista vuota:
emette un esito `ignora`. Serve ai chiamanti, che altrimenti non vedrebbero
nessun output e non marcherebbero la mail come lavorata. Lo stesso vale quando
non c'è nulla da notificare (duplicato scartato).

### `Leroy Scrivi`

L'**unico scrittore** su `Transactions`. Riceve `{ riga, avviso, modo }`, dove
`modo` è `pipeline` (mail e push, il predefinito) oppure `diretto` (Telegram e
app).

1. **Valida**: importo positivo, hash presente, `data_evento` in formato ISO.
2. **Cerca**: per `hash_dedup`, le righe `attesa`, le ultime 300 righe.
3. **Decide**:
   - hash già presente → **scarta** (in ogni modo);
   - modo `diretto` → **scrive** sempre, segnalando `duplicato_sospetto` se c'è
     una riga molto simile nelle sei ore precedenti;
   - modo `pipeline` → **scarta** un duplicato, **riconcilia** un'attesa
     annunciata prima, oppure **scrive** una riga nuova.
4. **Risponde** con `esito` (`scritta`, `riconciliata`, `scartata`, `errore`),
   `motivo`, `testo` (il messaggio Telegram già pronto), `duplicato_sospetto`,
   `hash`, `riga`.

Le finestre di tolleranza vengono da `Leroy Config`: sei ore fra canali
diversi, tre minuti per un reinvio dello stesso canale, dodici giorni di scarto
sulla data di un'attesa, due centesimi sull'importo. I duplicati scartati
finiscono nella data table `log`; non generano notifica.

Limite noto: se due canali segnalano lo stesso addebito nello stesso istante,
entrambi leggono prima che uno dei due abbia scritto. La finestra è piccola ma
non nulla.

---

## Interazione

### `Telegram_leroy`

Il bot. Subito dopo il trigger chiama `Leroy Config`; `sono io?` confronta
l'utente con `cfg.utente_id` e respinge gli altri.

I messaggi scritti a mano diventano una riga: l'importo, il conto, l'eventuale
esercente dopo `@`. La categoria si decide prima con le regole locali di `Rules`
(la categoria della regola deve esistere per quel tipo di movimento), solo se
nessuna corrisponde si chiama Gemini. La riga si scrive con `Leroy Scrivi` in
modo `diretto`. Quando la categoria resta incerta il bot propone dei bottoni, e
la risposta diventa una nuova riga in `Rules`.

La tastiera ha una griglia fissa di 11 righe (10 coppie di categorie più "Va
bene così"): torna solo con esattamente **20 categorie** per quel tipo. Con un
numero diverso — ad esempio per le entrate, che sono 3 — si invia un messaggio
senza bottoni che rimanda all'app. Chi cambia il numero delle categorie di spesa
deve cambiare anche questo nodo.

Le **domande in italiano** le riconosce prima dell'importo e le passa a
`Leroy Chiedi`. Lo stesso trigger raccoglie i `callback_query`: anche i bottoni
prodotti da `Attese non avverate` tornano qui.

### `Leroy Chiedi`

Riceve `{ testo }`, lo traduce con Gemini in un filtro strutturato (periodo,
categoria, tipo, importi, parole chiave, tipo di aggregazione), lo valida campo
per campo — la categoria deve esistere, le date devono essere ISO, un intervallo
invertito viene raddrizzato, un filtro vuoto viene rifiutato — poi chiama
`Leroy Search` e restituisce `{ text }` già formattato per Telegram, con in
fondo ciò che il modello ha capito.

### `Leroy App`

Un unico endpoint POST autenticato che espone i dati alla PWA, con il campo
`azione` che seleziona l'operazione:

| `azione` | Effetto |
|---|---|
| `riepilogo` | totali del periodo, per categoria, con budget e attese aperte |
| `movimenti` | elenco filtrato per periodo |
| `cerca` | delega a `Leroy Search` (anche `min`, `max`, `limite`) |
| `andamento` | serie a dodici mesi (escluse eliminate e attese) |
| `inserisci` | nuova riga, tramite `Leroy Scrivi` in modo `diretto` |
| `correggi` | aggiorna importo, categoria e stato per `hash_dedup` |
| `elimina` | porta lo stato a `eliminata` |
| `budget` | aggiorna `budget_mensile` in `Category` |

Un'azione non riconosciuta cade sul ramo di errore. Contratto completo in
[`../docs/api.md`](../docs/api.md).

### `Leroy Search`

Sotto-workflow senza trigger proprio e senza scritture. Riceve `q`, `da`, `a`,
`categoria`, `tipo`, `min`, `max`, `limite` — **tutti come stringhe**; i valori
vuoti, `null` o assenti sono ignorati. Restituisce totale, conteggio,
ripartizione per categoria ed elenco. Le righe `eliminata` e `attesa` sono
escluse a monte. La ricerca testuale richiede che **tutte** le parole compaiano
fra esercente, note, categoria e conto.

---

## Sorveglianza

Questo gruppo non produce dati: produce fiducia.

### `Leroy_Guardiano`

Due trigger nello stesso workflow.

Il primo è un **Error Trigger**: va designato nelle impostazioni di ogni altro
workflow e riceve i fallimenti. Notifica su Telegram con un silenzio di mezz'ora
per workflow, tenuto nella static data.

Il secondo è schedulato (ogni giorno alle 11) e sorveglia tre cose: le fonti
silenziose da più giorni del previsto (un `push` per 7 giorni, `gmail` e
`outlook` per 30), i movimenti `da_verificare` che si accumulano, le attese
scadute da oltre dieci giorni. Una fonte senza alcun movimento negli ultimi 60
giorni viene segnalata. Tace quando tutto va bene.

### `Attese non avverate`

Ogni mattina alle 9 cerca le righe `attesa` la cui data prevista è passata da
più di tre giorni e le segnala con due bottoni: registrarle comunque, oppure
annullarle. Al massimo cinque per volta. Non ha memoria: se ignori le prime
cinque, ogni mattina tornano le stesse.

### `Report periodico`

Parte ogni giorno alle 20, ma un controllo iniziale lascia passare solo il primo
del mese e il lunedì; negli altri giorni non legge nulla. Il mensile ha la
precedenza quando le due date coincidono. Il settimanale confronta la spesa con
la media delle quattro settimane precedenti e segnala le categorie che corrono
più in fretta del proprio budget; il mensile mette ogni categoria accanto alla
propria **mediana** degli ultimi dodici mesi, perché una singola spesa
straordinaria non faccia sembrare normale un mese che non lo è.

---

## Manutenzione

### `Archivia`

Ogni notte alle 3 copia le data table sul Google Sheet `Leroy_Data`.

| Data table | Foglio | Come |
|---|---|---|
| `Transactions` | `Transazioni` | aggiorna **per `id`** le righe modificate negli ultimi 2 giorni; la domenica tutte |
| `Rules` | `Regole` | legge, poi svuota, poi riscrive |
| `log` | `Log` | legge, poi svuota, poi riscrive |
| `Category` | `Categorie` | legge, poi svuota, poi riscrive (i budget stanno qui) |

Le righe di `Transactions` non vengono più cancellate dal foglio prima della
riscrittura: se il flusso si ferma a metà il backup resta com'era. Per le tre
tabelle piccole la lettura avviene **prima** dello svuotamento, quindi un errore
di lettura non lascia più un foglio vuoto; resta soltanto la finestra fra lo
svuotamento e la riscrittura, di pochi secondi.

---

## Ricreare l'impianto

I workflow non sono più in questa cartella. Per ricrearli: esporta i JSON
dall'istanza (menu del workflow → *Download*), poi

1. crea le quattro data table con le colonne elencate sopra, **prima** di
   importare: i nodi risolvono le colonne al caricamento;
2. popola `Category` con l'elenco delle categorie (è chiuso: una categoria che
   non c'è viene rifiutata dalla validazione);
3. ricollega le credenziali, che non vengono esportate;
4. attiva prima `Leroy Config`, `Leroy Scrivi`, `Leroy Search`, `Leroy Chiedi` e
   `Leroy Processa Dati`, poi tutto il resto: un richiamo verso un workflow
   inattivo fallisce;
5. imposta `Leroy_Guardiano` come *Error Workflow* in ogni altro workflow
   tranne che nel guardiano stesso.

Il tuo chat id e l'utente autorizzato si cambiano in `Leroy Config`.
Il resto dei valori fissi sono gli id delle data table e del foglio, che nei
nodi compaiono in modalità "lista".

Nota: n8n non richiama l'Error Workflow per le esecuzioni **manuali**. Per
provare che funzioni serve un fallimento partito da un trigger vero.

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
applicazioni in stato di test hanno un token di aggiornamento che scade dopo una
settimana. Ricorda di condividere il foglio con l'indirizzo del service account.
Per Gmail il service account non è utilizzabile su una casella personale: serve
OAuth, e l'applicazione va portata in produzione per lo stesso motivo.

Se non ti interessa il backup, `Archivia` è l'unico workflow da non attivare e
la credenziale Google diventa superflua.
