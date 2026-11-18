// Référencement Google (17/11/2026, demande Joseph : « que le site soit extrêmement performant sur les moteurs de recherche »).
// La boutique est une application à adresses « #/… » : Google n'y voit qu'UNE page. Ce module lui donne de vraies pages :
//  - /rayon/<rayon> (univers et catégories), /marque/<marque>, /selection/<reconditionne|petits-prix|cadeaux|precommandes>
//    et /p/<id>/<nom> : HTML complet (titre, description, fil d'Ariane, liste d'articles avec prix TOUT COMPRIS, questions
//    fréquentes) + données structurées schema.org ; le visiteur humain est aussitôt renvoyé vers la même page de la boutique
//    (#/c/…, #/p/…), les robots (Google, Bing, WhatsApp…) lisent la page ;
//  - accueil : liens « Nos rayons » de vrais liens ajoutés au pied de page, codes de vérification Google / Bing (.env) ;
//  - /sitemap.xml (accueil, rayons, marques, sélections, articles + photos) et /robots.txt ;
//  - www.zado-congo.com → zado-congo.com (une seule adresse pour Google).
// Rien d'autre que ce qui est déjà public sur la boutique (jamais de prix d'achat, de fournisseur interne, de stock précis).
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { UNIVERSES, universeOf, inCatalog } = require('./catalog');

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' et ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const fcfa = (n) => `${new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/[  ]/g, ' ')} FCFA`;
const cut = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : `${t.slice(0, t.lastIndexOf(' ', n - 1) > n / 2 ? t.lastIndexOf(' ', n - 1) : n - 1).replace(/[\s,;:.]+$/, '')}…`; };
const siteHost = (req) => (/localhost|127\.0\.0\.1/.test(config.publicUrl) ? `${req.protocol}://${req.get('host')}` : config.publicUrl);
const abs = (h, src) => (/^https?:/.test(src) ? src : h + src);
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const isRefurb = (p) => Boolean(p.condition && p.condition !== 'neuf');
const BOTS = 'bot|crawl|spider|slurp|google|bing|yandex|baidu|duckduck|facebookexternalhit|whatsapp|telegram|twitter|linkedin|lighthouse|preview|embed';

// Prix tout compris d'un article seul (même calcul que la boutique : article + transport + frais de service + frais Mobile Money)
function allInPrice(p) {
  const pr = require('./pricing');
  const b = p.price + require('./freight').unitFee(p) + pr.serviceFee();
  return b + pr.momoFee(b);
}
const visible = () => require('./store').products.all().filter((p) => p.active !== false && !p.pending && inCatalog(p) && p.price > 0);
const prodPath = (p) => `/p/${encodeURIComponent(p.id)}/${slug(p.name) || 'article'}`;
const hasExtras = (p) => (p.options || []).some((o) => o.extra && Object.keys(o.extra).length);
const preorderOf = (p) => (p.preorder?.releaseDate && p.preorder.releaseDate > new Date().toISOString().slice(0, 10) ? p.preorder.releaseDate : null);
// Ordre des listes : articles avec photo d'abord, précommandes en tête, puis du moins cher au plus cher
const sortList = (l) => [...l].sort((a, b) => (preorderOf(b) ? 1 : 0) - (preorderOf(a) ? 1 : 0) || (b.image ? 1 : 0) - (a.image ? 1 : 0) || allInPrice(a) - allInPrice(b));

