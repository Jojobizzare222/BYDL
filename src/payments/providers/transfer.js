// « Dépôt » Mobile Money : le client envoie lui-même l'argent au numéro de Zado (aucune API à appeler).
// La demande reste en attente jusqu'à ce que l'équipe confirme « Dépôt reçu » dans Zado Pro (routes/admin.js),
// ou expire après le délai réglé (Réglages → Transport et acompte).
const crypto = require('crypto');

module.exports = {
  name: 'transfer',
  label: 'Dépôt Mobile Money',
  async requestPayment() {
    return { providerRef: `DEP-${crypto.randomUUID()}` };
  },
  async getStatus(providerRef, payment) {
    if (payment?.expiresAt && Date.now() > Date.parse(payment.expiresAt)) return { status: 'FAILED', reason: 'Dépôt non reçu dans le délai' };
    return { status: 'PENDING', reason: null };
  },
};
