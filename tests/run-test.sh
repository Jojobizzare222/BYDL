#!/bin/zsh
# usage : tests/run-test.sh test-xxx.mjs [args…] — base neuve, mot de passe admin, serveur sur le port 3999, test, arrêt.
# Les fichiers produits (bases, journaux) vont dans tests/.run (exclu de Git).
D=${0:A:h}; S=$D/.run; mkdir -p $S
cd $D/..
rm -f $S/t-run.db $S/t-run.db-shm $S/t-run.db-wal
echo 'motdepasse-test-123' > $S/pw.txt
DB_FILE=$S/t-run.db node -e "require('./src/admin/auth').setPassword('motdepasse-test-123')" >/dev/null 2>&1 || DB_FILE=$S/t-run.db node -e "const a=require('./src/admin/auth'); (a.setPassword||a.setAdminPassword)('motdepasse-test-123')"
PRICE_WATCH=${PRICE_WATCH:-off} PRICE_WATCH_DELAY_MS=${PRICE_WATCH_DELAY_MS:-2000} RATE_LIMIT=${RATE_LIMIT:-off} PORT=3999 DB_FILE=$S/t-run.db TRENDS_DISABLED=1 node src/server.js > $S/t-run.log 2>&1 &
PID=$!
for i in {1..30}; do curl -s localhost:3999/api/config >/dev/null && break; sleep 0.3; done
T=$1; shift
[ -n "$LEGACY" ] && node $D/legacy-sales.mjs $S/pw.txt
node $D/$T $S/pw.txt "$@"
R=$?
kill $PID
exit $R