// Textes des rayons : mots que les clients tapent dans Google (titre) + présentation honnête (aucune promesse inventée)
const CAT = {
  'Téléphones': ['iPhone et smartphones', 'iPhone, Samsung Galaxy, Xiaomi… neufs ou reconditionnés, livrés chez vous à Pointe-Noire.'],
  'Tablettes': ['iPad et tablettes', 'iPad et tablettes pour étudier, travailler ou se divertir, livrés rapidement à Pointe-Noire.'],
  'Ordinateurs': ['MacBook et ordinateurs portables', 'MacBook, ordinateurs portables et de bureau pour les études et le travail, livrés à Pointe-Noire.'],
  'Écrans': ['Écrans PC et moniteurs', 'Écrans pour ordinateur, moniteurs de bureau et écrans gamer, livrés à Pointe-Noire.'],
  'Montres': ['Apple Watch et montres connectées', 'Apple Watch, montres connectées et bracelets sport, livrés rapidement à Pointe-Noire.'],
  'Audio': ['Écouteurs, AirPods et enceintes', 'Écouteurs, AirPods, casques, enceintes Bluetooth et radios, livrés à Pointe-Noire.'],
  'TV & Maison': ['Téléviseurs, son et maison connectée', 'Téléviseurs, barres de son, lumières et maison connectée pour un salon bien équipé, livrés à Pointe-Noire.'],
  'Jeux vidéo & consoles': ['PS5, Xbox, jeux vidéo et consoles', 'Consoles PlayStation et Xbox, jeux, manettes et casques gamer, précommandes comprises, livrés rapidement à Pointe-Noire.'],
  'Composants': ['Clés USB, SSD et composants', 'Clés USB, disques SSD, cartes mémoire et composants informatiques, livrés à Pointe-Noire.'],
  'Accessoires': ['Coques, chargeurs et accessoires', 'Coques, chargeurs, câbles, batteries externes, souris et claviers, livrés à Pointe-Noire.'],
  'Photo & vidéo': ['Appareils photo, caméras et drones', 'Appareils photo, caméras sport, drones et accessoires pour créateurs, livrés à Pointe-Noire.'],
  'Jouets high-tech': ['Jouets high-tech et drones enfants', 'Robots, drones pour enfants et jouets électroniques, parfaits à offrir, livrés à Pointe-Noire.'],
  'Beauté & bien-être': ['Sèche-cheveux, tondeuses et soins', 'Sèche-cheveux, tondeuses, brosses à dents électriques et appareils de soin, livrés à Pointe-Noire.'],
  'Mode homme': ['Vêtements homme de marque', 'T-shirts, sweats, pantalons et vestes pour homme, de grandes marques, livrés à Pointe-Noire.'],
  'Mode femme': ['Vêtements femme de marque', 'Hauts, robes, jeans et vestes pour femme, de grandes marques, livrés à Pointe-Noire.'],
  'Chaussures': ['Baskets, sneakers et chaussures', 'Baskets, sneakers, sandales et chaussures de ville, toutes pointures, livrées à Pointe-Noire.'],
  'Lunettes': ['Lunettes de soleil de marque', 'Lunettes de soleil et lunettes de marque, livrées à Pointe-Noire.'],
  'Maison & déco': ['Petits meubles et décoration', 'Tables de chevet, petits meubles, rangements et décoration pour la maison, livrés à Pointe-Noire.'],
  'Sport & nutrition': ['Whey, protéines et sport', 'Protéines whey, compléments et équipements de sport, livrés à Pointe-Noire.'],
};
const UNI = {
  'Électronique': ['High-tech et électronique', 'Téléphones, ordinateurs, consoles, TV, audio et accessoires : tout l\'électronique livré chez vous à Pointe-Noire.'],
  'Mode': ['Mode homme et femme', 'Vêtements, chaussures et lunettes de grandes marques pour homme et femme, livrés à Pointe-Noire.'],
  'Maison': ['Maison et décoration', 'Petits meubles et décoration pour une maison bien installée, livrés à Pointe-Noire.'],
  'Sport': ['Sport et nutrition', 'Protéines, compléments et équipements pour le sport, livrés à Pointe-Noire.'],
};
const enc = encodeURIComponent;

