# Schema dei dati

Tutto lo stato vive in quattro **data table di n8n**. Le colonne si
identificano per nome: rinominarne una rompe i workflow, spostarla no.

| Data table | Contenuto | Scritta da |
|---|---|---|
| `Transactions` | ogni movimento, in qualunque stato | `Leroy Scrivi` (e le correzioni dell'app e del bot) |
| `Category` | elenco chiuso delle categorie e budget | a mano e app (`budget`) |
| `Rules` | memoria della categorizzazione | conferme Telegram, contatore dalla pipeline |
| `log` | scarti | `Leroy Scrivi` |

Il **Google Sheet** `Leroy_Data` è soltanto una copia di sicurezza, riscritta
ogni notte da `Archivia`, con quattro schede: `Transazioni`, `Regole`, `Log`,
`Categorie`. Nessun workflow lo legge. Per i dettagli di chi legge e scrive cosa
vedi [`../n8n/README.md`](../n8n/README.md).

---

## `Transactions`

Una riga per movimento.

| Colonna | Contenuto |
|---|---|
| `id` | intero progressivo assegnato da n8n (colonna di sistema) |
| `createdAt` · `updatedAt` | date di sistema, in formato ISO |
| `data_evento` | quando è avvenuto il movimento, `YYYY-MM-DD`, giorno di Roma |
| `data_inserimento` | quando è entrato nel sistema, ISO con ora |
| `fonte` | canale di provenienza |
| `tipo` | `spesa` o `entrata` |
| `importo` | numero, sempre positivo |
| `valuta` | `EUR` |
| `conto` | strumento di pagamento |
| `esercente` | normalizzato: minuscolo, senza accenti, spazi compattati |
| `categoria` | deve esistere in `Category` |
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
`storico` per le righe migrate, che erano su conto unico. L'elenco dei conti
ammessi sta in `Leroy Config`.

**`stato`** — `confermata` è il caso normale. `da_verificare` marca le righe su
cui il sistema ha dei dubbi: categoria non riconosciuta, importo ambiguo,
confidenza sotto soglia. `attesa` è un addebito annunciato ma non ancora
avvenuto, escluso dai totali. `eliminata` è una cancellazione logica: la riga
resta in tabella ma viene esclusa da ogni lettura.

### Le attese

Un'attesa non è una riga a parte: **è la transazione stessa, scritta in
anticipo**. Quando arriva l'addebito reale, quella riga viene aggiornata invece
di scriverne una nuova.

In stato `attesa`, `data_evento` contiene la **data prevista** dell'addebito.
Alla riconciliazione viene sostituita con quella reale, perché una spesa vale nel
mese in cui i soldi escono.

Categoria, esercente e note sopravvivono alla riconciliazione: sono quelle
dedotte dall'email, che conosceva il fornitore, mentre la notifica bancaria da
sola avrebbe prodotto qualcosa di generico. Per questo il nodo che chiude
un'attesa (in `Leroy Scrivi`) aggiorna solo importo, data, conto, fonte,
confidenza e stato — un campo mappato a vuoto cancellerebbe il resto.

Una riga diventa `attesa` solo se il testo contiene una data futura. Se il
modello linguistico la dichiara tale ma quella data non c'è, viene trattata come
un addebito già avvenuto: la classificazione va verificata contro un dato
oggettivo, non accettata sulla parola.

### Note importanti

**`hash_dedup` è la chiave usata da tutto il sistema**, non `id`. I bottoni di
conferma su Telegram e le operazioni dell'app la usano per individuare la riga.
L'hash non cambia mai, nemmeno correggendo l'importo: identifica la riga, non il
suo contenuto. Dipende dal canale: per mail e push include l'identificativo del
messaggio (per le push, il timestamp della notifica), per Telegram l'id del
messaggio, per l'app l'istante dell'inserimento — così due acquisti identici
nello stesso giorno restano distinti.

**`data_inserimento` contiene l'ora** perché la deduplica confronta la distanza
temporale fra movimenti. Le righe dello storico migrato hanno solo la data:
sono vecchie e non entrano mai in un confronto.

**`esercente` e `note` sono cose diverse.** Il primo è il luogo — `coop
centro`, `da michele` — il secondo cosa hai comprato. Scrivendo dal bot, la
chiocciola separa i due: `12 pizza @da michele`.

**Dimensione.** La tabella cresce ma nessun workflow la scarica più per
intero: le letture filtrano sul server (hash, stato, date, ultime righe).
Non serve più spostare gli anni chiusi in un archivio a parte.

---

## `Category`

L'elenco chiuso delle categorie ammesse e i budget.

| Colonna | Contenuto |
|---|---|
| `categoria` | nome, così come apparirà ovunque |
| `tipo` | `spesa` o `entrata` |
| `budget_mensile` | budget, modificabile dall'app |

Non ci sono più le statistiche storiche (`n_transazioni`, `totale`, `media`,
`media_mensile`): erano ferme all'import e nessun workflow le leggeva. Le medie
e le mediane per categoria le calcola `Report periodico` quando serve.

**Questa tabella è la fonte della verità sulle categorie.** Il sistema verifica
ogni categorizzazione proposta dal modello linguistico contro questo elenco: se
non corrisponde a nessuna voce, il movimento entra con categoria vuota e stato
`da_verificare`. Serve a impedire che nel tempo si accumulino varianti dello
stesso concetto.

Aggiungere una categoria significa aggiungere una riga: viene usata subito, senza
toccare nulla. **Eccezione:** la tastiera dei bottoni su Telegram è una griglia
fissa pensata per 20 categorie di spesa. Con un numero diverso il bot risponde
senza bottoni; il nodo va adeguato.

---

## `Rules`

La memoria del sistema. Si popola da sola.

| Colonna | Contenuto |
|---|---|
| `pattern` | testo da cercare, minuscolo |
| `categoria` | categoria da assegnare |
| `conto` | conto predefinito, opzionale (non usato) |
| `creata_il` | data di creazione |
| `utilizzi` | quante volte la pipeline mail/push l'ha applicata |

Il confronto è per sottostringa sul testo normalizzato del movimento: per il bot
su esercente più descrizione, per mail e push su esercente più oggetto. Ogni
volta che confermi una categoria dai bottoni di Telegram viene scritta una
regola; la volta successiva quel movimento non passa più dal modello
linguistico. Una regola vince solo se la sua categoria esiste ancora in
`Category` (spazi e tabulazioni attorno al nome vengono ignorati).

`utilizzi` lo incrementa la pipeline di mail e push; il bot Telegram non lo
tocca.

Puoi aggiungere righe a mano per i posti che già frequenti.

**Tieni i pattern lunghi almeno due o tre caratteri.** Quelli di meno di due
vengono ignorati; uno molto corto corrisponde a troppe cose.

---

## `log`

| Colonna | Contenuto |
|---|---|
| `livello` | oggi solo `duplicato` |
| `messaggio` | motivo, importo, esercente, fonte |
| `createdAt` | quando (colonna di sistema) |

Ci finiscono i movimenti che `Leroy Scrivi` ha scartato e il perché. È il primo
posto da guardare quando i conti non tornano: se un movimento non compare fra le
transazioni, o è stato riconosciuto come duplicato — e qui c'è scritto di cosa —
o non è mai arrivato.

È il contraltare dello scarto automatico: si può cancellare senza chiedere,
purché resti traccia di cosa e perché.

---

## Non più presenti

Le schede `Archivio`, `Ricorrenti` e `Conti` del vecchio impianto basato su
Google Sheet non esistono più. L'elenco dei conti è in `Leroy Config`; il
rilevamento degli abbonamenti ricorrenti non è stato riportato.

## Manutenzione

**Backup.** `Archivia` scrive ogni notte sul foglio Google. Le transazioni si
aggiornano per `id` (le righe modificate negli ultimi due giorni, la domenica
tutte); le altre tre tabelle vengono lette, il foglio svuotato e riscritto. Le
schede devono chiamarsi `Transazioni`, `Regole`, `Log` e `Categorie`.

**Formattazione.** I nodi scrivono i valori senza interpretarli (`RAW`): un
importo come `6.00` resta un numero e non diventa una data. Conviene comunque
impostare le colonne `hash_dedup` come *Testo normale*, perché un hash di sole
cifre verrebbe altrimenti convertito in notazione scientifica.
