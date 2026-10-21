// Suivi de la course façon Grab : heure d'arrivée, étapes, véhicule, cap, livraisons avant, arrivé, adresse placée après coup
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
await call(A, '/admin/settings/sales', { method: 'PUT', body: { accountRequired: false } });
const ag = (await call(A, '/admin/agencies', { body: { name: 'Agence Centre', city: 'Pointe-Noire', lat: -4.7792, lng: 11.8638 } })).data;
const cu = (await call(A, '/admin/staff', { body: { name: 'Junior Malonga', login: 'junior', role: 'courier', phone: '065555555', vehicle: 'Moto Haojue rouge · PN 1234 AB' } })).data;
ok(cu.user.vehicle === 'Moto Haojue rouge · PN 1234 AB', 'véhicule du livreur enregistré à la création');
ok((await call(A, '/admin/staff/' + cu.user.id, { method: 'PATCH', body: { vehicle: 'Moto Honda bleue · PN 4321 CD' } })).data.vehicle === 'Moto Honda bleue · PN 4321 CD', 'véhicule modifiable par l\'administrateur');
const sup = (await call(A, '/admin/staff', { body: { name: 'F', login: 'four', role: 'orders', vehicle: 'Camion' } })).data;
ok(!sup.user.vehicle, 'champ véhicule réservé aux livreurs');
const C = { c: '' }; await call(C, '/admin/login', { body: { login: 'junior', password: cu.password } });
const mk = async (loc) => {
  const o = (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty: 1 }], customer: { name: 'Awa', phone: '061234567', city: 'Pointe-Noire', address: 'Mpita', ...(loc ? { location: loc } : {}) } } })).data;
  await call(null, '/payments', { body: { orderId: o.id, token: o.token, method: 'cash', agencyId: ag.id, fulfillment: 'delivery' } });
  await call(A, `/admin/orders/${o.id}/cash-received`, { body: {} });
  return o;
};
const far = { lat: -4.7588, lng: 11.8874 }, near = { lat: -4.7700, lng: 11.8700 };
const o1 = await mk(far), o2 = await mk(near), o3 = await mk(null);
for (const o of [o1, o2, o3]) await call(A, `/admin/orders/${o.id}/assign`, { body: { courierId: cu.user.id } });
const H = (o) => ({ 'X-Order-Token': o.token });
let w = (await call(null, `/orders/${o1.id}/live`, { headers: H(o1) })).data;
ok(w.active === false && w.waiting && w.courier.name === 'Junior' && w.courier.vehicle === 'Moto Honda bleue · PN 4321 CD' && w.steps.assignedAt && !w.steps.startedAt, 'avant la 1re position : prénom, véhicule, étapes « confirmée » et « confiée »');
await call(C, '/admin/courier/position', { body: { lat: -4.7792, lng: 11.8638 } });
await call(C, '/admin/courier/position', { body: { lat: -4.7770, lng: 11.8660 } });
const L = (await call(null, `/orders/${o1.id}/live`, { headers: H(o1) })).data;
ok(L.active && L.etaAt && Date.parse(L.etaAt) > Date.now() && L.etaMin >= 6, `heure d'arrivée estimée (${L.etaMin} min)`);
ok(L.courier.heading >= 20 && L.courier.heading <= 70, `cap calculé à partir du déplacement (${L.courier.heading}°) : l'icône tourne`);
ok(L.stopsBefore === 1 && L.steps.startedAt, 'une livraison plus proche avant la vôtre (« termine 1 livraison avant la vôtre ») ; étape « en route »');
ok(L.routeKind === 'direct' && L.route === null, 'sans calculateur d\'itinéraire branché : trait direct, rien envoyé ailleurs');
ok(!JSON.stringify(L).includes('065555555') && !JSON.stringify(L).includes('Malonga') && !JSON.stringify(L).includes('Mpita'), 'ni téléphone ni nom de famille du livreur, ni adresse des autres clients');
// Adresse placée après la commande
const n3 = (await call(null, `/orders/${o3.id}/live`, { headers: H(o3) })).data;
ok(n3.active && !n3.destination && !n3.etaAt, 'sans adresse sur la carte : livreur visible, pas d\'heure d\'arrivée');
ok((await call(null, `/orders/${o3.id}/location`, { body: { location: far } })).status === 404, 'placer l\'adresse sans la clé : refusé');
ok((await call(null, `/orders/${o3.id}/location`, { headers: H(o3), body: { location: { lat: 'x' } } })).status === 400, 'point invalide refusé');
const set = await call(null, `/orders/${o3.id}/location`, { headers: H(o3), body: { location: far } });
ok(set.status === 200 && set.data.customer.location.lat === far.lat, 'client : adresse placée sur la carte pendant la livraison');
ok((await call(null, `/orders/${o3.id}/live`, { headers: H(o3) })).data.etaAt, '… et l\'heure d\'arrivée apparaît');
// Arrivé
await call(C, '/admin/courier/position', { body: { lat: -4.77003, lng: 11.87003 } });
const a2 = (await call(null, `/orders/${o2.id}/live`, { headers: H(o2) })).data;
ok(a2.arrived && a2.etaMin === 0 && a2.steps.arrivedAt, 'à moins de 80 m : « votre livreur est arrivé »');
const ao = (await call(A, '/admin/orders')).data.orders.find((x) => x.id === o2.id);
ok(ao.arrivedNotified, 'notification « arrivé » envoyée une fois');
const cl = (await call(null, `/orders/${o2.id}`, { headers: H(o2) })).data;
ok(!('arrivedNotified' in cl) && !('liveStartKm' in cl), 'champs internes du suivi non montrés au client');
// Livrée : plus de suivi, plus de changement d'adresse
await call(C, `/admin/courier/deliveries/${o2.id}/deliver`, { body: { code: ao.deliveryCode } });
ok((await call(null, `/orders/${o2.id}/live`, { headers: H(o2) })).data.active === false, 'commande livrée : suivi terminé');
ok((await call(null, `/orders/${o2.id}/location`, { headers: H(o2), body: { location: far } })).status === 409, 'commande livrée : adresse plus modifiable');
// La course de démonstration n'existe pas hors démo
ok((await call(null, '/orders/CMD-DEMO-0002/live', { headers: { 'X-Order-Token': 'demo0000suivi0000kamwa0000course' } })).status === 404 && !(await call(null, '/config')).data.demoTrack, 'hors démo : aucune course simulée, aucune clé publique');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
