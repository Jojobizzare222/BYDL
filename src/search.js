// Recherche de la boutique, tolérante (audit du 17/10/2026 : « iphne », « téléphones » ne trouvaient rien) :
//  - accents, majuscules et ponctuation ignorés ; pluriels ramenés au singulier (chargeurs → chargeur) ;
//  - synonymes courants au Congo (portable, tél, ordi, écouteurs, télé…) ;
//  - petites fautes de frappe corrigées (1 lettre de différence pour un mot court, 2 pour un mot long) ;
//  - les noms de rayons comptent (« tablettes » trouve le rayon Tablettes) ;
//  - classement : nom > marque / rayon > caractéristiques > description ; si aucun produit ne contient TOUS les mots,
//    on propose ceux qui en contiennent le plus (resultat « partiel »).
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Pluriels : -s (sauf -ss) et -x seulement après une voyelle + u (jeux, bijoux, eaux) ; jamais « xbox » → « xbo » (16/11/2026)
const stem = (w) => (w.length > 4 && /eaux$/.test(w) ? w.slice(0, -1) : w.length > 3 && (/[^s]s$/.test(w) || /[aeo]ux$/.test(w)) && !/^\d/.test(w) ? w.slice(0, -1) : w);
const words = (s) => norm(s).split(' ').filter(Boolean).map(stem);

// Synonymes : chaque groupe = mots qui veulent dire la même chose pour le client
const GROUPS = [
  ['telephone', 'tel', 'smartphone', 'portable', 'mobile', 'iphone', 'android', 'galaxy'],
  ['ordinateur', 'ordi', 'pc', 'laptop', 'macbook', 'notebook', 'portable'],
  ['tablette', 'ipad', 'tab'],
  ['montre', 'watch', 'smartwatch', 'connectee', 'connecte'],
  ['ecouteur', 'airpod', 'oreillette', 'casque', 'audio', 'bluetooth', 'enceinte', 'baffle'],
  ['chargeur', 'cable', 'adaptateur', 'prise', 'powerbank', 'batterie'],
  ['television', 'tele', 'tv'], // « écran » : d'abord le rayon Écrans (CAT_WORDS), les téléviseurs suivent par leurs caractéristiques
  ['console', 'jeu', 'playstation', 'ps5', 'xbox', 'nintendo', 'manette'],
  ['composant', 'ssd', 'disque', 'ram', 'memoire', 'carte graphique', 'processeur'],
  ['coque', 'etui', 'protection'],
  // Mode, sport (15/11/2026)
  ['chaussure', 'basket', 'sneaker', 'soulier'],
  ['vetement', 'habit', 'habillement'],
  ['proteine', 'whey'],
];
const SYN = new Map();
for (const g of GROUPS) for (const w of g.map(stem)) SYN.set(w, [...new Set([...(SYN.get(w) || []), ...g.map(stem)])]);
// Catalogue élargi (sélection Noël, 10/11/2026) : une marque ou un modèle précis ne s'élargit pas (« iphone » ne doit pas
// trouver « support smartphone ») ; les mots vagues ne servent jamais de synonyme trouvé (« enceinte PORTABLE » n'est
// pas un téléphone, « prise connectée » n'est pas un chargeur).
const SPECIFIC = new Set(['iphone', 'android', 'galaxy', 'macbook', 'ipad', 'airpod', 'playstation', 'ps5', 'xbox', 'nintendo']);
const NON_TARGET = new Set(['portable', 'bluetooth', 'audio', 'mobile', 'connecte', 'connectee', 'prise', 'tab']);

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

// Abréviations et chiffres romains (15/11/2026 : « GTA 6 » doit trouver « Grand Theft Auto VI ») : ajoutés aux mots du NOM
const ABBR = [['grand theft auto', 'gta'], ['call of duty', 'cod'], ['red dead redemption', 'rdr'], ['the legend of zelda', 'zelda']];
const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12' };
function nameWords(name) {
  const n = ` ${norm(name)} `;
  const extra = ABBR.filter(([long]) => n.includes(` ${long} `)).map(([, short]) => short);
  const base = words(name);
  return [...base, ...extra, ...base.filter((w) => ROMAN[w]).map((w) => ROMAN[w])];
}

// Mots que le client emploie pour un RAYON (16/11/2026 : « habits » doit trouver la mode, pas un tapis de souris « mode RGB »)
const CAT_WORDS = {
  'Mode homme': 'vetement habit homme', 'Mode femme': 'vetement habit femme', Chaussures: 'chaussure basket sneaker soulier',
  Lunettes: 'lunette solaire', 'Sport & nutrition': 'sport proteine complement', 'Maison & déco': 'meuble deco maison',
  'Écrans': 'ecran moniteur pc gamer',
};
// Appareils : leur nom compte aussi comme « rayon » (« iphone » montre les iPhone avant les coques pour iPhone)
// (seulement les mots AVANT « pour / compatible / avec » : une montre « compatible iPhone » n'est pas un iPhone)
const DEVICE = new Set(['Téléphones', 'Tablettes', 'Ordinateurs']);
const deviceWords = (name) => nameWords(String(name).split(/\b(?:pour|compatible|avec)\b/i)[0]);

// Fiche « indexée » d'un produit (champs pondérés)
function fields(p) {
  return [
    [3, nameWords(p.name)],
    [4, words(CAT_WORDS[p.category] || '')],
    [2, [...words(`${p.brand || ''} ${p.category || ''} ${p.universe || ''}`), ...(DEVICE.has(p.category) ? deviceWords(p.name) : [])]],
    [1.2, words(`${(p.specs || []).map((s) => s.value).join(' ')} ${(p.options || []).flatMap((o) => o.values).join(' ')}`)],
    [0.6, words(p.description)],
  ];
}

/** Note d'un mot de la recherche pour un produit (0 = absent) : meilleure correspondance de CHAQUE champ, additionnées
 *  (un iPhone, trouvé par son nom ET son rayon « Téléphones », passe devant une coque qui ne cite iPhone que dans son nom).
 *  corrected = mot du produit si une faute de frappe a été corrigée. */
function wordScore(qw, f) {
  const variants = SPECIFIC.has(qw) ? [qw] : (SYN.get(qw) || [qw]).filter((v) => v === qw || !NON_TARGET.has(v));
  const tol = tolerance(qw);
  let total = 0, corrected = null, exact = false;
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
    if (best >= 0.7) exact = true;
  }
  return { score: total, corrected: exact ? null : corrected, exact };
}

/** Recherche : renvoie { list (produits classés), partial, didYouMean } */
function search(list, q, retry = true) {
  const qws = words(q);
  if (!qws.length) return { list, partial: false, didYouMean: null };
  const scored = [];
  const fixes = new Map();
  const real = new Set(); // mots trouvés tels quels dans au moins un produit : jamais « corrigés » (« lunettes » ≠ « manettes »)
  for (const p of list) {
    const f = fields(p);
    let total = 0, matched = 0;
    for (const w of qws) {
      const r = wordScore(w, f);
      if (r.score) { matched++; total += r.score; if (r.exact) real.add(w); else if (r.corrected) fixes.set(w, r.corrected); }
    }
    if (matched) scored.push({ p, total, matched });
  }
  for (const w of real) fixes.delete(w);
  // Un mot trouvé tel quel : les produits qui ne le contiennent que par « correction » sont retirés
  if (real.size) for (const x of scored) for (const w of real) { const r = wordScore(w, fields(x.p)); if (r.score && !r.exact) { x.matched--; x.total -= r.score; } }
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
