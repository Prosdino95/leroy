# Leroy — workflow n8n

Dieci workflow, in quattro gruppi.

| Gruppo | Workflow |
|---|---|
| Ingestione | `ingest-gmail`, `ingest-outlook`, `ingest-push` |
| Elaborazione | `processa-movimento` |
| Interazione | `telegram`, `api-app` |
| Sorveglianza | `guardiano`, `controllo-attese`, `ricorrenti`, `report` |

---

## L'impianto

Gli ingestori sono sottili e specializzati; l'elaborazione è unica e condivisa.

```
Ingest Gmail    ─┐
Ingest Outlook  ─┼──→  Processa movimento  ──→  Google Sheet
Ingest push     ─┘

Telegram        ──→  (logica propria)  ──→  Google Sheet
API app         ──→  (logica propria)  ──→  Google Sheet

Guardiano · Controllo attese · Ricorrenti · Report  ──→  Telegram
```

Un ingestore fa una cosa sola: prendere ciò che arriva da un canale e
tradurlo in una struttura comune. Non sa cosa succederà dopo, non contiene
regole di categorizzazione, non scrive niente.

L'elaborazione riceve quella struttura e non sa da dove venga. Estrae i dati,
categorizza, verifica, deduplica, scrive, notifica.

La conseguenza pratica: **aggiungere una fonte costa tre nodi**. Outlook è
stato aggiunto dopo Gmail senza toccare una riga della logica condivisa.

---

## Il contratto fra i livelli

Ogni ingestore produce questi campi, e nient'altro:

| Campo | Contenuto |
|---|---|
| `fonte` | quale canale ha generato il movimento |
| `id_esterno` | identificatore stabile del messaggio di origine |
| `mittente` | chi lo ha inviato, o l'app che ha generato la notifica |
| `oggetto` | titolo o riga di oggetto |
| `testo` | il contenuto, in testo semplice |
| `data` | quando è avvenuto |

Se aggiungi una fonte, il lavoro è tutto qui: mappare quel canale su queste sei
chiavi. Il testo degli allegati va unito a `testo` a monte, così il contratto
resta di solo testo e l'elaborazione non deve gestire dati binari.

---

## Ingestione

### `ingest-gmail` · `ingest-outlook` · `ingest-push`

Gmail e Outlook leggono le rispettive caselle filtrando per mittente, ed
estraggono il testo degli eventuali allegati PDF prima di passare oltre.
L'ingestore push riceve via webhook autenticato il testo delle notifiche
bancarie inoltrate dal telefono, e scarta subito quelle prive di un importo.

Tutti e tre terminano richiamando l'elaborazione condivisa.

---

## Elaborazione

### `processa-movimento`

Il cuore. Riceve la struttura comune ed esegue in sequenza: estrazione,
categorizzazione, verifica di plausibilità, distinzione fra annuncio e
addebito, controllo duplicati, scrittura, notifica.

L'estrazione procede per livelli. Prima gli estrattori deterministici, legati
al singolo mittente, che sono gratuiti e sempre identici a se stessi. Poi una
ricerca generica del totale ancorata alle formule ricorrenti dei documenti
italiani. Solo per ciò che resta si chiama il modello linguistico, al quale
vengono comunque passati gli indizi già raccolti.

Ogni risposta del modello viene verificata contro dati reali: la categoria
deve esistere nel foglio, l'importo deve essere coerente con quanto trovato
nel testo, e un annuncio deve avere una data futura — altrimenti viene
trattato come un addebito già avvenuto, qualunque cosa dica il modello. Se
qualcosa non torna, il movimento entra ugualmente ma marcato da verificare,
con l'indicazione di cosa non convinceva.

Il controllo finale decide fra tre esiti: scartare un duplicato, chiudere un
addebito annunciato in precedenza, o scrivere una riga nuova.

---

## Interazione

### `telegram`

