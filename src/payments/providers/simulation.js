// Fournisseur simulé : permet de tester tout le parcours d'achat sans compte marchand.
//  - le paiement est validé automatiquement après ~8 secondes
//  - un numéro qui se termine par 000 simule un refus (solde insuffisant)
const crypto = require('crypto');

const pending = new Map();
const DELAY_MS = 8000;

function create(name, label) {
  return {
    name,
    label: `${label} (simulation)`,
    async requestPayment({ phoneLocal }) {
      const providerRef = `SIM-${crypto.randomUUID()}`;
      pending.set(providerRef, { createdAt: Date.now(), willFail: phoneLocal.endsWith('000') });
      return { providerRef };
    },
    async getStatus(providerRef) {
      const tx = pending.get(providerRef);
      if (!tx) return { status: 'FAILED', reason: 'Transaction inconnue' };
      if (Date.now() - tx.createdAt < DELAY_MS) return { status: 'PENDING', reason: null };
      return tx.willFail
        ? { status: 'FAILED', reason: 'Solde insuffisant (simulation)' }
        : { status: 'SUCCESSFUL', reason: null };
    },
  };
}

module.exports = { create };
