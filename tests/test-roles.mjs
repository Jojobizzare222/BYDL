import fs from 'node:fs';
// Rôles et droits de Zado Pro (revu le 21/10/2026 : rôle fournisseur retiré, Zado achète tout en Europe ;
// seuls l'administrateur et le responsable catalogue voient les achats et les prix d'achat).
const B = 'http://localhost:3999/api';
const PW = fs.readFileSync(process.argv[2], 'utf8').trim();
const call = async (j, path, opt = {}) => {
  const r = await fetch(B + path, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: { 'Content-Type': opt.type || 'application/json', Cookie: j?.c || '', ...opt.headers }, body: opt.raw || (opt.body && JSON.stringify(opt.body)) });
  const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
};
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = { c: '' }, C = { c: '' }, O = { c: '' }, C2 = { c: '' };

ok((await call({ c: '' }, '/admin/login', { body: { password: PW } })).status === 200, 'admin : ancien formulaire (sans identifiant) accepté');
ok((await call(A, '/admin/login', { body: { login: 'Admin', password: PW } })).status === 200, 'admin : identifiant « admin » + mot de passe');
ok((await call(A, '/admin/me')).data.user.role === 'admin', 'admin reconnu comme administrateur');

ok((await call(A, '/admin/staff', { body: { name: 'X', login: 'admin', role: 'catalog' } })).status === 409, 'identifiant « admin » réservé');
ok((await call(A, '/admin/staff', { body: { name: 'X', login: 'x y', role: 'catalog' } })).status === 400, 'identifiant invalide refusé');
ok((await call(A, '/admin/staff', { body: { name: 'Jean Fourni', login: 'jean.fourni', role: 'supplier', company: 'Tech Import PN' } })).status === 400, 'rôle fournisseur : refusé (volet retiré le 21/10/2026)');
const cat = (await call(A, '/admin/staff', { body: { name: 'Clara Catalogue', login: 'Clara.Cat', role: 'catalog', phone: '061111111' } })).data;
const cat2 = (await call(A, '/admin/staff', { body: { name: 'Autre Catalogue', login: 'autre', role: 'catalog' } })).data;
const ord = (await call(A, '/admin/staff', { body: { name: 'Oscar Commandes', login: 'oscar', role: 'orders' } })).data;
ok(cat.user.login === 'clara.cat' && /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(cat.password) && !('passwordHash' in cat.user), 'compte créé (identifiant en minuscules, mot de passe provisoire, empreinte jamais renvoyée)');
ok((await call(A, '/admin/staff', { body: { name: 'Doublon', login: 'oscar', role: 'catalog' } })).status === 409, 'identifiant déjà pris refusé');
ok(!(await call(A, '/admin/staff')).data.staff.some((u) => u.role === 'supplier'), 'équipe : aucun compte fournisseur');

ok((await call(C, '/admin/login', { body: { login: 'clara.cat', password: 'mauvais' } })).status === 401, 'mauvais mot de passe refusé');
await call(C, '/admin/login', { body: { login: 'CLARA.CAT', password: cat.password } });
await call(C2, '/admin/login', { body: { login: 'autre', password: cat2.password } });
await call(O, '/admin/login', { body: { login: 'oscar', password: ord.password } });
const meC = (await call(C, '/admin/me')).data.user;
ok(meC.role === 'catalog' && meC.mustChangePassword === true, 'responsable catalogue connecté, doit changer son mot de passe provisoire');

const deny = [[C, '/admin/orders', 'catalogue → commandes'], [C, '/admin/customers', 'catalogue → clients'], [C, '/admin/agencies', 'catalogue → agences'], [C, '/admin/staff', 'catalogue → équipe'], [C, '/admin/finance', 'catalogue → finances'],
  [O, '/admin/products', 'commandes → produits'], [O, '/admin/staff', 'commandes → équipe'], [O, '/admin/customers', 'commandes → clients'], [O, '/admin/purchases', 'commandes → achats'], [O, '/admin/stock/overview', 'commandes → stock']];
for (const [j, path, label] of deny) ok((await call(j, path)).status === 403, `refusé : ${label}`);
for (const p of ['/admin/supplier/orders', '/admin/chat/kamwa', '/admin/chat/suppliers', '/admin/purchases/mine']) ok([403, 404].includes((await call(A, p)).status), `espace fournisseur supprimé : ${p}`);
ok((await call(O, '/admin/orders')).status === 200, 'employé Commandes → commandes OK');
ok((await call(O, '/admin/uploads', { method: 'POST', raw: Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), type: 'image/jpeg' })).status === 403, 'employé Commandes ne peut pas envoyer de photos');