// Toutes les pages « liste » : univers, rayons, sélections et marques (≥ 4 articles), mémorisées 5 min
let memo = { at: 0, pages: null, list: null };
function pages() {
  if (memo.pages && Date.now() - memo.at < 300e3) return memo;
  const list = visible();
  const out = [];
  for (const u of UNIVERSES) {
    const items = list.filter((p) => p.universe === u.name || universeOf(p.category) === u.name);
    if (!items.length) continue;
    const [kw, intro] = UNI[u.name] || [u.name, `${u.name} livré à Pointe-Noire.`];
    out.push({ path: `/rayon/${slug(u.name)}`, kind: 'univers', name: u.name, kw, intro, items, spa: `#/c/${enc(u.name)}`,
      subs: u.categories.filter((c) => list.some((p) => p.category === c)) });
  }
  for (const u of UNIVERSES) for (const c of u.categories) {
    const items = list.filter((p) => p.category === c);
    if (!items.length) continue;
    const [kw, intro] = CAT[c] || [c, `${c} livrés à Pointe-Noire.`];
    out.push({ path: `/rayon/${slug(c)}`, kind: 'rayon', name: c, kw, intro, items, spa: `#/c/${enc(u.name)}/${enc(c)}`, parent: { name: u.name, path: `/rayon/${slug(u.name)}` } });
  }
  const sel = [
    ['reconditionne', 'Reconditionné', 'iPhone et smartphones reconditionnés', 'Téléphones et appareils reconditionnés, testés et vérifiés avant l\'envoi, garantis 6 mois par Zado : la qualité pour beaucoup moins cher que le neuf, livrée à Pointe-Noire.', list.filter(isRefurb), '#/reconditionne'],
    ['petits-prix', 'Petits prix', 'Petits prix : moins de 25 000 FCFA', 'Des idées et des cadeaux à moins de 25 000 FCFA, livraison comprise : le prix affiché est le prix final, livré chez vous à Pointe-Noire.', list.filter((p) => allInPrice(p) <= 25000), '#/petits-prix'],
    ['cadeaux', 'Idées cadeaux', 'Idées cadeaux de Noël', 'Des idées cadeaux pour toute la famille, pour tous les budgets, livrées à Pointe-Noire. Option « C\'est pour offrir » : nous livrons la personne de votre choix avec votre petit mot.', list.filter((p) => p.giftFor || p.selection), '#/cadeaux'],
    ['precommandes', 'Précommandes', 'Précommandes jeux vidéo', 'Réservez les nouveautés avant leur sortie : elles sont expédiées dès leur sortie et livrées rapidement à Pointe-Noire.', list.filter(preorderOf), '#/recherche/' + enc('précommande')],
  ];
  for (const [s, name, kw, intro, items, spa] of sel) if (items.length) out.push({ path: `/selection/${s}`, kind: 'selection', name, kw, intro, items, spa });
  const brands = new Map();
  for (const p of list) { const b = String(p.brand || '').trim(); if (!b || !slug(b)) continue; const k = slug(b); if (!brands.has(k)) brands.set(k, { name: b, items: [] }); brands.get(k).items.push(p); }
  for (const [k, b] of brands) {
    if (b.items.length < 4) continue;
    const cats = [...new Set(b.items.map((p) => p.category))].slice(0, 4);
    out.push({ path: `/marque/${k}`, kind: 'marque', name: b.name, kw: `${b.name} : ${cats.join(', ')}`, intro: `Les produits ${b.name} chez Zado (${cats.join(', ').toLowerCase()}), au prix tout compris, livrés chez vous à Pointe-Noire.`, items: b.items, spa: `#/recherche/${enc(b.name)}` });
  }
  memo = { at: Date.now(), pages: out, list };
  return memo;
}

