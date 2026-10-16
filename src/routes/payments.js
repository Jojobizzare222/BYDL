const crypto = require('crypto');
const router = require('express').Router();
const config = require('../config');
const { orders, payments, products, agencies } = require('../store');
const { getProvider, listOperators, cardAvailable, cardSimulation } = require('../payments');
const { normalizeLocal, detectOperator } = require('../utils/phone');
const { availableStock, isFreshPending } = require('../utils/stock');
const { hasAccess } = require('./orders');
const { notifyPaidOrder, notifyReservation } = require('../notify');

router.get('/operators', (req, res) => {
  res.json({ mode: config.paymentMode, operators: listOperators() });
});

// Moyens de paiement proposés sur la page commande (les espèces seulement s'il existe une agence active).
router.get('/methods', (req, res) => {
  const active = agencies.all().filter((a) => a.active !== false);
  res.json({
    mode: config.paymentMode,
    momo: true,
    card: cardAvailable(),
    cash: active.length > 0,
    pickupHoldHours: config.pickupHoldHours,
    agencies: active.map(({ id, name, city, address, hours, phone }) => ({ id, name, city, address, hours, phone })),
  });
});

// 1) Demande de paiement. method = 'momo' (défaut) | 'card' | 'cash'
//    - momo : l'opérateur envoie une demande de validation (code PIN) sur le téléphone du client ;
//    - card : le client est redirigé vers la page sécurisée du prestataire ;
//    - cash : l'article est réservé, le client paie en espèces à l'agence (l'admin confirme).
router.post('/', async (req, res) => {
  const { orderId, phone, operator, token, method = 'momo', agencyId } = req.body || {};
  if (!['momo', 'card', 'cash'].includes(method)) return res.status(400).json({ error: 'Moyen de paiement inconnu' });
  const order = orders.get(orderId);
  if (!order || !hasAccess(order, token)) return res.status(404).json({ error: 'Commande introuvable' });

  // Anti double paiement : avant toute nouvelle demande, on revérifie les demandes déjà envoyées pour cette commande.
  const previous = payments.all().filter((p) => p.orderId === order.id && p.status === 'PENDING');
  for (const p of previous) {
    try {
      await refreshStatus(p);
    } catch (err) {
      console.error('[paiement] vérification impossible :', err.message);
    }
  }
  if (orders.get(order.id).status !== 'pending_payment') {
    return res.status(409).json({ error: 'Cette commande est déjà réglée ou annulée', orderStatus: orders.get(order.id).status });
  }
  // Une demande encore en attente : on ne la double pas (le client doit la valider ou la laisser expirer).
  // Exception : une réservation en agence peut être remplacée par un paiement en ligne (le client change d'avis).
  const stillPending = payments.all().find((p) => p.orderId === order.id && isFreshPending(p));
  if (stillPending) {
    if (stillPending.operator === 'cash' && method !== 'cash') {
      payments.update(stillPending.id, { status: 'CANCELLED', reason: 'Remplacé par un paiement en ligne' });
    } else {
      return res.status(200).json({ ...publicPayment(stillPending), resumed: true });
    }
  }

  // Moyen de paiement : vérifications propres à chacun
  let op = method;
  let phoneLocal = null;
  let agency = null;
  if (method === 'momo') {
    phoneLocal = normalizeLocal(phone);
    if (!phoneLocal) return res.status(400).json({ error: 'Numéro Mobile Money invalide' });
    op = operator || detectOperator(phoneLocal);
    if (!op || !['mtn', 'airtel'].includes(op)) return res.status(400).json({ error: "Impossible de reconnaître l'opérateur de ce numéro" });
    const detected = detectOperator(phoneLocal);
    if (detected && detected !== op) {
      return res.status(400).json({ error: `Ce numéro semble être un numéro ${detected.toUpperCase()}, pas ${op.toUpperCase()}` });
    }
  } else if (method === 'card') {
    if (!cardAvailable()) return res.status(400).json({ error: "Le paiement par carte n'est pas encore disponible" });
  } else {
    agency = agencies.get(agencyId);
    if (!agency || agency.active === false) return res.status(400).json({ error: 'Choisissez une agence de retrait' });
  }

  // Le stock a pu partir depuis la création de la commande (autre client en train de payer).
  for (const line of order.lines) {
    const product = products.get(line.productId);
    if (!product || line.qty > availableStock(product, order.id)) {
      return res.status(409).json({ error: `Stock insuffisant pour ${line.name}. Retirez-le du panier ou réessayez plus tard.` });
    }
  }

  const now = Date.now();
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
    createdAt: new Date(now).toISOString(),
  };

  // Mode de remise de la commande : retrait en agence (espèces) ou livraison (paiement en ligne)
  if (method === 'cash') {
    payment.expiresAt = new Date(now + config.pickupHoldHours * 3600 * 1000).toISOString();
    const { id, name, city, address, hours, phone: agencyPhone } = agency;
    orders.update(order.id, {
      fulfillment: 'pickup',
      agency: { id, name, city, address, hours, phone: agencyPhone },
      pickupDeadline: payment.expiresAt,
    });
  } else if (order.fulfillment === 'pickup') {
    orders.update(order.id, { fulfillment: 'delivery', agency: null, pickupDeadline: null });
  }

  try {
    const provider = getProvider(op);
    const { providerRef, redirectUrl } = await provider.requestPayment({
      paymentId: payment.id,
      reference: order.id,
      amount: order.total,
      phoneLocal,
      description: `${config.shopName} - commande ${order.id}`,
      callbackUrl: `${config.publicUrl}/api/payments/callback/${op}`,
    });
    payment.providerRef = providerRef;
    payments.insert(payment);
    if (method === 'cash') notifyReservation(orders.get(order.id)); // l'admin prépare l'article
    res.status(201).json({ ...publicPayment(payment), redirectUrl: redirectUrl || null });
  } catch (err) {
    // Pas de réponse (délai dépassé, réseau) : l'opérateur a peut-être reçu la demande.
    // On l'enregistre quand même pour pouvoir vérifier son statut, sinon un paiement pourrait être perdu.
    if (err.uncertain && err.providerRef) {
      console.error('[paiement] réponse opérateur incertaine, vérification ultérieure :', err.message);
      payment.providerRef = err.providerRef;
      payments.insert(payment);
      return res.status(201).json(publicPayment(payment));
    }
    console.error('[paiement] échec de la demande :', err.message);
    res.status(502).json({ error: "Le paiement n'a pas pu être lancé. Réessayez dans un instant." });
  }
});

