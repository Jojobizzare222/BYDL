// Pack Noël (10/11/2026) : codes promo, « C'est pour offrir », mode Noël (date limite), page Idées cadeaux.
// Lancer : zsh tests/run-test.sh test-noel.mjs tests/id.jpg
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const photo = 'data:image/jpeg;base64,' + fs.readFileSync(process.argv[3]).toString('base64');
const client = async (name, phone) => { const J = { c: '' }; const r = (await call(J, '/account/register', { body: { name, phone, idType: 'cni', idPhoto: photo } })).data; await call(A, `/admin/customers/${r.customer.id}/identity`, { body: { decision: 'verify' } }); return J; };
const C = await client('Grace Noël', '061117788');
const items = [{ productId: 'a072', qty: 2 }]; // 2 × 18 000
const cust = { name: 'Grace Noël', phone: '061117788', city: 'Pointe-Noire', address: 'Loandjili' };

// ---- Mode Noël ----
let cfg = (await call(null, '/config')).data;
ok(cfg.noel && cfg.noel.deadline.endsWith('-12-15') && cfg.noel.phase === 'before', `mode Noël actif par défaut, date limite calculée : 15 décembre (5 j + 24 h + 3 j de marge) → ${cfg.noel?.deadline}`);
ok(cfg.promos === false, 'aucun code promo actif : le champ « code promo » n\'est pas montré');
ok((await call(C, '/admin/settings/noel')).status === 401 || (await call(C, '/admin/settings/noel')).status === 403, 'réglage Noël réservé à Zado Pro');
let r = await call(A, '/admin/settings/noel', { method: 'PUT', body: { auto: false, deadline: '12-28' } });
ok(r.status === 400, 'date limite après le 24 décembre refusée');
r = await call(A, '/admin/settings/noel', { method: 'PUT', body: { auto: false, deadline: '12-18' } });
cfg = (await call(null, '/config')).data;
ok(r.status === 200 && r.data.computed === '12-18' && cfg.noel.deadline.endsWith('-12-18'), 'date limite choisie à la main : 18 décembre');
await call(A, '/admin/settings/noel', { method: 'PUT', body: { auto: true, margin: 1 } });
ok((await call(null, '/config')).data.noel.deadline.endsWith('-12-17'), 'automatique avec 1 jour de marge : 17 décembre');
await call(A, '/admin/settings/transport', { method: 'PUT', body: { freight: { logisticsMax: 7 } } });
ok((await call(null, '/config')).data.noel.deadline.endsWith('-12-15'), 'délai de logistique porté à 7 jours : la date limite recule au 15 décembre');
await call(A, '/admin/settings/transport', { method: 'PUT', body: { freight: { logisticsMax: 5 } } });
await call(A, '/admin/settings/noel', { method: 'PUT', body: { enabled: false } });
ok((await call(null, '/config')).data.noel === null, 'mode Noël désactivé : plus rien sur la boutique');
await call(A, '/admin/settings/noel', { method: 'PUT', body: { enabled: true, margin: 3 } });

// ---- Codes promo ----
ok((await call(A, '/admin/promos', { body: { code: 'no', type: 'percent', value: 10 } })).status === 400, 'code trop court refusé');
ok((await call(A, '/admin/promos', { body: { code: 'TROP', type: 'percent', value: 95 } })).status === 400, 'remise de plus de 90 % refusée');
r = await call(A, '/admin/promos', { body: { code: 'noel10', type: 'percent', value: 10, label: 'Facebook', maxUses: 2 } });
ok(r.status === 201 && r.data.code === 'NOEL10' && r.data.onePerCustomer === true, 'code NOEL10 (−10 %) créé, écrit en majuscules, 1 utilisation par client par défaut');
const noel10 = r.data;
ok((await call(A, '/admin/promos', { body: { code: 'NOEL10', type: 'amount', value: 5000 } })).status === 400, 'deux codes identiques refusés');
const f5 = (await call(A, '/admin/promos', { body: { code: 'CADEAU5000', type: 'amount', value: 5000, minTotal: 100000 } })).data;
ok((await call(null, '/config')).data.promos === true, 'un code actif : le champ « code promo » apparaît à la commande');
ok((await call(C, '/admin/promos', { body: { code: 'PIRATE', type: 'percent', value: 50 } })).status >= 401, 'un client ne peut pas créer de code');

let q = await call(C, '/orders/promo-check', { body: { code: ' noel10 ', items } });
ok(q.status === 200 && q.data.amount === 3600 && q.data.label === '−10 %', 'aperçu : −10 % de 36 000 = 3 600 FCFA');
q = await call(C, '/orders/promo-check', { body: { code: 'CADEAU5000', items } });
ok(q.status === 400 && /dès 100/.test(q.data.error), 'montant minimum non atteint : message clair');
ok((await call(C, '/orders/promo-check', { body: { code: 'INCONNU', items } })).status === 400, 'code inconnu refusé');

