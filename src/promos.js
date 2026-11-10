// Codes promo (décision Joseph 10/11/2026, « pack Noël ») : créés dans Zado Pro → Ventes → Codes promo [admin].
// Remise en % ou en FCFA, sur les ARTICLES seulement (jamais sur le transport ni la livraison), avec dates, montant
// minimum, plafond d'une remise en %, nombre total d'utilisations et une utilisation par client. Le nombre d'utilisations
// est RECALCULÉ à partir des commandes non annulées : une commande annulée rend l'utilisation, rien ne se désynchronise.
// Le serveur calcule TOUJOURS la remise lui-même à la création de la commande (jamais prise du navigateur).
const crypto = require('crypto');
const { promos, orders } = require('./store');

const normCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
const findCode = (code) => { const c = normCode(code); return c ? promos.find((p) => p.code === c) : undefined; };
const usesOf = (code, customerId = null) => orders.all().filter((o) => o.discount?.code === code && o.status !== 'cancelled' && (!customerId || o.customerId === customerId)).length;

/** Nettoie / valide ce que saisit l'admin. Renvoie { value } ou { error }. */
function cleanPromo(input = {}, current = {}) {
  const p = { ...current };
  if ('code' in input) {
    const code = normCode(input.code);
    if (!/^[A-Z0-9-]{3,20}$/.test(code)) return { error: 'Code : 3 à 20 caractères, lettres, chiffres et tiret (ex. NOEL10)' };
    const other = findCode(code);
    if (other && other.id !== current.id) return { error: 'Ce code existe déjà' };
    p.code = code;
  }
  if ('type' in input) { if (!['percent', 'amount'].includes(input.type)) return { error: 'Type de remise inconnu' }; p.type = input.type; }
  const int = (v) => (v === '' || v == null ? null : Math.round(Number(v)));
  if ('value' in input) {
    const v = int(input.value);
    if (!(v > 0) || (p.type === 'percent' && v > 90)) return { error: p.type === 'percent' ? 'Pourcentage entre 1 et 90' : 'Montant de la remise invalide' };
    p.value = v;
  }
  for (const k of ['minTotal', 'maxDiscount', 'maxUses']) if (k in input) { const v = int(input[k]); if (v != null && !(v >= 0)) return { error: 'Nombre invalide' }; p[k] = v || null; }
  for (const k of ['startsAt', 'endsAt']) if (k in input) p[k] = /^\d{4}-\d{2}-\d{2}$/.test(String(input[k] || '')) ? input[k] : null;
  if (p.startsAt && p.endsAt && p.startsAt > p.endsAt) return { error: 'La date de fin est avant la date de début' };
  if ('onePerCustomer' in input) p.onePerCustomer = Boolean(input.onePerCustomer);
  if ('active' in input) p.active = Boolean(input.active);
  if ('label' in input) p.label = String(input.label || '').trim().slice(0, 80) || null;
  if (!p.code || !p.type || !p.value) return { error: 'Code, type et valeur de la remise sont obligatoires' };
  if (p.type === 'percent' && p.value > 90) return { error: 'Pourcentage entre 1 et 90' };
  return { value: p };
}
function createPromo(input, by) {
  const r = cleanPromo({ type: 'percent', onePerCustomer: true, active: true, ...input });
  if (r.error) return r;
  return { value: promos.insert({ id: 'PRM-' + crypto.randomBytes(5).toString('hex'), ...r.value, createdAt: new Date().toISOString(), createdBy: by || null }) };
}

const todayCongo = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10); // heure du Congo (UTC+1)
const fcfa = (n) => `${new Intl.NumberFormat('fr-FR').format(n).replace(/ /g, ' ')} FCFA`;

/**
 * Remise d'un code pour un montant d'articles. Renvoie { code, amount, label } ou { error }.
 * customerId : client connecté (limite « une utilisation par client »).
 */
function quote(code, subtotal, customerId = null) {
  const p = findCode(code);
  if (!p || p.active === false) return { error: 'Code promo inconnu' };
  const today = todayCongo();
  if (p.startsAt && today < p.startsAt) return { error: 'Ce code n\'est pas encore valable' };
  if (p.endsAt && today > p.endsAt) return { error: 'Ce code a expiré' };
  if (p.minTotal && subtotal < p.minTotal) return { error: `Ce code est valable dès ${fcfa(p.minTotal)} d'achats` };
  if (p.maxUses && usesOf(p.code) >= p.maxUses) return { error: 'Ce code a déjà été utilisé le nombre de fois prévu' };
  if (p.onePerCustomer && customerId && usesOf(p.code, customerId) > 0) return { error: 'Vous avez déjà utilisé ce code' };
  let amount = p.type === 'percent' ? Math.round((subtotal * p.value) / 100) : p.value;
  if (p.type === 'percent' && p.maxDiscount) amount = Math.min(amount, p.maxDiscount);
  amount = Math.max(0, Math.min(amount, subtotal));
  return { code: p.code, amount, label: p.type === 'percent' ? `−${p.value} %` : `−${fcfa(p.value)}` };
}

const withUses = (p) => ({ ...p, uses: usesOf(p.code) });
module.exports = { normCode, findCode, cleanPromo, createPromo, quote, withUses, usesOf };
