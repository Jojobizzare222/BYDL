// Référencement Google (17/11/2026) : pages des rayons / marques / sélections / articles lisibles par Google, données
// structurées, plan du site, robots.txt, accueil (titre, description, liens des rayons, codes de vérification), www → adresse
// principale. Lancer : zsh tests/run-test.sh test-seo.mjs (avec GOOGLE_SITE_VERIFICATION=zado-test-verif-123)
import http from 'node:http';
const BASE = 'http://localhost:3999';
const BOT = { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' };
let ko = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) ko++; };
const get = async (p, h = BOT) => { const r = await fetch(BASE + p, { headers: h, redirect: 'manual' }); return { status: r.status, text: await r.text(), headers: r.headers }; };
const lds = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

// robots.txt et plan du site
const robots = (await get('/robots.txt')).text;
ok(/Disallow: \/admin/.test(robots) && /Disallow: \/api\//.test(robots) && /Sitemap: http:\/\/localhost:3999\/sitemap\.xml/.test(robots), 'robots.txt : Zado Pro et API exclus, plan du site annoncé');
const smap = (await get('/sitemap.xml')).text;
const locs = [...smap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('http://localhost:3999', ''));
const rayons = locs.filter((l) => /^\/rayon\//.test(l)), prods = locs.filter((l) => /^\/p\/[^/]+\/[a-z0-9-]+$/.test(l));
ok(smap.includes('xmlns:image') && locs[0] === '/' && rayons.length >= 2 && prods.length >= 10 && !smap.includes('/admin'), `plan du site : accueil, ${rayons.length} rayons, ${prods.length} articles (adresse avec le nom), sans Zado Pro`);
ok(locs.some((l) => l.startsWith('/selection/')), 'plan du site : sélections (reconditionné, petits prix…)');

// Accueil
const home = (await get('/', {})).text;
const homeLd = lds(home);
ok(/<title>[^<]*Pointe-Noire[^<]*<\/title>/.test(home) && /name="description" content="[^"]*Pointe-Noire/.test(home) && /rel="canonical" href="http:\/\/localhost:3999\/"/.test(home), 'accueil : titre et description avec « Pointe-Noire », adresse canonique');
ok(homeLd.some((o) => o['@graph']?.some((g) => g['@type'] === 'OnlineStore' && g.address?.addressCountry === 'CG')), 'accueil : fiche « boutique en ligne » (Pointe-Noire, Congo) pour Google');
ok(/<nav class="footer-seo"[^>]*>[\s\S]*href="\/rayon\/[a-z0-9-]+"/.test(home), 'accueil : vrais liens vers chaque rayon dans le pied de page');
ok(/<meta name="google-site-verification" content="zado-test-verif-123">/.test(home), 'accueil : code de vérification Google (réglé dans .env)');

// Page d'un rayon
const ray = rayons.find((l) => !['/rayon/electronique', '/rayon/mode', '/rayon/maison', '/rayon/sport'].includes(l)) || rayons[0];
const rp = await get(ray);
const rld = lds(rp.text);
ok(rp.status === 200 && /<h1>[^<]+Pointe-Noire<\/h1>/.test(rp.text) && /tout compris/.test(rp.text) && /href="\/p\/[^"]+\/[a-z0-9-]+"/.test(rp.text), `rayon ${ray} : titre, prix tout compris, liens vers les articles`);
ok(rld.some((o) => o['@type'] === 'BreadcrumbList') && rld.some((o) => o['@type'] === 'CollectionPage' && o.mainEntity?.itemListElement?.length > 0), 'rayon : fil d\'Ariane et liste d\'articles pour Google');
ok(/location\.replace\("\/#\/c\//.test(rp.text) && /Googlebot|bot\|crawl/.test(rp.text.replace(/\\/g, '')), 'rayon : le visiteur humain est renvoyé vers la boutique, pas Google');
ok(/Questions fréquentes/.test(rp.text) && /Mobile Money/.test(rp.text), 'rayon : questions fréquentes (livraison, paiement)');
ok((await get('/rayon/nexiste-pas')).status === 404, 'rayon inconnu : 404');

// Fiche d'un article
const pp = await get(prods[0]);
const pld = lds(pp.text);
const prod = pld.find((o) => o['@type'] === 'Product');
ok(pp.status === 200 && prod && prod.offers?.priceCurrency === 'XAF' && prod.offers.price > 0 && prod.offers.priceValidUntil, 'article : données produit avec prix en FCFA (XAF)');
ok(prod?.offers?.shippingDetails?.shippingDestination?.addressCountry === 'CG' && prod.offers.hasMerchantReturnPolicy?.merchantReturnDays === 7, 'article : livraison au Congo et retours sous 7 jours pour Google');
ok(pld.some((o) => o['@type'] === 'BreadcrumbList' && o.itemListElement.length === 4), 'article : fil d\'Ariane Accueil › univers › rayon › article');
ok(!/costPrice|sourcePrice|supplierPrice|weightSource|importedFrom/.test(pp.text), 'article : aucune donnée interne (prix d\'achat, source…)');
const id = prods[0].split('/')[2];
const old = await get('/p/' + id);
ok(old.status === 200 && old.text.includes(`rel="canonical" href="http://localhost:3999${prods[0]}"`), 'ancien lien /p/<id> : toujours valable, adresse canonique avec le nom');
ok((await get('/p/inexistant')).status === 404, 'article inconnu : 404');

// Marque
const marque = locs.find((l) => l.startsWith('/marque/'));
if (marque) ok((await get(marque)).status === 200, `page de marque ${marque}`);

// www → adresse principale (lecture seulement)
const wwwStatus = (p, method = 'GET') => new Promise((res) => {
  const r = http.request({ host: 'localhost', port: 3999, path: p, method, headers: { Host: 'www.localhost' } }, (x) => { x.resume(); res([x.statusCode, x.headers.location]); });
  r.end();
});
const [st, loc] = await wwwStatus('/rayon/x?y=1');
ok(st === 301 && loc === 'http://localhost:3000/rayon/x?y=1', 'www.… → adresse principale (301, même chemin)');
ok((await wwwStatus('/api/orders', 'POST'))[0] !== 301, 'www.… : les envois (POST) ne sont jamais redirigés');

console.log(ko ? `${ko} ÉCHEC(S)` : 'TOUT EST OK');
process.exit(ko ? 1 : 0);
