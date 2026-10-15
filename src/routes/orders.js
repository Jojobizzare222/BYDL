const crypto = require('crypto');
const router = require('express').Router();
const { products, orders } = require('../store');
const { normalizeLocal } = require('../utils/phone');

const newOrderId = () =>
  'CMD-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

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
    if (product.stock != null && quantity > product.stock) {
      return res.status(400).json({ error: `Stock insuffisant pour ${product.name}` });
    }
    lines.push({ productId, name: product.name, unitPrice: product.price, qty: quantity, total: product.price * quantity });
  }

  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const order = orders.insert({
    id: newOrderId(),
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

  res.status(201).json(order);
});

router.get('/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  res.json(order);
});

module.exports = router;
