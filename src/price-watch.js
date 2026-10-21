// Prix constatés en France : actualisation AUTOMATIQUE une fois par jour (décision Joseph 21/10/2026).
// Pour chaque produit, l'équipe saisit dans Zado Pro des « prix en France » (vendeur + lien de la page produit).
// Chaque jour, le serveur relit ces pages et met le prix à jour s'il est publié de façon lisible
// (données structurées schema.org « Product / Offer », utilisées par Google : Apple Store, et de nombreux sites).
// Règles de politesse : identité du robot annoncée honnêtement, fichier robots.txt respecté, une page à la fois,
// 2 s entre deux pages d'un même site, jamais de contournement des protections anti-robots
// (Fnac, Darty, Boulanger, Amazon… refusent les robots : leur prix reste celui saisi à la main, marqué « à vérifier »).
const config = require('./config');
const { products, settings } = require('./store');

const UA = `Mozilla/5.0 (compatible; ZadoPrix/1.0; relevé de prix une fois par jour; +${config.publicUrl || 'https://bydl.vercel.app'})`;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 3 * 1024 * 1024;
const HOST_DELAY_MS = Number(process.env.PRICE_WATCH_DELAY_MS ?? 2000);
const HISTORY = 30; // derniers relevés gardés par vendeur
const LAST_KEY = 'price-watch:last';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Lecture du prix dans une page ----------
const num = (v) => {
  if (v == null) return NaN;
  const s = String(v).replace(/\s| | /g, '').replace(/€|EUR/gi, '');
  return Number(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
};
function offersOf(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => offersOf(n, out)); return out; }
  const type = [].concat(node['@type'] || []).join(' ');
  if (/\bAggregateOffer\b/.test(type)) out.push({ price: num(node.lowPrice ?? node.price), currency: node.priceCurrency, from: true });
  else if (/\bOffer\b/.test(type)) {
    const ps = node.priceSpecification;
    out.push({ price: num(node.price ?? (Array.isArray(ps) ? ps[0]?.price : ps?.price)), currency: node.priceCurrency ?? (Array.isArray(ps) ? ps[0]?.priceCurrency : ps?.priceCurrency), from: false });
  }
  for (const k of ['offers', '@graph', 'mainEntity', 'itemOffered', 'hasVariant']) if (node[k]) offersOf(node[k], out);
  return out;
}
/** Renvoie { price, from } (from = « à partir de ») ou null si aucun prix en euros n'est lisible. */
function extractPrice(html) {
  const found = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { offersOf(JSON.parse(m[1].trim()), found); } catch { /* bloc illisible : on ignore */ }
  }
  const eur = found.filter((o) => Number.isFinite(o.price) && o.price > 0 && (!o.currency || /^EUR$/i.test(o.currency)));
  if (eur.length) {
    const exact = eur.filter((o) => !o.from);
    const pick = (exact.length ? exact : eur).reduce((a, b) => (b.price < a.price ? b : a));
    return { price: Math.round(pick.price * 100) / 100, from: pick.from };
  }
  // Repli : microdonnées et balises méta
  const meta = html.match(/<meta[^>]+(?:property|name|itemprop)=["'](?:product:price:amount|og:price:amount|price)["'][^>]*content=["']([\d.,\s]+)["']/i)
    || html.match(/<meta[^>]+content=["']([\d.,\s]+)["'][^>]*(?:property|name|itemprop)=["'](?:product:price:amount|og:price:amount|price)["']/i)
    || html.match(/itemprop=["']price["'][^>]*content=["']([\d.,\s]+)["']/i);
  const p = meta ? num(meta[1]) : NaN;
  return Number.isFinite(p) && p > 0 ? { price: Math.round(p * 100) / 100, from: false } : null;
}

// ---------- robots.txt ----------
const robotsCache = new Map();
async function robotsAllows(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules = [];
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) rules = parseRobots(await r.text());
    } catch { /* pas de robots.txt lisible : aucune règle */ }
    robotsCache.set(u.origin, rules);
  }
  const path = u.pathname + u.search;
  let verdict = true, len = -1; // la règle la plus précise l'emporte (comme Google)
  for (const { allow, pattern } of robotsCache.get(u.origin)) {
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && pattern.length > len) { verdict = allow; len = pattern.length; }
  }
  return verdict;
}
function parseRobots(txt) {
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...rest] = line.split(':'); const key = k.trim().toLowerCase(), val = rest.join(':').trim();
    if (key === 'user-agent') { if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (key === 'disallow' || key === 'allow') && val) cur.rules.push({ allow: key === 'allow', pattern: val });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a.includes('zadoprix')));
  return (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
}

