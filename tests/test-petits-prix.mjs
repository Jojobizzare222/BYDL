// « Petits prix » (10/11/2026) : algorithme qui met en avant les articles les plus abordables (public/js/affordable.js).
// Lancer : zsh tests/run-test.sh test-petits-prix.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const A = require('../public/js/affordable.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const FR = { enabled: true, eurPerKg: 15, minKg: 1, perArticle: true };

const P = (id, category, price, extra = {}) => ({ id, category, price, name: id, stock: 5, ...extra });
const list = [
  P('cable', 'Accessoires', 15000), P('coque', 'Accessoires', 45000), P('chargeur', 'Accessoires', 25000), P('chargeur-promo', 'Accessoires', 25000, { oldPrice: 32000 }),
  P('mac-cher', 'Ordinateurs', 1500000), P('mac', 'Ordinateurs', 600000), P('mac-mini', 'Ordinateurs', 450000),
  P('iphone', 'Téléphones', 600000), P('iphone-recond', 'Téléphones', 320000, { condition: 'reconditionné', refurb: { grade: 'parfait', newPriceEur: 719 } }),
  P('iphone-mal-note', 'Téléphones', 320000, { rating: { avg: 2.1, count: 5 } }), P('epuise', 'Téléphones', 100000, { stock: 0 }),
];
const r = A.rank(list, FR);

ok(A.deliveredPrice(P('x', 'Accessoires', 15000), FR) === 15000 + Math.round(15 * 655.957), 'prix livré = prix + transport (1 kg minimum à 15 €/kg)');
ok(A.deliveredPrice({ id: 'y', price: 10000, weightKg: 0.2 }, { eurPerKg: 13.9, minKg: 0 }) === 10000 + Math.round(0.2 * 13.9 * 655.957), 'prix livré au prorata : 200 g à 13,90 €/kg');
ok(A.deliveredPrice(P('x', 'Audio', 15000, { weightKg: 2.5 }), FR) === 15000 + Math.round(2.5 * 15 * 655.957), 'article lourd : transport selon son poids');
ok(!r.has('epuise'), 'article épuisé : jamais mis en avant');
ok(r.get('cable').rel === 1 && r.get('coque').rel === 0, 'dans son rayon : le moins cher = 1, le plus cher = 0');
ok(r.get('mac-mini').rel === 1 && r.get('mac-mini').score < r.get('cable').score, 'un ordinateur n\'est pas comparé à un câble (rayon), mais le petit budget compte aussi');
ok(r.get('chargeur-promo').score > r.get('chargeur').score, 'même prix : l\'article en promotion passe devant');
ok(r.get('iphone-recond').sav > 0.9 && r.get('iphone-recond').score > r.get('iphone').score, 'reconditionné bien moins cher que le neuf en France : mis en avant');
ok(r.get('iphone-mal-note').score < r.get('iphone-recond').score, 'mauvaises notes des clients (2,1/5) : note réduite');
ok(r.get('mac-cher').score < 0.1 && !r.get('mac-cher').petitPrix, 'article très cher : en dernier, jamais « Petit prix »');

const pick = A.pick(list, r, 12, { perCategory: 2 });
const perCat = pick.reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
ok(Math.max(...Object.values(perCat)) <= 2 && Object.keys(perCat).length === 3, 'sélection de l\'accueil : au plus 2 articles par rayon, tous les rayons représentés');
const fam = A.pick([P('hp-bleu', 'TV', 70000), P('hp-orange', 'TV', 70000)], A.rank([P('hp-bleu', 'TV', 70000), P('hp-orange', 'TV', 70000)], FR), 12, { familyKey: () => 'homepod' });
ok(fam.length === 1, 'couleurs d\'un même modèle : un seul dans la sélection');

// Catalogue réel de départ
const all = require('../data/products.json').filter((p) => p.active !== false && !p.pending);
const rr = A.rank(all, FR);
const top = A.pick(all, rr, 12, { perCategory: 2 });
const share = [...rr.values()].filter((v) => v.petitPrix).length / rr.size;
ok(top.length === 12 && top[0].category === 'Accessoires', `catalogue : 12 articles mis en avant, en tête « ${top[0].name} »`);
ok(share > 0.1 && share <= 0.25, `étiquette « Petit prix » sur ${Math.round(share * 100)} % des articles (rare, donc parlante)`);
const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
ok(median(top.map((p) => p.price)) < median(all.map((p) => p.price)), 'les articles mis en avant sont nettement moins chers que la moyenne du catalogue');

console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