// Page de paiement par carte SIMULÉE (mode simulation uniquement) : le « client » accepte ou refuse.
router.post('/:id/simulate-card', (req, res) => {
  const payment = payments.get(req.params.id);
  if (config.paymentMode === 'live' || !payment || payment.operator !== 'card') return res.status(404).json({ error: 'Introuvable' });
  if (!cardSimulation.decide(payment.providerRef, req.body?.approve)) return res.status(409).json({ error: 'Paiement déjà traité' });
  res.json({ ok: true, orderId: payment.orderId });
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
  const { status, reason } = await getProvider(payment.operator).getStatus(payment.providerRef, payment);
  if (status === 'PENDING') return payment;

  payments.update(payment.id, { status, reason });
  if (status === 'SUCCESSFUL') settleSuccessfulPayment(payment);
  return payment;
}

// Paiement confirmé (opérateur, prestataire carte, ou espèces reçues en agence) : commande payée + stock décompté.
function settleSuccessfulPayment(payment) {
  const order = orders.get(payment.orderId);
  if (order && order.status === 'pending_payment') {
    const now = new Date().toISOString();
    const paid = orders.update(order.id, {
      status: 'paid',
      paidAt: now,
      paymentId: payment.id,
      history: [...(order.history || []), { status: 'paid', at: now }],
    });
    // Décrément du stock
    for (const line of order.lines) {
      const p = products.get(line.productId);
      if (p && p.stock != null) products.update(p.id, { stock: Math.max(0, p.stock - line.qty) });
    }
    notifyPaidOrder(paid); // sans attendre : l'e-mail ne doit pas ralentir le client
    return paid;
  }
  if (order && order.status === 'cancelled' && !order.paidAfterCancel) {
    // Commande annulée par l'admin, mais le client a quand même validé le paiement : à rembourser.
    const flagged = orders.update(order.id, { paidAfterCancel: true, paymentId: payment.id });
    notifyPaidOrder(flagged, { afterCancel: true });
  }
  return order;
}

const publicPayment = (p) => ({
  id: p.id,
  orderId: p.orderId,
  operator: p.operator,
  amount: p.amount,
  currency: p.currency,
  status: p.status,
  reason: p.reason,
  expiresAt: p.expiresAt || null,
});

module.exports = router;
module.exports.settleSuccessfulPayment = settleSuccessfulPayment;
module.exports.refreshStatus = refreshStatus;
