/* Finanze — PWA per finanze personali.
   Vanilla JS, modulo ES nativo, nessuna dipendenza esterna.
   Parla solo con l'API descritta nella specifica: un unico POST con
   header x-push-token e campo "azione" come router. */

const VERSIONE = '1.10.0';
const TIMEOUT_MS = 15000;

const CHIAVI = {
  url: 'finanze.api_url',
  token: 'finanze.token',
  accessId: 'finanze.access_id',
  accessSecret: 'finanze.access_secret',
  periodo: 'finanze.periodo',
  usoCategorie: 'finanze.uso_categorie',
  impronta: 'finanze.blocco_impronta',
  privacy: 'finanze.privacy',
};

/* Dentro l'APK (Capacitor) l'app è servita da https://localhost: l'API è su
   un altro dominio e sta dietro Cloudflare Access. Le chiamate passano allora
   dal client HTTP nativo, che non subisce CORS e porta il service token di
   Access negli header. Nel browser resta tutto come prima. */
const NATIVA = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

const RITARDO_RICERCA = 400;

/* Le sole icone disegnate da JS. Sono costanti chiuse: svgIcona() accetta
   esclusivamente queste chiavi, così nessun testo che arriva dall'API può
   finire in un innerHTML. */
const ICONE = {
  avviso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.2 21 19.4H3z"/><path d="M12 10v4.1M12 16.9v.01"/></svg>',
  freccia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/* ============ utilità ============ */

const $ = (sel, radice = document) => radice.querySelector(sel);
const $$ = (sel, radice = document) => Array.from(radice.querySelectorAll(sel));

function svgIcona(nome, classe = 'ico') {
  const markup = ICONE[nome];
  if (!markup) throw new Error(`Icona sconosciuta: ${nome}`);
  const s = document.createElement('span');
  s.className = classe;
  s.innerHTML = markup;
  return s;
}

/* Icone delle categorie, per nome in minuscolo. Come ICONE sono costanti
   chiuse: dall'API arriva solo la chiave, mai il markup. Una categoria
   sconosciuta mostra la propria iniziale. */
const CAT_ICONE = {
  'affitto': '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  'gestione casa': '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9.5 14.5l2 2 3.5-4"/>',
  'vacanze': '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  'spese oggetti': '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  'supermercato': '<path d="M3 4h2l2.4 11h10.2L20 7H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
  'salute': '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  'bollette': '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  'ristorante': '<path d="M7 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M9 12v9"/><path d="M17 3c-1.7 1.5-2.5 3.7-2.5 6.5 0 1.4.9 2.5 2.5 2.5V21"/>',
  'regali': '<path d="M4 11h16v9H4zM3 7.5h18V11H3zM12 7.5V20"/><path d="M12 7.5C10.5 4 7 4 7.2 6.2c.1 1.3 2.4 1.3 4.8 1.3M12 7.5C13.5 4 17 4 16.8 6.2c-.1 1.3-2.4 1.3-4.8 1.3"/>',
  'tempo libero': '<path d="M12 3.5l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.4l-5.1 2.8L8 13.5l-4.3-4 5.8-.7z"/>',
  'benzina': '<path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3.5 21h13M7.5 8h5"/><path d="M15 9l3 3v6a1.5 1.5 0 0 0 3 0v-8l-3-3"/>',
  'auto': '<path d="M5 16V12l2-5h10l2 5v4z"/><path d="M5 16v2.5M19 16v2.5M4 12h16"/><circle cx="8" cy="14" r=".6"/><circle cx="16" cy="14" r=".6"/>',
  'teatro': '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
  'abbonamenti streaming': '<path d="M3 5h18v12H3zM8 21h8"/><path d="M10 8.5v5l4.5-2.5z"/>',
  'lavoro': '<path d="M3 8h18v11H3zM8 8V5h8v3M3 13h18"/>',
  'videogiochi': '<path d="M7 8h10a5 5 0 0 1 0 10c-1.6 0-2.5-.9-3.2-2h-3.6C9.5 17.1 8.6 18 7 18A5 5 0 0 1 7 8z"/><path d="M8 11v3.5M6.25 12.75h3.5M15.5 12h.01M17.5 14h.01"/>',
  'trasporti': '<path d="M6 4h12v12H6zM6 11h12"/><path d="M8.5 19 7 21M15.5 19l1.5 2M9 13.5h.01M15 13.5h.01"/>',
  'tasse': '<path d="M7 3h8l4 4v14H7z"/><path d="M10 16l4-6M10 10.5h.01M14 15.5h.01"/>',
  'multe': '<path d="M12 4.2 21 19.4H3z"/><path d="M12 10v4.1M12 16.9v.01"/>',
  'telefono': '<path d="M8 3h8v18H8z"/><path d="M11 18h2"/>',
  'stipendio': '<path d="M3 7h16a2 2 0 0 1 2 2v10H3z"/><path d="M3 7l12-3v3"/><path d="M17 13.5h.01"/>',
  'bonifici': '<path d="M4 8h15l-3-3M20 16H5l3 3"/>',
  'rimborsi': '<path d="M9 13 4 8l5-5"/><path d="M4 8h10a6 6 0 0 1 0 12h-3"/>',
};

/* Otto tinte, scelte per leggersi sia su chiaro sia su scuro. La tinta
   dipende dal nome: la stessa categoria ha sempre lo stesso colore. */
function tintaCategoria(chiave) {
  let h = 0;
  for (const c of chiave) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 8;
}

function tileCategoria(nome, piccola = false) {
  const k = String(nome || '').trim().toLowerCase();
  const t = el('span', {
    class: `cat-tile tinta-${tintaCategoria(k)}` + (piccola ? ' piccola' : ''),
    'aria-hidden': 'true',
  });
  if (CAT_ICONE[k]) {
    t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${CAT_ICONE[k]}</svg>`;
  } else {
    t.textContent = k.charAt(0).toUpperCase() || '?';
  }
  return t;
}

/* Gli esercenti arrivano spesso tutti in minuscolo dalle notifiche
   ("carrefour express"): solo in quel caso si mette la maiuscola a ogni
   parola. Un testo già scritto con le maiuscole resta com'è. */
function etichettaBella(testo) {
  const t = String(testo || '').trim();
  if (t !== t.toLowerCase()) return t;
  return t.replace(/(^|[\s(\-/])(\p{L})/gu, (_, prima, lettera) => prima + lettera.toUpperCase());
}

/* Vibrazione breve, solo nell'APK: 'ok' a operazione riuscita, 'tocco'
   come conferma leggera di un gesto. */
function vibra(tipo = 'tocco') {
  const h = NATIVA && window.Capacitor.Plugins.Haptics;
  if (!h) return;
  const p = tipo === 'ok' ? h.notification({ type: 'SUCCESS' }) : h.impact({ style: 'LIGHT' });
  if (p && p.catch) p.catch(() => { /* non bloccante */ });
}

function el(tag, attr, ...figli) {
  const n = document.createElement(tag);
  if (attr) {
    for (const [k, v] of Object.entries(attr)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    }
  }
  for (const f of figli.flat()) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f);
  }
  return n;
}

/* useGrouping: 'always' perché in it-IT il separatore di migliaia sotto le
   cinque cifre è opzionale (CLDR minimumGroupingDigits=2) e senza forzarlo
   1234,56 uscirebbe come "1234,56 €" invece di "1.234,56 €". */
const NF_EUR = new Intl.NumberFormat('it-IT', {
  style: 'currency', currency: 'EUR',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
  useGrouping: 'always',
});

const num = v => (typeof v === 'number' && isFinite(v)) ? v : (isFinite(Number(v)) ? Number(v) : 0);

/* Modalità privacy: si maschera qui, nell'unico punto da cui passa ogni
   importo mostrato — totali, categorie, budget, movimenti, attese, grafico,
   etichette di accessibilità. Larghezza fissa per non scomporre il layout.
   I campi modificabili usano importoModificabile(), quindi restano reali. */
const MASCHERA = '••••• €';

const eur = v => (stato.privacy ? MASCHERA : NF_EUR.format(num(v)));

function eurSegnato(v) {
  const n = num(v);
  const segno = n > 0 ? '+' : n < 0 ? '−' : '';
  return segno + (stato.privacy ? MASCHERA : NF_EUR.format(Math.abs(n)));
}

/* Importo da mettere in un campo modificabile: virgola decimale, due decimali,
   nessun separatore di migliaia (così resta comodo da correggere a mano). */
const NF_MODIFICA = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false,
});
const importoModificabile = v => NF_MODIFICA.format(Math.abs(num(v)));

/* Importo digitato dall'utente: accetta virgola e punto, tollera i separatori
   di migliaia italiani. Ritorna null se vuoto, NaN se non valido. */
function parseImporto(txt) {
  let s = String(txt ?? '').trim().replace(/[\s €]/g, '');
  if (s === '') return null;
  // "1.234" o "12.345": il punto e' separatore di migliaia, non decimale
  if (!s.includes(',') && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s)) return NaN;
  const v = Number(s);
  if (!isFinite(v)) return NaN;
  return Math.round(v * 100) / 100;
}

/* ============ date ============ */

const due = n => String(n).padStart(2, '0');
const isoDa = (a, m, g) => `${a}-${due(m)}-${due(g)}`;

function oggiISO() {
  const parti = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const p = t => parti.find(x => x.type === t).value;
  return `${p('year')}-${p('month')}-${p('day')}`;
}

function parseISO(iso) {
  const [a, m, g] = String(iso).split('-').map(Number);
  return { a, m: m || 1, g: g || 1 };
}

function dataLocale(iso) {
  const { a, m, g } = parseISO(iso);
  return new Date(a, m - 1, g);
}

const FMT_GIORNO = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
const FMT_MESE = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });

const FMT_BREVE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const FMT_NARROW = new Intl.DateTimeFormat('it-IT', { month: 'narrow' });

const etichettaGiorno = iso => FMT_GIORNO.format(dataLocale(iso));
const dataBreve = iso => FMT_BREVE.format(dataLocale(iso));

/* ============ stato ============ */

const stato = {
  cfg: { url: '', token: '', accessId: '', accessSecret: '' },
  connessione: null, // null | 'ok' | 'rete' | 'auth': esito dell'ultima chiamata
  tipo: 'mese',
  rif: oggiISO(),
  vista: 'riepilogo',

  riep: null, rStato: 'idle', rErrore: '',
  config: null,
  budgetMode: false,
  insCatTutte: false, // griglia categorie del foglio inserimento aperta tutta
  and: null,        // serie a 12 mesi: non dipende dal periodo selezionato

  mov: null, mStato: 'idle', mErrore: '', mScaduto: true,
  filtro: { categoria: null, soloDaVerificare: false },

  // Ricerca: ignora il periodo e guarda tutto lo storico.
  ric: { q: '', dati: null, stato: 'idle', errore: '' },

  movAperto: null,
  dettAttesa: false,

  privacy: false,
};

function periodoStr() {
  const { a, m } = parseISO(stato.rif);
  if (stato.tipo === 'anno') return String(a);
  if (stato.tipo === 'mese') return `${a}-${due(m)}`;
  return stato.rif;
}

function periodoEtichetta() {
  const { a } = parseISO(stato.rif);
  if (stato.tipo === 'anno') return String(a);
  if (stato.tipo === 'mese') return FMT_MESE.format(dataLocale(stato.rif));
  return etichettaGiorno(stato.rif);
}

function caricaStatoPeriodo() {
  try {
    const salvato = JSON.parse(localStorage.getItem(CHIAVI.periodo) || 'null');
    if (salvato && ['giorno', 'mese', 'anno'].includes(salvato.tipo) && /^\d{4}-\d{2}-\d{2}$/.test(salvato.rif || '')) {
      stato.tipo = salvato.tipo;
      stato.rif = salvato.rif;
    }
  } catch { /* valore illeggibile: si riparte da oggi */ }
}

function salvaStatoPeriodo() {
  try {
    localStorage.setItem(CHIAVI.periodo, JSON.stringify({ tipo: stato.tipo, rif: stato.rif }));
  } catch { /* localStorage pieno o non disponibile: non è bloccante */ }
}

/* ============ API ============ */

class ErroreApi extends Error {
  constructor(messaggio, extra = {}) {
    super(messaggio);
    this.auth = !!extra.auth;
    this.timeout = !!extra.timeout;
    this.annullata = !!extra.annullata;
    this.rete = !!extra.rete;
  }
}

/* Tiene traccia dell'esito dell'ultima chiamata per la scheda di stato nelle
   impostazioni. Un errore applicativo (dati.ok === false) vuol dire comunque
   che l'API è stata raggiunta: conta come connessione riuscita. */
async function api(azione, corpo = {}, segnale = null) {
  try {
    const dati = await chiamaApi(azione, corpo, segnale);
    stato.connessione = 'ok';
    return dati;
  } catch (err) {
    if (err.auth) stato.connessione = 'auth';
    else if (err.rete || err.timeout) stato.connessione = 'rete';
    else if (!err.annullata) stato.connessione = 'ok';
    throw err;
  }
}

/* segnale: AbortSignal opzionale per annullare dall'esterno una chiamata
   ancora in volo (serve alla ricerca mentre si digita). */
async function chiamaApi(azione, corpo = {}, segnale = null) {
  if (!stato.cfg.url || !stato.cfg.token) {
    throw new ErroreApi('Configurazione mancante: inserisci URL e token.', { auth: true });
  }

  const ctrl = new AbortController();
  let scaduto = false;
  const timer = setTimeout(() => { scaduto = true; ctrl.abort(); }, TIMEOUT_MS);

  const propaga = () => ctrl.abort();
  if (segnale) {
    if (segnale.aborted) ctrl.abort();
    else segnale.addEventListener('abort', propaga, { once: true });
  }

  const headers = { 'Content-Type': 'application/json', 'x-push-token': stato.cfg.token };
  if (stato.cfg.accessId && stato.cfg.accessSecret) {
    headers['CF-Access-Client-Id'] = stato.cfg.accessId;
    headers['CF-Access-Client-Secret'] = stato.cfg.accessSecret;
  }
  const richiesta = { azione, ...corpo };

  let res;
  try {
    res = NATIVA
      ? await inviaNativa(headers, richiesta, ctrl.signal)
      : await inviaBrowser(headers, richiesta, ctrl.signal);
  } catch {
    if (segnale && segnale.aborted) {
      throw new ErroreApi('Richiesta annullata.', { annullata: true });
    }
    if (scaduto) {
      throw new ErroreApi(`La richiesta ha superato i ${TIMEOUT_MS / 1000} secondi senza risposta.`, { timeout: true });
    }
    throw new ErroreApi("Impossibile raggiungere l'API. Controlla la rete e l'URL configurato.", { rete: true });
  } finally {
    clearTimeout(timer);
    if (segnale) segnale.removeEventListener('abort', propaga);
  }

  // Con le credenziali mancanti o sbagliate Access risponde con un redirect
  // alla sua pagina di login: il client nativo non lo segue e lo vede qui.
  if (res.status >= 300 && res.status < 400) {
    throw new ErroreApi(`Cloudflare Access ha chiesto il login (HTTP ${res.status}). Controlla Client ID e Client Secret.`, { auth: true });
  }
  if (res.status === 401 || res.status === 403) {
    const cosa = NATIVA ? 'token o credenziali Access' : 'token';
    throw new ErroreApi(`L'API ha rifiutato la richiesta (HTTP ${res.status}). Controlla URL e ${cosa}.`, { auth: true });
  }

  const testo = res.testo;
  let dati = null;
  if (testo.trim() !== '') {
    try { dati = JSON.parse(testo); } catch { dati = null; }
  }

  if (res.status < 200 || res.status >= 300) {
    // Un 5xx vuol dire che n8n o il proxy non rispondono: per la scheda di
    // stato è un problema di raggiungibilità, non della richiesta.
    throw new ErroreApi((dati && dati.errore) || `L'API ha risposto con errore HTTP ${res.status}.`, { rete: res.status >= 500 });
  }
  if (dati === null) {
    throw new ErroreApi("Risposta non leggibile dall'API (JSON non valido).");
  }
  if (dati.ok === false) {
    throw new ErroreApi(dati.errore || "L'API ha segnalato un errore non specificato.");
  }
  return dati;
}

/* Le due vie di trasporto restituiscono la stessa forma, { status, testo },
   così api() non deve sapere quale ha usato. */
async function inviaBrowser(headers, richiesta, segnale) {
  const res = await fetch(stato.cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(richiesta),
    signal: segnale,
    cache: 'no-store',
  });
  return { status: res.status, testo: await res.text() };
}

