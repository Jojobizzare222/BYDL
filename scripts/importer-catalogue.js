// Remettre en catalogue des articles déjà relevés (demande Joseph 12/11/2026 : « renseigne les produits tech, informatique,
// téléphonie et jeux vidéo, j'irai moi-même sur le terrain pour les photos »).
//   node scripts/importer-catalogue.js              → aperçu : ce qui serait ajouté, rien n'est écrit
//   node scripts/importer-catalogue.js --confirmer  → ajoute les articles (MASQUÉS : Joseph vérifie le prix, prend la photo, coche « Visible »)
//   … --confirmer --visible                       → ajoutés directement VISIBLES sur la boutique (demande Joseph 12/11/2026)
// 12/11/2026 (2e demande : « rajoute les autres catalogues susceptibles de vendre ») : + Jouets high-tech, TV & Maison, Beauté & bien-être.
// Sources : sélection relevée le 10/11/2026 sur Cdiscount et Boulanger (data/selection-noel-2026.json, prix réels, ≤ 30 €)
// + iPhone / MacBook / AirPods reconditionnés relevés sur Back Market le 22/10/2026 (r001-r008 de data/products.json).
// Les Apple NEUFS de products.json ne sont PAS repris : prix de simulation et modèles qui ne se vendent plus neufs.
// Aucune photo (règle : jamais de photo copiée d'un site). Stock vide = « sur commande ». Un article déjà présent
// (même identifiant ou même nom) n'est jamais ajouté deux fois ; un article supprimé dans Zado Pro peut revenir si on relance.
// Fonctionne boutique ouverte (SQLite en WAL) : les articles apparaissent dans Zado Pro après rechargement de la page.
const path = require('path');
const crypto = require('crypto');
// ZADO_APP = dossier de la boutique (pour lancer ce fichier depuis un autre dossier, ex. /tmp sur le serveur)
const APP = process.env.ZADO_APP || path.join(__dirname, '..');
require(path.join(APP, 'node_modules', 'dotenv')).config({ path: path.join(APP, '.env') });

const RAYONS = ['Jeux vidéo & consoles', 'Accessoires', 'Composants', 'Audio', 'Montres', 'Photo & vidéo', 'Téléphones', 'Ordinateurs', 'Tablettes',
  'Jouets high-tech', 'TV & Maison', 'Beauté & bien-être'];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function candidates() {
  const noel = require(path.join(APP, 'data', 'selection-noel-2026.json')).filter((p) => RAYONS.includes(p.category));
  const refurb = require(path.join(APP, 'data', 'products.json')).filter((p) => /^r\d{3}$/.test(p.id));
  // Téléphones neufs relevés le 12/11/2026 sur les boutiques officielles (Apple Store, Samsung, Xiaomi) : scripts/telephones-2026-11.js
  const phonesFile = path.join(APP, 'data', 'telephones-2026-11.json');
  const phones = require('fs').existsSync(phonesFile) ? require(phonesFile) : [];
  return [...noel, ...refurb, ...phones];
}

function prepare(p, now, visible = false) {
  const q = JSON.parse(JSON.stringify(p));
  delete q.image; delete q.images; delete q.imageCredit; delete q.updatedAt;
  q.active = visible;          // masqué jusqu'à la vérification de Joseph (sauf --visible)
  q.stock = null;              // sur commande (rien n'a encore été acheté)
  q.createdAt = now;
  q.importedAt = now;
  q.importedFrom = /^r\d{3}$/.test(p.id) ? 'Back Market (relevé du 22/10/2026)' : /^t\d{3}$/.test(p.id) ? `${p.sourceSupplier} (boutique officielle, relevé du 12/11/2026)` : `${p.sourceSupplier || 'France'} (relevé du 10/11/2026)`;
  if (q.condition && q.condition !== 'neuf') q.refurb = { grade: null, battery: null, newPriceEur: null, ...(q.refurb || {}), warrantyMonths: q.refurb?.warrantyMonths || 6 };
  return q;
}

function plan(products) {
  const have = products.all();
  const ids = new Set(have.map((p) => p.id));
  const names = new Set(have.map((p) => norm(p.name)));
  const add = [], skip = [];
  for (const p of candidates()) (ids.has(p.id) || names.has(norm(p.name)) ? skip : add).push(p);
  return { add, skip };
}

function run({ confirm = false, visible = false, log = console.log } = {}) {
  const store = require(path.join(APP, 'src', 'store'));
  const { products, activity } = store;
  const { add, skip } = plan(products);
  const byCat = {};
  for (const p of add) byCat[p.category] = (byCat[p.category] || 0) + 1;
  log(`Articles à ajouter : ${add.length} (déjà présents, ignorés : ${skip.length})`);
  for (const [c, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(4)}  ${c}`);
  if (!confirm) { log('\nAperçu seulement : rien n\'a été ajouté. Pour ajouter : node scripts/importer-catalogue.js --confirmer'); return { added: 0, add, skip }; }
  const now = new Date().toISOString();
  store.transaction(() => {
    for (const p of add) products.insert(prepare(p, now, visible));
    if (add.length) activity.insert({ id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: now, userId: 'auto', userName: 'Zado (import)', role: 'admin', action: 'Catalogue importé', targetId: null, targetName: `${add.length} article(s) ${visible ? 'visible(s)' : 'masqué(s)'}`, details: Object.entries(byCat).map(([c, n]) => `${c} : ${n}`).join(' · ') });
  });
  log(visible ? `\n✓ ${add.length} article(s) ajouté(s), VISIBLES sur la boutique (sans photo : icône du rayon).` : `\n✓ ${add.length} article(s) ajouté(s), MASQUÉS. Zado Pro → Produits (ou Base de données) : vérifier le prix, ajouter la photo, cocher « Visible ».`);
  return { added: add.length, add, skip };
}

if (require.main === module) run({ confirm: process.argv.includes('--confirmer'), visible: process.argv.includes('--visible') });
module.exports = { run, candidates, RAYONS };
