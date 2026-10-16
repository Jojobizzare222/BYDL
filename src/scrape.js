// Lecture automatique d'une page produit (Kamwa Pro → fiche produit → « Remplir depuis un lien »).
// Comme l'aperçu d'un lien dans WhatsApp : on lit les informations que le site publie lui-même pour les moteurs
// de recherche (données « schema.org » JSON-LD, balises Open Graph, fiche Shopify). Aucune connexion, aucun
// contournement : si un site bloque la lecture automatique, on le dit et l'équipe remplit à la main.
// Sécurité : seules les adresses publiques http(s) sont lues (jamais le réseau interne du serveur), taille et durée limitées.
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (compatible; KamwaApercu/1.0; +https://kamwa.cg)';
const MAX_HTML = 3 * 1024 * 1024;
const MAX_IMG = 8 * 1024 * 1024;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}
async function assertPublic(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Adresse invalide'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Adresse invalide (http ou https uniquement)');
  if (u.username || u.password) throw new Error('Adresse invalide');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!ips.length) throw new Error('Site introuvable');
  if (ips.some((x) => privateIp(x.address))) throw new Error('Adresse non autorisée');
  return u;
}
// Téléchargement prudent : redirections vérifiées une à une, durée et taille limitées
async function safeFetch(url, { accept, max }) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current);
    const res = await fetch(current, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'fr-FR,fr;q=0.9' }, signal: AbortSignal.timeout(12000) });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) { current = new URL(res.headers.get('location'), current).href; continue; }
    if (!res.ok) { const e = new Error(`Le site a répondu ${res.status}`); e.status = res.status; throw e; }
    const chunks = []; let size = 0;
    for await (const c of res.body) { size += c.length; if (size > max) throw new Error('Page trop lourde'); chunks.push(c); }
    return { buffer: Buffer.concat(chunks), type: res.headers.get('content-type') || '', url: current };
  }
  throw new Error('Trop de redirections');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euro: '€', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—', deg: '°', times: '×' };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m));
const text = (s, max = 2000) => decode(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, max);
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const typeIs = (node, t) => asArray(node?.['@type']).some((x) => String(x).toLowerCase() === t.toLowerCase());
const imgUrl = (i) => (typeof i === 'string' ? i : i?.url || i?.contentUrl || null);
const price = (v) => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return n > 0 && n < 1e6 ? Math.round(n * 100) / 100 : null; };

function meta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key.replace(/[:.]/g, '\\$&')}["'][^>]*>`, 'gi');
  return [...html.matchAll(re)].map((m) => (m[0].match(/content=["']([^"']*)["']/i) || [])[1]).filter(Boolean).map(decode);
}
function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim());
      const walk = (n) => { for (const x of asArray(n)) { if (!x || typeof x !== 'object') continue; out.push(x); if (x['@graph']) walk(x['@graph']); } };
      walk(data);
    } catch { /* bloc illisible : ignoré */ }
  }
  return out;
}

// Rayon deviné d'après le nom (modifiable ensuite) et poids moyen pour le transport en avion
const GUESS = [
  [/iphone|smartphone|t[ée]l[ée]phone|galaxy|pixel|redmi/i, 'Téléphones'], [/ipad|tablette/i, 'Tablettes'], [/macbook|ordinateur|laptop|pc portable|imac/i, 'Ordinateurs'],
  [/montre|watch/i, 'Montres'], [/casque|[ée]couteurs|airpods|enceinte|speaker|barre de son/i, 'Audio'], [/t[ée]l[ée]viseur|\btv\b|t[ée]l[ée] /i, 'TV & Maison'],
  [/chaussure|basket|sneaker|escarpin|sandale|botte|mocassin/i, 'Chaussures'], [/robe|jupe|chemisier|top femme|femme/i, 'Femme'],
  [/t-shirt|tee-shirt|pantalon|jogging|chemise|sweat|jean|polo|veste|short|homme/i, 'Homme'], [/c[âa]ble|chargeur|coque|adaptateur|batterie externe/i, 'Accessoires'],
];
const WEIGHT = { Téléphones: 0.5, Tablettes: 1, Ordinateurs: 2.5, Montres: 0.3, Audio: 0.7, 'TV & Maison': 3, Composants: 0.5, Accessoires: 0.3, Homme: 0.5, Femme: 0.5, Chaussures: 1.3 };
const guessCategory = (name) => GUESS.find(([re]) => re.test(name || ''))?.[1] || null;

