# Installazione

Dal server vuoto al sistema in funzione. Tempo realistico: mezza giornata, di
cui buona parte passata ad aspettare provisioning e propagazioni DNS.

I passi 1-4 mettono in piedi l'infrastruttura, i 5-9 il sistema vero e
proprio, i 10-12 le interfacce.

---

## Prima di iniziare

Serve:

- una macchina con Docker, raggiungibile da internet — bastano 2 core e 2 GB,
  ma con meno di 2 GB conviene rinunciare a PostgreSQL e restare su SQLite
- un nome DNS che risolva sul suo IP pubblico: va bene un servizio DNS
  dinamico gratuito
- un account Google (chiave del modello linguistico e, se vuoi il backup su
  foglio, un Google Sheet)
- un telefono Android, se vuoi la raccolta dalle notifiche bancarie

Il sistema è pensato per stare interamente su piani gratuiti. Le VM ARM sempre
gratuite dei principali provider cloud sono più che sufficienti; la
disponibilità però è contesa, e può servire qualche tentativo prima di
ottenerne una.

---

## 1. Il server

Crea la macchina con una distribuzione Linux recente e l'accesso via chiave
SSH. Genera la chiave **prima**:

```bash
ssh-keygen -t ed25519 -C "leroy" -f ~/.ssh/leroy
```

Assegna un **IP pubblico statico**: se cambia, il certificato smette di
funzionare.

### Le porte

Vanno aperte **a due livelli**, ed è il punto in cui si blocca quasi chiunque:

1. nel firewall del provider, di solito una lista di regole associata alla
   rete virtuale
2. nel firewall del sistema operativo

Molte immagini cloud arrivano con regole restrittive già attive. Aprendo solo
il primo livello, le connessioni muoiono in silenzio e la richiesta del
certificato fallisce senza un errore che lo spieghi.

Su immagini con iptables preconfigurato:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### Docker

```bash
sudo apt update && sudo apt full-upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Esci e rientra in SSH perché il gruppo abbia effetto, poi verifica con
`docker run --rm hello-world`.

---

## 2. Il DNS

Punta il nome sull'IP pubblico e **verifica che risolva prima di andare
avanti**:

```bash
dig +short iltuodominio
```

Deve rispondere con il tuo IP. Se non lo fa, fermati: ogni avvio con un DNS non
pronto consuma quota sui limiti di Let's Encrypt, che blocca i tentativi
ripetuti per ore anche dopo che hai corretto il problema.

Con un DNS dinamico, aggiungi un cron che tenga allineato l'indirizzo.

---

## 3. Lo stack

```bash
mkdir -p ~/leroy && cd ~/leroy
```

Copia `infra/docker-compose.yml`, `infra/Caddyfile` e `infra/.env.example`.
Crea la cartella dei file statici **prima** del primo avvio, altrimenti Docker
la crea di proprietà di root:

```bash
mkdir -p app
cp .env.example .env
```

Compila `.env` seguendo i commenti al suo interno. I due segreti si generano
con `openssl rand`.

**Salva `N8N_ENCRYPTION_KEY` in un password manager, fuori dal server.** Senza
quella chiave un backup del database è integro ma illeggibile per la parte
delle credenziali.

```bash
docker compose up -d
docker compose logs -f caddy
```

Nei log di Caddy devi vedere l'ottenimento del certificato. Se fallisce, le
cause sono tre e in quest'ordine: il DNS non risolve, la porta 80 è chiusa a
uno dei due livelli, il dominio nel file non coincide con quello reale.

**Se sei incerto della configurazione, prova prima contro l'ambiente di test di
Let's Encrypt**, che ha limiti molto più larghi: aggiungi
`acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` nel blocco
globale del Caddyfile. Il browser mostrerà un avviso di certificato non
attendibile: se arrivi a vederlo, la catena funziona. Poi togli la riga,
cancella il volume dei certificati e riparti.

---

## 4. Primo accesso a n8n

Apri `https://iltuodominio` e crea l'account proprietario.

**Password lunga e autenticazione a due fattori subito.** Quella pagina è
esposta a internet e verrà trovata dagli scanner nel giro di giorni: non è
allarmismo, è la normale rumorosità di fondo di qualsiasi IP pubblico.

Verifica che tutto sia coerente creando un workflow vuoto con un nodo Webhook:
l'URL di produzione mostrato deve iniziare con `https://` e il tuo dominio. Se
vedi `localhost`, la variabile `WEBHOOK_URL` non è stata letta.

---

## 5. Le data table

I dati vivono in quattro data table di n8n (sezione *Data tables* del progetto).
Creale **prima** di aprire i workflow: i nodi risolvono le colonne al
caricamento. Colonne e semantica sono in [`schema-dati.md`](schema-dati.md).

