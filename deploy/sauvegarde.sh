#!/usr/bin/env bash
# Sauvegarde de la boutique Zado : base (copie sûre même pendant les ventes), photos envoyées, pièces d'identité,
# clé de chiffrement des codes clients et réglages. Lancée chaque nuit par cron (deploy/installer.sh) ; à la main :
#   sudo -u zado /srv/zado/app/deploy/sauvegarde.sh
# Les archives contiennent des données personnelles : elles restent sur le serveur (dossier privé) et, si possible,
# une copie hors du serveur (voir deploy/GUIDE.md). 14 jours gardés.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${BACKUP_DIR:-$(dirname "$APP")/sauvegardes}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
umask 077
mkdir -p "$OUT" "$TMP/zado"

DB="${DB_FILE:-$APP/data/baydel.db}"
[ -f "$DB" ] && sqlite3 "$DB" ".backup '$TMP/zado/baydel.db'"
for d in uploads identity; do [ -d "$APP/data/$d" ] && cp -a "$APP/data/$d" "$TMP/zado/"; done
[ -f "$APP/data/code.key" ] && cp "$APP/data/code.key" "$TMP/zado/"
[ -f "$APP/.env" ] && cp "$APP/.env" "$TMP/zado/env"

tar -czf "$OUT/zado-$STAMP.tar.gz" -C "$TMP" zado
find "$OUT" -name 'zado-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
# Copie hors du serveur (facultatif) : rclone configuré + BACKUP_REMOTE=nom:dossier dans l'environnement
if [ -n "${BACKUP_REMOTE:-}" ] && command -v rclone >/dev/null; then rclone copy "$OUT/zado-$STAMP.tar.gz" "$BACKUP_REMOTE"; fi
echo "$(date '+%F %T') sauvegarde $OUT/zado-$STAMP.tar.gz ($(du -h "$OUT/zado-$STAMP.tar.gz" | cut -f1))"
