// Priorité 3 : livreur (journée), avis clients, aperçu de partage, sécurité (en-têtes, compression)
import fs from 'node:fs';
import { createRequire } from 'node:module';
const sharp = createRequire('/Users/josephgambaka/Desktop/BYDL/package.json')('sharp');
const ID = { idType: 'cni', idPhoto: 'data:image/jpeg;base64,' + (await sharp({ create: { width: 800, height: 500, channels: 3, background: '#8899aa' } }).jpeg().toBuffer()).toString('base64') };
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data, headers: r.headers }; };
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const ag = (await call(A, '/admin/agencies', { body: { name: 'Agence Centre', city: 'Pointe-Noire', kind: 'agency', lat: -4.78, lng: 11.86 } })).data;
const lv = (await call(A, '/admin/staff', { body: { name: 'Lucas Livreur', login: 'lucas', role: 'courier', phone: '062222222' } })).data;
const L = { c: '' }; await call(L, '/admin/login', { body: { login: 'lucas', password: lv.password } });

// Client avec compte
const C = { c: '' };
const reg = await call(C, '/account/register', { body: { ...ID, name: 'Awa Mbemba Test', phone: '061234567' } });
ok(reg.status === 201, 'compte client créé');
const buy = async (who, productId = 'a002') => {
  const o = (await call(who, '/orders', { body: { items: [{ productId, qty: 1 }], customer: { name: 'Awa Mbemba Test', phone: '061234567', city: 'Pointe-Noire', address: 'Mpita, rue 12' } } })).data;
  await call(who, '/payments', { body: { orderId: o.id, token: o.token, method: 'cash', agencyId: ag.id, fulfillment: 'delivery' } });
  await call(A, `/admin/orders/${o.id}/cash-received`, { body: {} });
  return o;
};
const o1 = await buy(C);
const o2 = await buy(C, 'a003');
// Avis : pas encore livré
ok((await call(C, '/account/reviews', { body: { productId: 'a002', rating: 5 } })).status === 403, 'avis refusé tant que le produit n\'est pas livré');
ok((await call(null, '/account/reviews', { body: { productId: 'a002', rating: 5 } })).status === 401, 'avis refusé sans compte');
// Livraison par Lucas
await call(A, `/admin/orders/${o1.id}/assign`, { body: { courierId: lv.user.id } });
await call(A, `/admin/orders/${o2.id}/assign`, { body: { courierId: lv.user.id } });
let d = (await call(L, '/admin/courier/deliveries')).data;
ok(d.summary && d.summary.toDo === 2 && d.summary.delivered === 0, 'livreur : résumé du jour (2 à livrer, 0 livrée)');
const code1 = (await call(A, '/admin/orders')).data.orders.find((x) => x.id === o1.id).deliveryCode;
ok((await call(L, `/admin/courier/deliveries/${o1.id}/deliver`, { body: { code: code1 } })).status === 200, 'colis 1 remis avec le code');
await call(L, `/admin/courier/deliveries/${o2.id}/fail`, { body: { reason: 'absent' } });
d = (await call(L, '/admin/courier/deliveries')).data;
ok(d.summary.delivered === 1 && d.summary.failed === 1 && d.summary.toDo === 0, 'résumé : 1 livrée, 1 ratée, plus rien à faire');
// Avis après livraison
ok((await call(C, '/account/reviews', { body: { productId: 'a002', rating: 0 } })).status === 400, 'note 0 refusée');
const rv = await call(C, '/account/reviews', { body: { productId: 'a002', rating: 4, text: 'Très bon téléphone, livré vite.' } });
ok(rv.status === 201 && rv.data.name === 'Awa T.' && !JSON.stringify(rv.data).includes('061234567'), 'avis publié : prénom + initiale, sans téléphone');
ok((await call(C, '/account/reviews', { body: { productId: 'a003', rating: 5 } })).status === 403, 'produit non livré (livraison ratée) : pas d\'avis');
const rv2 = await call(C, '/account/reviews', { body: { productId: 'a002', rating: 5, text: 'Je confirme !' } });
let pr = (await call(C, '/products/a002/reviews')).data;
ok(rv2.status === 201 && pr.count === 1 && pr.avg === 5 && pr.list[0].text === 'Je confirme !' && pr.mine.can && pr.mine.review.rating === 5, 'un seul avis par client et par produit (modifié)');
ok((await call(null, '/products/a002')).data.rating?.avg === 5 && (await call(null, '/products')).data.find((p) => p.id === 'a002').rating.count === 1, 'note moyenne sur la fiche et la liste');
ok((await call(null, '/products/a002/reviews')).data.mine === null, 'visiteur : voit les avis, pas de formulaire');
ok(!JSON.stringify(pr).includes('customerId') && !JSON.stringify(pr).includes(o1.id), 'avis publics : ni compte client ni numéro de commande');
// Modération
const ar = (await call(A, '/admin/reviews')).data;
ok(ar.length === 1 && ar[0].orderId === o1.id, 'Kamwa Pro : liste des avis (avec la commande)');
const cat = (await call(A, '/admin/staff', { body: { name: 'Clara', login: 'clara', role: 'catalog' } })).data;
const CA = { c: '' }; await call(CA, '/admin/login', { body: { login: 'clara', password: cat.password } });
ok((await call(CA, '/admin/reviews/' + ar[0].id, { method: 'PATCH', body: { hidden: true } })).data.hidden === true, 'employé Catalogue : masque un avis');
ok((await call(null, '/products/a002/reviews')).data.count === 0 && !(await call(null, '/products/a002')).data.rating, 'avis masqué : disparaît de la boutique');
ok((await call(L, '/admin/reviews')).status === 403, 'livreur : pas accès aux avis');
await call(A, '/admin/reviews/' + ar[0].id, { method: 'PATCH', body: { hidden: false } });
ok((await call(null, '/products/a002/reviews')).data.count === 1, 'avis réaffiché');

// Aperçu de partage
const share = await fetch('http://localhost:3999/p/a002'); const html = await share.text();
ok(share.status === 200 && /og:title" content="[^"]+FCFA/.test(html) && /og:image" content="http:\/\/[^"]+\.(jpg|png)/.test(html) && html.includes('url=/#/p/a002'), 'lien /p/<id> : aperçu avec nom, prix, photo, puis la fiche');
ok((await fetch('http://localhost:3999/p/inexistant')).status === 404, 'produit inconnu : 404 (lien vers la boutique)');
const pend = (await call(A, '/admin/products', { body: { name: 'Secret <b>X</b>', category: 'Audio', stock: 1, price: 1000 } })).data;
await call(A, '/admin/products/' + pend.id, { method: 'PATCH', body: { active: false } });
const sh2 = await (await fetch('http://localhost:3999/p/' + pend.id)).text();
ok(!sh2.includes('Secret'), 'produit masqué : pas d\'aperçu');

// Sécurité : en-têtes + compression
const h = await fetch('http://localhost:3999/', { headers: { 'Accept-Encoding': 'gzip' } });
ok(/default-src 'self'/.test(h.headers.get('content-security-policy') || '') && h.headers.get('x-frame-options') === 'SAMEORIGIN' && h.headers.get('x-content-type-options') === 'nosniff', 'en-têtes de sécurité présents (CSP, anti-iframe, nosniff)');
ok(!h.headers.get('x-powered-by'), 'pas d\'en-tête X-Powered-By');
const g = await fetch('http://localhost:3999/js/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
ok(g.headers.get('content-encoding') === 'gzip', 'pages et scripts compressés (gzip)');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