| Tabella | Colonne da creare |
|---|---|
| `Transactions` | `data_evento` · `data_inserimento` · `fonte` · `tipo` · `importo` (numero) · `valuta` · `conto` · `esercente` · `categoria` · `sottocategoria` · `note` · `testo_grezzo` · `hash_dedup` · `confidenza` (numero) · `stato` |
| `Category` | `categoria` · `tipo` · `budget_mensile` (numero) |
| `Rules` | `pattern` · `categoria` · `conto` · `creata_il` · `utilizzi` (numero) |
| `log` | `livello` · `messaggio` |

Le altre colonne sono testo. L'`id` è assegnato da n8n, non va creato.

Popola `Category` con l'elenco delle categorie. È un elenco **chiuso**: una
categoria che non c'è viene rifiutata dalla validazione, e il movimento nasce
`da_verificare`. Il bot Telegram propone i bottoni solo con esattamente 20
categorie di spesa; con un numero diverso risponde senza bottoni.

### Il foglio di backup (facoltativo)

Se vuoi la copia notturna, crea un Google Sheet con quattro schede,
`Transazioni`, `Regole`, `Log` e `Categorie`. Possono essere vuote: `Archivia`
scrive anche le intestazioni. Non serve formattare nulla: i nodi scrivono i
valori senza interpretarli.

I dati stanno già nel database di n8n, che il passo 13 mette al sicuro: il foglio
è una seconda copia, comoda da consultare, non la fonte.

---

## 6. Migrazione dello storico

Se arrivi da un'altra app, esporta in CSV e converti:

```bash
python scripts/migra_1money.py export.csv transazioni.csv
```

Importa il CSV nella data table `Transactions` con l'importazione CSV di n8n.
Salta la colonna `id` del CSV, perché l'`id` lo assegna n8n. Le categorie
distinte che compaiono nello storico vanno inserite in `Category` a mano o dal
riepilogo che lo script stampa; i budget si impostano poi dall'app.

Verifica che la differenza fra entrate e uscite coincida col saldo dell'app di
origine: se torna al centesimo, non si è perso nulla.

---

## 7. Le credenziali

In n8n, sezione Credentials.

**Google Sheets** (solo se usi il backup) — usa un **service account**, non
OAuth. Le applicazioni Google in stato di test hanno un token di aggiornamento
che scade dopo sette giorni: con OAuth il backup si romperebbe ogni settimana.
Crea il service account nella console cloud, scarica la chiave JSON, e
**condividi il foglio con l'indirizzo del service account** come editor — è il
passaggio che salta a tutti.

**Modello linguistico** — una credenziale di tipo *Query Auth* con nome del
parametro `key` e come valore la chiave API. Il nome del parametro è `key`,
non un'etichetta a piacere: è quello che finisce nell'URL.

**Telegram** — token ottenuto da BotFather.

**Gmail** — qui serve OAuth, perché il service account non funziona su una
casella personale. Dopo aver creato le credenziali, **porta l'applicazione in
produzione** dalla schermata di consenso: è il passaggio che elimina la
scadenza settimanale del token. L'avviso "app non verificata" è normale per
un'applicazione a uso personale.

**Outlook** — registrazione applicativa nel portale cloud Microsoft. Con un
account personale, il tipo di account dev'essere *solo account personali* e
gli endpoint di autorizzazione devono usare `/consumers`, non `/common`:
l'authority deve corrispondere al tipo di account, o l'autenticazione viene
rifiutata prima ancora della schermata di login.

**Header Auth** — una credenziale per ciascun webhook in ingresso (app e
notifiche Android), con nome dell'header `X-Push-Token` e token diversi
generati con `openssl rand -hex 32`.

---

## 8. I workflow

Importa i JSON da `n8n/` (menu del workflow → *Import from File*), poi
ricollega le credenziali e sostituisci i segnaposto: gli export non contengono
né id di fogli, etichette e cartelle, né i percorsi dei webhook, né i tuoi
identificativi Telegram. L'elenco completo è in
[`../n8n/README.md`](../n8n/README.md).

**Importa e attiva prima i sotto-workflow, poi tutto il resto**: un richiamo
verso un workflow inattivo fallisce. L'ordine:

1. `Leroy Config`, `Leroy LLM`, `Leroy Scrivi`, `Leroy Search`, `Leroy Chiedi`
2. `Leroy Processa Dati`
3. gli ingestori, il bot, l'app, la sorveglianza e `Archivia`

Dopo l'importazione i riferimenti ai sotto-workflow vanno ricollegati ai
workflow appena creati, perché gli id cambiano.

Poi, nelle impostazioni di **ogni** workflow, imposta `Leroy_Guardiano` come
*Error Workflow* — tranne che nel guardiano stesso. È il passaggio più noioso e
il più facile da dimenticare: se ne salti uno, i suoi errori restano invisibili.

---

## 9. Filtri sulle caselle

Non far leggere ai workflow l'intera casella: oltre a essere inutile, farebbe
passare ogni tua email personale attraverso un modello linguistico.

Su Gmail crea un filtro che etichetta i mittenti rilevanti — servizi di
pagamento, banca, utenze — e configura l'ingestore su quell'etichetta.

