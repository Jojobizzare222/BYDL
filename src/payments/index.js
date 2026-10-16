// Point d'entrée unique pour les paiements : Mobile Money (MTN, Airtel), carte bancaire, espèces en agence.
// Pour ajouter un opérateur (Orange Money, Moov, Wave…) ou un agrégateur (CinetPay, pawaPay…),
// créez un fichier dans ./providers exposant requestPayment() et getStatus(), puis déclarez-le ici.
const config = require('../config');
const simulation = require('./providers/simulation');
const cash = require('./providers/cash');
const cardSimulation = require('./providers/card-simulation');

const live = {
  mtn: require('./providers/mtn-momo'),
  airtel: require('./providers/airtel-money'),
  card: require('./providers/card'),
  cash,
};

const simulated = {
  mtn: simulation.create('mtn', 'MTN Mobile Money'),
  airtel: simulation.create('airtel', 'Airtel Money'),
  card: cardSimulation,
  cash, // les espèces fonctionnent pareil en test et en réel
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

// La carte n'est proposée que si elle peut marcher : en simulation, ou si un prestataire est configuré.
const cardAvailable = () => config.paymentMode !== 'live' || Boolean(config.cardProvider);

module.exports = { getProvider, listOperators, cardAvailable, cardSimulation };
