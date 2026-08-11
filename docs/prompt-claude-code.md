# Prompt per Claude Code — archivio

Tutte le istruzioni passate alle sessioni di Claude Code che hanno costruito la
PWA, in ordine cronologico.

**Sono cumulativi.** Ogni prompt dal secondo in poi presuppone il codice
lasciato dal precedente, e non è autosufficiente: il primo costruisce l'app da
zero, gli altri la modificano. Per ricostruire tutto da capo servirebbe
rieseguirli nell'ordine, oppure riscrivere una specifica unica che descriva lo
stato finale.

| # | Cosa aggiunge | Versione risultante |
|---|---|---|
| 1 | Costruzione iniziale | 1.0.0 |
| 2 | Modifica importo ed eliminazione | 1.1.0 |
| 3 | Sezione "In arrivo" | 1.2.0 |
| 4 | Attese: filtro periodo e correzione | 1.3.0 |
| 5 | Andamento a dodici mesi | — |
| 6 | Ricerca testuale | — |
| 7 | Modalità privacy | 1.5.0 |

Ogni prompt è preceduto da una nota su cosa è emerso dalla revisione che l'ha
seguito: gli errori trovati sono la parte più utile di questo archivio.

---
---

# 1. Costruzione iniziale

> **Esito.** Buona qualità di base. La revisione di sicurezza ha trovato tre
> cose da correggere: l'URL dell'API accettava `http://` con conseguente
> passaggio del token in chiaro, mancava una Content Security Policy, e
> `parseImporto` sbagliava sugli importi con separatore di migliaia
> (`1.234` diventava 1,23 €). Corretto anche il rischio latente di un helper
> che accettava HTML arbitrario.

---

## PWA "Finanze" — specifica di implementazione

Costruisci una Progressive Web App per la gestione di finanze personali,
servita come file statici e collegata a un'API HTTP già esistente e
funzionante.

### Contesto

Esiste già un sistema che raccoglie automaticamente le transazioni da più
fonti (email, notifiche Android, un bot Telegram) e le scrive su un Google
Sheet. Un workflow n8n espone quel foglio tramite un'unica API HTTP, già
costruita e testata.

Questa PWA è l'interfaccia mobile per consultare, inserire e correggere quei
dati. **Non deve parlare con Google Sheets né conoscere n8n**: usa solo l'API
descritta sotto, che è il contratto definitivo.

L'app viene servita dallo stesso dominio dell'API, quindi le richieste sono
same-origin: non serve gestire CORS.

### Vincoli tecnici

- **Nessun build step.** Niente npm, bundler, TypeScript, transpilazione.
- **Vanilla JS**, moduli ES nativi. Nessun framework, nessuna dipendenza
  esterna, nessuna CDN: deve funzionare anche senza rete verso terzi.
- **Mobile first.** Viewport di riferimento 380px. Target touch minimo 44px.
  Deve restare usabile anche su desktop, senza allargarsi oltre ~560px.
- Supporto **light e dark mode** via `prefers-color-scheme`.
- Lingua italiana. Numeri con `Intl.NumberFormat('it-IT')` → `1.234,56 €`.
  Date leggibili in italiano: `9 agosto 2026`, `agosto 2026`, `2026`.
- Fuso orario Europe/Rome. Le date scambiate con l'API sono sempre stringhe
  ISO `YYYY-MM-DD`, mai oggetti Date serializzati.
- Nessun dato sensibile nel codice sorgente.

File attesi: `index.html`, `app.js`, `style.css`, `manifest.json`, `sw.js`,
`icon-192.png`, `icon-512.png`.

### Configurazione

L'API richiede un header `x-push-token` con un token segreto.

**Il token non va scritto nel codice.** Al primo avvio l'app mostra una
schermata di configurazione che chiede URL dell'API e token, salvati in
`localStorage`. Un'icona ingranaggio permette di rientrare e modificarli.

Se una chiamata risponde 401 o 403, l'app torna alla configurazione con un
messaggio esplicito.

### L'API

Endpoint unico, sempre `POST`, corpo JSON, header `x-push-token`.
Il campo `azione` fa da router.

Qualsiasi azione può rispondere `{ "ok": false, "errore": "..." }`, da mostrare
all'utente e mai ignorare.

**`riepilogo`**

```json
{ "azione": "riepilogo", "periodo": "2026-08" }
```

