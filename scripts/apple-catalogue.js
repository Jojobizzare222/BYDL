// Catalogue Apple NEUF acheté directement à l'Apple Store France (demande Joseph 14/11/2026 : « rajoute tout le catalogue Apple.
// Je pourrais acheter chez eux directement. Précise la provenance »).
// Données relevées le 14/11/2026 sur apple.com/fr (pages d'achat et fiches techniques officielles) : data/apple-2026-11.json.
//   node scripts/apple-catalogue.js              → aperçu, rien n'est écrit
//   node scripts/apple-catalogue.js --confirmer  → ajoute les articles (VISIBLES, sans photo, « sur commande »)
// Pour chaque modèle : prix de base = la configuration la moins chère (règle de prix Zado, src/pricing.js) ; choix
// « Configuration » / « Stockage » / « Taille » avec le supplément de chacun (même règle appliquée à son prix en France) ;
// choix « Couleur » ; caractéristiques ; points forts ; poids du colis (appareil + emballage estimé) ; provenance affichée
// partout : « Neuf, acheté directement à l'Apple Store France (apple.com/fr) ».
// Un article déjà présent (même identifiant ou même nom) n'est jamais ajouté deux fois. Relancer = sans effet.
// ZADO_APP = dossier de la boutique si le script est lancé d'ailleurs (ex. /tmp sur le serveur).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const APP = process.env.ZADO_APP || path.join(__dirname, '..');
require(path.join(APP, 'node_modules', 'dotenv')).config({ path: path.join(APP, '.env') });
const DATA = process.env.APPLE_DATA || path.join(APP, 'data', 'apple-2026-11.json');
const R = 655.957;
const DATE = '2026-11-14';
const SOURCE = 'Apple Store France (apple.com/fr)';
const fm = (n) => `${Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Valeurs d'un choix : ni virgule ni deux-points (séparateurs dans Zado Pro), 40 caractères max ; « 1,8 m » → « 1.8 m »
const clean = (s, n = 40) => String(s || '').replace(/(\d),(\d)/g, '$1.$2').replace(/[,:;]/g, ' ').replace(/\(\s*\+/g, '(').replace(/\s+/g, ' ').trim().slice(0, n);
const cut = (t, n) => { t = String(t); return t.length <= n ? t : `${t.slice(0, t.lastIndexOf(' ', n - 1) > n / 2 ? t.lastIndexOf(' ', n - 1) : n - 1).replace(/[\s,;:]+$/, '')}…`; };
const gram = (g) => (g >= 1000 ? `${String(g / 1000).replace('.', ',')} kg` : `${String(g).replace('.', ',')} g`);
const or = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} ou ${l[l.length - 1]}` : l[0]);

// Emballage estimé (g) ajouté au poids de l'appareil, et poids estimé quand Apple ne le publie pas
const PACK = { 'Téléphones': 150, 'Tablettes': 250, 'Ordinateurs': 700, 'Montres': 200, 'Audio': 120, 'TV & Maison': 300, 'Accessoires': 80 };
const PACK_FAMILY = [[/imac/i, 3000], [/mac studio|mac pro/i, 1000], [/mac mini/i, 400], [/homepod(?! mini)/i, 800], [/homepod mini/i, 300], [/vision/i, 1200], [/studio display|pro display/i, 3500]];
const GUESS = [[/pointes/i, 20], [/pencil/i, 120], [/magic keyboard.*ipad|clavier.*ipad/i, 700], [/magic keyboard/i, 400], [/magic mouse/i, 100], [/trackpad/i, 250], [/adaptateur secteur|kit de voyage|chargeur/i, 200], [/adaptateur/i, 40], [/câble|cable/i, 100], [/coque|case|étui|folio/i, 80], [/airtag/i, 60], [/earpods/i, 60], [/magsafe/i, 120]];
const LABELS = { screen: 'Écran', chip: 'Puce', ram: 'Mémoire vive (RAM)', storage: 'Stockage', camera: 'Appareil photo', battery: 'Autonomie', ports: 'Connectique', water: 'Résistance à l’eau', compatibility: 'Compatibilité', connectivity: 'Connectivité', audio: 'Son', sensors: 'Capteurs', connectivity2: 'Réseau', legend: 'Lire une configuration', other: 'À savoir' };

