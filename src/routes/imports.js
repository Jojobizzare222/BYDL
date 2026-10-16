// Achat en Europe — partie publique (/api/imports) : demande de devis, consultation, acceptation.
// Accès à une demande : sa clé secrète (comme une commande), gardée par le téléphone du client et envoyée dans le lien WhatsApp.
const crypto = require('crypto');
const router = require('express').Router();
const { imports, orders } = require('../store');
const { normalizeLocal } = require('../utils/phone');
const { currentCustomer } = require('../customer/auth');
const { newOrderId, clientOrder } = require('./orders');
const imp = require('../imports');
const { newDeliveryCode } = require('../delivery');
const { notifyImportRequest } = require('../notify');

function hasAccess(r, token) {
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(r.accessToken || '');
  return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
}
// Ce que voit le client : sa demande, le devis (total et détail simplifié), sans les notes internes
const publicImport = (r) => ({
  id: r.id, status: imp.statusOf(r), createdAt: r.createdAt, items: r.items, customer: r.customer, note: r.note,
  quote: r.quote ? { items: r.quote.items, total: r.quote.total, validUntil: r.quote.validUntil, message: r.quote.message, delay: r.quote.delay, breakdown: r.quote.breakdown && { goods: r.quote.breakdown.goods, freight: r.quote.breakdown.freight, customs: r.quote.breakdown.customs, commission: r.quote.breakdown.commission } } : null,
  declineReason: r.declineReason || null, orderId: r.orderId || null,
});

router.get('/settings', (req, res) => {
  const s = imp.importSettings();
  res.json({ enabled: s.enabled, customerRequests: s.customerRequests, delay: s.delay, validityHours: s.validityHours });
});

// Anti-abus : 10 demandes par heure et par adresse
const recent = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 3600e3);
  list.push(now); recent.set(ip, list);
  return list.length > 10;
}

const cleanUrl = (u) => {
  try { const x = new URL(String(u || '').trim()); return ['http:', 'https:'].includes(x.protocol) ? x.href.slice(0, 600) : null; } catch { return null; }
};

router.post('/', (req, res) => {
  if (!imp.importSettings().enabled || !imp.importSettings().customerRequests) return res.status(403).json({ error: "Les demandes de devis sur lien ne sont pas ouvertes" });
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Trop de demandes. Réessayez dans une heure.' });
  const { items, customer, note } = req.body || {};
  if (!Array.isArray(items) || !items.length || items.length > 5) return res.status(400).json({ error: 'Ajoutez de 1 à 5 articles' });
  const clean = [];
  for (const it of items) {
    const url = cleanUrl(it.url);
    if (!url) return res.status(400).json({ error: 'Lien invalide : copiez l\'adresse complète de la page du produit (commence par https://)' });
    const qty = Math.floor(Number(it.qty) || 1);
    if (qty < 1 || qty > 20) return res.status(400).json({ error: 'Quantité invalide (1 à 20)' });
    const priceEur = it.priceEur === '' || it.priceEur == null ? null : Number(String(it.priceEur).replace(',', '.'));
    if (priceEur != null && !(priceEur > 0 && priceEur < 100000)) return res.status(400).json({ error: 'Prix en euros invalide' });
    clean.push({ url, title: String(it.title || '').trim().slice(0, 140), options: String(it.options || '').trim().slice(0, 200), qty, priceEur });
  }
  if (!customer?.name?.trim()) return res.status(400).json({ error: 'Nom obligatoire' });
  const phone = normalizeLocal(customer.phone);
  if (!phone) return res.status(400).json({ error: 'Numéro de téléphone invalide (ex. 06 123 45 67)' });
  const now = new Date().toISOString();
  const r = imports.insert({
    id: imp.newImportId(), accessToken: crypto.randomBytes(16).toString('hex'), customerId: currentCustomer(req)?.id || null,
    items: clean, note: String(note || '').trim().slice(0, 500),
    customer: { name: customer.name.trim().slice(0, 120), phone, city: String(customer.city || '').trim().slice(0, 60), address: String(customer.address || '').trim().slice(0, 300) },
    status: 'requested', createdAt: now, history: [{ status: 'requested', at: now }],
  });
  notifyImportRequest(r).catch(() => {});
  res.status(201).json({ ...publicImport(r), token: r.accessToken });
});

function load(req, res) {
  const r = imports.get(req.params.id);
  if (!r || !hasAccess(r, req.get('X-Import-Token') || req.body?.token)) { res.status(404).json({ error: 'Demande introuvable' }); return null; }
  return r;
}
router.get('/:id', (req, res) => { const r = load(req, res); if (r) res.json(publicImport(r)); });

// Le client accepte le devis : il devient une commande Kamwa à payer EN ENTIER (Mobile Money ou carte)
router.post('/:id/accept', (req, res) => {
  const r = load(req, res); if (!r) return;
  if (r.orderId) {
    const o = orders.get(r.orderId);
    return res.json({ orderId: r.orderId, token: o.accessToken, order: clientOrder(o) });
  }
  if (imp.statusOf(r) !== 'quoted') return res.status(400).json({ error: imp.isExpired(r) ? 'Ce devis a expiré : demandez-en un nouveau (les prix ont pu changer).' : "Ce devis n'est pas disponible" });
  const q = r.quote;
  // Répartition du prix tout compris entre les articles (au prorata de leur prix en euros)
  const weights = q.items.map((it) => (it.priceEur * it.qty + (it.shippingEur || 0)) || 1);
  const sumW = weights.reduce((a, b) => a + b, 0);
  let rest = q.total;
  const costTotal = q.breakdown.cost;
  const lines = q.items.map((it, i) => {
    const share = i === q.items.length - 1 ? rest : Math.round((q.total * weights[i]) / sumW);
    rest -= share;
    const cost = Math.round((costTotal * weights[i]) / sumW);
    return { productId: null, name: `${it.title} (achat en Europe)`, unitPrice: Math.round(share / it.qty), qty: it.qty, total: share, unitCost: Math.round(cost / it.qty), supplierId: null };
  });
  const now = new Date().toISOString();
  const order = orders.insert({
    id: newOrderId(), accessToken: crypto.randomBytes(16).toString('hex'), customerId: r.customerId || currentCustomer(req)?.id || null,
    lines, subtotal: q.total, deliveryFee: 0, total: q.total, currency: 'XAF', customer: r.customer,
    status: 'pending_payment', createdAt: now, fulfillment: 'delivery', deliveryCode: newDeliveryCode(),
    import: { requestId: r.id, stage: 'to_buy', delay: q.delay, items: q.items.map((it, i) => ({ ...it, url: r.items[i]?.url || it.url, options: r.items[i]?.options || it.options || '' })) },
  });
  imports.update(r.id, { status: 'accepted', orderId: order.id, history: [...(r.history || []), { status: 'accepted', at: now }] });
  res.status(201).json({ orderId: order.id, token: order.accessToken, order: clientOrder(order) });
});

router.post('/:id/cancel', (req, res) => {
  const r = load(req, res); if (!r) return;
  if (!['requested', 'quoted'].includes(r.status)) return res.status(400).json({ error: 'Cette demande ne peut plus être annulée' });
  const updated = imports.update(r.id, { status: 'cancelled', history: [...(r.history || []), { status: 'cancelled', at: new Date().toISOString() }] });
  res.json(publicImport(updated));
});

module.exports = router;
module.exports.publicImport = publicImport;
