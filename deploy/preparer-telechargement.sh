#!/usr/bin/env bash
# Prépare la dernière sauvegarde pour la rapatrier sur le Mac (deploy/GUIDE.md, § 6) :
#   ssh ubuntu@IP 'sudo /srv/zado/app/deploy/preparer-telechargement.sh'
# Copie la sauvegarde la plus récente dans le dossier personnel de la personne connectée, lisible par elle seule.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Lancez avec sudo."; exit 1; }
WHO="${SUDO_USER:-ubuntu}"; DEST="$(getent passwd "$WHO" | cut -d: -f6)/derniere-sauvegarde.tar.gz"
LAST="$(ls -t /srv/zado/sauvegardes/zado-*.tar.gz 2>/dev/null | head -1)"
[ -n "$LAST" ] || { echo "Aucune sauvegarde pour l'instant."; exit 1; }
install -m 600 -o "$WHO" "$LAST" "$DEST"
echo "Prête : $DEST ($(basename "$LAST")). Sur le Mac : scp $WHO@<IP>:derniere-sauvegarde.tar.gz ~/Documents/"