// Questions fréquentes (réponses tirées des réglages réels de la boutique)
function faq() {
  const f = require('./freight').freightSettings();
  const cities = (require('./fees').feeSettings().cities || []).map((c) => c.city).filter(Boolean);
  return [
    ['Combien de temps pour être livré à Pointe-Noire ?', `Comptez ${f.logisticsMin + Math.ceil(f.deliveryHours / 24)} à ${f.logisticsMax + Math.ceil(f.deliveryHours / 24)} jours entre le paiement et la livraison à Pointe-Noire. Votre article part parfois d'une autre ville : il rejoint d'abord notre entrepôt, puis s'envole vers Pointe-Noire ; s'il est stocké près de l'entrepôt, il arrive souvent plus vite. Vous suivez votre colis à chaque étape.`],
    ['Le prix affiché comprend-il tout ?', 'Oui : le prix affiché comprend l\'article, le transport jusqu\'à Pointe-Noire, les frais de service et les frais Mobile Money. Rien ne s\'ajoute au panier.'],
    ['Comment payer ?', 'Par Mobile Money (MTN ou Airtel) : vous déposez le montant de la commande sur le numéro de Zado, avec votre numéro de commande en référence. Votre commande est confirmée dès réception.'],
    ['Où livrez-vous ?', cities.length ? `Nous livrons à domicile à ${cities.join(', ')}.` : 'Nous livrons à domicile à Pointe-Noire.'],
    ['Les produits sont-ils neufs ?', 'L\'état de chaque article est indiqué sur sa fiche : neuf, ou reconditionné (testé, vérifié et garanti 6 mois par Zado).'],
  ];
}

// Gabarit commun des pages lues par Google (le visiteur humain est renvoyé vers la boutique)
const CSS = `:root{--b:#10264A;--m:#FFB300;--l:#DDE3EC;--t:#0E1424;--s:#5B6475}*{box-sizing:border-box}body{margin:0;font:15px/1.55 "Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--t);background:#F3F5F9}a{color:#1E56C2}.w{max-width:1180px;margin:0 auto;padding:0 16px}header{background:#fff;border-bottom:1px solid var(--l)}header .w{display:flex;align-items:center;gap:18px;min-height:62px;flex-wrap:wrap}header img{height:30px;width:96px}header p{margin:0;color:var(--s);font-size:13px}nav.r{background:var(--b)}nav.r .w{display:flex;gap:4px 16px;flex-wrap:wrap;padding-top:8px;padding-bottom:8px}nav.r a{color:#fff;text-decoration:none;font-size:13.5px;font-weight:600}.cr{font-size:13px;color:var(--s);margin:18px 0 0}.cr a{color:var(--s)}h1{font-size:clamp(24px,4vw,32px);line-height:1.15;margin:10px 0;color:var(--b)}h2{font-size:20px;color:var(--b);margin:30px 0 10px}.in{max-width:780px;margin:0}.meta{color:var(--s);font-size:14px;margin:6px 0 0}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin:18px 0 8px;padding:0;list-style:none}.c{background:#fff;border:1px solid var(--l);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px;height:100%;text-decoration:none;color:var(--t)}.c img,.c .ph{width:100%;aspect-ratio:1;object-fit:contain;border-radius:10px;background:#fff}.c .ph{display:grid;place-items:center;background:#EEF2F8;color:#8792A6;font-size:12px;text-align:center;padding:8px}.c b{font-size:13.5px;font-weight:600;line-height:1.3}.c .pr{font-weight:700;color:var(--b)}.c small{color:var(--s);font-size:12px}.btn{display:inline-block;background:var(--m);color:var(--b);font-weight:700;padding:12px 24px;border-radius:999px;text-decoration:none;margin:14px 0}.sub{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0;padding:0;list-style:none}.sub a{display:inline-block;background:#fff;border:1px solid var(--l);border-radius:999px;padding:6px 14px;text-decoration:none;color:var(--b);font-weight:600;font-size:13.5px}.box{background:#fff;border:1px solid var(--l);border-radius:16px;padding:4px 20px 16px;margin:26px 0}.box h3{font-size:15px;margin:16px 0 4px}.box p{margin:0;color:#333B4C}.pp{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:28px;margin:18px 0}.pp .im{background:#fff;border:1px solid var(--l);border-radius:18px;padding:18px;display:grid;place-items:center;aspect-ratio:1}.pp .im img{max-width:100%;max-height:100%;object-fit:contain}.big{font-size:28px;font-weight:700;color:var(--b);margin:6px 0 0}.pill{display:inline-block;background:#E6F5EC;color:#0B5E42;font-weight:600;font-size:12.5px;border-radius:999px;padding:3px 10px;margin:4px 6px 0 0}ul.sp{padding-left:18px}footer{background:#0B1A33;color:#CFD6E4;margin-top:40px;padding:26px 0 34px;font-size:13px}footer a{color:#fff;text-decoration:none;margin:0 12px 6px 0;display:inline-block}footer h2{color:#fff;font-size:14px;margin:14px 0 8px}@media(max-width:720px){.pp{grid-template-columns:1fr}.g{grid-template-columns:repeat(2,minmax(0,1fr))}}`;

