// Achat en France (décision Joseph 16/10/2026) : « tu achètes, tu reçois, point ».
// Depuis le 16/10/2026 : l'équipe ajoute elle-même les produits venus de France au catalogue (origin 'FR', prix tout compris
// calculé depuis le prix en € et le poids, transport TOUJOURS en avion). Les demandes de devis sur lien par les clients
// restent possibles mais sont désactivées par défaut (réglage customerRequests).
// Modèle « lien + devis tout compris » (demandes des clients) :
//  1. le client colle le lien d'un produit vendu en France (+ taille, couleur, quantité) ;
//  2. Kamwa calcule un DEVIS TOUT COMPRIS en FCFA (prix en € × 655,957 + port en France + transport + douane + commission) ;
//  3. le client accepte et paie EN ENTIER (Mobile Money ou carte) : le devis devient une commande Kamwa normale ;
//  4. l'agent en France (le frère de Joseph) achète, reçoit, photographie, regroupe les colis en ENVOIS ;
//  5. l'envoi arrive au Congo → livraison habituelle (livreur + code de livraison).
// Le franc CFA est lié à l'euro par un taux FIXE (1 € = 655,957 FCFA) : pas de risque de change.
const crypto = require('crypto');
const { settings } = require('./store');

const EUR = 655.957;
const DEFAULTS = {
  enabled: true,
  customerRequests: false, // demandes de devis « sur lien » par les clients (Joseph : les produits sont ajoutés par l'équipe)
  freightPerKg: 9000,     // transport France → Congo EN AVION, FCFA par kg (À CONFIRMER avec l'expéditeur)
  minWeightKg: 0.5,       // poids minimum facturé par commande
  customsPercent: 20,     // douane et taxes estimées, en % de la valeur (À AFFINER après les premiers envois)
  commissionPercent: 12,  // commission Kamwa, en % du coût total
  fixedFee: 3000,         // frais fixes par commande (FCFA)
  roundTo: 500,           // arrondi du prix final
  validityHours: 48,      // durée de validité d'un devis
  delay: '10 à 21 jours', // délai annoncé au client après paiement
};
function importSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(settings.get('import') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveImportSettings(input) {
  const cur = importSettings();
  const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const next = {
    enabled: 'enabled' in input ? Boolean(input.enabled) : cur.enabled,
    customerRequests: 'customerRequests' in input ? Boolean(input.customerRequests) : cur.customerRequests,
    freightPerKg: 'freightPerKg' in input ? num(input.freightPerKg, 0, 1000000) : cur.freightPerKg,
    minWeightKg: 'minWeightKg' in input ? num(input.minWeightKg, 0, 1000) : cur.minWeightKg,
    customsPercent: 'customsPercent' in input ? num(input.customsPercent, 0, 200) : cur.customsPercent,
    commissionPercent: 'commissionPercent' in input ? num(input.commissionPercent, 0, 200) : cur.commissionPercent,
    fixedFee: 'fixedFee' in input ? num(input.fixedFee, 0, 1000000) : cur.fixedFee,
    roundTo: 'roundTo' in input ? num(input.roundTo, 1, 100000) : cur.roundTo,
    validityHours: 'validityHours' in input ? num(input.validityHours, 1, 720) : cur.validityHours,
    delay: 'delay' in input ? String(input.delay || '').trim().slice(0, 40) || cur.delay : cur.delay,
  };
  if (Object.values(next).some((v) => v === null)) return { error: 'Valeurs invalides' };
  settings.set('import', JSON.stringify(next));
  return { value: next };
}

/**
 * Devis tout compris. items = [{ priceEur, shippingEur, qty }], weightKg = poids total estimé.
 * Renvoie le détail (en FCFA) : articles, transport, douane, commission, total arrondi.
 */
function computeQuote(items, weightKg, s = importSettings()) {
  const eur = items.reduce((n, it) => n + (Number(it.priceEur) || 0) * (Number(it.qty) || 1) + (Number(it.shippingEur) || 0), 0);
  const goods = Math.round(eur * EUR);
  const weight = Math.max(Number(weightKg) || 0, s.minWeightKg);
  const freight = Math.round(weight * s.freightPerKg);
  const customs = Math.round((goods * s.customsPercent) / 100);
  const cost = goods + freight + customs;
  const commission = Math.round((cost * s.commissionPercent) / 100) + s.fixedFee;
  const total = Math.ceil((cost + commission) / s.roundTo) * s.roundTo;
  return { eur: Math.round(eur * 100) / 100, rate: EUR, goods, weightKg: weight, freight, customs, cost, commission: total - cost, total };
}

const STAGES = {
  to_buy: 'À acheter en France',
  bought: 'Acheté en France',
  received: "Reçu par l'agent",
  shipped_fr: 'Parti de France',
  arrived: 'Arrivé au Congo',
};

const newImportId = () => {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `FR-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};
const isExpired = (r) => r.status === 'quoted' && r.quote?.validUntil && Date.parse(r.quote.validUntil) < Date.now();
const statusOf = (r) => (isExpired(r) ? 'expired' : r.status);

module.exports = { EUR, STAGES, importSettings, saveImportSettings, computeQuote, newImportId, isExpired, statusOf };
