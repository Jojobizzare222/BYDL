// Priorité 1 de l'audit : commandes fantômes (même commande réutilisée, annulation client, annulation automatique)
// À lancer avec ABANDON_NO_PAYMENT_HOURS=0.0006 ABANDON_GRACE_HOURS=0.0006 PICKUP_HOLD_HOURS=0.0006 (≈ 2 s)
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const ag = (await call(A, '/admin/agencies', { body: { name: 'Agence Centre', city: 'Pointe-Noire', kind: 'agency', lat: -4.78, lng: 11.86 } })).data;
const cust = { name: 'Awa P1', phone: '061234567', city: 'Pointe-Noire', address: '' };
const newOrder = async () => (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty: 1 }], customer: cust } })).data;
const adminOrder = async (id) => (await call(A, '/admin/orders')).data.orders.find((x) => x.id === id);
const nbOrders = async () => (await call(A, '/admin/orders')).data.orders.length;

// 1) Coordonnées corrigées : la MÊME commande est mise à jour
const o = await newOrder();
const before = await nbOrders();
ok((await call(null, `/orders/${o.id}/customer`, { method: 'PATCH', body: { customer: { ...cust, address: 'Mpita' } } })).status === 404, 'modifier sans la clé de la commande : refusé');
ok((await call(null, `/orders/${o.id}/customer`, { method: 'PATCH', headers: { 'X-Order-Token': o.token }, body: { customer: { ...cust, phone: '123' } } })).status === 400, 'numéro invalide : refusé');
const up = await call(null, `/orders/${o.id}/customer`, { method: 'PATCH', headers: { 'X-Order-Token': o.token }, body: { customer: { ...cust, address: 'Quartier Mpita, rue 12' } } });
ok(up.status === 200 && up.data.id === o.id && up.data.customer.address === 'Quartier Mpita, rue 12' && (await nbOrders()) === before, 'adresse ajoutée sur la même commande (aucune nouvelle commande)');

// 2) Le client annule sa réservation : paiement en attente annulé, articles libérés
const p = (await call(null, '/payments', { body: { orderId: o.id, token: o.token, method: 'cash', agencyId: ag.id, fulfillment: 'delivery' } })).data;
ok(p.status === 'PENDING', 'réservation au point relais créée');
ok((await call(null, `/orders/${o.id}/cancel`, { body: {} })).status === 404, 'annuler sans la clé : refusé');
const c = await call(null, `/orders/${o.id}/cancel`, { headers: { 'X-Order-Token': o.token }, body: {} });
const ao = await adminOrder(o.id);
ok(c.status === 200 && c.data.status === 'cancelled' && ao.cancelReason === 'Annulée par le client' && ao.payment.status === 'CANCELLED', 'client : « Annuler ma réservation » (paiement en attente annulé)');
ok((await call(null, `/orders/${o.id}/cancel`, { headers: { 'X-Order-Token': o.token }, body: {} })).status === 409, 'déjà annulée : refusé');
ok((await call(null, `/orders/${o.id}/customer`, { method: 'PATCH', headers: { 'X-Order-Token': o.token }, body: { customer: { ...cust, address: 'x' } } })).status === 409, 'commande annulée : plus modifiable');
// Commande payée : pas d'annulation par le client
const op = await newOrder();
await call(null, '/payments', { body: { orderId: op.id, token: op.token, method: 'cash', agencyId: ag.id, fulfillment: 'pickup' } });
await call(A, `/admin/orders/${op.id}/cash-received`, { body: {} });
ok((await call(null, `/orders/${op.id}/cancel`, { headers: { 'X-Order-Token': op.token }, body: {} })).status === 409, 'commande payée : le client ne peut pas l\'annuler lui-même');

// 3) Annulation automatique des commandes jamais payées
const ghost = await newOrder(); // aucune demande de paiement
const resa = await newOrder(); // réservation qui va expirer
await call(null, '/payments', { body: { orderId: resa.id, token: resa.token, method: 'cash', agencyId: ag.id, fulfillment: 'pickup' } });
await sleep(1500);
const fresh = await newOrder(); // toute récente : doit rester
await sleep(1500);
await call(A, '/admin/orders'); // le balayage se fait aussi à la lecture (Vercel)
ok((await adminOrder(ghost.id)).status === 'cancelled' && (await adminOrder(ghost.id)).autoCancelled, 'commande sans paiement : annulée automatiquement après le délai');
ok((await adminOrder(fresh.id)).status === 'pending_payment', 'commande récente : gardée');
await sleep(3500);
await call(A, '/admin/orders');
const ar = await adminOrder(resa.id);
ok(ar.status === 'cancelled' && ar.cancelReason === 'Non payée dans les délais', 'réservation expirée + délai de grâce : annulée automatiquement');
const tr = (await call(null, `/orders/${resa.id}`, { headers: { 'X-Order-Token': resa.token } })).data;
ok(tr.status === 'cancelled' && tr.cancelReason === 'Non payée dans les délais', 'client : voit pourquoi sa commande est annulée');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
