# Leroy

Sistema di gestione delle finanze personali che raccoglie le spese in modo
automatico da più fonti, le categorizza e le rende consultabili da un'app
mobile.

Nasce per sostituire un'app di tracking manuale non automatizzabile,
mantenendo lo storico accumulato. Gira interamente su servizi con piano
gratuito: il costo di esercizio è zero.

---

## Cosa fa

Una spesa entra nel sistema senza che tu faccia nulla. La notifica della
banca, la mail di conferma di PayPal, la bolletta in PDF: ognuna di queste
diventa una riga registrata, categorizzata e consultabile.

Quello che non arriva da solo — i contanti, una spesa divisa fra amici — lo
inserisci in due secondi da un bot Telegram o dall'app.

- **Raccolta automatica** da email, notifiche Android e messaggi
- **Categorizzazione** basata su regole apprese, con un modello linguistico
  come riserva
- **Deduplica** fra fonti: la stessa spesa vista da due canali diventa una
  riga sola
- **Riconciliazione degli addebiti annunciati**: una bolletta comunicata oggi e
  addebitata fra due settimane resta una spesa sola, contata quando i soldi
  escono davvero
- **Interfaccia mobile** installabile, con riepiloghi, budget per categoria,
  inserimento rapido e correzione dei movimenti
- **Storico preservato**: i dati precedenti sono stati migrati e convivono con
  quelli nuovi

---

## Architettura

```mermaid
flowchart TD
    A[Notifiche bancarie<br/>Android] --> I1[Ingestore push]
    B[Email<br/>Gmail e Outlook] --> I2[Ingestore email]
    C[Bot Telegram] --> W1[Workflow Telegram]
    D[App mobile] --> API[API]

    I1 --> P[Elaborazione condivisa]
    I2 --> P

    P --> S[(Google Sheet)]
    W1 --> S
    API --> S

    S --> API
    API --> D
    P -.notifiche.-> C
    W1 -.conferme.-> C
```

Il sistema ha quattro strati.

**Le fonti** sono i canali da cui arrivano i movimenti. Ognuna ha un proprio
ingestore, il cui unico compito è tradurre un formato specifico — una mail,
una notifica, un messaggio — in una struttura comune.

**L'elaborazione** è condivisa: un solo componente riceve i dati normalizzati
da qualsiasi ingestore, ne estrae importo, esercente e categoria, verifica che
non sia un duplicato e scrive. Aggiungere una fonte nuova significa scrivere un
ingestore, non toccare la logica.

**Lo storage** è un Google Sheet. È una scelta deliberata: i dati restano
leggibili e modificabili anche senza il sistema, si aprono dal telefono, si
esportano in un clic. Nessun lock-in.

**Le interfacce** sono due. Il bot Telegram per l'inserimento rapido e le
conferme, e una PWA per la consultazione. La PWA non conosce lo storage: parla
con un'API che espone il foglio, quindi cambiare il database sottostante non
la toccherebbe.

### Il percorso di un movimento

1. Un canale produce un evento grezzo — testo di una notifica, corpo di una
   mail, messaggio scritto a mano
2. L'ingestore corrispondente lo normalizza in una struttura comune
3. L'elaborazione tenta prima le regole deterministiche, che sono gratuite e
   istantanee; solo se falliscono interviene il modello linguistico
4. Il risultato viene verificato: importo plausibile, categoria esistente
5. Si distingue un addebito già avvenuto da un addebito soltanto annunciato
6. Si controlla che non sia lo stesso movimento già arrivato da un altro
   canale, o che non chiuda un addebito annunciato in precedenza
7. La riga viene scritta e ne arriva notifica su Telegram
8. Se la fiducia nella categoria è bassa, la notifica chiede conferma — e la
   risposta genera una regola che rende superflua l'AI la volta successiva

Quest'ultimo punto è il meccanismo su cui si regge l'economia del sistema: più
lo usi, meno chiamate esterne servono.

### Annunci e addebiti

Una bolletta comunicata via email il 10 e addebitata sul conto il 27 sono lo
stesso movimento, visto due volte a diciassette giorni di distanza. Nessuna
finestra di deduplica ragionevole può collegarli, e allargarla abbastanza
significherebbe collassare spese diverse ma di pari importo.

Il sistema tratta quindi l'annuncio per quello che è: **una previsione**. Viene
registrato in uno stato che non concorre ai totali ma resta visibile, e quando
l'addebito arriva davvero la previsione viene chiusa e diventa la transazione,
datata al giorno in cui i soldi sono usciti.

Se l'addebito non si presenta entro qualche giorno dalla data prevista — banca
con notifiche mute, telefono spento — il sistema lo chiede.

### Principi seguiti

**Niente sparisce in silenzio.** Ogni scarto viene registrato con il motivo.
Un duplicato visibile è un fastidio; una spesa scomparsa è un buco che non
scopri mai.

**Il deterministico prima del probabilistico.** Gli importi non vengono mai
interpretati da un modello quando è possibile estrarli con una regola. L'AI
lavora sulla coda lunga, non sui casi noti.

**Ogni valore incerto è marcato tale.** Le righe con confidenza bassa nascono
in stato *da verificare* e restano visibili finché non le confermi.

