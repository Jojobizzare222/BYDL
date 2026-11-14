// Fiches complètes des 25 téléphones (demande Joseph 14/11/2026 : « stockage, couleur… doivent figurer, sinon ça ne marche pas bien »).
// Données lues le 14/11/2026 sur les sites OFFICIELS (apple.com/fr, samsung.com/fr, mi.com/fr) : data/telephones-specs-2026-11.json.
//   node scripts/telephones-options.js              → aperçu, rien n'est écrit
//   node scripts/telephones-options.js --confirmer  → met à jour les fiches (journal « Fiches téléphones complétées »)
// Pour chaque téléphone : prix de base = la plus petite capacité (règle de prix Zado, src/pricing.js) ; choix « Stockage »
// avec le supplément de chaque capacité (même règle appliquée à son prix en France) ; choix « Couleur » ; caractéristiques
// (stockage, RAM, écran, processeur, appareil photo, batterie, réseau, SIM, poids) ; points forts ; description.
// ZADO_APP = dossier de la boutique si le script est lancé d'ailleurs (ex. /tmp sur le serveur).
const path = require('path');
const crypto = require('crypto');
const APP = process.env.ZADO_APP || path.join(__dirname, '..');
require(path.join(APP, 'node_modules', 'dotenv')).config({ path: path.join(APP, '.env') });
const store = require(path.join(APP, 'src', 'store'));
const { salePrice } = require(path.join(APP, 'src', 'pricing'));
const SPECS = require(path.join(APP, 'data', 'telephones-specs-2026-11.json'));
const R = 655.957;
const fm = (n) => `${Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const or = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} ou ${list[list.length - 1]}` : list[0]);

const confirm = process.argv.includes('--confirmer');
const updates = [];
for (const s of SPECS) {
  const p = store.products.get(s.id);
  if (!p) { console.log(`  ${s.id} absent de la boutique : ignoré`); continue; }
  const refurb = Boolean(p.condition && p.condition !== 'neuf');
  const storage = [...s.storage].sort((a, b) => a.priceEur - b.priceEur);
  const base = storage[0];
  const sourcePrice = Math.round(base.priceEur * R);
  const price = salePrice({ ...p, sourcePrice });
  const options = [];
  if (storage.length > 1) {
    const extra = {};
    for (const st of storage) { const d = salePrice({ ...p, sourcePrice: Math.round(st.priceEur * R) }) - price; if (d > 0) extra[st.capacity] = d; }
    options.push({ name: 'Stockage', values: storage.map((st) => st.capacity), ...(Object.keys(extra).length ? { extra } : {}) });
  }
  if (s.colors.length > 1) options.push({ name: 'Couleur', values: s.colors });
  const caps = storage.map((st) => st.capacity);
  const name = refurb || storage.length > 1 ? s.name : `${s.name} ${base.capacity}`;
  const specs = [
    { label: 'Stockage', value: or(caps) },
    s.ram && { label: 'Mémoire vive (RAM)', value: s.ram },
    s.screen && { label: 'Écran', value: s.screen },
    s.chip && { label: 'Processeur', value: s.chip },
    s.mainCamera && { label: 'Appareil photo principal', value: s.mainCamera },
    s.battery && { label: /lecture/.test(s.battery) ? 'Autonomie' : 'Batterie', value: s.battery },
    s.network && { label: 'Réseau', value: s.network },
    s.sim && { label: 'Carte SIM', value: s.sim },
    { label: 'Couleurs', value: s.colors.join(', ') },
    ...(p.specs || []).filter((x) => x.label === 'Poids'),
    { label: 'Acheté chez', value: `${p.sourceSupplier} (France)` },
  ].filter(Boolean);
  const highlights = [
    storage.length > 1 ? `Stockage au choix : ${or(caps)}` : `Stockage : ${base.capacity}`,
    'Débloqué tous opérateurs',
    s.sim && `Carte SIM : ${s.sim}`,
    s.screen && `Écran ${s.screen}`,
    s.battery && (/lecture/.test(s.battery) ? `Autonomie ${s.battery}` : `Batterie ${s.battery}`),
    s.network === '5G' && 'Compatible 5G',
  ].filter(Boolean).slice(0, 6);
  const description = `${name}. ${refurb ? 'Reconditionné et garanti par Samsung, ' : 'Neuf, '}acheté en France chez ${p.sourceSupplier} (boutique officielle de la marque) et acheminé par avion jusqu'à Pointe-Noire. Débloqué tous opérateurs.${options.length ? ` Choisissez ${options.map((o) => (o.name === 'Stockage' ? 'le stockage' : 'la couleur')).join(' et ')} avant d'ajouter au panier.` : ''}`;
  const priceRefs = (p.priceRefs || []).map((r, i) => (i === 0 ? { ...r, priceEur: base.priceEur, date: '2026-11-14', from: storage.length > 1 } : r));
  updates.push({ p, patch: { name, price, oldPrice: null, sourcePrice, costPrice: sourcePrice, options, specs, highlights, description, priceRefs, priceRule: '2026-11-14' } });
}
for (const { p, patch } of updates) {
  const opt = patch.options.map((o) => `${o.name} : ${o.values.map((v) => (o.extra?.[v] ? `${v} (+${fm(o.extra[v])})` : v)).join(', ')}`).join(' | ');
  console.log(`${p.id} ${patch.name.padEnd(42)} ${fm(p.price).padStart(13)} → ${fm(patch.price).padStart(13)}  ${opt}`);
}
if (!confirm) { console.log(`\n${updates.length} fiche(s). Aperçu seulement : pour appliquer, ajoutez --confirmer`); process.exit(0); }
const now = new Date().toISOString();
store.transaction(() => {
  for (const { p, patch } of updates) store.products.update(p.id, { ...patch, updatedAt: now });
  store.activity.insert({ id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: now, userId: 'auto', userName: 'Zado (fiches téléphones)', role: 'admin', action: 'Fiches téléphones complétées', targetId: null, targetName: `${updates.length} téléphone(s)`, details: 'Stockage (avec supplément), couleurs, caractéristiques officielles relevées le 14/11/2026' });
});
console.log(`\n✓ ${updates.length} fiche(s) mises à jour.`);
