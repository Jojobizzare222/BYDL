// Remise à zéro de l'ACTIVITÉ de la boutique (décision Joseph 10/11/2026, avant l'ouverture) :
//   node scripts/remise-a-zero.js --confirmer        (boutique ARRÊTÉE ; sauvegarde complète faite juste avant)
// Efface : commandes, paiements, clients (+ leurs pièces d'identité), factures / reçus / avoirs, colis, messagerie,
// journal, écritures Finances, mouvements de stock, avis, abonnements aux notifications, sessions des clients.
// Remet les numéros à zéro (CMD-10001, FA-…-00001, RC, AV, colis KM, bons BC). Les ventes de test sont retirées du
// stock (le stock revient à son niveau d'avant). GARDE : catalogue et photos, réglages, mot de passe admin, équipe, points relais.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

if (!process.argv.includes('--confirmer')) {
  console.log('Rien n\'a été effacé. Arrêtez la boutique, puis relancez avec : node scripts/remise-a-zero.js --confirmer');
  process.exit(1);
}
const store = require('../src/store');
const { db, products, settings } = store;

// 1) Ventes de test retirées du stock (inverse des mouvements liés aux commandes)
const back = new Map();
for (const { data } of db.prepare('SELECT data FROM stock_moves').all()) {
  const m = JSON.parse(data);
  if (['sale', 'cancel', 'return'].includes(m.reason)) back.set(m.productId, (back.get(m.productId) || 0) - m.qty);
}
for (const [id, delta] of back) {
  const p = products.get(id);
  if (p && Number.isInteger(p.stock) && delta) products.update(id, { stock: Math.max(0, p.stock + delta) });
}

// 2) Activité effacée
const TABLES = ['orders', 'payments', 'customers', 'customer_sessions', 'documents', 'parcels', 'conversations', 'activity',
  'ledger', 'stock_moves', 'reviews', 'push_subs', 'sso_used', 'purchases', 'imports', 'shipments', 'trends', 'searches'];
const counts = {};
db.exec('BEGIN');
for (const t of TABLES) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t);
  if (!exists) continue;
  counts[t] = db.prepare(`SELECT count(*) c FROM ${t}`).get().c;
  db.exec(`DELETE FROM ${t}`);
}
const seqs = db.prepare("DELETE FROM settings WHERE key LIKE 'seq:%'").run().changes;
db.exec('COMMIT');

// 3) Pièces d'identité (fichiers) : plus aucun client
const ID_DIR = process.env.ID_DIR || path.join(__dirname, '..', 'data', 'identity');
let files = 0;
if (fs.existsSync(ID_DIR)) for (const f of fs.readdirSync(ID_DIR)) { fs.rmSync(path.join(ID_DIR, f), { force: true }); files++; }

db.exec('VACUUM');
console.log('Remise à zéro faite :');
for (const [t, n] of Object.entries(counts)) if (n) console.log(`  ${t.padEnd(18)} ${n} effacé(s)`);
console.log(`  numérotation        ${seqs} compteur(s) remis à zéro`);
console.log(`  pièces d'identité   ${files} fichier(s) effacé(s)`);
console.log(`  stock               ${back.size} produit(s) remis au niveau d'avant les ventes de test`);
console.log(`Gardé : ${products.all().length} produits, réglages, mot de passe admin, équipe.`);
void settings;