function layout(req, { title, desc, canon, ogType = 'website', image, ld = [], body, target }) {
  const h = siteHost(req);
  const { pages: all } = pages();
  const uni = all.filter((x) => x.kind === 'univers');
  const rayons = all.filter((x) => x.kind === 'rayon'), sels = all.filter((x) => x.kind === 'selection'), marques = all.filter((x) => x.kind === 'marque').slice(0, 30);
  const links = (l) => l.map((x) => `<a href="${x.path}">${esc(x.name)}</a>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(h + canon)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="${ogType}"><meta property="og:site_name" content="Zado"><meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(h + canon)}">
<meta property="og:image" content="${esc(image || `${h}/brand/partage-zado.png?v=8`)}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/brand/favicon.svg?v=8" type="image/svg+xml"><link rel="icon" href="/brand/favicon-96.png?v=8" sizes="96x96" type="image/png"><meta name="theme-color" content="#10264A">
<style>@font-face{font-family:"Plus Jakarta Sans";src:url(/fonts/plus-jakarta-sans-latin-wght-normal.woff2) format("woff2");font-weight:200 800;font-display:swap}${CSS}</style>
${ld.map((o) => `<script type="application/ld+json">${json(o)}</script>`).join('\n')}
<script>if(!/${BOTS}/i.test(navigator.userAgent))location.replace(${json(target)})</script>
</head><body>
<header><div class="w"><a href="/" aria-label="Zado, accueil"><img src="/brand/logo-zado.svg?v=8" alt="Zado" width="96" height="30"></a><p>Boutique en ligne à Pointe-Noire · prix tout compris · livraison rapide · paiement Mobile Money</p></div></header>
<nav class="r" aria-label="Rayons"><div class="w">${links(uni)}${links(sels)}</div></nav>
<main class="w">${body}
<div class="box"><h2>Questions fréquentes</h2>${faq().map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}</div></main>
<footer><div class="w"><h2>Rayons</h2>${links(rayons)}<h2>Sélections</h2>${links(sels)}${marques.length ? `<h2>Marques</h2>${links(marques)}` : ''}<p>© ${new Date().getFullYear()} Zado · Pointe-Noire, République du Congo · <a href="${esc(target)}">Ouvrir la boutique</a></p></div></footer>
</body></html>`;
}

const card = (p) => `<li><a class="c" href="${prodPath(p)}">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" width="300" height="300">` : `<span class="ph">${esc(p.category)}</span>`}<b>${esc(p.name)}</b><span class="pr">${hasExtras(p) ? 'dès ' : ''}${fcfa(allInPrice(p))}</span><small>${preorderOf(p) ? 'Précommande · ' : ''}${isRefurb(p) ? 'Reconditionné' : 'Neuf'} · tout compris, livré</small></a></li>`;
const crumbsLd = (h, l) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: l.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: h + url })) });
const crumbsHtml = (l) => `<nav class="cr" aria-label="Fil d'Ariane">${l.map(([name, url], i) => (i < l.length - 1 ? `<a href="${url}">${esc(name)}</a>` : esc(name))).join(' › ')}</nav>`;

function listPage(req, res, pg) {
  const h = siteHost(req);
  const items = sortList(pg.items).slice(0, 240);
  const min = Math.min(...pg.items.map(allInPrice));
  const trail = [['Accueil', '/'], ...(pg.parent ? [[pg.parent.name, pg.parent.path]] : []), [pg.name, pg.path]];
  const title = `${pg.kw} à Pointe-Noire | Zado`;
  const desc = cut(`${pg.intro} ${pg.items.length} article${pg.items.length > 1 ? 's' : ''}, dès ${fcfa(min)} tout compris. Paiement Mobile Money.`, 158);
  const subs = pg.subs?.length ? `<ul class="sub">${pg.subs.map((c) => `<li><a href="/rayon/${slug(c)}">${esc(c)}</a></li>`).join('')}</ul>` : '';
  const ld = [crumbsLd(h, trail), { '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description: desc, url: h + pg.path, inLanguage: 'fr',
    mainEntity: { '@type': 'ItemList', numberOfItems: pg.items.length, itemListElement: items.slice(0, 60).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: h + prodPath(p), name: p.name })) } }];
  res.set('Cache-Control', 'public, max-age=600').type('html').send(layout(req, { title, desc, canon: pg.path, ld, target: '/' + pg.spa, image: items.find((p) => p.image) ? abs(h, items.find((p) => p.image).image) : null,
    body: `${crumbsHtml(trail)}<h1>${esc(pg.kw)} à Pointe-Noire</h1><p class="in">${esc(pg.intro)} Le prix affiché est le prix final : transport, frais de service et frais Mobile Money compris.</p>
