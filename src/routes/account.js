// Espace client (/api/account/...) : création de compte, connexion, historique et suivi des commandes.
const crypto = require('crypto');
const router = require('express').Router();
const { customers, orders, payments } = require('../store');
const { normalizeLocal } = require('../utils/phone');
const auth = require('../customer/auth');
const { hasAccess, clientOrder } = require('./orders');

// Vue client d'une commande : jamais la clé secrète, jamais le détail interne (note admin).
function customerOrder(o) {
  const order = clientOrder(o);
  const payment = order.paymentId && payments.get(order.paymentId);
  return { ...order, payment: payment ? { operator: payment.operator, phone: payment.phone } : null };
}

// Rattache au compte les commandes passées depuis ce téléphone (preuve : leur clé secrète gardée par le navigateur).
function claimDeviceOrders(customerId, deviceOrders) {
  let claimed = 0;
  for (const { id, token } of Array.isArray(deviceOrders) ? deviceOrders.slice(0, 50) : []) {
    const order = orders.get(id);
    if (order && !order.customerId && hasAccess(order, token)) {
      orders.update(order.id, { customerId });
      claimed += 1;
    }
  }
  return claimed;
}

router.get('/me', (req, res) => {
  const customer = auth.currentCustomer(req);
  res.json(customer ? { loggedIn: true, customer: auth.publicCustomer(customer) } : { loggedIn: false });
});

// Création de compte : nom + (téléphone et/ou e-mail). Le code à 6 chiffres est renvoyé UNE seule fois.
router.post('/register', (req, res) => {
  const { name, phone, email, deviceOrders } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 120);
  if (!cleanName) return res.status(400).json({ error: 'Votre nom est obligatoire' });
  const p = phone ? normalizeLocal(phone) : null;
  const e = email ? auth.normEmail(email) : null;
  if (phone && !p) return res.status(400).json({ error: 'Numéro invalide (ex. 06 123 45 67)' });
  if (email && !e) return res.status(400).json({ error: 'Adresse e-mail invalide' });
  if (!p && !e) return res.status(400).json({ error: 'Indiquez un numéro de téléphone ou une adresse e-mail' });
  if (p && customers.find((c) => c.phone === p)) return res.status(409).json({ error: 'Un compte existe déjà avec ce numéro. Connectez-vous avec votre code.' });
  if (e && customers.find((c) => c.email === e)) return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail. Connectez-vous avec votre code.' });

  const code = auth.newCode();
  const customer = customers.insert({
    id: 'CLI-' + crypto.randomBytes(5).toString('hex').toUpperCase(),
    name: cleanName,
    phone: p || null,
    email: e || null,
    codeHash: auth.hashCode(code),
    createdAt: new Date().toISOString(),
  });
  auth.openSession(req, res, customer.id);
  const claimed = claimDeviceOrders(customer.id, deviceOrders);
  res.status(201).json({ customer: auth.publicCustomer(customer), code, claimed });
});

router.post('/login', (req, res) => {
  const { identifier, code, deviceOrders } = req.body || {};
  const result = auth.verifyLogin(req, identifier, String(code || '').replace(/\s/g, ''));
  if (result.error) return res.status(result.status).json({ error: result.error });
  auth.openSession(req, res, result.customer.id);
  const claimed = claimDeviceOrders(result.customer.id, deviceOrders);
  res.json({ customer: auth.publicCustomer(result.customer), claimed });
});

router.post('/logout', (req, res) => {
  auth.closeSession(req, res);
  res.json({ ok: true });
});

// Historique des commandes du client connecté (les plus récentes d'abord)
router.get('/orders', (req, res) => {
  const customer = auth.currentCustomer(req);
  if (!customer) return res.status(401).json({ error: 'Connectez-vous pour voir vos commandes' });
  const list = orders
    .all()
    .filter((o) => o.customerId === customer.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(customerOrder);
  res.json(list);
});

// Rattacher des commandes de ce téléphone à un compte déjà connecté
router.post('/claim', (req, res) => {
  const customer = auth.currentCustomer(req);
  if (!customer) return res.status(401).json({ error: 'Connectez-vous' });
  res.json({ claimed: claimDeviceOrders(customer.id, req.body?.deviceOrders) });
});

module.exports = router;
module.exports.customerOrder = customerOrder;
