// Frais de livraison par ville / quartier (priorité 3)
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const def = (await call(A, '/admin/settings/fees')).data;
ok(def.cities.every((c) => c.fee === 0), 'par défaut : livraison à 0 FCFA (comme avant)');
ok((await call(A, '/admin/settings/fees', { method: 'PUT', body: { cities: [{ city: 'X', fee: -5 }] } })).status === 400, 'tarif négatif refusé');
ok((await call(A, '/admin/settings/fees', { method: 'PUT', body: { cities: [{ city: 'A', fee: 1 }, { city: 'a', fee: 2 }] } })).status === 400, 'ville en double refusée');
ok((await call(A, '/admin/settings/fees', { method: 'PUT', body: { cities: [] } })).status === 400, 'au moins une ville');
const set = await call(A, '/admin/settings/fees', { method: 'PUT', body: { cities: [{ city: 'Pointe-Noire', fee: 1500, zones: [{ name: 'Ngoyo', fee: 2500 }] }, { city: 'Brazzaville', fee: 2000, zones: [] }], other: { allowed: false, fee: 0 }, freeFrom: 1000000 } });
ok(set.status === 200, 'tarifs enregistrés');
const cfg = (await call(null, '/config')).data.deliveryFees;
ok(cfg.cities[0].fee === 1500 && cfg.cities[0].zones[0].fee === 2500 && cfg.freeFrom === 1000000, 'boutique : tarifs publiés dans /api/config');
// Employé catalogue : pas le droit
const cat = (await call(A, '/admin/staff', { body: { login: 'catfrais', name: 'Cat', role: 'catalog' } })).data;
const C = { c: '' }; await call(C, '/admin/login', { body: { login: 'catfrais', password: cat.password } });
ok((await call(C, '/admin/settings/fees', { method: 'PUT', body: def })).status === 403, 'employé : ne peut pas changer les tarifs');

const ag = (await call(A, '/admin/agencies', { body: { name: 'Agence Centre', city: 'Pointe-Noire', kind: 'agency', lat: -4.78, lng: 11.86 } })).data;
const mk = async (customer, qty = 1) => (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty }], customer } })).data;
const price = (await call(null, '/products/a002')).data.price;
// Livraison Pointe-Noire, Mobile Money
const o1 = await mk({ name: 'Awa', phone: '061234567', city: 'Pointe-Noire', address: 'Tié-Tié' });
const p1 = (await call(null, '/payments', { body: { orderId: o1.id, token: o1.token, method: 'momo', phone: '061234567', operator: 'mtn' } })).data;
ok(p1.amount === price + 1500, `livraison Pointe-Noire : ${price} + 1 500 = ${p1.amount}`);
const r1 = (await call(null, '/orders/' + o1.id, { headers: { 'X-Order-Token': o1.token } })).data;
ok(r1.deliveryFee === 1500 && r1.total === price + 1500, 'commande : frais et total enregistrés');
// Quartier à tarif différent
const o2 = await mk({ name: 'Awa', phone: '061234567', city: 'pointe-noire', zone: 'ngoyo', address: 'Ngoyo' });
const p2 = (await call(null, '/payments', { body: { orderId: o2.id, token: o2.token, method: 'cash', agencyId: ag.id, fulfillment: 'delivery' } })).data;
ok(p2.amount === price + 2500, 'quartier Ngoyo (majuscules/accents ignorés) : 2 500 FCFA, payé au point relais puis livré');
// Retrait au point relais : gratuit, même si la commande avait des frais avant
const o3 = await mk({ name: 'Awa', phone: '061234567', city: 'Brazzaville', address: 'Moungali' });
const p3 = (await call(null, '/payments', { body: { orderId: o3.id, token: o3.token, method: 'cash', agencyId: ag.id, fulfillment: 'pickup' } })).data;
ok(p3.amount === price, 'retrait au point relais : aucun frais');
// Ville non desservie
const o4 = await mk({ name: 'Awa', phone: '061234567', city: 'Ouesso', address: 'Centre' });
const p4 = await call(null, '/payments', { body: { orderId: o4.id, token: o4.token, method: 'momo', phone: '061234567', operator: 'mtn' } });
ok(p4.status === 400 && p4.data.noDelivery, 'ville non desservie : livraison refusée, retrait proposé');
const p4b = (await call(null, '/payments', { body: { orderId: o4.id, token: o4.token, method: 'cash', agencyId: ag.id, fulfillment: 'pickup' } })).data;
ok(p4b.amount === price, '… et le retrait au point relais reste possible');
// Livraison offerte au-delà du seuil
const big = Math.ceil(1000000 / price);
const o5 = await mk({ name: 'Awa', phone: '061234567', city: 'Brazzaville', address: 'Moungali' }, Math.min(big, 5));
if (price * Math.min(big, 5) >= 1000000) {
  const p5 = (await call(null, '/payments', { body: { orderId: o5.id, token: o5.token, method: 'momo', phone: '061234567', operator: 'mtn' } })).data;
  ok(p5.amount === price * Math.min(big, 5), 'achat ≥ 1 000 000 FCFA : livraison offerte');
} else ok(true, '(seuil non atteignable avec ce produit : test sauté)');
// Le navigateur ne peut pas imposer ses frais
const o6 = (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty: 1 }], customer: { name: 'Awa', phone: '061234567', city: 'Brazzaville', address: 'x' }, deliveryFee: 0, total: 1 } })).data;
const p6 = (await call(null, '/payments', { body: { orderId: o6.id, token: o6.token, method: 'momo', phone: '061234567', operator: 'mtn', deliveryFee: 0, amount: 1 } })).data;
ok(p6.amount === price + 2000, 'frais et total imposés par le navigateur : ignorés');
// Facture : ligne livraison
await new Promise((r) => setTimeout(r, 9500));
await call(null, '/payments/' + p1.id);
const inv = (await call(A, '/admin/documents')).data.documents.find((d) => d.orderId === o1.id && d.type === 'invoice');
const html = inv ? (await call(A, '/admin/documents/' + inv.id + '/print')).data : '';
ok(inv && inv.amount === price + 1500 && /Livraison/.test(html), 'facture : total avec livraison + ligne « Livraison »');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