function optionName(m) {
  if (m.optionName) return m.optionName;
  const labels = m.configs.map((c) => c.label);
  if (m.category === 'Montres') return 'Modèle';
  if (labels.every((l) => /^\s*\d+\s*(Go|To)\s*$/i.test(l))) return 'Stockage';
  if (labels.every((l) => /^\s*\d+([.,]\d+)?\s*(m|cm)\s*$/i.test(l))) return 'Longueur';
  return 'Configuration';
}

function weightOf(m) {
  const pack = (PACK_FAMILY.find(([re]) => re.test(m.family || m.name)) || [])[1] ?? PACK[m.category] ?? 150;
  if (m.weightG > 0) return { kg: Math.round((m.weightG + pack) / 10) / 100, src: `Fiche technique Apple : appareil ${m.weightG} g + emballage estimé ${pack} g` };
  const g = (GUESS.find(([re]) => re.test(m.name)) || [])[1];
  if (g) return { kg: Math.round((g + pack) / 10) / 100, src: `Estimation Zado (poids non publié par Apple) : ${g} g + emballage ${pack} g` };
  return { kg: null, src: 'Poids non publié par Apple : poids par défaut (1 kg) à corriger dans Zado Pro' };
}

function build(m, products) {
  const { salePrice } = require(path.join(APP, 'src', 'pricing'));
  const configs = m.configs.filter((c) => c.priceEur > 0).map((c) => ({ ...c, raw: c.label, label: clean(c.label) })).sort((a, b) => a.priceEur - b.priceEur);
  if (!configs.length) return null;
  const base = configs[0];
  const w = weightOf(m);
  const draft = { condition: 'neuf', weightKg: w.kg };
  const sourcePrice = Math.round(base.priceEur * R);
  const price = salePrice({ ...draft, sourcePrice });
  const options = [];
  const oname = optionName({ ...m, configs });
  if (configs.length > 1) {
    const extra = {};
    const values = [];
    for (const c of configs) {
      if (values.includes(c.label)) continue;
      values.push(c.label);
      const d = salePrice({ ...draft, sourcePrice: Math.round(c.priceEur * R) }) - price;
      if (d > 0) extra[c.label] = d;
    }
    options.push({ name: oname, values: values.slice(0, 40), ...(Object.keys(extra).length ? { extra } : {}) });
  }
  const colors = [...new Set((m.colors || []).map((c) => clean(c)).filter(Boolean))];
  if (colors.length > 1) options.push({ name: 'Couleur', values: colors.slice(0, 40) });
  // Une seule version : la capacité va dans le nom (« iPhone 16 128 Go »), le reste dans les caractéristiques (« Version »)
  const one = configs.length === 1 ? String(configs[0].raw || '').trim() : '';
  const inName = one && /^\d+\s*(Go|To)$/.test(one);
  const name = String(inName ? `${m.name} ${one}` : m.name).replace(/\s+/g, ' ').trim().slice(0, 120);
  const specs = [
    one && !inName && { label: 'Version', value: cut(one, 120) },
    configs.length > 1 && or(configs.map((c) => c.label)).length <= 120 && { label: oname === 'Modèle' ? 'Modèles' : oname === 'Configuration' ? 'Configurations' : oname, value: or(configs.map((c) => c.label)) },
    ...Object.entries(m.specs || {}).filter(([, v]) => v).map(([k, v]) => ({ label: LABELS[k] || k, value: cut(v, 120) })),
    colors.length && { label: colors.length > 1 ? 'Couleurs' : 'Couleur', value: cut(colors.join(', '), 120) },
    m.weightG > 0 && { label: 'Poids', value: gram(m.weightG) },
    { label: 'Provenance', value: `Neuf, acheté directement à l'${SOURCE}` },
  ].filter(Boolean);
  const highlights = [
    `Neuf, acheté directement à l'Apple Store France`,
    configs.length > 1 && (or(configs.map((c) => c.label)).length <= 90 ? `${oname} au choix : ${or(configs.map((c) => c.label))}` : `${configs.length} ${{ Modèle: 'modèles', Configuration: 'configurations' }[oname] || 'choix'} au choix`),
    m.specs?.chip && `Puce ${m.specs.chip}`.replace(/^Puce puce/i, 'Puce'),
    m.specs?.screen && `Écran ${m.specs.screen}`.replace(/^Écran écran/i, 'Écran'),
    m.specs?.battery && `Autonomie : ${m.specs.battery}`,
    m.specs?.compatibility && m.specs.compatibility.length <= 110 && `Compatible : ${m.specs.compatibility}`,
    'Garantie constructeur Apple',
  ].filter(Boolean).map((h) => cut(h, 140)).slice(0, 6);
  const choose = options.map((o) => ({ Stockage: 'le stockage', Taille: 'la taille', Couleur: 'la couleur', Modèle: 'le modèle', Configuration: 'la configuration', Boîtier: 'le boîtier', Lot: 'le lot', Prise: 'la prise', Connecteur: 'le connecteur', Longueur: 'la longueur' }[o.name] || `« ${o.name.toLowerCase()} »`));
  const description = `${name}. Neuf, acheté directement à l'Apple Store France (apple.com/fr), la boutique officielle d'Apple, puis acheminé par avion jusqu'à Pointe-Noire. Garantie constructeur Apple.${choose.length ? ` Choisissez ${choose.join(' et ')} avant d'ajouter au panier.` : ''}`;
  return {
    id: m.id, name, brand: 'Apple', universe: 'Électronique', category: m.category,
    price, oldPrice: null, stock: null, active: true, condition: 'neuf',
    description, provenance: 'France', sourceSupplier: 'Apple Store',
    sourcePrice, costPrice: sourcePrice, weightKg: w.kg, weightSource: w.src,
    options, specs, highlights,
    priceRefs: [{ store: 'Apple Store', priceEur: base.priceEur, url: m.url, date: DATE, status: 'ok', from: configs.length > 1, auto: false, watch: true }],
    priceRefsPublic: false, priceRule: DATE, selection: 'Apple Store',
  };
}

