import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const ag = (await call(A, '/admin/agencies', { body: { name: 'Agence Centre', city: 'Pointe-Noire', kind: 'agency', lat: -4.78, lng: 11.86 } })).data;
const ag2 = (await call(A, '/admin/agencies', { body: { name: 'Relais Tié-Tié', city: 'Pointe-Noire', kind: 'partner', lat: -4.79, lng: 11.88 } })).data;
const mk = async (name, login, role) => { const r = (await call(A, '/admin/staff', { body: { name, login, role } })).data; const J = { c: '' }; await call(J, '/admin/login', { body: { login, password: r.password || r.user?.password } }); return { J, id: r.user?.id || r.id }; };
const cour = await mk('Didier Livreur', 'didier.liv', 'courier');
const cat = await mk('Céline Catalogue', 'celine.cat2', 'catalog');
const cust = { name: 'Awa Colis', phone: '061234567', city: 'Pointe-Noire', address: 'Quartier Mpita, rue 12' };
const order = async (fulfillment, qty = 1) => {
  const o = (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty }], customer: cust } })).data;
  await call(null, '/payments', { body: { orderId: o.id, token: o.token, method: 'cash', agencyId: ag.id, fulfillment } });
  return o;
};
const adminOrder = async (id) => (await call(A, '/admin/orders')).data.orders.find((x) => x.id === id);

// 1) Retrait au point relais
const o1 = await order('pickup');
await sleep(80);
ok(!(await adminOrder(o1.id)).parcels.length, 'réservation non payée : pas encore de colis');
await call(A, `/admin/orders/${o1.id}/cash-received`, { body: {} });
await sleep(120);
let a1 = await adminOrder(o1.id);
const c1 = a1.parcels[0];
ok(a1.parcels.length === 1 && /^KM-\d{6}-\d{3}$/.test(c1.number) && c1.stage === 'preparing', `commande payée : colis ${c1?.number} créé « à préparer »`);
const lk = await call(A, '/admin/parcels/lookup?code=' + encodeURIComponent(`https://bydl.vercel.app/admin/#/colis/${c1.number}`));
ok(lk.status === 200 && lk.data.id === c1.id && lk.data.actions.includes('prepare') && lk.data.actions.includes('at_relay') && !lk.data.actions.includes('to_courier'), 'scan du QR (adresse complète) : colis trouvé, actions « préparé » / « point relais »');
ok((await call(A, `/admin/parcels/${c1.id}/action`, { body: { action: 'to_courier' } })).status === 400, 'retrait : « remis au livreur » refusé');
ok((await call(A, `/admin/parcels/${c1.id}/action`, { body: { action: 'prepare' } })).data.stage === 'ready', 'scan « préparé » → prêt (emballé)');
const rel = await call(A, `/admin/parcels/${c1.id}/action`, { body: { action: 'at_relay', agencyId: ag2.id } });
ok(rel.data.stage === 'at_relay' && rel.data.place.name === 'Relais Tié-Tié', 'scan « arrivé au point relais » (point choisi)');
await sleep(80);
const cl = (await call(null, `/orders/${o1.id}`, { headers: { 'X-Order-Token': o1.token } })).data;
ok(cl.readyAtRelayAt && cl.parcels[0].stage === 'at_relay' && cl.parcels[0].place === 'Relais Tié-Tié' && !('history' in cl.parcels[0]), 'client : « au point relais Relais Tié-Tié » (sans l\'historique interne)');
ok((await call(A, `/admin/parcels/${c1.id}/action`, { body: { action: 'handover', code: '0000' } })).status === 400, 'remise au client : code faux refusé');
a1 = await adminOrder(o1.id);
const h = await call(A, `/admin/parcels/${c1.id}/action`, { body: { action: 'handover', code: a1.deliveryCode } });
await sleep(120);
ok(h.status === 200 && h.data.stage === 'delivered' && (await adminOrder(o1.id)).status === 'delivered', 'bon code : colis remis, commande « remise au client »');

