# Leroy — workflow n8n

Sette workflow. Cinque raccolgono e processano i movimenti, uno sorveglia gli
addebiti annunciati, uno espone l'API che alimenta la PWA.

---

## L'impianto

Gli ingestori sono sottili e specializzati; l'elaborazione è unica e condivisa.

```
Ingest Gmail    ─┐
Ingest Outlook  ─┼──→  Processa movimento  ──→  Google Sheet
Ingest push     ─┘

Telegram         ──→  (logica propria)  ──→  Google Sheet
API app          ──→  (logica propria)  ──→  Google Sheet
Controllo attese ──→  (schedulato)      ──→  Telegram
```

Un ingestore fa una cosa sola: prendere ciò che arriva da un canale e
tradurlo in una struttura comune. Non sa cosa succederà dopo, non contiene
regole di categorizzazione, non scrive niente.

L'elaborazione riceve quella struttura e non sa da dove venga. Estrae i dati,
categorizza, verifica, deduplica, scrive, notifica.

La conseguenza pratica: **aggiungere una fonte costa tre nodi**. Outlook è
stato aggiunto dopo Gmail senza toccare una riga della logica condivisa.

Telegram e l'API restano separati perché non elaborano testo grezzo: ricevono
dati già strutturati da una persona, quindi il percorso è più corto.

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

## I workflow

### `telegram`

Il bot. Riceve messaggi scritti a mano, li interpreta, scrive la riga e
risponde. Quando la categoria è incerta propone dei bottoni, e la risposta
diventa una regola permanente.

È il workflow che alimenta il meccanismo di apprendimento del sistema.

### `ingest-gmail` · `ingest-outlook` · `ingest-push`

I tre ingestori. Gmail e Outlook leggono le rispettive caselle filtrando per
mittente; l'ingestore push riceve via webhook il testo delle notifiche
bancarie inoltrate dal telefono.

Tutti e tre terminano richiamando l'elaborazione condivisa.

### `processa-movimento`

Il cuore. Riceve la struttura comune ed esegue in sequenza: estrazione,
categorizzazione, verifica di plausibilità, controllo duplicati, scrittura,
notifica.

Prima di scrivere, il workflow distingue un addebito già avvenuto da un
addebito soltanto annunciato — una bolletta con scadenza futura, una fattura da
pagare. Gli annunci vengono registrati in uno stato che non concorre ai totali;
quando l'addebito reale arriva, viene cercata l'attesa corrispondente per
importo e data prevista, e quella riga viene chiusa invece di scriverne una
nuova. Il risultato è una transazione sola, datata al giorno in cui i soldi
sono usciti, con la categoria dedotta dall'email — che conosceva il fornitore,
mentre la notifica bancaria da sola avrebbe prodotto qualcosa di generico.

L'estrazione procede per livelli. Prima gli estrattori deterministici, legati
al singolo mittente, che sono gratuiti e sempre identici a se stessi. Poi una
ricerca generica del totale ancorata alle formule ricorrenti dei documenti
italiani. Solo per ciò che resta si chiama il modello linguistico, al quale
vengono comunque passati gli indizi già raccolti.

Ogni risposta del modello viene verificata contro dati reali: la categoria
deve esistere nel foglio, l'importo deve essere coerente con quanto trovato
nel testo. Se qualcosa non torna, il movimento entra ugualmente ma marcato da
verificare, con l'avviso di cosa non convinceva.

### `controllo-attese`

Schedulato quotidianamente. Cerca gli addebiti annunciati la cui data prevista
è passata da qualche giorno senza che sia arrivato il corrispondente addebito
reale, e li segnala su Telegram con due bottoni: registrarli comunque, oppure
annullarli.

Serve a coprire il caso in cui la conferma non arriva mai — banca che invia
notifiche prive di contenuto, telefono spento, app di cattura sospesa dal
sistema. Senza, una spesa annunciata e mai riconciliata resterebbe fuori dai
conti in silenzio.

### `api-app`

Un unico endpoint che espone il foglio alla PWA, con un campo che seleziona
l'operazione: riepilogo, elenco movimenti, inserimento, correzione,
eliminazione, aggiornamento dei budget.

L'aggregazione avviene qui, non sul client: la lettura del foglio è già il
costo dominante, quindi ha senso restituire poche decine di numeri anziché
migliaia di righe.

Contratto completo in [`../docs/api.md`](../docs/api.md).

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