// ---------- Relevé d'un vendeur ----------
/** Relit une page. Renvoie { status: ok|blocked|robots|noprice|error, price?, from?, detail? } */
async function readPage(url) {
  try {
    if (!(await robotsAllows(url))) return { status: 'robots', detail: 'Le site interdit la lecture automatique de cette page (robots.txt)' };
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if ([202, 401, 403, 405, 429, 503].includes(r.status)) return { status: 'blocked', detail: `Le site refuse les robots (code ${r.status})` };
    if (!r.ok) return { status: 'error', detail: `Page inaccessible (code ${r.status})` };
    const buf = Buffer.from(await r.arrayBuffer());
    const html = buf.subarray(0, MAX_BYTES).toString('utf8');
    if (/captcha|datadome|cf-chl|are you a robot|robot check/i.test(html.slice(0, 20000)) && !extractPrice(html)) return { status: 'blocked', detail: 'Le site demande une vérification anti-robot' };
    const p = extractPrice(html);
    return p ? { status: 'ok', ...p } : { status: 'noprice', detail: 'Aucun prix lisible sur la page (produit retiré ou page changée ?)' };
  } catch (err) {
    return { status: 'error', detail: err.name === 'TimeoutError' ? 'Le site ne répond pas (délai dépassé)' : 'Page inaccessible' };
  }
}

/** Met à jour les prix d'un produit. Renvoie le produit mis à jour (ou tel quel s'il n'a aucun lien). */
async function refreshProduct(product, { lastHit = new Map() } = {}) {
  const refs = product.priceRefs || [];
  if (!refs.some((r) => r.url)) return product;
  const now = new Date().toISOString();
  const next = [];
  for (const ref of refs) {
    if (!ref.url) { next.push(ref); continue; }
    const host = new URL(ref.url).host;
    const wait = (lastHit.get(host) || 0) + HOST_DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const res = await readPage(ref.url);
    lastHit.set(host, Date.now());
    const r = { ...ref, checkedAt: now, status: res.status, detail: res.detail || null, auto: res.status === 'ok' };
    if (res.status === 'ok') {
      r.priceEur = res.price; r.from = res.from; r.date = today();
      const hist = (ref.history || []).filter((h) => h.date !== r.date);
      r.history = [...hist, { date: r.date, priceEur: res.price }].slice(-HISTORY);
    }
    next.push(r);
  }
  next.sort((a, b) => a.priceEur - b.priceEur);
  return products.update(product.id, { priceRefs: next, priceCheckedAt: now });
}

let running = null;
/** Relève tous les produits qui ont des liens. Un seul relevé à la fois. */
function runAll({ budgetMs = Infinity } = {}) {
  if (running) return running;
  running = (async () => {
    const t0 = Date.now(), lastHit = new Map();
    const sum = { at: new Date().toISOString(), products: 0, refs: 0, ok: 0, blocked: 0, failed: 0, partial: false };
    robotsCache.clear();
    for (const p of products.all().filter((x) => (x.priceRefs || []).some((r) => r.url))) {
      if (Date.now() - t0 > budgetMs) { sum.partial = true; break; }
      try {
        const u = await refreshProduct(p, { lastHit });
        sum.products++;
        for (const r of (u.priceRefs || []).filter((x) => x.url)) { sum.refs++; if (r.status === 'ok') sum.ok++; else if (['blocked', 'robots'].includes(r.status)) sum.blocked++; else sum.failed++; }
      } catch (err) { console.error('[prix]', p.id, err.message); }
    }
    sum.ms = Date.now() - t0;
    settings.set(LAST_KEY, JSON.stringify(sum));
    console.log(`[prix] relevé des prix en France : ${sum.ok}/${sum.refs} prix lus automatiquement (${sum.products} produits, ${Math.round(sum.ms / 1000)} s)`);
    return sum;
  })().finally(() => { running = null; });
  return running;
}
const lastRun = () => { try { return JSON.parse(settings.get(LAST_KEY) || 'null'); } catch { return null; } };

// Relevé quotidien : à partir de 6 h (heure du Congo, UTC+1), une fois par jour ; vérifié toutes les heures
// (et 1 min après le démarrage, si le relevé du jour n'a pas encore été fait).
let timer = null;
function due(now = new Date()) {
  const last = lastRun();
  const congoHour = (now.getUTCHours() + 1) % 24;
  const dayCongo = (d) => new Date(new Date(d).getTime() + 3600e3).toISOString().slice(0, 10);
  if (!last) return true; // jamais fait : tout de suite
  return dayCongo(last.at) !== dayCongo(now) && congoHour >= 6;
}
function start() {
  if (timer || process.env.VERCEL || process.env.PRICE_WATCH === 'off') return; // Vercel : tâche planifiée /api/cron/prices (vercel.json)
  const tick = () => { if (due()) runAll().catch((err) => console.error('[prix]', err.message)); };
  timer = setInterval(tick, 3600e3); timer.unref?.();
  setTimeout(tick, 60e3).unref?.();
}

module.exports = { extractPrice, parseRobots, readPage, refreshProduct, runAll, lastRun, start, due, UA };
