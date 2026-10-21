import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const mk = async (name, login, role) => { const r = (await call(A, '/admin/staff', { body: { name, login, role } })).data; const J = { c: '' }; await call(J, '/admin/login', { body: { login, password: r.password || r.user?.password } }); return { J, id: r.user?.id || r.id }; };
const cour = await mk('Didier Livreur', 'didier.cal', 'courier');
const cour2 = await mk('Paul Livreur', 'paul.cal', 'courier');
const cat = await mk('Céline Catalogue', 'celine.cal', 'catalog');
const ag = (await call(A, '/admin/agencies', { body: { name: 'Agence Centre', city: 'Pointe-Noire', kind: 'agency', lat: -4.78, lng: 11.86 } })).data;
const cust = { name: 'Awa Calendrier', phone: '061234567', city: 'Pointe-Noire', address: 'Mpita, rue 12' };
const order = async (fulfillment = 'delivery') => {
  const o = (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty: 1 }], customer: cust } })).data;
  await call(null, '/payments', { body: { orderId: o.id, token: o.token, method: 'cash', agencyId: ag.id, fulfillment } });
  await call(A, `/admin/orders/${o.id}/cash-received`, { body: {} });
  return o;
};
const d = (n) => { const x = new Date(Date.now() + n * 86400000); return x.toLocaleDateString('en-CA', { timeZone: 'Africa/Brazzaville' }); };
const o1 = await order(), o2 = await order(), op = await order('pickup');
const unpaid = (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty: 1 }], customer: cust } })).data;

// 1) Contrôles
ok((await call(A, `/admin/orders/${op.id}/plan`, { body: { date: d(1), slot: 'morning' } })).status === 400, 'retrait en agence : pas de planification');
ok((await call(A, `/admin/orders/${unpaid.id}/plan`, { body: { date: d(1), slot: 'morning' } })).status === 400, 'commande non payée : refusée');
ok((await call(A, `/admin/orders/${o1.id}/plan`, { body: { date: d(-1), slot: 'morning' } })).status === 400, 'date passée refusée');
ok((await call(A, `/admin/orders/${o1.id}/plan`, { body: { date: d(1), slot: 'nuit' } })).status === 400, 'créneau inconnu refusé');
ok((await call(cat.J, `/admin/orders/${o1.id}/plan`, { body: { date: d(1), slot: 'morning' } })).status === 403, 'employé Catalogue : pas accès');
const cal0 = (await call(A, `/admin/calendar?from=${d(0)}&to=${d(30)}`)).data;
const ours = (l) => l.filter((x) => [o1.id, o2.id].includes(x.id));
ok(ours(cal0.unplanned).length === 2 && cal0.planned.length === 0, 'calendrier : 2 commandes à planifier, aucune planifiée');

// 2) Planifier, avec livreur
const p1 = await call(A, `/admin/orders/${o1.id}/plan`, { body: { date: d(1), slot: 'afternoon', courierId: cour.id } });
ok(p1.status === 200 && p1.data.planned.date === d(1) && p1.data.planned.slot === 'afternoon' && p1.data.status === 'shipped' && p1.data.courierId === cour.id, 'livraison planifiée demain après-midi + confiée à Didier');
const p2 = await call(A, `/admin/orders/${o2.id}/plan`, { body: { date: d(1), slot: 'morning' } });
ok(p2.status === 200 && p2.data.status === 'paid' && !p2.data.courierId, 'planifiée sans livreur : la commande reste « payée »');
const cal1 = (await call(A, `/admin/calendar?from=${d(1)}&to=${d(1)}`)).data;
ok(cal1.planned.length === 2 && ours(cal1.unplanned).length === 0 && cal1.planned.find((x) => x.id === o1.id).courierName === 'Didier Livreur' && cal1.planned.find((x) => x.id === o1.id).customer.phone, 'calendrier du jour : 2 livraisons, livreur et téléphone visibles');
ok((await call(A, `/admin/calendar?from=${d(2)}&to=${d(2)}`)).data.planned.length === 0, 'autre jour : vide');
// Déplacer
const mv = await call(A, `/admin/orders/${o2.id}/plan`, { body: { date: d(3), slot: 'evening' } });
ok(mv.data.planned.date === d(3) && mv.data.planned.slot === 'evening' && (await call(A, `/admin/calendar?from=${d(1)}&to=${d(1)}`)).data.planned.length === 1, 'livraison déplacée à J+3 soir');
// Client
const cl = (await call(null, `/orders/${o2.id}`, { headers: { 'X-Order-Token': o2.token } })).data;
ok(cl.planned && cl.planned.date === d(3) && /Soir/.test(cl.planned.label) && !('by' in cl.planned), 'client : date et créneau visibles (sans qui a planifié)');
// Livreur
const cc = (await call(cour.J, `/admin/calendar?from=${d(0)}&to=${d(30)}`)).data;
ok(cc.planned.length === 1 && cc.planned[0].id === o1.id && cc.unplanned.length === 0 && cc.couriers.length === 0, 'livreur : seulement ses livraisons planifiées');
ok((await call(cour2.J, `/admin/calendar?from=${d(0)}&to=${d(30)}`)).data.planned.length === 0, 'autre livreur : rien');
const dl = (await call(cour.J, '/admin/courier/deliveries')).data;
ok(dl.current[0].planned?.date === d(1) && /Après-midi/.test(dl.current[0].planned.label), '« Mes livraisons » : date et créneau sur la livraison');
// Retirer
ok((await call(A, `/admin/orders/${o2.id}/plan`, { method: 'DELETE' })).data.planned === null && (await call(A, `/admin/orders/${o2.id}/plan`, { method: 'DELETE' })).status === 400, 'planification retirée (une seule fois)');
// Livrée → disparaît du calendrier
await call(cour.J, `/admin/courier/deliveries/${o1.id}/deliver`, { body: { code: (await call(A, '/admin/orders')).data.orders.find((x) => x.id === o1.id).deliveryCode } });
ok((await call(A, `/admin/calendar?from=${d(1)}&to=${d(1)}`)).data.planned.find((x) => x.id === o1.id)?.status === 'delivered', 'livrée : reste visible avec le statut « livrée »');
const stats = (await call(A, '/admin/stats?days=7')).data;
ok(typeof stats.todo?.todayDeliveries === 'number' || typeof stats.todayDeliveries === 'number', 'tableau de bord : compteur des livraisons du jour');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
