// Zado Pro → Achats (/api/admin/purchases) [admin, catalog] et Stock (/api/admin/stock) [admin, catalog] ;
// espace fournisseur : ses bons de commande à confirmer (/api/admin/purchases/mine) [supplier].
const crypto = require('crypto');
const router = require('express').Router();
const { products, staff, activity, purchases: store } = require('../store');
const { requireRole } = require('../admin/auth');
const P = require('../purchases');
const stock = require('../stock-moves');
const billing = require('../billing');

function log(req, action, target, details = '') {
  activity.insert({
    id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(),
    userId: req.user.id, userName: req.user.name, role: req.user.role,
    action, targetId: target?.id || null, targetName: target?.name || null, details,
  });
}
const actor = (req) => ({ id: req.user.id, role: req.user.role, name: req.user.name });
const reply = (req, res, r, action, bc, details = '') => {
  if (r.error) return res.status(400).json({ error: r.error });
  if (action) log(req, action, { id: r.value.id, name: r.value.number }, details);
  res.json(forRole(req, P.view(r.value)));
};
// Règle Zado : les prix d'achat (fournisseur ou Zado) ne sont visibles que par l'administrateur.
// L'employé Catalogue voit les bons (articles, quantités, dates) et enregistre les réceptions, sans aucun montant.
const isAdmin = (req) => req.user.role === 'admin';
function forRole(req, v) {
  if (isAdmin(req)) return v;
  const { total, receivedTotal, paid, owed, due, invoice, ...rest } = v;
  return { ...rest, lines: v.lines.map(({ unitPrice, ...l }) => l), pricesHidden: true };
}
const find = (req, res) => {
  const bc = store.get(req.params.id) || store.find((x) => x.number === String(req.params.id).toUpperCase());
  if (!bc) { res.status(404).json({ error: 'Bon de commande introuvable' }); return null; }
  return bc;
};

// ---------- Espace fournisseur : ses bons (ses prix, mais jamais ce que Zado a payé ni la facture) ----------
const supplierView = (b) => { const { paid, owed, due, invoice, ...v } = P.view(b); return v; };
router.get('/mine', requireRole('supplier'), (req, res) => {
  const list = store.all().filter((b) => b.supplier.supplierId === req.user.id && b.status !== 'draft').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ purchases: list.map(supplierView), statuses: P.STATUS });
});
router.post('/mine/:id/confirm', requireRole('supplier'), (req, res) => {
  const bc = find(req, res); if (!bc) return;
  if (bc.supplier.supplierId !== req.user.id) return res.status(404).json({ error: 'Bon de commande introuvable' });
  if (bc.status !== 'sent') return res.status(400).json({ error: bc.status === 'confirmed' ? 'Déjà confirmé' : 'Ce bon ne peut plus être confirmé' });
  const r = P.setStatus(bc, 'confirmed', actor(req), String(req.body?.note || '').slice(0, 300));
  if (r.error) return res.status(400).json({ error: r.error });
  if (req.body?.expectedAt) P.update(r.value, { expectedAt: req.body.expectedAt }, actor(req));
  log(req, 'Bon de commande confirmé par le fournisseur', { id: bc.id, name: bc.number });
  res.json(supplierView(store.get(bc.id)));
});

