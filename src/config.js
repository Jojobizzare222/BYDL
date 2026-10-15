require('dotenv').config();

const env = (key, fallback = '') => process.env[key] ?? fallback;

module.exports = {
  port: Number(env('PORT', 3000)),
  publicUrl: env('PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, ''),
  shopName: env('SHOP_NAME', 'Baydel'),
  currency: env('CURRENCY', 'XAF'),
  country: env('COUNTRY', 'CG'),
  paymentMode: env('PAYMENT_MODE', 'simulation'), // simulation | live
  // Durée pendant laquelle une demande de paiement en attente bloque une nouvelle demande et réserve le stock.
  paymentPendingMinutes: Number(env('PAYMENT_PENDING_MINUTES', 10)),
  // Délai maximal d'attente d'une réponse de MTN / Airtel.
  operatorTimeoutMs: Number(env('OPERATOR_TIMEOUT_MS', 15000)),

  // Alerte e-mail à chaque commande payée (ex. Gmail : smtp.gmail.com, port 465, « mot de passe d'application »)
  smtp: {
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT', 465)),
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS'),
    to: env('ALERT_EMAIL_TO'),
  },

  mtn: {
    baseUrl: env('MTN_BASE_URL', 'https://sandbox.momodeveloper.mtn.com'),
    targetEnv: env('MTN_TARGET_ENV', 'sandbox'),
    subscriptionKey: env('MTN_SUBSCRIPTION_KEY'),
    apiUser: env('MTN_API_USER'),
    apiKey: env('MTN_API_KEY'),
    currency: env('MTN_CURRENCY', 'EUR'),
  },

  airtel: {
    baseUrl: env('AIRTEL_BASE_URL', 'https://openapiuat.airtel.africa'),
    clientId: env('AIRTEL_CLIENT_ID'),
    clientSecret: env('AIRTEL_CLIENT_SECRET'),
    country: env('AIRTEL_COUNTRY', 'CG'),
    currency: env('AIRTEL_CURRENCY', 'XAF'),
  },
};
