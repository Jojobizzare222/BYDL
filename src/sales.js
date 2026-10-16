// Règles de vente (décision Joseph 16/10/2026), réglables dans Kamwa Pro → Réglages :
//  - accountRequired : il faut un compte client dont la pièce d'identité a été VÉRIFIÉE par l'admin pour commander ;
//  - methods : moyens de paiement proposés. Par défaut, SEULEMENT les espèces en agence ; le client choisit ensuite
//    de retirer sa commande à l'agence ou de se faire livrer. Les autres moyens restent dans le code, désactivés.
const { settings } = require('./store');

const DEFAULTS = { accountRequired: true, methods: { momo: false, card: false, cod: false, cash: true } };

function salesSettings() {
  try {
    const s = JSON.parse(settings.get('sales') || '{}');
    return { accountRequired: s.accountRequired ?? DEFAULTS.accountRequired, methods: { ...DEFAULTS.methods, ...(s.methods || {}) } };
  } catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}

function saveSalesSettings(input) {
  const cur = salesSettings();
  const next = {
    accountRequired: 'accountRequired' in (input || {}) ? Boolean(input.accountRequired) : cur.accountRequired,
    methods: { ...cur.methods },
  };
  for (const k of Object.keys(DEFAULTS.methods)) if (input?.methods && k in input.methods) next.methods[k] = Boolean(input.methods[k]);
  if (!Object.values(next.methods).some(Boolean)) return { error: 'Gardez au moins un moyen de paiement' };
  settings.set('sales', JSON.stringify(next));
  return { value: next };
}

const methodAllowed = (m) => Boolean(salesSettings().methods[m]);

module.exports = { salesSettings, saveSalesSettings, methodAllowed };