`periodo` è una data ISO troncata: `"2026"` anno, `"2026-08"` mese,
`"2026-08-09"` giorno.

```json
{
  "periodo": "2026-08", "entrate": 2400.00, "uscite": 1498.52,
  "saldo": 901.48, "da_verificare": 2,
  "categorie": [
    { "nome": "Affitto", "tipo": "spesa", "speso": 620.00, "budget": 620 }
  ],
  "config": {
    "categorie_spesa": ["Affitto", "..."],
    "categorie_entrata": ["Stipendio", "..."],
    "conti": ["banca", "contante", "paypal", "satispay", "revolut"]
  }
}
```

Il campo si chiama `speso` anche per le entrate. `budget` arriva **già scalato
al periodo** dal server: mensile su un mese, per dodici su un anno, `0` su un
giorno — il client non deve fare calcoli. `budget: 0` significa nessun budget
impostato. `config` viaggia qui perché all'apertura basti una chiamata sola.

**`movimenti`**

```json
{ "azione": "movimenti", "periodo": "2026-08",
  "categoria": "Ristorante", "solo_da_verificare": false }
```

```json
{ "periodo": "2026-08", "movimenti": [
  { "hash": "a3f2c81b4d5e6f70", "data": "2026-08-09", "importo": 4.40,
    "tipo": "spesa", "etichetta": "trenord", "categoria": "Trasporti",
    "conto": "banca", "fonte": "push", "stato": "confermata" } ] }
```

`importo` è sempre positivo, il segno lo determina `tipo`. `stato` vale
`confermata` o `da_verificare`. `etichetta` può essere vuota: in quel caso
mostra la categoria. **`hash` è l'unica chiave da usare per le correzioni.**

**`inserisci`**

```json
{ "azione": "inserisci", "importo": 12.50, "tipo": "spesa",
  "categoria": "Ristorante", "conto": "banca",
  "esercente": "da michele", "data": "2026-08-09", "note": "" }
```

```json
{ "ok": true, "hash": "a3f2...", "duplicato_sospetto": false }
```

Se `duplicato_sospetto` è `true` l'inserimento **è comunque avvenuto**: mostralo
come avviso non bloccante.

**`correggi`**

```json
{ "azione": "correggi", "hash": "...", "categoria": "Salute",
  "stato": "confermata" }
```

**`budget`**

```json
{ "azione": "budget", "valori": { "Supermercato": 161 } }
```

### Le schermate

**Barra del periodo**, sempre in cima e condivisa: selettore giorno/mese/anno,
frecce avanti e indietro, etichetta leggibile al centro, tocco sull'etichetta
per tornare al periodo corrente.

Il periodo è **stato globale** persistito in `localStorage`. Cambiando il tipo
di periodo, mantieni la data di riferimento: da `agosto 2026` a `giorno` si va
al 1 agosto, non a oggi.

**Vista Riepilogo** (predefinita). In alto entrate, uscite, saldo; il saldo è il
più grande, verde se positivo e rosso se negativo. Se `da_verificare > 0`, un
banner toccabile che apre i movimenti filtrati. Sotto, le categorie di spesa
ordinate per importo, con barra di avanzamento: verde sotto il 90% del budget,
ambra fra 90 e 100, rossa oltre. Nessuna barra se il budget è 0. Tocco sulla
riga → movimenti filtrati. In fondo le entrate, senza barre.

Un pulsante "Modifica budget" trasforma i valori in campi numerici e ne invia
solo quelli cambiati; disponibile **solo quando il periodo è un mese**.

**Vista Movimenti.** Lista raggruppata per giorno con intestazione di data e
totale. Ogni riga: etichetta, categoria e conto in secondaria, importo a destra.
Entrate col segno `+` e colore distinto. Le righe `da_verificare` con sfondo di
richiamo e icona di avviso. Filtro attivo come chip rimovibile. Lista vuota:
messaggio esplicito, non una schermata bianca.

Tocco su una riga → foglio dal basso con dettaglio, selettore di categoria e
pulsante "Conferma" che invia `correggi` con `stato: "confermata"`.

**Inserimento.** Pulsante flottante `+` in basso a destra. Foglio dal basso con
importo (`inputmode="decimal"`, a fuoco automatico, accetta virgola e punto),
toggle spesa/entrata, categoria, conto, descrizione opzionale, data. Pulsante
disabilitato finché importo e categoria non sono validi.

