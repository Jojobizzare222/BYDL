import fs from 'node:fs';
const B = 'http://localhost:3999/api';
const PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let cookie = '';
const j = async (path, opt = {}) => {
  const isBlob = opt.raw;
  const r = await fetch(B + path, { method: opt.method, headers: { 'Content-Type': opt.type || 'application/json', Cookie: opt.noCookie ? '' : cookie }, body: isBlob ? opt.raw : opt.body && JSON.stringify(opt.body) });
  const sc = r.headers.get('set-cookie'); if (sc && !opt.noCookie) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null), setCookie: sc };
};
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ok((await j('/admin/products', { noCookie: true })).status === 401, 'produits admin sans connexion -> refusé');
ok((await j('/admin/orders', { noCookie: true })).status === 401, 'commandes admin sans connexion -> refusé');
const lg = await j('/admin/login', { method: 'POST', body: { password: PW } });
ok(lg.status === 200 && /HttpOnly/.test(lg.setCookie) && /SameSite=Strict/.test(lg.setCookie), 'connexion -> cookie HttpOnly + SameSite=Strict');
const meTxt = JSON.stringify((await j('/admin/me')).data); ok(!/a00f|passwordHash|motdepasse-test|scrypt/i.test(meTxt), 'aucune info secrète renvoyée par /me (ni empreinte ni mot de passe)');

// Produits
const bad = [
  [{ name: '', category: 'Audio', price: 1000, stock: 1 }, 'nom vide'],
  [{ name: 'X', category: 'Inconnue', price: 1000, stock: 1 }, 'catégorie inconnue'],
  [{ name: 'X', category: 'Audio', price: '10.5', stock: 1 }, 'prix à virgule'],
  [{ name: 'X', category: 'Audio', price: 1000, oldPrice: 900, stock: 1 }, 'prix barré plus petit'],
  [{ name: 'X', category: 'Audio', price: 1000, stock: -1 }, 'stock négatif'],
  [{ name: 'X', category: 'Audio', price: 1000, stock: 1, image: '../../etc/passwd' }, 'chemin de photo piégé'],
];
for (const [body, why] of bad) ok((await j('/admin/products', { method: 'POST', body })).status === 400, `produit refusé : ${why}`);

// Photo
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const up = await j('/admin/uploads', { method: 'POST', raw: png, type: 'image/png' });
ok(up.status === 201 && /^\/images\/uploads\/[\w-]+\.png$/.test(up.data.url), `envoi photo PNG -> ${up.data?.url}`);
ok((await fetch('http://localhost:3999' + up.data.url)).status === 200, 'photo envoyée visible sur le site');
ok((await j('/admin/uploads', { method: 'POST', raw: Buffer.from('<script>alert(1)</script>'), type: 'image/png' })).status === 400, 'faux fichier image (texte) -> refusé');
ok((await j('/admin/uploads', { method: 'POST', raw: png, type: 'image/png', noCookie: true })).status === 401, 'envoi photo sans connexion -> refusé');

const created = await j('/admin/products', { method: 'POST', body: { name: 'Jogging test Baydel', brand: 'Baydel', category: 'Audio', price: '12000', oldPrice: '15000', stock: '3', description: 'Test', image: up.data.url, featured: true } });
ok(created.status === 201 && created.data.universe === 'Électronique' && created.data.price === 12000 && created.data.active === true, 'produit créé (univers Électronique déduit, prix en nombre)');
const pid = created.data.id;
ok((await j('/products/' + pid, { noCookie: true })).status === 200, 'nouveau produit visible sur la boutique');
const hidden = await j('/admin/products/' + pid, { method: 'PATCH', body: { active: false, price: 11000 } });
ok(hidden.data.active === false && hidden.data.price === 11000 && hidden.data.name === 'Jogging test Baydel', 'modification partielle (masqué + prix) sans perdre le reste');
ok(!(await j('/products', { noCookie: true })).data.some((p) => p.id === pid), 'produit masqué absent de la boutique');
await j('/admin/products/' + pid, { method: 'PATCH', body: { active: true } });

// Commande + annulation avec remise en stock
const customer = { name: 'Client Admin Test', phone: '061111111', city: 'Pointe-Noire' };
const o = await j('/orders', { method: 'POST', body: { customer, items: [{ productId: pid, qty: 2 }] }, noCookie: true });
const pay = await j('/payments', { method: 'POST', body: { orderId: o.data.id, token: o.data.token, phone: '061111111' }, noCookie: true });
await sleep(9000);
await j('/payments/' + pay.data.id, { noCookie: true });
ok((await j('/products/' + pid)).data.stock === 1, 'après paiement : stock 3 -> 1');
ok((await j('/admin/orders/' + o.data.id, { method: 'PATCH', body: { status: 'delivered' } })).status === 400, 'saut de statut interdit (payée -> livrée directement)');
ok((await j('/admin/orders/' + o.data.id, { method: 'PATCH', body: { customer: { phone: '123' } } })).status === 400, 'téléphone client invalide -> refusé');
const cancel = await j('/admin/orders/' + o.data.id, { method: 'PATCH', body: { status: 'cancelled' } });
ok(cancel.data.status === 'cancelled' && !('accessToken' in cancel.data), 'annulation OK (clé secrète client jamais renvoyée)');
ok((await j('/products/' + pid)).data.stock === 3, 'annulation d\'une commande payée : stock remis à 3');
ok((await j('/admin/orders/' + o.data.id, { method: 'PATCH', body: { status: 'paid' } })).status === 400, 'commande annulée : plus de changement possible');

// Paiement validé APRÈS annulation par l'admin -> signalé « à rembourser »
const o2 = await j('/orders', { method: 'POST', body: { customer, items: [{ productId: pid, qty: 1 }] }, noCookie: true });
const pay2 = await j('/payments', { method: 'POST', body: { orderId: o2.data.id, token: o2.data.token, phone: '061111111' }, noCookie: true });
await j('/admin/orders/' + o2.data.id, { method: 'PATCH', body: { status: 'cancelled' } });
await sleep(9000);
await j('/payments/' + pay2.data.id, { noCookie: true });
const list = (await j('/admin/orders')).data.orders;
const o2a = list.find((x) => x.id === o2.data.id);
ok(o2a.status === 'cancelled' && o2a.paidAfterCancel === true, 'payée après annulation -> signalée « à rembourser »');
ok((await j('/products/' + pid)).data.stock === 3, 'payée après annulation : stock non décompté');

// Déconnexion
await j('/admin/logout', { method: 'POST' });
ok((await j('/admin/orders')).status === 401, 'après déconnexion -> refusé');

// Blocage après 5 essais ratés (en dernier : bloque cette adresse 15 min)
for (let i = 0; i < 5; i++) await j('/admin/login', { method: 'POST', body: { password: 'faux' + i }, noCookie: true });
const locked = await j('/admin/login', { method: 'POST', body: { password: PW }, noCookie: true });
ok(locked.status === 429, `6e essai, même avec le bon mot de passe -> bloqué : ${locked.data?.error}`);

console.log(fails ? `\n${fails} échec(s)` : '\nTous les tests admin sont OK');
process.exit(fails ? 1 : 0);
