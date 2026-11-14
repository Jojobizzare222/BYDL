// Applique la règle de prix Zado (src/pricing.js, décision Joseph 14/11/2026) à tous les articles qui ont un prix en France.
//   node scripts/appliquer-regle-prix.js              → aperçu : combien d'articles changent, exemples ; rien n'est écrit
//   node scripts/appliquer-regle-prix.js --confirmer  → écrit les nouveaux prix (journal « Règle de prix appliquée »)
// Articles sans prix en France (`sourcePrice`) : inchangés. Un ancien prix barré inférieur au nouveau prix est retiré.
// ZADO_APP = dossier de la boutique si le script est lancé d'ailleurs (ex. /tmp sur le serveur).
const path = require('path');
const crypto = require('crypto');
const APP = process.env.ZADO_APP || path.join(__dirname, '..');
require(path.join(APP, 'node_modules', 'dotenv')).config({ path: path.join(APP, '.env') });
const store = require(path.join(APP, 'src', 'store'));
const { salePrice } = require(path.join(APP, 'src', 'pricing'));
const fm = (n) => `${Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;

const confirm = process.argv.includes('--confirmer');
const all = store.products.all();
const changes = [];
let noSource = 0;
for (const p of all) {
  const price = salePrice(p);
  if (!price) { noSource++; continue; }
  if (price === p.price) continue;
  changes.push({ p, price, oldPrice: p.oldPrice && p.oldPrice > price ? p.oldPrice : null });
}
const up = changes.filter((c) => c.price > c.p.price).length;
console.log(`${all.length} articles · ${changes.length} prix à changer (${up} en hausse, ${changes.length - up} en baisse) · ${noSource} sans prix en France (inchangés)`);
for (const c of changes.slice(0, 12)) console.log(`  ${c.p.name.slice(0, 55).padEnd(55)} ${fm(c.p.price).padStart(13)} → ${fm(c.price)}`);
if (!confirm) { console.log('\nAperçu seulement. Pour appliquer : node scripts/appliquer-regle-prix.js --confirmer'); process.exit(0); }
const now = new Date().toISOString();
store.transaction(() => {
  for (const c of changes) store.products.update(c.p.id, { price: c.price, oldPrice: c.oldPrice, priceRule: '2026-11-14', updatedAt: now });
  store.activity.insert({ id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: now, userId: 'auto', userName: 'Zado (règle de prix)', role: 'admin', action: 'Règle de prix appliquée', targetId: null, targetName: `${changes.length} article(s)`, details: 'Marge 35 % / 20 % / 17 % (min. 3 000 FCFA), reconditionné +25 %, transport 17,80 €/kg, frais de service 2 000 FCFA par commande' });
});
console.log(`\n✓ ${changes.length} prix mis à jour.`);
