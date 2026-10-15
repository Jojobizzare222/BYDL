// Airtel Money — API "Collection" (USSD push)
// Doc : https://developers.airtel.africa
// Remarque : selon le pays/la version de l'API, Airtel peut exiger un chiffrement (x-signature, x-key).
// Vérifiez ce point avec Airtel Congo lors de l'activation du compte marchand.
const crypto = require('crypto');
const { operatorFetch } = require('../http');
const { airtel } = require('../../config');

let tokenCache = { value: null, expiresAt: 0 };

function assertConfigured() {
  if (!airtel.clientId || !airtel.clientSecret) {
    throw new Error('Airtel Money non configuré : renseignez AIRTEL_CLIENT_ID et AIRTEL_CLIENT_SECRET dans .env');
  }
}

async function getToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const res = await operatorFetch(`${airtel.baseUrl}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: '*/*' },
    body: JSON.stringify({
      client_id: airtel.clientId,
      client_secret: airtel.clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Airtel token: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in || 180) - 30) * 1000,
  };
  return tokenCache.value;
}

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  Accept: '*/*',
  'X-Country': airtel.country,
  'X-Currency': airtel.currency,
});

async function requestPayment({ reference, amount, phoneLocal }) {
  assertConfigured();
  const token = await getToken();
  const transactionId = `BAY${Date.now()}${crypto.randomInt(100, 999)}`;

  const res = await operatorFetch(`${airtel.baseUrl}/merchant/v1/payments/`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      reference,
      subscriber: {
        country: airtel.country,
        currency: airtel.currency,
        msisdn: phoneLocal.replace(/^0/, ''), // Airtel attend le numéro sans indicatif ni 0 initial
      },
      transaction: { amount, country: airtel.country, currency: airtel.currency, id: transactionId },
    }),
  }).catch((err) => {
    err.providerRef = transactionId; // pour pouvoir vérifier plus tard si Airtel a bien reçu la demande
    throw err;
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.status?.success === false) {
    throw new Error(`Airtel payment: HTTP ${res.status} ${JSON.stringify(data)}`);
  }
  return { providerRef: transactionId };
}

async function getStatus(providerRef) {
  assertConfigured();
  const token = await getToken();
  const res = await operatorFetch(`${airtel.baseUrl}/standard/v1/payments/${providerRef}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`Airtel status: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  // Statuts Airtel : TS = succès, TF = échec, TA / TIP = en cours
  const code = data?.data?.transaction?.status;
  const status = code === 'TS' ? 'SUCCESSFUL' : code === 'TF' ? 'FAILED' : 'PENDING';
  return { status, reason: data?.data?.transaction?.message || null, raw: data };
}

module.exports = { name: 'airtel', label: 'Airtel Money', requestPayment, getStatus };
