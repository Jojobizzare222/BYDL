// MTN Mobile Money — API "Collection" (Request to Pay)
// Doc : https://momodeveloper.mtn.com/api-documentation
const crypto = require('crypto');
const { mtn } = require('../../config');
const { toInternational } = require('../../utils/phone');

let tokenCache = { value: null, expiresAt: 0 };

function assertConfigured() {
  if (!mtn.subscriptionKey || !mtn.apiUser || !mtn.apiKey) {
    throw new Error('MTN MoMo non configuré : renseignez MTN_SUBSCRIPTION_KEY, MTN_API_USER et MTN_API_KEY dans .env');
  }
}

async function getToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const basic = Buffer.from(`${mtn.apiUser}:${mtn.apiKey}`).toString('base64');
  const res = await fetch(`${mtn.baseUrl}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': mtn.subscriptionKey,
    },
  });
  if (!res.ok) throw new Error(`MTN token: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
  };
  return tokenCache.value;
}

async function requestPayment({ reference, amount, phoneLocal, description, callbackUrl }) {
  assertConfigured();
  const token = await getToken();
  const referenceId = crypto.randomUUID(); // identifiant de la transaction côté MTN

  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Reference-Id': referenceId,
    'X-Target-Environment': mtn.targetEnv,
    'Ocp-Apim-Subscription-Key': mtn.subscriptionKey,
    'Content-Type': 'application/json',
  };
  // La sandbox refuse les callbacks vers un hôte non déclaré : on ne l'envoie qu'en production.
  if (mtn.targetEnv !== 'sandbox' && callbackUrl) headers['X-Callback-Url'] = callbackUrl;

  const res = await fetch(`${mtn.baseUrl}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      amount: String(amount),
      currency: mtn.currency,
      externalId: reference,
      payer: { partyIdType: 'MSISDN', partyId: toInternational(phoneLocal) },
      payerMessage: description.slice(0, 160),
      payeeNote: reference,
    }),
  });
  if (res.status !== 202) throw new Error(`MTN requesttopay: HTTP ${res.status} ${await res.text()}`);
  return { providerRef: referenceId };
}

async function getStatus(providerRef) {
  assertConfigured();
  const token = await getToken();
  const res = await fetch(`${mtn.baseUrl}/collection/v1_0/requesttopay/${providerRef}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Target-Environment': mtn.targetEnv,
      'Ocp-Apim-Subscription-Key': mtn.subscriptionKey,
    },
  });
  if (!res.ok) throw new Error(`MTN status: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  // Statuts MTN : PENDING | SUCCESSFUL | FAILED
  const status = ['SUCCESSFUL', 'FAILED'].includes(data.status) ? data.status : 'PENDING';
  return { status, reason: data.reason || null, raw: data };
}

module.exports = { name: 'mtn', label: 'MTN Mobile Money', requestPayment, getStatus };
