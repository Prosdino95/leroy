#!/usr/bin/env bash
#
# Backup settimanale dello stack n8n.
# Installazione:
#   nano ~/stack/backup.sh      (incolla questo file)
#   chmod +x ~/stack/backup.sh
#   ~/stack/backup.sh           (prova subito, non aspettare domenica)
#
set -euo pipefail

STACK_DIR="/home/ubuntu/stack"
DEST="/home/ubuntu/backup"
KEEP=8                                  # ~2 mesi di backup settimanali
DOCKER="/usr/bin/docker"                # percorso assoluto: cron ha un PATH minimo

# Avviso su Telegram se il backup fallisce. Lascia vuoto per disattivare.
TG_TOKEN=""
TG_CHAT=""

DATA="$(date +%F_%H%M)"
TMP="$DEST/tmp_$DATA"
ARCHIVIO="$DEST/n8n_$DATA.tar.gz"

avvisa() {
  echo "[$(date '+%F %T')] $1"
  if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
      -d "chat_id=${TG_CHAT}" -d "text=Backup n8n: $1" >/dev/null || true
  fi
}

# Qualunque errore non gestito viene segnalato invece di morire in silenzio.
trap 'avvisa "FALLITO alla riga $LINENO"; rm -rf "$TMP"; exit 1' ERR

mkdir -p "$TMP"
cd "$STACK_DIR"

# ---------------------------------------------------------------
# 1. Database — contiene workflow, credenziali cifrate, esecuzioni
# ---------------------------------------------------------------
$DOCKER compose exec -T postgres \
  pg_dump -U n8n -d n8n --clean --if-exists > "$TMP/n8n.sql"

# Un dump da zero byte e' il modo classico in cui i backup falliscono
# senza che nessuno se ne accorga per mesi.
if [ ! -s "$TMP/n8n.sql" ] || [ "$(stat -c%s "$TMP/n8n.sql")" -lt 10000 ]; then
  avvisa "FALLITO: dump del database vuoto o troppo piccolo"
  rm -rf "$TMP"
  exit 1
fi

# ---------------------------------------------------------------
# 2. Workflow in JSON leggibile — comodi per git e per il diff
# ---------------------------------------------------------------
if $DOCKER compose exec -T n8n \
     n8n export:workflow --all --separate --output=/tmp/wf >/dev/null 2>&1; then
  CID="$($DOCKER compose ps -q n8n)"
  $DOCKER cp "$CID:/tmp/wf" "$TMP/workflows" >/dev/null 2>&1 || true
  $DOCKER compose exec -T n8n rm -rf /tmp/wf >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------
# 3. Configurazione dello stack
# ---------------------------------------------------------------
cp -a docker-compose.yml Caddyfile .env "$TMP/" 2>/dev/null || true

cat > "$TMP/LEGGIMI.txt" <<EOF
Backup n8n del $DATA

Contenuto:
  n8n.sql           dump PostgreSQL (workflow, credenziali cifrate, esecuzioni)
  workflows/        gli stessi workflow in JSON leggibile
  docker-compose.yml, Caddyfile, .env

ATTENZIONE: .env contiene N8N_ENCRYPTION_KEY e la password del database.
Senza la chiave di cifratura, le credenziali nel dump sono irrecuperabili.

Ripristino:
  1. docker compose up -d postgres
  2. cat n8n.sql | docker compose exec -T postgres psql -U n8n -d n8n
  3. rimetti .env al suo posto (stessa N8N_ENCRYPTION_KEY dell'originale)
  4. docker compose up -d
EOF

# ---------------------------------------------------------------
# 4. Archivio e rotazione
# ---------------------------------------------------------------
tar -czf "$ARCHIVIO" -C "$TMP" .
chmod 600 "$ARCHIVIO"
rm -rf "$TMP"

ls -1t "$DEST"/n8n_*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

DIM="$(du -h "$ARCHIVIO" | cut -f1)"
echo "[$(date '+%F %T')] OK — $ARCHIVIO ($DIM)"
