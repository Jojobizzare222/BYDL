// Frais de transport France → Pointe-Noire facturés au client (décision Joseph 21/10/2026) :
// 13,90 € par kilo AU PRORATA DU POIDS (décision Joseph 14/11/2026 : « un objet de 200 g sera facturé au prorata ») ;
// avant : 15 €/kg avec 1 kg minimum par article (21/10 → 14/11/2026). Coût ESTIMATIF montré au client : selon le rapport
// poids / volume, le transporteur peut facturer plus (note affichée sur la fiche, le panier, la commande, les conditions de vente).
// Réglable dans Zado Pro → Réglages → « Transport et acompte » : prix au kilo, poids minimum (0 = prorata), minimum par article ou par commande.
// Le poids de chaque produit (weightKg, poids du COLIS : article + emballage) est saisi dans sa fiche ; sans poids, on compte defaultKg (1 kg).
const { settings } = require('./store');

const EUR_FCFA = 655.957; // parité fixe euro / franc CFA
// Délais annoncés au client (décision Joseph 21/10/2026) : logistique (achat en France + vol) 2 à 5 jours, puis livraison sous 24 h
// zadoFeeEurPerKg : part du prix au kilo qui est un FRAIS ZADO (22/10/2026 : 15 € = 13 € de fret + 2 € ; 14/11/2026 : 13,90 € = 13 € de fret + 0,90 €, À CONFIRMER par Joseph)
const DEFAULTS = { enabled: true, eurPerKg: 13.9, zadoFeeEurPerKg: 0.9, minKg: 0, defaultKg: 1, perArticle: true, logisticsMin: 2, logisticsMax: 5, deliveryHours: 24 };

function freightSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(settings.get('freight') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveFreightSettings(input = {}) {
  const cur = freightSettings();
  const num = (v, min, max) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null; };
  const next = { ...cur };
  if ('enabled' in input) next.enabled = Boolean(input.enabled);
  if ('eurPerKg' in input) { const v = num(input.eurPerKg, 0, 500); if (v === null) return { error: 'Prix au kilo invalide (en euros)' }; next.eurPerKg = v; }
  if ('zadoFeeEurPerKg' in input) { const v = num(input.zadoFeeEurPerKg, 0, 500); if (v === null) return { error: 'Frais Zado au kilo invalide (en euros)' }; next.zadoFeeEurPerKg = v; }
  if ('defaultKg' in input) { const v = num(input.defaultKg, 0.01, 50); if (v === null) return { error: 'Poids par défaut invalide (en kg)' }; next.defaultKg = v; }
  if ('minKg' in input) { const v = num(input.minKg, 0, 50); if (v === null) return { error: 'Poids minimum invalide (en kg)' }; next.minKg = v; }
  if ('perArticle' in input) next.perArticle = Boolean(input.perArticle);
  for (const [k, max] of [['logisticsMin', 60], ['logisticsMax', 60], ['deliveryHours', 240]]) {
    if (k in input) { const v = Math.round(Number(input[k])); if (!(v >= 0 && v <= max)) return { error: 'Délai invalide' }; next[k] = v; }
  }
  if (next.zadoFeeEurPerKg > next.eurPerKg) return { error: 'Le frais Zado ne peut pas dépasser le prix du transport au kilo' };
  if (next.logisticsMin > next.logisticsMax) return { error: 'Le délai minimum de logistique doit être inférieur au maximum' };
  settings.set('freight', JSON.stringify(next));
  return { value: next };
}

/** Prix d'un kilo en FCFA (arrondi au franc). */
const perKgFcfa = (s = freightSettings()) => Math.round(s.eurPerKg * EUR_FCFA);
/** Poids facturé pour UN article (minimum appliqué si « par article »). */
const billedKg = (weightKg, s = freightSettings()) => {
  const w = Number(weightKg) > 0 ? Number(weightKg) : (s.defaultKg ?? 1); // poids inconnu : on compte defaultKg
  return Math.round((s.perArticle ? Math.max(s.minKg, w) : w) * 100) / 100;
};
/** Transport d'un article (FCFA), pour l'affichage sur la fiche produit. */
const unitFee = (product, s = freightSettings()) => (s.enabled ? Math.round(billedKg(product?.weightKg, s) * s.eurPerKg * EUR_FCFA) : 0);

/**
 * Transport d'une commande. lines = [{ weightKg, qty }].
 * Renvoie { fee, kg, perKg, zadoFee } (zadoFee = part du transport qui revient à Zado, comptée dans la marge) : par article, chaque article compte au moins minKg ; par commande, le total compte au moins minKg.
 */
function orderFreight(lines, s = freightSettings()) {
  if (!s.enabled) return { fee: 0, kg: 0, perKg: perKgFcfa(s), zadoFee: 0 };
  let kg = 0;
  for (const l of lines) kg += billedKg(l.weightKg, s) * (Number(l.qty) || 0);
  if (!s.perArticle) kg = Math.max(s.minKg, kg);
  kg = Math.round(kg * 100) / 100;
  const fee = Math.round(kg * s.eurPerKg * EUR_FCFA);
  return { fee, kg, perKg: perKgFcfa(s), zadoFee: Math.min(fee, Math.round(kg * (s.zadoFeeEurPerKg || 0) * EUR_FCFA)) };
}

/** Réglages montrés à la boutique : JAMAIS le frais Zado (information interne). */
const publicFreight = () => { const { zadoFeeEurPerKg, ...s } = freightSettings(); return { ...s, perKg: perKgFcfa() }; };

module.exports = { EUR_FCFA, publicFreight, freightSettings, saveFreightSettings, perKgFcfa, billedKg, unitFee, orderFreight };
