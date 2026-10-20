# Leroy — APK Android

Guscio [Capacitor](https://capacitorjs.com) che impacchetta la PWA di `../app`
in un'app Android installabile. Il codice dell'interfaccia resta uno solo:
`app/` è la sorgente, `www/` è una copia generata a ogni build.

## Cosa cambia rispetto alla PWA

`app.js` riconosce da solo se gira dentro l'APK (`window.Capacitor`). In quel
caso:

- le chiamate all'API passano dal client HTTP nativo (`CapacitorHttp`), non da
  `fetch`: niente CORS, e la CSP della pagina non le riguarda;
- ogni richiesta porta, oltre a `x-push-token`, gli header del service token di
  Cloudflare Access (`CF-Access-Client-Id`, `CF-Access-Client-Secret`);
- i redirect non vengono seguiti: se Access rifiuta le credenziali e rimanda al
  login, l'app lo segnala invece di ricevere una pagina HTML;
- l'API può stare su un dominio diverso da quello dell'app (che nell'APK è
  `https://localhost`);
- il service worker non viene registrato;
- il tasto Indietro di Android (plugin `@capacitor/app`) chiude un livello
  alla volta: foglio aperto, modifica della connessione, impostazioni,
  modifica budget, vista Movimenti. Dal Riepilogo manda l'app in background;
- sblocco con impronta (plugin `@capgo/capacitor-native-biometric`), da
  attivare nelle impostazioni: all'apertura e dopo un minuto in background
  l'app chiede l'impronta, con il PIN del telefono come alternativa;
- l'app resta in verticale, come la PWA;
- una vibrazione breve (plugin `@capacitor/haptics`) conferma i salvataggi,
  la scelta di una categoria e la soglia del trascina per aggiornare.

`MainActivity` disattiva l'effetto elastico del WebView sul bordo (Android
12+), che altrimenti allungherebbe tutta la pagina durante il trascina per
aggiornare.

Nel browser il comportamento è identico a prima.

`loggingBehavior: "none"` in `capacitor.config.json` non va tolto: anche nelle
build di debug Capacitor scriverebbe in logcat ogni richiesta, header (token e
secret di Access) compresi.

L'icona è adattiva e vettoriale (`res/drawable/ic_launcher_foreground.xml`,
ricavata da `app/icon-512.svg`), con livello monocromatico per le icone a tema.
Le PNG in `res/mipmap-*` servono solo ad Android 7.

Le credenziali stanno nello storage della WebView, nella sandbox privata
dell'app. Backup cloud e trasferimento a un nuovo dispositivo sono disattivati
(`allowBackup="false"` e `res/xml/data_extraction_rules.xml`): su un telefono
nuovo si reinseriscono a mano.

## Build

Requisiti: Node, JDK 21, Android SDK 36.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
npm install
npm run apk
```

`android/local.properties` (non versionato) deve puntare all'SDK, ad esempio
`sdk.dir=/opt/homebrew/share/android-commandlinetools`.

L'APK di debug finisce in `android/app/build/outputs/apk/debug/app-debug.apk`.
Installazione su un telefono collegato via USB:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Dopo ogni modifica a `app/` basta rilanciare `npm run apk`.

## Primo avvio

Nella schermata di configurazione:

- **URL dell'API** e **Token**: gli stessi della PWA;
- **Access Client ID** e **Access Client Secret**: quelli del service token
  (vedi sotto). Si possono lasciare vuoti finché il bypass è ancora attivo.

## Cloudflare Access

1. *Zero Trust → Access → Service credentials → Service Tokens*: crea un token
   (es. `leroy-apk`). Client ID e Secret si vedono una volta sola.
2. Nell'applicazione Access che copre l'API aggiungi una policy con azione
   **Service Auth** che include quel service token.
3. Prova l'app con le credenziali inserite, poi togli la policy di **Bypass**
   dal path dell'API.

Attenzione alla PWA nel browser: senza bypass, `fetch` verso l'API passa solo
se il browser ha già un cookie di Access valido *per quell'applicazione*. Il
modo più semplice è mettere `/app` e il path dell'API nella **stessa**
applicazione Access, con due policy: *Allow* per la tua email (browser) e
*Service Auth* per il token (APK).

I webhook che non possono mandare header (Telegram) restano in bypass, ognuno
solo sul proprio path. MacroDroid invece può aggiungere gli stessi due header e
passare anche lui dal service token.

Se il telefono va perso: revoca o ruota il service token dalla dashboard e
cambia `x-push-token` in n8n.
