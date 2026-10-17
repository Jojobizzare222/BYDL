const crypto = require('crypto');
const { newDeliveryCode } = require('../delivery');
const { importSettings } = require('../imports');
const router = require('express').Router();
const billing = require('../billing');
const { products, orders } = require('../store');
const { normalizeLocal } = require('../utils/phone');
const { availableStock } = require('../utils/stock');
const { currentCustomer } = require('../customer/auth');
const { idStatus } = require('../customer/identity');
const { salesSettings } = require('../sales');

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
// Lignes vues par le client : sans le coût d'achat ni le fournisseur (données internes du volet Finances)
const clientLines = (lines) => (lines || []).map(({ unitCost, supplierId, ...l }) => l);
// Données internes de livraison et de caisse : jamais montrées au client
const INTERNAL = ['courierId', 'cashHeldBy', 'cashRemittedAt', 'cashRemittedTo', 'codeFails', 'codeLocked', 'codeVerifiedAt', 'callConfirmedBy',
  'callAttempts', 'deliveredBy', 'deliveredWithoutCode', 'depositPaymentId', 'refused', 'depositRetained', 'refundedAt'];
function clientOrder({ accessToken, note, paidAfterCancel, ...order }) {
  for (const k of INTERNAL) delete order[k];
  if (order.attempts) order.attempts = order.attempts.map(({ at, label }) => ({ at, label }));
  if (order.planned) order.planned = { date: order.planned.date, slot: order.planned.slot, label: require('../delivery').SLOTS[order.planned.slot] || '' };
  if (order.balancePaid) order.balancePaid = { method: order.balancePaid.method, at: order.balancePaid.at };
  if (order.import) {
    const i = order.import;
    order.import = {
      requestId: i.requestId, stage: i.stage, delay: i.delay, items: (i.items || []).map(({ title, qty, options, url }) => ({ title, qty, options, url })),
      boughtAt: i.bought?.at || null, receivedAt: i.received?.at || null, photos: i.received?.photos || [],
      departedAt: i.departedAt || null, eta: i.eta || null, arrivedAt: i.arrivedAt || null,
    };
  }
  // Factures / reçus / avoirs de la commande (liens avec la clé secrète de chaque document)
  const docs = order.id ? billing.forOrder(order.id).map(billing.publicDoc) : [];
  return { ...order, lines: clientLines(order.lines), documents: docs, parcels: order.id ? require('../parcels').clientParcels(order.id) : [] };
}
const publicOrder = clientOrder;

// Client connecté propriétaire de la commande ?
const isOwner = (req, order) => {
  const customer = currentCustomer(req);
  return Boolean(customer && order.customerId === customer.id);
};

