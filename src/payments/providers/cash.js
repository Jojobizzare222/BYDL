// Espèces en agence : aucune API à appeler. La commande est réservée jusqu'à son échéance,
// puis c'est l'admin qui confirme « Paiement reçu en agence » (voir routes/admin.js).
const crypto = require('crypto');

module.exports = {
  name: 'cash',
  label: 'Espèces en agence',
  async requestPayment() {
    return { providerRef: `CASH-${crypto.randomUUID()}` };
  },
  // Jamais validé automatiquement ; expire si le client n'est pas venu payer à temps.
  async getStatus(providerRef, payment) {
    if (payment?.expiresAt && Date.now() > Date.parse(payment.expiresAt)) {
      return { status: 'FAILED', reason: 'Réservation expirée : pas de paiement en agence dans le délai' };
    }
    return { status: 'PENDING', reason: null };
  },
};