<p class="meta">${pg.items.length} article${pg.items.length > 1 ? 's' : ''} · dès ${fcfa(min)} tout compris</p>${subs}
<a class="btn" href="/${esc(pg.spa)}">Voir le rayon dans la boutique</a>
<ul class="g">${items.map(card).join('')}</ul>${pg.items.length > items.length ? `<p class="meta"><a href="/${esc(pg.spa)}">Voir les ${pg.items.length} articles dans la boutique</a></p>` : ''}` }));
}

// Données produit lisibles par Google (schema.org) : rien d'autre que ce qui est affiché sur la fiche
function productLd(p, h, price) {
  const f = require('./freight').freightSettings();
  const fee = (() => { try { return require('./fees').feeFor('Pointe-Noire', null, 0); } catch { return null; } })();
  const until = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const rating = (() => { try { return require('./reviews').summaries().get(p.id); } catch { return null; } })();
  const imgs = [p.image, ...(p.images || [])].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).map((x) => abs(h, x));
  return {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: p.id, category: p.category, url: h + prodPath(p),
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    ...(p.description ? { description: cut(p.description, 900) } : {}),
    ...(imgs.length ? { image: imgs } : {}),
    ...(rating && rating.count ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: rating.avg, reviewCount: rating.count, bestRating: 5, worstRating: 1 } } : {}),
    offers: { '@type': 'Offer', url: h + prodPath(p), priceCurrency: 'XAF', price, priceValidUntil: until,
      availability: p.stock === 0 ? 'https://schema.org/OutOfStock' : preorderOf(p) ? 'https://schema.org/PreOrder' : p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/BackOrder',
      itemCondition: isRefurb(p) ? 'https://schema.org/RefurbishedCondition' : 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: 'Zado', url: h },
      ...(fee && fee.deliverable ? { shippingDetails: { '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: fee.fee || 0, currency: 'XAF' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'CG' },
        deliveryTime: { '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: (f.logisticsMin ?? 2) + 1, maxValue: (f.logisticsMax ?? 14) + Math.ceil((f.deliveryHours ?? 24) / 24), unitCode: 'DAY' } } } } : {}),
      hasMerchantReturnPolicy: { '@type': 'MerchantReturnPolicy', applicableCountry: 'CG', returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow', merchantReturnDays: 7 } },
  };
}

function productPage(req, res) {
  const { products } = require('./store');
  const p = products.get(req.params.id);
  const ok = p && p.active !== false && !p.pending && inCatalog(p) && p.price > 0;
  const h = siteHost(req);
  if (!ok) {
    return res.status(404).set('Cache-Control', 'public, max-age=300').type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Article introuvable | Zado</title><meta name="robots" content="noindex"><script>location.replace("/")</script></head><body><p><a href="/">Ouvrir la boutique Zado</a></p></body></html>`);
  }
  const price = allInPrice(p);
  const u = universeOf(p.category);
  const trail = [['Accueil', '/'], [u, `/rayon/${slug(u)}`], [p.category, `/rayon/${slug(p.category)}`], [p.name, prodPath(p)]];
  const state = isRefurb(p) ? 'Reconditionné' : 'Neuf';
  const pre = preorderOf(p);
  const title = cut(`${p.name} à Pointe-Noire — ${fcfa(price)} | Zado`, 90);
  const desc = cut(`${state} : ${p.name} à ${hasExtras(p) ? 'partir de ' : ''}${fcfa(price)} tout compris, livré à Pointe-Noire. ${pre ? `Précommande, sortie le ${new Date(pre + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}. ` : ''}Livraison rapide, paiement Mobile Money.${p.description ? ' ' + p.description : ''}`, 158);
  const { list } = pages();
  const related = sortList(list.filter((x) => x.category === p.category && x.id !== p.id)).slice(0, 8);
  const img = p.image ? abs(h, p.image) : null;
  const opts = (p.options || []).filter((o) => o.values?.length > 1);
  res.set('Cache-Control', 'public, max-age=300').type('html').send(layout(req, { title, desc, canon: prodPath(p), ogType: 'product', image: img,
    ld: [productLd(p, h, price), crumbsLd(h, trail)], target: `/#/p/${enc(p.id)}`,
    body: `${crumbsHtml(trail)}<div class="pp"><div class="im">${img ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" width="600" height="600">` : `<span class="meta">${esc(p.category)}</span>`}</div>
<div><h1>${esc(p.name)}</h1><span class="pill">${state}</span>${pre ? `<span class="pill">Précommande · sortie le ${esc(new Date(pre + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))}</span>` : ''}${p.brand ? `<span class="pill">${esc(p.brand)}</span>` : ''}
<p class="big">${hasExtras(p) ? '<small style="font-size:15px">dès </small>' : ''}${fcfa(price)}</p><p class="meta">Prix tout compris, livré à Pointe-Noire : transport, frais de service et frais Mobile Money inclus.</p>
<a class="btn" href="/#/p/${enc(p.id)}">Commander sur Zado</a>
${(p.highlights || []).length ? `<ul class="sp">${p.highlights.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
${opts.length ? `<p>${opts.map((o) => `<strong>${esc(o.name)}</strong> : ${esc(o.values.join(', '))}`).join('<br>')}</p>` : ''}</div></div>
${p.description ? `<h2>Description</h2><p class="in">${esc(p.description)}</p>` : ''}
${(p.specs || []).length ? `<h2>Caractéristiques</h2><ul class="sp">${p.specs.map((x) => `<li>${esc(x.label)} : ${esc(x.value)}</li>`).join('')}</ul>` : ''}
${related.length ? `<h2>Dans le même rayon : ${esc(p.category)}</h2><ul class="g">${related.map(card).join('')}</ul><p><a href="/rayon/${slug(p.category)}">Tous les articles ${esc(p.category)}</a></p>` : ''}` }));
}