const validPoint = (p) => {
  const lat = Number(p?.lat), lng = Number(p?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : null;
};
const distanceKm = (a, b) => {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Règle de vente : compte client avec pièce d'identité VÉRIFIÉE par Kamwa (réglable dans Kamwa Pro → Réglages).
// Renvoie null si le client peut commander, sinon la réponse d'erreur à envoyer.
function accountGate(account) {
  if (!salesSettings().accountRequired) return null;
  if (!account) return { status: 401, body: { error: 'Connectez-vous ou créez votre compte Kamwa pour commander', needAccount: true } };
  const st = idStatus(account);
  if (st === 'verified') return null;
  const why = { missing: "Ajoutez la photo de votre pièce d'identité dans « Mon compte » pour pouvoir commander.",
    pending: "Votre pièce d'identité est en cours de vérification par Kamwa. Vous pourrez commander dès qu'elle sera validée.",
    rejected: "Votre pièce d'identité a été refusée. Envoyez une nouvelle photo depuis « Mon compte »." }[st];
  return { status: 403, body: { error: why, idStatus: st } };
}

// Création de commande : le total est TOUJOURS recalculé côté serveur à partir du catalogue.
router.post('/', (req, res) => {
  const { items, customer } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Panier vide' });
  if (!customer?.name?.trim()) return res.status(400).json({ error: 'Nom obligatoire' });
  const account = currentCustomer(req);
  const gate = accountGate(account);
  if (gate) return res.status(gate.status).json(gate.body);

  const phone = normalizeLocal(customer.phone);
  if (!phone) return res.status(400).json({ error: 'Numéro de téléphone invalide (ex. 06 123 45 67)' });

  const lines = [];
  for (const { productId, qty, variant } of items) {
    const product = products.get(productId);
    const quantity = Math.floor(Number(qty));
    if (!product || product.active === false || product.pending) return res.status(400).json({ error: `Produit indisponible : ${productId}` });
    if (!(quantity >= 1 && quantity <= 99)) return res.status(400).json({ error: 'Quantité invalide' });
    if (quantity > availableStock(product)) {
      return res.status(400).json({ error: `Stock insuffisant pour ${product.name}` });
    }
    // Choix du client (couleur, taille…) : chaque choix proposé doit être renseigné avec une valeur existante
    let chosen = null;
    if ((product.options || []).length) {
      const sel = variant && typeof variant === 'object' ? variant : {};
      const parts = [];
      for (const o of product.options) {
        if (!o.values.includes(sel[o.name])) return res.status(400).json({ error: `Choisissez : ${o.name} (${product.name})` });
        parts.push(`${o.name} : ${sel[o.name]}`);
      }
      chosen = parts.join(' · ');
    }
    lines.push({ productId, name: product.name, unitPrice: product.price, qty: quantity, total: product.price * quantity, ...(chosen ? { variant: chosen } : {}) });
  }
  // Produits venus de France : la commande suit le circuit d'achat en France (agent, envoi en avion, arrivée)
  const fr = lines.filter((l) => products.get(l.productId)?.origin === 'FR');
  const importInfo = fr.length ? {
    requestId: null, stage: 'to_buy', delay: importSettings().delay,
    items: fr.map((l) => { const p = products.get(l.productId); return { title: p.name, qty: l.qty, options: l.variant || '', url: p.sourceUrl || '', priceEur: p.priceEur || 0, shippingEur: 0 }; }),
  } : null;

  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const order = orders.insert({
    id: newOrderId(),
    accessToken: crypto.randomBytes(16).toString('hex'),
    customerId: account?.id || null, // commande rattachée au compte si le client est connecté
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
      // Adresse placée sur la carte par le client (facultatif) : aide le livreur et le suivi en direct
      ...(validPoint(customer.location) ? { location: validPoint(customer.location) } : {}),
    },
    status: 'pending_payment', // pending_payment -> paid (ou confirmed si paiement à la réception) -> shipped -> delivered | cancelled
    deliveryCode: newDeliveryCode(), // à donner au livreur (ou à l'agence) seulement à la remise du colis
    ...(importInfo ? { import: importInfo } : {}),
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

// Suivi EN DIRECT de la livraison (façon Grab) : position du livreur pendant SA livraison en cours seulement.
// Position gardée 3 minutes au plus (au-delà : « suivi momentanément indisponible »), jamais d'historique.
router.get('/:id/live', (req, res) => {
  const { staff } = require('../store');
  const order = orders.get(req.params.id);
  if (!order || !(hasAccess(order, req.get('X-Order-Token')) || isOwner(req, order))) return res.status(404).json({ error: 'Commande introuvable' });
  res.set('Cache-Control', 'no-store');
  const dest = order.customer?.location || null;
  if (order.status !== 'shipped' || !order.courierId) return res.json({ active: false, status: order.status, destination: dest });
  const c = staff.get(order.courierId);
  const pos = c?.livePos;
  const fresh = pos && Date.now() - Date.parse(pos.at) < 3 * 60 * 1000;
  if (!fresh) return res.json({ active: false, status: 'shipped', courierName: String(c?.name || 'Votre livreur').split(' ')[0], destination: dest, waiting: true });
  const out = { active: true, status: 'shipped', courier: { name: String(c.name || 'Votre livreur').split(' ')[0], lat: pos.lat, lng: pos.lng, heading: pos.heading ?? null, at: pos.at }, destination: dest };
  if (dest) {
    const km = distanceKm(pos, dest);
    out.distanceKm = Math.round(km * 10) / 10;
    out.etaMin = Math.max(1, Math.round(((km * 1.35) / 18) * 60)); // détours en ville (×1,35), 18 km/h en moyenne
    // Barre de progression : distance au départ du livreur (première position connue de cette livraison)
    const start = order.liveStartKm || (orders.update(order.id, { liveStartKm: Math.max(km, 0.1) }), Math.max(km, 0.1));
    out.progress = Math.max(0, Math.min(1, 1 - km / Math.max(start, km)));
  }
  res.json(out);
});

// Changer de point relais après la commande (client propriétaire ou navigateur qui a la clé) :
//  - retrait au point relais : tant que le colis n'est pas remis ;
//  - paiement au point relais puis livraison : tant que la commande n'est pas payée.
// L'équipe est prévenue (le colis doit peut-être être déplacé) ; chaque changement est gardé dans la commande.
router.post('/:id/relay', (req, res) => {
  const { agencies } = require('../store');
  const order = orders.get(req.params.id);
  if (!order || !(hasAccess(order, req.get('X-Order-Token')) || isOwner(req, order))) return res.status(404).json({ error: 'Commande introuvable' });
  if (!order.agency) return res.status(400).json({ error: "Cette commande n'utilise pas de point relais" });
  const open = order.fulfillment === 'pickup' ? ['pending_payment', 'paid', 'confirmed'].includes(order.status) : order.status === 'pending_payment';
  if (!open) return res.status(409).json({ error: order.fulfillment === 'pickup' ? 'Colis déjà remis : le point relais ne peut plus changer' : 'Commande déjà payée : le point relais ne peut plus changer' });
  const a = agencies.get(String(req.body?.agencyId || ''));
  if (!a || a.active === false) return res.status(400).json({ error: 'Choisissez un point relais ouvert' });
  if (a.id === order.agency.id) return res.json(publicOrder(order));
  const { id, name, city, address, hours, phone, kind, lat, lng } = a;
  const updated = orders.update(order.id, {
    agency: { id, name, city, address, hours, phone, kind: kind || 'agency', lat: lat ?? null, lng: lng ?? null },
    relayChanges: [...(order.relayChanges || []), { from: order.agency.name, to: name, at: new Date().toISOString() }],
    ...(order.fulfillment === 'pickup' ? { customer: { ...order.customer, city, address: `Retrait au point relais : ${name}` } } : {}),
  });
  require('../notify').notifyRelayChange(updated).catch(() => {});
  res.json(publicOrder(updated));
});

module.exports = router;
module.exports.hasAccess = hasAccess;
module.exports.clientLines = clientLines;
module.exports.clientOrder = clientOrder;
module.exports.newOrderId = newOrderId;
module.exports.accountGate = accountGate;
