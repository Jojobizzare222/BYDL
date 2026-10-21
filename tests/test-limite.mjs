// Limite de requêtes par adresse (à lancer avec RATE_LIMIT=on)
const B = 'http://localhost:3999/api';
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const codes = [];
for (let i = 0; i < 125; i++) codes.push((await fetch(B + '/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
ok(codes.slice(0, 120).every((c) => c === 400) && codes.slice(120).every((c) => c === 429), `écritures : 120 par minute puis « trop de demandes » (${codes.filter((c) => c === 429).length} refusées)`);
const r = await fetch(B + '/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
ok(r.status === 429 && Number(r.headers.get('retry-after')) > 0 && /Patientez/.test((await r.json()).error), 'message clair + délai d\'attente indiqué');
ok((await fetch(B + '/products')).status === 200, 'les lectures (catalogue) restent possibles');
let n = 0; for (let i = 0; i < 300; i++) if ((await fetch(B + '/config')).status === 200) n++;
ok(n === 300, 'lectures : 300 d\'affilée acceptées (adresse partagée par beaucoup de téléphones)');
ok((await fetch('http://localhost:3999/')).status === 200, 'la boutique elle-même n\'est pas limitée');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