/* La chiamata nativa non si può interrompere davvero: all'annullamento la
   promessa viene rifiutata subito e la risposta, se arriva, si ignora. */
function inviaNativa(headers, richiesta, segnale) {
  return new Promise((risolvi, rifiuta) => {
    const annulla = () => rifiuta(new DOMException('Annullata', 'AbortError'));
    if (segnale.aborted) return annulla();
    segnale.addEventListener('abort', annulla, { once: true });

    window.Capacitor.Plugins.CapacitorHttp.request({
      url: stato.cfg.url,
      method: 'POST',
      headers,
      data: richiesta,
      responseType: 'text',
      disableRedirects: true,
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    }).then(
      // Con Content-Type JSON il client nativo ignora responseType e
      // restituisce data già decodificato: lo si riporta a testo.
      r => risolvi({
        status: r.status,
        testo: typeof r.data === 'string' ? r.data : (r.data == null ? '' : JSON.stringify(r.data)),
      }),
      rifiuta,
    ).finally(() => segnale.removeEventListener('abort', annulla));
  });
}

/* ============ configurazione ============ */

function leggiConfig() {
  stato.cfg.url = (localStorage.getItem(CHIAVI.url) || '').trim();
  stato.cfg.token = (localStorage.getItem(CHIAVI.token) || '').trim();
  stato.cfg.accessId = (localStorage.getItem(CHIAVI.accessId) || '').trim();
  stato.cfg.accessSecret = (localStorage.getItem(CHIAVI.accessSecret) || '').trim();
  return !!(stato.cfg.url && stato.cfg.token);
}

/* Con un messaggio (di solito un errore di autenticazione) si apre già sul
   form: c'è qualcosa da correggere. Altrimenti, se una connessione esiste,
   si mostra solo la scheda di stato. */
function apriConfig(messaggio = '') {
  const primaVolta = !(stato.cfg.url && stato.cfg.token);
  $('#cfgHead').hidden = primaVolta;
  $('#cfgIntro').hidden = !primaVolta;
  $('#cfgCancella').hidden = primaVolta;
  $('#cfgSalva').textContent = primaVolta ? 'Collega' : 'Salva';

  const avviso = $('#cfgAvviso');
  avviso.textContent = messaggio;
  avviso.hidden = !messaggio;

  vistaConfig(primaVolta || !!messaggio);

  chiudiFogli();
  $('#schermataConfig').hidden = false;
  $('#app').hidden = true;
  aggiornaTabbar();
}

