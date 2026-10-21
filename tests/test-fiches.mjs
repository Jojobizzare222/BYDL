// Fiches détaillées (21/10/2026) : points forts, réparabilité, vidéo YouTube, prix constatés en France
// + relevé automatique des prix (faux magasin local : données schema.org, robots.txt, site qui refuse les robots, page sans prix).
// Lancer avec : PRICE_WATCH_ALLOW_HTTP=1 PRICE_WATCH_DELAY_MS=0 zsh tests/run-test.sh test-fiches.mjs
import fs from 'node:fs';
import http from 'node:http';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; return { status: r.status, data: await r.json().catch(() => null) }; };

// Faux magasin
let shopPrice = 123.45, hits = 0;
const shop = http.createServer((req, res) => {
  hits++;
  if (req.url === '/robots.txt') { res.end('User-agent: *\nDisallow: /prive\n'); return; }
  if (req.url === '/produit') { res.setHeader('Content-Type', 'text/html'); res.end(`<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Test', offers: { '@type': 'Offer', price: String(shopPrice), priceCurrency: 'EUR' } })}</script></head><body>ok</body></html>`); return; }
  if (req.url === '/gamme') { res.end(`<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","offers":[{"@type":"AggregateOffer","lowPrice":999,"highPrice":1299,"priceCurrency":"EUR"}]}]}</script>`); return; }
  if (req.url === '/meta') { res.end('<meta property="product:price:amount" content="49,90"><meta property="product:price:currency" content="EUR">'); return; }
  if (req.url === '/protege') { res.statusCode = 403; res.end('captcha'); return; }
  if (req.url === '/prive/produit') { res.end('<script type="application/ld+json">{"@type":"Offer","price":"1"}</script>'); return; }
  res.end('<html>Produit retiré</html>');
}).listen(3997);
const S = 'http://localhost:3997';

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });

// 1) Catalogue de départ : fiches détaillées présentes, prix en France cachés au client par défaut
const pub = (await call(null, '/products/a003')).data;
ok(pub.highlights?.length >= 5 && pub.repair?.kind === 'ifixit' && pub.repair.value === '7' && /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(pub.video?.url), 'iPhone 15 : points forts, réparabilité iFixit 7/10, vidéo YouTube');
ok((await call(null, '/products/a072')).data.priceRefs === undefined, 'accessoire : prix Apple Store en France NON montré au client par défaut');
const a72 = (await call(A, '/admin/products')).data.find((p) => p.id === 'a072');
ok(a72.priceRefs?.[0]?.store === 'Apple Store' && a72.priceRefs[0].priceEur === 19 && a72.priceRefs[0].status === 'ok', 'Zado Pro : prix Apple Store relevé (19 €) visible par l\'équipe');

// 2) Saisie et contrôles
const base = { highlights: '- Écran 6,1 pouces\n• Puce rapide\n\nÉcran 6,1 pouces\n' + 'x'.repeat(200), repair: { kind: 'fr', value: '7,46', url: 'https://example.com/indice', note: 'Batterie remplaçable' }, video: { url: 'https://youtu.be/qaUFa3ZY2fo?t=30', title: 'Test', channel: 'Chaîne' } };
const r1 = await call(A, '/admin/products/a002', { method: 'PATCH', body: base });
ok(r1.status === 200 && r1.data.highlights.length === 3 && r1.data.highlights[0] === 'Écran 6,1 pouces' && r1.data.highlights[2].length === 140, 'points forts : puces retirées, doublons et lignes vides ignorés, 140 caractères max');
ok(r1.data.repair.value === '7.5' && r1.data.repair.kind === 'fr', 'réparabilité : note arrondie à 0,1 (7,46 → 7,5)');
ok(r1.data.video.url === 'https://www.youtube.com/watch?v=qaUFa3ZY2fo' && r1.data.video.id === 'qaUFa3ZY2fo', 'vidéo : lien youtu.be remis sous la forme standard');
for (const [body, label] of [
  [{ video: { url: 'https://vimeo.com/123456' } }, 'vidéo hors YouTube refusée'],
  [{ video: { url: 'https://www.youtube.com/watch?v=court' } }, 'identifiant YouTube invalide refusé'],
  [{ repair: { kind: 'eu', value: 'F' } }, 'classe UE hors A-E refusée'],
  [{ repair: { kind: 'fr', value: '11' } }, 'note sur 10 > 10 refusée'],
  [{ repair: { kind: 'xx', value: '5' } }, 'type de note inconnu refusé'],
  [{ priceRefs: [{ store: 'Fnac', priceEur: 'abc' }] }, 'prix en euros invalide refusé'],
  [{ priceRefs: [{ store: 'Fnac', priceEur: 10, url: 'javascript:alert(1)' }] }, 'lien non https refusé'],
  [{ priceRefs: [{ priceEur: 10 }] }, 'prix sans vendeur refusé'],
]) ok((await call(A, '/admin/products/a002', { method: 'PATCH', body })).status === 400, label);
ok((await call(A, '/admin/products/a002', { method: 'PATCH', body: { repair: { kind: 'eu', value: 'b' } } })).data.repair.value === 'B', 'classe UE acceptée (b → B)');
ok((await call(A, '/admin/products/a002', { method: 'PATCH', body: { repair: { kind: '', value: '' }, video: { url: '' } } })).data.repair === null, 'réparabilité et vidéo effaçables');
const pub2 = (await call(null, '/products/a002')).data;
ok(pub2.highlights.length === 3 && pub2.repair === null && pub2.video === null, 'boutique : points forts publiés');

