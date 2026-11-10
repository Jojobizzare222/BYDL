#!/usr/bin/env bash
# Mettre la vraie boutique à jour avec la dernière version envoyée sur GitHub (« Push origin » depuis le Mac) :
#   sudo /srv/zado/app/deploy/mettre-a-jour.sh
# Une sauvegarde est faite AVANT ; si la nouvelle version ne démarre pas, l'ancienne est remise automatiquement.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(id -u)" = 0 ] || { echo "Lancez avec sudo."; exit 1; }
cd "$APP"
echo "==> Sauvegarde avant mise à jour"; sudo -u zado "$APP/deploy/sauvegarde.sh"
OLD="$(sudo -u zado git rev-parse HEAD)"
echo "==> Récupération de la nouvelle version"; sudo -u zado git pull --ff-only
sudo -u zado npm ci --omit=dev
systemctl restart zado
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3000/api/config >/dev/null; then echo "==> Boutique à jour : $(sudo -u zado git log -1 --format='%h %s' | cut -c1-90)"; exit 0; fi
  sleep 2
done
echo "!! La nouvelle version ne répond pas : retour à la précédente ($OLD)"
sudo -u zado git reset -q --hard "$OLD" && sudo -u zado npm ci --omit=dev && systemctl restart zado
journalctl -u zado -n 30 --no-pager
exit 1