**Impostazioni** da icona ingranaggio: URL, token, cancellazione della
configurazione, versione dell'app.

### Comportamento

Una sola chiamata `riepilogo` all'apertura; i movimenti si caricano entrando
nella vista. Stati di caricamento espliciti, mai una schermata vuota che sembra
rotta. Errori visibili con pulsante "Riprova", mai fallimenti silenziosi.
Nessuna cache dei dati tra sessioni oltre a configurazione e periodo. Timeout
ragionevole (15 s) con messaggio dedicato.

### PWA

`manifest.json` con `display: "standalone"`, orientamento portrait, colori
coerenti col CSS, le due icone.

`sw.js`: cache-first **solo sullo shell**, rete sempre per le chiamate all'API,
nessuna cache sulle POST. Versiona il nome della cache e cancella le vecchie
in `activate`: senza, dopo un aggiornamento l'utente resta bloccato sulla
versione precedente.

Non implementare coda offline né background sync.

### Estetica

Pulita e piatta. Niente gradienti, ombre decorative o animazioni superflue.
Bordi sottili, spazio bianco generoso, gerarchia data dalla dimensione del
testo prima che dal colore. Il numero più importante di ogni schermata deve
essere il più grande. Colore solo dove porta significato. Font di sistema.

### Cosa NON fare

- Nessun framework, dipendenza npm o build step
- Nessuna modifica di importo, data o conto su transazioni esistenti
- Nessuna cancellazione di transazioni
- Nessuna coda offline, nessun background sync
- Nessun grafico a torta o a linee
- Nessuna gestione multi-utente, login o account
- Nessun token o URL scritto nel codice sorgente

### Deploy

I file finiscono in `/srv/app`, serviti da Caddy sotto `/app/`. Il percorso
resta pubblico e senza autenticazione: lo shell non contiene segreti.

**L'app è servita sotto `/app/`, non alla radice**: i percorsi nel manifest,
nel service worker e nei riferimenti fra file devono essere **relativi**.

---
---

# 2. Modifica importo ed eliminazione

> **Esito.** Implementato correttamente. La revisione ha rilevato solo una
> discrepanza: la Content Security Policy consentiva chiamate alla sola stessa
> origine, ma la schermata di configurazione accettava qualsiasi indirizzo
> HTTPS — un dominio diverso avrebbe prodotto un errore fuorviante. Aggiunto
> il vincolo di stessa origine, che chiude anche l'ultimo residuo di rischio
> sul token.

---

Aggiungi due funzionalità alla PWA esistente: **modifica dell'importo** e
**eliminazione** di un movimento. Entrambe agiscono dal foglio di dettaglio
che si apre toccando una riga nella vista Movimenti.

## Modifiche all'API

L'azione `correggi` ora accetta e **richiede** anche `importo`:

```json
{ "azione": "correggi", "hash": "a3f2c81b4d5e6f70",
  "categoria": "Salute", "stato": "confermata", "importo": 18.90 }
```

Va inviato **sempre**, anche quando l'utente non ha toccato l'importo: in quel
caso invia il valore corrente del movimento. Deve essere un numero positivo.

Esiste una nuova azione `elimina`:

```json
{ "azione": "elimina", "hash": "a3f2c81b4d5e6f70" }
```

Il movimento non viene rimosso fisicamente ma marcato come eliminato lato
server, e sparisce da riepilogo e movimenti. Dall'app il comportamento da
mostrare è quello di una cancellazione.

## Cosa aggiungere al foglio di dettaglio

**1. L'importo diventa modificabile.** Campo con `inputmode="decimal"`,
precompilato col valore corrente formattato all'italiana. Riusa `parseImporto`
per la lettura. Il segno resta determinato da `tipo`, che non è modificabile.
Il pulsante di conferma è disabilitato se l'importo non è valido o è ≤ 0.
Mantieni visibile il segno `+` o `−` accanto al campo.

**2. Un pulsante "Elimina"** in fondo, visivamente separato, con lo stile di
pericolo già presente nel CSS. Alla pressione, `confirm()` che riporti importo
e descrizione del movimento. Durante l'invio disabilita entrambi i pulsanti. A
esito positivo: chiudi il foglio, toast "Movimento eliminato", ricarica
riepilogo e movimenti. A esito negativo: messaggio nell'area errore e pulsanti
riabilitati.

## Vincoli

