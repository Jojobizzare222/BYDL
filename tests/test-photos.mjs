// Règle « au moins une photo » (décision Joseph 18/11/2026) : seuls les articles avec une photo sont visibles sur la boutique ;
// dès qu'une photo est ajoutée, l'article apparaît tout seul ; réglage dans Zado Pro → Réglages → Règles de vente.
// Lancer : PHOTO_RULE=on zsh tests/run-test.sh test-photos.mjs <fichier du mot de passe>
import fs from 'node:fs';
const B = 'http://localhost:3999', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
const BOT = { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' };
let ko = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) ko++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + '/api' + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '' }, body: o.body ? JSON.stringify(o.body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const cfg = (await call(null, '/config')).data;
ok(cfg.photoRequired === true, 'règle active par défaut');
const all = (await call(A, '/admin/products')).data;
const visibleAdmin = (Array.isArray(all) ? all : all.products || []).filter((p) => p.active !== false && !p.pending && p.price > 0);
const noPic = visibleAdmin.filter((p) => !p.image && !(p.images || []).length);
ok(noPic.length >= 5, `catalogue de test : ${noPic.length} articles visibles sans photo`);
const target = noPic.find((p) => /iphone/i.test(p.name)) || noPic[0];

let shop = (await call(null, '/products')).data;
ok(!shop.some((p) => !p.image && !(p.images || []).length), `boutique : aucun article sans photo (${shop.length} affichés)`);
ok(!shop.some((p) => p.id === target.id), 'boutique : l\'article sans photo est masqué');
ok((await call(null, '/products/' + target.id)).status === 404, 'fiche de l\'article sans photo : introuvable');
ok(!(await call(null, '/products/suggest?q=' + encodeURIComponent(target.name.split(' ').slice(0, 2).join(' ')))).data.products.some((p) => p.id === target.id), 'suggestions de recherche : article sans photo absent');
ok((await fetch(`${B}/p/${target.id}`, { headers: BOT })).status === 404, 'page Google de l\'article sans photo : 404');
ok(!(await (await fetch(B + '/sitemap.xml')).text()).includes(`/p/${target.id}/`), 'plan du site : article sans photo absent');

// Photo ajoutée → visible tout de suite
const up = await call(A, '/admin/products/' + target.id, { method: 'PATCH', body: { images: ['/images/uploads/test-photo.jpg'] } });
ok(up.status === 200, 'Zado Pro : photo ajoutée');
shop = (await call(null, '/products')).data;
ok(shop.some((p) => p.id === target.id), 'boutique : l\'article apparaît dès qu\'il a une photo');
ok((await call(null, '/products/' + target.id)).status === 200, 'fiche de l\'article : visible');
ok((await fetch(`${B}/p/${target.id}`, { headers: BOT })).status === 200 && (await (await fetch(B + '/sitemap.xml')).text()).includes(`/p/${target.id}/`), 'Google : page et plan du site mis à jour tout de suite');

// Photo retirée → de nouveau masqué
await call(A, '/admin/products/' + target.id, { method: 'PATCH', body: { images: [] } });
ok(!(await call(null, '/products')).data.some((p) => p.id === target.id), 'photo retirée : l\'article est de nouveau masqué');

// Réglage
ok((await call(null, '/admin/settings/sales', { method: 'PUT', body: { photoRequired: false } })).status === 401, 'réglage réservé à Zado Pro');
const off = await call(A, '/admin/settings/sales', { method: 'PUT', body: { photoRequired: false } });
ok(off.status === 200 && off.data.photoRequired === false && off.data.accountRequired === true, 'règle coupée (les autres règles de vente gardées)');
shop = (await call(null, '/products')).data;
ok(shop.some((p) => p.id === target.id) && (await call(null, '/config')).data.photoRequired === false, 'règle coupée : les articles sans photo réapparaissent');
await call(A, '/admin/settings/sales', { method: 'PUT', body: { photoRequired: true } });
ok(!(await call(null, '/products')).data.some((p) => p.id === target.id), 'règle remise : de nouveau masqué');

console.log(ko ? `${ko} ÉCHEC(S)` : 'TOUT EST OK');
process.exit(ko ? 1 : 0);
