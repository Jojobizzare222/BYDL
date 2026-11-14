// Téléphones neufs (et reconditionnés Samsung) relevés le 12/11/2026 sur les boutiques OFFICIELLES en France
// (demande Joseph : « oui, les téléphones »). Apple Store (pages d'achat), Samsung et Xiaomi (listes schema.org publiées par
// les sites eux-mêmes ; lues comme un visiteur, aucune protection contournée). Prix « à partir de » = version de base.
// Prix Zado = prix en France × 655,957 × 1,12 (même règle que les reconditionnés), arrondi à 5 000 FCFA : ESTIMATIONS
// à confirmer par Joseph au moment de l'achat. Écarté : iPhone Air (eSIM seulement, pas de carte SIM physique),
// iPhone 16 (plus cher que l'iPhone 17e), modèles pliants Fold (> 2 000 €).
//   node scripts/telephones-2026-11.js   → écrit data/telephones-2026-11.json (importé par scripts/importer-catalogue.js)
const fs = require('fs');
const path = require('path');
const EUR = 655.957, DATE = '2026-11-12';
const zado = (eur) => Math.round((eur * EUR * 1.12) / 5000) * 5000;

// [id, nom, marque, magasin, prix €, adresse, stockage (null = version de base), points forts, reconditionné ?]
const SIM_APPLE = 'Double SIM : carte nano-SIM + eSIM';
const T = [
  ['t001', 'Apple iPhone 17e 256 Go', 'Apple', 'Apple Store', 869, 'https://www.apple.com/fr/shop/buy-iphone/iphone-17e', '256 Go', ['Le plus abordable des iPhone neufs', SIM_APPLE]],
  ['t002', 'Apple iPhone 17 256 Go', 'Apple', 'Apple Store', 1119, 'https://www.apple.com/fr/shop/buy-iphone/iphone-17', '256 Go', [SIM_APPLE]],
  ['t003', 'Apple iPhone 18 Pro 256 Go', 'Apple', 'Apple Store', 1479, 'https://www.apple.com/fr/shop/buy-iphone/iphone-18-pro', '256 Go', [SIM_APPLE]],
  ['t004', 'Apple iPhone 18 Pro Max 256 Go', 'Apple', 'Apple Store', 1629, 'https://www.apple.com/fr/shop/buy-iphone/iphone-18-pro', '256 Go', ['Le plus grand écran des iPhone', SIM_APPLE]],
  ['t010', 'Samsung Galaxy A17 5G 128 Go', 'Samsung', 'Samsung', 299, 'https://www.samsung.com/fr/smartphones/galaxy-a/galaxy-a17-5g-blue-128gb-sm-a176bzbaeub/', '128 Go', ['Compatible 5G']],
  ['t011', 'Samsung Galaxy A18 128 Go', 'Samsung', 'Samsung', 279, 'https://www.samsung.com/fr/smartphones/galaxy-a/galaxy-a18-black-128gb-galaxy-a18-sm-a185fzkdeub/', '128 Go', ['Le Galaxy le plus abordable']],
  ['t012', 'Samsung Galaxy A27 5G 128 Go', 'Samsung', 'Samsung', 379, 'https://www.samsung.com/fr/smartphones/galaxy-a/galaxy-a27-5g-light-pink-128gb-sm-a276blibeub/', '128 Go', ['Compatible 5G']],
  ['t013', 'Samsung Galaxy A37 5G 256 Go', 'Samsung', 'Samsung', 589, 'https://www.samsung.com/fr/smartphones/galaxy-a/galaxy-a37-5g-awesome-charcoal-256gb-sm-a376bzageub/', '256 Go', ['Capteur principal 50 Mpx stabilisé', 'Dos en verre']],
  ['t014', 'Samsung Galaxy A57 5G 256 Go', 'Samsung', 'Samsung', 659, 'https://www.samsung.com/fr/smartphones/galaxy-a/galaxy-a57-5g-awesome-navy-256gb-sm-a576bdbdeub/', '256 Go', ['Capteur principal 50 Mpx stabilisé', 'Le Galaxy A le plus fin']],
  ['t015', 'Samsung Galaxy S26 FE 128 Go', 'Samsung', 'Samsung', 799, 'https://www.samsung.com/fr/smartphones/galaxy-s/galaxy-s26-fe-pistachio-128gb-sm-s741blgdeub/', '128 Go', []],
  ['t016', 'Samsung Galaxy S25', 'Samsung', 'Samsung', 902.05, 'https://www.samsung.com/fr/smartphones/galaxy-s25/buy/?modelCode=SM-S931BDBDEUB', null, []],
  ['t017', 'Samsung Galaxy S26', 'Samsung', 'Samsung', 1119, 'https://www.samsung.com/fr/smartphones/galaxy-s26/buy/?modelCode=SM-S942BZVGEUB', null, []],
  ['t018', 'Samsung Galaxy S26 Ultra', 'Samsung', 'Samsung', 1569, 'https://www.samsung.com/fr/smartphones/galaxy-s26-ultra/buy/?modelCode=SM-S948BZVDEUB', null, ['Le haut de gamme de Samsung']],
  ['t019', 'Samsung Galaxy Z Flip8', 'Samsung', 'Samsung', 1299, 'https://www.samsung.com/fr/smartphones/galaxy-z-flip8/buy/?modelCode=SM-F776BLIGEUB', null, ['Smartphone pliable à clapet']],
  ['t020', 'Samsung Galaxy S26 256 Go reconditionné par Samsung', 'Samsung', 'Samsung', 949, 'https://www.samsung.com/fr/smartphones/galaxy-s/galaxy-s26-black-256gb-certified-re-newed-sm5s942bzkgrfr/', '256 Go', ['Reconditionné Premium par Samsung'], { newPriceEur: 1119 }],
  ['t021', 'Samsung Galaxy S25 Ultra 256 Go reconditionné par Samsung', 'Samsung', 'Samsung', 1109, 'https://www.samsung.com/fr/smartphones/galaxy-s/galaxy-s25-ultra-titanium-jetblack-256gb-certified-re-newed-sm5s938bakdeuh/', '256 Go', ['Reconditionné Premium par Samsung'], { newPriceEur: null }],
  ['t030', 'Xiaomi Redmi A7 Pro', 'Xiaomi', 'Xiaomi', 129, 'https://www.mi.com/fr/product/redmi-a7-pro/', null, ['Petit prix']],
  ['t031', 'Xiaomi Redmi 17', 'Xiaomi', 'Xiaomi', 199, 'https://www.mi.com/fr/product/redmi-17/', null, []],
  ['t032', 'Xiaomi Redmi 17C 5G', 'Xiaomi', 'Xiaomi', 203, 'https://www.mi.com/fr/product/redmi-17c-5g/', null, ['Compatible 5G']],
  ['t033', 'Xiaomi Redmi Note 17', 'Xiaomi', 'Xiaomi', 253, 'https://www.mi.com/fr/product/redmi-note-17/', null, []],
  ['t034', 'Xiaomi Redmi Note 17 5G', 'Xiaomi', 'Xiaomi', 353, 'https://www.mi.com/fr/product/redmi-note-17-5g/', null, ['Compatible 5G']],
  ['t035', 'Xiaomi Redmi Note 17 Pro 5G', 'Xiaomi', 'Xiaomi', 453, 'https://www.mi.com/fr/product/redmi-note-17-pro-5g/', null, ['Compatible 5G']],
  ['t036', 'Xiaomi Redmi Note 17 Pro Max 5G', 'Xiaomi', 'Xiaomi', 603, 'https://www.mi.com/fr/product/redmi-note-17-pro-max-5g/', null, ['Compatible 5G']],
  ['t037', 'Xiaomi POCO X8 Pro', 'Xiaomi', 'Xiaomi', 369.9, 'https://www.mi.com/fr/product/poco-x8-pro/', null, []],
  ['t038', 'Xiaomi 17T', 'Xiaomi', 'Xiaomi', 653, 'https://www.mi.com/fr/product/xiaomi-17t/', null, []],
];

