// Frais de livraison par ville et par quartier (audit du 17/10/2026), réglables dans Kamwa Pro → Réglages [admin].
//  - chaque ville a un tarif ; des quartiers peuvent avoir leur propre tarif (zone éloignée…) ;
//  - « Autre ville » : livraison acceptée ou non, avec son tarif ;
//  - livraison offerte à partir d'un montant d'achat (0 = jamais) ;
//  - retrait au point relais : toujours gratuit.
// Le montant est TOUJOURS calculé ici, côté serveur, au moment du paiement (jamais repris du navigateur).
// Par défaut, tout est à 0 FCFA (comme avant) : Joseph fixe les vrais montants.
const { settings } = require('./store');

const DEFAULTS = {
  cities: [
    { city: 'Pointe-Noire', fee: 0, zones: [] },
    { city: 'Brazzaville', fee: 0, zones: [] },
    { city: 'Dolisie', fee: 0, zones: [] },
  ],
  other: { allowed: true, fee: 0 },
  freeFrom: 0,
};
const MAX_FEE = 200000;
const clean = (s, n = 40) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const amount = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= MAX_FEE ? n : null; };
const key = (s) => clean(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function feeSettings() {
  try {
    const s = JSON.parse(settings.get('deliveryFees') || 'null');
    return s && Array.isArray(s.cities) ? s : JSON.parse(JSON.stringify(DEFAULTS));
  } catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}

/** Contrôle et enregistre les tarifs saisis dans Kamwa Pro. */
function saveFeeSettings(input) {
  const cities = [];
  const seen = new Set();
  for (const c of (Array.isArray(input?.cities) ? input.cities : []).slice(0, 30)) {
    const city = clean(c.city);
    if (!city) continue;
    if (seen.has(key(city))) return { error: `La ville « ${city} » est en double` };
    seen.add(key(city));
    const fee = amount(c.fee);
    if (fee == null) return { error: `Tarif invalide pour ${city} (0 à ${MAX_FEE} FCFA)` };
    const zones = [];
    for (const z of (Array.isArray(c.zones) ? c.zones : []).slice(0, 40)) {
      const name = clean(z.name);
      if (!name) continue;
      const zf = amount(z.fee);
      if (zf == null) return { error: `Tarif invalide pour le quartier ${name} (${city})` };
      zones.push({ name, fee: zf });
    }
    cities.push({ city, fee, zones });
  }
  if (!cities.length) return { error: 'Gardez au moins une ville de livraison' };
  const otherFee = amount(input?.other?.fee ?? 0);
  if (otherFee == null) return { error: 'Tarif « autre ville » invalide' };
  const freeFrom = Math.round(Number(input?.freeFrom || 0));
  if (!(freeFrom >= 0 && freeFrom <= 100000000)) return { error: 'Montant de livraison offerte invalide' };
  const value = { cities, other: { allowed: Boolean(input?.other?.allowed), fee: otherFee }, freeFrom };
  settings.set('deliveryFees', JSON.stringify(value));
  return { value };
}

/** Frais pour une adresse : { deliverable, fee, city, zone, free } */
function feeFor(city, zone, subtotal = 0) {
  const s = feeSettings();
  const c = s.cities.find((x) => key(x.city) === key(city));
  let fee;
  if (c) {
    const z = zone ? c.zones.find((x) => key(x.name) === key(zone)) : null;
    fee = z ? z.fee : c.fee;
  } else {
    if (!s.other.allowed) return { deliverable: false, fee: null, city: clean(city) };
    fee = s.other.fee;
  }
  const free = s.freeFrom > 0 && subtotal >= s.freeFrom && fee > 0;
  return { deliverable: true, fee: free ? 0 : fee, city: c?.city || clean(city), zone: zone ? clean(zone) : null, free };
}

/** Version publique (boutique) : villes, quartiers et tarifs. */
const publicFees = () => feeSettings();

module.exports = { feeSettings, saveFeeSettings, feeFor, publicFees };