// 3) Prix en France : saisie, tri, visibilité client
const refs = [{ store: 'Magasin A', priceEur: '130,00', url: `${S}/produit` }, { store: 'Gamme', priceEur: 1100, url: `${S}/gamme` }, { store: 'Méta', priceEur: 50, url: `${S}/meta` }, { store: 'Protégé', priceEur: 140, url: `${S}/protege` }, { store: 'Privé', priceEur: 150, url: `${S}/prive/produit` }, { store: 'Retiré', priceEur: 160, url: `${S}/retire` }, { store: 'Boutique sans lien', priceEur: 99.9 }];
const r2 = await call(A, '/admin/products/a002', { method: 'PATCH', body: { priceRefs: refs } });
ok(r2.status === 200 && r2.data.priceRefs.length === 7 && r2.data.priceRefs[0].priceEur === 50 && r2.data.priceRefs.every((x) => x.status === 'manual' && x.date), 'prix en France enregistrés, triés du moins cher, notés « saisi à la main » avec la date');
ok((await call(null, '/products/a002')).data.priceRefs === undefined, 'client : prix en France cachés');
await call(A, '/admin/products/a002', { method: 'PATCH', body: { priceRefsPublic: true } });
const pub3 = (await call(null, '/products/a002')).data;
ok(pub3.priceRefs?.length === 7 && !('priceRefsPublic' in pub3), 'client : prix en France montrés quand l\'équipe le choisit');

// 4) Relevé automatique (« Actualiser maintenant », même mécanisme que le relevé de chaque matin)
const r3 = await call(A, '/admin/products/a002/prices/refresh', { method: 'POST' });
const by = (n) => r3.data.priceRefs.find((x) => x.store === n);
ok(r3.status === 200 && by('Magasin A').status === 'ok' && by('Magasin A').priceEur === 123.45 && by('Magasin A').auto && by('Magasin A').history.length === 1, 'prix lu dans les données schema.org (123,45 €)');
ok(by('Gamme').status === 'ok' && by('Gamme').priceEur === 999 && by('Gamme').from === true, 'gamme de prix : « à partir de » 999 €');
ok(by('Méta').status === 'ok' && by('Méta').priceEur === 49.9, 'prix lu dans les balises méta (49,90 €)');
ok(by('Protégé').status === 'blocked' && by('Protégé').priceEur === 140, 'site qui refuse les robots : prix saisi gardé, marqué « à vérifier »');
ok(by('Privé').status === 'robots' && by('Privé').priceEur === 150, 'page interdite par robots.txt : jamais lue');
ok(by('Retiré').status === 'noprice' && by('Boutique sans lien').status === 'manual', 'page sans prix signalée ; vendeur sans lien inchangé');
ok(r3.data.priceCheckedAt, 'date du dernier relevé enregistrée');
shopPrice = 119;
const r4 = (await call(A, '/admin/products/a002/prices/refresh', { method: 'POST' })).data.priceRefs.find((x) => x.store === 'Magasin A');
ok(r4.priceEur === 119 && r4.history.length === 1, 'nouveau prix le même jour : remplacé, un seul point d\'historique par jour');
// Enregistrer la fiche sans toucher aux prix garde le suivi automatique ; corriger un prix à la main le note
const keep = (await call(A, '/admin/products/a002', { method: 'PATCH', body: { priceRefs: (await call(A, '/admin/products')).data.find((p) => p.id === 'a002').priceRefs.map(({ store, priceEur, url, date }) => ({ store, priceEur, url, date })) } })).data.priceRefs;
ok(keep.find((x) => x.store === 'Magasin A').status === 'ok' && keep.find((x) => x.store === 'Magasin A').history.length === 1, 'enregistrer la fiche garde le relevé automatique et l\'historique');
const man = (await call(A, '/admin/products/a002', { method: 'PATCH', body: { priceRefs: keep.map((x) => (x.store === 'Magasin A' ? { ...x, priceEur: 111 } : x)) } })).data.priceRefs.find((x) => x.store === 'Magasin A');
ok(man.status === 'manual' && man.priceEur === 111 && !man.auto, 'prix corrigé à la main : noté « saisi à la main »');
ok((await call(A, '/admin/products/a003/prices/refresh', { method: 'POST' })).status === 400, 'produit sans lien : « Actualiser » refusé avec un message clair');
const st = (await call(A, '/admin/prices/status')).data;
ok(st && /ZadoPrix/.test(st.robot), 'état du relevé et identité du robot (honnête) disponibles');

// 5) Droits et tâche planifiée
const mk = async (role, login) => { const r = (await call(A, '/admin/staff', { body: { name: login, login, role } })).data; const J = { c: '' }; await call(J, '/admin/login', { body: { login, password: r.password } }); return J; };
const cat = await mk('catalog', 'cat-fiche'), ord = await mk('orders', 'ord-fiche');
ok((await call(cat, '/admin/products/a002/prices/refresh', { method: 'POST' })).status === 200, 'responsable catalogue : peut actualiser');
ok((await call(ord, '/admin/products/a002/prices/refresh', { method: 'POST' })).status === 403 && (await call(ord, '/admin/prices/status')).status === 403, 'employé Commandes : pas d\'accès');
ok((await call(null, '/cron/prices')).status === 401 && (await call(null, '/cron/prices', { headers: { Authorization: 'Bearer x' } })).status === 401, 'tâche planifiée : refusée sans le secret');
ok(hits > 0, `faux magasin consulté (${hits} pages)`);

shop.close();
console.log(fails ? `\n${fails} échec(s)` : '\nFiches détaillées : tout est OK');
process.exit(fails ? 1 : 0);
