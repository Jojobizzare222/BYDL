// Espace client (/api/account/...) : création de compte, connexion, historique et suivi des commandes.
const crypto = require('crypto');
const router = require('express').Router();
const { customers, orders, payments } = require('../store');
const { normalizeLocal } = require('../utils/phone');
const auth = require('../customer/auth');
const identity = require('../customer/identity');
const { notifyIdentity } = require('../notify');
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

// Création de compte : nom + (téléphone et/ou e-mail) + photo de la pièce d'identité (obligatoire).
// Le code à 6 chiffres est renvoyé UNE seule fois. Le compte peut commander quand l'admin a vérifié la pièce.
router.post('/register', async (req, res) => {
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
  const id = await identity.readSubmission(req.body);
  if (id.error) return res.status(400).json({ error: id.error });

  const code = auth.newCode();
  const customer = customers.insert({
    id: 'CLI-' + crypto.randomBytes(5).toString('hex').toUpperCase(),
    name: cleanName,
    phone: p || null,
    email: e || null,
    codeHash: auth.hashCode(code),
    ...id.fields,
    createdAt: new Date().toISOString(),
  });
  identity.checkLater(customer.id, id); // lecture automatique de la pièce (résultat pour l'admin)
  notifyIdentity(customer);
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

// Envoyer (ou renvoyer) sa pièce d'identité : compte créé avant cette règle, ou pièce refusée par l'admin
router.post('/identity', async (req, res) => {
  const customer = auth.currentCustomer(req);
  if (!customer) return res.status(401).json({ error: 'Connectez-vous' });
  if (['pending', 'verified'].includes(identity.idStatus(customer))) return res.status(409).json({ error: 'Votre pièce est déjà enregistrée' });
  const id = await identity.readSubmission(req.body);
  if (id.error) return res.status(400).json({ error: id.error });
  identity.removePhoto(customer.idPhoto); // l'ancienne photo refusée n'est pas gardée
  const updated = customers.update(customer.id, id.fields);
  identity.checkLater(customer.id, id);
  notifyIdentity(updated);
  res.json({ customer: auth.publicCustomer(updated) });
});

// ---------- Réglages personnels du client ----------
// Ils ne changent QUE l'affichage pour ce client (sur ses appareils) : jamais le site des autres, jamais le catalogue.
// Liste fermée de réglages, valeurs contrôlées : rien d'autre n'est enregistré.
const PREFS = {
  theme: ['light', 'dark', 'auto'], textSize: ['normal', 'large', 'xlarge'], density: ['comfort', 'compact'],
  motion: ['normal', 'reduce'], splash: [true, false], dataSaver: [true, false], showFlash: [true, false],
};
function cleanPrefs(input, cur = {}) {
  const out = { ...cur };
  for (const [k, allowed] of Object.entries(PREFS)) if (k in (input || {}) && allowed.includes(input[k])) out[k] = input[k];
  const { UNIVERSES } = require('../catalog');
  const names = UNIVERSES.map((u) => u.name);
  if ('homeUniverse' in (input || {})) out.homeUniverse = names.includes(input.homeUniverse) ? input.homeUniverse : '';
  if (Array.isArray(input?.hiddenUniverses)) out.hiddenUniverses = input.hiddenUniverses.filter((n) => names.includes(n)).slice(0, names.length - 1); // au moins un rayon reste visible
  if ('city' in (input || {})) { const f = require('../fees').feeSettings(); out.city = [...f.cities.map((c) => c.city), 'Autre ville'].includes(input.city) ? input.city : ''; }
  if ('relayId' in (input || {})) { const { agencies } = require('../store'); const a = agencies.get(String(input.relayId || '')); out.relayId = a && a.active !== false ? a.id : ''; }
  if (input?.notify && typeof input.notify === 'object') out.notify = { orders: input.notify.orders !== false, chat: input.notify.chat !== false };
  return out;
}
router.put('/prefs', (req, res) => {
  const customer = auth.currentCustomer(req);
  if (!customer) return res.status(401).json({ error: 'Connectez-vous' });
  const updated = customers.update(customer.id, { prefs: cleanPrefs(req.body, customer.prefs || {}) });
  res.json({ prefs: updated.prefs });
});

// Changer son code Kamwa soi-même (code actuel obligatoire) : le nouveau code est montré UNE fois
router.post('/code', (req, res) => {
  const customer = auth.currentCustomer(req);
  if (!customer) return res.status(401).json({ error: 'Connectez-vous' });
  const check = auth.verifyLogin(req, customer.phone || customer.email, String(req.body?.code || '').replace(/\s/g, ''));
  if (check.error) return res.status(check.status).json({ error: check.status === 401 ? 'Code actuel incorrect' : check.error });
  const code = auth.assignNewCode(customer.id); // déconnecte les autres appareils
  auth.openSession(req, res, customer.id);
  res.json({ code, codeChangedAt: customers.get(customer.id).codeChangedAt });
});

// Historique des commandes du client connecté (les plus récentes d'abord)
router.get('/orders', (req, res) => {
  const customer = auth.currentCustomer(req);
  if (!customer) return res.status(401).json({ error: 'Connectez-vous pour voir vos commandes' });
  try { require('../abandon').sweep(); } catch {}
  const list = orders
    .all()
    .filter((o) => o.customerId === customer.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(customerOrder);
  res.json(list);
});

// Rattacher des commandes de ce téléphone à un compte déjà connecté
// Avis client : seulement sur un produit reçu (commande livrée sur ce compte) ; un avis par produit, modifiable
router.post('/reviews', (req, res) => {
  const me = auth.currentCustomer(req);
  if (!me) return res.status(401).json({ error: 'Connectez-vous pour donner votre avis' });
  const r = require('../reviews').save(me, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.status(201).json(require('../reviews').publicReview(r.value));
});

router.post('/claim', (req, res) => {
  const customer = auth.currentCustomer(req);
  if (!customer) return res.status(401).json({ error: 'Connectez-vous' });
  res.json({ claimed: claimDeviceOrders(customer.id, req.body?.deviceOrders) });
});

module.exports = router;
module.exports.customerOrder = customerOrder;
