# API

Endpoint unico che espone il foglio dati alla PWA.

```
POST https://<dominio>/webhook/<percorso>
Content-Type: application/json
x-push-token: <token>
```

Il campo `azione` nel corpo seleziona l'operazione. Ogni risposta è JSON.

| Azione | Cosa fa |
|---|---|
| `riepilogo` | totali del periodo, categorie, attese, configurazione |
| `movimenti` | elenco delle transazioni di un periodo |
| `cerca` | ricerca testuale su tutto lo storico |
| `andamento` | serie mensile degli ultimi dodici mesi |
| `inserisci` | registra un movimento |
| `correggi` | modifica categoria e importo |
| `elimina` | cancellazione logica |
| `budget` | aggiorna i budget per categoria |

L'aggregazione avviene lato server: la lettura del foglio è già il costo
dominante di ogni chiamata, quindi restituire poche decine di numeri anziché
migliaia di righe non costa nulla in più e alleggerisce molto il client.

Le azioni che guardano indietro nel tempo — `cerca` e `andamento` — leggono
anche il foglio `Archivio`. Senza, restituirebbero zero sui periodi vecchi
senza segnalare nulla.

---

## Autenticazione

Header `x-push-token`. Il token è distinto da quelli usati dagli altri webhook,
così può essere revocato senza fermare la raccolta automatica.

Risposte `401` e `403` indicano token mancante o errato.

---

## Errori

Qualsiasi azione può rispondere:

```json
{ "ok": false, "errore": "descrizione leggibile" }
```

Un'azione sconosciuta riceve la stessa forma, con l'azione richiesta nel
messaggio. Nessuna richiesta resta senza risposta.

---

## `riepilogo`

**Richiesta**

```json
{ "azione": "riepilogo", "periodo": "2026-08" }
```

`periodo` è una data ISO troncata, e la sua lunghezza determina la
granularità:

| Valore | Significato |
|---|---|
| `"2026"` | anno |
| `"2026-08"` | mese |
| `"2026-08-09"` | giorno |

**Risposta**

```json
{
  "periodo": "2026-08",
  "entrate": 2400.00,
  "uscite": 1498.52,
  "saldo": 901.48,
  "da_verificare": 2,
  "categorie": [
    { "nome": "Affitto",    "tipo": "spesa",   "speso": 620.00,  "budget": 620 },
    { "nome": "Ristorante", "tipo": "spesa",   "speso": 151.00,  "budget": 134 },
    { "nome": "Stipendio",  "tipo": "entrata", "speso": 2400.00, "budget": 0 }
  ],
  "attese": [
    { "hash": "9c1e40ab7d2f5583", "data": "2026-08-27", "importo": 36.55,
      "etichetta": "octopus energy", "categoria": "Bollette", "tipo": "spesa" }
  ],
  "attese_totale": 36.55,
  "config": {
    "categorie_spesa":   ["Affitto", "Supermercato", "..."],
    "categorie_entrata": ["Stipendio", "Bonifici", "Rimborsi"],
    "conti": ["banca", "contante", "paypal", "satispay", "revolut"]
  }
}
```

Note:

- il campo si chiama `speso` anche per le entrate: contiene l'importo del
  periodo, il segno lo dà `tipo`
- **`budget` arriva già scalato al periodo**: mensile su un mese, moltiplicato
  per dodici su un anno, `0` su un giorno. Il client non deve fare conti
- `budget: 0` significa nessun budget impostato
- `config` viaggia qui perché all'apertura basti una sola chiamata per avere
  tutto il necessario a disegnare le schermate e popolare i form
- le righe in stato `eliminata` e `attesa` non vengono conteggiate nei totali
- **`attese`** sono addebiti annunciati e non ancora avvenuti: non fanno parte
  di `uscite` né di `saldo`, e vanno mostrati a parte. `attese_totale` è la
  loro somma. Il campo `tipo` serve a popolare il selettore di categoria
  quando si corregge un'attesa
- a differenza di tutto il resto, **le attese non sono filtrate per periodo**:
  quello che sta per uscire interessa anche guardando un mese passato

---

## `movimenti`

**Richiesta**

```json
{
  "azione": "movimenti",
  "periodo": "2026-08",
  "categoria": "Ristorante",
  "solo_da_verificare": false
}
```

`categoria` e `solo_da_verificare` sono opzionali.

**Risposta**

```json
{
  "periodo": "2026-08",
  "movimenti": [
    {
      "hash": "a3f2c81b4d5e6f70",
      "data": "2026-08-09",
      "importo": 4.40,
      "tipo": "spesa",
      "etichetta": "trenord",
      "categoria": "Trasporti",
      "conto": "banca",
      "fonte": "push",
      "stato": "confermata"
    }
  ]
}
```

Note:

- `importo` è sempre positivo, il segno lo determina `tipo`
- `etichetta` è l'esercente, o la descrizione se l'esercente è assente; può
  essere vuota
- **`hash` è l'unica chiave** da usare per correzioni ed eliminazioni
- vengono restituiti solo i campi necessari: il contenuto grezzo di origine,
  che può essere lungo migliaia di caratteri, resta sul server
- ordinamento per data decrescente
- le righe `eliminata` e `attesa` non compaiono: le seconde si consultano dal
  campo `attese` del riepilogo

---

## `cerca`

**Richiesta**

```json
{
  "azione": "cerca",
  "q": "michele",
  "da": null,
  "a": null,
  "categoria": null,
  "tipo": null,
  "min": null,
  "max": null,
  "limite": 100
}
```

