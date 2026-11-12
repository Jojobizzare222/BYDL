// Dépenses récurrentes dans Finances (12/11/2026) : abonnement, internet le 26 du mois, serveur…
// Lancer : zsh tests/run-test.sh test-recurrentes.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '' }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });

// Dates calculées sans serveur (fin de mois, chaque année)
const { dates } = require('../src/recurring.js');
const d1 = dates({ start: '2027-01', day: 31, frequency: 'monthly' }, '2027-04-30').map((x) => x.date);
ok(d1.join(',') === '2027-01-31,2027-02-28,2027-03-31,2027-04-30', `jour 31 ramené au dernier jour du mois : ${d1.join(', ')}`);
const d2 = dates({ start: '2026-11', day: 12, frequency: 'yearly' }, '2029-01-01').map((x) => x.date);
ok(d2.join(',') === '2026-11-12,2027-11-12,2028-11-12', 'chaque année : une échéance par an');

const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
const mAgo = (n) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
const ledgerCount = async (label) => (await call(A, '/admin/finance/journal')).data.filter((e) => (e.label || '').startsWith(label)).length;

ok((await call(null, '/admin/finance/recurring')).status === 401, 'réservé à Zado Pro');
ok((await call(A, '/admin/finance/recurring', { body: { label: '', amount: 1000, method: 'cash', category: 'telecom', day: 5, start: mAgo(0) } })).status === 400, 'libellé obligatoire');
ok((await call(A, '/admin/finance/recurring', { body: { label: 'X', amount: -5, method: 'cash', category: 'telecom', day: 5, start: mAgo(0) } })).status === 400, 'montant négatif refusé');
ok((await call(A, '/admin/finance/recurring', { body: { label: 'X', amount: 100, method: 'cash', category: 'stock', day: 5, start: mAgo(0) } })).status === 400, 'catégorie hors charges refusée (achats de stock : bons de commande)');

// Internet : chaque mois le 1er, depuis 2 mois → 3 échéances déjà passées (il y a 2 mois, le mois dernier, ce mois-ci)
let r = await call(A, '/admin/finance/recurring', { body: { label: 'Internet test', amount: 26000, method: 'cash', category: 'telecom', frequency: 'monthly', day: 1, start: mAgo(2) } });
ok(r.status === 201 && r.data.created === 3 && r.data.next > today, `règle créée : 3 échéances passées ajoutées, prochaine le ${r.data.next}`);
const rid = r.data.id;
ok(await ledgerCount('Internet test') === 3, 'Finances : 3 écritures « Internet test »');
await call(A, '/admin/finance/recurring'); await call(A, '/admin/finance');
ok(await ledgerCount('Internet test') === 3, 'jamais en double (relu plusieurs fois)');
const j = (await call(A, '/admin/finance/journal')).data.filter((e) => (e.label || '').startsWith('Internet test'));
const one = (await call(A, '/admin/finance/entries/' + j[0].id)).data;
ok(one.amount === 26000 && one.category === 'telecom' && one.method === 'cash' && /automatiquement/.test(one.note || ''), 'écriture : montant, catégorie, caisse, note « ajoutée automatiquement »');
// suppression d'une écriture automatique : pas recréée
await call(A, '/admin/finance/entries/' + one.id, { method: 'DELETE' });
await call(A, '/admin/finance/recurring');
ok(await ledgerCount('Internet test') === 2, 'écriture supprimée à la main : jamais recréée');

// Montant variable + mois déjà payé à la main
r = await call(A, '/admin/finance/recurring', { body: { label: 'Abonnement Claude test', amount: 58406, method: 'bank', category: 'telecom', day: 1, start: mAgo(1), variable: true, alreadyPaid: [mAgo(1)] } });
ok(r.data.created === 1 && await ledgerCount('Abonnement Claude test') === 1, 'mois déjà payé à la main : pas compté deux fois');
const cl = (await call(A, '/admin/finance/journal')).data.find((e) => (e.label || '').startsWith('Abonnement Claude test'));
ok(/à ajuster/.test(cl.detail), 'montant variable : « à ajuster selon le relevé »');

// Pause, modification, suppression
r = await call(A, '/admin/finance/recurring/' + rid, { method: 'PATCH', body: { active: false, amount: 27000 } });
ok(r.status === 200 && r.data.active === false && r.data.next === null && r.data.amount === 27000, 'mise en pause : plus de prochaine échéance');
const list = (await call(A, '/admin/finance/recurring')).data;
ok(list.perMonth === 58406, `charges fixes par mois (actives seulement) : ${list.perMonth} FCFA`);
r = await call(A, '/admin/finance/recurring', { body: { label: 'Domaine test', amount: 9374, method: 'bank', category: 'telecom', frequency: 'yearly', day: 12, start: '2099-11' } });
ok(r.data.perMonth === Math.round(9374 / 12) && r.data.next === '2099-11-12' && r.data.created === 0, 'annuelle : pas d\'échéance avant la date, compte pour 1/12 par mois');
ok((await call(A, '/admin/finance/recurring/' + rid, { method: 'DELETE' })).status === 200 && await ledgerCount('Internet test') === 2, 'suppression de la règle : les écritures déjà enregistrées restent');
const act = (await call(A, '/admin/activity')).data;
ok(act.some((a) => a.action === 'Dépense récurrente ajoutée') && act.some((a) => a.action === 'Dépense récurrente enregistrée'), 'journal : ajout de la règle et écritures automatiques');

console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