Il bot. Riceve messaggi scritti a mano, li interpreta, scrive la riga e
risponde. Quando la categoria è incerta propone dei bottoni, e la risposta
diventa una regola permanente: è il workflow che alimenta il meccanismo di
apprendimento del sistema.

Gestisce anche le **domande in italiano**. Il riconoscimento avviene prima di
quello dell'importo, altrimenti una frase come "quanto ho speso per i tre
caffè" verrebbe registrata come una spesa. Il modello traduce la domanda in un
filtro strutturato, l'aggregazione viene calcolata dallo stesso codice che
serve la ricerca dell'app, e la risposta riporta sempre l'intervallo di date
interpretato — senza, un fraintendimento sul periodo produrrebbe un numero
sbagliato dall'aria credibile.

### `api-app`

Un unico endpoint che espone il foglio alla PWA, con un campo che seleziona
l'operazione: riepilogo, elenco movimenti, ricerca, andamento a dodici mesi,
inserimento, correzione, eliminazione, aggiornamento dei budget.

L'aggregazione avviene qui, non sul client: la lettura del foglio è già il
costo dominante, quindi ha senso restituire poche decine di numeri anziché
migliaia di righe.

Le azioni che guardano indietro nel tempo — andamento e ricerca — leggono
anche il foglio di archivio, altrimenti restituirebbero zero sui periodi
vecchi senza segnalare nulla.

Contratto completo in [`../docs/api.md`](../docs/api.md).

---

## Sorveglianza

Questo gruppo non produce dati: produce fiducia. Serve a sapere che il sistema
sta funzionando, invece di sperarlo.

### `guardiano`

Due trigger nello stesso workflow.

Il primo è un **Error Trigger**: va designato nelle impostazioni di ogni altro
workflow, e riceve i fallimenti. Notifica su Telegram, con un silenzio di
mezz'ora per workflow — senza, un guasto su un flusso schedulato al minuto
genererebbe più di mille messaggi al giorno e finiresti per silenziare il bot,
che è l'opposto di quello che serve.

Questo ramo non tocca il foglio di proposito: se il guasto è proprio l'accesso
a Google, un gestore che scrive sul foglio fallirebbe anche lui.

Il secondo è **schedulato** e sorveglia le fonti: se un canale non produce
movimenti da più giorni del previsto, lo segnala. Tace quando tutto va bene —
un messaggio quotidiano che dice "ok" verrebbe ignorato dopo tre giorni — e la
conferma che sia vivo arriva dal report settimanale, che chiude con lo stato
delle fonti.

### `controllo-attese`

Cerca gli addebiti annunciati la cui data prevista è passata da qualche giorno
senza che sia arrivato il corrispondente addebito reale, e li segnala con due
bottoni: registrarli comunque, oppure annullarli.

Copre il caso in cui la conferma non arriva mai. Senza, una spesa annunciata e
mai riconciliata resterebbe fuori dai conti in silenzio.

### `ricorrenti`

Deduce gli abbonamenti dallo storico invece di farseli dichiarare: un esercente
che compare almeno tre volte a intervalli regolari è una ricorrenza. Il
criterio è la mediana degli intervalli, non la media, perché un pagamento in
ritardo isolato non deve cancellare un pattern.

Ogni giorno riscrive il foglio delle ricorrenze e segnala due cose: quelle che
non sono arrivate entro la data attesa, e quelle il cui importo è cresciuto
oltre una soglia rispetto alla propria storia.

Le ricorrenze marcate a mano come da ignorare non generano avvisi e non
vengono sovrascritte.

### `report`

Un trigger giornaliero, due formati. Il primo del mese produce la chiusura del
mese precedente; il lunedì, il riepilogo della settimana. Il mensile ha la
precedenza quando le due date coincidono, così non ricevi due messaggi in fila
un paio di volte l'anno.

Il confronto più utile non è col budget ma con te stesso: ogni categoria viene
messa accanto alla propria mediana degli ultimi dodici mesi, per far emergere
cosa è cambiato nelle abitudini. La mediana serve a evitare che una singola
spesa straordinaria faccia sembrare normale un mese che non lo è.

