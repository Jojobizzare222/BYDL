const crypto = require('crypto');
const { feeFor } = require('../fees');
const router = require('express').Router();
const config = require('../config');
const { orders, payments, products, agencies } = require('../store');
const { getProvider, listOperators, cardAvailable, cardSimulation } = require('../payments');
const { normalizeLocal, detectOperator } = require('../utils/phone');
const { availableStock, isFreshPending } = require('../utils/stock');
const { hasAccess } = require('./orders');
const { notifyPaidOrder, notifyReservation } = require('../notify');
const delivery = require('../delivery');
const { salesSettings, methodAllowed } = require('../sales');
const { staff, customers } = require('../store');
const mobilePay = require('../mobile-pay');

router.get('/operators', (req, res) => {
  res.json({ mode: config.paymentMode, operators: listOperators() });
});

// Moyens de paiement proposés sur la page commande (les espèces seulement s'il existe une agence active).
router.get('/methods', (req, res) => {
  const active = agencies.all().filter((a) => a.active !== false);
  const allowed = salesSettings().methods; // réglé dans Zado Pro → Réglages (par défaut : espèces en agence seulement)
  const cod = delivery.codSettings();
  res.json({
    mode: config.paymentMode,
    momo: allowed.momo,
    card: allowed.card && cardAvailable(),
    cash: allowed.cash && active.length > 0,
    cashDelivery: true, // espèces : le client choisit retrait en agence OU livraison à domicile après paiement
    cod: { enabled: allowed.cod && cod.enabled, deposit: cod.deposit, depositPercent: cod.depositPercent },
    // Mobile Money en deux temps : acompte puis le reste par retrait (demande sur le téléphone) ou par dépôt (numéro de Zado)
    mobile: (() => { const m = mobilePay.mobileSettings(); return { enabled: allowed.mobile, deposit: m.deposit, push: Boolean(m.numbers.mtn || m.numbers.airtel), modes: mobilePay.MODES }; })(),
    accountRequired: salesSettings().accountRequired,
    pickupHoldHours: config.pickupHoldHours,
    agencies: active.map(({ id, name, city, address, hours, phone, kind, lat, lng }) => ({ id, name, city, address, hours, phone, kind: kind || 'agency', lat: lat ?? null, lng: lng ?? null })),
  });
});

