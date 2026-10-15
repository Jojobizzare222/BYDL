// Point d'entrée unique pour les paiements Mobile Money.
// Pour ajouter un opérateur (Orange Money, Moov, Wave…) ou un agrégateur (CinetPay, pawaPay…),
// créez un fichier dans ./providers exposant requestPayment() et getStatus(), puis déclarez-le ici.
const config = require('../config');
const simulation = require('./providers/simulation');

const live = {
  mtn: require('./providers/mtn-momo'),
  airtel: require('./providers/airtel-money'),
};

const simulated = {
  mtn: simulation.create('mtn', 'MTN Mobile Money'),
  airtel: simulation.create('airtel', 'Airtel Money'),
};

function getProvider(operator) {
  const registry = config.paymentMode === 'live' ? live : simulated;
  const provider = registry[operator];
  if (!provider) throw new Error(`Opérateur non pris en charge : ${operator}`);
  return provider;
}

function listOperators() {
  return Object.keys(live).map((key) => ({ id: key, label: live[key].label }));
}

module.exports = { getProvider, listOperators };
