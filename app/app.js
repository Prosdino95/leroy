/* Finanze — PWA per finanze personali.
   Vanilla JS, modulo ES nativo, nessuna dipendenza esterna.
   Parla solo con l'API descritta nella specifica: un unico POST con
   header x-push-token e campo "azione" come router. */

const VERSIONE = '1.4.0';
const TIMEOUT_MS = 15000;

const CHIAVI = {
  url: 'finanze.api_url',
  token: 'finanze.token',
  periodo: 'finanze.periodo',
};

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
const eur = v => NF_EUR.format(num(v));

function eurSegnato(v) {
  const n = num(v);
  const segno = n > 0 ? '+' : n < 0 ? '−' : '';
  return segno + NF_EUR.format(Math.abs(n));
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
  cfg: { url: '', token: '' },
  tipo: 'mese',
  rif: oggiISO(),
  vista: 'riepilogo',

  riep: null, rStato: 'idle', rErrore: '',
  config: null,
  budgetMode: false,
  and: null,        // serie a 12 mesi: non dipende dal periodo selezionato

  mov: null, mStato: 'idle', mErrore: '', mScaduto: true,
  filtro: { categoria: null, soloDaVerificare: false },

  movAperto: null,
  dettAttesa: false,
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
  }
}

async function api(azione, corpo = {}) {
  if (!stato.cfg.url || !stato.cfg.token) {
    throw new ErroreApi('Configurazione mancante: inserisci URL e token.', { auth: true });
  }

  const ctrl = new AbortController();
  let scaduto = false;
  const timer = setTimeout(() => { scaduto = true; ctrl.abort(); }, TIMEOUT_MS);

  let res;
  try {
    res = await fetch(stato.cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-push-token': stato.cfg.token },
      body: JSON.stringify({ azione, ...corpo }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch {
    if (scaduto) {
      throw new ErroreApi(`La richiesta ha superato i ${TIMEOUT_MS / 1000} secondi senza risposta.`, { timeout: true });
    }
    throw new ErroreApi("Impossibile raggiungere l'API. Controlla la rete e l'URL configurato.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new ErroreApi(`L'API ha rifiutato il token (HTTP ${res.status}). Controlla URL e token.`, { auth: true });
  }

  const testo = await res.text();
  let dati = null;
  if (testo.trim() !== '') {
    try { dati = JSON.parse(testo); } catch { dati = null; }
  }

  if (!res.ok) {
    throw new ErroreApi((dati && dati.errore) || `L'API ha risposto con errore HTTP ${res.status}.`);
  }
  if (dati === null) {
    throw new ErroreApi("Risposta non leggibile dall'API (JSON non valido).");
  }
  if (dati.ok === false) {
    throw new ErroreApi(dati.errore || "L'API ha segnalato un errore non specificato.");
  }
  return dati;
}

/* ============ configurazione ============ */

function leggiConfig() {
  stato.cfg.url = (localStorage.getItem(CHIAVI.url) || '').trim();
  stato.cfg.token = (localStorage.getItem(CHIAVI.token) || '').trim();
  return !!(stato.cfg.url && stato.cfg.token);
}

function apriConfig(messaggio = '') {
  $('#cfgUrl').value = stato.cfg.url;
  $('#cfgToken').value = stato.cfg.token;
  $('#cfgErrore').hidden = true;

  const primaVolta = !(stato.cfg.url && stato.cfg.token);
  $('#cfgTitolo').textContent = primaVolta ? 'Configurazione' : 'Impostazioni';
  $('#cfgChiudi').hidden = primaVolta;
  $('#cfgIntro').hidden = !primaVolta;

  const avviso = $('#cfgAvviso');
  avviso.textContent = messaggio;
  avviso.hidden = !messaggio;

  chiudiFogli();
  $('#schermataConfig').hidden = false;
  $('#app').hidden = true;
}

function chiudiConfig() {
  $('#schermataConfig').hidden = true;
  $('#app').hidden = false;
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

function aggiornaAggiorna() {
  $('#btnAggiorna').disabled = inCaricamento();
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
}

/* ============ barra del periodo ============ */

function aggiornaBarra() {
  $('#periodoLabel').textContent = periodoEtichetta();
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
  for (const t of $$('#tabs .tab')) {
    t.setAttribute('aria-selected', String(t.dataset.vista === vista));
  }
  if (vista === 'movimenti' && (stato.mScaduto || stato.mov === null)) caricaMovimenti();
  window.scrollTo({ top: 0 });
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
          el('span', { class: 'cat-nome', text: c.nome }),
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
      const titolo = (a.etichetta && String(a.etichetta).trim()) || a.categoria || '(senza descrizione)';

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
        el('span', { class: 'attesa-main' }, tit, sub),
        el('span', { class: 'attesa-imp', text: eur(a.importo) }));
    })));
}

