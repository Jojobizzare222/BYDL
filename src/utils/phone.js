// Numéros Congo-Brazzaville (+242) : 9 chiffres.
//   06 xxx xx xx -> MTN
//   05 / 04 xxx xx xx -> Airtel
const COUNTRY_CODE = '242';

const OPERATOR_PREFIXES = {
  mtn: ['06'],
  airtel: ['05', '04'],
};

/** Retourne le numéro national à 9 chiffres (ex. "061234567") ou null. */
function normalizeLocal(input) {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(COUNTRY_CODE) && digits.length === 12) digits = digits.slice(3);
  return /^0\d{8}$/.test(digits) ? digits : null;
}

/** Format international sans "+" (ex. "242061234567"), attendu par MTN MoMo. */
function toInternational(local) {
  return COUNTRY_CODE + local;
}

function detectOperator(local) {
  const prefix = local.slice(0, 2);
  return Object.keys(OPERATOR_PREFIXES).find((op) => OPERATOR_PREFIXES[op].includes(prefix)) || null;
}

module.exports = { normalizeLocal, toInternational, detectOperator, OPERATOR_PREFIXES };
