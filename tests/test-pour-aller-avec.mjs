// « Pour aller avec » (12/11/2026) : compléments proposés sur la fiche et dans le panier (public/js/basket.js)
// + articles achetés ensemble (/api/products/pairs). Lancer : zsh tests/run-test.sh test-pour-aller-avec.mjs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const B = require('../public/js/basket.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };

const P = (id, name, price, extra = {}) => ({ id, name, price, category: 'Jeux vidéo & consoles', stock: null, ...extra });
const cat = [
  P('ps5', 'Sony PS5 Slim — console', 300000),
  P('gta', 'GTA V - Jeu PS5', 12500), P('ac', "Assassin's Creed Mirage - Jeu PS5", 13000),
  P('mario', 'Mario Kart • Jeu Nintendo Switch', 21500), P('joycon', 'Konix — paire de manettes Joy-Con pour Switch 2', 4500),
  P('dualsense', 'Sony — manette DualSense PS5, blanche', 22000), P('ps4pad', 'Subsonic — manette sans fil PS4 / PC', 20000),
  P('padpc', 'Logitech F310 — manette PC filaire', 14500),
  P('casque', 'Turtle Beach Recon 50P — casque gaming PS4 / PS5', 12000), P('casque-multi', 'Subsonic Astra — casque gaming multiplateforme', 11000),
  P('qi', 'Chargeur sans fil universel 15 W Qi', 6500, { category: 'Accessoires' }), P('borne', 'Nacon — borne de recharge pour manette PS5', 11000),
  P('epuise', 'Sony — manette DualSense PS5, noire', 22000, { stock: 0 }),
  P('souris', 'Logitech G203 — souris gamer filaire, noire', 19500, { category: 'Accessoires' }),
  P('clavier', 'Clavier sans fil AZERTY, noir', 10500, { category: 'Accessoires' }), P('tapis', 'Tapis de souris gamer LED', 8000, { category: 'Accessoires' }),
  P('cam', 'Mini caméra sport étanche Full HD', 15000, { category: 'Photo & vidéo' }), P('sd', 'Carte micro SD 32 Go', 9000, { category: 'Audio' }),
  P('trepied', 'Mini trépied flexible 3 en 1', 14500, { category: 'Photo & vidéo' }),
  P('support-tel', 'Support de table smartphone / tablette', 7500, { category: 'Accessoires' }),
  P('webcam', 'Webcam Full HD 1080p - Micro antibruit, USB', 9500, { category: 'Accessoires' }),
  P('radio', 'Radio-réveil FM', 18500, { category: 'Audio' }),
];
const ids = (l) => l.map((p) => p.id);
const byId = (id) => cat.find((p) => p.id === id);

// Types déduits du nom
ok(B.typeOf(byId('gta')) === 'jeu' && B.typeOf(byId('ps5')) === 'console', 'type : « Jeu PS5 » = jeu, la console = console');
ok(B.typeOf(byId('borne')) === 'chargeur', 'type : « borne de recharge pour manette » = chargeur (pas une manette)');
ok(B.typeOf(byId('support-tel')) === 'support', 'type : « support smartphone » = support (pas un téléphone)');
ok(B.typeOf(byId('webcam')) === 'webcam' && B.typeOf(byId('casque')) === 'casque-gamer', 'type : webcam « avec micro » = webcam ; casque gaming');
ok(B.typeOf(byId('sd')) === 'carte-sd' && B.typeOf({ name: 'Souris sans fil rechargeable' }) === 'souris', 'type : carte micro SD ; « rechargeable » ne fait pas un chargeur');

