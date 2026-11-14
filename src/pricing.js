// Règle de prix Zado (décision Joseph 14/11/2026, modèle dans Notion « Modèle économique Zado — 14 novembre 2026 ») :
//  - coût de l'article = prix public en France TTC (TVA 20 % déjà comprise) converti en FCFA (`sourcePrice`) ;
//  - marge selon ce coût : < 25 000 FCFA → 35 % ; 25 000 à 150 000 → 20 % ; > 150 000 → 17 % ; au moins 3 000 FCFA ;
//    prix arrondi aux 500 FCFA supérieurs ;
//  - reconditionné / occasion : +25 % sur le prix GLOBAL (article + transport d'un article) ; le supplément est intégré
//    au prix de l'article : prix = 1,25 × article + 0,25 × transport, arrondi aux 500 FCFA supérieurs ;
//  - frais de service : 2 000 FCFA PAR COMMANDE (une fois, quel que soit le nombre d'articles), ajoutés au total ;
//  - frais de retrait Mobile Money : 3,5 % du prix GÉNÉRAL, calculés TOUT À LA FIN (articles − remise + transport + frais de
//    service + livraison), arrondis au franc supérieur ; seulement pour un paiement Mobile Money (pas carte ni espèces).
// Transport (17,80 €/kg dont 3,90 € de peines et soins) : src/freight.js. Réglable : settings `pricing`.
const { settings } = require('./store');

const DEFAULTS = {
  tiers: [{ upTo: 25000, rate: 0.35 }, { upTo: 150000, rate: 0.2 }, { upTo: null, rate: 0.17 }],
  minMargin: 3000, roundTo: 500, refurbExtra: 0.25, serviceFee: 2000, momoRate: 0.035,
};

function pricingSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(settings.get('pricing') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function savePricingSettings(input = {}) {
  const next = { ...pricingSettings() };
  if ('serviceFee' in input) {
    const n = Math.round(Number(input.serviceFee));
    if (!(n >= 0 && n <= 100000)) return { error: 'Frais de service invalides (FCFA)' };
    next.serviceFee = n;
  }
  if ('momoRate' in input) {
    const r = Number(String(input.momoRate).replace(',', '.'));
    if (!(r >= 0 && r <= 0.2)) return { error: 'Taux des frais Mobile Money invalide (entre 0 et 20 %)' };
    next.momoRate = Math.round(r * 10000) / 10000;
  }
  settings.set('pricing', JSON.stringify(next));
  return { value: next };
}

const rateFor = (cost, s = pricingSettings()) => (s.tiers.find((t) => t.upTo == null || cost <= t.upTo) || s.tiers[s.tiers.length - 1]).rate;
const roundUp = (n, s) => Math.ceil(n / s.roundTo) * s.roundTo;
const isRefurb = (p) => Boolean(p?.condition && p.condition !== 'neuf');

/** Prix de vente conseillé d'un produit (FCFA) selon la règle Zado, ou null sans prix en France (`sourcePrice`). */
function salePrice(p, s = pricingSettings()) {
  const cost = Math.round(Number(p?.sourcePrice) || 0);
  if (!(cost > 0)) return null;
  const base = roundUp(cost + Math.max(Math.round(cost * rateFor(cost, s)), s.minMargin), s);
  if (!isRefurb(p)) return base;
  const transport = require('./freight').unitFee(p);
  return roundUp(base * (1 + s.refurbExtra) + transport * s.refurbExtra, s);
}

/** Frais de service d'une commande (FCFA). */
const serviceFee = () => pricingSettings().serviceFee || 0;

// Moyens de paiement qui passent par Mobile Money (frais de retrait) ; carte et espèces : pas de frais
const MOMO_METHODS = new Set(['mobile', 'momo', 'cod']);
/** Frais de retrait Mobile Money sur un prix général (FCFA, arrondi au franc supérieur). method absent = Mobile Money. */
function momoFee(base, method = 'mobile') {
  if (!MOMO_METHODS.has(method)) return 0;
  const rate = pricingSettings().momoRate || 0;
  return base > 0 && rate > 0 ? Math.ceil(base * rate) : 0;
}

module.exports = { DEFAULTS, pricingSettings, savePricingSettings, salePrice, rateFor, serviceFee, momoFee };