---

## Struttura della repo

```
leroy/
├── README.md              questo file
├── .gitignore
├── app/                   la PWA (file statici, nessun build)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── manifest.json
│   ├── sw.js
│   └── icon-192.png, icon-512.png
├── infra/                 quello che gira sul server
│   ├── docker-compose.yml
│   ├── Caddyfile
│   ├── .env.example
│   └── backup.sh
├── n8n/                   workflow esportati + loro documentazione
│   ├── README.md
│   └── *.json
├── docs/
│   ├── installazione.md   dal server vuoto al sistema in funzione
│   ├── api.md             contratto dell'API usata dalla PWA
│   └── schema-dati.md     colonne e semantica dei fogli
└── scripts/
    └── migra_1money.py    migrazione dello storico
```

---

## Componenti e requisiti

| Componente | Ruolo | Costo |
|---|---|---|
| VM ARM (Oracle Always Free) | orchestratore e web server | 0 |
| n8n Community self-hosted | automazione | 0 |
| Caddy | reverse proxy e TLS automatico | 0 |
| PostgreSQL | database di n8n | 0 |
| Google Sheets | storage dei dati | 0 |
| Google Gemini API | categorizzazione, piano gratuito | 0 |
| Bot Telegram | inserimento e notifiche | 0 |
| MacroDroid (Android) | cattura delle notifiche bancarie | 0 |
| Dominio dinamico + Let's Encrypt | HTTPS | 0 |

Serve un dominio che risolva sull'IP del server: va bene un servizio DNS
dinamico gratuito o un dominio proprio.

---

## Installazione

I passaggi completi sono in [`docs/installazione.md`](docs/installazione.md).
In sintesi:

1. Crea la VM e apri le porte 80 e 443 — sia nel firewall del provider sia in
   quello del sistema operativo
2. Punta un nome DNS sull'IP pubblico
3. Copia `infra/`, compila `.env` partendo da `.env.example`, avvia lo stack
4. Crea il Google Sheet e migra lo storico con `scripts/migra_1money.py`
5. Configura le credenziali in n8n e importa i workflow da `n8n/`
6. Copia `app/` nella cartella servita da Caddy

Al primo avvio la PWA chiede indirizzo dell'API e token: restano solo sul
dispositivo.

---

## Sicurezza

**Cosa è esposto su internet:** l'interfaccia di n8n, gli endpoint webhook e i
file statici della PWA. Nient'altro. Il database non ha accesso alla rete,
nemmeno in uscita.

**Cosa protegge cosa:**

- gli endpoint sono autenticati con un token in header, distinto per ciascuno
  così da poterne revocare uno senza spegnere gli altri
- il bot risponde solo a un identificativo utente specifico: chiunque altro lo
  trovi non ottiene nulla
- la PWA non contiene segreti nel codice; il token vive nel `localStorage` del
  dispositivo e viaggia solo verso la stessa origine
- una Content Security Policy restrittiva impedisce a qualsiasi codice
  estraneo di comunicare all'esterno

**Cosa resta a carico tuo:** tenere n8n aggiornato, usare una password lunga
con autenticazione a due fattori sul pannello, e non riusare lo stesso token
per endpoint diversi.

---

## Backup

`infra/backup.sh`, da mettere in cron settimanale, produce un archivio con il
dump del database, i workflow in formato leggibile e la configurazione dello
stack. Si segnala su Telegram se fallisce, e si rifiuta di produrre un archivio
se il dump risulta vuoto.

Due avvertenze che valgono più dello script:

**La chiave di cifratura di n8n va conservata fuori dal server.** Senza, un
backup del database è integro ma illeggibile per la parte delle credenziali.

**Un backup che vive sulla stessa macchina protegge da un errore, non da una
perdita.** Portane una copia altrove, e prova il ripristino almeno una volta
prima di averne bisogno.

---

## Limitazioni note

- Le notifiche Android perse mentre il telefono è spento non sono
  recuperabili: a differenza delle email, non restano da nessuna parte. Tenere
  attive più fonti mitiga il problema, e gli addebiti annunciati vengono
  comunque richiesti se non si presentano.
- Alcune banche inviano notifiche prive di contenuto: per quelle il canale
  push non è utilizzabile.
- I PDF privi di livello testo non vengono letti.
- La riconciliazione di un addebito annunciato si basa su importo e data
  prevista: due addebiti di pari importo attesi nello stesso periodo possono
  essere scambiati.
- Un addebito annunciato con importo errato non è correggibile dall'app: si
  interviene sul foglio, oppure lo si annulla dal bot e si reinserisce.
- Il budget per categoria è un valore unico, non storicizzato: modificandolo
  cambia anche il confronto con i mesi passati.
- Non esiste il concetto di giroconto: spostare denaro fra due conti propri
  viene registrato come una spesa e un'entrata.
- Oltre qualche migliaio di righe la lettura del foglio inizia a farsi sentire.
  La contromisura è archiviare gli anni chiusi in un foglio separato.
- Sistema pensato per un utente singolo.

---

## Licenza

Progetto personale. Usalo come vuoi, senza garanzie.
