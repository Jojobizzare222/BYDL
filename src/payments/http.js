// Appels aux API des opérateurs avec un délai maximal : un opérateur lent ne doit pas bloquer la page du client.
const { operatorTimeoutMs } = require('../config');

async function operatorFetch(url, options = {}) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(operatorTimeoutMs) });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `délai de ${operatorTimeoutMs / 1000} s dépassé` : err.message;
    const e = new Error(`Pas de réponse de l'opérateur (${reason})`);
    e.uncertain = true; // la demande est peut-être arrivée chez l'opérateur
    throw e;
  }
}

module.exports = { operatorFetch };
