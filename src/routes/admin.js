// API de l'espace admin (/api/admin/...). Tout est protégé par la connexion, sauf /login.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const { products, orders, payments, customers } = require('../store');
const customerAuth = require('../customer/auth');
const { login, logout, isLoggedIn, isPasswordSet, requireAdmin } = require('../admin/auth');
const { UNIVERSES, universeOf } = require('../catalog');
const { normalizeLocal } = require('../utils/phone');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads');

router.post('/login', login);
router.post('/logout', logout);
router.get('/me', (req, res) => res.json({ loggedIn: isLoggedIn(req), passwordSet: isPasswordSet() }));

router.use(requireAdmin);

router.get('/meta', (req, res) => res.json({ universes: UNIVERSES }));

// ---------- Commandes ----------
const STATUS_LABELS = { pending_payment: 'Non payée', paid: 'Payée', shipped: 'Expédiée', delivered: 'Livrée', cancelled: 'Annulée' };
// Changements de statut autorisés (avec retour arrière possible en cas d'erreur de clic)
const TRANSITIONS = {
  pending_payment: ['cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered', 'paid', 'cancelled'],
  delivered: ['shipped'],
  cancelled: [],
};

function adminOrder({ accessToken, ...order }) {
  const payment =
    (order.paymentId && payments.get(order.paymentId)) ||
    payments.all().filter((p) => p.orderId === order.id).pop();
  const account = order.customerId && customers.get(order.customerId);
  return {
    ...order,
    payment: payment ? { operator: payment.operator, phone: payment.phone, status: payment.status, reason: payment.reason } : null,
    account: account ? customerAuth.publicCustomer(account) : null,
  };
}

router.get('/orders', (req, res) => {
  const list = orders.all().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ orders: list.map(adminOrder), statusLabels: STATUS_LABELS, transitions: TRANSITIONS });
});

router.patch('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  const { status, customer, note } = req.body || {};
  const patch = {};

  if (status && status !== order.status) {
    if (!TRANSITIONS[order.status]?.includes(status)) {
      return res.status(400).json({ error: `Impossible de passer de « ${STATUS_LABELS[order.status]} » à « ${STATUS_LABELS[status] || status} »` });
    }
    const now = new Date().toISOString();
    patch.status = status;
    patch.history = [...(order.history || []), { status, at: now }];
    // Annulation d'une commande déjà payée : on remet les articles en stock (le remboursement se fait à la main).
    if (status === 'cancelled' && ['paid', 'shipped'].includes(order.status)) {
      for (const line of order.lines) {
        const p = products.get(line.productId);
        if (p && p.stock != null) products.update(p.id, { stock: p.stock + line.qty });
      }
    }
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

  res.json(adminOrder(orders.update(order.id, patch)));
});

// ---------- Clients ----------
router.get('/customers', (req, res) => {
  const all = orders.all();
  const list = customers
    .all()
    .map((c) => ({ ...customerAuth.publicCustomer(c), orders: all.filter((o) => o.customerId === c.id).length }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(list);
});

// « Code oublié » : un nouveau code est généré et montré UNE fois à l'admin, qui le transmet au client (WhatsApp, appel…).
router.post('/customers/:id/new-code', (req, res) => {
  const customer = customers.get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Client introuvable' });
  res.json({ code: customerAuth.assignNewCode(customer.id) });
});

// ---------- Produits ----------
const toInt = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

function cleanProduct(input, current = {}) {
  const p = { ...current };
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  if ('name' in input) p.name = str(input.name, 120);
  if ('brand' in input) p.brand = str(input.brand, 60);
  if ('description' in input) p.description = str(input.description, 1500);
  if ('category' in input) {
    p.universe = universeOf(input.category);
    if (!p.universe) return { error: 'Catégorie inconnue' };
    p.category = input.category;
  }
  if ('price' in input) p.price = toInt(input.price);
  if ('oldPrice' in input) p.oldPrice = input.oldPrice === '' || input.oldPrice === null ? null : toInt(input.oldPrice);
  if ('stock' in input) p.stock = toInt(input.stock);
  if ('image' in input) {
    const img = str(input.image, 200);
    if (img && !/^\/images\/(products|uploads)\/[\w.-]+$/.test(img)) return { error: 'Photo invalide' };
    p.image = img || undefined;
  }
  if ('color' in input) {
    if (input.color && !/^#[0-9a-fA-F]{6}$/.test(input.color)) return { error: 'Couleur invalide' };
    p.color = input.color || undefined;
  }
  if ('featured' in input) p.featured = Boolean(input.featured);
  if ('active' in input) p.active = Boolean(input.active);

  if (!p.name) return { error: 'Le nom est obligatoire' };
  if (!p.category) return { error: 'La catégorie est obligatoire' };
  if (!Number.isInteger(p.price) || p.price <= 0 || p.price > 100000000) return { error: 'Prix invalide (nombre entier en FCFA, sans espace ni point)' };
  if (p.oldPrice != null && (!Number.isInteger(p.oldPrice) || p.oldPrice <= p.price)) {
    return { error: 'Le prix barré doit être un nombre entier plus grand que le prix (ou laissé vide)' };
  }
  if (!Number.isInteger(p.stock) || p.stock < 0 || p.stock > 100000) return { error: 'Stock invalide (nombre entier, 0 ou plus)' };
  return { value: p };
}

router.get('/products', (req, res) => res.json(products.all()));

router.post('/products', (req, res) => {
  const { error, value } = cleanProduct({ active: true, ...(req.body || {}) });
  if (error) return res.status(400).json({ error });
  const product = { id: 'p' + crypto.randomBytes(4).toString('hex'), ...value, createdAt: new Date().toISOString() };
  res.status(201).json(products.insert(product));
});

router.patch('/products/:id', (req, res) => {
  const current = products.get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Produit introuvable' });
  const { error, value } = cleanProduct(req.body || {}, current);
  if (error) return res.status(400).json({ error });
  res.json(products.update(current.id, value));
});

// ---------- Photos ----------
// Le navigateur réduit la photo avant l'envoi (max ~1200 px) : fichiers légers pour les connexions lentes.
const SIGNATURES = [
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
];

router.post('/uploads', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), (req, res) => {
  const buf = req.body;
  const type = Buffer.isBuffer(buf) && buf.length > 12 && SIGNATURES.find((s) => s.test(buf));
  if (!type) return res.status(400).json({ error: 'Photo non reconnue (formats acceptés : JPG, PNG, WebP, 5 Mo max)' });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${type.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  res.status(201).json({ url: `/images/uploads/${name}` });
});

module.exports = router;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