// Poids de l'APPAREIL (g) lus le 14/11/2026 sur les fiches techniques officielles (apple.com/fr/<modèle>/specs,
// pages produit samsung.com/fr, mi.com/fr/product/<modèle>/specs) ; poids facturé = appareil + emballage estimé (PACK_G)
// (demande Joseph 14/11/2026 : transport au prorata du poids).
const GRAMS = { t001: 170, t002: 177, t003: 211, t004: 249, t010: 192, t011: 196, t012: 200, t013: 196, t014: 179, t015: 193, t016: 162,
  t017: 167, t018: 214, t019: 180, t020: 167, t021: 218, t030: 208, t031: 232, t032: 211, t033: 224, t034: 225, t035: 223, t036: 225.1,
  t037: 201.47, t038: 200 };
const PACK_G = 150; // boîte, câble, notice : estimation
const weightOf = (id) => (GRAMS[id] ? Math.round((GRAMS[id] + PACK_G) / 10) / 100 : 0.5);

const out = T.map(([id, name, brand, store, eur, url, storage, hl, refurb]) => {
  const src = Math.round(eur * EUR);
  const p = {
    id, name, brand, universe: 'Électronique', category: 'Téléphones', price: zado(eur), oldPrice: null, stock: null,
    description: `${name}${storage ? '' : ' (version de base)'}. ${refurb ? 'Reconditionné et garanti par Samsung, ' : 'Neuf, '}acheté en France chez ${store} (boutique officielle de la marque) et acheminé par avion jusqu'à Pointe-Noire. Débloqué tous opérateurs.`,
    condition: refurb ? 'reconditionné' : 'neuf', provenance: 'France', sourceSupplier: store, sourcePrice: src, costPrice: src, weightKg: weightOf(id),
    weightSource: GRAMS[id] ? `Fiche technique ${brand} : appareil ${String(GRAMS[id]).replace('.', ',')} g + emballage estimé ${PACK_G} g` : 'Estimé',
    highlights: [storage ? `Stockage : ${storage}` : 'Version de base (stockage précisé à la confirmation)', 'Débloqué tous opérateurs', ...hl],
    specs: [{ label: 'Stockage', value: storage || 'Version de base' }, ...(GRAMS[id] ? [{ label: 'Poids', value: `${String(Math.round(GRAMS[id])).replace('.', ',')} g` }] : []), { label: 'Acheté chez', value: `${store} (France)` }],
    priceRefs: [{ store, priceEur: eur, url, date: DATE, status: 'ok', from: !storage, auto: false, watch: true }],
    priceRefsPublic: false,
  };
  if (refurb) p.refurb = { grade: 'parfait', battery: null, warrantyMonths: 6, newPriceEur: refurb.newPriceEur };
  return p;
});
const file = path.join(__dirname, '..', 'data', 'telephones-2026-11.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log(`${out.length} téléphones → ${path.relative(process.cwd(), file)}`);
for (const p of out) console.log(`  ${p.id}  ${String(p.price).padStart(9)} FCFA  ${p.name}`);