Anche questo workflow legge il foglio di archivio, perché i confronti con
l'anno precedente altrimenti sarebbero vuoti.

---

## Convenzioni

Poche regole, ma vanno rispettate o si producono guasti silenziosi.

**Le letture dal foglio sono impostate per eseguire una volta sola.** Senza,
un nodo di lettura viene eseguito una volta per ogni elemento in ingresso: con
qualche migliaio di transazioni significa esaurire la quota API di Google in
una singola esecuzione.

**I riferimenti ai dati sono espliciti quando c'è un nodo di mezzo.** Ogni nodo
riceve l'output di quello immediatamente precedente: se fra chi produce un
dato e chi lo consuma si inserisce una lettura dal foglio, il riferimento
implicito punta ai dati sbagliati e la cosa non genera errori, solo risultati
assurdi.

**I payload delle richieste HTTP si compongono nei nodi di codice.** Nei campi
espressione si mettono solo riferimenti. Costruire JSON dentro un campo di
configurazione produce errori che l'editor non sa spiegare.

**Le scritture sul foglio non usano l'interpretazione automatica dei valori.**
In locale italiano un importo come `6.00` verrebbe letto come un orario e
salvato come data.

**Negli aggiornamenti si mappano solo i campi che devono cambiare.** Un campo
mappato a vuoto cancella la cella. È il motivo per cui chiudendo un addebito
annunciato si aggiornano data, importo, conto, fonte e stato, ma non categoria
ed esercente: quelli li conosceva l'email, la notifica bancaria no.

**Le diramazioni si basano su dati reali, non su flag booleani.** Verificare
che un importo esista è più robusto che verificare che qualcuno abbia
impostato una variabile: il booleano può mancare, arrivare come stringa, o
essere dimenticato in un ramo.

---

## Importare i workflow

1. In n8n: menu del workflow → *Import from File*
2. Ricollega le credenziali, che non vengono esportate
3. Verifica gli identificativi dei documenti Google, che puntano al foglio
   dell'installazione originale
4. Attiva prima `processa-movimento`, poi gli ingestori: un richiamo verso un
   workflow inattivo fallisce
5. Nelle impostazioni di ogni workflow, imposta `guardiano` come *Error
   Workflow* — tranne che nel guardiano stesso. Se ne salti uno, i suoi errori
   restano invisibili

Nota: n8n non richiama l'Error Workflow per le esecuzioni **manuali**. Per
provare che funzioni serve un fallimento partito da un trigger vero.

### Attenzione ai segreti negli export

**I JSON esportati contengono i token scritti nelle URL dei nodi HTTP.** Vanno
sostituiti con dei segnaposto prima del commit, anche in una repo privata.

Prima di ogni commit vale la pena controllare:

```bash
grep -rn "bot[0-9]\{8,\}:" n8n/
```

Le credenziali vere restano solo in n8n, cifrate con la chiave di istanza.

---

## Credenziali necessarie

| Credenziale | Serve a |
|---|---|
| Telegram API | bot: ricezione e invio |
| Google Sheets (service account) | lettura e scrittura del foglio |
| Gmail OAuth2 | lettura della casella Gmail |
| Microsoft Outlook OAuth2 | lettura della casella Outlook |
| Query Auth | chiave del modello linguistico |
| Header Auth | protezione dei webhook in ingresso |

Due note che risparmiano guasti ricorrenti.

Per Google Sheets conviene un **service account** anziché OAuth: le
applicazioni in stato di test hanno un token di aggiornamento che scade dopo
una settimana, e il sistema si romperebbe con cadenza settimanale. Ricorda di
condividere il foglio con l'indirizzo del service account.

Per Gmail il service account non è utilizzabile su una casella personale:
serve OAuth, e l'applicazione va portata in produzione per lo stesso motivo.

Usa **token distinti per ciascun webhook**: revocarne uno non deve costringerti
a spegnere gli altri.