- Mantieni tutto il resto invariato: struttura, stile, gestione degli errori,
  service worker, funzioni esistenti
- Nessuna nuova dipendenza, nessun build step, resta vanilla JS
- Riusa `parseImporto`, `eur`, `api`, `toast`, `gestisciAuth`, `chiudiFogli`
- Nessun dato deve passare da `innerHTML`
- Incrementa `VERSIONE` in `app.js` e in `sw.js`

---
---

# 3. Sezione "In arrivo"

> **Esito.** Corretto. Dalla revisione sono emersi due punti di merito: la
> sezione compariva anche navigando su periodi passati, dove un totale slegato
> dai numeri sopra confondeva; e le attese non erano correggibili in alcun
> modo. Entrambi risolti dal prompt successivo.

---

Aggiungi alla PWA una sezione "In arrivo" nella vista Riepilogo.

L'azione `riepilogo` dell'API ora restituisce due campi in più:

```json
"attese": [
  { "hash": "a3f2...", "data": "2026-08-27", "importo": 36.55,
    "etichetta": "octopus energy", "categoria": "Bollette" }
],
"attese_totale": 36.55
```

Sono addebiti annunciati e non ancora avvenuti: **non fanno parte dei totali
del periodo** e non vanno sommati a uscite o saldo.

Mostrali in un blocco separato sotto le categorie, con intestazione
"In arrivo" e il totale accanto. Ogni voce: etichetta, categoria, data in
formato breve (`27 ago`) e importo. Le voci con data già passata vanno
evidenziate come in ritardo.

Se l'elenco è vuoto, non mostrare la sezione.

Nessuna interazione: sono in sola lettura, si confermano dal bot Telegram.

Mantieni invariato tutto il resto, nessuna nuova dipendenza, e incrementa
il numero di versione in `app.js` e `sw.js`.

---
---

# 4. Attese: filtro periodo e correzione

> **Esito.** Il punto critico — inviare `stato: "attesa"` e non `"confermata"`
> — è stato rispettato. La revisione ha confermato il filtro sul periodo su
> tutti i casi limite e verificato che le voci fossero `<button>` con reset di
> stile completo. Unica dipendenza segnalata: l'API deve includere `tipo` in
> ogni attesa, altrimenti il selettore di categoria ricade sulle spese.

---

Due modifiche alla sezione "In arrivo" della PWA.

## 1. Mostrarla solo quando è pertinente

Oggi la sezione compare in qualunque periodo. Navigando su marzo 2025 si vede
comunque "In arrivo 36,55 €": un totale che non ha alcun rapporto con i numeri
sopra, perché le attese non sono filtrate per periodo.

Rendila visibile solo quando il periodo selezionato **contiene oggi o è
futuro**. Con le date in formato ISO basta troncare la data odierna alla
lunghezza del periodo e confrontare le stringhe:

    const p = periodoStr();                    // "2026", "2026-08", "2026-08-10"
    const mostra = p >= oggiISO().slice(0, p.length);

Quando `mostra` è falso, non renderizzare la sezione anche se l'elenco non è
vuoto.

## 2. Rendere le voci modificabili

Le attese sono addebiti annunciati e non ancora avvenuti. Se l'estrazione
automatica ha sbagliato l'importo — 365,50 invece di 36,55 su una bolletta —
oggi non c'è modo di correggerlo dall'app.

Rendi toccabile ogni voce dell'elenco e riusa il **foglio di dettaglio già
esistente**.

L'API restituisce per ogni attesa: `hash`, `data`, `importo`, `etichetta`,
`categoria` e `tipo`. Mancano `conto` e `fonte`: nel foglio vanno omessi, non
mostrati vuoti.

Nel foglio, quando si tratta di un'attesa:

- l'intestazione diventa "Addebito previsto" invece di "Movimento"
- nella lista dei dettagli, la data va etichettata come **"Data prevista"**
- il selettore di categoria si popola con le categorie del `tipo` dell'attesa
- il pulsante primario si chiama **"Salva"**, non "Conferma"
- il pulsante di eliminazione resta, e si comporta come già fa

### Il punto da non sbagliare

Il pulsante "Salva" invia l'azione `correggi` con **`stato: "attesa"`**, non
`"confermata"`.

`correggi` scrive nello stato il valore che riceve: passando `"confermata"`
diresti al sistema che l'addebito è avvenuto, mentre stai solo correggendo una
previsione. La riga uscirebbe dalle attese ed entrerebbe nei totali del mese
prima che i soldi siano usciti davvero, e non verrebbe più riconciliata quando
l'addebito arriva.

