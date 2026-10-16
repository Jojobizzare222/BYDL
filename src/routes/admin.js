// API de l'espace admin (/api/admin/...). Tout est protégé par la connexion, sauf /login.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const { products, orders, payments, customers, agencies, staff, activity } = require('../store');
const { settleSuccessfulPayment } = require('./payments');
const customerAuth = require('../customer/auth');
const {
  ROLES, ADMIN_LOGIN, login, logout, currentUser, isPasswordSet, requireStaff, requireRole,
  hashPassword, checkPassword, tempPassword, normLogin, findStaff, closeSessionsOf,
} = require('../admin/auth');
const { UNIVERSES, universeOf } = require('../catalog');
const demo = require('../demo');
const { normalizeLocal } = require('../utils/phone');

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
const STATUS_LABELS = { pending_payment: 'Non payée', paid: 'Payée', shipped: 'Expédiée', delivered: 'Livrée', cancelled: 'Annulée' };
// Changements de statut autorisés (avec retour arrière possible en cas d'erreur de clic)
const TRANSITIONS = {
  pending_payment: ['cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered', 'paid', 'cancelled'],
  delivered: ['shipped'],
  cancelled: [],
};
// Retrait en agence : pas d'expédition, l'article est remis directement au client (« delivered » = remis).
const PICKUP_TRANSITIONS = {
  pending_payment: ['cancelled'],
  paid: ['delivered', 'cancelled'],
  delivered: ['paid'],
  cancelled: [],
};
const transitionsFor = (order) => (order.fulfillment === 'pickup' ? PICKUP_TRANSITIONS : TRANSITIONS);

function adminOrder({ accessToken, ...order }) {
  const payment =
    (order.paymentId && payments.get(order.paymentId)) ||
    payments.all().filter((p) => p.orderId === order.id).pop();
  const account = order.customerId && customers.get(order.customerId);
  return {
    ...order,
    payment: payment ? { operator: payment.operator, phone: payment.phone, status: payment.status, reason: payment.reason, expiresAt: payment.expiresAt || null } : null,
    account: account ? customerAuth.publicCustomer(account) : null,
  };
}

router.get('/orders', requireRole('orders'), (req, res) => {
  const list = orders.all().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ orders: list.map(adminOrder), statusLabels: STATUS_LABELS, transitions: TRANSITIONS, pickupTransitions: PICKUP_TRANSITIONS });
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
    if (status === 'cancelled' && ['paid', 'shipped', 'delivered'].includes(order.status)) {
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

  const updated = orders.update(order.id, patch);
  const what = [patch.status && `statut : ${STATUS_LABELS[order.status]} → ${STATUS_LABELS[patch.status]}`, patch.customer && 'coordonnées client modifiées', 'note' in patch && 'note modifiée'].filter(Boolean).join(' ; ');
  if (what) log(req, 'Commande modifiée', { id: order.id, name: order.id }, what);
  res.json(adminOrder(updated));
});

// Espèces reçues en agence : le paiement est confirmé à la main par l'admin.
router.post('/orders/:id/cash-received', requireRole('orders'), (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (order.status !== 'pending_payment') return res.status(400).json({ error: 'Cette commande est déjà payée ou annulée' });
  // Dernière réservation en espèces (même expirée : si le client vient quand même et paie, on encaisse)
  const cash = payments.all().filter((p) => p.orderId === order.id && p.operator === 'cash' && p.status !== 'CANCELLED').pop();
  if (!cash) return res.status(400).json({ error: "Cette commande n'est pas une réservation en agence" });
  payments.update(cash.id, { status: 'SUCCESSFUL', reason: null, confirmedAt: new Date().toISOString() });
  settleSuccessfulPayment(payments.get(cash.id));
  log(req, 'Paiement en espèces encaissé', { id: order.id, name: order.id }, `${order.total} FCFA`);
  res.json(adminOrder(orders.get(order.id)));
});

// ---------- Agences (retrait et paiement en espèces) ----------
function cleanAgency(input, current = {}) {
  const a = { ...current };
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  for (const [key, max] of [['name', 80], ['city', 60], ['address', 200], ['hours', 120], ['phone', 30]]) {
    if (key in input) a[key] = str(input[key], max);
  }
  if ('active' in input) a.active = Boolean(input.active);
  if (!a.name) return { error: "Le nom de l'agence est obligatoire" };
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
    .map((c) => ({ ...customerAuth.publicCustomer(c), orders: all.filter((o) => o.customerId === c.id).length }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(list);
});

// « Code oublié » : un nouveau code est généré et montré UNE fois à l'admin, qui le transmet au client (WhatsApp, appel…).
router.post('/customers/:id/new-code', requireRole(), (req, res) => {
  const customer = customers.get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Client introuvable' });
  res.json({ code: customerAuth.assignNewCode(customer.id) });
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
  if (!['catalog', 'orders', 'supplier'].includes(role)) return res.status(400).json({ error: 'Rôle inconnu' });
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
  const soldInPeriod = allOrders.filter((o) => SOLD.includes(o.status) && Date.parse(o.paidAt || o.createdAt) >= since);
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
  const isCashToCollect = (o) => o.status === 'pending_payment' && o.fulfillment === 'pickup' && o.pickupDeadline && Date.parse(o.pickupDeadline) > Date.now();
  const perDay = (fn) => labels.map((d) => soldInPeriod.filter((o) => dayKey(o.paidAt || o.createdAt) === d).reduce((s, o) => s + fn(o), 0));
  const todo = {
    toShip: allOrders.filter((o) => o.status === 'paid').length,
    toCollect: allOrders.filter(isCashToCollect).length,
    inTransit: allOrders.filter((o) => o.status === 'shipped').length,
    refunds: allOrders.filter((o) => o.paidAfterCancel).length,
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

router.post('/uploads', requireRole('catalog', 'supplier'), express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), (req, res) => {
  const buf = req.body;
  const type = Buffer.isBuffer(buf) && buf.length > 12 && SIGNATURES.find((s) => s.test(buf));
  if (!type) return res.status(400).json({ error: 'Photo non reconnue (formats acceptés : JPG, PNG, WebP, 5 Mo max)' });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${type.ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  res.status(201).json({ url: `/images/uploads/${name}` });
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