// Accueil : index.html servi avec les liens « Nos rayons » (vrais liens que Google suit) et les codes de vérification
let homeMemo = { mtime: 0, html: '' };
function home(req, res, next) {
  const file = path.join(__dirname, '..', 'public', 'index.html');
  let st;
  try { st = fs.statSync(file); } catch { return next(); }
  if (st.mtimeMs !== homeMemo.mtime) homeMemo = { mtime: st.mtimeMs, html: fs.readFileSync(file, 'utf8') };
  const { pages: all } = pages();
  const group = (kind) => all.filter((x) => x.kind === kind).map((x) => `<a href="${x.path}">${esc(x.name)}</a>`).join('');
  const seo = all.length ? `<nav class="footer-seo" aria-label="Tous les rayons"><p><strong>Rayons :</strong> ${group('rayon')}</p><p><strong>Sélections :</strong> ${group('selection')}</p>${all.some((x) => x.kind === 'marque') ? `<p><strong>Marques :</strong> ${group('marque')}</p>` : ''}</nav>` : '';
  const verif = [['google-site-verification', process.env.GOOGLE_SITE_VERIFICATION], ['msvalidate.01', process.env.BING_SITE_VERIFICATION]]
    .filter(([, v]) => v && /^[\w-]{6,120}$/.test(v)).map(([n, v]) => `<meta name="${n}" content="${esc(v)}">`).join('');
  const h = siteHost(req);
  const html = homeMemo.html
    .replace(/<!-- SEO-RAYONS -->[\s\S]*?<!-- \/SEO-RAYONS -->/, `<!-- SEO-RAYONS -->${seo}<!-- /SEO-RAYONS -->`)
    .replace('<!-- SEO-HEAD -->', `<!-- SEO-HEAD -->${verif}`)
    .replace(/https:\/\/zado-congo\.com/g, h);
  res.set('Cache-Control', 'no-cache').type('html').send(html);
}

