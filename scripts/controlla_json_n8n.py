#!/usr/bin/env python3
"""
Controllo dei secret negli export JSON di n8n, da lanciare prima del commit.

Uso:
    python controlla_json_n8n.py n8n/*.json
        Solo controllo. Esce con 1 se trova qualcosa di bloccante.

    python controlla_json_n8n.py --pulisci cartella_pulita n8n/*.json
        Scrive in cartella_pulita/ copie con i valori sostituiti da segnaposto,
        poi ricontrolla le copie. I file originali non vengono toccati.

Cosa cerca (bloccante):
- il path dei webhook, che e' parte dell'endpoint (deve essere "PATH");
- webhookId, meta.instanceId, pinData, cachedResultUrl;
- URL verso host diversi da quelli pubblici delle API usate;
- indirizzi email, IP, token noti (Telegram, Google, OpenAI, Slack, GitHub, JWT);
- campi chiamati token/secret/password/apikey/authorization con un valore reale;
- id di fogli Google, etichette Gmail, cartelle Outlook;
- numeri di 9-12 cifre (chat id Telegram).

Cosa segnala senza bloccare: gli id delle credenziali e delle data table, che
non sono segreti ma sono specifici della tua istanza.

Le credenziali vere (password, token OAuth) n8n non le esporta mai: il rischio
sta negli identificativi e negli endpoint, che e' quello che si controlla qui.
"""

import json
import re
import sys
from pathlib import Path

# Host pubblici delle API che i workflow chiamano: non identificano nessuno.
HOST_AMMESSI = {"generativelanguage.googleapis.com", "api.telegram.org"}

SEGNAPOSTO = re.compile(r"^(YOUR_|CRED_|PATH$|WF_|DATATABLE_|PROJECT_ID|CHAT_ID)")
CHIAVI_SEGRETE = re.compile(r"(token|secret|password|passwd|apikey|api_key|authorization)", re.I)

