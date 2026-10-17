// API de l'espace admin (/api/admin/...). Tout est protégé par la connexion, sauf /login.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const { products, orders, payments, customers, agencies, staff, activity } = require('../store');
const { settleSuccessfulPayment, refreshStatus } = require('./payments');
const delivery = require('../delivery');
const { getProvider } = require('../payments');
const config = require('../config');
const customerAuth = require('../customer/auth');
const {
  ROLES, ADMIN_LOGIN, login, logout, currentUser, isPasswordSet, requireStaff, requireRole,
  hashPassword, checkPassword, tempPassword, normLogin, findStaff, closeSessionsOf,
} = require('../admin/auth');
const { UNIVERSES, universeOf } = require('../catalog');
const demo = require('../demo');
const { normalizeLocal, detectOperator } = require('../utils/phone');
const imp = require('../imports');
const scrape = require('../scrape');
const identity = require('../customer/identity');
const sales = require('../sales');

const UPLOAD_DIR = process.env.UPLOAD_DIR || (process.env.VERCEL ? '/tmp/kamwa-uploads' : path.join(__dirname, '..', '..', 'data', 'uploads'));

router.post('/login', login);
router.post('/logout', logout);
router.get('/me', (req, res) => {
  const user = currentUser(req);
  res.json({ loggedIn: Boolean(user), passwordSet: isPasswordSet(), user, roles: ROLES, demoAccounts: demo.publicAccounts() });
});

router.use(requireStaff);
// Volet Finances (administrateur uniquement)
router.use('/finance', requireRole(), require('./finance'));
// Achat en Europe (devis, agent Europe, envois)
router.use('/france', require('./import-admin'));
router.use('/chat', require('./chat-admin')); // messagerie : clients + salon de l'équipe
router.use('/trends', require('./trends-admin')); // agent Tendances (admin)
router.use('/documents', require('./documents-admin')); // factures, reçus, avoirs [admin, orders]

// Rafraîchissement instantané de Kamwa Pro : signaux filtrés selon le rôle (jamais de données dans le signal)
router.get('/events', (req, res) => {
  const u = req.user; const role = u.role;
  const ordersRole = ['admin', 'orders'].includes(role);
  require('../events').stream(req, res, ({ col, doc, before }) => {
    if (col === 'orders' || col === 'payments') {
      const o = col === 'payments' ? orders.get(doc.orderId) : doc;
      if (!o) return null;
      if (ordersRole) return { topic: 'orders', id: o.id };
      if (role === 'courier' && (o.courierId === u.id || before?.courierId === u.id)) return { topic: 'orders', id: o.id };
      if (role === 'agent' && o.import) return { topic: 'orders', id: o.id };
      if (role === 'supplier' && o.lines?.some((l) => l.supplierId === u.id || products.get(l.productId)?.supplierId === u.id)) return { topic: 'orders', id: o.id };
      return null;
    }
    if (col === 'products') return ['admin', 'catalog'].includes(role) || (role === 'supplier' && (doc.supplierId === u.id)) ? { topic: 'products', id: doc.id } : null;
    if (col === 'conversations') return doc.kind === 'team' ? (role !== 'supplier' ? { topic: 'team' } : null) : ordersRole ? { topic: 'chat', id: doc.id } : null;
    if (col === 'customers') return role === 'admin' ? { topic: 'customers', id: doc.id } : null;
    if (col === 'agencies') return role === 'admin' ? { topic: 'agencies' } : null;
    if (col === 'imports' || col === 'shipments') return ordersRole || role === 'agent' ? { topic: 'imports' } : null;
    if (col === 'ledger') return role === 'admin' ? { topic: 'finance' } : null;
    if (col === 'documents') return ordersRole ? { topic: 'documents', id: doc.orderId } : null;
    if (col === 'staff') return role === 'admin' && doc.livePos === before?.livePos ? { topic: 'staff' } : null;
    if (col === 'trends') return role === 'admin' && doc.status === 'new' ? { topic: 'trends' } : null;
    return null;
  });
});

// Journal : qui a fait quoi (gardé dans la base, consultable par l'admin)
function log(req, action, target, details = '') {
  activity.insert({
    id: 'ACT-' + crypto.randomBytes(6).toString('hex'),
    at: new Date().toISOString(),
    userId: req.user.id,
    userName: req.user.name + (req.user.company ? ` (${req.user.company})` : ''),
    role: req.user.role,
    action,
    targetId: target?.id || null,
    targetName: target?.name || target?.id || null,
    details,
  });
}

router.get('/meta', (req, res) => {
  const suppliers = req.user.role === 'admin' ? staff.all().filter((u) => u.role === 'supplier').map((u) => ({ id: u.id, name: u.company || u.name })) : [];
  res.json({ universes: UNIVERSES, suppliers });
});

