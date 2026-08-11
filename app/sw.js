/* Finanze — service worker.
   Mette in cache solo lo shell (cache-first). Tutto il resto, API compresa,
   passa sempre dalla rete. Nessuna cache sulle richieste POST. */

/* ATTENZIONE: incrementa VERSIONE a ogni deploy.
   La strategia è cache-first su index.html e app.js: se sw.js resta identico
   il browser non reinstalla nulla e continui a vedere la versione precedente
   anche dopo aver copiato i file nuovi sul server. */
const VERSIONE = 'v1.4.0';
const CACHE = `finanze-shell-${VERSIONE}`;
const PREFISSO = 'finanze-shell-';

/* Percorsi relativi: l'app è servita sotto /app/, non alla radice. */
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

const percorsiShell = new Set(SHELL.map(p => new URL(p, self.registration.scope).pathname));

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    for (const nome of await caches.keys()) {
      if (nome !== CACHE && nome.startsWith(PREFISSO)) await caches.delete(nome);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', ev => {
  const req = ev.request;

  // Le POST (tutte le chiamate all'API) non vengono mai intercettate.
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  // Solo i file dello shell: qualsiasi altra richiesta va in rete.
  if (!percorsiShell.has(url.pathname)) return;

  ev.respondWith((async () => {
    const inCache = await caches.match(req, { ignoreSearch: true });
    if (inCache) return inCache;
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  })());
});