// Compléments
const forPs5 = B.suggest([byId('ps5')], cat, { limit: 6 });
ok(ids(forPs5).includes('gta') && ids(forPs5).includes('dualsense'), `console PS5 → jeux et manette PS5 : ${ids(forPs5).join(', ')}`);
ok(!ids(forPs5).some((x) => ['mario', 'joycon', 'ps4pad', 'padpc'].includes(x)), 'console PS5 : jamais un jeu Switch, une manette PS4 ou une manette PC');
ok(!ids(forPs5).includes('qi') && ids(B.suggest([byId('dualsense')], cat, { limit: 6 })).includes('borne'), 'chargeur pour la manette : la borne PS5, pas un chargeur de téléphone');
ok(!ids(forPs5).includes('epuise'), 'article épuisé : jamais proposé');
ok(ids(B.suggest([byId('mario')], cat)).includes('joycon') && !ids(B.suggest([byId('mario')], cat)).includes('gta'), 'jeu Switch → manettes Joy-Con, pas un jeu PS5');
ok(ids(B.suggest([byId('ps5')], cat, { limit: 8 })).includes('casque-multi'), 'casque « multiplateforme » : proposé avec n\'importe quelle console');
const forCam = ids(B.suggest([byId('cam')], cat));
ok(forCam[0] === 'sd' && forCam.includes('trepied'), `caméra → carte mémoire d'abord, puis trépied : ${forCam.join(', ')}`);
ok(ids(B.suggest([byId('souris')], cat)).slice(0, 2).join() === 'clavier,tapis', 'souris → clavier puis tapis de souris');
ok(B.suggest([byId('radio')], cat).length === 0, 'aucun complément dans le catalogue : rien n\'est proposé (pas de remplissage au hasard)');

// Panier : plusieurs articles, rien en double, variété, couleurs regroupées
const inCart = new Set(['gta']);
const forCart = B.suggest([byId('ps5'), byId('gta')], cat, { exclude: inCart, limit: 4 });
ok(!ids(forCart).includes('gta') && !ids(forCart).includes('ps5'), 'panier : jamais un article déjà dans le panier');
const types = forCart.map(B.typeOf);
ok(new Set(types).size === types.length, `panier : un article par type (variété) : ${types.join(', ')}`);
const fam = (p) => (/dualsense/i.test(p.name) ? 'dualsense' : null);
const withColors = B.suggest([byId('ps5')], [...cat, P('dualsense-rose', 'Sony — manette DualSense PS5, rose', 22000)], { familyKey: fam, limit: 8 });
ok(withColors.filter((p) => fam(p)).length === 1, 'couleurs du même modèle : une seule carte proposée');

// Achats groupés réels : passent avant les règles, même sans règle
const pairs = { radio: { tapis: 3 } };
ok(ids(B.suggest([byId('radio')], cat, { pairs }))[0] === 'tapis', 'achetés ensemble par 3 clients : proposé en premier, même sans règle');
ok(!ids(B.suggest([byId('radio')], cat, { pairs: { radio: { tapis: 1 } } })).includes('tapis'), 'acheté ensemble une seule fois : ignoré');

// Serveur : /api/products/pairs à partir des commandes réglées (chiffres seulement, au moins 2 commandes)
const API = 'http://localhost:3999/api';
const pub = await (await fetch(API + '/products')).json();
const [a, b, c] = pub.slice(0, 3).map((p) => p.id);
const dbFile = path.join(path.dirname(new URL(import.meta.url).pathname), '.run', 't-run.db');
const script = `const { orders } = require('./src/store');
const L = (...x) => x.map((productId) => ({ productId, name: productId, unitPrice: 1000, qty: 1, total: 1000 }));
orders.insert({ id: 'CMD-T1', status: 'paid', lines: L('${a}', '${b}') });
orders.insert({ id: 'CMD-T2', status: 'delivered', lines: L('${a}', '${b}', '${c}') });
orders.insert({ id: 'CMD-T3', status: 'cancelled', lines: L('${a}', '${c}') });
orders.insert({ id: 'CMD-T4', status: 'pending_payment', lines: L('${a}', '${c}') });`;
execFileSync('node', ['-e', script], { env: { ...process.env, DB_FILE: dbFile }, cwd: path.join(path.dirname(new URL(import.meta.url).pathname), '..') });
const r = await fetch(API + '/products/pairs');
const pj = await r.json();
ok(r.status === 200 && pj[a]?.[b] === 2 && pj[b]?.[a] === 2, `achetés ensemble dans 2 commandes réglées : ${JSON.stringify(pj[a] || {})}`);
ok(!pj[a]?.[c] && !pj[c], 'commande annulée ou non payée ignorée ; une seule commande commune = pas affiché');
ok(!JSON.stringify(pj).includes('CMD-') && !/customer|phone|name/i.test(JSON.stringify(pj)), 'aucune donnée de commande ni de client : seulement des chiffres');
ok(/max-age=600/.test(r.headers.get('cache-control') || ''), 'réponse mise en cache 10 minutes');

console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
