// Paiement Mobile Money en deux temps (décision Joseph 21/10/2026) :
//  1) un ACOMPTE de 500 FCFA (réglable) confirme la commande ; un message récapitulatif est envoyé au client ;
//  2) le reste est payé ensuite, de la façon choisie par le client au moment de commander :
//     - « retrait » (pull) : Zado envoie la demande de paiement sur le téléphone du client (code USSD), il tape son code secret ;
//     - « dépôt » (push) : le client envoie lui-même l'argent au numéro Mobile Money de Zado ; l'équipe confirme la réception.
// Les numéros de dépôt de Zado se règlent dans Zado Pro → Réglages → « Transport et acompte ».
const { settings } = require('./store');
const { normalizeLocal } = require('./utils/phone');

const DEFAULTS = { deposit: 500, numbers: { mtn: '', airtel: '' }, holder: 'Zado', transferHours: 24 };
const MODES = { pull: 'Par retrait (Zado envoie la demande sur votre téléphone)', push: 'Par dépôt (vous envoyez l\'argent au numéro Zado)' };

function mobileSettings() {
  try { const s = JSON.parse(settings.get('mobilePay') || '{}'); return { ...DEFAULTS, ...s, numbers: { ...DEFAULTS.numbers, ...(s.numbers || {}) } }; }
  catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
function saveMobileSettings(input = {}) {
  const cur = mobileSettings();
  const next = { ...cur, numbers: { ...cur.numbers } };
  if ('deposit' in input) { const n = Number(input.deposit); if (!Number.isInteger(n) || n < 0 || n > 1000000) return { error: 'Acompte invalide (nombre entier en FCFA)' }; next.deposit = n; }
  if ('holder' in input) next.holder = String(input.holder || '').trim().slice(0, 60) || 'Zado';
  if ('transferHours' in input) { const n = Number(input.transferHours); if (!(n >= 1 && n <= 168)) return { error: 'Délai de dépôt invalide (1 à 168 h)' }; next.transferHours = Math.round(n); }
  for (const op of ['mtn', 'airtel']) {
    if (input.numbers && op in input.numbers) {
      const raw = String(input.numbers[op] || '').trim();
      if (!raw) { next.numbers[op] = ''; continue; }
      const p = normalizeLocal(raw);
      if (!p) return { error: `Numéro ${op === 'mtn' ? 'MTN' : 'Airtel'} invalide` };
      next.numbers[op] = p;
    }
  }
  settings.set('mobilePay', JSON.stringify(next));
  return { value: next };
}
/** Numéro où le client doit déposer, selon son opérateur (repli : l'autre opérateur). */
function depositNumber(operator, s = mobileSettings()) {
  const own = s.numbers[operator];
  if (own) return { operator, number: own, holder: s.holder };
  const other = operator === 'mtn' ? 'airtel' : 'mtn';
  return s.numbers[other] ? { operator: other, number: s.numbers[other], holder: s.holder } : null;
}
const spaced = (n) => String(n || '').replace(/^(\d{2})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4');

module.exports = { MODES, mobileSettings, saveMobileSettings, depositNumber, spaced };
