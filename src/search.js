// Recherche de la boutique, tolérante (audit du 17/10/2026 : « iphne », « chemises », « baskets » ne trouvaient rien) :
//  - accents, majuscules et ponctuation ignorés ; pluriels ramenés au singulier (chemises → chemise) ;
//  - synonymes courants au Congo (portable, tél, ordi, baskets, jogging…) ;
//  - petites fautes de frappe corrigées (1 lettre de différence pour un mot court, 2 pour un mot long) ;
//  - les noms de rayons comptent (« chaussures » trouve le rayon Chaussures) ;
//  - classement : nom > marque / rayon > caractéristiques > description ; si aucun produit ne contient TOUS les mots,
//    on propose ceux qui en contiennent le plus (resultat « partiel »).
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stem = (w) => (w.length > 4 && /eaux$/.test(w) ? w.slice(0, -1) : w.length > 3 && /[sx]$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
const words = (s) => norm(s).split(' ').filter(Boolean).map(stem);

// Synonymes : chaque groupe = mots qui veulent dire la même chose pour le client
const GROUPS = [
  ['telephone', 'tel', 'smartphone', 'portable', 'mobile', 'iphone', 'android', 'galaxy'],
  ['ordinateur', 'ordi', 'pc', 'laptop', 'macbook', 'notebook', 'portable'],
  ['tablette', 'ipad', 'tab'],
  ['montre', 'watch', 'smartwatch', 'connectee', 'connecte'],
  ['ecouteur', 'airpod', 'oreillette', 'casque', 'audio', 'bluetooth', 'enceinte', 'baffle'],
  ['chargeur', 'cable', 'adaptateur', 'prise', 'powerbank', 'batterie'],
  ['television', 'tele', 'tv', 'ecran'],
  ['console', 'jeu', 'playstation', 'ps5', 'xbox', 'nintendo', 'manette'],
  ['chaussure', 'basket', 'sneaker', 'tennis', 'soulier', 'sandale', 'mocassin'],
  ['tshirt', 't shirt', 'tee', 'maillot', 'polo'],
  ['jogging', 'survetement', 'bas'],
  ['pantalon', 'jean', 'chino'],
  ['chemise', 'boubou', 'wax', 'pagne'],
  ['robe', 'jupe', 'femme'],
  ['coque', 'etui', 'protection'],
];
const SYN = new Map();
for (const g of GROUPS) for (const w of g.map(stem)) SYN.set(w, [...new Set([...(SYN.get(w) || []), ...g.map(stem)])]);

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
const tolerance = (w) => (w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0);

// Fiche « indexée » d'un produit (champs pondérés)
function fields(p) {
  return [
    [3, words(p.name)],
    [2, words(`${p.brand || ''} ${p.category || ''} ${p.universe || ''}`)],
    [1.2, words(`${(p.specs || []).map((s) => s.value).join(' ')} ${(p.options || []).flatMap((o) => o.values).join(' ')}`)],
    [0.6, words(p.description)],
  ];
}

/** Note d'un mot de la recherche pour un produit (0 = absent) : meilleure correspondance de CHAQUE champ, additionnées
 *  (un iPhone, trouvé par son nom ET son rayon « Téléphones », passe devant une coque qui ne cite iPhone que dans son nom).
 *  corrected = mot du produit si une faute de frappe a été corrigée. */
function wordScore(qw, f) {
  const variants = SYN.get(qw) || [qw];
  const tol = tolerance(qw);
  let total = 0, corrected = null;
  for (const [weight, toks] of f) {
    let best = 0;
    for (const t of toks) {
      if (t === qw || (qw.length >= 3 && t.startsWith(qw))) { best = Math.max(best, 1.0); continue; }
      // synonyme : mot exact, ou début de mot pour les synonymes d'au moins 4 lettres (« tel » ne doit pas trouver « télévision »)
      if (variants.some((v) => v !== qw && (t === v || (v.length >= 4 && t.startsWith(v))))) { best = Math.max(best, 0.8); continue; }
      if (weight >= 2 && qw.length >= 3 && t.length >= 3 && t.includes(qw)) { best = Math.max(best, 0.7); continue; }
      if (tol && weight >= 2 && best < 0.6 && lev(qw, t, tol) <= tol) { best = 0.6; corrected = t; }
    }
    total += best * weight;
  }
  return { score: total, corrected };
}

/** Recherche : renvoie { list (produits classés), partial, didYouMean } */
function search(list, q, retry = true) {
  const qws = words(q);
  if (!qws.length) return { list, partial: false, didYouMean: null };
  const scored = [];
  const fixes = new Map();
  for (const p of list) {
    const f = fields(p);
    let total = 0, matched = 0;
    for (const w of qws) {
      const r = wordScore(w, f);
      if (r.score) { matched++; total += r.score; if (r.corrected) fixes.set(w, r.corrected); }
    }
    if (matched) scored.push({ p, total, matched });
  }
  const full = scored.filter((x) => x.matched === qws.length);
  const pick = full.length ? full : scored.filter((x) => x.matched >= Math.max(1, qws.length - 1));
  pick.sort((a, b) => b.matched - a.matched || b.total - a.total || (a.p.price || 0) - (b.p.price || 0));
  let didYouMean = fixes.size ? norm(q).split(' ').map((w) => fixes.get(stem(w)) || w).join(' ') : null;
  if (didYouMean === norm(q)) didYouMean = null;
  // Faute corrigée : on cherche directement le mot corrigé (« iphne » → résultats de « iphone », classés comme tels)
  if (didYouMean && retry) {
    const again = search(list, didYouMean, false);
    if (again.list.length) return { ...again, didYouMean };
  }
  return { list: pick.map((x) => x.p), partial: !full.length && pick.length > 0, didYouMean };
}

module.exports = { search, norm, words };
