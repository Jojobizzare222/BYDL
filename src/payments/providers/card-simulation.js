// Carte bancaire SIMULÉE : imite la page de paiement sécurisée d'un prestataire (CinetPay, Moneroo…).
// Le client est envoyé sur /paiement-carte/ (page de test, aucun vrai numéro de carte), il choisit
// « accepté » ou « refusé », puis revient sur la boutique. Le statut est ensuite vérifié comme pour Mobile Money.
const crypto = require('crypto');

const decisions = new Map(); // providerRef -> null (en attente) | true | false

module.exports = {
  name: 'card',
  label: 'Carte bancaire (simulation)',
  async requestPayment({ paymentId }) {
    const providerRef = `SIMCARD-${crypto.randomUUID()}`;
    decisions.set(providerRef, null);
    return { providerRef, redirectUrl: `/paiement-carte/?p=${encodeURIComponent(paymentId)}` };
  },
  async getStatus(providerRef) {
    if (!decisions.has(providerRef)) return { status: 'FAILED', reason: 'Transaction inconnue' };
    const d = decisions.get(providerRef);
    if (d === null) return { status: 'PENDING', reason: null };
    return d ? { status: 'SUCCESSFUL', reason: null } : { status: 'FAILED', reason: 'Carte refusée (simulation)' };
  },
  decide(providerRef, approved) {
    if (!decisions.has(providerRef) || decisions.get(providerRef) !== null) return false;
    decisions.set(providerRef, Boolean(approved));
    return true;
  },
};
