// Agent « Tendances » (demande de Joseph, 16/10/2026) : plusieurs fois par jour, il repère les produits qui se vendent le
// mieux via des SOURCES OFFICIELLES (API AliExpress Affiliate ; Amazon à brancher quand le compte partenaire y aura accès)
// et ce que les clients Kamwa cherchent sans le trouver, puis les analyse (IA Claude avec la clé de Joseph, sinon
// notation intégrée) et fait des propositions dans Kamwa Pro → Tendances. Joseph décide : intégrer, garder, ignorer.
// Clés : saisies par Joseph dans Kamwa Pro (gardées dans la base, jamais renvoyées en clair) ou dans .env.
const crypto = require('crypto');
const { settings, trends, searches, products } = require('../store');
const aliexpress = require('./aliexpress');
const { analyze, MODEL } = require('./analyze');
const { UNIVERSES } = require('../catalog');

const DEFAULTS = {
  enabled: true,
  hours: [8, 11, 14, 17, 20], // heures de passage (heure du Congo)
  keywords: ['écouteurs bluetooth', 'montre connectée', 'power bank', 'coque iphone', 'chargeur rapide', 'enceinte bluetooth', 'clavier sans fil',
    'baskets homme', 'jogging homme', 't-shirt homme', 'sac à dos', 'lampe solaire', 'ventilateur rechargeable', 'manette ps5', 'disque ssd'],
  perRun: 6, maxPriceEur: 150, shipTo: 'FR',
};
const getJSON = (k, d) => { try { return { ...d, ...(JSON.parse(settings.get(k) || 'null') || {}) }; } catch { return { ...d }; } };
const trendSettings = () => getJSON('trends', DEFAULTS);
function saveTrendSettings(input) {
  const cur = trendSettings();
  const next = { ...cur };
  if ('enabled' in input) next.enabled = Boolean(input.enabled);
  if (Array.isArray(input.hours)) next.hours = [...new Set(input.hours.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b).slice(0, 12);
  if (Array.isArray(input.keywords)) next.keywords = [...new Set(input.keywords.map((k) => String(k).trim().slice(0, 50)).filter(Boolean))].slice(0, 40);
  if ('perRun' in input) next.perRun = Math.max(1, Math.min(20, Number(input.perRun) || cur.perRun));
  if ('maxPriceEur' in input) next.maxPriceEur = Math.max(5, Math.min(2000, Number(input.maxPriceEur) || cur.maxPriceEur));
  settings.set('trends', JSON.stringify(next));
  return next;
}

// ---------- Clés (secrets) ----------
function secrets() {
  const s = getJSON('trends_secrets', {});
  return {
    aliexpress: { appKey: process.env.ALIEXPRESS_APP_KEY || s.aliAppKey || '', appSecret: process.env.ALIEXPRESS_APP_SECRET || s.aliAppSecret || '', trackingId: process.env.ALIEXPRESS_TRACKING_ID || s.aliTrackingId || '' },
    anthropicKey: process.env.ANTHROPIC_API_KEY || s.anthropicKey || '',
  };
}
const mask = (v) => (v ? `••••${String(v).slice(-4)}` : '');
function publicSecrets() {
  const s = secrets();
  return { aliAppKey: mask(s.aliexpress.appKey), aliAppSecret: mask(s.aliexpress.appSecret), aliTrackingId: s.aliexpress.trackingId ? mask(s.aliexpress.trackingId) : '', anthropicKey: mask(s.anthropicKey),
    aliexpress: Boolean(s.aliexpress.appKey && s.aliexpress.appSecret), ai: Boolean(s.anthropicKey), model: MODEL };
}
function saveSecrets(input) {
  const cur = getJSON('trends_secrets', {});
  for (const k of ['aliAppKey', 'aliAppSecret', 'aliTrackingId', 'anthropicKey']) {
    if (typeof input[k] === 'string' && !input[k].startsWith('••••')) cur[k] = input[k].trim().slice(0, 200);
  }
  settings.set('trends_secrets', JSON.stringify(cur));
  return publicSecrets();
}

// ---------- Ce que les clients cherchent ----------
function demand(days = 7) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const agg = {};
  for (const s of searches.all().filter((x) => x.day >= since)) {
    const a = agg[s.q] || (agg[s.q] = { q: s.q, n: 0, results: s.results });
    a.n += s.n; a.results = Math.min(a.results, s.results);
  }
  return Object.values(agg).sort((a, b) => b.n - a.n);
}