Per i movimenti normali il comportamento resta quello di adesso:
`stato: "confermata"`.

### Dopo il salvataggio

Chiudi il foglio e ricarica i dati come già fai. Le attese arrivano dalla
risposta di `riepilogo`, quindi è quello il caricamento che deve avvenire.

## Vincoli

- Riusa il foglio di dettaglio esistente e le funzioni già presenti:
  `parseImporto`, `eur`, `api`, `toast`, `gestisciAuth`, `chiudiFogli`,
  `validaDettaglio`
- Nessuna nuova dipendenza, nessun build step, resta vanilla JS
- Nessun dato dall'API deve passare da `innerHTML`
- Le voci in ritardo restano evidenziate come adesso, e devono essere
  toccabili anche loro
- Le righe dell'elenco devono essere raggiungibili da tastiera e avere un
  ruolo appropriato, non essere semplici `div` con un listener
- Incrementa il numero di versione in `app.js` e in `sw.js`

---
---

# 5. Andamento a dodici mesi

> **Esito.** Implementato con un dettaglio non richiesto ma corretto: un mese
> con spesa minima mantiene un'altezza minima invece di sparire a zero pixel.

---

Aggiungi alla PWA un grafico dell'andamento a 12 mesi nella vista Riepilogo.

## Nuova azione API

```json
{ "azione": "andamento", "categoria": null }
```

Risposta:

```json
{
  "mesi": [ { "mese": "2025-09", "uscite": 2210.40, "entrate": 2400.00 } ],
  "media_uscite": 2150.30,
  "categoria": null
}
```

Tredici elementi in ordine cronologico: dodici mesi conclusi più quello in
corso, che è **parziale**. `media_uscite` è calcolata sui soli mesi conclusi.

## Dove e come

Un blocco compatto subito **sotto i tre numeri** di entrate, uscite e saldo,
prima dell'elenco delle categorie. Titolo "Andamento", e accanto la media
mensile.

Tredici barre verticali, una per mese, altezza proporzionale alle uscite.
Sotto ogni barra l'iniziale del mese; l'anno solo dove cambia.

- La barra del mese in corso va resa visivamente distinta (tratteggiata,
  semitrasparente o con bordo): è parziale e confrontarla a occhio con le
  altre indurrebbe in errore.
- La barra del mese attualmente selezionato nel periodo va evidenziata.
- Una linea orizzontale sottile all'altezza della media.
- Toccando una barra si passa a quel mese: imposta il periodo su
  `"YYYY-MM"` con tipo `mese` e ricarica, riusando la logica del periodo che
  già esiste.

## Vincoli

- Il blocco si carica **una volta sola** all'avvio e si aggiorna solo con il
  pulsante di aggiornamento manuale, non a ogni cambio di periodo: la serie
  non dipende dal periodo selezionato
- Se la chiamata fallisce, non mostrare il blocco e non bloccare il resto
  del riepilogo: è un complemento, non un dato essenziale
- Barre realizzate con elementi HTML e altezza in percentuale, non canvas né
  librerie
- Ogni barra deve avere un `aria-label` con mese e importo, ed essere
  raggiungibile da tastiera
- Nessuna nuova dipendenza, nessun build step
- Nessun dato dall'API deve passare da `innerHTML`
- Incrementa la versione in `app.js` e in `sw.js`

---
---

# 6. Ricerca testuale

> **Esito.** Corretto. La sessione ha segnalato che i risultati ignorano il
> periodo selezionato: è il comportamento voluto, e l'interfaccia lo dichiara
> nella riga di sintesi.

---

Aggiungi la ricerca alla vista Movimenti.

## Nuova azione API

`{ "azione": "cerca", "q": "michele", "da": "2026-01-01", "a": "2026-12-31" }`

Tutti i campi tranne `azione` sono opzionali. Risposta:

```json
{
  "totale": 184.50,
  "conteggio": 7,
  "per_categoria": [ { "nome": "Ristorante", "totale": 184.50 } ],
  "movimenti": [ ... ]
}
```

I `movimenti` hanno la stessa forma dell'azione `movimenti` già in uso,
quindi la lista si renderizza con il codice esistente.

## Comportamento

Un campo di ricerca in cima alla vista Movimenti, `type="search"`.

