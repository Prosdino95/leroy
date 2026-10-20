/* Copia la PWA di ../app in www/, la cartella che Capacitor impacchetta.
   app/ resta l'unica sorgente: qui non si modifica nulla a mano.
   Il service worker resta fuori: nell'APK gli asset sono già locali e una
   cache in più servirebbe solo a mostrare versioni vecchie. */

import { cpSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const qui = dirname(fileURLToPath(import.meta.url));
const sorgente = join(qui, '..', 'app');
const destinazione = join(qui, 'www');
const ESCLUSI = new Set(['sw.js', '.DS_Store']);

rmSync(destinazione, { recursive: true, force: true });
cpSync(sorgente, destinazione, {
  recursive: true,
  filter: p => !ESCLUSI.has(basename(p)),
});

console.log(`www/ preparata da ${sorgente}`);