/** Lit la page et renvoie { name, brand, description, images[], priceEur, currency, options[], specs[], category, weightKg, source } */
async function readProduct(url) {
  let page;
  try {
    page = await safeFetch(url, { accept: 'text/html,application/xhtml+xml', max: MAX_HTML });
  } catch (err) {
    if ([401, 403, 429, 503].includes(err.status)) throw new Error("Ce site refuse la lecture automatique de ses pages. Remplissez la fiche à la main (vous pouvez copier le texte depuis le site).");
    throw err;
  }
  const html = page.buffer.toString('utf8');
  if (/captcha|robot check|are you a human|access denied/i.test(html.slice(0, 20000)) && !/application\/ld\+json/i.test(html)) {
    throw new Error("Ce site demande une vérification « êtes-vous un robot ». Remplissez la fiche à la main.");
  }
  const nodes = jsonLd(html);
  const prod = nodes.find((n) => typeIs(n, 'ProductGroup')) || nodes.find((n) => typeIs(n, 'Product'));
  const r = { name: '', brand: '', description: '', images: [], priceEur: null, currency: null, options: [], specs: [], source: page.url };

  const colors = new Set(); const sizes = new Set();
  if (prod) {
    r.name = text(prod.name, 120);
    r.brand = text(typeof prod.brand === 'object' ? prod.brand?.name : prod.brand, 60);
    r.description = text(prod.description);
    r.images.push(...asArray(prod.image).map(imgUrl));
    const gid = prod['@id'];
    const variants = [...asArray(prod.hasVariant), ...nodes.filter((n) => n !== prod && typeIs(n, 'Product') && gid && n.isVariantOf?.['@id'] === gid)]; // variantes séparées (ex. Decathlon)
    const offers = [...asArray(prod.offers).flatMap((o) => (typeIs(o, 'AggregateOffer') ? [o, ...asArray(o.offers)] : [o])), ...variants.flatMap((v) => asArray(v.offers))];
    for (const o of offers) {
      const spec = asArray(o?.priceSpecification)[0];
      const p = price(o?.price ?? o?.lowPrice ?? spec?.price);
      if (p && (r.priceEur == null || p < r.priceEur)) { r.priceEur = p; r.currency = o.priceCurrency || spec?.priceCurrency || r.currency; }
    }
    for (const v of [prod, ...variants]) {
      asArray(v.color).forEach((c) => String(c).split(/\s*[,/]\s*/).forEach((x) => x && colors.add(text(x, 40))));
      asArray(v.size).forEach((s) => s && sizes.add(text(typeof s === 'object' ? s.name : s, 30)));
      if (variants.length) r.images.push(...asArray(v.image).map(imgUrl));
    }
    if (prod.sku) r.specs.push({ label: 'Référence', value: text(prod.sku, 60) });
    if (prod.gtin13 || prod.gtin) r.specs.push({ label: 'EAN', value: text(prod.gtin13 || prod.gtin, 30) });
    for (const ap of asArray(prod.additionalProperty).slice(0, 8)) if (ap?.name && ap?.value) r.specs.push({ label: text(ap.name, 40), value: text(ap.value, 120) });
  }
  // Boutique Shopify : fiche complète (options couleur / taille) disponible en JSON
  if ((!colors.size && !sizes.size) && /cdn\.shopify\.com|Shopify\.theme/i.test(html)) {
    try {
      const u = new URL(page.url); const m = u.pathname.match(/\/products\/[^/?#]+/);
      if (m) {
        const j = JSON.parse((await safeFetch(`${u.origin}${m[0]}.json`, { accept: 'application/json', max: MAX_HTML })).buffer.toString('utf8')).product;
        r.name = r.name || text(j.title, 120); r.brand = r.brand || text(j.vendor, 60); r.description = r.description || text(j.body_html);
        r.images.push(...asArray(j.images).map((i) => i.src));
        for (const o of asArray(j.options)) {
          const vals = asArray(o.values).map((x) => text(x, 40));
          if (/couleur|color|colour/i.test(o.name)) vals.forEach((v) => colors.add(v));
          else if (/taille|size|pointure/i.test(o.name)) vals.forEach((v) => sizes.add(v));
        }
        const p = price(asArray(j.variants)[0]?.price); if (p && !r.priceEur) r.priceEur = p;
      }
    } catch { /* pas de fiche JSON : on garde le reste */ }
  }
  // Repli : balises Open Graph / meta (souvent présentes même sans données produit)
  r.name = r.name || text(meta(html, 'og:title')[0] || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1], 120);
  r.description = r.description || text(meta(html, 'og:description')[0] || meta(html, 'description')[0]);
  r.brand = r.brand || text(meta(html, 'product:brand')[0] || '', 60);
  if (!r.images.length) r.images.push(...meta(html, 'og:image'), ...meta(html, 'og:image:secure_url'));
  if (r.priceEur == null) { r.priceEur = price(meta(html, 'product:price:amount')[0] || meta(html, 'og:price:amount')[0]); r.currency = meta(html, 'product:price:currency')[0] || meta(html, 'og:price:currency')[0] || r.currency; }
  if (r.priceEur != null && r.currency && r.currency.toUpperCase() !== 'EUR') r.priceEur = null; // autre devise : prix à saisir

  if (colors.size) r.options.push({ name: 'Couleur', values: [...colors].slice(0, 20) });
  if (sizes.size) r.options.push({ name: 'Taille', values: [...sizes].slice(0, 30) });
  r.images = [...new Set(r.images.filter(Boolean).map((i) => { try { return new URL(i, page.url).href; } catch { return null; } }).filter(Boolean))].slice(0, 6);
  r.category = guessCategory(r.name);
  r.weightKg = WEIGHT[r.category] || 1;
  if (!r.name) throw new Error("Aucune information produit trouvée sur cette page. Vérifiez que le lien mène bien à la page d'UN produit.");
  // Ni fiche produit, ni prix : le site a probablement renvoyé une page générique (lecture automatique bloquée)
  if (!prod && r.priceEur == null && !r.options.length) {
    throw new Error("Ce site n'a pas montré la fiche du produit à Kamwa (lecture automatique bloquée). Utilisez le bouton « → Kamwa » depuis la page du produit (explications juste en dessous).");
  }
  return r;
}

async function fetchImage(url) {
  const { buffer, type } = await safeFetch(url, { accept: 'image/avif,image/webp,image/jpeg,image/png,image/*', max: MAX_IMG });
  if (!/^image\//i.test(type)) throw new Error('Pas une image');
  return buffer;
}

module.exports = { readProduct, fetchImage, WEIGHT, guessCategory };
