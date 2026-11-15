// Nouveaux articles du 15/11/2026 (demande Joseph : « rajoute des articles PlayStation, jeux vidéo (précommande GTA 6…),
// Xbox, table, armoire, chevet, paires de chaussures, écran, lunettes, whey, habits homme et femme… ») + téléviseurs pour
// la section TV & Maison de l'accueil. Meubles : seulement des petits meubles (colis ≤ 15 kg, décision Joseph 15/11/2026).
// Données relevées le 15/11/2026 sur les sites des marques et des enseignes françaises qui acceptent les robots
// (jamais de contournement de protection) : data/catalogue-2026-11-15.json.
//   node scripts/catalogue-2026-11-15.js              → aperçu, rien n'est écrit
//   node scripts/catalogue-2026-11-15.js --confirmer  → ajoute les articles (VISIBLES, sans photo, « sur commande »)
// Prix = règle Zado (src/pricing.js) sur la version la moins chère ; chaque autre version a un SUPPLÉMENT qui comprend la
// différence de prix ET la différence de transport (colis plus lourd). Tailles, couleurs, parfums : choix sans supplément.
// Provenance France + fournisseur d'origine (l'enseigne où Zado achète). Un nom déjà présent n'est jamais ajouté deux fois.
// ZADO_APP = dossier de la boutique, CATALOGUE_DATA = fichier de données (pour lancer depuis /tmp sur le serveur).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const APP = process.env.ZADO_APP || path.join(__dirname, '..');
require(path.join(APP, 'node_modules', 'dotenv')).config({ path: path.join(APP, '.env') });
const DATA = process.env.CATALOGUE_DATA || path.join(APP, 'data', 'catalogue-2026-11-15.json');
const R = 655.957;
const DATE = '2026-11-15';
const fm = (n) => `${Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Valeurs d'un choix : ni virgule ni deux-points (séparateurs dans Zado Pro), 40 caractères max
const clean = (s, n = 40) => String(s || '').replace(/(\d),(\d)/g, '$1.$2').replace(/[,:;]/g, ' ').replace(/\(\s*\+/g, '(').replace(/\s+/g, ' ').trim().slice(0, n);
const cut = (t, n) => { t = String(t); return t.length <= n ? t : `${t.slice(0, t.lastIndexOf(' ', n - 1) > n / 2 ? t.lastIndexOf(' ', n - 1) : n - 1).replace(/[\s,;:]+$/, '')}…`; };
const or = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} ou ${l[l.length - 1]}` : l[0]);
const gram = (g) => (g >= 1000 ? `${String(Math.round(g / 10) / 100).replace('.', ',')} kg` : `${Math.round(g)} g`);
const LABELS = { screen: 'Écran', storage: 'Stockage', resolution: 'Définition', smart: 'Système', hdmi: 'Connectique', protein: 'Protéines', servings: 'Portions', dimensions: 'Dimensions', material: 'Matière', assembly: 'Montage', compatibility: 'Compatibilité', other: 'À savoir' };
const kgOf = (g) => (g > 0 ? Math.round(g / 10) / 100 : null);
const dayFr = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function build(m) {
  const { salePrice } = require(path.join(APP, 'src', 'pricing'));
  const { unitFee } = require(path.join(APP, 'src', 'freight'));
  const configs = (m.configs || []).filter((c) => c.priceEur > 0).map((c) => ({ ...c, raw: c.label, label: clean(c.label) })).sort((a, b) => a.priceEur - b.priceEur || (a.weightG || 0) - (b.weightG || 0));
  if (!configs.length) return null;
  const base = configs[0];
  const baseG = base.weightG || m.weightG || null;
  const draft = { condition: 'neuf', weightKg: kgOf(baseG) };
  const sourcePrice = Math.round(base.priceEur * R);
  const price = salePrice({ ...draft, sourcePrice });
  const baseFee = unitFee(draft);
  const options = [];
  const oname = m.optionName || (configs.every((c) => /^\s*\d+([.,]\d+)?\s*(g|kg)\s*$/i.test(c.label)) ? 'Format' : configs.every((c) => /^\s*\d+([.,]\d+)?\s*(Go|To)\s*$/i.test(c.label)) ? 'Stockage' : 'Version');
  if (configs.length > 1) {
    const extra = {}, values = [];
    for (const c of configs) {
      if (values.includes(c.label) || !c.label) continue;
      values.push(c.label);
      const w = { condition: 'neuf', weightKg: kgOf(c.weightG || baseG) };
      const d = salePrice({ ...w, sourcePrice: Math.round(c.priceEur * R) }) - price + (unitFee(w) - baseFee);
      if (d > 0) extra[c.label] = d;
    }
    if (values.length > 1) options.push({ name: oname, values: values.slice(0, 40), ...(Object.keys(extra).length ? { extra } : {}) });
  }
  for (const [name, list] of [[m.sizeName || 'Taille', m.sizes], ['Couleur', m.colors], ['Parfum', m.flavors]]) {
    const vals = [...new Set((list || []).map((x) => clean(x)).filter(Boolean))];
    if (vals.length > 1) options.push({ name, values: vals.slice(0, 40) });
  }
  const one = configs.length === 1 ? String(base.raw || '').trim() : '';
  const name = String(m.name).replace(/\s+/g, ' ').trim().slice(0, 120);
  const pre = m.preorder?.releaseDate || null;
  const specs = [
    pre && { label: 'Précommande', value: `sortie prévue le ${dayFr(pre)}` },
    m.platform && !options.some((o) => o.name === 'Plateforme') && { label: 'Plateforme', value: m.platform },
    one && !norm(name).includes(norm(one)) && { label: 'Version', value: cut(one, 120) },
    configs.length > 1 && or(configs.map((c) => c.label)).length <= 120 && { label: oname === 'Version' ? 'Versions' : oname, value: or(configs.map((c) => c.label)) },
    m.sizes?.length > 1 && { label: m.sizeName === 'Pointure' ? 'Pointures' : 'Tailles', value: cut(m.sizes.join(', '), 120) },
    ...Object.entries(m.specs || {}).filter(([, v]) => v).map(([k, v]) => ({ label: LABELS[k] || k, value: cut(v, 120) })),
    m.colors?.length && { label: m.colors.length > 1 ? 'Couleurs' : 'Couleur', value: cut(m.colors.join(', '), 120) },
    m.flavors?.length && { label: m.flavors.length > 1 ? 'Parfums' : 'Parfum', value: cut(m.flavors.join(', '), 120) },
    m.material && { label: 'Matière', value: cut(m.material, 120) },
    m.productWeightG > 0 && { label: 'Poids', value: gram(m.productWeightG) },
    { label: 'Provenance', value: `Neuf, acheté en France chez ${m.store}` },
  ].filter(Boolean).slice(0, 15);
  const choose = options.map((o) => ({ Taille: 'la taille', Couleur: 'la couleur', Parfum: 'le parfum', Format: 'le format', Stockage: 'le stockage', Version: 'la version', Plateforme: 'la plateforme', Pointure: 'la pointure' }[o.name] || `« ${o.name.toLowerCase()} »`));
  const highlights = [
    pre ? `Précommande : sortie prévue le ${dayFr(pre)}` : null,
    `Neuf, acheté en France chez ${m.store}`,
    ...(m.highlights || []),
    configs.length > 1 && (or(configs.map((c) => c.label)).length <= 90 ? `${oname} au choix : ${or(configs.map((c) => c.label))}` : `${configs.length} versions au choix`),
  ].filter(Boolean).map((h) => cut(h, 140)).slice(0, 6);
  const description = `${name}. ${pre ? `Précommande : sortie prévue le ${dayFr(pre)} ; nous l'achetons en France dès sa sortie et vous le livrons à Pointe-Noire. ` : ''}Neuf, acheté en France chez ${m.store}, puis acheminé par avion jusqu'à Pointe-Noire.${m.description ? ` ${m.description}` : ''}${choose.length ? ` Choisissez ${choose.join(', ').replace(/, ([^,]*)$/, ' et $1')} avant d'ajouter au panier.` : ''}`;
  return {
    id: m.id, name, brand: m.brand || null, universe: require(path.join(APP, 'src', 'catalog')).universeOf(m.category), category: m.category,
    price, oldPrice: null, stock: null, active: true, condition: 'neuf',
    description: cut(description, 4000), provenance: 'France', sourceSupplier: m.store,
    sourcePrice, costPrice: sourcePrice, weightKg: kgOf(baseG),
    weightSource: m.weightSource || (baseG ? `Colis : ${gram(baseG)} (${m.weightNote || 'poids publié ou estimé lors du relevé'})` : 'Poids inconnu : poids par défaut (1 kg) à corriger dans Zado Pro'),
    options, specs, highlights,
    ...(pre ? { preorder: { releaseDate: pre } } : {}),
    ...(m.platform ? { platform: m.platform } : {}),
    priceRefs: [{ store: m.store, priceEur: base.priceEur, url: m.url, date: DATE, status: 'manual', from: configs.length > 1, auto: false, watch: false }],
    priceRefsPublic: false, priceRule: DATE, selection: m.selection || null,
  };
}

function plan() {
  const store = require(path.join(APP, 'src', 'store'));
  const list = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const have = store.products.all();
  const ids = new Set(have.map((p) => p.id)), names = new Set(have.map((p) => norm(p.name)));
  const add = [], skip = [];
  for (const m of list) {
    const p = build(m);
    if (!p) { skip.push({ id: m.id, name: m.name, why: 'sans prix' }); continue; }
    if (!p.universe) { skip.push({ id: m.id, name: m.name, why: `rayon inconnu « ${m.category} »` }); continue; }
    if (ids.has(p.id) || names.has(norm(p.name))) { skip.push({ id: p.id, name: p.name, why: 'déjà en boutique' }); continue; }
    names.add(norm(p.name)); add.push(p);
  }
  return { store, add, skip };
}

if (require.main === module) {
  const confirm = process.argv.includes('--confirmer');
  const { store, add, skip } = plan();
  const { unitFee } = require(path.join(APP, 'src', 'freight'));
  const byCat = {};
  for (const p of add) {
    byCat[p.category] = (byCat[p.category] || 0) + 1;
    console.log(`${p.id} ${p.name.slice(0, 44).padEnd(44)} ${fm(p.price).padStart(14)} + transport ${fm(unitFee(p)).padStart(12)}  ${String(p.weightKg ?? '?').padStart(5)} kg  ${p.options.map((o) => `${o.name}:${o.values.length}`).join(' ')}`);
  }
  for (const s of skip) console.log(`  ignoré : ${s.id} ${s.name} (${s.why})`);
  console.log(`\n${add.length} article(s) à ajouter : ${Object.entries(byCat).map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  if (!confirm) { console.log('Aperçu seulement : pour ajouter, relancez avec --confirmer'); process.exit(0); }
  const now = new Date().toISOString();
  store.transaction(() => {
    for (const p of add) store.products.insert({ ...p, createdAt: now, updatedAt: now, importedAt: now, importedFrom: `${p.sourceSupplier} (relevé du 15/11/2026)` });
    if (add.length) store.activity.insert({ id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: now, userId: 'auto', userName: 'Zado (import du 15/11/2026)', role: 'admin', action: 'Catalogue importé', targetId: null, targetName: `${add.length} article(s) visibles`, details: Object.entries(byCat).map(([c, n]) => `${c} : ${n}`).join(' · ') });
  });
  console.log(`\n✓ ${add.length} article(s) ajouté(s), VISIBLES (sans photo ; « sur commande »).`);
}
module.exports = { build, plan };