// 1) Demande de paiement. method = 'momo' (défaut) | 'card' | 'cash' | 'cod'
//    - cod : paiement à la réception ; acompte Mobile Money pour un nouveau client, rien pour un client fiable.
//    - momo : l'opérateur envoie une demande de validation (code PIN) sur le téléphone du client ;
//    - card : le client est redirigé vers la page sécurisée du prestataire ;
//    - cash : l'article est réservé, le client paie en espèces à l'agence (l'admin confirme).
router.post('/', async (req, res) => {
  const { orderId, phone, operator, token, method = 'momo', agencyId, fulfillment, mode } = req.body || {};
  const payMode = mode === 'push' ? 'push' : 'pull'; // Mobile Money en deux temps : retrait (pull) ou dépôt (push)
  if (!['momo', 'card', 'cash', 'cod', 'mobile'].includes(method)) return res.status(400).json({ error: 'Moyen de paiement inconnu' });
  if (!methodAllowed(method)) return res.status(400).json({ error: "Ce moyen de paiement n'est pas proposé pour le moment" });
  // Espèces en agence : retrait à l'agence (par défaut) ou livraison à domicile une fois payé
  const cashMode = method === 'cash' && fulfillment === 'delivery' ? 'delivery' : 'pickup';
  let order = orders.get(orderId);
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

  if (method === 'cash' && cashMode === 'delivery' && !(order.customer?.address && order.customer.address.trim())) {
    return res.status(400).json({ error: "Indiquez votre adresse de livraison (quartier, repère)" });
  }
  // Paiement à la réception : acompte selon la fiabilité du client (règles réglables dans l'espace pro)
  let quote = null;
  if (method === 'cod') {
    quote = delivery.codQuote(order);
    if (!quote.allowed) return res.status(403).json({ error: quote.reason });
  }

  // Moyen de paiement : vérifications propres à chacun
  let op = method;
  let phoneLocal = null;
  let agency = null;
  if (method === 'mobile' && payMode === 'push' && !mobilePay.depositNumber(detectOperator(normalizeLocal(phone)) || operator || 'mtn')) {
    return res.status(400).json({ error: "Le dépôt n'est pas encore possible (numéro de Zado non renseigné) : choisissez « Par retrait »" });
  }
  if (method === 'momo' || method === 'mobile' || (method === 'cod' && quote.deposit > 0)) {
    phoneLocal = normalizeLocal(phone);
    if (!phoneLocal) return res.status(400).json({ error: 'Numéro Mobile Money invalide' });
    op = operator || detectOperator(phoneLocal);
    if (!op || !['mtn', 'airtel'].includes(op)) return res.status(400).json({ error: "Impossible de reconnaître l'opérateur de ce numéro" });
    const detected = detectOperator(phoneLocal);
    if (detected && detected !== op) {
      return res.status(400).json({ error: `Ce numéro semble être un numéro ${detected.toUpperCase()}, pas ${op.toUpperCase()}` });
    }
  } else if (method === 'cod') {
    op = null; // client fiable : pas d'acompte
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

  // Frais de livraison (src/fees.js) : calculés ICI selon la ville / le quartier ; retrait au point relais = gratuit
  {
    const subtotal = order.subtotal ?? order.lines.reduce((n, l) => n + l.total, 0);
    const willDeliver = method !== 'cash' || cashMode === 'delivery';
    const f = willDeliver ? feeFor(order.customer?.city, order.customer?.zone, subtotal) : { deliverable: true, fee: 0 };
    if (!f.deliverable) return res.status(400).json({ error: `Pas encore de livraison à ${order.customer?.city || 'cette ville'} : choisissez le retrait au point relais.`, noDelivery: true });
    const transport = order.transportFee || 0; // transport France → Pointe-Noire, fixé à la création de la commande
    if (order.deliveryFee !== f.fee || order.total !== subtotal + transport + f.fee) order = orders.update(order.id, { subtotal, deliveryFee: f.fee, total: subtotal + transport + f.fee });
  }

  // Plan de paiement de la commande : à la réception (acompte + reste) ou payée en ligne / en agence
  if (method === 'cod') {
    if (order.fulfillment === 'pickup') orders.update(order.id, { fulfillment: 'delivery', agency: null, pickupDeadline: null });
    orders.update(order.id, { paymentPlan: 'cod', deposit: quote.deposit, balance: order.total - quote.deposit });
    if (quote.deposit === 0) {
      const confirmed = delivery.confirmCod(orders.get(order.id));
      notifyPaidOrder(confirmed);
      return res.status(201).json({ id: null, orderId: order.id, operator: 'cod', amount: 0, currency: order.currency, status: 'SUCCESSFUL', reason: null, cod: true, deposit: 0 });
    }
  } else if (method === 'mobile') {
    if (order.fulfillment === 'pickup') orders.update(order.id, { fulfillment: 'delivery', agency: null, pickupDeadline: null });
    const deposit = Math.min(order.total, mobilePay.mobileSettings().deposit);
    order = orders.update(order.id, { paymentPlan: 'mobile', payMode, payPhone: phoneLocal, payOperator: op, deposit, balance: order.total - deposit });
    if (deposit === 0) { // acompte réglé à 0 dans Zado Pro : commande confirmée tout de suite, on passe au reste
      const confirmed = afterDeposit(orders.get(order.id), null);
      return res.status(201).json({ id: null, orderId: order.id, operator: payMode === 'push' ? 'transfer' : op, amount: 0, currency: order.currency, status: 'SUCCESSFUL', reason: null, mobile: true, deposit: 0, orderStatus: confirmed.status });
    }
  } else if (['cod', 'mobile'].includes(order.paymentPlan)) {
    orders.update(order.id, { paymentPlan: null, deposit: null, balance: null, payMode: null });
  }
  const amount = method === 'cod' || method === 'mobile' ? orders.get(order.id).deposit : order.total;
  if (method === 'mobile' && payMode === 'push') op = 'transfer'; // dépôt : le client envoie l'argent lui-même

  const now = Date.now();
  const payment = {
    id: 'PAY-' + crypto.randomUUID(),
    orderId: order.id,
    operator: op,
    phone: phoneLocal,
    purpose: method === 'cod' || method === 'mobile' ? 'deposit' : 'full',
    ...(op === 'transfer' ? { network: detectOperator(phoneLocal) || operator || 'mtn', expiresAt: new Date(now + mobilePay.mobileSettings().transferHours * 3600e3).toISOString() } : {}),
    amount,
    currency: order.currency,
    status: 'PENDING',
    providerRef: null,
    reason: null,
    createdAt: new Date(now).toISOString(),
  };

  // Mode de remise de la commande : retrait en agence (espèces) ou livraison (paiement en ligne)
  if (method === 'cash') {
    payment.expiresAt = new Date(now + config.pickupHoldHours * 3600 * 1000).toISOString();
    const { id, name, city, address, hours, phone: agencyPhone, kind, lat, lng } = agency;
    orders.update(order.id, {
      fulfillment: cashMode, // 'pickup' : retiré au point relais · 'delivery' : payé au point relais puis livré
      agency: { id, name, city, address, hours, phone: agencyPhone, kind: kind || 'agency', lat: lat ?? null, lng: lng ?? null },
      pickupDeadline: payment.expiresAt, // date limite pour venir payer
    });
  } else if (order.fulfillment === 'pickup' || order.agency) {
    orders.update(order.id, { fulfillment: 'delivery', agency: null, pickupDeadline: null });
  }

  try {
    const provider = getProvider(op);
    const { providerRef, redirectUrl } = await provider.requestPayment({
      paymentId: payment.id,
      reference: order.id,
      amount,
      phoneLocal,
      description: `${config.shopName} - ${method === 'cod' || method === 'mobile' ? 'acompte ' : ''}commande ${order.id}`,
      callbackUrl: `${config.publicUrl}/api/payments/callback/${op}`,
    });
    payment.providerRef = providerRef;
    payments.insert(payment);
    if (method === 'cash') notifyReservation(orders.get(order.id)); // l'admin prépare l'article
    if (op === 'transfer') notifyCustomerTransfer(orders.get(order.id), payment); // instructions de dépôt dans « Aide »
    res.status(201).json({ ...publicPayment(payment), redirectUrl: redirectUrl || null, cod: method === 'cod', mobile: method === 'mobile', deposit: method === 'cod' || method === 'mobile' ? amount : undefined });
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

// Coût d'achat figé au moment de la vente (volet Finances) : prix fournisseur pour un produit de fournisseur,
// sinon prix d'achat saisi par l'admin. Ne sort JAMAIS vers le client (voir clientLines dans routes/orders.js).
function costSnapshot(p) {
  if (!p) return { unitCost: null, supplierId: null };
  const cost = p.supplierId ? p.supplierPrice : p.costPrice;
  return { unitCost: Number.isInteger(cost) ? cost : null, supplierId: p.supplierId || null };
}

// Paiement confirmé (opérateur, prestataire carte, ou espèces reçues en agence) : commande payée + stock décompté.
function settleSuccessfulPayment(payment) {
  const order = orders.get(payment.orderId);
  // Reste payé en Mobile Money devant le livreur : la commande est livrée
  if (order && payment.purpose === 'balance') {
    if (!['delivered', 'cancelled'].includes(order.status)) {
      const by = staff.get(payment.collectorId) || (payment.collectorId === 'admin' ? { id: 'admin', role: 'admin' } : null);
      return delivery.finishDelivery(order, { by, balance: { method: 'momo', paymentId: payment.id } });
    }
    return order;
  }
  // Mobile Money en deux temps : le reste est arrivé → commande payée
  if (order && payment.purpose === 'rest') {
    if (['confirmed', 'pending_payment'].includes(order.status) && order.paymentPlan === 'mobile') {
      const now = new Date().toISOString();
      const paid = orders.update(order.id, {
        status: 'paid', paidAt: now,
        balancePaid: { method: payment.operator === 'transfer' ? 'transfer' : 'momo', at: now, paymentId: payment.id, operator: payment.operator === 'transfer' ? payment.network : payment.operator },
        lines: order.lines.map((l) => (l.productId ? { ...l, ...costSnapshot(products.get(l.productId)) } : l)),
        history: [...(order.history || []), { status: 'paid', at: now }],
      });
      notifyPaidOrder(paid);
      tellCustomer(paid, `Paiement complet reçu pour la commande ${paid.id} ✓ Merci ! Votre commande est en préparation, nous vous prévenons dès qu'elle part en livraison.`);
      return paid;
    }
    return order;
  }
  // Mobile Money en deux temps : acompte reçu → commande confirmée, récapitulatif, puis le reste
  if (order && order.status === 'pending_payment' && order.paymentPlan === 'mobile' && payment.purpose === 'deposit') return afterDeposit(order, payment.id);
  // Acompte reçu : commande à payer à la réception confirmée (articles réservés, à livrer)
  if (order && order.status === 'pending_payment' && order.paymentPlan === 'cod' && payment.purpose === 'deposit') {
    const confirmed = delivery.confirmCod(order, { depositPaymentId: payment.id });
    notifyPaidOrder(confirmed);
    return confirmed;
  }
  if (order && order.status === 'pending_payment') {
    const now = new Date().toISOString();
    const paid = orders.update(order.id, {
      status: 'paid',
      paidAt: now,
      lines: order.lines.map((l) => (l.productId ? { ...l, ...costSnapshot(products.get(l.productId)) } : l)),
      paymentId: payment.id,
      history: [...(order.history || []), { status: 'paid', at: now }],
    });
    // Décrément du stock
    for (const line of order.lines) {
      const p = products.get(line.productId);
      if (p && p.stock != null) require('../stock-moves').moveStock(p.id, -line.qty, { reason: 'sale', ref: order.id });
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

// ---------- Mobile Money en deux temps (décision Joseph 21/10/2026) ----------
const fm = (n) => `${Number(n || 0).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} FCFA`;
const OPN = { mtn: 'MTN Mobile Money', airtel: 'Airtel Money' };
function tellCustomer(order, text) {
  try {
    const c = order.customerId && customers.get(order.customerId);
    if (!c) return;
    require('../chat').notifyCustomer(c, text, { links: [{ label: 'Suivre ma commande', href: `#/suivi/${order.id}` }] });
    require('../push').notifyCustomer(c.id, `Commande ${order.id}`, text.split('\n')[0].slice(0, 140), `/#/suivi/${order.id}`, `zado-cmd-${order.id}`);
  } catch (err) { console.error('[message client]', err.message); }
}
/** Récapitulatif envoyé au client quand l'acompte confirme la commande. */
function recapText(o) {
  const lines = o.lines.map((l) => `• ${l.qty} × ${l.name}${l.variant ? ` (${l.variant})` : ''} : ${fm(l.total)}`).join('\n');
  return [`Commande ${o.id} confirmée ✓ Merci ${String(o.customer?.name || '').split(' ')[0]} !`, '', 'Récapitulatif :', lines,
    o.transportFee ? `• Transport France → Pointe-Noire (${String(o.transportKg).replace('.', ',')} kg facturés) : ${fm(o.transportFee)}` : null,
    o.deliveryFee ? `• Livraison : ${fm(o.deliveryFee)}` : null,
    `Total : ${fm(o.total)}`, `Acompte reçu : − ${fm(o.deposit)}`, `Reste à payer : ${fm(o.balance)}`].filter((x) => x !== null).join('\n');
}
function instructionsText(o, p) {
  if (o.payMode === 'push') {
    const d = mobilePay.depositNumber(p?.network || o.payOperator);
    return d ? `Pour finaliser : envoyez ${fm(p?.amount ?? o.balance)} par dépôt ${OPN[d.operator]} au ${mobilePay.spaced(d.number)} (${d.holder}), en indiquant la référence ${o.id}. Zado confirme dès réception.`
      : 'Pour finaliser : un conseiller Zado vous indique le numéro de dépôt.';
  }
  return `Pour finaliser : une demande de ${fm(o.balance)} vient d'être envoyée sur votre téléphone (${OPN[o.payOperator] || 'Mobile Money'}). Tapez votre code secret pour valider.`;
}
function notifyCustomerTransfer(o, p) {
  const d = mobilePay.depositNumber(p.network || o.payOperator);
  tellCustomer(o, p.purpose === 'deposit'
    ? `Commande ${o.id} enregistrée. Pour la confirmer, envoyez l'acompte de ${fm(p.amount)} par dépôt ${OPN[d?.operator] || 'Mobile Money'} au ${mobilePay.spaced(d?.number) || '—'} (${d?.holder || 'Zado'}), référence ${o.id}.`
    : instructionsText(o, p));
}
/** Acompte reçu : commande confirmée (articles réservés), récapitulatif envoyé, puis demande du reste. */
function afterDeposit(order, depositPaymentId) {
  const confirmed = delivery.confirmCod(order, { depositPaymentId });
  notifyPaidOrder(confirmed);
  tellCustomer(confirmed, recapText(confirmed));
  if (confirmed.balance > 0) startRest(confirmed).catch((err) => console.error('[reste]', err.message));
  else settleSuccessfulPayment({ purpose: 'rest', orderId: confirmed.id, operator: confirmed.payOperator, id: null });
  return orders.get(confirmed.id);
}
/** Demande du reste : retrait (demande sur le téléphone) ou dépôt (attente de l'argent sur le numéro de Zado). */
async function startRest(order) {
  const o = orders.get(order.id);
  if (!o || o.paymentPlan !== 'mobile' || o.status !== 'confirmed' || !(o.balance > 0)) return null;
  const fresh = payments.all().find((p) => p.orderId === o.id && p.purpose === 'rest' && isFreshPending(p));
  if (fresh) return fresh;
  const push = o.payMode === 'push';
  const now = Date.now();
  const payment = { id: 'PAY-' + crypto.randomUUID(), orderId: o.id, operator: push ? 'transfer' : o.payOperator, phone: o.payPhone, purpose: 'rest', amount: o.balance, currency: o.currency, status: 'PENDING', providerRef: null, reason: null, createdAt: new Date(now).toISOString(),
    ...(push ? { network: o.payOperator, expiresAt: new Date(now + mobilePay.mobileSettings().transferHours * 3600e3).toISOString() } : {}) };
  try {
    const r = await getProvider(payment.operator).requestPayment({ paymentId: payment.id, reference: o.id, amount: payment.amount, phoneLocal: o.payPhone, description: `${config.shopName} - solde commande ${o.id}`, callbackUrl: `${config.publicUrl}/api/payments/callback/${payment.operator}` });
    payment.providerRef = r.providerRef;
  } catch (err) {
    if (!(err.uncertain && err.providerRef)) { payment.status = 'FAILED'; payment.reason = 'La demande n\'a pas pu être envoyée'; }
    else payment.providerRef = err.providerRef;
  }
  payments.insert(payment);
  orders.update(o.id, { restPaymentId: payment.id });
  if (payment.status === 'PENDING') tellCustomer(orders.get(o.id), instructionsText(orders.get(o.id), payment));
  return payment;
}
// Le client relance la demande du reste (retrait) ou consulte où en est son paiement (page de suivi)
router.post('/rest', async (req, res) => {
  const { orderId, token } = req.body || {};
  const order = orders.get(orderId);
  const owner = order && require('../customer/auth').currentCustomer(req)?.id === order.customerId && order.customerId;
  if (!order || !(hasAccess(order, token) || owner)) return res.status(404).json({ error: 'Commande introuvable' });
  if (order.paymentPlan !== 'mobile' || order.status !== 'confirmed') return res.status(409).json({ error: 'Aucun reste à payer pour cette commande', orderStatus: order.status });
  for (const p of payments.all().filter((x) => x.orderId === order.id && x.purpose === 'rest' && x.status === 'PENDING')) { try { await refreshStatus(p); } catch {} }
  const p = await startRest(orders.get(order.id));
  if (!p) return res.status(409).json({ error: 'Aucun reste à payer pour cette commande', orderStatus: orders.get(order.id).status });
  res.status(201).json(publicPayment(payments.get(p.id) || p));
});

const publicPayment = (p) => ({
  id: p.id,
  orderId: p.orderId,
  operator: p.operator,
  amount: p.amount,
  currency: p.currency,
  status: p.status,
  reason: p.reason,
  expiresAt: p.expiresAt || null,
  purpose: p.purpose || 'full', // 'deposit' = acompte · 'rest' = reste (Mobile Money en deux temps) · 'balance' = payé à la livraison
  ...(p.operator === 'transfer' ? { network: p.network || null, depositTo: (() => { const d = mobilePay.depositNumber(p.network || 'mtn'); return d ? { ...d, display: mobilePay.spaced(d.number) } : null; })() } : {}),
});

module.exports = router;
module.exports.settleSuccessfulPayment = settleSuccessfulPayment;
module.exports.refreshStatus = refreshStatus;
module.exports.startRest = startRest;
module.exports.recapText = recapText;
