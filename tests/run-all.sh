#!/bin/zsh
# Toute la batterie de tests (une base neuve par suite). Lancer depuis le projet :  zsh tests/run-all.sh
# Résumé : nom de la suite, nombre de OK, nombre d'échecs. Détail de chaque suite : tests/.run/out-<nom>.txt
D=${0:A:h}; S=$D/.run; mkdir -p $S/push $S/idm $S/rt/id $S/ui/id $S/id-p3
cd $D
R=$S/run-all.txt; : > $R
# Faux serveur de notifications : certificat de test créé une fois
[ -f $S/push/key.pem ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout $S/push/key.pem -out $S/push/cert.pem -days 3650 -subj /CN=localhost >/dev/null 2>&1
# Lecteur de codes-barres pour le test des étiquettes (@zxing/library, licence MIT), téléchargé une fois
[ -d $S/zx/package ] || (mkdir -p $S/zx && cd $S/zx && npm pack @zxing/library@0.21.3 >/dev/null 2>&1 && tar -xzf zxing-library-0.21.3.tgz)
t() { # t <nom> <env…> -- <args…>
  local name=$1; shift
  local envs=(); while [[ $1 != -- && -n $1 ]]; do envs+=($1); shift; done; shift
  local out=$S/out-$name.txt
  env ${envs[@]} $D/run-test.sh test-$name.mjs "$@" > $out 2>&1; local code=$?
  printf "%-14s %4s OK %3s échec(s)  [code %s]\n" $name $(grep -c '^OK' $out) $(grep -c '^ÉCHEC' $out) $code | tee -a $R
}
t paiements LEGACY=1 PICKUP_HOLD_HOURS=0.005 --
t achat LEGACY=1 --
t livraison LEGACY=1 --
t finances LEGACY=1 --
t relais LEGACY=1 --
t roles LEGACY=1 --
t suppression LEGACY=1 -- $D/../data/uploads
t stats LEGACY=1 --
t compte LEGACY=1 --
t documents LEGACY=1 --
t colis LEGACY=1 --
t achats LEGACY=1 --
t calendrier LEGACY=1 --
t admin LEGACY=1 --
rm -rf $S/idt/identity; mkdir -p $S/idt/identity
rm -rf $S/idt/identity; mkdir -p $S/idt/identity
t identite ID_DIR=$S/idt/identity -- $D/.. $S/idt/identity
t messagerie ID_DIR=$S/idm -- $D/id.jpg
t temps-reel ID_DIR=$S/rt/id -- $D/id.jpg
t suivi-direct LEGACY=1 --
node $D/push/fake-push.mjs $S/push > /dev/null 2>&1 & FP=$!; sleep 0.5
t notifs LEGACY=1 NODE_TLS_REJECT_UNAUTHORIZED=0 --
kill $FP
t reglages2 ID_DIR=$S/ui/id -- $D/id.jpg
t p1 LEGACY=1 ABANDON_NO_PAYMENT_HOURS=0.0006 ABANDON_GRACE_HOURS=0.0006 PICKUP_HOLD_HOURS=0.0006 --
t p2 LEGACY=1 --
t frais LEGACY=1 --
t p3 LEGACY=1 ID_DIR=$S/id-p3 --
t limite RATE_LIMIT=on --
t course LEGACY=1 --
t codebarre LEGACY=1 -- $S/zx
t maintenance LEGACY=1 --
t sans-mode --
t provenance --
