// Règle de prix Zado (décision Joseph 14/11/2026) : marge 35 % / 20 % / 17 % selon le coût, minimum 3 000 FCFA,
// arrondi aux 500 FCFA supérieurs, reconditionné +25 % sur le prix global (article + transport à 17,80 €/kg).
// Lancer : zsh tests/run-test.sh test-prix-zado.mjs
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '' }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; let data = null; try { data = await r.json(); } catch {} return { status: r.status, data }; };
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const adv = async (sourcePrice, condition = 'neuf', weightKg = 0.3) => (await call(A, '/admin/pricing/advise', { body: { sourcePrice, condition, weightKg } })).data?.price;

ok(await adv(5241) === 8500, 'petit article (5 241 FCFA) : marge minimum 3 000 FCFA → 8 500 FCFA');
ok(await adv(19659) === 27000, 'moins de 25 000 FCFA : +35 % → 27 000 FCFA');
ok(await adv(130535) === 157000, '25 000 à 150 000 FCFA : +20 % → 157 000 FCFA');
ok(await adv(570027) === 667000, 'plus de 150 000 FCFA : +17 % → 667 000 FCFA');
ok(await adv(177764, 'reconditionné', 0.2) === 261000, 'reconditionné : +25 % sur article + transport (17,80 €/kg) → 261 000 FCFA');
ok(!(await adv(0)), 'sans prix en France : pas de prix conseillé');
ok((await call(null, '/admin/pricing/advise', { body: { sourcePrice: 1000 } })).status === 401, 'prix conseillé : réservé à Zado Pro');
const cfg = (await call(null, '/config')).data;
ok(cfg.momoRate === 0.035 && cfg.serviceFee === 2000 && cfg.freight.eurPerKg === 17.8 && !('zadoFeeEurPerKg' in cfg.freight), 'boutique : frais de service 2 000 FCFA, frais Mobile Money 3,5 %, 17,80 €/kg ; la part Zado du transport reste interne');
ok((await call(A, '/admin/settings/transport', { method: 'PUT', body: { pricing: { momoRate: 0.5 } } })).status === 400, 'taux Mobile Money au-delà de 20 % refusé');
const t = (await call(A, '/admin/settings/transport', { method: 'PUT', body: { pricing: { serviceFee: 1500 } } })).data;
ok(t.pricing.serviceFee === 1500 && (await call(null, '/config')).data.serviceFee === 1500, 'frais de service réglables dans Zado Pro');
ok((await call(A, '/admin/settings/transport', { method: 'PUT', body: { pricing: { serviceFee: -5 } } })).status === 400, 'frais de service négatifs refusés');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