Tutti i campi tranne `azione` sono opzionali.

**Risposta**

```json
{
  "totale": 184.50,
  "conteggio": 7,
  "per_categoria": [ { "nome": "Ristorante", "totale": 184.50 } ],
  "movimenti": [ ... ]
}
```

I `movimenti` hanno la stessa forma dell'azione omonima.

Note:

- il testo viene confrontato in forma normalizzata — minuscolo, senza accenti —
  contro esercente, descrizione, categoria e conto
- con più parole, **tutte** devono comparire: cercando `bar michele` non
  arrivano tutti i bar
- `totale` e `per_categoria` considerano solo le uscite
- **la PWA non invia `da` e `a`**: la ricerca guarda deliberatamente tutto lo
  storico, ignorando il periodo selezionato. È il suo scopo, e l'interfaccia lo
  dichiara nella riga di sintesi. I due campi restano disponibili per l'uso dal
  bot Telegram, dove la domanda contiene spesso un riferimento temporale

---

## `andamento`

**Richiesta**

```json
{ "azione": "andamento", "categoria": null }
```

`categoria` opzionale: se valorizzata, la serie riguarda solo quella.

**Risposta**

```json
{
  "mesi": [
    { "mese": "2025-08", "uscite": 2210.40, "entrate": 2400.00 },
    { "mese": "2026-08", "uscite": 847.20,  "entrate": 2400.00 }
  ],
  "media_uscite": 2150.30,
  "categoria": null
}
```

Note:

- tredici elementi in ordine cronologico: dodici mesi conclusi più quello in
  corso, che è **parziale**
- `media_uscite` è calcolata sui soli mesi conclusi: includere quello in corso
  abbasserebbe il riferimento proprio quando serve confrontarcisi
- la serie non dipende dal periodo selezionato

---

## `inserisci`

**Richiesta**

```json
{
  "azione": "inserisci",
  "importo": 12.50,
  "tipo": "spesa",
  "categoria": "Ristorante",
  "conto": "banca",
  "esercente": "da michele",
  "data": "2026-08-09",
  "note": ""
}
```

Obbligatori: `importo` (positivo), `tipo`, `categoria`, `conto`.
Opzionali: `esercente`, `data` (default oggi), `note`.

**Risposta**

```json
{ "ok": true, "hash": "a3f2...", "duplicato_sospetto": false }
```

`duplicato_sospetto` a `true` significa che esiste una transazione simile
registrata di recente da un altro canale. **L'inserimento è comunque
avvenuto**: qui la decisione è dell'utente, quindi il sistema segnala e non
scarta. È la differenza rispetto alla raccolta automatica, dove un doppione fra
due canali viene invece eliminato.

---

## `correggi`

**Richiesta**

```json
{
  "azione": "correggi",
  "hash": "a3f2c81b4d5e6f70",
  "categoria": "Salute",
  "stato": "confermata",
  "importo": 18.90
}
```

**Tutti i campi sono obbligatori**, importo compreso, anche quando non è
cambiato: un aggiornamento con un campo vuoto cancellerebbe il valore esistente
sul foglio.

**Attenzione a `stato` quando si corregge un'attesa**: va rimandato `attesa`,
non `confermata`. Passando `confermata` si dichiarerebbe avvenuto un addebito
soltanto previsto: la riga entrerebbe nei totali del mese prima che i soldi
siano usciti, e non verrebbe più riconciliata all'arrivo dell'addebito vero.

Non è possibile modificare data, tipo o conto: per quelli si interviene
direttamente sul foglio.

**Risposta**

```json
{ "ok": true }
```

---

## `elimina`

**Richiesta**

```json
{ "azione": "elimina", "hash": "a3f2c81b4d5e6f70" }
```

**Risposta**

```json
{ "ok": true }
```

È una **cancellazione logica**: la riga resta nel foglio con stato
`eliminata` e viene esclusa da riepiloghi, elenchi, ricerche, andamento e
controllo duplicati. Dal punto di vista dell'app il movimento è sparito, ma
resta recuperabile intervenendo sul foglio.

La scelta evita di lavorare sugli indici di riga, che cambiano a ogni
ordinamento, ed è coerente col principio per cui nulla viene distrutto in
silenzio.

---

## `budget`

**Richiesta**

```json
{ "azione": "budget", "valori": { "Supermercato": 161, "Ristorante": 134 } }
```

Invia solo le categorie effettivamente modificate. I nomi che non esistono nel
foglio `Categorie` vengono ignorati.

**Risposta**

```json
{ "ok": true, "aggiornate": 2 }
```

---

## Prova rapida

```bash
API='https://<dominio>/webhook/<percorso>'
TOK='<token>'
H=(-H "x-push-token: $TOK" -H 'Content-Type: application/json')

curl -s -X POST "$API" "${H[@]}" -d '{"azione":"riepilogo","periodo":"2026-08"}'
curl -s -X POST "$API" "${H[@]}" -d '{"azione":"movimenti","periodo":"2026-08"}'
curl -s -X POST "$API" "${H[@]}" -d '{"azione":"cerca","q":"coop"}'
curl -s -X POST "$API" "${H[@]}" -d '{"azione":"andamento"}'
curl -s -X POST "$API" "${H[@]}" -d '{"azione":"boh"}'
```

L'ultima deve restituire un errore leggibile, non restare in attesa.