function sitemap(req, res) {
  const h = siteHost(req);
  const { pages: all, list } = pages();
  const day = (d) => (/^\d{4}-\d\d-\d\d/.test(String(d || '')) ? String(d).slice(0, 10) : '');
  const latest = (items) => items.map((p) => day(p.updatedAt || p.createdAt)).filter(Boolean).sort().pop() || '';
  const url = (loc, mod, imgs = []) => `<url><loc>${esc(loc)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}${imgs.map(([src, t]) => `<image:image><image:loc>${esc(src)}</image:loc><image:title>${esc(t)}</image:title></image:image>`).join('')}</url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${[
    url(`${h}/`, latest(list)),
    ...all.map((pg) => url(h + pg.path, latest(pg.items))),
    ...list.map((p) => url(h + prodPath(p), day(p.updatedAt || p.createdAt), [p.image, ...(p.images || [])].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 5).map((x) => [abs(h, x), p.name]))),
  ].join('\n')}\n</urlset>\n`;
  res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(xml);
}

function mount(app) {
  // Une seule adresse : www.zado-congo.com → zado-congo.com (lecture seulement : GET / HEAD)
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !/^www\./i.test(req.hostname || '') || req.path.startsWith('/.well-known/')) return next();
    let pub; try { pub = new URL(config.publicUrl); } catch { return next(); }
    if (pub.hostname.startsWith('www.') || req.hostname.slice(4).toLowerCase() !== pub.hostname.toLowerCase()) return next();
    res.redirect(301, pub.origin + req.originalUrl);
  });
  app.get(['/', '/index.html'], home);
  app.get('/p/:id', productPage);
  app.get('/p/:id/:slug', productPage);
  app.get(['/rayon/:s', '/marque/:s', '/selection/:s'], (req, res, next) => {
    const pg = pages().pages.find((x) => x.path === req.path.replace(/\/$/, '').toLowerCase());
    if (!pg) return next();
    listPage(req, res, pg);
  });
  app.get('/robots.txt', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600').type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /paiement-carte/\n\nSitemap: ${siteHost(req)}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', sitemap);
}

module.exports = { mount, slug, allInPrice, productLd, pages, prodPath };