function vistaConfig(modifica) {
  const primaVolta = !(stato.cfg.url && stato.cfg.token);
  $('#cfgStato').hidden = modifica;
  $('#formConfig').hidden = !modifica;
  $('#cfgAnnulla').hidden = primaVolta;

  if (modifica) {
    $('#cfgUrl').value = stato.cfg.url;
    $('#cfgToken').value = stato.cfg.token;
    $('#cfgAccessId').value = stato.cfg.accessId;
    $('#cfgAccessSecret').value = stato.cfg.accessSecret;
    $('#cfgAccess').hidden = !NATIVA;
    $('#cfgErrore').hidden = true;
    for (const b of $$('[data-vedi]')) {
      $('#' + b.dataset.vedi).type = 'password';
      b.textContent = 'Mostra';
    }
  } else {
    aggiornaSchedaStato();
  }
  aggiornaSchedaSicurezza();
}

const STATI_CONNESSIONE = {
  ok:   { titolo: 'Connesso', classe: 'ok' },
  rete: { titolo: 'API non raggiungibile', classe: 'ko' },
  auth: { titolo: 'Credenziali rifiutate', classe: 'ko' },
};

function aggiornaSchedaStato() {
  const s = STATI_CONNESSIONE[stato.connessione] || { titolo: 'Non ancora verificato', classe: '' };
  $('#cfgPallino').className = `cfg-pallino ${s.classe}`;
  $('#cfgStatoTit').textContent = s.titolo;

  let host = stato.cfg.url;
  try { host = new URL(stato.cfg.url).host; } catch { /* resta l'URL grezzo */ }
  $('#cfgHost').textContent = host;

  $('#cfgTokenMask').textContent = `•••• ${stato.cfg.token.slice(-4)}`;
  $('#cfgRigaAccess').hidden = !NATIVA;
  $('#cfgAccessStato').textContent = stato.cfg.accessId ? 'Service token attivo' : 'Non configurato';
}

function chiudiConfig() {
  $('#schermataConfig').hidden = true;
  $('#app').hidden = false;
  aggiornaTabbar();
}

function gestisciAuth(err) {
  if (!err || !err.auth) return false;
  apriConfig(err.message);
  return true;
}

/* ============ caricamento dati ============ */

let seqRiep = 0;

async function caricaRiepilogo() {
  const mio = ++seqRiep;
  stato.rStato = 'loading';
  stato.rErrore = '';
  stato.budgetMode = false;
  renderRiepilogo();
  aggiornaAggiorna();

  let errore = null;
  try {
    const d = await api('riepilogo', { periodo: periodoStr() });
    if (mio !== seqRiep) return;
    stato.riep = d;
    if (d.config) stato.config = d.config;
    stato.rStato = 'ok';
  } catch (err) {
    if (mio !== seqRiep) return;
    errore = err;
    stato.rStato = 'error';
    stato.rErrore = err.message;
  } finally {
    if (mio === seqRiep) aggiornaAggiorna();
  }
  if (mio !== seqRiep) return;
  renderRiepilogo();
  aggiornaFab();
  if (errore) gestisciAuth(errore);
}

let seqMov = 0;

async function caricaMovimenti() {
  const mio = ++seqMov;
  stato.mStato = 'loading';
  stato.mErrore = '';
  stato.mScaduto = false;
  renderMovimenti();
  aggiornaAggiorna();

  const corpo = { periodo: periodoStr(), solo_da_verificare: stato.filtro.soloDaVerificare };
  if (stato.filtro.categoria) corpo.categoria = stato.filtro.categoria;

  let errore = null;
  try {
    const d = await api('movimenti', corpo);
    if (mio !== seqMov) return;
    stato.mov = Array.isArray(d.movimenti) ? d.movimenti : [];
    stato.mStato = 'ok';
  } catch (err) {
    if (mio !== seqMov) return;
    errore = err;
    stato.mStato = 'error';
    stato.mErrore = err.message;
    stato.mScaduto = true;
  } finally {
    if (mio === seqMov) aggiornaAggiorna();
  }
  if (mio !== seqMov) return;
  renderMovimenti();
  if (errore) gestisciAuth(errore);
}

let seqAnd = 0;

/* La serie non dipende dal periodo: si carica all'avvio e poi solo con
   l'aggiornamento manuale. Se fallisce non si mostra e non disturba il
   riepilogo: è un complemento, non un dato essenziale. */
async function caricaAndamento() {
  const mio = ++seqAnd;
  try {
    const d = await api('andamento', { categoria: null });
    if (mio !== seqAnd) return;
    stato.and = (d && Array.isArray(d.mesi) && d.mesi.length) ? d : null;
  } catch {
    if (mio !== seqAnd) return;
    stato.and = null;
  }
  if (stato.vista === 'riepilogo' && !stato.budgetMode) renderRiepilogo();
}

function inCaricamento() {
  return stato.rStato === 'loading' || stato.mStato === 'loading';
}

/* Chiamata a ogni inizio e fine caricamento: a lavoro finito ritira
   l'indicatore del trascina-per-aggiornare, se era rimasto a girare. */
function aggiornaAggiorna() {
  if (!inCaricamento() && ptr.attesa) {
    ptr.attesa = false;
    ritiraPtr();
  }
}

function aggiornaTutto() {
  caricaRiepilogo();
  if (stato.vista === 'movimenti') caricaMovimenti();
  else stato.mScaduto = true;
}

/* Aggiornamento manuale: l'unico momento, oltre all'avvio, in cui si
   rilegge anche l'andamento. */
function aggiornaManuale() {
  caricaAndamento();
  aggiornaTutto();
  if (stato.ric.q !== '') eseguiRicerca(stato.ric.q);
}

/* ============ barra del periodo ============ */

function aggiornaBarra() {
  const testo = periodoEtichetta();
  $('#periodoTesto').textContent = testo.charAt(0).toUpperCase() + testo.slice(1);
  for (const b of $$('#tipoSel .seg')) {
    b.classList.toggle('attivo', b.dataset.tipo === stato.tipo);
  }
}

function cambiaPeriodo() {
  salvaStatoPeriodo();
  aggiornaBarra();
  aggiornaTutto();
}

function spostaPeriodo(delta) {
  const { a, m, g } = parseISO(stato.rif);
  let d;
  if (stato.tipo === 'giorno') d = new Date(a, m - 1, g + delta);
  else if (stato.tipo === 'mese') d = new Date(a, m - 1 + delta, 1);
  else d = new Date(a + delta, 0, 1);
  stato.rif = isoDa(d.getFullYear(), d.getMonth() + 1, d.getDate());
  cambiaPeriodo();
}

function cambiaTipo(tipo) {
  if (tipo === stato.tipo) return;
  // La data di riferimento resta, troncata al tipo precedente:
  // da "agosto 2026" a giorno si va al 1 agosto 2026.
  const { a, m } = parseISO(stato.rif);
  if (stato.tipo === 'anno') stato.rif = isoDa(a, 1, 1);
  else if (stato.tipo === 'mese') stato.rif = isoDa(a, m, 1);
  stato.tipo = tipo;
  cambiaPeriodo();
}

function vaiAOggi() {
  const oggi = oggiISO();
  if (oggi === stato.rif) return;
  stato.rif = oggi;
  cambiaPeriodo();
}

/* Dal grafico: "2026-08" diventa il periodo mese corrispondente. */
function vaiAlMese(mese) {
  if (!/^\d{4}-\d{2}$/.test(mese)) return;
  const rif = `${mese}-01`;
  if (stato.tipo === 'mese' && stato.rif === rif) return;
  stato.tipo = 'mese';
  stato.rif = rif;
  cambiaPeriodo();
}

/* ============ viste ============ */

function mostraVista(vista) {
  stato.vista = vista;
  $('#vistaRiepilogo').hidden = vista !== 'riepilogo';
  $('#vistaMovimenti').hidden = vista !== 'movimenti';
  aggiornaTabbar();
  if (vista === 'movimenti' && stato.ric.q === '' && (stato.mScaduto || stato.mov === null)) caricaMovimenti();
  window.scrollTo({ top: 0 });
}

/* La barra in basso esiste solo a configurazione fatta. La voce attiva è
   Impostazioni finché quella schermata è aperta, altrimenti la vista. */
