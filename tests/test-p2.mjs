// Priorité 2 de l'audit : recherche tolérante, suggestions, numéro de commande court, liste « À faire »
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data, headers: r.headers }; };
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });

// Recherche
const s1 = await call(null, '/products?q=iphne');
ok(s1.data.length > 3 && s1.data.every((p) => /iphone/i.test(p.name + p.description)) && decodeURIComponent(s1.headers.get('x-search-suggest') || '') === 'iphone', 'faute de frappe « iphne » : iPhones trouvés + « iphone » proposé');
const s2 = await call(null, '/products?q=ordi%20portable');
ok(s2.data.length > 0 && s2.data.slice(0, 5).every((p) => p.category === 'Ordinateurs'), 'synonymes « ordi portable » : ordinateurs');
const s3 = await call(null, '/products?q=T%C3%89L%C3%89PHONES');
ok(s3.data.length > 0 && s3.data[0].category === 'Téléphones', 'majuscules, accents et pluriel : « TÉLÉPHONES » → téléphones en premier');
const s4 = await call(null, '/products?q=xqzwv');
ok(Array.isArray(s4.data) && s4.data.length === 0, 'recherche absurde : aucun résultat (pas d\'erreur)');
const sg = await call(null, '/products/suggest?q=iphne');
ok(sg.data.products.length > 0 && sg.data.products.length <= 6 && sg.data.categories[0]?.category === 'Téléphones' && sg.data.didYouMean === 'iphone', 'suggestions : produits (6 max), rayon Téléphones, « vouliez-vous dire »');
ok(sg.data.products.every((p) => !('supplierPrice' in p) && !('costPrice' in p) && !('stock' in p)), 'suggestions : aucun prix d\'achat ni stock');
ok((await call(null, '/products/suggest?q=a')).data.products.length === 0, 'suggestions : rien en dessous de 2 lettres');
const pub = (await call(null, '/products')).data;
ok(pub.every((p) => !('costPrice' in p) && !('supplierPrice' in p) && !('lastPurchasePrice' in p) && !('origin' in p)), 'catalogue public : aucun prix d\'achat');
ok(typeof (await call(null, '/config')).data.accountRequired === 'boolean', '/api/config dit si le compte est obligatoire');

// Numéro de commande court et suivi
const cust = { name: 'Awa P2', phone: '061234567', city: 'Pointe-Noire', address: 'Mpita' };
const o1 = (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty: 1 }], customer: cust } })).data;
const o2 = (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty: 1 }], customer: cust } })).data;
ok(/^CMD-\d{5,}$/.test(o1.id) && Number(o2.id.slice(4)) === Number(o1.id.slice(4)) + 1, `numéro court et continu (${o1.id}, ${o2.id})`);
ok((await call(null, '/orders/' + o1.id)).status === 404, 'le numéro seul ne donne pas accès à la commande (clé obligatoire)');

// Liste « À faire » : une commande payée à livrer = à appeler + à planifier
const ag = (await call(A, '/admin/agencies', { body: { name: 'Agence Centre', city: 'Pointe-Noire', kind: 'agency', lat: -4.78, lng: 11.86 } })).data;
await call(null, '/payments', { body: { orderId: o1.id, token: o1.token, method: 'cash', agencyId: ag.id, fulfillment: 'delivery' } });
let st = (await call(A, '/admin/stats?days=30')).data;
ok(st.todo.toCollect >= 1, '« À faire » : paiement à encaisser au point relais');
await call(A, `/admin/orders/${o1.id}/cash-received`, { body: {} });
st = (await call(A, '/admin/stats?days=30')).data;
ok(st.todo.toCall >= 1 && st.todo.toPlan >= 1 && typeof st.todo.messages === 'number', '« À faire » : client à appeler, livraison à planifier, messages');
await call(A, `/admin/orders/${o1.id}/call`, { body: { ok: true } });
const st2 = (await call(A, '/admin/stats?days=30')).data;
ok(st2.todo.toCall === st.todo.toCall - 1, 'appel confirmé : la commande sort de « à appeler »');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
