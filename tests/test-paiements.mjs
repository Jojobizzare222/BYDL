import fs from 'node:fs';
const B = 'http://localhost:3999/api';
const PW = fs.readFileSync(process.argv[2], 'utf8').trim();
const call = async (j, path, opt = {}) => {
  const r = await fetch(B + path, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...opt.headers }, body: opt.body && JSON.stringify(opt.body) });
  const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
};
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const customer = { name: 'Client Paiement', phone: '061212121', city: 'Pointe-Noire' };
const prods = (await call(null, '/products')).data;
const P = prods.filter((p) => p.stock >= 3).sort((a, b) => a.stock - b.stock)[0];
const Q = prods.filter((p) => p.stock >= 5 && p.id !== P.id)[0];
const order = async (pid, qty = 1) => (await call(null, '/orders', { body: { customer, items: [{ productId: pid, qty }] } })).data;
const pay = (o, body) => call(null, '/payments', { body: { orderId: o.id, token: o.token, ...body } });
const stock = async (id) => (await call(null, '/products/' + id)).data.stock;
const ADM = { c: '' };
await call(ADM, '/admin/login', { body: { password: PW } });

// --- Sans agence
let m = (await call(null, '/payments/methods')).data;
ok(m.momo && m.card && !m.cash && m.agencies.length === 0, 'sans agence : Mobile Money + carte proposés, PAS les espèces');
const o0 = await order(Q.id);
ok((await pay(o0, { method: 'cash', agencyId: 'AG-X' })).status === 400, 'espèces sans agence -> refusé');
ok((await pay(o0, { method: 'bitcoin' })).status === 400, 'moyen de paiement inconnu -> refusé');

// --- Agences
ok((await call(ADM, '/admin/agencies', { body: { city: 'Pointe-Noire' } })).status === 400, 'agence sans nom -> refusée');
ok((await call(null, '/admin/agencies', { body: { name: 'X', city: 'Y' } })).status === 401, 'créer une agence sans être admin -> refusé');
const ag = (await call(ADM, '/admin/agencies', { body: { name: 'Kamwa Centre', city: 'Pointe-Noire', address: 'Av. Charles de Gaulle', hours: 'Lun-Sam 9h-18h', phone: '060000000' } })).data;
const agOff = (await call(ADM, '/admin/agencies', { body: { name: 'Kamwa Fermée', city: 'Brazzaville', active: false } })).data;
m = (await call(null, '/payments/methods')).data;
ok(m.cash && m.agencies.length === 1 && m.agencies[0].id === ag.id, 'avec 1 agence active (+1 inactive) : espèces proposées, seule l\'agence active listée');
ok((await pay(o0, { method: 'cash', agencyId: agOff.id })).status === 400, 'agence inactive -> refusée');

// --- Réservation en espèces
const o1 = await order(P.id, P.stock);
const r1 = await pay(o1, { method: 'cash', agencyId: ag.id });
const hold = Date.parse(r1.data.expiresAt) - Date.now();
ok(r1.status === 201 && r1.data.operator === 'cash' && r1.data.status === 'PENDING' && hold > 5000, 'réservation en espèces créée, avec échéance');
const seen = (await call(null, '/orders/' + o1.id, { headers: { 'X-Order-Token': o1.token } })).data;
ok(seen.fulfillment === 'pickup' && seen.agency.name === 'Kamwa Centre' && seen.pickupDeadline, 'commande marquée « retrait en agence » avec agence et date limite');
ok((await call(null, '/orders', { body: { customer, items: [{ productId: P.id, qty: 1 }] } })).status === 400, 'stock réservé pendant la réservation (autre client bloqué)');
ok((await pay(o1, { method: 'cash', agencyId: ag.id })).data.resumed === true, '2e réservation sur la même commande -> reprise, pas doublée');

// Le client change d'avis : paie par Mobile Money
const sw = await pay(o1, { method: 'momo', phone: '061212121' });
ok(sw.status === 201 && sw.data.operator === 'mtn', 'changement d\'avis : Mobile Money accepté après une réservation');
const o1b = (await call(null, '/orders/' + o1.id, { headers: { 'X-Order-Token': o1.token } })).data;
ok(o1b.fulfillment === 'delivery' && !o1b.agency, 'la commande repasse en « livraison »');
ok((await call(ADM, '/admin/orders/' + o1.id + '/cash-received', { body: {} })).status === 400, 'admin : encaissement espèces impossible sur une réservation remplacée');
await sleep(9000);
await call(null, '/payments/' + sw.data.id);
ok(await stock(P.id) === 0, 'payé par Mobile Money : stock décompté');