// ---------- Un passage de l'agent ----------
let running = null;
function run({ reason = 'manuel' } = {}) {
  if (running) return running;
  running = doRun(reason).finally(() => { running = null; });
  return running;
}
async function doRun(reason) {
  const conf = trendSettings(); const keys = secrets();
  const log = { at: new Date().toISOString(), reason, found: 0, proposed: 0, sources: [], usedAi: false, errors: [] };
  const existing = products.all().filter((p) => p.active !== false).map((p) => p.name);
  const seen = new Set(trends.all().map((t) => `${t.source}:${t.sourceId}`));
  const wanted = demand();
  const unmet = wanted.filter((d) => d.results === 0 && d.n >= 2).slice(0, 5);
  let cands = [];

  // 1) AliExpress (API officielle) : mots-clés du jour (rotation) + recherches de clients restées sans résultat
  if (keys.aliexpress.appKey && keys.aliexpress.appSecret) {
    log.sources.push('AliExpress');
    const slot = Number(settings.get('trends_rot') || 0);
    const todays = conf.keywords.slice(slot % conf.keywords.length).concat(conf.keywords).slice(0, 3);
    settings.set('trends_rot', String(slot + 3));
    for (const kw of [...unmet.map((u) => u.q), ...todays].slice(0, 6)) {
      try { cands.push(...await aliexpress.hotProducts(kw, { ...keys.aliexpress, shipTo: conf.shipTo }, { pageSize: 15, maxPriceEur: conf.maxPriceEur })); }
      catch (err) { log.errors.push(err.message); break; }
    }
  }
  // 2) Recherches des clients Kamwa sans résultat : la demande locale elle-même est une proposition
  for (const u of unmet) {
    cands.push({ source: 'kamwa', sourceId: `q:${u.q}:${new Date().toISOString().slice(0, 10)}`, title: `Recherché sur Kamwa : « ${u.q} »`, keyword: u.q, volume: 0, priceEur: null, rating: null, image: null, url: null, category: '', searches: u.n });
  }
  log.sources.push('recherches Kamwa');
  cands = cands.filter((c) => !seen.has(`${c.source}:${c.sourceId}`));
  // un seul exemplaire par produit, les plus vendus d'abord
  const uniq = new Map(); for (const c of cands) if (!uniq.has(c.sourceId)) uniq.set(c.sourceId, c);
  cands = [...uniq.values()].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 30);
  cands.forEach((c, i) => { c.id = `TR-${Date.now().toString(36).toUpperCase()}-${i}${crypto.randomBytes(2).toString('hex')}`; });
  log.found = cands.length;

  const ctx = { existing, categories: UNIVERSES.flatMap((u) => u.categories), topSearches: wanted.slice(0, 20).map((w) => ({ q: w.q, fois: w.n, resultats: w.results })), demand: Object.fromEntries(wanted.map((w) => [w.q, w.n])) };
  const product = cands.filter((c) => c.source !== 'kamwa');
  const r = await analyze(product, ctx, keys.anthropicKey);
  log.usedAi = r.usedAi; if (r.aiError) log.errors.push(r.aiError);
  // Propositions retenues : les meilleures « à intégrer » / « à surveiller » ; les autres sont mémorisées pour ne pas revenir
  const now = new Date().toISOString();
  const ranked = product.sort((a, b) => b.review.score - a.review.score);
  let kept = 0;
  for (const c of ranked) {
    const keep = c.review.verdict !== 'avoid' && kept < conf.perRun;
    if (keep) kept++;
    trends.insert({ ...c, status: keep ? 'new' : 'skipped', createdAt: now });
  }
  for (const c of cands.filter((x) => x.source === 'kamwa')) {
    trends.insert({ ...c, landed: null, review: { verdict: 'watch', score: Math.min(95, 50 + c.searches * 5), reason: `${c.searches} recherches cette semaine, aucun produit sur Kamwa : une demande à satisfaire.`, risks: [], by: 'recherches Kamwa' }, status: 'new', createdAt: now });
    kept++;
  }
  log.proposed = kept;
  const runs = getJSON('trends_runs', { list: [] }).list || [];
  settings.set('trends_runs', JSON.stringify({ list: [log, ...runs].slice(0, 30) }));
  // Ménage : on ne garde pas indéfiniment ce qui a été ignoré ou écarté
  const old = Date.now() - 45 * 864e5;
  for (const t of trends.all()) if (['skipped', 'ignored'].includes(t.status) && Date.parse(t.createdAt) < old) trends.remove(t.id);
  return log;
}
const runs = () => getJSON('trends_runs', { list: [] }).list || [];

// ---------- Passages automatiques (heure du Congo = UTC+1) ----------
function startScheduler() {
  if (process.env.VERCEL || process.env.TRENDS_DISABLED === '1') return; // démo : pas de passages automatiques
  setInterval(() => {
    const conf = trendSettings();
    if (!conf.enabled) return;
    const now = new Date(Date.now() + 3600e3); // UTC+1
    const h = now.getUTCHours(), day = now.toISOString().slice(0, 10);
    if (!conf.hours.includes(h)) return;
    const key = `${day}-${h}`;
    if (settings.get('trends_last_slot') === key) return;
    settings.set('trends_last_slot', key);
    run({ reason: `passage de ${h} h` }).catch((err) => console.error('[tendances]', err.message));
  }, 5 * 60 * 1000);
}

module.exports = { trendSettings, saveTrendSettings, publicSecrets, saveSecrets, secrets, run, runs, demand, startScheduler, DEFAULTS };