function aggiornaTabbar() {
  const visibile = !!(stato.cfg.url && stato.cfg.token);
  $('#tabbar').hidden = !visibile;
  document.body.classList.toggle('con-tabbar', visibile);
  const attiva = $('#schermataConfig').hidden ? stato.vista : 'impostazioni';
  for (const b of $$('#tabbar [data-vista]')) {
    if (b.dataset.vista === attiva) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
}

function vaiAVista(vista) {
  if (vista === 'impostazioni') {
    if ($('#schermataConfig').hidden) apriConfig();
    return;
  }
  if (!$('#schermataConfig').hidden) chiudiConfig();
  if (vista === stato.vista) window.scrollTo({ top: 0, behavior: 'smooth' });
  else mostraVista(vista);
}

/* ---------- trascina per aggiornare ---------- */

const PTR_SOGLIA = 56;
const ptr = { y0: null, d: 0, attesa: false };

function ptrAttivo() {
  return window.scrollY <= 0
    && $('#schermataConfig').hidden
    && $('#blocco').hidden
    && !document.body.classList.contains('bloccato')
    && !ptr.attesa;
}

function ritiraPtr() {
  const i = $('#ptr');
  i.classList.add('rilascio');
  i.classList.remove('pronto', 'gira');
  i.style.transform = '';
  i.style.opacity = '';
}

function collegaPtr() {
  const i = $('#ptr');
  document.addEventListener('touchstart', ev => {
    ptr.y0 = (ev.touches.length === 1 && ptrAttivo()) ? ev.touches[0].clientY : null;
    ptr.d = 0;
  }, { passive: true });

  document.addEventListener('touchmove', ev => {
    if (ptr.y0 === null) return;
    // Resistenza: l'indicatore fa poco più di metà della strada del dito.
    const d = Math.max(0, Math.min((ev.touches[0].clientY - ptr.y0) * 0.6, 96));
    ptr.d = d;
    i.classList.remove('rilascio');
    if (d >= PTR_SOGLIA && !i.classList.contains('pronto')) vibra();
    i.classList.toggle('pronto', d >= PTR_SOGLIA);
    i.style.transform = `translateY(${d - 48}px) rotate(${d * 4}deg)`;
    i.style.opacity = String(Math.min(1, d / PTR_SOGLIA));
  }, { passive: true });

  const fine = () => {
    if (ptr.y0 === null) return;
    ptr.y0 = null;
    if (ptr.d >= PTR_SOGLIA) {
      ptr.attesa = true;
      i.classList.add('rilascio', 'gira');
      i.style.transform = `translateY(${PTR_SOGLIA - 48}px)`;
      i.style.opacity = '1';
      aggiornaManuale();
      aggiornaAggiorna(); // se non è partito nulla, ritira subito
    } else {
      ritiraPtr();
    }
  };
  document.addEventListener('touchend', fine);
  document.addEventListener('touchcancel', fine);
}

/* ---------- sblocco con impronta (solo APK) ---------- */

const GRAZIA_BLOCCO_MS = 60_000;
// Tipi del plugin NativeBiometric: impronta e credenziale del dispositivo.
// Con la seconda il dialogo di sistema offre anche il PIN come alternativa.
const TIPI_SBLOCCO = [3, 7];

const blocco = {
  disponibile: false, // il telefono ha un'impronta o un PIN utilizzabile
  inCorso: false,     // dialogo di sistema aperto: mette l'app in pausa
  uscita: 0,          // quando l'app è andata in background
};

function improntaAttiva() {
  try { return NATIVA && localStorage.getItem(CHIAVI.impronta) === '1'; } catch { return false; }
}

function biometria() {
  return NATIVA ? window.Capacitor.Plugins.NativeBiometric : null;
}

/* Risolve true se l'utente è stato riconosciuto. */
async function verificaImpronta() {
  const b = biometria();
  if (!b || blocco.inCorso) return false;
  blocco.inCorso = true;
  try {
    await b.verifyIdentity({
      title: 'Sblocca Leroy',
      subtitle: 'Usa l\'impronta o il PIN del telefono',
      allowedBiometryTypes: TIPI_SBLOCCO,
    });
    return true;
  } catch {
    return false;
  } finally {
    blocco.inCorso = false;
  }
}

async function chiediSblocco() {
  if (await verificaImpronta()) {
    $('#blocco').hidden = true;
  }
}

function bloccaApp() {
  if (!improntaAttiva()) return;
  chiudiFogli();
  $('#blocco').hidden = false;
  chiediSblocco();
}

/* In background il contenuto si copre subito, così al rientro non compare
   nemmeno per un attimo. Al rientro si chiede l'impronta solo se l'app è
   rimasta via oltre il periodo di grazia. Le pause causate dal dialogo
   dell'impronta stesso non contano. */
function cambioStatoApp({ isActive }) {
  if (!improntaAttiva() || blocco.inCorso) return;
  if (!isActive) {
    blocco.uscita = Date.now();
    $('#blocco').hidden = false;
    return;
  }
  if ($('#blocco').hidden) return;
  if (blocco.uscita && Date.now() - blocco.uscita < GRAZIA_BLOCCO_MS) {
    $('#blocco').hidden = true;
  } else {
    chiediSblocco();
  }
}

async function preparaImpronta() {
  const b = biometria();
  if (!b) return;
  try {
    const r = await b.isAvailable({ useFallback: true });
    blocco.disponibile = !!(r && (r.isAvailable || r.deviceIsSecure));
  } catch {
    blocco.disponibile = false;
  }
  aggiornaSchedaSicurezza();
}

function aggiornaSchedaSicurezza() {
  $('#cfgSicurezza').hidden = !(NATIVA && blocco.disponibile) || !$('#formConfig').hidden;
  $('#cfgImpronta').setAttribute('aria-checked', String(improntaAttiva()));
}

/* Per attivarlo serve un'impronta riuscita: così non ci si chiude fuori
   con un sensore che non funziona. Per disattivarlo basta il tocco. */
async function cambiaImpronta() {
  const btn = $('#cfgImpronta');
  if (improntaAttiva()) {
    try { localStorage.removeItem(CHIAVI.impronta); } catch { /* non bloccante */ }
    toast('Sblocco con impronta disattivato.');
  } else {
    btn.disabled = true;
    const ok = await verificaImpronta();
    btn.disabled = false;
    if (!ok) { toast('Impronta non verificata: sblocco non attivato.', 'errore'); return; }
    try { localStorage.setItem(CHIAVI.impronta, '1'); } catch { /* non bloccante */ }
    vibra('ok');
    toast('Sblocco con impronta attivato.');
  }
  aggiornaSchedaSicurezza();
}

/* ---------- tasto Indietro (solo APK) ---------- */

/* Chiude ciò che è aperto, un livello alla volta. Dalla vista principale
   l'app va in background, come le altre app Android, invece di chiudersi. */
function indietro() {
  if (!$('#blocco').hidden) { window.Capacitor.Plugins.App.minimizeApp(); return; }
  if ($$('.foglio').some(f => f.classList.contains('aperto'))) { chiudiFogli(); return; }

  const configurato = !!(stato.cfg.url && stato.cfg.token);
  if (!$('#schermataConfig').hidden && configurato) {
    if (!$('#formConfig').hidden) {
      $('#cfgAvviso').hidden = true;
      vistaConfig(false);
    } else {
      chiudiConfig();
    }
    return;
  }
  if (configurato && stato.budgetMode) { stato.budgetMode = false; renderRiepilogo(); return; }
  if (configurato && stato.vista !== 'riepilogo') { mostraVista('riepilogo'); return; }
  window.Capacitor.Plugins.App.minimizeApp();
}

function scheletro(righe) {
  return el('div', { class: 'scheletro' },
    el('div', { class: 'sk sk-tot' }),
    el('div', { class: 'sk sk-tit' }),
    Array.from({ length: righe }, () => el('div', { class: 'sk sk-riga' })));
}

function bloccoErrore(messaggio, riprova) {
  return el('div', { class: 'errore' },
    el('p', { text: messaggio }),
    el('button', { class: 'btn', type: 'button', text: 'Riprova', onclick: riprova }));
}

/* ---------- Vista 1: riepilogo ---------- */

function renderRiepilogo() {
  const box = $('#vistaRiepilogo');
  box.replaceChildren();

  if (stato.rStato === 'loading') { box.append(scheletro(5)); return; }
  if (stato.rStato === 'error') { box.append(bloccoErrore(stato.rErrore, caricaRiepilogo)); return; }
  if (!stato.riep) return;

  const r = stato.riep;
  const categorie = Array.isArray(r.categorie) ? r.categorie : [];
  const saldo = num(r.saldo);

  box.append(el('section', { class: 'totali' },
    el('div', { class: 'totali-riga' },
      el('div', { class: 'tot' },
        el('span', { class: 'etichetta', text: 'Entrate' }),
        el('span', { class: 'tot-val positivo', text: eur(r.entrate) })),
      el('div', { class: 'tot' },
        el('span', { class: 'etichetta', text: 'Uscite' }),
        el('span', { class: 'tot-val', text: eur(r.uscite) }))),
    el('div', { class: 'saldo' },
      el('span', { class: 'etichetta', text: 'Saldo' }),
      el('span', {
        class: 'saldo-val' + (saldo > 0 ? ' positivo' : saldo < 0 ? ' negativo' : ''),
        text: eurSegnato(saldo),
      }))));

  const grafico = sezioneAndamento();
  if (grafico) box.append(grafico);

  const daVerificare = Math.trunc(num(r.da_verificare));
  if (daVerificare > 0) {
    box.append(el('button', {
      class: 'banner', type: 'button',
      onclick: () => {
        // Una ricerca attiva coprirebbe il filtro: si azzera.
        azzeraRicerca();
        stato.filtro = { categoria: null, soloDaVerificare: true };
        stato.mScaduto = true;
        mostraVista('movimenti');
      },
    },
      svgIcona('avviso'),
      el('span', { text: `${daVerificare} ${daVerificare === 1 ? 'movimento' : 'movimenti'} da verificare` }),
      svgIcona('freccia', 'freccia')));
  }

  /* --- spese --- */
  const spese = categorie.filter(c => c.tipo === 'spesa').sort((x, y) => num(y.speso) - num(x.speso));
  const modificabile = stato.tipo === 'mese';

  const testa = el('div', { class: 'sezione-head' }, el('h2', { text: 'Spese' }));
  if (modificabile && spese.length) {
    if (!stato.budgetMode) {
      testa.append(el('button', {
        class: 'btn piccolo', type: 'button', text: 'Modifica budget',
        onclick: () => { stato.budgetMode = true; renderRiepilogo(); },
      }));
    } else {
      testa.append(el('div', { class: 'budget-azioni' },
        el('button', {
          class: 'btn piccolo', type: 'button', text: 'Annulla',
          onclick: () => { stato.budgetMode = false; renderRiepilogo(); },
        }),
        el('button', {
          class: 'btn piccolo', type: 'button', text: 'Salva', id: 'btnSalvaBudget',
          onclick: salvaBudget,
        })));
    }
  }

  const sezSpese = el('section', { class: 'sezione' }, testa);
  if (!spese.length) {
    sezSpese.append(el('p', { class: 'vuoto', text: 'Nessuna spesa in questo periodo.' }));
  } else {
    sezSpese.append(el('div', { class: 'cat-lista' }, spese.map(rigaSpesa)));
  }
  box.append(sezSpese);

  /* --- entrate --- */
  const entrate = categorie.filter(c => c.tipo === 'entrata').sort((x, y) => num(y.speso) - num(x.speso));
  if (entrate.length) {
    box.append(el('section', { class: 'sezione' },
      el('div', { class: 'sezione-head' }, el('h2', { text: 'Entrate' })),
      el('div', { class: 'cat-lista' }, entrate.map(c => el('div', { class: 'cat statica' },
        el('div', { class: 'cat-top' },
          el('span', { class: 'cat-nome' }, tileCategoria(c.nome, true), c.nome),
          el('span', { class: 'cat-imp positivo', text: eur(c.speso) })))))));
  }

  /* --- in arrivo --- */
  // Le attese non sono filtrate per periodo dall'API: su un periodo passato il
  // loro totale non avrebbe alcun rapporto con i numeri qui sopra. Si mostrano
  // solo se il periodo contiene oggi o è futuro, confrontando le stringhe ISO.
  const attese = Array.isArray(r.attese) ? r.attese : [];
  const p = periodoStr();
  const periodoPertinente = p >= oggiISO().slice(0, p.length);
  if (attese.length && periodoPertinente) box.append(sezioneAttese(attese, r.attese_totale));
}

/* Andamento delle uscite sugli ultimi 12 mesi conclusi più quello in corso.
   Barre in HTML con altezza in percentuale, niente canvas. */
function sezioneAndamento() {
  const d = stato.and;
  if (!d) return null;
  const mesi = d.mesi.filter(m => m && /^\d{4}-\d{2}$/.test(String(m.mese)));
  if (!mesi.length) return null;

  const meseCorrente = oggiISO().slice(0, 7);
  // Con il periodo su un anno non c'è un mese selezionato da evidenziare.
  const meseScelto = stato.tipo === 'anno' ? null : stato.rif.slice(0, 7);
  const media = Number.isFinite(Number(d.media_uscite)) ? num(d.media_uscite) : null;
  const massimo = Math.max(...mesi.map(m => num(m.uscite)), media || 0);

  const testa = el('div', { class: 'sezione-head' }, el('h2', { text: 'Andamento' }));
  if (media !== null) {
    testa.append(el('span', { class: 'sezione-tot' },
      el('span', { class: 'media-lab', text: 'media ' }),
      document.createTextNode(eur(media))));
  }

  const barre = el('div', { class: 'grafico-barre' });
  if (media !== null && massimo > 0) {
    barre.append(el('div', {
      class: 'grafico-media', 'aria-hidden': 'true',
      style: `bottom:${(media / massimo * 100).toFixed(2)}%`,
    }));
  }

  const etichette = el('div', { class: 'grafico-etichette', 'aria-hidden': 'true' });
  let annoPrec = null;

  for (const m of mesi) {
    const mese = String(m.mese);
    const primoDelMese = `${mese}-01`;
    const uscite = num(m.uscite);
    const parziale = mese === meseCorrente;
    const scelto = mese === meseScelto;
    const alt = massimo > 0 ? Math.max(uscite > 0 ? 2 : 0, uscite / massimo * 100) : 0;
    const nome = FMT_MESE.format(dataLocale(primoDelMese));

    barre.append(el('button', {
      class: 'barra-mese', type: 'button',
      'aria-label': `${nome}: ${eur(uscite)}` + (parziale ? ' (mese in corso, parziale)' : ''),
      'aria-current': scelto ? 'true' : null,
      onclick: () => vaiAlMese(mese),
    }, el('span', {
      class: 'barra-col' + (parziale ? ' parziale' : '') + (scelto ? ' scelto' : ''),
      style: `height:${alt.toFixed(2)}%`,
    })));

    const anno = mese.slice(0, 4);
    etichette.append(el('span', { class: 'etichetta-mese' + (scelto ? ' scelto' : '') },
      el('span', { class: 'lab-m', text: FMT_NARROW.format(dataLocale(primoDelMese)) }),
      el('span', { class: 'lab-a', text: anno === annoPrec ? '' : `'${anno.slice(2)}` })));
    annoPrec = anno;
  }

  return el('section', { class: 'andamento' }, testa,
    el('div', { class: 'grafico' }, barre, etichette));
}

/* Addebiti annunciati e non ancora avvenuti: non entrano nei totali del
   periodo. Si confermano dal bot Telegram, ma da qui si possono correggere. */
function sezioneAttese(attese, totale) {
  const somma = Number.isFinite(Number(totale))
    ? num(totale)
    : attese.reduce((s, a) => s + num(a.importo), 0);

  const oggi = oggiISO();
  const ordinate = attese.slice().sort((x, y) => String(x.data || '').localeCompare(String(y.data || '')));

  return el('section', { class: 'sezione' },
    el('div', { class: 'sezione-head' },
      el('h2', { text: 'In arrivo' }),
      el('span', { class: 'sezione-tot', text: eur(somma) })),
    el('div', { class: 'attese-lista' }, ordinate.map(a => {
      const inRitardo = !!a.data && a.data < oggi;
      const titolo = etichettaBella(a.etichetta) || a.categoria || '(senza descrizione)';

      const tit = el('span', { class: 'attesa-tit' });
      if (inRitardo) tit.append(svgIcona('avviso'));
      tit.append(document.createTextNode(titolo));

      const sub = el('span', { class: 'attesa-sub' });
      sub.append(document.createTextNode([a.categoria, a.data ? dataBreve(a.data) : null]
        .filter(Boolean).join(' · ')));
      if (inRitardo) {
        sub.append(document.createTextNode(' · '));
        sub.append(el('span', { class: 'ritardo-nota', text: 'in ritardo' }));
      }

      return el('button', {
        class: 'attesa' + (inRitardo ? ' in-ritardo' : ''),
        type: 'button',
        onclick: () => apriDettaglio(a, true),
      },
        tileCategoria(a.categoria),
        el('span', { class: 'attesa-main' }, tit, sub),
        el('span', { class: 'attesa-imp', text: eur(a.importo) }));
    })));
}

function rigaSpesa(c) {
  const speso = num(c.speso);
  const budget = num(c.budget);

  const top = el('div', { class: 'cat-top' },
    el('span', { class: 'cat-nome' }, tileCategoria(c.nome, true), c.nome),
    el('span', { class: 'cat-imp', text: eur(speso) }));

  if (stato.budgetMode) {
    return el('div', { class: 'cat statica' }, top,
      el('div', { class: 'budget-riga' },
        el('span', { class: 'etichetta', text: 'Budget mensile' }),
        el('input', {
          class: 'budget-input', type: 'text', inputmode: 'decimal',
          value: budget > 0 ? String(budget).replace('.', ',') : '',
          placeholder: '0',
          'aria-label': `Budget di ${c.nome}`,
          dataset: { cat: c.nome, orig: String(budget) },
        })));
  }

  const nodi = [top];

  if (budget > 0) {
    const perc = speso / budget * 100;
    const colore = perc > 100 ? 'rosso' : perc >= 90 ? 'ambra' : '';
    const sub = el('div', { class: 'cat-sub' },
      el('span', { text: `su ${eur(budget)}` }));
    if (speso > budget) {
      sub.append(el('span', { class: 'cat-oltre', text: `${eur(speso - budget)} oltre` }));
    } else {
      sub.append(el('span', { text: `${Math.round(perc)}%` }));
    }
    nodi.push(sub);
    nodi.push(el('div', { class: 'barra' },
      el('div', {
        class: 'barra-fill' + (colore ? ' ' + colore : ''),
        style: `width:${Math.min(perc, 100).toFixed(1)}%`,
      })));
  } else {
    nodi.push(el('div', { class: 'cat-sub' }, el('span', { text: 'Nessun budget impostato' })));
  }

  return el('button', {
    class: 'cat', type: 'button',
    onclick: () => {
      azzeraRicerca();
      stato.filtro = { categoria: c.nome, soloDaVerificare: false };
      stato.mScaduto = true;
      mostraVista('movimenti');
    },
  }, nodi);
}

async function salvaBudget() {
  const valori = {};
  for (const inp of $$('#vistaRiepilogo .budget-input')) {
    const v = parseImporto(inp.value);
    if (Number.isNaN(v)) {
      toast(`Valore di budget non valido per ${inp.dataset.cat}.`, 'errore');
      inp.focus();
      return;
    }
    const nuovo = v === null ? 0 : v;
    if (nuovo !== num(inp.dataset.orig)) valori[inp.dataset.cat] = nuovo;
  }

  const quante = Object.keys(valori).length;
  if (!quante) {
    stato.budgetMode = false;
    renderRiepilogo();
    toast('Nessuna modifica da salvare.');
    return;
  }

  const btn = $('#btnSalvaBudget');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvo…'; }
  try {
    const d = await api('budget', { valori });
    const n = Number.isFinite(Number(d.aggiornate)) ? Number(d.aggiornate) : quante;
    stato.budgetMode = false;
    vibra('ok');
    toast(`Budget aggiornato: ${n} ${n === 1 ? 'categoria' : 'categorie'}.`);
    caricaRiepilogo();
  } catch (err) {
    if (gestisciAuth(err)) return;
    if (btn) { btn.disabled = false; btn.textContent = 'Salva'; }
    toast(err.message, 'errore');
  }
}

/* ---------- Vista 2: movimenti ---------- */

function renderMovimenti() {
  const box = $('#listaMovimenti');
  box.replaceChildren();
  renderRiepilogoRicerca();

  // Ricerca attiva: la lista mostra i risultati di "cerca", non quelli del periodo.
  if (stato.ric.q !== '') {
    if (stato.ric.stato === 'loading') { box.append(scheletro(6)); return; }
    if (stato.ric.stato === 'error') {
      box.append(bloccoErrore(stato.ric.errore, () => eseguiRicerca(stato.ric.q)));
      return;
    }
    const trovati = (stato.ric.dati && Array.isArray(stato.ric.dati.movimenti)) ? stato.ric.dati.movimenti : [];
    if (!trovati.length) {
      box.append(el('p', { class: 'vuoto', text: `Nessun movimento trovato per «${stato.ric.q}».` }));
      return;
    }
    box.append(...gruppiPerGiorno(trovati));
    return;
  }

  const chips = el('div', { class: 'chips' });
  if (stato.filtro.categoria) {
    chips.append(chip(stato.filtro.categoria, () => {
      stato.filtro.categoria = null;
      caricaMovimenti();
    }));
  }
  if (stato.filtro.soloDaVerificare) {
    chips.append(chip('Da verificare', () => {
      stato.filtro.soloDaVerificare = false;
      caricaMovimenti();
    }));
  }
  if (chips.childElementCount) box.append(chips);

  if (stato.mStato === 'loading') { box.append(scheletro(6)); return; }
  if (stato.mStato === 'error') { box.append(bloccoErrore(stato.mErrore, caricaMovimenti)); return; }

  const movimenti = stato.mov || [];
  if (!movimenti.length) {
    const conFiltro = stato.filtro.categoria || stato.filtro.soloDaVerificare;
    box.append(el('p', {
      class: 'vuoto',
      text: conFiltro
        ? 'Nessun movimento con questo filtro nel periodo selezionato.'
        : 'Nessun movimento in questo periodo.',
    }));
    return;
  }

  box.append(...gruppiPerGiorno(movimenti));
}

/* Lista raggruppata per giorno con intestazione e totale: la usano sia la
   lista del periodo sia i risultati della ricerca. */
function gruppiPerGiorno(movimenti) {
  const gruppi = new Map();
  for (const m of movimenti) {
    const g = m.data || '';
    if (!gruppi.has(g)) gruppi.set(g, []);
    gruppi.get(g).push(m);
  }

  const nodi = [];
  for (const giorno of Array.from(gruppi.keys()).sort().reverse()) {
    const lista = gruppi.get(giorno);
    const totale = lista.reduce((s, m) => s + (m.tipo === 'entrata' ? num(m.importo) : -num(m.importo)), 0);
    nodi.push(el('div', { class: 'giorno-head' },
      el('span', { class: 'giorno-data', text: giorno ? etichettaGiorno(giorno) : 'Senza data' }),
      el('span', { class: 'giorno-tot', text: eurSegnato(totale) })));
    nodi.push(el('div', { class: 'mov-lista' }, lista.map(rigaMovimento)));
  }
  return nodi;
}

/* ---------- ricerca su tutto lo storico ---------- */

let ricTimer = 0;
let ricCtrl = null;

function annullaRicercaInVolo() {
  clearTimeout(ricTimer);
  if (ricCtrl) { ricCtrl.abort(); ricCtrl = null; }
}

/* Digitando: si attende, e una nuova ricerca annulla quella precedente. */
function ricercaDigitata() {
  const q = $('#ricercaQ').value.trim();
  annullaRicercaInVolo();

  if (q === '') {
    stato.ric = { q: '', dati: null, stato: 'idle', errore: '' };
    renderMovimenti();
    if (stato.mov === null || stato.mScaduto) caricaMovimenti();
    return;
  }

  stato.ric.q = q;
  stato.ric.stato = 'loading';
  stato.ric.errore = '';
  renderMovimenti();
  ricTimer = setTimeout(() => eseguiRicerca(q), RITARDO_RICERCA);
}

/* La ricerca ignora il periodo: nessun "da"/"a", è il suo scopo. */
async function eseguiRicerca(q) {
  annullaRicercaInVolo();
  const ctrl = new AbortController();
  ricCtrl = ctrl;

  stato.ric.q = q;
  stato.ric.stato = 'loading';
  stato.ric.errore = '';
  renderMovimenti();

  let errore = null;
  try {
    const d = await api('cerca', { q }, ctrl.signal);
    if (ricCtrl !== ctrl) return;
    stato.ric.dati = d;
    stato.ric.stato = 'ok';
  } catch (err) {
    if (err.annullata || ricCtrl !== ctrl) return;
    errore = err;
    stato.ric.dati = null;
    stato.ric.stato = 'error';
    stato.ric.errore = err.message;
  }
  if (ricCtrl !== ctrl) return;
  ricCtrl = null;
  renderMovimenti();
  if (errore) gestisciAuth(errore);
}

function azzeraRicerca() {
  annullaRicercaInVolo();
  $('#ricercaQ').value = '';
  stato.ric = { q: '', dati: null, stato: 'idle', errore: '' };
}

/* Riga di sintesi e ripartizione per categoria, sotto il campo. */
function renderRiepilogoRicerca() {
  const riga = $('#ricercaRiga');
  const cat = $('#ricercaCat');
  cat.replaceChildren();

  const d = stato.ric.dati;
  if (stato.ric.q === '' || stato.ric.stato !== 'ok' || !d) {
    riga.hidden = true;
    cat.hidden = true;
    return;
  }

  const conteggio = Math.trunc(num(d.conteggio));
  riga.replaceChildren(document.createTextNode(
    `${conteggio} ${conteggio === 1 ? 'movimento' : 'movimenti'} · ${eur(d.totale)} in tutto lo storico`));
  riga.hidden = false;

  const perCat = Array.isArray(d.per_categoria) ? d.per_categoria.filter(c => c && c.nome) : [];
  if (perCat.length < 2) { cat.hidden = true; return; }

  for (const c of perCat.slice().sort((x, y) => num(y.totale) - num(x.totale))) {
    cat.append(el('div', { class: 'ric-cat' },
      el('span', { class: 'ric-cat-nome', text: c.nome }),
      el('span', { class: 'ric-cat-tot', text: eur(c.totale) })));
  }
  cat.hidden = false;
}

function chip(testo, rimuovi) {
  return el('button', {
    class: 'chip', type: 'button', onclick: rimuovi,
    'aria-label': `Rimuovi filtro ${testo}`,
  }, el('span', { text: testo }), svgIcona('x'));
}

function rigaMovimento(m) {
  const entrata = m.tipo === 'entrata';
  const daVerificare = m.stato === 'da_verificare';
  const titolo = etichettaBella(m.etichetta) || m.categoria || '(senza descrizione)';

  const secondaria = [m.categoria, m.conto].filter(Boolean).join(' · ');

  const sub = el('span', { class: 'mov-sub' });
  sub.append(document.createTextNode(secondaria));
  if (m.fonte) {
    sub.append(document.createTextNode(secondaria ? ' · ' : ''));
    sub.append(el('span', { class: 'fonte', text: m.fonte }));
  }

  const tit = el('span', { class: 'mov-tit' });
  if (daVerificare) tit.append(svgIcona('avviso'));
  tit.append(document.createTextNode(titolo));

  return el('button', {
    class: 'mov' + (daVerificare ? ' da-verificare' : ''),
    type: 'button',
    onclick: () => apriDettaglio(m),
  },
    tileCategoria(m.categoria),
    el('span', { class: 'mov-main' }, tit, sub),
    el('span', {
      class: 'mov-imp' + (entrata ? ' entrata' : ''),
      text: (entrata ? '+' : '−') + eur(m.importo),
    }));
}

/* ============ fogli ============ */

function apriFoglio(id) {
  const f = $(id);
  $('#velo').hidden = false;
  f.hidden = false;
  document.body.classList.add('bloccato');
  void f.offsetHeight; // forza il calcolo dello stile: la transizione parte da chiuso
  $('#velo').classList.add('aperto');
  f.classList.add('aperto');
}

function chiudiFogli() {
  const aperti = $$('.foglio').filter(f => !f.hidden);
  if (!aperti.length) {
    $('#velo').hidden = true;
    document.body.classList.remove('bloccato');
    return;
  }
  $('#velo').classList.remove('aperto');
  for (const f of aperti) f.classList.remove('aperto');
  document.body.classList.remove('bloccato');
  setTimeout(() => {
    for (const f of aperti) if (!f.classList.contains('aperto')) f.hidden = true;
    if (!$$('.foglio').some(f => !f.hidden)) $('#velo').hidden = true;
  }, 220);
}

/* ---------- foglio dettaglio / correzione ---------- */

function categorieDi(tipo) {
  const c = stato.config || {};
  const lista = tipo === 'entrata' ? c.categorie_entrata : c.categorie_spesa;
  return Array.isArray(lista) ? lista.filter(x => typeof x === 'string' && x !== '') : [];
}

/* Lo stesso foglio serve i movimenti registrati e le attese: un'attesa si
   corregge, non si conferma, quindi cambiano intestazione, etichetta della
   data, testo del pulsante e lo "stato" inviato a correggi. */
function apriDettaglio(m, attesa = false) {
  stato.movAperto = m;
  stato.dettAttesa = attesa;
  const entrata = m.tipo === 'entrata';

  $('#titDettaglio').textContent = attesa
    ? 'Addebito previsto'
    : ((m.etichetta && String(m.etichetta).trim()) || m.categoria || 'Movimento');

  // L'importo è modificabile, il segno no: lo determina "tipo".
  $('#dettSegno').textContent = entrata ? '+' : '−';
  $('#dettImportoRiga').className = 'dett-importo-riga' + (entrata ? ' entrata' : '');
  $('#dettImporto').value = importoModificabile(m.importo);

  const dl = $('#dettLista');
  dl.replaceChildren();
  const voce = (chiave, valore) => {
    dl.append(el('dt', { text: chiave }));
    dl.append(el('dd', {}, valore));
  };
  if (attesa) {
    // L'API non manda conto, fonte e stato per le attese: si omettono.
    const descrizione = m.etichetta && String(m.etichetta).trim();
    if (descrizione) voce('Descrizione', descrizione);
    voce('Data prevista', m.data ? etichettaGiorno(m.data) : '—');
    voce('Tipo', entrata ? 'Entrata' : 'Spesa');
  } else {
    voce('Data', m.data ? etichettaGiorno(m.data) : '—');
    voce('Tipo', entrata ? 'Entrata' : 'Spesa');
    voce('Conto', m.conto || '—');
    voce('Fonte', m.fonte || '—');
    voce('Stato', m.stato === 'da_verificare'
      ? el('span', { class: 'badge', text: 'Da verificare' })
      : document.createTextNode('Confermata'));
  }

  const sel = $('#dettCategoria');
  sel.replaceChildren();
  const opzioni = categorieDi(m.tipo);
  if (m.categoria && !opzioni.includes(m.categoria)) opzioni.unshift(m.categoria);
  if (!opzioni.length) sel.append(el('option', { value: '', text: 'Nessuna categoria disponibile' }));
  for (const nome of opzioni) sel.append(el('option', { value: nome, text: nome }));
  sel.value = m.categoria || (opzioni[0] || '');

  $('#dettErrore').hidden = true;
  $('#dettConferma').textContent = etichettaSalva();
  const btnElimina = $('#dettElimina');
  btnElimina.textContent = 'Elimina';
  btnElimina.disabled = false;
  validaDettaglio();

  apriFoglio('#foglioDettaglio');
}

const etichettaSalva = () => (stato.dettAttesa ? 'Salva' : 'Conferma');

/* Le attese arrivano dentro la risposta di riepilogo: è quello il caricamento
   che le rinfresca. I movimenti registrati stanno nella lista dei movimenti. */
function ricaricaDopoDettaglio() {
  if (stato.dettAttesa) {
    aggiornaTutto();
  } else {
    caricaRiepilogo();
    caricaMovimenti();
  }
}

function validaImportoDett() {
  const v = parseImporto($('#dettImporto').value);
  return (v !== null && !Number.isNaN(v) && v > 0) ? v : null;
}

function validaDettaglio() {
  const ok = validaImportoDett() !== null && $('#dettCategoria').value !== '';
  $('#dettConferma').disabled = !ok;
}

async function confermaMovimento() {
  const m = stato.movAperto;
  if (!m) return;
  const categoria = $('#dettCategoria').value;
  const errore = $('#dettErrore');
  errore.hidden = true;

  if (!categoria) {
    errore.textContent = 'Scegli una categoria prima di confermare.';
    errore.hidden = false;
    return;
  }

  // Sempre inviato, anche se non toccato: qui il campo parte dal valore corrente.
  const importo = validaImportoDett();
  if (importo === null) {
    errore.textContent = 'Inserisci un importo maggiore di zero.';
    errore.hidden = false;
    $('#dettImporto').focus();
    return;
  }

  const btn = $('#dettConferma');
  const btnElimina = $('#dettElimina');
  btn.disabled = true;
  btnElimina.disabled = true;
  btn.textContent = 'Invio…';
  try {
    // Un'attesa resta un'attesa: con "confermata" il sistema la darebbe per
    // avvenuta, entrerebbe nei totali del mese e non verrebbe più riconciliata
    // quando l'addebito arriva davvero.
    const nuovoStato = stato.dettAttesa ? 'attesa' : 'confermata';
    await api('correggi', { hash: m.hash, categoria, stato: nuovoStato, importo });
    chiudiFogli();
    vibra('ok');
    toast(stato.dettAttesa ? 'Addebito previsto aggiornato.' : 'Movimento confermato.');
    ricaricaDopoDettaglio();
  } catch (err) {
    btn.textContent = etichettaSalva();
    btnElimina.disabled = false;
    validaDettaglio();
    if (gestisciAuth(err)) return;
    errore.textContent = err.message;
    errore.hidden = false;
  }
}

async function eliminaMovimento() {
  const m = stato.movAperto;
  if (!m) return;
  const errore = $('#dettErrore');
  errore.hidden = true;

  const descrizione = (m.etichetta && String(m.etichetta).trim()) || m.categoria || 'questo movimento';
  const conferma = confirm(
    `Eliminare "${descrizione}" da ${eur(m.importo)}? L'operazione non è reversibile dall'app.`);
  if (!conferma) return;

  const btn = $('#dettConferma');
  const btnElimina = $('#dettElimina');
  btn.disabled = true;
  btnElimina.disabled = true;
  btnElimina.textContent = 'Elimino…';
  try {
    await api('elimina', { hash: m.hash });
    chiudiFogli();
    vibra('ok');
    toast(stato.dettAttesa ? 'Addebito previsto eliminato.' : 'Movimento eliminato.');
    ricaricaDopoDettaglio();
  } catch (err) {
    btnElimina.textContent = 'Elimina';
    btnElimina.disabled = false;
    validaDettaglio();
    if (gestisciAuth(err)) return;
    errore.textContent = err.message;
    errore.hidden = false;
  }
}

/* ---------- foglio inserimento ---------- */

function aggiornaFab() {
  $('#fab').disabled = !stato.config;
}

function popolaCategorieIns() {
  const tipo = $$('#insTipo .seg').find(b => b.classList.contains('attivo')).dataset.tipo;
  const sel = $('#insCategoria');
  const precedente = sel.value;
  sel.replaceChildren(el('option', { value: '', text: 'Scegli…' }));
  for (const nome of categorieDi(tipo)) sel.append(el('option', { value: nome, text: nome }));
  if (precedente && categorieDi(tipo).includes(precedente)) sel.value = precedente;
  else sel.value = '';
  stato.insCatTutte = false;
  renderGrigliaCategorie();
}

const CAT_IN_EVIDENZA = 8;

function leggiUsoCategorie() {
  try { return JSON.parse(localStorage.getItem(CHIAVI.usoCategorie) || '{}') || {}; } catch { return {}; }
}

function contaUsoCategoria(nome) {
  const uso = leggiUsoCategorie();
  uso[nome] = (Number(uso[nome]) || 0) + 1;
  try { localStorage.setItem(CHIAVI.usoCategorie, JSON.stringify(uso)); } catch { /* non bloccante */ }
}

/* Prima le categorie che usi di più da questo dispositivo, poi quelle con
   più spesa nel periodo aperto, poi l'ordine della configurazione. */
function categorieOrdinate(tipo) {
  const uso = leggiUsoCategorie();
  const speso = {};
  for (const c of (stato.riep && Array.isArray(stato.riep.categorie)) ? stato.riep.categorie : []) {
    speso[c.nome] = num(c.speso);
  }
  const base = categorieDi(tipo);
  return base.slice().sort((a, b) =>
    (Number(uso[b]) || 0) - (Number(uso[a]) || 0)
    || (speso[b] || 0) - (speso[a] || 0)
    || base.indexOf(a) - base.indexOf(b));
}

function renderGrigliaCategorie() {
  const tipo = $$('#insTipo .seg').find(b => b.classList.contains('attivo')).dataset.tipo;
  const sel = $('#insCategoria');
  const tutte = categorieOrdinate(tipo);
  // Se la categoria scelta sta oltre le prime, la griglia si apre tutta.
  const aperta = stato.insCatTutte || tutte.indexOf(sel.value) >= CAT_IN_EVIDENZA;
  const visibili = aperta ? tutte : tutte.slice(0, CAT_IN_EVIDENZA);

  const griglia = $('#insCatGriglia');
  griglia.replaceChildren(...visibili.map(nome => el('button', {
    class: 'cat-chip', type: 'button', role: 'radio',
    'aria-checked': String(sel.value === nome),
    onclick: () => {
      sel.value = nome;
      vibra();
      renderGrigliaCategorie();
      validaInserisci();
    },
  }, tileCategoria(nome, true), el('span', { text: nome }))));

  if (!aperta && tutte.length > CAT_IN_EVIDENZA) {
    griglia.append(el('button', {
      class: 'cat-chip altre', type: 'button',
      text: `Altre ${tutte.length - CAT_IN_EVIDENZA}`,
      onclick: () => { stato.insCatTutte = true; renderGrigliaCategorie(); },
    }));
  }
}

function apriInserisci() {
  if (!stato.config) {
    toast('Dati di configurazione non disponibili: aggiorna il riepilogo.', 'errore');
    return;
  }

  $('#formInserisci').reset();
  for (const b of $$('#insTipo .seg')) b.classList.toggle('attivo', b.dataset.tipo === 'spesa');
  popolaCategorieIns();

  const conti = Array.isArray(stato.config.conti) ? stato.config.conti.filter(c => typeof c === 'string' && c) : [];
  const selConto = $('#insConto');
  selConto.replaceChildren();
  if (!conti.length) selConto.append(el('option', { value: '', text: 'Nessun conto disponibile' }));
  for (const c of conti) selConto.append(el('option', { value: c, text: c }));
  selConto.value = conti.includes('banca') ? 'banca' : (conti[0] || '');

  $('#insData').value = oggiISO();
  $('#insErrore').hidden = true;
  $('#insInvia').textContent = 'Aggiungi';
  validaInserisci();

  apriFoglio('#foglioInserisci');
  const importo = $('#insImporto');
  importo.focus();
  try { importo.setSelectionRange(0, 0); } catch { /* niente */ }
}

function validaImportoIns() {
  const v = parseImporto($('#insImporto').value);
  return (v !== null && !Number.isNaN(v) && v > 0) ? v : null;
}

function validaInserisci() {
  const ok = validaImportoIns() !== null && $('#insCategoria').value !== '' && $('#insConto').value !== '';
  $('#insInvia').disabled = !ok;
}

async function inviaInserisci(ev) {
  ev.preventDefault();
  const importo = validaImportoIns();
  const categoria = $('#insCategoria').value;
  const conto = $('#insConto').value;
  const errore = $('#insErrore');
  errore.hidden = true;

  if (importo === null || !categoria || !conto) { validaInserisci(); return; }

  const tipo = $$('#insTipo .seg').find(b => b.classList.contains('attivo')).dataset.tipo;
  const data = $('#insData').value || oggiISO();

  const btn = $('#insInvia');
  btn.disabled = true;
  btn.textContent = 'Invio…';

  try {
    const d = await api('inserisci', {
      importo, tipo, categoria, conto, data,
      esercente: $('#insDescrizione').value.trim(),
      note: '',
    });
    contaUsoCategoria(categoria);
    vibra('ok');
    chiudiFogli();
    if (d.duplicato_sospetto) {
      toast('Movimento aggiunto. Attenzione: esiste un movimento simile registrato di recente.', 'avviso');
    } else {
      toast('Movimento aggiunto.');
    }
    aggiornaTutto();
  } catch (err) {
    if (gestisciAuth(err)) return;
    errore.textContent = err.message;
    errore.hidden = false;
    btn.textContent = 'Aggiungi';
    validaInserisci();
  }
}

/* ============ modalità privacy ============ */

function leggiPrivacy() {
  try { stato.privacy = localStorage.getItem(CHIAVI.privacy) === '1'; } catch { stato.privacy = false; }
}

function aggiornaBottonePrivacy() {
  const b = $('#btnPrivacy');
  const etichetta = stato.privacy ? 'Mostra importi' : 'Nascondi importi';
  b.setAttribute('aria-pressed', String(stato.privacy));
  b.setAttribute('aria-label', etichetta);
  b.title = etichetta;
  $('.ico-occhio', b).hidden = stato.privacy;
  $('.ico-occhio-off', b).hidden = !stato.privacy;
}

/* Nessuna chiamata all'API: i dati sono già in memoria, si ridisegna. */
function cambiaPrivacy() {
  stato.privacy = !stato.privacy;
  try { localStorage.setItem(CHIAVI.privacy, stato.privacy ? '1' : '0'); } catch { /* non bloccante */ }
  aggiornaBottonePrivacy();
  renderRiepilogo();
  renderMovimenti();
}

/* ============ toast ============ */

let toastTimer = 0;
let toastTimer2 = 0;

function toast(messaggio, tipo = '') {
  const t = $('#toast');
  clearTimeout(toastTimer);
  clearTimeout(toastTimer2);
  t.textContent = messaggio;
  t.className = 'toast' + (tipo ? ' ' + tipo : '');
  t.hidden = false;
  void t.offsetHeight;
  t.classList.add('visibile');
  toastTimer = setTimeout(() => {
    t.classList.remove('visibile');
    toastTimer2 = setTimeout(() => { t.hidden = true; }, 200);
  }, tipo ? 6000 : 3000);
}

/* ============ avvio ============ */

function collegaEventi() {
  $('#tipoSel').addEventListener('click', ev => {
    const b = ev.target.closest('.seg');
    if (!b) return;
    cambiaTipo(b.dataset.tipo);
    chiudiFogli();
  });
  $('#btnOggi').addEventListener('click', () => { vaiAOggi(); chiudiFogli(); });
  $('#periodoPrec').addEventListener('click', () => spostaPeriodo(-1));
  $('#periodoSucc').addEventListener('click', () => spostaPeriodo(1));
  $('#periodoLabel').addEventListener('click', () => apriFoglio('#foglioPeriodo'));
  $('#btnPrivacy').addEventListener('click', cambiaPrivacy);

  $('#tabbar').addEventListener('click', ev => {
    const b = ev.target.closest('[data-vista]');
    if (b) vaiAVista(b.dataset.vista);
  });
  collegaPtr();
  if (NATIVA && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', indietro);
    window.Capacitor.Plugins.App.addListener('appStateChange', cambioStatoApp);
  }
  $('#cfgImpronta').addEventListener('click', cambiaImpronta);
  $('#btnSblocca').addEventListener('click', chiediSblocco);

  $('#ricercaQ').addEventListener('input', ricercaDigitata);
  $('#ricercaQ').addEventListener('search', ricercaDigitata);   // la "x" nativa del campo

  $('#fab').addEventListener('click', apriInserisci);

  $('#velo').addEventListener('click', chiudiFogli);
  for (const b of $$('[data-chiudi]')) b.addEventListener('click', chiudiFogli);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') chiudiFogli();
  });

  $('#insTipo').addEventListener('click', ev => {
    const b = ev.target.closest('.seg');
    if (!b || b.classList.contains('attivo')) return;
    for (const x of $$('#insTipo .seg')) x.classList.toggle('attivo', x === b);
    popolaCategorieIns();
    validaInserisci();
  });
  $('#insImporto').addEventListener('input', validaInserisci);
  $('#insCategoria').addEventListener('change', validaInserisci);
  $('#insConto').addEventListener('change', validaInserisci);
  $('#formInserisci').addEventListener('submit', inviaInserisci);

  $('#dettImporto').addEventListener('input', validaDettaglio);
  $('#dettCategoria').addEventListener('change', validaDettaglio);
  $('#dettConferma').addEventListener('click', confermaMovimento);
  $('#dettElimina').addEventListener('click', eliminaMovimento);

  $('#formConfig').addEventListener('submit', ev => {
    ev.preventDefault();
    const url = $('#cfgUrl').value.trim();
    const token = $('#cfgToken').value.trim();
    const errore = $('#cfgErrore');
    errore.hidden = true;

    // Solo https: il token viaggia in questo header, in chiaro andrebbe
    // esposto a chiunque sia sul percorso. Eccezione per lo sviluppo locale.
    let u;
    try { u = new URL(url); } catch { u = null; }
    const locale = u && ['localhost', '127.0.0.1'].includes(u.hostname);
    if (!u || (u.protocol !== 'https:' && !locale)) {
      errore.textContent = "L'indirizzo deve iniziare con https://";
      errore.hidden = false;
      return;
    }
    // Nell'APK l'app vive su https://localhost: l'API è per forza altrove.
    if (!NATIVA && u.origin !== window.location.origin) {
      errore.textContent = "L'API deve stare sullo stesso dominio dell'app.";
      errore.hidden = false;
      return;
    }
    if (!token) {
      errore.textContent = 'Il token è obbligatorio.';
      errore.hidden = false;
      return;
    }

    // Le credenziali Access sono facoltative (servono solo quando il bypass
    // è stato tolto), ma vanno in coppia.
    const accessId = NATIVA ? $('#cfgAccessId').value.trim() : '';
    const accessSecret = NATIVA ? $('#cfgAccessSecret').value.trim() : '';
    if (!accessId !== !accessSecret) {
      errore.textContent = 'Client ID e Client Secret di Access vanno inseriti entrambi, o nessuno dei due.';
      errore.hidden = false;
      return;
    }

    try {
      localStorage.setItem(CHIAVI.url, url);
      localStorage.setItem(CHIAVI.token, token);
      localStorage.setItem(CHIAVI.accessId, accessId);
      localStorage.setItem(CHIAVI.accessSecret, accessSecret);
    } catch {
      errore.textContent = 'Impossibile salvare la configurazione in questo browser.';
      errore.hidden = false;
      return;
    }
    leggiConfig();
    stato.connessione = null; // credenziali nuove: l'esito precedente non vale più
    chiudiConfig();
    toast('Configurazione salvata.');
    stato.mScaduto = true;
    aggiornaManuale();
  });

  for (const b of $$('[data-vedi]')) {
    b.addEventListener('click', () => {
      const i = $('#' + b.dataset.vedi);
      const visibile = i.type === 'text';
      i.type = visibile ? 'password' : 'text';
      b.textContent = visibile ? 'Mostra' : 'Nascondi';
    });
  }

  $('#cfgModifica').addEventListener('click', () => vistaConfig(true));
  $('#cfgAnnulla').addEventListener('click', () => {
    $('#cfgAvviso').hidden = true;
    vistaConfig(false);
  });


  $('#cfgCancella').addEventListener('click', () => {
    if (!confirm('Cancellare URL e token salvati su questo dispositivo?')) return;
    localStorage.removeItem(CHIAVI.url);
    localStorage.removeItem(CHIAVI.token);
    localStorage.removeItem(CHIAVI.accessId);
    localStorage.removeItem(CHIAVI.accessSecret);
    stato.cfg = { url: '', token: '', accessId: '', accessSecret: '' };
    stato.riep = null; stato.rStato = 'idle';
    stato.config = null;
    stato.and = null;
    stato.mov = null; stato.mStato = 'idle'; stato.mScaduto = true;
    azzeraRicerca();
    aggiornaFab();
    apriConfig('Configurazione cancellata.');
  });
}

function avvia() {
  $('#versione').textContent = `Finanze ${VERSIONE}`;
  caricaStatoPeriodo();
  leggiPrivacy();
  aggiornaBarra();
  aggiornaBottonePrivacy();
  collegaEventi();
  aggiornaFab();
  bloccaApp();
  preparaImpronta();

  if (!leggiConfig()) {
    apriConfig();
  } else {
    chiudiConfig();
    aggiornaManuale();
  }

  // Nell'APK gli asset sono già nel pacchetto: il service worker non serve.
  if (!NATIVA && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // updateViaCache: 'none' — sw.js va sempre riletto dalla rete, altrimenti
      // la cache HTTP può nascondere il cambio di versione.
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .catch(() => { /* non bloccante */ });
    });
  }
}

avvia();