Su Outlook il filtro è nel codice di normalizzazione: una lista di mittenti
ammessi, confrontata con le etichette del **dominio** dell'indirizzo (la voce
`octopus` vale per `octopusenergy.it`; una voce con il punto, come `tim.it`, vale
per il dominio intero e i suoi sottodomini).

---

## 10. Il bot Telegram

Crea il bot con BotFather e configura la credenziale. Poi:

- manda `/start` al bot, apri l'esecuzione in n8n e prendi il tuo
  identificativo utente dal campo corrispondente
- inseriscilo in `Leroy Config`, sia come `chat_id` sia come `utente_id`:
  senza, il bot risponderebbe a chiunque lo trovi cercandolo per nome, e le
  notifiche non arriverebbero a te
- su BotFather, disattiva la possibilità di aggiungerlo ai gruppi

---

## 11. Notifiche Android

Installa MacroDroid, concedi l'**accesso alle notifiche** e — passaggio
decisivo — **disattiva l'ottimizzazione della batteria** per l'app: altrimenti
il sistema la sospende dopo qualche ora e le notifiche smettono di arrivare in
modo intermittente, che è il modo peggiore per accorgersene.

Crea una macro con trigger sulle notifiche delle app bancarie, vincolata ai
testi che contengono un importo, e come azione una richiesta HTTP verso il
webhook, con il token nell'header.

Manda i campi come testo semplice con il separatore `|#|` — titolo, testo,
pacchetto, timestamp — non come JSON: una virgoletta nel testo di una notifica
spezzerebbe il corpo della richiesta. Il formato è descritto in
[`api.md`](api.md).

---

## 12. La PWA

Copia il contenuto di `app/` in `~/leroy/app/` sul server:

```bash
rsync -avz --delete -e "ssh -i ~/.ssh/leroy" ./ utente@iltuodominio:~/leroy/app/
```

Apri `https://iltuodominio/app/` — con la barra finale — e inserisci indirizzo
dell'API e token, che restano solo sul dispositivo. Poi *Aggiungi alla
schermata Home*.

**A ogni aggiornamento incrementa il numero di versione in `app.js` e `sw.js`.**
La cache dello shell è cache-first: senza il cambio di versione il browser non
reinstalla nulla e continui a vedere la versione precedente anche dopo aver
copiato i file nuovi.

---

## 13. Backup

Le data table stanno nel database di n8n: salvare quel database (e
`N8N_ENCRYPTION_KEY`, che sta fuori dal server) salva tutto. Copia
`infra/backup.sh` sul server, rendilo eseguibile e provalo subito. Compila in
cima le variabili del bot se vuoi essere avvisato quando fallisce: un backup che
smette di funzionare in silenzio è peggio di non averlo, perché dà una sicurezza
che non hai.

```bash
crontab -e
```

```
0 4 * * 0 /home/utente/leroy/backup.sh >> /home/utente/leroy/backup.log 2>&1
```

**Porta una copia degli archivi fuori dal server** e prova il ripristino
almeno una volta. Un backup mai testato è una speranza, non una garanzia.
Il foglio Google scritto da `Archivia` è un'ulteriore copia, ma non sostituisce
questo passo.

---

## Verifica finale

Nell'ordine, ognuna verifica un pezzo diverso:

1. scrivi una spesa al bot: prova bot, categorizzazione, scrittura
2. fai una domanda al bot ("quanto ho speso questo mese?"): prova la traduzione
   in filtro e la ricerca
3. etichetta a mano una vecchia mail di pagamento: prova l'ingestore email e
   l'elaborazione condivisa
4. fai una spesa reale con la carta: prova la catena delle notifiche
5. apri la PWA e controlla che i movimenti ci siano tutti
6. inserisci una spesa dall'app e verifica che compaia nella tabella con la
   fonte corretta
7. fai fallire di proposito un workflow da un trigger vero — non
   dall'esecuzione manuale, che n8n non considera — e controlla che arrivi
   l'avviso del guardiano

Se il punto 4 e il punto 1 producessero due righe per la stessa spesa, la
deduplica non sta lavorando: controlla la tabella `log`, dove sono registrati
gli scarti col relativo motivo.

---

## Per le prime settimane

**Non spegnere subito il sistema precedente.** Tienili in parallelo per due o
tre settimane e confronta i totali: è l'unico modo per scoprire cosa *non* sta
arrivando. Una banca che manda notifiche prive di contenuto o una mail che
finisce fuori dal filtro non producono errori — producono silenzio.

**Guarda la tabella `log`.** Nei primi giorni ti dice se la deduplica sta
scartando troppo o troppo poco, e le finestre temporali (in `Leroy Config`) si
tarano su quello.

**Aspettati molte richieste di conferma.** La tabella `Rules` parte vuota: ogni
conferma ne scrive una, e dopo qualche settimana la maggior parte dei movimenti
verrà categorizzata senza chiamare il modello linguistico — sia dal bot sia per
mail e notifiche.