ok((await call(C, '/orders', { body: { customer: cust, items, promoCode: 'FAUX' } })).data.promo === true, 'commande avec un code faux refusée (le client le retire)');
const o1 = (await call(C, '/orders', { body: { customer: cust, items, promoCode: 'noel10' } })).data;
let g1 = (await call(C, `/orders/${o1.id}`, { headers: { 'X-Order-Token': o1.token } })).data;
ok(g1.discount?.code === 'NOEL10' && g1.discount.amount === 3600 && g1.total === 36000 - 3600 + (g1.transportFee || 0), `remise calculée par le serveur et déduite du total (${g1.total} FCFA, transport non remisé)`);
ok((await call(C, '/orders', { body: { customer: cust, items, promoCode: 'NOEL10' } })).status === 400, 'même client, 2e utilisation refusée');
await call(C, `/orders/${o1.id}/cancel`, { headers: { 'X-Order-Token': o1.token }, body: {} });
const o1b = (await call(C, '/orders', { body: { customer: cust, items, promoCode: 'NOEL10' } })).data;
ok(o1b.id, 'commande annulée : le client peut réutiliser son code');
const C2 = await client('Paul Promo', '061117799'), C3 = await client('Léa Promo', '061117700');
ok((await call(C2, '/orders', { body: { customer: { ...cust, name: 'Paul Promo', phone: '061117799' }, items, promoCode: 'NOEL10' } })).data.id, '2e client : code accepté (2/2)');
ok((await call(C3, '/orders', { body: { customer: { ...cust, name: 'Léa Promo', phone: '061117700' }, items, promoCode: 'NOEL10' } })).status === 400, 'nombre total d\'utilisations atteint : refusé');
const list = (await call(A, '/admin/promos')).data;
ok(list.find((p) => p.code === 'NOEL10')?.uses === 2, 'Zado Pro : 2 utilisations comptées (la commande annulée ne compte pas)');
await call(A, `/admin/promos/${f5.id}`, { method: 'PATCH', body: { active: false } });
ok((await call(C3, '/orders/promo-check', { body: { code: 'CADEAU5000', items: [{ productId: 'a072', qty: 9 }] } })).status === 400, 'code désactivé : refusé');
await call(A, `/admin/promos/${f5.id}`, { method: 'PATCH', body: { endsAt: '2020-01-31', active: true } });
ok(/expiré/.test((await call(C3, '/orders/promo-check', { body: { code: 'CADEAU5000', items: [{ productId: 'a072', qty: 9 }] } })).data.error), 'date de fin passée : « Ce code a expiré »');

// ---- Paiement et facture avec la remise ----
await call(A, '/admin/settings/transport', { method: 'PUT', body: { mobile: { numbers: { airtel: '05 590 00 00' } } } });
const pay = await call(C, '/payments', { body: { orderId: o1b.id, token: o1b.token, method: 'mobile', mode: 'push', phone: '053590000' } });
const after = (await call(C, `/orders/${o1b.id}`, { headers: { 'X-Order-Token': o1b.token } })).data;
ok(pay.status === 201 && after.total === 36000 - 3600 + (after.transportFee || 0), 'demande de paiement : le total garde la remise');

// ---- « C'est pour offrir » ----
ok((await call(C3, '/orders', { body: { customer: { ...cust, name: 'Léa Promo', phone: '061117700' }, items, gift: { forSomeone: true, name: 'Maman', phone: '12' } } })).data.gift === true, 'cadeau sans numéro valable pour la personne : refusé');
const o3 = (await call(C3, '/orders', { body: { customer: { ...cust, name: 'Léa Promo', phone: '061117700' }, items, gift: { forSomeone: true, name: 'Maman Léonie', phone: '06 444 55 66', message: 'Joyeux Noël maman !' } } })).data;
const g3 = (await call(C3, `/orders/${o3.id}`, { headers: { 'X-Order-Token': o3.token } })).data;
ok(g3.gift?.name === 'Maman Léonie' && g3.gift.phone === '064445566' && g3.gift.message === 'Joyeux Noël maman !', 'cadeau enregistré : nom, téléphone (normalisé) et petit mot');
await call(C3, '/payments', { body: { orderId: o3.id, token: o3.token, method: 'mobile', mode: 'push', phone: '061117700' } });
await call(A, `/admin/orders/${o3.id}/transfer-received`, { body: {} });
const lab = await call(A, `/admin/parcels/labels?order=${o3.id}`);
ok(typeof lab.data === 'string' && lab.data.includes('CADEAU') && lab.data.includes('Maman Léonie') && lab.data.includes('064445566') && lab.data.includes('De la part de Léa Promo'), 'étiquette du colis : CADEAU, nom et téléphone de la personne, « de la part de »');
const adm = (await call(A, '/admin/orders')).data.orders.find((o) => o.id === o3.id);
ok(adm?.gift?.name === 'Maman Léonie' && adm.discount === undefined, 'Zado Pro : le cadeau est sur la fiche commande');

console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