// 2) Livraison à domicile, 2 colis, livreur
const o2 = await order('delivery', 2);
await call(A, `/admin/orders/${o2.id}/cash-received`, { body: {} });
await sleep(120);
const add = await call(A, `/admin/parcels/order/${o2.id}`, { body: {} });
ok(add.status === 201 && add.data.parcels.length === 2 && add.data.parcels[1].index === 2 && add.data.parcels[1].count === 2, 'colis supplémentaire : 2 colis (1/2, 2/2)');
const [p1, p2] = add.data.parcels;
ok((await call(cour.J, '/admin/parcels/lookup?code=' + p1.number)).status === 404, 'livreur : colis d\'une commande qui ne lui est pas confiée → introuvable');
ok((await call(A, `/admin/parcels/${p1.id}/action`, { body: { action: 'to_courier' } })).status === 400, '« remis au livreur » sans livreur choisi → refusé');
const tc = await call(A, `/admin/parcels/${p1.id}/action`, { body: { action: 'to_courier', courierId: cour.id } });
await sleep(120);
const a2 = await adminOrder(o2.id);
ok(tc.data.stage === 'with_courier' && a2.status === 'shipped' && a2.courierId === cour.id, 'scan « remis au livreur » : colis chez Didier, commande confiée au livreur');
ok(a2.parcels.find((x) => x.id === p2.id).stage === 'preparing', 'l\'autre colis n\'est pas déplacé tant qu\'il n\'est pas scanné');
const cl2 = (await call(cour.J, '/admin/parcels')).data.parcels;
ok(cl2.length === 2 && cl2.every((x) => x.orderId === o2.id), 'livreur : voit seulement les colis de ses livraisons');
const tk = await call(cour.J, `/admin/parcels/${p2.id}/action`, { body: { action: 'take' } });
ok(tk.data.stage === 'with_courier', 'livreur : « Je prends le colis »');
await call(cour.J, `/admin/courier/deliveries/${o2.id}/deliver`, { body: { code: a2.deliveryCode } });
await sleep(150);
ok((await adminOrder(o2.id)).parcels.every((x) => x.stage === 'delivered'), 'livraison avec le code : tous les colis « remis au client »');

// 3) Annulation → retour en stock ; livreur choisi depuis la commande → colis suivent
const o3 = await order('delivery');
await call(A, `/admin/orders/${o3.id}/cash-received`, { body: {} });
await sleep(100);
await call(A, `/admin/orders/${o3.id}/assign`, { body: { courierId: cour.id } });
await sleep(120);
ok((await adminOrder(o3.id)).parcels[0].stage === 'with_courier', '« Confier au livreur » depuis la commande : le colis suit');
await call(A, `/admin/orders/${o3.id}/fail`, { body: { reason: 'absent' } });
await sleep(120);
ok((await adminOrder(o3.id)).parcels[0].stage === 'ready', 'client absent : colis revenu à l\'entrepôt');
await call(A, `/admin/orders/${o3.id}`, { method: 'PATCH', body: { status: 'cancelled' } });
await sleep(120);
ok((await adminOrder(o3.id)).parcels[0].stage === 'returned', 'commande annulée : colis « retour en stock »');

// 4) Étiquettes, droits, liste
const lab = await call(A, `/admin/parcels/labels?order=${o2.id}`);
ok(lab.status === 200 && lab.data.includes('<svg') && lab.data.includes(p1.number) && lab.data.includes(p2.number) && lab.data.includes('LIVRAISON À DOMICILE'), 'étiquettes : QR + numéros + destination');
const lab1 = await call(A, `/admin/parcels/labels?ids=${c1.id}`);
ok(lab1.data.includes('RETRAIT AU POINT RELAIS') && lab1.data.includes('Relais Tié-Tié'), 'étiquette retrait : point relais');
ok((await call(cat.J, '/admin/parcels')).status === 403 && (await call(cour.J, `/admin/parcels/labels?order=${o2.id}`)).status === 403, 'catalogue : pas d\'accès ; livreur : pas d\'impression d\'étiquettes');
ok((await call(null, '/admin/parcels')).status === 401, 'sans connexion : refusé');
const nums = (await call(A, '/admin/parcels')).data.parcels.map((x) => x.number);
ok(new Set(nums).size === nums.length, `numéros uniques (${nums.length} colis)`);
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