function rigaSpesa(c) {
  const speso = num(c.speso);
  const budget = num(c.budget);

  const top = el('div', { class: 'cat-top' },
    el('span', { class: 'cat-nome', text: c.nome }),
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
  const box = $('#vistaMovimenti');
  box.replaceChildren();

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

  const gruppi = new Map();
  for (const m of movimenti) {
    const g = m.data || '';
    if (!gruppi.has(g)) gruppi.set(g, []);
    gruppi.get(g).push(m);
  }

  const giorni = Array.from(gruppi.keys()).sort().reverse();
  for (const giorno of giorni) {
    const lista = gruppi.get(giorno);
    const totale = lista.reduce((s, m) => s + (m.tipo === 'entrata' ? num(m.importo) : -num(m.importo)), 0);
    box.append(el('div', { class: 'giorno-head' },
      el('span', { class: 'giorno-data', text: giorno ? etichettaGiorno(giorno) : 'Senza data' }),
      el('span', { class: 'giorno-tot', text: eurSegnato(totale) })));
    box.append(el('div', { class: 'mov-lista' }, lista.map(rigaMovimento)));
  }
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
  const titolo = (m.etichetta && String(m.etichetta).trim()) || m.categoria || '(senza descrizione)';

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
    if (b) cambiaTipo(b.dataset.tipo);
  });
  $('#periodoPrec').addEventListener('click', () => spostaPeriodo(-1));
  $('#periodoSucc').addEventListener('click', () => spostaPeriodo(1));
  $('#periodoLabel').addEventListener('click', vaiAOggi);
  $('#btnAggiorna').addEventListener('click', aggiornaManuale);
  $('#btnImpostazioni').addEventListener('click', () => apriConfig());

  $('#tabs').addEventListener('click', ev => {
    const t = ev.target.closest('.tab');
    if (t) mostraVista(t.dataset.vista);
  });

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
    if (u.origin !== window.location.origin) {
      errore.textContent = "L'API deve stare sullo stesso dominio dell'app.";
      errore.hidden = false;
      return;
    }
    if (!token) {
      errore.textContent = 'Il token è obbligatorio.';
      errore.hidden = false;
      return;
    }

    try {
      localStorage.setItem(CHIAVI.url, url);
      localStorage.setItem(CHIAVI.token, token);
    } catch {
      errore.textContent = 'Impossibile salvare la configurazione in questo browser.';
      errore.hidden = false;
      return;
    }
    leggiConfig();
    chiudiConfig();
    toast('Configurazione salvata.');
    stato.mScaduto = true;
    aggiornaManuale();
  });

  $('#cfgVedi').addEventListener('click', () => {
    const i = $('#cfgToken');
    const visibile = i.type === 'text';
    i.type = visibile ? 'password' : 'text';
    $('#cfgVedi').textContent = visibile ? 'Mostra' : 'Nascondi';
  });

  $('#cfgChiudi').addEventListener('click', chiudiConfig);

  $('#cfgCancella').addEventListener('click', () => {
    if (!confirm('Cancellare URL e token salvati su questo dispositivo?')) return;
    localStorage.removeItem(CHIAVI.url);
    localStorage.removeItem(CHIAVI.token);
    stato.cfg = { url: '', token: '' };
    stato.riep = null; stato.rStato = 'idle';
    stato.config = null;
    stato.and = null;
    stato.mov = null; stato.mStato = 'idle'; stato.mScaduto = true;
    aggiornaFab();
    apriConfig('Configurazione cancellata.');
  });
}

function avvia() {
  $('#versione').textContent = `Finanze ${VERSIONE}`;
  caricaStatoPeriodo();
  aggiornaBarra();
  collegaEventi();
  aggiornaFab();

  if (!leggiConfig()) {
    apriConfig();
  } else {
    chiudiConfig();
    aggiornaManuale();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // updateViaCache: 'none' — sw.js va sempre riletto dalla rete, altrimenti
      // la cache HTTP può nascondere il cambio di versione.
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .catch(() => { /* non bloccante */ });
    });
  }
}

avvia();
