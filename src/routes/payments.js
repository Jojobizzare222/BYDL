const crypto = require('crypto');
const router = require('express').Router();
const config = require('../config');
const { orders, payments, products } = require('../store');
const { getProvider, listOperators } = require('../payments');
const { normalizeLocal, detectOperator } = require('../utils/phone');

router.get('/operators', (req, res) => {
  res.json({ mode: config.paymentMode, operators: listOperators() });
});

// 1) Le client choisit son opérateur et son numéro -> l'opérateur envoie une demande de validation (code PIN) sur son téléphone.
router.post('/', async (req, res) => {
  const { orderId, phone, operator } = req.body || {};
  const order = orders.get(orderId);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (order.status !== 'pending_payment') return res.status(409).json({ error: 'Cette commande est déjà réglée ou annulée' });

  const phoneLocal = normalizeLocal(phone);
  if (!phoneLocal) return res.status(400).json({ error: 'Numéro Mobile Money invalide' });

  const op = operator || detectOperator(phoneLocal);
  if (!op) return res.status(400).json({ error: "Impossible de reconnaître l'opérateur de ce numéro" });
  const detected = detectOperator(phoneLocal);
  if (detected && detected !== op) {
    return res.status(400).json({ error: `Ce numéro semble être un numéro ${detected.toUpperCase()}, pas ${op.toUpperCase()}` });
  }

  const payment = {
    id: 'PAY-' + crypto.randomUUID(),
    orderId: order.id,
    operator: op,
    phone: phoneLocal,
    amount: order.total,
    currency: order.currency,
    status: 'PENDING',
    providerRef: null,
    reason: null,
    createdAt: new Date().toISOString(),
  };

  try {
    const provider = getProvider(op);
    const { providerRef } = await provider.requestPayment({
      reference: order.id,
      amount: order.total,
      phoneLocal,
      description: `${config.shopName} - commande ${order.id}`,
      callbackUrl: `${config.publicUrl}/api/payments/callback/${op}`,
    });
    payment.providerRef = providerRef;
    payments.insert(payment);
    res.status(201).json(publicPayment(payment));
  } catch (err) {
    console.error('[paiement] échec de la demande :', err.message);
    res.status(502).json({ error: "L'opérateur n'a pas pu traiter la demande. Réessayez dans un instant." });
  }
});

// 2) Le navigateur interroge régulièrement le statut jusqu'à SUCCESSFUL ou FAILED.
router.get('/:id', async (req, res) => {
  const payment = payments.get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Paiement introuvable' });
  try {
    await refreshStatus(payment);
  } catch (err) {
    console.error('[paiement] vérification impossible :', err.message);
  }
  res.json(publicPayment(payments.get(payment.id)));
});

// 3) Notification envoyée par l'opérateur. On ne fait pas confiance au contenu :
//    on revérifie le statut directement auprès de l'API de l'opérateur.
router.post('/callback/:operator', async (req, res) => {
  const body = req.body || {};
  const ref =
    req.get('X-Reference-Id') ||
    body.referenceId ||
    body.financialTransactionId ||
    body?.transaction?.id;
  const payment =
    payments.find((p) => p.operator === req.params.operator && p.providerRef === ref) ||
    payments.find((p) => p.operator === req.params.operator && p.orderId === body.externalId && p.status === 'PENDING');
  if (payment) {
    try {
      await refreshStatus(payment);
    } catch (err) {
      console.error('[callback] vérification impossible :', err.message);
    }
  }
  res.sendStatus(200);
});

async function refreshStatus(payment) {
  if (payment.status !== 'PENDING') return payment;
  const { status, reason } = await getProvider(payment.operator).getStatus(payment.providerRef);
  if (status === 'PENDING') return payment;

  payments.update(payment.id, { status, reason });
  if (status === 'SUCCESSFUL') {
    const order = orders.get(payment.orderId);
    if (order && order.status === 'pending_payment') {
      orders.update(order.id, { status: 'paid', paidAt: new Date().toISOString(), paymentId: payment.id });
      // Décrément du stock
      for (const line of order.lines) {
        const p = products.get(line.productId);
        if (p && p.stock != null) products.update(p.id, { stock: Math.max(0, p.stock - line.qty) });
      }
    }
  }
  return payment;
}

const publicPayment = (p) => ({
  id: p.id,
  orderId: p.orderId,
  operator: p.operator,
  amount: p.amount,
  currency: p.currency,
  status: p.status,
  reason: p.reason,
});

module.exports = router;