// ---------- Zado : bons de commande ----------
router.get('/', requireRole('catalog'), (req, res) => {
  const list = store.all().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((b) => forRole(req, P.view(b)));
  res.json({
    purchases: list, statuses: P.STATUS, canEdit: isAdmin(req),
    suppliers: isAdmin(req) ? staff.all().filter((u) => u.role === 'supplier' && u.active !== false).map((u) => ({ id: u.id, name: u.company || u.name, phone: u.phone || '' })) : [],
    products: isAdmin(req) ? products.all().filter((p) => !p.pending).map((p) => ({ id: p.id, name: p.name, stock: p.stock, costPrice: p.costPrice ?? null, supplierPrice: p.supplierPrice ?? null, supplierId: p.supplierId || null, lastPurchasePrice: p.lastPurchasePrice ?? null, image: p.image || null })) : [],
  });
});
router.post('/', requireRole(), (req, res) => {
  const r = P.create(req.body || {}, actor(req));
  if (r.error) return res.status(400).json({ error: r.error });
  log(req, 'Bon de commande créé', { id: r.value.id, name: r.value.number }, `${r.value.supplier.name} · ${P.total(r.value.lines)} FCFA`);
  res.status(201).json(forRole(req, P.view(r.value)));
});
router.get('/:id', requireRole('catalog'), (req, res) => { const bc = find(req, res); if (bc) res.json(forRole(req, P.view(bc))); });
router.patch('/:id', requireRole(), (req, res) => { const bc = find(req, res); if (bc) reply(req, res, P.update(bc, req.body || {}, actor(req)), 'Bon de commande modifié', bc); });
router.post('/:id/status', requireRole(), (req, res) => {
  const bc = find(req, res); if (!bc) return;
  const status = req.body?.status;
  reply(req, res, P.setStatus(bc, status, actor(req), String(req.body?.note || '').slice(0, 300)), `Bon de commande : ${P.STATUS[status] || status}`, bc);
});
router.post('/:id/receive', requireRole('catalog'), (req, res) => {
  const bc = find(req, res); if (!bc) return;
  const r = P.receive(bc, req.body || {}, actor(req));
  if (r.error) return res.status(400).json({ error: r.error });
  const last = r.value.receipts[r.value.receipts.length - 1];
  log(req, 'Réception fournisseur', { id: bc.id, name: bc.number }, last.lines.map((l) => `${l.qty} × ${l.name}`).join(', '));
  res.json(forRole(req, P.view(r.value)));
});
router.put('/:id/invoice', requireRole(), (req, res) => { const bc = find(req, res); if (bc) reply(req, res, P.setInvoice(bc, req.body?.remove ? null : req.body || {}, actor(req)), 'Facture fournisseur', bc); });
router.get('/:id/print', requireRole(), (req, res) => {
  const bc = find(req, res); if (!bc) return;
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.type('html').send(P.render(bc, billing.company()));
});

module.exports = router;

// ---------- Stock : mouvements, inventaire ----------
const stockRouter = require('express').Router();
stockRouter.get('/moves', requireRole('catalog'), (req, res) => {
  res.json({ moves: stock.moves({ productId: req.query.product || null, limit: Math.min(2000, Number(req.query.limit) || 500) }), reasons: stock.REASONS });
});
stockRouter.get('/overview', requireRole('catalog'), (req, res) => {
  const list = products.all().filter((p) => !p.pending).map((p) => ({
    id: p.id, name: p.name, category: p.category, image: p.image || null, stock: p.stock, supplierId: p.supplierId || null,
    cost: Number.isInteger(p.supplierId ? p.supplierPrice : p.costPrice) ? (p.supplierId ? p.supplierPrice : p.costPrice) : null,
    value: p.stock != null && Number.isInteger(p.supplierId ? p.supplierPrice : p.costPrice) ? p.stock * (p.supplierId ? p.supplierPrice : p.costPrice) : 0,
    active: p.active !== false,
    onOrder: store.all().filter((b) => P.OPEN.includes(b.status) && b.status !== 'draft').reduce((n, b) => n + (b.lines.find((l) => l.productId === p.id) || { qty: 0, received: 0 }).qty - (b.lines.find((l) => l.productId === p.id)?.received || 0), 0),
  }));
  const admin = req.user.role === 'admin';
  res.json({
    products: admin ? list : list.map(({ cost, value, ...p }) => p), pricesHidden: !admin,
    totalValue: admin ? list.reduce((s, p) => s + p.value, 0) : null,
    noCost: admin ? list.filter((p) => p.active && !p.supplierId && p.cost == null).length : null,
    low: list.filter((p) => p.active && p.stock != null && p.stock <= 3).length,
  });
});
stockRouter.post('/count', requireRole('catalog'), (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length || items.length > 500) return res.status(400).json({ error: 'Indiquez les quantités comptées' });
  const out = [];
  for (const it of items) {
    const p = products.get(it.productId);
    const n = Number(it.counted);
    if (!p || !Number.isInteger(n) || n < 0 || n > 100000) return res.status(400).json({ error: `Quantité invalide (${p ? p.name : it.productId})` });
    const before = p.stock == null ? 0 : p.stock;
    if (n !== before || p.stock == null) { stock.countStock(p.id, n, actor(req), String(req.body.note || '').slice(0, 200)); out.push({ id: p.id, name: p.name, before, after: n }); }
  }
  log(req, 'Inventaire', null, out.length ? out.map((x) => `${x.name} : ${x.before} → ${x.after}`).join(' ; ') : 'aucun écart');
  res.json({ changed: out });
});
module.exports.stockRouter = stockRouter;