// --- Encaissement en agence par l'admin
const before = await stock(Q.id);
const o2 = await order(Q.id, 2);
await pay(o2, { method: 'cash', agencyId: ag.id });
ok((await call(ADM, '/admin/orders')).data.orders.find((o) => o.id === o2.id).payment.operator === 'cash', 'admin : la réservation apparaît (paiement « espèces »)');
const cr = await call(ADM, '/admin/orders/' + o2.id + '/cash-received', { body: {} });
ok(cr.status === 200 && cr.data.status === 'paid', 'admin « Paiement reçu en agence » -> commande payée');
ok(await stock(Q.id) === before - 2, `stock décompté (${before} -> ${before - 2})`);
ok((await call(ADM, '/admin/orders/' + o2.id + '/cash-received', { body: {} })).status === 400, 'double encaissement -> refusé');
ok((await call(ADM, '/admin/orders/' + o2.id, { method: 'PATCH', body: { status: 'shipped' } })).status === 400, 'retrait en agence : pas d\'« expédiée »');
ok((await call(ADM, '/admin/orders/' + o2.id, { method: 'PATCH', body: { status: 'delivered' } })).status === 400, 'retrait en agence : « Remise au client » sans le code du client -> refusée');
const code2 = (await call(ADM, '/admin/orders')).data.orders.find((x) => x.id === o2.id).deliveryCode;
ok((await call(ADM, '/admin/orders/' + o2.id, { method: 'PATCH', body: { status: 'delivered', code: code2 } })).data.status === 'delivered', 'retrait en agence : « Remise au client » avec le code OK');
ok((await call(null, '/admin/orders/' + o2.id + '/cash-received', { body: {} })).status === 401, 'encaissement sans être admin -> refusé');

// --- Expiration de la réservation (échéance raccourcie pour le test)
const o3 = await order(Q.id, 1);
const r3 = await pay(o3, { method: 'cash', agencyId: ag.id });
const wait = Date.parse(r3.data.expiresAt) - Date.now() + 1000;
await sleep(wait);
const exp = (await call(null, '/payments/' + r3.data.id)).data;
ok(exp.status === 'FAILED' && /expirée/.test(exp.reason), `réservation expirée après le délai : « ${exp.reason} »`);
const late = await call(ADM, '/admin/orders/' + o3.id + '/cash-received', { body: {} });
ok(late.status === 200 && late.data.status === 'paid', 'client venu en retard : l\'admin peut quand même encaisser');

// --- Carte bancaire (simulation)
const o4 = await order(Q.id, 1);
const c4 = await pay(o4, { method: 'card' });
ok(c4.status === 201 && c4.data.operator === 'card' && /^\/paiement-carte\/\?p=PAY-/.test(c4.data.redirectUrl), 'carte : redirection vers la page de paiement sécurisée');
ok((await call(null, '/payments/' + c4.data.id)).data.status === 'PENDING', 'carte : en attente tant que le client n\'a pas validé');
ok((await call(null, '/payments/' + sw.data.id + '/simulate-card', { body: { approve: true } })).status === 404, 'simulation carte impossible sur un paiement Mobile Money');
await call(null, '/payments/' + c4.data.id + '/simulate-card', { body: { approve: false } });
ok((await call(null, '/payments/' + c4.data.id)).data.status === 'FAILED', 'carte refusée -> paiement échoué');
ok((await call(null, '/payments/' + c4.data.id + '/simulate-card', { body: { approve: true } })).status === 409, 'impossible de changer d\'avis après coup sur la page carte');
const c4b = await pay(o4, { method: 'card' });
ok(c4b.status === 201 && c4b.data.id !== c4.data.id, 'nouvel essai par carte après un refus');
await call(null, '/payments/' + c4b.data.id + '/simulate-card', { body: { approve: true } });
ok((await call(null, '/payments/' + c4b.data.id)).data.status === 'SUCCESSFUL', 'carte acceptée -> paiement validé');
ok((await call(null, '/orders/' + o4.id, { headers: { 'X-Order-Token': o4.token } })).data.status === 'paid', 'commande payée par carte');

console.log(fails ? `\n${fails} échec(s)` : '\nTrois moyens de paiement : tout est OK');
process.exit(fails ? 1 : 0);
