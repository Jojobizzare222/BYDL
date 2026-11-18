// /api/feedback : avis du client sur le SERVICE (une commande livrée) et sur l'APPLICATION (src/feedback.js)
const router = require('express').Router();
const { orders } = require('../store');
const fb = require('../feedback');
const { currentCustomer } = require('../customer/auth');
const { hasAccess } = require('./orders');

// Limite par adresse : 10 avis par heure (beaucoup de téléphones partagent une adresse chez l'opérateur)
const hits = new Map();
const tooMany = (req) => {
  if (process.env.RATE_LIMIT === 'off') return false; // tests automatiques
  const k = req.ip || 'x', now = Date.now();
  const l = (hits.get(k) || []).filter((t) => now - t < 3600e3);
  l.push(now); hits.set(k, l);
  if (hits.size > 5000) hits.clear();
  return l.length > 10;
};
// Commande lisible par ce client : propriétaire connecté OU clé secrète de la commande
const orderFor = (req, id, token) => {
  const o = orders.get(String(id || ''));
  if (!o) return null;
  const me = currentCustomer(req);
  return (me && o.customerId === me.id) || hasAccess(o, token || req.get('X-Order-Token')) ? o : null;
};

router.get('/options', (req, res) => res.json({ tags: fb.TAGS }));

// Mon avis déjà donné : sur une commande (service) ou sur l'application (client connecté)
router.get('/mine', (req, res) => {
  if (req.query.order) {
    const o = orderFor(req, req.query.order, req.query.token);
    if (!o) return res.status(404).json({ error: 'Commande introuvable' });
    return res.json({ feedback: fb.forOrder(o.id), canRate: o.status === 'delivered' });
  }
  const me = currentCustomer(req);
  res.json({ feedback: me ? fb.forCustomerApp(me.id) : null });
});

router.post('/', (req, res) => {
  if (tooMany(req)) return res.status(429).json({ error: 'Trop d\'avis envoyés : réessayez dans une heure' });
  const b = req.body || {};
  const customer = currentCustomer(req);
  let order = null;
  if (b.kind === 'service') {
    order = orderFor(req, b.orderId, b.token);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  }
  const r = fb.save(b.kind, b, { customer, order, visitor: b.visitor });
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.status(r.updated ? 200 : 201).json({ ok: true, updated: Boolean(r.updated), feedback: fb.forOrder(order?.id) || (customer ? fb.forCustomerApp(customer.id) : { kind: b.kind, rating: r.value.rating }) });
});

module.exports = router;
