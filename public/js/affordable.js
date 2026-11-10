// « Petits prix » (demande Joseph 10/11/2026 : « mettre en avant les articles aux prix les plus abordables »).
// Algorithme sans serveur ni IA, calculé dans le navigateur à partir du catalogue (aussi utilisé par les tests Node).
//
// Pour chaque article EN STOCK, une note d'accessibilité entre 0 et 1 :
//   1) prix LIVRÉ = prix de l'article + transport France → Pointe-Noire (ce que le client paie vraiment) ;
//   2) « dans son rayon » (45 %) : rang de ce prix livré parmi les articles du même rayon (le moins cher = 1,
//      le plus cher = 0) : un câble n'est pas comparé à un ordinateur ;
//   3) « petit budget » (30 %) : prix livré sur une échelle logarithmique de 15 000 FCFA (1) à 500 000 FCFA (0) ;
//   4) « bonne affaire » (25 %) : remise en cours, ou économie d'un reconditionné par rapport au neuf en France
//      (35 % d'économie ou plus = note maximale) ;
//   5) garde-fous : article épuisé = exclu ; note des clients faible (moins de 3/5 avec au moins 3 avis) ou
//      reconditionné en « état correct » = note réduite (un prix bas ne doit pas mettre en avant un mauvais produit).
// « Petit prix » (étiquette sur la carte) = parmi les 20 % les mieux notés du catalogue ET dans la moitié la moins
// chère de son rayon. La sélection de l'accueil limite à 2 articles par rayon et 1 par modèle (couleurs regroupées).
(function (root) {
  const EUR_FCFA = 655.957;
  const LOG_HI = Math.log(500000), LOG_LO = Math.log(15000);
  const clamp = (x) => Math.max(0, Math.min(1, x));

  function deliveredPrice(p, fr = {}) {
    if (fr.enabled === false) return p.price;
    const w = Number(p.weightKg) > 0 ? Number(p.weightKg) : 0;
    const kg = fr.perArticle === false ? w : Math.max(fr.minKg ?? 1, w);
    return p.price + Math.round(kg * (fr.eurPerKg ?? 15) * EUR_FCFA);
  }
  function saving(p) {
    if (p.oldPrice && p.oldPrice > p.price) return 1 - p.price / p.oldPrice;
    const neuf = p.refurb?.newPriceEur ? p.refurb.newPriceEur * EUR_FCFA : 0;
    if (neuf > p.price && p.condition && p.condition !== 'neuf') return 1 - p.price / neuf;
    return 0;
  }
  const available = (p) => p.stock == null || p.stock > 0;

  /** Notes de tout le catalogue : Map id → { score, rel, abs, sav, delivered, petitPrix }. */
  function rank(list, fr = {}) {
    const out = new Map();
    const items = list.filter(available).map((p) => ({ p, d: deliveredPrice(p, fr) }));
    const byCat = new Map();
    for (const x of items) { if (!byCat.has(x.p.category)) byCat.set(x.p.category, []); byCat.get(x.p.category).push(x.d); }
    for (const prices of byCat.values()) prices.sort((a, b) => a - b);
    for (const { p, d } of items) {
      const prices = byCat.get(p.category);
      // rang moyen en cas d'égalité ; un rayon d'un seul article = 0,5
      const below = prices.filter((x) => x < d).length, same = prices.filter((x) => x === d).length;
      const rel = prices.length > 1 ? 1 - (below + (same - 1) / 2) / (prices.length - 1) : 0.5;
      const abs = clamp((LOG_HI - Math.log(Math.max(d, 1))) / (LOG_HI - LOG_LO));
      const sav = clamp(saving(p) / 0.35);
      let score = 0.45 * rel + 0.30 * abs + 0.25 * sav;
      if (p.rating && p.rating.count >= 3 && p.rating.avg < 3) score *= 0.7;
      if (p.refurb?.grade === 'correct') score *= 0.9;
      out.set(p.id, { score: Math.round(score * 1000) / 1000, rel, abs, sav, delivered: d, petitPrix: false });
    }
    const sorted = [...out.values()].map((v) => v.score).sort((a, b) => b - a);
    const cut = sorted[Math.max(0, Math.ceil(sorted.length * 0.2) - 1)] ?? 1;
    for (const v of out.values()) v.petitPrix = v.score >= cut && v.rel >= 0.5;
    return out;
  }

  /** Sélection variée : les mieux notés, au plus `perCategory` par rayon et 1 par modèle. */
  function pick(list, ranks, n = 12, { perCategory = 2, familyKey = (p) => p.id } = {}) {
    const cats = new Map(), fams = new Set(), res = [];
    for (const p of list.filter((x) => ranks.has(x.id)).sort((a, b) => ranks.get(b.id).score - ranks.get(a.id).score)) {
      const fk = familyKey(p) || p.id;
      if (fams.has(fk) || (cats.get(p.category) || 0) >= perCategory) continue;
      fams.add(fk); cats.set(p.category, (cats.get(p.category) || 0) + 1); res.push(p);
      if (res.length >= n) break;
    }
    return res;
  }

  const api = { rank, pick, deliveredPrice, saving };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.kamwaAfford = api;
})(typeof window !== 'undefined' ? window : globalThis);