// Responsable catalogue : propose un produit (en attente), saisit le prix d'achat rendu, voit les prix d'achat
const all = (await call(A, '/admin/products')).data;
const cl = (await call(C, '/admin/products')).data;
ok(cl.length > 50 && cl.length === all.length, 'catalogue : voit tous les produits');
const np = (await call(C, '/admin/products', { body: { name: 'Écouteurs Bluetooth X', brand: 'Xtra', category: 'Audio', stock: 10, costPrice: 9000, price: 15000, condition: 'neuf', specs: 'Couleur : Noir\nAutonomie : 30 h', description: 'Test', supplierPrice: 1, supplierId: 'x' } })).data;
ok(np.pending === true && np.costPrice === 9000 && np.specs.length === 2 && !('supplierId' in np) && !('supplierPrice' in np), 'catalogue : produit EN ATTENTE, prix d\'achat enregistré, champs du dépôt-vente ignorés');
ok(!(await call(null, '/products')).data.some((p) => p.id === np.id), 'produit en attente invisible sur la boutique');
ok((await call(null, '/products/' + np.id)).status === 404, 'produit en attente introuvable par son lien');
ok((await call(null, '/orders', { body: { customer: { name: 'T', phone: '061234567' }, items: [{ productId: np.id, qty: 1 }] } })).status === 400, 'produit en attente impossible à commander');
ok((await call(C, '/admin/products/' + np.id + '/approve', { body: {} })).status === 403, 'catalogue ne peut pas valider');
const ap = (await call(A, '/admin/products/' + np.id + '/approve', { body: {} })).data;
ok(ap.pending === false && ap.active === true, 'admin valide et publie');
const pub = (await call(null, '/products/' + np.id)).data;
ok(pub.price === 15000 && !('costPrice' in pub) && !('supplierPrice' in pub) && !('pending' in pub) && !('createdBy' in pub), 'boutique : produit visible, SANS prix d\'achat ni information interne');
ok(!(await call(null, '/products')).data.some((p) => 'costPrice' in p || 'supplierPrice' in p), 'boutique : aucun prix d\'achat dans la liste');
const edited = (await call(C, '/admin/products/' + np.id, { method: 'PATCH', body: { description: 'Nouvelle description', oldPrice: 18000, costPrice: 9500 } })).data;
ok(edited.description === 'Nouvelle description' && edited.oldPrice === 18000 && edited.costPrice === 9500, 'catalogue : modifie un produit publié, y compris le prix d\'achat');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const up1 = (await call(C, '/admin/uploads', { method: 'POST', raw: png, type: 'image/png' })).data.url;
const up2 = (await call(C, '/admin/uploads', { method: 'POST', raw: png, type: 'image/png' })).data.url;
ok((await call(C, '/admin/products', { body: { name: 'Câble Y', category: 'Accessoires', stock: 3, price: 3000, images: [up1, up2, '/etc/passwd'] } })).status === 400, 'chemin de photo piégé refusé');
const np3 = (await call(C, '/admin/products', { body: { name: 'Câble Y', category: 'Accessoires', stock: 3, price: 3000, images: [up1, up2] } })).data;
ok(np3.images.length === 2 && np3.image === up1, 'plusieurs photos : la première est la photo principale');
const nophoto = all.find((p) => !p.image);
ok((await call(A, '/admin/products/' + nophoto.id, { method: 'PATCH', body: { images: [], stock: nophoto.stock } })).status === 200, 'un produit sans photo se modifie sans erreur');

// Employé Commandes : gère la commande, ne voit aucun prix d'achat
const zadoProd = all.find((p) => p.active !== false && !p.pending && p.stock > 2);
const o = (await call(null, '/orders', { body: { customer: { name: 'Client Secret', phone: '069999999', city: 'Pointe-Noire', address: 'Adresse secrète' }, items: [{ productId: np.id, qty: 2 }, { productId: zadoProd.id, qty: 1 }] } })).data;
const pay = (await call(null, '/payments', { body: { orderId: o.id, token: o.token, phone: '069999999' } })).data;
await sleep(9000); await call(null, '/payments/' + pay.id);
const oo = (await call(O, '/admin/orders/' + o.id)).data;
ok(oo && !JSON.stringify(oo.lines || []).includes('"costPrice"'), 'employé Commandes : la commande ne montre pas les prix d\'achat des produits');
ok((await call(O, '/admin/orders/' + o.id, { method: 'PATCH', body: { status: 'shipped' } })).status === 400 && (await call(O, '/admin/orders/' + o.id, { method: 'PATCH', body: { note: 'ok' } })).status === 200, 'employé Commandes : gère la commande (« en livraison » seulement via le livreur, note OK)');

const act = (await call(A, '/admin/activity')).data;
ok(act.some((a) => a.action === 'Produit validé et publié') && act.some((a) => a.userName === 'Clara Catalogue') && act.some((a) => a.userName === 'Oscar Commandes' && /note modifiée/.test(a.details)), 'journal : validation, modifications du catalogue et de la commande inscrites');

ok((await call(C, '/admin/me/password', { body: { current: cat.password, next: 'court' } })).status === 400, 'nouveau mot de passe trop court refusé');
ok((await call(C, '/admin/me/password', { body: { current: cat.password, next: 'motdepasse-catalogue' } })).status === 200, 'le responsable catalogue change son mot de passe');
ok((await call(C, '/admin/me')).data.user.mustChangePassword === false, 'plus de mot de passe provisoire');
await call(A, '/admin/staff/' + cat2.user.id, { method: 'PATCH', body: { active: false } });
ok((await call(C2, '/admin/products')).status === 401, 'compte désactivé : déconnecté immédiatement');
ok((await call({ c: '' }, '/admin/login', { body: { login: 'autre', password: cat2.password } })).status === 401, 'compte désactivé : connexion refusée');
const rp = (await call(A, '/admin/staff/' + cat.user.id + '/reset-password', { body: {} })).data;
ok((await call(C, '/admin/products')).status === 401 && (await call({ c: '' }, '/admin/login', { body: { login: 'clara.cat', password: 'motdepasse-catalogue' } })).status === 401 && (await call({ c: '' }, '/admin/login', { body: { login: 'clara.cat', password: rp.password } })).status === 200, 'nouveau mot de passe provisoire : ancien refusé, sessions coupées, nouveau accepté');

console.log(fails ? `\n${fails} échec(s)` : '\nRôles et droits : tout est OK');
process.exit(fails ? 1 : 0);