function plan() {
  const store = require(path.join(APP, 'src', 'store'));
  const list = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const have = store.products.all();
  const ids = new Set(have.map((p) => p.id));
  const names = new Set(have.map((p) => norm(p.name)));
  const add = [], skip = [];
  for (const m of list) {
    const p = build(m, store.products);
    if (!p) { skip.push({ id: m.id, name: m.name, why: 'sans prix' }); continue; }
    if (ids.has(p.id) || names.has(norm(p.name))) { skip.push({ id: p.id, name: p.name, why: 'déjà en boutique' }); continue; }
    names.add(norm(p.name));
    add.push(p);
  }
  return { store, add, skip };
}

if (require.main === module) {
  const confirm = process.argv.includes('--confirmer');
  const { store, add, skip } = plan();
  const byCat = {};
  for (const p of add) {
    byCat[p.category] = (byCat[p.category] || 0) + 1;
    const opt = p.options.map((o) => `${o.name} : ${o.values.length}`).join(' | ');
    console.log(`${p.id} ${p.name.slice(0, 46).padEnd(46)} ${fm(p.price).padStart(15)}  ${String(p.weightKg ?? '?').padStart(5)} kg  ${opt}`);
  }
  for (const s of skip) console.log(`  ignoré : ${s.id} ${s.name} (${s.why})`);
  console.log(`\n${add.length} article(s) à ajouter : ${Object.entries(byCat).map(([c, n]) => `${c} ${n}`).join(' · ')}`);
  if (!confirm) { console.log('Aperçu seulement : pour ajouter, relancez avec --confirmer'); process.exit(0); }
  const now = new Date().toISOString();
  store.transaction(() => {
    for (const p of add) store.products.insert({ ...p, createdAt: now, updatedAt: now, importedAt: now, importedFrom: `${SOURCE}, relevé du 14/11/2026` });
    if (add.length) store.activity.insert({ id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: now, userId: 'auto', userName: 'Zado (catalogue Apple)', role: 'admin', action: 'Catalogue importé', targetId: null, targetName: `${add.length} article(s) Apple visibles`, details: `Neufs, achetés à l'${SOURCE} · ${Object.entries(byCat).map(([c, n]) => `${c} : ${n}`).join(' · ')}` });
  });
  console.log(`\n✓ ${add.length} article(s) Apple ajouté(s), VISIBLES (sans photo : icône du rayon ; « sur commande »).`);
}
module.exports = { build, plan };
