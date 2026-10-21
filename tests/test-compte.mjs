import fs from 'node:fs';
import { createRequire } from 'node:module';
const sharp = createRequire('/Users/josephgambaka/Desktop/BYDL/package.json')('sharp');
const ID = { idType: 'cni', idPhoto: 'data:image/jpeg;base64,' + (await sharp({ create: { width: 800, height: 500, channels: 3, background: '#8899aa' } }).jpeg().toBuffer()).toString('base64') };
const B = 'http://localhost:3999/api';
const ADMIN_PW = fs.readFileSync(process.argv[2], 'utf8').trim();
const jar = () => ({ c: '' });
const call = async (j, path, opt = {}) => {
  const r = await fetch(B + path, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...opt.headers }, body: opt.body && JSON.stringify(opt.body) });
  const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null), setCookie: sc };
};
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prods = (await call(null, '/products')).data;
const pid = prods.find((p) => p.stock >= 10).id;
const buy = async (j, phone) => {
  const o = await call(j, '/orders', { body: { customer: { name: 'Test', phone, city: 'Pointe-Noire' }, items: [{ productId: pid, qty: 1 }] } });
  const p = await call(j, '/payments', { body: { orderId: o.data.id, token: o.data.token, phone } });
  return { order: o.data, payId: p.data.id };
};

// Création de compte
const A = jar();
ok((await call(A, '/account/register', { body: { name: 'Ana' } })).status === 400, 'compte sans numéro ni e-mail -> refusé');
ok((await call(A, '/account/register', { body: { name: 'Ana', phone: '123' } })).status === 400, 'numéro invalide -> refusé');
ok((await call(A, '/account/register', { body: { name: 'Ana', email: 'pas-un-mail' } })).status === 400, 'e-mail invalide -> refusé');

// Commande passée AVANT la création du compte, depuis ce téléphone (sans compte)
const guest = await buy(null, '062222222');
const regA = await call(A, '/account/register', { body: { ...ID, name: 'Ana Test', phone: '06 222 22 22', email: 'Ana@Exemple.com', deviceOrders: [{ id: guest.order.id, token: guest.order.token }, { id: 'CMD-FAUX', token: 'x' }] } });
const codeA = regA.data.code;
ok(regA.status === 201 && /^[1-9]\d{5}$/.test(codeA), `compte créé, code à 6 chiffres attribué (${codeA.length} chiffres, pas de 0 en tête)`);
ok(!JSON.stringify(regA.data.customer).includes('codeHash') && regA.data.customer.email === 'ana@exemple.com', 'empreinte du code jamais renvoyée ; e-mail normalisé');
ok(regA.data.claimed === 1, 'commande de ce téléphone rattachée (et la fausse ignorée)');
ok(/kamwa_client=.*HttpOnly/.test(regA.setCookie), 'connecté automatiquement (cookie HttpOnly)');
ok((await call(jar(), '/account/register', { body: { ...ID, name: 'Autre', phone: '062222222' } })).status === 409, 'numéro déjà utilisé -> refusé');
ok((await call(jar(), '/account/register', { body: { ...ID, name: 'Autre', email: 'ana@exemple.com' } })).status === 409, 'e-mail déjà utilisé -> refusé');

// Commande en étant connecté -> rattachée au compte
const mine = await buy(A, '062222222');
ok(mine.order.customerId === regA.data.customer.id, 'commande passée connecté -> rattachée au compte');
const listA = (await call(A, '/account/orders')).data;
ok(listA.length === 2 && listA.every((o) => !('accessToken' in o)), 'historique : 2 commandes, sans clé secrète');
ok((await call(A, '/orders/' + mine.order.id)).status === 200, 'le propriétaire voit sa commande sans la clé');
ok((await call(null, '/orders/' + mine.order.id)).status === 404, 'un inconnu ne la voit pas');
ok((await call(null, '/account/orders')).status === 401, 'historique sans connexion -> refusé');

// Connexion
const A2 = jar();
ok((await call(A2, '/account/login', { body: { identifier: '+242 06 222 22 22', code: codeA } })).status === 200, 'connexion numéro (format +242) + code');
ok((await call(jar(), '/account/login', { body: { identifier: 'ANA@exemple.com', code: codeA.slice(0, 3) + ' ' + codeA.slice(3) } })).status === 200, 'connexion e-mail + code avec espace');
ok((await call(jar(), '/account/login', { body: { identifier: 'inconnu@x.com', code: '123456' } })).data.error === (await call(jar(), '/account/login', { body: { identifier: '062222222', code: '000000' } })).data.error, 'même message d\'erreur (on ne révèle pas si le compte existe)');

// Autre client : ne voit pas les commandes d'Ana
const Bj = jar();
const regB = await call(Bj, '/account/register', { body: { ...ID, name: 'Bob', phone: '053333333' } });
ok((await call(Bj, '/orders/' + mine.order.id)).status === 404 && (await call(Bj, '/account/orders')).data.length === 0, 'un autre client ne voit rien des commandes d\'Ana');
ok((await call(Bj, '/account/claim', { body: { deviceOrders: [{ id: mine.order.id, token: 'mauvaise' }] } })).data.claimed === 0, 'impossible de « voler » une commande sans sa clé');

// Blocage après 5 codes faux
for (let i = 0; i < 5; i++) await call(jar(), '/account/login', { body: { identifier: '053333333', code: String(100000 + i) } });
const locked = await call(jar(), '/account/login', { body: { identifier: '053333333', code: regB.data.code } });
ok(locked.status === 429, `5 codes faux -> compte bloqué même avec le bon code : ${locked.data?.error}`);

// Note admin invisible pour le client + nouveau code par l'admin
const ADM = jar();
await call(ADM, '/admin/login', { body: { password: ADMIN_PW } });
await sleep(9000);
await call(null, '/payments/' + mine.payId);
await call(ADM, '/admin/orders/' + mine.order.id, { method: 'PATCH', body: { note: 'NOTE INTERNE SECRETE' } });
const seen = await call(A, '/orders/' + mine.order.id);
ok(!JSON.stringify(seen.data).includes('NOTE INTERNE') && seen.data.status === 'paid', 'client : statut « Payée » visible, note interne invisible');
ok((await call(ADM, '/admin/orders')).data.orders.find((o) => o.id === mine.order.id).account?.name === 'Ana Test', 'admin : la commande indique le compte client');
ok((await call(ADM, '/admin/customers')).data.length === 2, 'admin : liste des 2 clients');
ok((await call(A, '/admin/customers')).status === 401, 'un client n\'a pas accès à l\'admin');
const nc = await call(ADM, '/admin/customers/' + regA.data.customer.id + '/new-code', { body: {} });
ok(/^[1-9]\d{5}$/.test(nc.data.code) && nc.data.code !== codeA, 'admin : nouveau code généré');
ok((await call(jar(), '/account/login', { body: { identifier: '062222222', code: codeA } })).status === 401, 'ancien code refusé');
ok((await call(jar(), '/account/login', { body: { identifier: '062222222', code: nc.data.code } })).status === 200, 'nouveau code accepté');
ok((await call(A, '/account/orders')).status === 401, 'anciens appareils déconnectés après nouveau code');

console.log(fails ? `\n${fails} échec(s)` : '\nComptes clients : tout est OK');
process.exit(fails ? 1 : 0);