// ---------- Commandes ----------
const STATUS_LABELS = { pending_payment: 'Non payée', paid: 'Payée', confirmed: 'Confirmée (à la réception)', shipped: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée' };
// Changements de statut autorisés (avec retour arrière possible en cas d'erreur de clic)
// « Livrée » ne se choisit plus à la main pour une livraison : le livreur valide avec le CODE du client
// (route /orders/:id/deliver ; l'admin peut forcer sans code, c'est alors noté).
const TRANSITIONS = {
  pending_payment: ['cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['paid', 'cancelled'],
  delivered: ['shipped'],
  cancelled: [],
};
// Paiement à la réception : confirmée (acompte reçu) -> en livraison -> livrée (code + reste encaissé)
const COD_TRANSITIONS = {
  pending_payment: ['cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['confirmed', 'cancelled'],
  delivered: [],
  cancelled: [],
};
// Retrait en agence : pas d'expédition, l'article est remis directement au client (« delivered » = remis).
const PICKUP_TRANSITIONS = {
  pending_payment: ['cancelled'],
  paid: ['delivered', 'cancelled'],
  delivered: ['paid'],
  cancelled: [],
};
const IMPORT_WAITING = { pending_payment: ['cancelled'], paid: ['cancelled'], cancelled: [] }; // achat en Europe pas encore arrivé au Congo
const transitionsFor = (order) => (order.import && order.import.stage !== 'arrived' ? IMPORT_WAITING : order.fulfillment === 'pickup' ? PICKUP_TRANSITIONS : order.paymentPlan === 'cod' ? COD_TRANSITIONS : TRANSITIONS);

// Commande vue par l'équipe. Le code de livraison n'est montré qu'à l'admin (jamais aux employés ni aux livreurs).
function adminOrder({ accessToken, ...order }, user) {
  if (user?.role !== 'admin') delete order.deliveryCode;
  order.reliability = delivery.reliability(order.customer?.phone);
  order.courierName = delivery.courierName(order.courierId);
  order.toCollect = delivery.amountToCollect(order);
  order.transitions = transitionsFor(order)[order.status] || [];
  const payment =
    (order.paymentId && payments.get(order.paymentId)) ||
    payments.all().filter((p) => p.orderId === order.id).pop();
  const account = order.customerId && customers.get(order.customerId);
  return {
    ...order,
    payment: payment ? { operator: payment.operator, phone: payment.phone, status: payment.status, reason: payment.reason, expiresAt: payment.expiresAt || null } : null,
    account: account ? customerAuth.publicCustomer(account) : null,
    documents: ['admin', 'orders'].includes(user?.role) ? require('../billing').forOrder(order.id).map(require('./documents-admin').summary) : [],
  };
}

router.get('/orders', requireRole('orders'), (req, res) => {
  const list = orders.all().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ orders: list.map((o) => adminOrder(o, req.user)), statusLabels: STATUS_LABELS, transitions: TRANSITIONS, pickupTransitions: PICKUP_TRANSITIONS, failReasons: delivery.FAIL_REASONS });
});

router.patch('/orders/:id', requireRole('orders'), (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  const { status, customer, note } = req.body || {};
  const patch = {};

  if (status && status !== order.status) {
    if (!transitionsFor(order)[order.status]?.includes(status)) {
      return res.status(400).json({ error: `Impossible de passer de « ${STATUS_LABELS[order.status]} » à « ${STATUS_LABELS[status] || status} »` });
    }
    const now = new Date().toISOString();
    patch.status = status;
    patch.history = [...(order.history || []), { status, at: now }];
    // Annulation d'une commande déjà payée : on remet les articles en stock (le remboursement se fait à la main).
    if (status === 'cancelled' && ['paid', 'confirmed', 'shipped', 'delivered'].includes(order.status)) delivery.restoreStock(order.lines);
  }

  if (customer) {
    const c = { ...order.customer };
    if ('name' in customer) {
      if (!String(customer.name).trim()) return res.status(400).json({ error: 'Nom obligatoire' });
      c.name = String(customer.name).trim().slice(0, 120);
    }
    if ('phone' in customer) {
      const phone = normalizeLocal(customer.phone);
      if (!phone) return res.status(400).json({ error: 'Numéro de téléphone invalide' });
      c.phone = phone;
    }
    if ('city' in customer) c.city = String(customer.city || '').trim().slice(0, 60);
    if ('address' in customer) c.address = String(customer.address || '').trim().slice(0, 300);
    patch.customer = c;
  }
  if (note !== undefined) patch.note = String(note || '').trim().slice(0, 1000);

  const updated = orders.update(order.id, patch);
  const what = [patch.status && `statut : ${STATUS_LABELS[order.status]} → ${STATUS_LABELS[patch.status]}`, patch.customer && 'coordonnées client modifiées', 'note' in patch && 'note modifiée'].filter(Boolean).join(' ; ');
  if (what) log(req, 'Commande modifiée', { id: order.id, name: order.id }, what);
  res.json(adminOrder(updated, req.user));
});

// Espèces reçues en agence : le paiement est confirmé à la main par l'admin.
router.post('/orders/:id/cash-received', requireRole('orders'), (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (order.status !== 'pending_payment') return res.status(400).json({ error: 'Cette commande est déjà payée ou annulée' });
  // Dernière réservation en espèces (même expirée : si le client vient quand même et paie, on encaisse)
  const cash = payments.all().filter((p) => p.orderId === order.id && p.operator === 'cash' && p.status !== 'CANCELLED').pop();
  if (!cash) return res.status(400).json({ error: "Cette commande n'est pas une réservation en agence" });
  payments.update(cash.id, { status: 'SUCCESSFUL', reason: null, confirmedAt: new Date().toISOString(), confirmedBy: req.user.name || 'Kamwa' });
  settleSuccessfulPayment(payments.get(cash.id));
  log(req, 'Paiement en espèces encaissé', { id: order.id, name: order.id }, `${order.total} FCFA`);
  res.json(adminOrder(orders.get(order.id), req.user));
});

// ---------- Livraison sécurisée : appel de confirmation, livreur, code de livraison ----------
const isDeliveryOrder = (o) => o.fulfillment !== 'pickup';
const readyToDeliver = (o) => ['paid', 'confirmed', 'shipped'].includes(o.status) && (!o.import || o.import.stage === 'arrived');
const actor = (req) => ({ id: req.user.id, role: req.user.role, name: req.user.name });

router.get('/couriers', requireRole('orders'), (req, res) => {
  res.json(staff.all().filter((u) => u.role === 'courier' && u.active !== false).map((u) => ({ id: u.id, name: u.name, phone: u.phone || null })));
});

// Appel au client avant d'envoyer le livreur (ou appel sans réponse)
router.post('/orders/:id/call', requireRole('orders'), (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  const ok = req.body?.result !== 'injoignable';
  const now = new Date().toISOString();
  const updated = orders.update(o.id, ok
    ? { callConfirmedAt: now, callConfirmedBy: req.user.name }
    : { callAttempts: [...(o.callAttempts || []), { at: now, by: req.user.name }] });
  log(req, ok ? 'Commande confirmée par téléphone' : 'Client injoignable au téléphone', { id: o.id, name: o.id });
  res.json(adminOrder(updated, req.user));
});

// Confier la commande à un livreur : elle passe « En livraison »
router.post('/orders/:id/assign', requireRole('orders'), (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  if (!isDeliveryOrder(o) || !readyToDeliver(o)) return res.status(400).json({ error: 'Cette commande ne peut pas partir en livraison' });
  const courier = staff.get(req.body?.courierId);
  if (!courier || courier.role !== 'courier' || courier.active === false) return res.status(400).json({ error: 'Choisissez un livreur' });
  const now = new Date().toISOString();
  const updated = orders.update(o.id, {
    courierId: courier.id, assignedAt: now, status: 'shipped',
    history: o.status === 'shipped' ? o.history : [...(o.history || []), { status: 'shipped', at: now }],
  });
  log(req, 'Commande confiée à un livreur', { id: o.id, name: o.id }, courier.name);
  res.json(adminOrder(updated, req.user));
});

// Remise du colis : code du client obligatoire ; encaissement du reste (espèces ou Mobile Money) si paiement à la réception
async function deliverHandler(req, res, order, { courierOnly = false } = {}) {
  if (!isDeliveryOrder(order) || !readyToDeliver(order)) return res.status(400).json({ error: 'Cette commande ne peut pas être livrée (déjà livrée, annulée ou non payée)' });
  if (courierOnly && order.status !== 'shipped') return res.status(400).json({ error: "Cette livraison n'est plus en cours" });
  const { code, collect, phone, force } = req.body || {};
  const forced = Boolean(force) && req.user.role === 'admin';
  const recentlyVerified = order.codeVerifiedAt && Date.now() - Date.parse(order.codeVerifiedAt) < 30 * 60 * 1000;
  if (!forced && !recentlyVerified) {
    const check = delivery.checkCode(order, code);
    if (check.error) {
      log(req, 'Code de livraison faux', { id: order.id, name: order.id }, check.error);
      return res.status(400).json({ error: check.error });
    }
  }
  const fresh = orders.get(order.id);
  const toCollect = delivery.amountToCollect(fresh);
  if (toCollect > 0 && collect === 'cash') {
    const done = delivery.finishDelivery(fresh, { by: actor(req), balance: { method: 'cash' }, forced });
    log(req, 'Commande livrée', { id: order.id, name: order.id }, `${toCollect} FCFA encaissés en espèces${forced ? ' (sans code, forcé par l\'admin)' : ''}`);
    return res.json({ delivered: true, order: done.id });
  }
  if (toCollect > 0 && collect === 'momo') {
    const phoneLocal = normalizeLocal(phone || fresh.customer.phone);
    const op = phoneLocal && detectOperator(phoneLocal);
    if (!op) return res.status(400).json({ error: 'Numéro Mobile Money invalide (06 MTN, 05/04 Airtel)' });
    const payment = {
      id: 'PAY-' + crypto.randomUUID(), orderId: order.id, operator: op, phone: phoneLocal, purpose: 'balance', collectorId: req.user.id,
      amount: toCollect, currency: fresh.currency, status: 'PENDING', providerRef: null, reason: null, createdAt: new Date().toISOString(),
    };
    try {
      const { providerRef } = await getProvider(op).requestPayment({
        paymentId: payment.id, reference: order.id, amount: toCollect, phoneLocal,
        description: `${config.shopName} - reste commande ${order.id}`, callbackUrl: `${config.publicUrl}/api/payments/callback/${op}`,
      });
      payment.providerRef = providerRef;
    } catch (err) {
      if (!(err.uncertain && err.providerRef)) return res.status(502).json({ error: "La demande Mobile Money n'a pas pu partir. Réessayez ou encaissez en espèces." });
      payment.providerRef = err.providerRef;
    }
    payments.insert(payment);
    log(req, 'Reste demandé en Mobile Money à la livraison', { id: order.id, name: order.id }, `${toCollect} FCFA`);
    return res.status(202).json({ pending: true, paymentId: payment.id, amount: toCollect });
  }
  if (toCollect > 0) return res.status(400).json({ error: `Encaissez d'abord ${toCollect} FCFA (espèces ou Mobile Money)`, toCollect });
  delivery.finishDelivery(fresh, { by: actor(req), forced });
  log(req, 'Commande livrée', { id: order.id, name: order.id }, forced ? 'sans code (forcé par l\'admin)' : 'code du client vérifié');
  res.json({ delivered: true, order: order.id });
}

router.post('/orders/:id/deliver', requireRole('orders'), (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  deliverHandler(req, res, o);
});
router.post('/orders/:id/fail', requireRole('orders'), (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  if (!isDeliveryOrder(o) || !readyToDeliver(o)) return res.status(400).json({ error: 'Cette commande ne peut pas être modifiée' });
  if (!delivery.FAIL_REASONS[req.body?.reason]) return res.status(400).json({ error: 'Choisissez la raison' });
  const updated = delivery.failDelivery(o, { by: actor(req), reason: req.body.reason, note: req.body.note });
  log(req, 'Livraison ratée', { id: o.id, name: o.id }, delivery.FAIL_REASONS[req.body.reason]);
  res.json(adminOrder(updated, req.user));
});
router.post('/orders/:id/unlock', requireRole(), (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  const updated = orders.update(o.id, { codeLocked: false, codeFails: 0 });
  log(req, 'Code de livraison débloqué', { id: o.id, name: o.id });
  res.json(adminOrder(updated, req.user));
});
// Suivi d'un paiement Mobile Money demandé à la livraison (le serveur revérifie toujours auprès de l'opérateur)
async function balanceStatus(req, res) {
  const p = payments.get(req.params.pid);
  if (!p || p.purpose !== 'balance' || (req.user.role === 'courier' && p.collectorId !== req.user.id)) return res.status(404).json({ error: 'Paiement introuvable' });
  try { await refreshStatus(p); } catch (err) { console.error('[livraison] vérification impossible :', err.message); }
  const q = payments.get(p.id);
  res.json({ status: q.status, reason: q.reason, orderStatus: orders.get(q.orderId)?.status });
}
router.get('/orders/payments/:pid', requireRole('orders'), balanceStatus);

// ---------- Espace livreur : ses livraisons du moment (coordonnées du client UNIQUEMENT pour les livraisons en cours) ----------
const courierView = (o) => ({
  id: o.id, status: o.status, assignedAt: o.assignedAt || null, createdAt: o.createdAt,
  customer: o.status === 'shipped' ? { name: o.customer.name, phone: o.customer.phone, city: o.customer.city, address: o.customer.address, location: o.customer.location || null } : { name: o.customer.name, city: o.customer.city },
  lines: o.lines.map((l) => ({ name: l.name, qty: l.qty })),
  paymentPlan: o.paymentPlan === 'cod' ? 'cod' : 'prepaid', toCollect: delivery.amountToCollect(o),
  callConfirmed: Boolean(o.callConfirmedAt), attempts: (o.attempts || []).length, codeLocked: Boolean(o.codeLocked),
  deliveredAt: o.deliveredAt || null, collected: o.balancePaid ? { method: o.balancePaid.method, amount: o.balance } : null,
});
// Position du livreur pour le suivi en direct des clients : acceptée seulement s'il a une livraison EN COURS ;
// une seule position gardée (la dernière), effacée quand il arrête le partage.
router.post('/courier/position', requireRole('courier'), (req, res) => {
  if (req.user.role !== 'courier') return res.status(403).json({ error: 'Réservé aux livreurs' });
  if (!orders.all().some((o) => o.courierId === req.user.id && o.status === 'shipped')) {
    staff.update(req.user.id, { livePos: null });
    return res.status(409).json({ error: 'Aucune livraison en cours : partage arrêté', stop: true });
  }
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return res.status(400).json({ error: 'Position invalide' });
  const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
  staff.update(req.user.id, { livePos: { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, accuracy: num(req.body?.accuracy), heading: num(req.body?.heading), at: new Date().toISOString() } });
  // « Votre livreur arrive » : une seule fois par commande, quand il est à moins de 500 m du point placé par le client
  for (const o of orders.all().filter((x) => x.courierId === req.user.id && x.status === 'shipped' && x.customer?.location && !x.nearNotified)) {
    const R = 6371, rad = (v) => (v * Math.PI) / 180, d = o.customer.location;
    const km = 2 * R * Math.asin(Math.sqrt(Math.sin(rad(d.lat - lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(d.lat)) * Math.sin(rad(d.lng - lng) / 2) ** 2));
    if (km < 0.5) { orders.update(o.id, { nearNotified: new Date().toISOString() }); require('../push').orderStage(orders.get(o.id), 'near'); }
  }
  res.json({ ok: true });
});
router.delete('/courier/position', requireRole('courier'), (req, res) => { staff.update(req.user.id, { livePos: null }); res.json({ ok: true }); });

router.get('/courier/deliveries', requireRole('courier'), (req, res) => {
  const mine = orders.all().filter((o) => o.courierId === req.user.id);
  const current = mine.filter((o) => o.status === 'shipped').sort((a, b) => (a.assignedAt < b.assignedAt ? -1 : 1));
  const done = mine.filter((o) => o.status === 'delivered' && o.deliveredBy === req.user.id).sort((a, b) => (a.deliveredAt < b.deliveredAt ? 1 : -1)).slice(0, 20);
  const cashHeld = mine.filter((o) => o.cashHeldBy === req.user.id && !o.cashRemittedAt).reduce((n, o) => n + (o.balance || 0), 0);
  res.json({ current: current.map(courierView), done: done.map(courierView), cashHeld, failReasons: delivery.FAIL_REASONS });
});
const myDelivery = (req, res) => {
  const o = orders.get(req.params.id);
  if (!o || (req.user.role === 'courier' && o.courierId !== req.user.id)) { res.status(404).json({ error: 'Livraison introuvable' }); return null; }
  return o;
};
router.post('/courier/deliveries/:id/deliver', requireRole('courier'), (req, res) => {
  const o = myDelivery(req, res); if (!o) return;
  deliverHandler(req, res, o, { courierOnly: true });
});
router.post('/courier/deliveries/:id/fail', requireRole('courier'), (req, res) => {
  const o = myDelivery(req, res); if (!o) return;
  if (o.status !== 'shipped') return res.status(400).json({ error: "Cette livraison n'est plus en cours" });
  if (!delivery.FAIL_REASONS[req.body?.reason]) return res.status(400).json({ error: 'Choisissez la raison' });
  delivery.failDelivery(o, { by: actor(req), reason: req.body.reason, note: req.body.note });
  log(req, 'Livraison ratée', { id: o.id, name: o.id }, delivery.FAIL_REASONS[req.body.reason]);
  res.json({ ok: true });
});
router.get('/courier/payments/:pid', requireRole('courier'), balanceStatus);

// ---------- Réglages du paiement à la réception (admin) ----------
router.get('/settings/cod', requireRole(), (req, res) => res.json(delivery.codSettings()));
router.put('/settings/cod', requireRole(), (req, res) => {
  const { error, value } = delivery.saveCodSettings(req.body || {});
  if (error) return res.status(400).json({ error });
  log(req, 'Réglages du paiement à la réception modifiés', null, `acompte ${value.deposit} FCFA${value.depositPercent ? ` ou ${value.depositPercent} %` : ''}, fiable après ${value.trustedAfter} livraisons, bloqué après ${value.maxRefusals} refus${value.enabled ? '' : ' — DÉSACTIVÉ'}`);
  res.json(value);
});

// ---------- Agences (retrait et paiement en espèces) ----------
function cleanAgency(input, current = {}) {
  const a = { ...current };
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  for (const [key, max] of [['name', 80], ['city', 60], ['address', 200], ['hours', 120], ['phone', 30]]) {
    if (key in input) a[key] = str(input[key], max);
  }
  if ('active' in input) a.active = Boolean(input.active);
  // Point relais : agence Kamwa ou commerce partenaire ; position sur la carte (choisie dans Kamwa Pro)
  if ('kind' in input) a.kind = input.kind === 'partner' ? 'partner' : 'agency';
  if ('lat' in input || 'lng' in input) {
    const lat = input.lat === '' || input.lat == null ? null : Number(input.lat), lng = input.lng === '' || input.lng == null ? null : Number(input.lng);
    if (lat === null || lng === null) { a.lat = null; a.lng = null; }
    else if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return { error: 'Position sur la carte invalide' };
    else { a.lat = Math.round(lat * 1e6) / 1e6; a.lng = Math.round(lng * 1e6) / 1e6; }
  }
  if (!a.name) return { error: "Le nom du point relais est obligatoire" };
  if (!a.city) return { error: 'La ville est obligatoire' };
  return { value: a };
}

router.get('/agencies', requireRole(), (req, res) => res.json(agencies.all()));

router.post('/agencies', requireRole(), (req, res) => {
  const { error, value } = cleanAgency({ active: true, ...(req.body || {}) });
  if (error) return res.status(400).json({ error });
  res.status(201).json(agencies.insert({ id: 'AG-' + crypto.randomBytes(3).toString('hex').toUpperCase(), ...value, createdAt: new Date().toISOString() }));
});

router.patch('/agencies/:id', requireRole(), (req, res) => {
  const current = agencies.get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Agence introuvable' });
  const { error, value } = cleanAgency(req.body || {}, current);
  if (error) return res.status(400).json({ error });
  res.json(agencies.update(current.id, value));
});

// ---------- Clients ----------
router.get('/customers', requireRole(), (req, res) => {
  const all = orders.all();
  const list = customers
    .all()
    .map((c) => ({ ...customerAuth.publicCustomer(c), idCheckedBy: c.idCheckedBy || null, hasIdPhoto: Boolean(c.idPhoto), idAuto: c.idAuto || null, idAutoAt: c.idAutoAt || null, idIsPdf: /\.pdf$/.test(c.idPhoto || ''), orders: all.filter((o) => o.customerId === c.id).length }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(list);
});

// « Code oublié » : un nouveau code est généré et montré UNE fois à l'admin, qui le transmet au client (WhatsApp, appel…).
router.post('/customers/:id/new-code', requireRole(), (req, res) => {
  const customer = customers.get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Client introuvable' });
  res.json({ code: customerAuth.assignNewCode(customer.id) });
});

// ---------- Pièces d'identité des clients (admin seulement) ----------
// La photo n'est jamais servie en accès libre : seulement ici, à l'admin connecté, sans mise en cache.
router.get('/customers/:id/identity-photo', requireRole(), (req, res) => {
  const customer = customers.get(req.params.id);
  const file = customer && identity.photoPath(customer.idPhoto);
  if (!file) return res.status(404).json({ error: 'Pas de pièce enregistrée' });
  // PDF : ouvert par la visionneuse intégrée du navigateur (isolée de Kamwa Pro)
  res.set({ 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' });
  res.sendFile(file, (err) => { if (err && !res.headersSent) res.sendStatus(404); });
});
// Relancer la lecture automatique de la pièce (photo déjà enregistrée)
router.post('/customers/:id/identity-check', requireRole(), async (req, res) => {
  const customer = customers.get(req.params.id);
  if (!customer?.idPhoto) return res.status(404).json({ error: 'Pas de pièce enregistrée' });
  const r = await identity.recheck(customer);
  res.json({ idAuto: customers.get(customer.id).idAuto || r, idAutoAt: customers.get(customer.id).idAutoAt || null });
});
// Décision : « verify » (le client peut commander) ou « reject » (motif montré au client, qui renvoie une photo)
router.post('/customers/:id/identity', requireRole(), (req, res) => {
  const customer = customers.get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Client introuvable' });
  if (!customer.idPhoto) return res.status(400).json({ error: "Ce client n'a pas encore envoyé de pièce" });
  const decision = req.body?.decision;
  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  if (!['verify', 'reject'].includes(decision)) return res.status(400).json({ error: 'Décision inconnue' });
  if (decision === 'reject' && !reason) return res.status(400).json({ error: 'Indiquez le motif du refus (il sera montré au client)' });
  const updated = customers.update(customer.id, {
    idStatus: decision === 'verify' ? 'verified' : 'rejected',
    idRejectReason: decision === 'reject' ? reason : null,
    idCheckedAt: new Date().toISOString(),
    idCheckedBy: req.user.name || req.user.login,
  });
  require('../push').notifyCustomer(customer.id, decision === 'verify' ? 'Identité vérifiée ✓' : 'Pièce d\'identité refusée', decision === 'verify' ? 'Votre compte Kamwa est vérifié : vous pouvez commander.' : `Motif : ${reason}. Envoyez une nouvelle photo depuis votre compte.`);
  log(req, decision === 'verify' ? "Pièce d'identité vérifiée" : "Pièce d'identité refusée", { id: customer.id, name: customer.name }, decision === 'reject' ? reason : identity.ID_TYPES[customer.idType]);
  res.json({ ...customerAuth.publicCustomer(updated), idCheckedBy: updated.idCheckedBy });
});

// ---------- Règles de vente : compte vérifié obligatoire, moyens de paiement (admin) ----------
router.get('/settings/sales', requireRole(), (req, res) => res.json(sales.salesSettings()));
router.put('/settings/sales', requireRole(), (req, res) => {
  const r = sales.saveSalesSettings(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  log(req, 'Règles de vente modifiées', null, `compte obligatoire : ${r.value.accountRequired ? 'oui' : 'non'} · paiements : ${Object.keys(r.value.methods).filter((k) => r.value.methods[k]).join(', ')}`);
  res.json(r.value);
});

// ---------- Produits ----------
// Qui peut faire quoi :
//  - admin : tout ; ses nouveaux produits sont publiés directement ; il valide ceux des autres ;
//  - catalog (employé Catalogue) : crée (en attente de validation) et modifie les produits ; ne voit pas les prix fournisseur ;
//  - supplier (fournisseur) : ne voit que SES produits ; en crée (en attente) ; sur un produit publié il ne change que
//    le stock et son prix fournisseur ; il ne fixe jamais le prix de vente.
const toInt = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const IMG_PATH = /^\/images\/(products|uploads|commons)\/[\w.-]+$/;
const CONDITIONS = ['neuf', 'reconditionné', 'occasion'];

function cleanProduct(input, current, { role }) {
  const p = { ...current };
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  if ('name' in input) p.name = str(input.name, 120);
  if ('brand' in input) p.brand = str(input.brand, 60);
  if ('description' in input) p.description = str(input.description, 2000);
  if ('category' in input) {
    p.universe = universeOf(input.category);
    if (!p.universe) return { error: 'Catégorie inconnue' };
    p.category = input.category;
  }
  if ('condition' in input) {
    if (input.condition && !CONDITIONS.includes(input.condition)) return { error: 'État invalide' };
    p.condition = input.condition || 'neuf';
  }
  // Caractéristiques : liste « libellé : valeur » (ex. Couleur : Noir)
  if ('specs' in input) {
    const lines = Array.isArray(input.specs) ? input.specs : String(input.specs || '').split('\n');
    p.specs = lines
      .map((l) => (typeof l === 'string' ? l.split(/\s*:\s*/) : [l.label, l.value]))
      .map(([label, ...rest]) => ({ label: str(label, 40), value: str(rest.join(' : '), 120) }))
      .filter((x) => x.label && x.value)
      .slice(0, 15);
  }
  if ('price' in input && role !== 'supplier') p.price = input.price === '' || input.price === null ? null : toInt(input.price);
  if ('oldPrice' in input && role !== 'supplier') p.oldPrice = input.oldPrice === '' || input.oldPrice === null ? null : toInt(input.oldPrice);
  if ('costPrice' in input && role === 'admin') {
    p.costPrice = input.costPrice === '' || input.costPrice === null ? null : toInt(input.costPrice);
    if (p.costPrice != null && (!Number.isInteger(p.costPrice) || p.costPrice < 0 || p.costPrice > 100000000)) return { error: "Prix d'achat invalide (nombre entier en FCFA)" };
  }
  if ('supplierPrice' in input && role !== 'catalog') {
    p.supplierPrice = input.supplierPrice === '' || input.supplierPrice === null ? null : toInt(input.supplierPrice);
  }
  if ('stock' in input) p.stock = toInt(input.stock);
  // Choix proposés au client (ex. « Couleur : Noir, Bleu » / « Taille : 40, 41, 42 »), une ligne par choix
  if ('options' in input) {
    const lines = Array.isArray(input.options) ? input.options.map((o) => `${o.name} : ${(o.values || []).join(', ')}`) : String(input.options || '').split('\n');
    p.options = lines.map((l) => l.split(/\s*:\s*/)).map(([name, ...rest]) => ({ name: str(name, 30), values: [...new Set(rest.join(':').split(/\s*,\s*/).map((v) => str(v, 40)).filter(Boolean))].slice(0, 40) }))
      .filter((o) => o.name && o.values.length).slice(0, 3);
  }
  // Produit venu d’Europe (expédié par avion) : prix tout compris calculé depuis le prix en € et le poids
  if ('origin' in input && role !== 'supplier') p.origin = input.origin === 'FR' ? 'FR' : null;
  if ('sourceUrl' in input && role !== 'supplier') p.sourceUrl = /^https?:\/\//.test(String(input.sourceUrl || '')) ? str(input.sourceUrl, 600) : null;
  if ('priceEur' in input && role !== 'supplier') p.priceEur = input.priceEur === '' || input.priceEur == null ? null : Math.round(Number(String(input.priceEur).replace(',', '.')) * 100) / 100;
  if ('weightKg' in input && role !== 'supplier') p.weightKg = input.weightKg === '' || input.weightKg == null ? null : Math.round(Number(String(input.weightKg).replace(',', '.')) * 100) / 100;
  if (p.origin === 'FR') {
    if (!(p.priceEur > 0 && p.priceEur < 100000)) return { error: 'Produit venu d’Europe : indiquez son prix en euros' };
    if (!(p.weightKg > 0 && p.weightKg <= 200)) return { error: 'Produit venu d’Europe : indiquez son poids (kg, emballage compris)' };
    const q = imp.computeQuote([{ priceEur: p.priceEur, qty: 1 }], p.weightKg);
    p.costPrice = q.cost; // coût réel estimé (article + transport avion + douane) : sert au calcul de la marge
    if (!('price' in input) || input.price === '' || input.price == null) p.price = q.total; // prix tout compris automatique
  }
  // Photos : plusieurs possibles ; la première est la photo principale
  if ('images' in input || 'image' in input) {
    const list = 'images' in input ? (Array.isArray(input.images) ? input.images : []) : [input.image].filter(Boolean);
    const imgs = [...new Set(list.map((x) => str(x, 200)).filter(Boolean))].slice(0, 8);
    if (imgs.some((x) => !IMG_PATH.test(x))) return { error: 'Photo invalide' };
    if (imgs[0] !== current.image) p.imageCredit = undefined; // nouvelle photo principale : l'ancien crédit ne s'applique plus
    p.images = imgs;
    p.image = imgs[0] || undefined;
  }
  if (role !== 'supplier') {
    if ('featured' in input) p.featured = Boolean(input.featured);
    if ('active' in input) p.active = Boolean(input.active);
  }
  if ('supplierId' in input && role === 'admin') {
    if (input.supplierId && staff.get(input.supplierId)?.role !== 'supplier') return { error: 'Fournisseur inconnu' };
    p.supplierId = input.supplierId || null;
  }

  if (!p.name) return { error: 'Le nom est obligatoire' };
  if (!p.category) return { error: 'La catégorie est obligatoire' };
  // Prix de vente : obligatoire pour un produit publié ; un produit en attente (ex. proposé par un fournisseur) peut ne pas en avoir encore.
  const priceOk = Number.isInteger(p.price) && p.price > 0 && p.price <= 100000000;
  if (p.price != null && !priceOk) return { error: 'Prix invalide (nombre entier en FCFA, sans espace ni point)' };
  if (!p.pending && !priceOk) return { error: 'Le prix de vente est obligatoire' };
  if (p.oldPrice != null && (!Number.isInteger(p.oldPrice) || !priceOk || p.oldPrice <= p.price)) {
    return { error: 'Le prix barré doit être un nombre entier plus grand que le prix (ou laissé vide)' };
  }
  if (p.supplierPrice != null && (!Number.isInteger(p.supplierPrice) || p.supplierPrice < 0 || p.supplierPrice > 100000000)) {
    return { error: 'Prix fournisseur invalide (nombre entier en FCFA)' };
  }
  if (role === 'supplier' && !Number.isInteger(p.supplierPrice)) return { error: 'Indiquez votre prix fournisseur' };
  if (!Number.isInteger(p.stock) || p.stock < 0 || p.stock > 100000) return { error: 'Stock invalide (nombre entier, 0 ou plus)' };
  return { value: p };
}

// Ce que chaque rôle voit d'un produit (le prix fournisseur reste entre Kamwa et le fournisseur)
function productFor(user, p) {
  const out = { ...p, supplierName: p.supplierId ? staff.get(p.supplierId)?.company || staff.get(p.supplierId)?.name || null : null };
  if (user.role === 'catalog') delete out.supplierPrice;
  if (user.role !== 'admin') delete out.costPrice; // prix d'achat Kamwa : admin seulement
  return out;
}
const canSee = (user, p) => user.role !== 'supplier' || p.supplierId === user.id;

// Résumé lisible des changements, pour le journal
const TRACKED = { name: 'nom', price: 'prix', oldPrice: 'prix barré', supplierPrice: 'prix fournisseur', costPrice: 'prix d\'achat', stock: 'stock', category: 'catégorie', active: 'visible', featured: 'mis en avant', condition: 'état' };
// Valeur comparable et lisible (« visible » est vrai par défaut, « mis en avant » faux par défaut)
const shown = (k, v) => {
  if (k === 'active') return v !== false ? 'oui' : 'non';
  if (k === 'featured') return v ? 'oui' : 'non';
  return v ?? '—';
};
function changes(before, after) {
  const out = Object.entries(TRACKED)
    .filter(([k]) => shown(k, before[k]) !== shown(k, after[k]))
    .map(([k, label]) => `${label} : ${shown(k, before[k])} → ${shown(k, after[k])}`);
  if (JSON.stringify(before.images || [before.image].filter(Boolean)) !== JSON.stringify(after.images || [after.image].filter(Boolean))) out.push('photos modifiées');
  if ((before.description || '') !== (after.description || '')) out.push('description modifiée');
  if (JSON.stringify(before.specs || []) !== JSON.stringify(after.specs || [])) out.push('caractéristiques modifiées');
  return out.join(' ; ');
}

router.get('/products', requireRole('catalog', 'supplier'), (req, res) => {
  res.json(products.all().filter((p) => canSee(req.user, p)).map((p) => productFor(req.user, p)));
});

router.post('/products', requireRole('catalog', 'supplier'), (req, res) => {
  const role = req.user.role;
  const base = { active: true, condition: 'neuf', pending: role !== 'admin', supplierId: role === 'supplier' ? req.user.id : null };
  const { error, value } = cleanProduct(req.body || {}, base, { role });
  if (error) return res.status(400).json({ error });
  const now = new Date().toISOString();
  const product = products.insert({ id: 'p' + crypto.randomBytes(4).toString('hex'), ...value, createdAt: now, createdBy: req.user.id });
  log(req, 'Produit ajouté', product, product.pending ? 'en attente de validation' : 'publié');
  res.status(201).json(productFor(req.user, product));
});

router.patch('/products/:id', requireRole('catalog', 'supplier'), (req, res) => {
  const current = products.get(req.params.id);
  if (!current || !canSee(req.user, current)) return res.status(404).json({ error: 'Produit introuvable' });
  let input = req.body || {};
  // Fournisseur : sur un produit déjà publié, seuls le stock et son prix fournisseur sont modifiables
  if (req.user.role === 'supplier' && !current.pending) {
    input = Object.fromEntries(Object.entries(input).filter(([k]) => ['stock', 'supplierPrice'].includes(k)));
  }
  const { error, value } = cleanProduct(input, current, { role: req.user.role });
  if (error) return res.status(400).json({ error });
  const diff = changes(current, value);
  const updated = products.update(current.id, { ...value, updatedBy: req.user.id });
  if (diff) log(req, 'Produit modifié', updated, diff);
  res.json(productFor(req.user, updated));
});

// Validation par l'admin : le produit devient visible des clients (le prix de vente doit être fixé).
router.post('/products/:id/approve', requireRole(), (req, res) => {
  const current = products.get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Produit introuvable' });
  if (!current.pending) return res.status(400).json({ error: 'Ce produit est déjà publié' });
  if (!(Number.isInteger(current.price) && current.price > 0)) return res.status(400).json({ error: 'Fixez d\'abord le prix de vente, puis enregistrez' });
  const updated = products.update(current.id, { pending: false, active: true, approvedAt: new Date().toISOString(), updatedBy: req.user.id });
  log(req, 'Produit validé et publié', updated, `prix de vente ${updated.price} FCFA`);
  res.json(productFor(req.user, updated));
});

// Suppression définitive d'un produit.
//  - admin : n'importe quel produit, sauf s'il est dans une commande en cours de paiement (le masquer plutôt) ;
//    les commandes passées restent intactes (chaque ligne garde le nom et le prix au moment de l'achat) ;
//  - fournisseur / employé : seulement un produit qu'il a proposé et qui n'est pas encore validé.
router.delete('/products/:id', requireRole('catalog', 'supplier'), (req, res) => {
  const p = products.get(req.params.id);
  if (!p || !canSee(req.user, p)) return res.status(404).json({ error: 'Produit introuvable' });
  if (req.user.role !== 'admin' && !(p.pending && p.createdBy === req.user.id)) {
    return res.status(403).json({ error: "Seul l'administrateur peut supprimer un produit déjà publié. Demandez-lui, ou mettez le stock à 0." });
  }
  const inOrders = orders.all().filter((o) => o.lines.some((l) => l.productId === p.id));
  const paying = new Set(inOrders.filter((o) => o.status === 'pending_payment').map((o) => o.id));
  if (paying.size && payments.all().some((pay) => paying.has(pay.orderId) && pay.status === 'PENDING')) {
    return res.status(409).json({ error: 'Un client est en train de payer ce produit. Décochez « Visible » pour le retirer de la boutique, puis réessayez plus tard.' });
  }
  products.remove(p.id);
  // Photos envoyées depuis l'espace pro et plus utilisées par aucun autre produit : supprimées du disque
  const still = new Set(products.all().flatMap((x) => x.images || [x.image]).filter(Boolean));
  for (const url of new Set([...(p.images || []), p.image].filter(Boolean))) {
    const m = /^\/images\/uploads\/([\w.-]+)$/.exec(url);
    if (m && !still.has(url)) fs.rm(path.join(UPLOAD_DIR, m[1]), { force: true }, () => {});
  }
  log(req, 'Produit supprimé', p, inOrders.length ? `présent dans ${inOrders.length} commande(s), conservées` : '');
  res.json({ ok: true });
});

// ---------- Espace fournisseur : commandes contenant ses produits ----------
// Kamwa livre : le fournisseur voit les articles, quantités et statuts, JAMAIS les coordonnées des clients.
router.get('/supplier/orders', requireRole('supplier'), (req, res) => {
  const mine = new Set(products.all().filter((p) => p.supplierId === req.user.id || req.user.role === 'admin').map((p) => p.id));
  const list = orders
    .all()
    .filter((o) => o.status !== 'pending_payment')
    .map((o) => ({ o, lines: o.lines.filter((l) => mine.has(l.productId)) }))
    .filter(({ lines }) => lines.length)
    .sort((a, b) => (a.o.createdAt < b.o.createdAt ? 1 : -1))
    .map(({ o, lines }) => ({
      id: o.id,
      createdAt: o.createdAt,
      paidAt: o.paidAt || null,
      status: o.status,
      fulfillment: o.fulfillment || 'delivery',
      history: o.history || [],
      lines: lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, supplierPrice: products.get(l.productId)?.supplierPrice ?? null })),
    }));
  res.json({ orders: list, statusLabels: STATUS_LABELS });
});

// ---------- Équipe et fournisseurs (admin uniquement) ----------
const publicStaff = ({ passwordHash, ...u }) => u;

router.get('/staff', requireRole(), (req, res) => {
  const all = products.all();
  res.json({
    roles: ROLES,
    staff: staff.all().map((u) => ({ ...publicStaff(u), products: all.filter((p) => p.supplierId === u.id).length })),
  });
});

router.post('/staff', requireRole(), (req, res) => {
  const { name, login, role, company, phone } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 80);
  const cleanLogin = normLogin(login);
  if (!cleanName) return res.status(400).json({ error: 'Le nom est obligatoire' });
  if (!/^[a-z0-9._@-]{3,40}$/.test(cleanLogin)) return res.status(400).json({ error: 'Identifiant : 3 à 40 caractères, lettres sans accent, chiffres, point, tiret' });
  if (cleanLogin === ADMIN_LOGIN || findStaff(cleanLogin)) return res.status(409).json({ error: 'Cet identifiant est déjà utilisé' });
  if (!['catalog', 'orders', 'supplier', 'courier', 'agent'].includes(role)) return res.status(400).json({ error: 'Rôle inconnu' });
  if (role === 'supplier' && !String(company || '').trim()) return res.status(400).json({ error: "Indiquez le nom de l'entreprise du fournisseur" });
  const password = tempPassword();
  const user = staff.insert({
    id: 'U-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    name: cleanName,
    login: cleanLogin,
    role,
    company: role === 'supplier' ? String(company).trim().slice(0, 80) : null,
    phone: String(phone || '').trim().slice(0, 30) || null,
    active: true,
    mustChangePassword: true,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  });
  log(req, 'Compte créé', { id: user.id, name: `${user.name} (${ROLES[role]})` }, `identifiant ${user.login}`);
  res.status(201).json({ user: publicStaff(user), password }); // mot de passe provisoire montré UNE fois
});

router.patch('/staff/:id', requireRole(), (req, res) => {
  const u = staff.get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Compte introuvable' });
  if (demo.isDemoLogin(u.login)) return res.status(403).json({ error: 'Compte de démonstration : il ne peut pas être modifié' });
  const patch = {};
  if ('active' in (req.body || {})) patch.active = Boolean(req.body.active);
  if ('name' in (req.body || {}) && String(req.body.name).trim()) patch.name = String(req.body.name).trim().slice(0, 80);
  if ('company' in (req.body || {}) && u.role === 'supplier') patch.company = String(req.body.company || '').trim().slice(0, 80);
  const updated = staff.update(u.id, patch);
  if (patch.active === false) closeSessionsOf(u.id); // compte désactivé : déconnecté partout tout de suite
  if ('active' in patch && patch.active !== u.active) log(req, patch.active ? 'Compte réactivé' : 'Compte désactivé', { id: u.id, name: u.name });
  res.json(publicStaff(updated));
});

router.post('/staff/:id/reset-password', requireRole(), (req, res) => {
  const u = staff.get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Compte introuvable' });
  if (demo.isDemoLogin(u.login)) return res.status(403).json({ error: 'Compte de démonstration : son mot de passe ne peut pas être changé' });
  const password = tempPassword();
  staff.update(u.id, { passwordHash: hashPassword(password), mustChangePassword: true });
  closeSessionsOf(u.id);
  log(req, 'Mot de passe réinitialisé', { id: u.id, name: u.name });
  res.json({ password });
});

// Chacun peut changer son propre mot de passe (l'admin le fait avec npm run admin:password)
router.post('/me/password', (req, res) => {
  if (req.user.role === 'admin') return res.status(400).json({ error: 'Admin : utilisez « npm run admin:password » dans le Terminal' });
  if (demo.isDemoLogin(req.user.login)) return res.status(403).json({ error: 'Compte de démonstration : son mot de passe ne peut pas être changé' });
  const { current, next } = req.body || {};
  const u = staff.get(req.user.id);
  if (!checkPassword(current || '', u.passwordHash)) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  if (String(next || '').length < 10) return res.status(400).json({ error: 'Nouveau mot de passe : au moins 10 caractères' });
  staff.update(u.id, { passwordHash: hashPassword(String(next)), mustChangePassword: false });
  res.json({ ok: true });
});

// ---------- Tableaux de bord (statistiques adaptées au rôle) ----------
const SOLD = ['paid', 'shipped', 'delivered'];
const isSold = (o) => (o.paymentPlan === 'cod' ? o.status === 'delivered' : SOLD.includes(o.status));
const PAY_NAMES = { mtn: 'MTN MoMo', airtel: 'Airtel Money', card: 'Carte bancaire', cash: 'Espèces en agence' };
const dayKey = (iso) => String(iso || '').slice(0, 10);
const countBy = (items, keyFn, valFn = () => 1) => {
  const m = new Map();
  for (const it of items) { const k = keyFn(it); m.set(k, (m.get(k) || 0) + valFn(it)); }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
};

router.get('/stats', (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const since = Date.now() - days * 86400000;
  const labels = Array.from({ length: days }, (_, i) => dayKey(new Date(Date.now() - (days - 1 - i) * 86400000).toISOString()));
  const role = req.user.role;
  const allProducts = products.all();
  const visible = (p) => p.active !== false && !p.pending;
  const lowStockOf = (list) => list.filter((p) => visible(p) && p.stock != null && p.stock <= 3).sort((a, b) => a.stock - b.stock).slice(0, 8).map((p) => ({ id: p.id, name: p.name, stock: p.stock }));
  const allOrders = orders.all();
  const soldInPeriod = allOrders.filter((o) => isSold(o) && Date.parse(o.paidAt || o.createdAt) >= since);
  const out = { role, days, labels };

  if (role === 'supplier') {
    const mine = allProducts.filter((p) => p.supplierId === req.user.id);
    const mineIds = new Set(mine.map((p) => p.id));
    const priceOf = (id) => products.get(id)?.supplierPrice || 0;
    const lines = soldInPeriod.flatMap((o) => o.lines.filter((l) => mineIds.has(l.productId)).map((l) => ({ ...l, day: dayKey(o.paidAt || o.createdAt), orderId: o.id })));
    const perDay = (fn) => labels.map((d) => lines.filter((l) => l.day === d).reduce((s, l) => s + fn(l), 0));
    out.kpis = [
      { label: 'Articles vendus', value: lines.reduce((s, l) => s + l.qty, 0), icon: 'shopping-cart-duotone' },
      { label: 'Montant de vos ventes', value: lines.reduce((s, l) => s + l.qty * priceOf(l.productId), 0), format: 'fcfa', icon: 'currency-circle-dollar-duotone', hint: 'au prix fournisseur' },
      { label: 'Commandes', value: new Set(lines.map((l) => l.orderId)).size, icon: 'receipt-duotone' },
      { label: 'Produits en ligne', value: mine.filter(visible).length, icon: 'package-duotone', hint: `${mine.filter((p) => p.pending).length} en attente de validation` },
    ];
    out.series = [{ label: 'Articles vendus', data: perDay((l) => l.qty), type: 'bar' }, { label: 'Montant (FCFA)', data: perDay((l) => l.qty * priceOf(l.productId)), type: 'line', axis: 'y2' }];
    out.top = countBy(lines, (l) => l.name, (l) => l.qty).slice(0, 6);
    out.lowStock = lowStockOf(mine);
    return res.json(out);
  }

  if (role === 'agent') {
    const imp = allOrders.filter((o) => o.import && o.paidAt && o.status !== 'cancelled');
    const count = (st) => imp.filter((o) => o.import.stage === st).length;
    out.kpis = [
      { label: 'À acheter', value: count('to_buy'), icon: 'shopping-cart-duotone' },
      { label: 'Achetés, en attente de réception', value: count('bought'), icon: 'package-duotone' },
      { label: 'Reçus, à envoyer', value: count('received'), icon: 'truck-duotone' },
      { label: 'En route vers le Congo', value: count('shipped_fr'), icon: 'map-pin-duotone' },
    ];
    out.series = [{ label: 'Commandes payées', data: labels.map((d) => imp.filter((o) => String(o.paidAt).slice(0, 10) === d).length), type: 'bar' }];
    return res.json(out);
  }

  if (role === 'courier') {
    const mine = allOrders.filter((o) => o.courierId === req.user.id);
    const doneIn = mine.filter((o) => o.status === 'delivered' && o.deliveredBy === req.user.id && Date.parse(o.deliveredAt) >= since);
    const today = new Date().toISOString().slice(0, 10);
    const cashHeld = mine.filter((o) => o.cashHeldBy === req.user.id && !o.cashRemittedAt).reduce((n, o) => n + (o.balance || 0), 0);
    out.kpis = [
      { label: 'À livrer maintenant', value: mine.filter((o) => o.status === 'shipped').length, icon: 'truck-duotone' },
      { label: "Livrées aujourd'hui", value: doneIn.filter((o) => String(o.deliveredAt).startsWith(today)).length, icon: 'package-duotone' },
      { label: `Livrées (${days} j)`, value: doneIn.length, icon: 'receipt-duotone' },
      { label: 'Espèces à remettre à Kamwa', value: cashHeld, format: 'fcfa', icon: 'wallet-duotone' },
    ];
    out.series = [{ label: 'Livraisons', data: labels.map((d) => doneIn.filter((o) => String(o.deliveredAt).slice(0, 10) === d).length), type: 'bar' }];
    return res.json(out);
  }

  if (role === 'catalog') {
    out.kpis = [
      { label: 'Produits en ligne', value: allProducts.filter(visible).length, icon: 'package-duotone' },
      { label: 'À valider', value: allProducts.filter((p) => p.pending).length, icon: 'clock-countdown-duotone', hint: "par l'administrateur" },
      { label: 'Sans photo', value: allProducts.filter((p) => visible(p) && !p.image).length, icon: 'image-broken-duotone' },
      { label: 'En rupture', value: allProducts.filter((p) => visible(p) && p.stock === 0).length, icon: 'warning-duotone' },
    ];
    out.byCategory = countBy(allProducts.filter(visible), (p) => p.category);
    out.lowStock = lowStockOf(allProducts);
    out.noPhoto = allProducts.filter((p) => visible(p) && !p.image).slice(0, 8).map((p) => ({ id: p.id, name: p.name }));
    return res.json(out);
  }

  // Admin et employé Commandes
  const isCashToCollect = (o) => o.status === 'pending_payment' && (o.fulfillment === 'pickup' || o.agency) && o.pickupDeadline && Date.parse(o.pickupDeadline) > Date.now();
  const perDay = (fn) => labels.map((d) => soldInPeriod.filter((o) => dayKey(o.paidAt || o.createdAt) === d).reduce((s, o) => s + fn(o), 0));
  const todo = {
    toShip: allOrders.filter((o) => ['paid', 'confirmed'].includes(o.status)).length,
    toCollect: allOrders.filter(isCashToCollect).length,
    inTransit: allOrders.filter((o) => o.status === 'shipped').length,
    refunds: allOrders.filter((o) => o.paidAfterCancel).length,
    ...(role === 'admin' ? { idToCheck: customers.all().filter((c) => c.idStatus === 'pending').length } : {}),
  };
  out.todo = todo;
  out.byStatus = countBy(allOrders.filter((o) => Date.parse(o.createdAt) >= since), (o) => STATUS_LABELS[o.status] || o.status);
  if (role === 'orders') {
    out.kpis = [
      { label: 'À expédier / remettre', value: todo.toShip, icon: 'package-duotone' },
      { label: 'À encaisser en agence', value: todo.toCollect, icon: 'storefront-duotone' },
      { label: 'En cours de livraison', value: todo.inTransit, icon: 'truck-duotone' },
      { label: `Commandes payées (${days} j)`, value: soldInPeriod.length, icon: 'receipt-duotone' },
    ];
    out.series = [{ label: 'Commandes payées', data: perDay(() => 1), type: 'bar' }];
    return res.json(out);
  }

  // Admin : vue complète
  const revenue = soldInPeriod.reduce((s, o) => s + o.total, 0);
  const margin = soldInPeriod.reduce((s, o) => s + o.lines.reduce((m, l) => {
    const sp = products.get(l.productId)?.supplierPrice;
    return m + (sp != null ? (l.unitPrice - sp) * l.qty : 0);
  }, 0), 0);
  const payOf = (o) => PAY_NAMES[(o.paymentId && payments.get(o.paymentId)?.operator) || ''] || 'Autre';
  out.kpis = [
    { label: "Chiffre d'affaires", value: revenue, format: 'fcfa', icon: 'currency-circle-dollar-duotone', hint: `${days} derniers jours` },
    { label: 'Commandes payées', value: soldInPeriod.length, icon: 'receipt-duotone' },
    { label: 'Panier moyen', value: soldInPeriod.length ? Math.round(revenue / soldInPeriod.length) : 0, format: 'fcfa', icon: 'shopping-cart-duotone' },
    { label: 'Clients inscrits', value: customers.all().length, icon: 'users-duotone', hint: `${customers.all().filter((c) => Date.parse(c.createdAt) >= since).length} nouveaux` },
  ];
  if (margin) out.kpis.push({ label: 'Marge sur produits fournisseurs', value: margin, format: 'fcfa', icon: 'chart-line-up-duotone' });
  out.series = [{ label: "Chiffre d'affaires (FCFA)", data: perDay((o) => o.total), type: 'line', axis: 'y2' }, { label: 'Commandes', data: perDay(() => 1), type: 'bar' }];
  out.byPayment = countBy(soldInPeriod, payOf);
  out.byCity = countBy(soldInPeriod, (o) => o.customer?.city || 'Non précisée').slice(0, 6);
  out.top = countBy(soldInPeriod.flatMap((o) => o.lines), (l) => l.name, (l) => l.total).slice(0, 6);
  out.lowStock = lowStockOf(allProducts);
  out.pendingProducts = allProducts.filter((p) => p.pending).length;
  res.json(out);
});

// ---------- Exports (fichiers CSV qui s'ouvrent dans Excel) ----------
function sendCsv(res, filename, header, rows) {
  const cell = (v) => {
    const t = v == null ? '' : String(v);
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const body = [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + body); // BOM : accents corrects dans Excel
}
const stamp = () => new Date().toISOString().slice(0, 10);

router.get('/export/orders.csv', requireRole('orders'), (req, res) => {
  const list = orders.all().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  log(req, 'Export des commandes', null, `${list.length} commandes`);
  sendCsv(res, `kamwa-commandes-${stamp()}.csv`,
    ['Commande', 'Date', 'Statut', 'Client', 'Téléphone', 'Ville', 'Adresse', 'Articles', 'Total (FCFA)', 'Paiement', 'Retrait/Livraison'],
    list.map((o) => [o.id, o.createdAt.slice(0, 16).replace('T', ' '), STATUS_LABELS[o.status], o.customer?.name, o.customer?.phone, o.customer?.city, o.customer?.address,
      o.lines.map((l) => `${l.qty} x ${l.name}`).join(' | '), o.total, PAY_NAMES[(o.paymentId && payments.get(o.paymentId)?.operator) || ''] || '', o.fulfillment === 'pickup' ? 'Retrait en agence' : 'Livraison']));
});

router.get('/export/products.csv', requireRole('catalog', 'supplier'), (req, res) => {
  const role = req.user.role;
  const list = products.all().filter((p) => canSee(req.user, p));
  const withSupplierPrice = role !== 'catalog';
  sendCsv(res, `kamwa-produits-${stamp()}.csv`,
    ['Réf', 'Nom', 'Marque', 'Catégorie', 'Prix de vente', 'Prix barré', ...(withSupplierPrice ? ['Prix fournisseur'] : []), 'Stock', 'Visible', 'En attente', 'Fournisseur'],
    list.map((p) => [p.id, p.name, p.brand, p.category, p.price, p.oldPrice, ...(withSupplierPrice ? [p.supplierPrice] : []), p.stock, p.active !== false ? 'oui' : 'non', p.pending ? 'oui' : 'non',
      p.supplierId ? staff.get(p.supplierId)?.company || '' : 'Kamwa']));
});

router.get('/export/customers.csv', requireRole(), (req, res) => {
  const all = orders.all();
  log(req, 'Export des clients', null, `${customers.all().length} clients`);
  sendCsv(res, `kamwa-clients-${stamp()}.csv`, ['Client', 'Nom', 'Téléphone', 'E-mail', 'Inscrit le', 'Commandes'],
    customers.all().map((c) => [c.id, c.name, c.phone, c.email, String(c.createdAt).slice(0, 10), all.filter((o) => o.customerId === c.id).length]));
});

// ---------- Journal (admin uniquement) ----------
router.get('/activity', requireRole(), (req, res) => {
  res.json(activity.all().slice(-300).reverse());
});

// ---------- Photos ----------
// Le navigateur réduit la photo avant l'envoi (max ~1200 px) : fichiers légers pour les connexions lentes.
const SIGNATURES = [
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];

router.post('/uploads', requireRole('catalog', 'supplier', 'agent'), express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), (req, res) => {
  const buf = req.body;
  const type = Buffer.isBuffer(buf) && buf.length > 12 && SIGNATURES.find((s) => s.test(buf));
  if (!type) return res.status(400).json({ error: 'Photo non reconnue (formats acceptés : JPG, PNG, WebP, 5 Mo max)' });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${type.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  res.status(201).json({ url: `/images/uploads/${name}` });
});

// ---------- Remplir une fiche depuis un lien (site vendeur en Europe) ----------
// Photos récupérées puis ré-enregistrées sur Kamwa (JPEG, 1600 px max) : plus rapides et indépendantes du site d'origine.
async function importImages(urls) {
  const sharp = require('sharp');
  const out = []; let failed = 0;
  for (const u of [...new Set((Array.isArray(urls) ? urls : []).filter((x) => /^https?:\/\//.test(String(x))))].slice(0, 6)) {
    try {
      const buf = await scrape.fetchImage(u);
      const jpg = await sharp(buf).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 86 }).toBuffer();
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-s.jpg`;
      fs.writeFileSync(path.join(UPLOAD_DIR, name), jpg);
      out.push(`/images/uploads/${name}`);
    } catch { failed++; }
  }
  return { images: out, failedImages: failed };
}
// Pas plus de 30 lectures de liens / imports de photos par personne et par 10 minutes (usage normal : une fiche à la fois)
const linkUse = new Map();
function linkQuota(req, res, next) {
  const k = req.user?.id || req.user?.login || req.ip; const now = Date.now();
  const list = (linkUse.get(k) || []).filter((t) => now - t < 10 * 60e3);
  if (list.length >= 30) return res.status(429).json({ error: 'Trop de lectures de liens en peu de temps. Patientez quelques minutes.' });
  list.push(now); linkUse.set(k, list); next();
}
router.post('/products/scrape', requireRole('catalog'), linkQuota, async (req, res) => {
  try {
    const data = await scrape.readProduct(String(req.body?.url || '').trim());
    const imgs = await importImages(data.images);
    log(req, 'Fiche remplie depuis un lien', null, data.source.slice(0, 120));
    res.json({ ...data, sourceImages: data.images, ...imgs });
  } catch (err) {
    res.status(422).json({ error: err.message || 'Lecture impossible' });
  }
});
// Données envoyées par le bouton « → Kamwa » (favori) : seules les photos sont récupérées ici
router.post('/products/import-images', requireRole('catalog'), linkQuota, async (req, res) => {
  const category = scrape.guessCategory(String(req.body?.name || ''));
  res.json({ ...(await importImages(req.body?.urls)), category, weightKg: scrape.WEIGHT[category] || 1 });
});

// ---------- Détourage automatique (retrait de l'arrière-plan) ----------
const detourage = require('../photo/background');
router.get('/detourage', requireRole('catalog', 'supplier'), (req, res) => res.json(detourage.status()));

async function saveDetoured(req, res, input) {
  try {
    const { buffer, found } = await detourage.removeBackground(input);
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}-d.jpg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
    res.status(201).json({ url: `/images/uploads/${name}`, found });
  } catch (err) {
    console.error('[détourage]', err.message);
    res.status(503).json({ error: 'Détourage impossible pour le moment. La photo peut être ajoutée telle quelle.' });
  }
}
// Nouvelle photo (prise avec le téléphone) : détourée puis enregistrée
router.post('/uploads/detoure', requireRole('catalog', 'supplier'), express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }), (req, res) => {
  const buf = req.body;
  if (!(Buffer.isBuffer(buf) && buf.length > 12 && SIGNATURES.find((x) => x.test(buf)))) return res.status(400).json({ error: 'Photo non reconnue (formats acceptés : JPG, PNG, WebP)' });
  saveDetoured(req, res, buf);
});
// Photo déjà envoyée sur Kamwa : on en crée une version détourée (l'originale est gardée)
router.post('/uploads/detoure-existante', requireRole('catalog', 'supplier'), (req, res) => {
  const m = /^\/images\/uploads\/([\w.-]+\.(jpg|png|webp))$/.exec(String(req.body?.src || ''));
  if (!m) return res.status(400).json({ error: 'Seules les photos envoyées depuis l\'espace pro peuvent être détourées' });
  const file = path.join(UPLOAD_DIR, m[1]);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Photo introuvable' });
  saveDetoured(req, res, fs.readFileSync(file));
});

module.exports = router;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