- Attivo il campo, la lista mostra i risultati di `cerca` invece di quelli
  di `movimenti`
- La ricerca **ignora il periodo selezionato** e guarda tutto lo storico: è
  il suo scopo. Segnalalo con una riga sotto il campo, del tipo "7 movimenti
  · 184,50 € in tutto lo storico"
- Sotto quella riga, la ripartizione per categoria se sono più di una
- Applica un ritardo di circa 400 ms prima di chiamare l'API mentre si
  digita, e annulla la chiamata precedente se ne parte una nuova
- Svuotando il campo si torna alla lista normale del periodo
- Le righe restano toccabili e aprono il foglio di dettaglio come adesso

## Vincoli

Riusa le funzioni e i componenti esistenti per la lista e il dettaglio.
Nessuna nuova dipendenza. Niente `innerHTML` sui dati.
Incrementa la versione in `app.js` e in `sw.js`.

---
---

# 7. Modalità privacy

> **Esito.** Implementato come richiesto, intervenendo su `eur()`. La revisione
> ha segnalato un limite intrinseco: il foglio di dettaglio mostra l'importo
> reale perché il campo deve restare modificabile, quindi toccando un movimento
> mentre la modalità è attiva la cifra compare.

---

Aggiungi alla PWA una modalità privacy che nasconde tutti gli importi, per
poter mostrare l'app a qualcuno senza rivelare le cifre.

## Il comando

Un pulsante icona nella barra in alto, accanto a quelli di aggiornamento e
impostazioni. Icona a forma di occhio: aperto quando gli importi sono visibili,
sbarrato quando sono nascosti.

Deve avere `aria-pressed` coerente con lo stato e un'etichetta esplicita
("Nascondi importi" / "Mostra importi").

Lo stato va salvato in `localStorage` e ripristinato all'avvio: se lo attivi
per mostrare l'app a qualcuno e poi la chiudi, riaprendola davanti alla stessa
persona non deve essere di nuovo scoperta.

## Come mascherare

Nel codice tutti gli importi visualizzati passano dalla funzione `eur()`.
Intervieni **lì**: quando la modalità è attiva, `eur()` restituisce una
maschera a larghezza costante — per esempio `••••• €` — invece del valore.

È l'unico punto da toccare, e garantisce che nessun importo sfugga: totali,
categorie, budget, movimenti, attese, foglio di dettaglio, etichette di
accessibilità. Non inseguire i singoli punti della vista.

Usa una maschera di larghezza fissa in modo che il layout non si scomponga
passando da una modalità all'altra.

## Cosa NON va mascherato

I **campi di input** devono continuare a mostrare il valore reale: il campo
importo del foglio di dettaglio e quello del foglio di inserimento. Servono a
modificare, e mascherarli renderebbe impossibile correggere un movimento.

Nel codice quei campi non usano `eur()` ma una funzione diversa, quindi se
intervieni solo su `eur()` sono già esclusi: verifica che sia così.

Le **barre del grafico e quelle del budget** mantengono le loro proporzioni:
mostrano un andamento, non una cifra. Vanno mascherate solo le etichette
numeriche che le accompagnano.

## Vincoli

- Nessuna nuova dipendenza, nessun build step
- Il cambio di stato deve aggiornare la vista senza richiamare l'API: i dati
  sono già in memoria, si tratta solo di ridisegnare
- Nessun dato dall'API deve passare da `innerHTML`
- Incrementa il numero di versione in `app.js` e in `sw.js`

---
---

# Cosa ha funzionato

Rileggendo la sequenza, tre abitudini hanno pagato più delle altre.

**Descrivere il contratto, non l'implementazione.** I prompt dicono cosa
risponde l'API e cosa deve succedere, quasi mai come scriverlo. Le poche
eccezioni sono i punti dove un errore sarebbe stato silenzioso.

**Chiudere esplicitamente le porte.** La sezione "Cosa NON fare" ha evitato
framework, build step e dipendenze che sarebbero comparsi da soli. Un vincolo
non dichiarato viene interpretato come un'opportunità.

**Isolare il punto pericoloso.** Nel prompt sulle attese, la riga su
`stato: "attesa"` ha una sezione tutta sua e la spiegazione di cosa
succederebbe sbagliando. È l'unico modo in cui quella modifica poteva produrre
un danno che non si nota subito, e per questo meritava più spazio di tutto il
resto.