# (nome regola, espressione). Applicate a ogni stringa del JSON.
REGOLE_STRINGA = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}")),
    ("ip", re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")),
    ("token Telegram", re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b")),
    ("chiave Google", re.compile(r"\bAIza[0-9A-Za-z_-]{35,}")),
    ("chiave sk-", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("token Slack", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    ("token GitHub", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("JWT", re.compile(r"\bey[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{5,}\b")),
    ("Bearer", re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{10,}")),
    ("etichetta Gmail", re.compile(r"\bLabel_\d{6,}\b")),
    ("cartella Outlook", re.compile(r"\bAQMk[A-Za-z0-9_=-]{30,}")),
    ("id foglio Google", re.compile(r"\b[A-Za-z0-9_-]{44}\b")),
    ("numero di 9-12 cifre (chat id?)", re.compile(r"(?<![A-Za-z0-9.])\d{9,12}(?![A-Za-z0-9])")),
]
URL = re.compile(r"https?://([^/\s\"'<>)]+)")


class Rilievo:
    def __init__(self, file, percorso, regola, valore, bloccante=True):
        self.file, self.percorso, self.regola = file, percorso, regola
        self.valore, self.bloccante = valore, bloccante

    def __str__(self):
        v = str(self.valore).replace("\n", " ")
        v = v if len(v) <= 12 else v[:5] + "..." + v[-3:]
        tipo = "BLOCCA" if self.bloccante else "info  "
        return f"  [{tipo}] {self.file} :: {self.percorso} :: {self.regola} ({v})"


def _e_webhook(tipo):
    return "webhook" in tipo.lower() or "formtrigger" in tipo.lower()


def cammina(nodo, percorso=""):
    """Genera (percorso, chiave, valore) per ogni foglia del JSON."""
    if isinstance(nodo, dict):
        for k, v in nodo.items():
            yield from cammina(v, f"{percorso}/{k}")
    elif isinstance(nodo, list):
        for i, v in enumerate(nodo):
            yield from cammina(v, f"{percorso}[{i}]")
    else:
        yield percorso, percorso.rsplit("/", 1)[-1], nodo


def controlla(nome, dati):
    rilievi = []

    # --- controlli strutturali ---
    for nodo in dati.get("nodes", []):
        tipo = str(nodo.get("type", ""))
        base = f"nodes/{nodo.get('name')}"
        if "webhookId" in nodo:
            rilievi.append(Rilievo(nome, base + "/webhookId", "webhookId", nodo["webhookId"]))
        if _e_webhook(tipo) and "path" in nodo.get("parameters", {}):
            p = nodo["parameters"]["path"]
            if p and not SEGNAPOSTO.match(str(p)):
                rilievi.append(Rilievo(nome, base + "/parameters/path", "path del webhook (endpoint)", p))
        for tipo_cred, cred in (nodo.get("credentials") or {}).items():
            rilievi.append(Rilievo(nome, f"{base}/credentials/{tipo_cred}", "id credenziale",
                                   cred.get("id"), bloccante=False))
    if dati.get("meta", {}).get("instanceId"):
        rilievi.append(Rilievo(nome, "meta/instanceId", "instanceId", dati["meta"]["instanceId"]))
    if dati.get("pinData"):
        rilievi.append(Rilievo(nome, "pinData", "dati di test incorporati", "pinData"))

    # --- coppie {name, value}: header e parametri HTTP con nome "da segreto" ---
    def coppie(nodo, percorso=""):
        if isinstance(nodo, dict):
            n, v = nodo.get("name"), nodo.get("value")
            if isinstance(n, str) and isinstance(v, str) and CHIAVI_SEGRETE.search(n) \
                    and v and not v.startswith("=") and not SEGNAPOSTO.match(v):
                rilievi.append(Rilievo(nome, percorso, f"parametro '{n}' con un valore", v))
            for k, x in nodo.items():
                coppie(x, f"{percorso}/{k}")
        elif isinstance(nodo, list):
            for i, x in enumerate(nodo):
                coppie(x, f"{percorso}[{i}]")
    coppie(dati)

    # --- controlli su ogni valore ---
    for percorso, chiave, valore in cammina(dati):
        if chiave == "cachedResultUrl":
            rilievi.append(Rilievo(nome, percorso, "cachedResultUrl (URL dell'istanza)", valore))
            continue
        if chiave in ("webhookId", "instanceId") or "/credentials/" in percorso:
            continue  # gia' segnalati sopra
        if isinstance(valore, bool) or valore is None:
            continue
        if percorso.endswith("/sheetName/value") and re.fullmatch(r"\d{5,}", str(valore)):
            rilievi.append(Rilievo(nome, percorso, "gid di una scheda Google", valore))
            continue
        if isinstance(valore, (int, float)):
            if 100_000_000 <= abs(valore) < 1_000_000_000_000 and float(valore).is_integer():
                rilievi.append(Rilievo(nome, percorso, "numero di 9-12 cifre (chat id?)", valore))
            continue

        testo = str(valore)
        if CHIAVI_SEGRETE.search(chiave) and testo and not SEGNAPOSTO.match(testo) and not testo.startswith("="):
            rilievi.append(Rilievo(nome, percorso, f"campo '{chiave}' con un valore", testo))
        for host in URL.findall(testo):
            if host.lower() not in HOST_AMMESSI:
                rilievi.append(Rilievo(nome, percorso, "URL verso un host non ammesso", host))
        for regola, rx in REGOLE_STRINGA:
            for m in rx.finditer(testo):
                # I nomi di nodo e le parole non sono id: l'id foglio richiede una cifra e una lettera.
                if regola == "id foglio Google" and not (re.search(r"\d", m.group()) and re.search(r"[A-Za-z]", m.group())):
                    continue
                if regola == "ip" and not all(int(x) <= 255 for x in m.group().split(".")):
                    continue
                rilievi.append(Rilievo(nome, percorso, regola, m.group()))
    return rilievi


def pulisci(dati):
    """Sostituisce i valori sospetti con segnaposto. Restituisce una copia."""
    dati = json.loads(json.dumps(dati))
    dati.pop("pinData", None)
    if isinstance(dati.get("meta"), dict):
        dati["meta"].pop("instanceId", None)

    for nodo in dati.get("nodes", []):
        nodo.pop("webhookId", None)
        tipo = str(nodo.get("type", ""))
        if _e_webhook(tipo) and "path" in nodo.get("parameters", {}):
            nodo["parameters"]["path"] = "PATH"
        for tipo_cred, cred in (nodo.get("credentials") or {}).items():
            cred["id"] = "CRED_" + re.sub(r"(?i)api$", "", tipo_cred).upper()
        scheda = (nodo.get("parameters") or {}).get("sheetName")
        if isinstance(scheda, dict) and re.fullmatch(r"\d{5,}", str(scheda.get("value", ""))):
            scheda["value"] = "YOUR_SHEET_GID"

    def sostituisci(nodo, chiave=""):
        if isinstance(nodo, dict):
            nodo.pop("cachedResultUrl", None)
            for k in list(nodo):
                nodo[k] = sostituisci(nodo[k], k)
            return nodo
        if isinstance(nodo, list):
            return [sostituisci(v) for v in nodo]
        if isinstance(nodo, bool) or nodo is None:
            return nodo
        if isinstance(nodo, (int, float)):
            if 100_000_000 <= abs(nodo) < 1_000_000_000_000 and float(nodo).is_integer():
                return 0
            return nodo
        t = str(nodo)
        t = re.sub(r"\bLabel_\d{6,}\b", "YOUR_GMAIL_LABEL_ID", t)
        t = re.sub(r"\bAQMk[A-Za-z0-9_=-]{30,}", "YOUR_OUTLOOK_FOLDER_ID", t)
        t = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}", "utente@example.com", t)
        t = re.sub(r"(?<![A-Za-z0-9.])\d{9,12}(?![A-Za-z0-9])", "0", t)
        t = re.sub(r"\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{44}\b", "YOUR_GOOGLE_SHEET_ID", t)
        return t

    return sostituisci(dati)


def main(argv):
    cartella_uscita = None
    if argv and argv[0] == "--pulisci":
        if len(argv) < 3:
            print(__doc__)
            return 2
        cartella_uscita, argv = Path(argv[1]), argv[2:]
    file_in = [Path(a) for a in argv]
    if not file_in:
        print(__doc__)
        return 2

    if cartella_uscita:
        cartella_uscita.mkdir(parents=True, exist_ok=True)
        nuovi = []
        for f in file_in:
            dati = json.loads(f.read_text(encoding="utf-8"))
            destinazione = cartella_uscita / f.name
            destinazione.write_text(json.dumps(pulisci(dati), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            nuovi.append(destinazione)
        print(f"Copie ripulite scritte in {cartella_uscita}/ ({len(nuovi)} file). Ricontrollo...\n")
        file_in = nuovi

    tutti = []
    for f in file_in:
        try:
            dati = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            print(f"  [ERRORE] {f}: {e}")
            return 2
        tutti += controlla(f.name, dati)

    bloccanti = [r for r in tutti if r.bloccante]
    informativi = [r for r in tutti if not r.bloccante]
    for r in bloccanti:
        print(r)
    if informativi:
        print(f"\n  ({len(informativi)} id di credenziali: specifici della tua istanza, non segreti)")
    print()
    if bloccanti:
        print(f"ATTENZIONE: {len(bloccanti)} valori sospetti in {len({r.file for r in bloccanti})} file.")
        return 1
    print(f"Nessun valore sospetto in {len(file_in)} file.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
