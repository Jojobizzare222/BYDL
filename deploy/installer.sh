#!/usr/bin/env bash
# Installation de la VRAIE boutique Zado sur un serveur neuf (VPS Ubuntu 24.04), en une commande :
#   sudo bash installer.sh zado.cg contact@zado.cg
# (1er argument : le nom de domaine ; 2e : un e-mail pour le certificat HTTPS).
# Ce que fait le script : Node.js, la boutique (copie du dépôt GitHub), un service qui la relance tout seul, nginx devant
# (HTTPS gratuit Let's Encrypt), pare-feu, mises à jour de sécurité automatiques, sauvegarde chaque nuit.
# On peut le relancer sans risque : il ne remplace ni la base, ni le fichier .env, ni les photos.
set -euo pipefail

DOMAIN="${1:-}"; EMAIL="${2:-}"
REPO="https://github.com/Jojobizzare222/BYDL.git"
HOME_DIR=/srv/zado; APP="$HOME_DIR/app"; BACKUPS="$HOME_DIR/sauvegardes"
say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
[ -n "$DOMAIN" ] || { echo "Usage : sudo bash installer.sh zado.cg contact@zado.cg"; exit 1; }
grep -qi ubuntu /etc/os-release || echo "Attention : ce script est prévu pour Ubuntu 24.04."

say "Mise à jour du système et outils"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw nginx certbot python3-certbot-nginx sqlite3 unattended-upgrades fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

say "Node.js 24 (version utilisée pour développer et tester Zado)"
if ! node -v 2>/dev/null | grep -q '^v24'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

say "Compte système « zado » et copie de la boutique"
id zado >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HOME_DIR" --shell /bin/bash zado
mkdir -p "$BACKUPS" && chown zado:zado "$HOME_DIR" "$BACKUPS" && chmod 750 "$HOME_DIR" "$BACKUPS"
if [ -d "$APP/.git" ]; then sudo -u zado git -C "$APP" pull --ff-only; else sudo -u zado git clone "$REPO" "$APP"; fi
cd "$APP"
sudo -u zado npm ci --omit=dev

say "Réglages (.env) : créés une seule fois, jamais écrasés"
if [ ! -f "$APP/.env" ]; then
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__CODE_KEY__|$(openssl rand -hex 32)|" -e "s|__CRON__|$(openssl rand -hex 24)|" deploy/env.production.example > "$APP/.env"
  chown zado:zado "$APP/.env" && chmod 600 "$APP/.env"
  echo "Fichier .env créé (clé de chiffrement des codes clients générée). Complétez-le plus tard : e-mail, Mobile Money…"
fi
sudo -u zado mkdir -p "$APP/data" && chmod 750 "$APP/data"

say "Service « zado » (redémarre tout seul, même après une coupure)"
cat > /etc/systemd/system/zado.service <<EOF
[Unit]
Description=Boutique Zado
After=network-online.target
Wants=network-online.target

[Service]
User=zado
WorkingDirectory=$APP
ExecStart=/usr/bin/node src/server.js
Environment=NODE_ENV=production
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$APP/data $BACKUPS /tmp
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now zado && systemctl restart zado

say "nginx (porte d'entrée HTTPS)"
sed -e "s|__DOMAIN__|$DOMAIN|g" deploy/nginx-zado.conf > /etc/nginx/sites-available/zado
ln -sf /etc/nginx/sites-available/zado /etc/nginx/sites-enabled/zado
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

say "Pare-feu : seulement SSH, HTTP et HTTPS"
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable

say "Sauvegarde automatique chaque nuit à 2 h (heure du serveur), 14 jours gardés"
chmod +x deploy/sauvegarde.sh deploy/mettre-a-jour.sh
echo "0 2 * * * zado $APP/deploy/sauvegarde.sh >> $BACKUPS/sauvegarde.log 2>&1" > /etc/cron.d/zado-sauvegarde

say "Certificat HTTPS (le domaine doit déjà pointer vers ce serveur)"
if [ -n "$EMAIL" ] && certbot --nginx -n --agree-tos -m "$EMAIL" --redirect -d "$DOMAIN" -d "www.$DOMAIN"; then
  echo "HTTPS actif."
else
  echo "HTTPS pas encore actif : vérifiez que $DOMAIN et www.$DOMAIN pointent vers l'adresse IP de ce serveur, puis relancez :"
  echo "  sudo certbot --nginx -m votre@email --agree-tos --redirect -d $DOMAIN -d www.$DOMAIN"
fi

sleep 2
if curl -fsS http://127.0.0.1:3000/api/config >/dev/null; then say "La boutique répond."; else echo "La boutique ne répond pas : sudo journalctl -u zado -n 50"; fi
cat <<EOF

Étapes suivantes (voir deploy/GUIDE.md) :
  1. Mot de passe de Zado Pro :      sudo -u zado bash -c 'cd $APP && npm run admin:password'
  2. Contrôle avant l'ouverture :    sudo -u zado bash -c 'cd $APP && npm run verifier'
  3. Boutique : https://$DOMAIN   ·   Zado Pro : https://$DOMAIN/admin
EOF
