#!/usr/bin/env python3
"""
Migrazione export 1Money -> schema 'Transazioni' del nuovo sistema.

Uso:
    python migra_1money.py input.csv output.csv

Note di design:
- Le righe di footer (riepilogo saldo) vengono scartate.
- L'hash di dedup include un contatore di occorrenza, perche' due
  transazioni identiche nello stesso giorno sono legittime (es. due caffe').
- Gli id sono deterministici (uuid5): rilanciare lo script produce gli
  stessi id, quindi un reimport non duplica nulla.
"""

import sys
import csv
import hashlib
import uuid
import unicodedata
from collections import Counter
from datetime import datetime

NAMESPACE = uuid.UUID("6f1d7a2e-3b5c-4e8a-9f21-0c7b4d5e6a80")

COLONNE = [
    "id", "data_evento", "data_inserimento", "fonte", "tipo", "importo",
    "valuta", "conto", "esercente", "categoria", "sottocategoria",
    "note", "testo_grezzo", "hash_dedup", "confidenza", "stato",
]

TIPI_VALIDI = {"Spesa": "spesa", "Entrata": "entrata"}


def normalizza_testo(s):
    """Minuscolo, senza accenti, spazi collassati. Per esercente e hash."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.lower().split())


def calcola_hash(data_iso, importo, esercente, conto, occorrenza):
    chiave = f"{data_iso}|{importo:.2f}|{normalizza_testo(esercente)}|{normalizza_testo(conto)}|{occorrenza}"
    return hashlib.sha256(chiave.encode("utf-8")).hexdigest()[:16]


def migra(percorso_in, percorso_out):
    with open(percorso_in, encoding="utf-8-sig", newline="") as f:
        righe = list(csv.DictReader(f))

    scartate = []
    pulite = []

    for i, r in enumerate(righe, start=2):
        tipo_raw = (r.get("TIPOLOGIA") or "").strip()
        if tipo_raw not in TIPI_VALIDI:
            if any((v or "").strip() for v in r.values()):
                scartate.append((i, r))
            continue

        try:
            data = datetime.strptime((r["DATA"] or "").strip(), "%d/%m/%y").date()
            importo = float((r["IMPORTO"] or "").strip().replace(",", "."))
        except (ValueError, KeyError):
            scartate.append((i, r))
            continue

        pulite.append({
            "data": data,
            "tipo": TIPI_VALIDI[tipo_raw],
            "importo": abs(importo),
            "valuta": (r.get("VALUTA") or "EUR").strip() or "EUR",
            "categoria": (r.get("AL CONTO/ALLA CATEGORIA") or "").strip(),
            "note": (r.get("NOTE") or "").strip(),
            "riga_originale": " | ".join(f"{k}={(v or '').strip()}" for k, v in r.items()),
        })

    # Contatore di occorrenza per gestire i duplicati legittimi
    visti = Counter()
    output = []

    for t in pulite:
        data_iso = t["data"].isoformat()
        # L'unico "conto" in 1Money era 'Bilancio': lo storico e' mono-conto.
        conto = "storico"
        # 1Money non ha un campo esercente: la nota e' l'unico appiglio.
        esercente = normalizza_testo(t["note"])

        # La chiave del contatore DEVE coincidere con quella dell'hash,
        # altrimenti due righe con categorie diverse ma stessa data/importo
        # ricevono entrambe occorrenza 1 e generano lo stesso hash.
        chiave_base = (data_iso, round(t["importo"], 2), esercente, conto)
        visti[chiave_base] += 1
        occ = visti[chiave_base]

        hash_dedup = calcola_hash(data_iso, t["importo"], esercente, conto, occ)
        riga_id = str(uuid.uuid5(NAMESPACE, hash_dedup))

        output.append({
            "id": riga_id,
            "data_evento": data_iso,
            "data_inserimento": data_iso,
            "fonte": "1money_import",
            "tipo": t["tipo"],
            "importo": f"{t['importo']:.2f}",
            "valuta": t["valuta"],
            "conto": conto,
            "esercente": esercente,
            "categoria": t["categoria"],
            "sottocategoria": "",
            "note": t["note"],
            "testo_grezzo": t["riga_originale"],
            "hash_dedup": hash_dedup,
            "confidenza": "1.0",
            "stato": "confermata",
        })

    output.sort(key=lambda r: r["data_evento"])

    with open(percorso_out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLONNE)
        w.writeheader()
        w.writerows(output)

    hash_unici = len({r["hash_dedup"] for r in output})
    print(f"Righe lette:      {len(righe)}")
    print(f"Righe migrate:    {len(output)}")
    print(f"Righe scartate:   {len(scartate)}")
    for n, r in scartate:
        print(f"  riga {n}: {dict(r)}")
    print(f"Hash unici:       {hash_unici} (collisioni: {len(output) - hash_unici})")
    print(f"Scritto in:       {percorso_out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Uso: python migra_1money.py input.csv output.csv")
    migra(sys.argv[1], sys.argv[2])
