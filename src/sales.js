// Règles de vente (décision Joseph 16/10/2026), réglables dans Zado Pro → Réglages :
//  - accountRequired : il faut un compte client dont la pièce d'identité a été VÉRIFIÉE par l'admin pour commander ;
//  - methods : moyens de paiement proposés. Par défaut, SEULEMENT les espèces en agence ; le client choisit ensuite
//    de retirer sa commande à l'agence ou de se faire livrer. Les autres moyens restent dans le code, désactivés.
const { settings } = require('./store');

// mobile : acompte de 500 FCFA puis le reste par retrait (demande sur le téléphone) ou par dépôt (décision Joseph 21/10/2026)
// photoRequired (décision Joseph 18/11/2026) : seuls les articles qui ont AU MOINS UNE PHOTO sont visibles sur la boutique ;
// dès qu'une photo est ajoutée dans Zado Pro, l'article apparaît tout seul. Coupé par défaut pour les tests (catalogue de
// simulation sans photo : PHOTO_RULE=off dans tests/run-test.sh) et pour la démo Vercel (2 produits d'exemple sans photo).
const DEFAULTS = { accountRequired: true, photoRequired: process.env.PHOTO_RULE !== 'off' && !process.env.VERCEL, methods: { mobile: true, momo: false, card: false, cod: false, cash: true } };

function salesSettings() {
  try {
    const s = JSON.parse(settings.get('sales') || '{}');
    return { accountRequired: s.accountRequired ?? DEFAULTS.accountRequired, photoRequired: s.photoRequired ?? DEFAULTS.photoRequired, methods: { ...DEFAULTS.methods, ...(s.methods || {}) } };
  } catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}

function saveSalesSettings(input) {
  const cur = salesSettings();
  const next = {
    accountRequired: 'accountRequired' in (input || {}) ? Boolean(input.accountRequired) : cur.accountRequired,
    photoRequired: 'photoRequired' in (input || {}) ? Boolean(input.photoRequired) : cur.photoRequired,
    methods: { ...cur.methods },
  };
  for (const k of Object.keys(DEFAULTS.methods)) if (input?.methods && k in input.methods) next.methods[k] = Boolean(input.methods[k]);
  if (!Object.values(next.methods).some(Boolean)) return { error: 'Gardez au moins un moyen de paiement' };
  settings.set('sales', JSON.stringify(next));
  return { value: next };
}

const methodAllowed = (m) => Boolean(salesSettings().methods[m]);

/** L'article a-t-il au moins une photo ? */
const hasPhoto = (p) => Boolean(p && (String(p.image || '').trim() || (Array.isArray(p.images) && p.images.some((u) => String(u || '').trim()))));
/** Filtre « photo » de la boutique : à créer UNE fois par requête (le réglage est lu une seule fois). */
const photoFilter = () => { const need = salesSettings().photoRequired; return (p) => !need || hasPhoto(p); };

module.exports = { salesSettings, saveSalesSettings, methodAllowed, hasPhoto, photoFilter };
