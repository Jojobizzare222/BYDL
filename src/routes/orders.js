const crypto = require('crypto');
const router = require('express').Router();
const { products, orders } = require('../store');
const { normalizeLocal } = require('../utils/phone');
const { availableStock } = require('../utils/stock');
const { currentCustomer } = require('../customer/auth');

const newOrderId = () =>
  'CMD-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();

// Clé secrète remise au seul navigateur qui a créé la commande : sans elle, impossible de lire
// les coordonnées du client ni de déclencher un paiement.
function hasAccess(order, token) {
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(order.accessToken || '');
  return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
}

// Version renvoyée au client : sans la clé secrète ni les informations internes de l'admin.
const publicOrder = ({ accessToken, note, paidAfterCancel, ...order }) => order;

// Client connecté propriétaire de la commande ?
const isOwner = (req, order) => {
  const customer = currentCustomer(req);
  return Boolean(customer && order.customerId === customer.id);
};

// Création de commande : le total est TOUJOURS recalculé côté serveur à partir du catalogue.
router.post('/', (req, res) => {
  const { items, customer } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Panier vide' });
  if (!customer?.name?.trim()) return res.status(400).json({ error: 'Nom obligatoire' });

  const phone = normalizeLocal(customer.phone);
  if (!phone) return res.status(400).json({ error: 'Numéro de téléphone invalide (ex. 06 123 45 67)' });

  const lines = [];
  for (const { productId, qty } of items) {
    const product = products.get(productId);
    const quantity = Math.floor(Number(qty));
    if (!product || product.active === false) return res.status(400).json({ error: `Produit indisponible : ${productId}` });
    if (!(quantity >= 1 && quantity <= 99)) return res.status(400).json({ error: 'Quantité invalide' });
    if (quantity > availableStock(product)) {
      return res.status(400).json({ error: `Stock insuffisant pour ${product.name}` });
    }
    lines.push({ productId, name: product.name, unitPrice: product.price, qty: quantity, total: product.price * quantity });
  }

  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const order = orders.insert({
    id: newOrderId(),
    accessToken: crypto.randomBytes(16).toString('hex'),
    customerId: currentCustomer(req)?.id || null, // commande rattachée au compte si le client est connecté
    lines,
    subtotal,
    deliveryFee: 0, // à définir selon la zone (Pointe-Noire, Brazzaville…)
    total: subtotal,
    currency: 'XAF',
    customer: {
      name: customer.name.trim(),
      phone,
      city: (customer.city || '').trim(),
      address: (customer.address || '').trim(),
    },
    status: 'pending_payment', // pending_payment -> paid -> shipped -> delivered | cancelled
    createdAt: new Date().toISOString(),
  });

  // Seule réponse qui contient la clé : le navigateur la garde pour la suite (paiement, page « merci »).
  res.status(201).json({ ...publicOrder(order), token: order.accessToken });
});

// La clé est transmise dans un en-tête (jamais dans l'adresse, pour ne pas la laisser dans les journaux).
router.get('/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order || !(hasAccess(order, req.get('X-Order-Token')) || isOwner(req, order))) {
    return res.status(404).json({ error: 'Commande introuvable' });
  }
  res.json(publicOrder(order));
});

module.exports = router;
module.exports.hasAccess = hasAccess;
