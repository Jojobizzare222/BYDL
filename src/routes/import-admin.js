// Achat en France — partie Kamwa Pro (/api/admin/france) :
//  - équipe (admin, employé Commandes) : demandes de devis, chiffrage, refus, arrivée des envois au Congo ;
//  - AGENT FRANCE (rôle « agent ») : commandes payées à acheter, achat (prix payé + facture), réception (photos),
//    envois groupés vers le Congo. L'agent ne voit jamais le téléphone ni l'adresse du client (seulement prénom et ville).
// Les dépenses réelles (achats, transport, douane) sont inscrites automatiquement dans Finances.
const crypto = require('crypto');
const express = require('express');
const { imports, orders, shipments, staff, ledger, activity } = require('../store');
const { requireRole } = require('../admin/auth');
const imp = require('../imports');

const router = express.Router();
const IMG = /^\/images\/uploads\/[\w.-]+\.(jpg|png|webp)$/;

function log(req, action, target, details = '') {
  activity.insert({
    id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(),
    userId: req.user.id, userName: req.user.name + (req.user.company ? ` (${req.user.company})` : ''), role: req.user.role,
    action, targetId: target?.id || null, targetName: target?.name || target?.id || null, details,
  });
}
function expense(req, { category, amount, method, label, note = '', ref }) {
  if (!(amount > 0)) return null;
  return ledger.insert({
    id: 'FIN-' + crypto.randomBytes(5).toString('hex').toUpperCase(), type: 'expense', category, amount: Math.round(amount),
    date: new Date().toISOString().slice(0, 10), method, label, note, toMethod: null, supplierId: null, receipt: null, ref: ref || null,
    createdBy: req.user.id, createdAt: new Date().toISOString(),
  });
}

// ---------- Réglages et calcul ----------
router.get('/settings', requireRole('orders', 'agent'), (req, res) => res.json({ ...imp.importSettings(), rate: imp.EUR, stages: imp.STAGES }));
router.put('/settings', requireRole(), (req, res) => {
  const { error, value } = imp.saveImportSettings(req.body || {});
  if (error) return res.status(400).json({ error });
  log(req, 'Réglages Achat en France modifiés', null, `transport ${value.freightPerKg} FCFA/kg, douane ${value.customsPercent} %, commission ${value.commissionPercent} % + ${value.fixedFee} FCFA`);
  res.json(value);
});

// ---------- Demandes de devis (équipe) ----------
const teamRequest = (r) => ({ ...r, accessToken: undefined, status: imp.statusOf(r), order: r.orderId ? (({ id, status, total, import: i }) => ({ id, status, total, stage: i?.stage }))(orders.get(r.orderId) || {}) : null });
router.get('/requests', requireRole('orders'), (req, res) => {
  res.json(imports.all().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(teamRequest));
});
router.get('/requests/:id', requireRole('orders'), (req, res) => {
  const r = imports.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Demande introuvable' });
  res.json({ ...teamRequest(r), shareToken: r.accessToken }); // pour le lien WhatsApp envoyé au client
});
router.post('/requests/:id/quote', requireRole('orders'), (req, res) => {
  const r = imports.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Demande introuvable' });
  if (!['requested', 'quoted'].includes(r.status)) return res.status(400).json({ error: 'Cette demande ne peut plus être chiffrée' });
  const { items, weightKg, total, message } = req.body || {};
  if (!Array.isArray(items) || items.length !== r.items.length) return res.status(400).json({ error: 'Chiffrez chaque article' });
  const clean = [];
  for (const [i, it] of items.entries()) {
    const priceEur = Number(String(it.priceEur ?? '').replace(',', '.'));
    const shippingEur = Number(String(it.shippingEur || 0).replace(',', '.'));
    const qty = Math.floor(Number(it.qty) || r.items[i].qty);
    if (!(priceEur > 0 && priceEur < 100000) || !(shippingEur >= 0 && shippingEur < 10000) || !(qty >= 1 && qty <= 20)) return res.status(400).json({ error: `Prix invalide pour l'article ${i + 1}` });
    clean.push({ title: String(it.title || r.items[i].title || `Article ${i + 1}`).trim().slice(0, 140), priceEur, shippingEur, qty, options: r.items[i].options || '', url: r.items[i].url });
  }
  const w = Number(String(weightKg ?? '').replace(',', '.'));
  if (!(w > 0 && w <= 500)) return res.status(400).json({ error: 'Poids estimé invalide (en kg)' });
  const s = imp.importSettings();
  const breakdown = imp.computeQuote(clean, w, s);
  let finalTotal = breakdown.total;
  if (total !== undefined && total !== '' && total !== null) {
    finalTotal = Number(total);
    if (!Number.isInteger(finalTotal) || finalTotal < breakdown.cost) return res.status(400).json({ error: `Prix final invalide (au moins le coût : ${breakdown.cost} FCFA)` });
  }
  const now = new Date();
  const quote = {
    items: clean, weightKg: w, breakdown: { ...breakdown, commission: finalTotal - breakdown.cost, total: finalTotal }, total: finalTotal,
    message: String(message || '').trim().slice(0, 500), delay: s.delay,
    validUntil: new Date(now.getTime() + s.validityHours * 3600e3).toISOString(), by: req.user.name, at: now.toISOString(),
  };
  const updated = imports.update(r.id, { status: 'quoted', quote, history: [...(r.history || []), { status: 'quoted', at: now.toISOString() }] });
  log(req, 'Devis Achat en France envoyé', { id: r.id }, `${finalTotal} FCFA (marge ${finalTotal - breakdown.cost} FCFA)`);
  res.json({ ...teamRequest(updated), shareToken: updated.accessToken });
});
router.post('/requests/:id/decline', requireRole('orders'), (req, res) => {
  const r = imports.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Demande introuvable' });
  if (!['requested', 'quoted'].includes(r.status)) return res.status(400).json({ error: 'Cette demande ne peut plus être refusée' });
  const reason = String(req.body?.reason || '').trim().slice(0, 300) || "Nous ne pouvons pas faire venir cet article.";
  const updated = imports.update(r.id, { status: 'declined', declineReason: reason, history: [...(r.history || []), { status: 'declined', at: new Date().toISOString() }] });
  log(req, 'Demande Achat en France refusée', { id: r.id }, reason);
  res.json(teamRequest(updated));
});

// ---------- Commandes payées à traiter (équipe + agent) ----------
const agentView = (o, full) => ({
  id: o.id, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt || null, total: full ? o.total : undefined,
  customer: full ? o.customer : { name: (o.customer?.name || '').split(' ')[0], city: o.customer?.city },
  import: o.import,
});
const paidImports = () => orders.all().filter((o) => o.import && o.paidAt && o.status !== 'cancelled');
router.get('/orders', requireRole('orders', 'agent'), (req, res) => {
  const full = req.user.role !== 'agent';
  res.json(paidImports().sort((a, b) => (a.paidAt < b.paidAt ? -1 : 1)).map((o) => agentView(o, full)));
});
function stage(req, res, from) {
  const o = orders.get(req.params.id);
  if (!o || !o.import || !o.paidAt || o.status === 'cancelled') { res.status(404).json({ error: 'Commande introuvable' }); return null; }
  if (!from.includes(o.import.stage)) { res.status(400).json({ error: `Étape actuelle : ${imp.STAGES[o.import.stage]}` }); return null; }
  return o;
}
// L'agent a acheté les articles : prix réellement payé (en €), référence, photo de la facture
router.post('/orders/:id/bought', requireRole('agent'), (req, res) => {
  const o = stage(req, res, ['to_buy']); if (!o) return;
  const eur = Number(String(req.body?.eur ?? '').replace(',', '.'));
  if (!(eur > 0 && eur < 100000)) return res.status(400).json({ error: 'Indiquez le montant payé en euros' });
  const receipt = IMG.test(String(req.body?.receipt || '')) ? req.body.receipt : null;
  const now = new Date().toISOString();
  const fin = expense(req, { category: 'import_purchase', amount: eur * imp.EUR, method: 'agent', label: `Achat en France ${o.id}`, note: `${eur} € payés par ${req.user.name}${req.body?.ref ? ' — réf. ' + String(req.body.ref).slice(0, 80) : ''}`, ref: o.id });
  orders.update(o.id, { import: { ...o.import, stage: 'bought', bought: { eur, ref: String(req.body?.ref || '').slice(0, 80), receipt, at: now, by: req.user.name, ledgerId: fin?.id || null } } });
  log(req, 'Achat en France effectué', { id: o.id }, `${eur} €`);
  res.json({ ok: true });
});
// Colis reçu chez l'agent : photos du produit (rassurent le client)
router.post('/orders/:id/received', requireRole('agent'), (req, res) => {
  const o = stage(req, res, ['bought']); if (!o) return;
  const photos = (Array.isArray(req.body?.photos) ? req.body.photos : []).filter((p) => IMG.test(String(p))).slice(0, 6);
  if (!photos.length) return res.status(400).json({ error: 'Ajoutez au moins une photo du produit reçu' });
  orders.update(o.id, { import: { ...o.import, stage: 'received', received: { photos, at: new Date().toISOString(), by: req.user.name, note: String(req.body?.note || '').slice(0, 300) } } });
  log(req, 'Article reçu par l\'agent France', { id: o.id }, `${photos.length} photo(s)`);
  res.json({ ok: true });
});

// ---------- Envois groupés France → Congo ----------
const shipmentView = (s) => ({ ...s, orders: s.orderIds.map((id) => { const o = orders.get(id); return o ? { id, name: (o.customer?.name || '').split(' ')[0], city: o.customer?.city, items: (o.import?.items || []).map((it) => `${it.qty} × ${it.title}`) } : { id }; }) });
router.get('/shipments', requireRole('orders', 'agent'), (req, res) => {
  res.json(shipments.all().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(shipmentView));
});
router.post('/shipments', requireRole('agent'), (req, res) => {
  const { carrier, mode, tracking, eta, weightKg, costEur, orderIds } = req.body || {};
  const ids = [...new Set(Array.isArray(orderIds) ? orderIds : [])];
  if (!ids.length) return res.status(400).json({ error: 'Choisissez les colis à envoyer' });
  for (const id of ids) {
    const o = orders.get(id);
    if (!o?.import || o.import.stage !== 'received' || o.import.shipmentId) return res.status(400).json({ error: `${id} n'est pas prêt à partir (il doit être « reçu par l'agent »)` });
  }
  const w = Number(String(weightKg ?? '').replace(',', '.')); const c = Number(String(costEur ?? 0).replace(',', '.'));
  if (!(w > 0 && w <= 2000)) return res.status(400).json({ error: 'Poids total invalide (kg)' });
  if (!(c >= 0 && c < 100000)) return res.status(400).json({ error: 'Coût du transport invalide (€)' });
  const now = new Date().toISOString();
  const s = shipments.insert({
    id: 'ENV-' + now.slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(),
    carrier: String(carrier || '').trim().slice(0, 80), mode: mode === 'bateau' ? 'bateau' : 'avion', tracking: String(tracking || '').trim().slice(0, 80),
    eta: /^\d{4}-\d{2}-\d{2}$/.test(eta || '') ? eta : null, weightKg: w, costEur: c, orderIds: ids, status: 'preparing', createdAt: now, createdBy: req.user.name,
  });
  for (const id of ids) { const o = orders.get(id); orders.update(id, { import: { ...o.import, shipmentId: s.id } }); }
  log(req, 'Envoi France → Congo préparé', { id: s.id }, `${ids.length} colis, ${w} kg`);
  res.status(201).json(shipmentView(s));
});
// Départ : les clients voient « Parti de France » et la date d'arrivée prévue ; le transport est inscrit en dépense
router.post('/shipments/:sid/depart', requireRole('agent'), (req, res) => {
  const s = shipments.get(req.params.sid);
  if (!s || s.status !== 'preparing') return res.status(400).json({ error: 'Envoi introuvable ou déjà parti' });
  const now = new Date().toISOString();
  const fin = expense(req, { category: 'import_freight', amount: s.costEur * imp.EUR, method: 'agent', label: `Transport ${s.id}`, note: `${s.costEur} € — ${s.carrier || 'expéditeur'}, ${s.weightKg} kg`, ref: s.id });
  shipments.update(s.id, { status: 'departed', departedAt: now, ledgerId: fin?.id || null });
  for (const id of s.orderIds) { const o = orders.get(id); if (o?.import) orders.update(id, { import: { ...o.import, stage: 'shipped_fr', departedAt: now, eta: s.eta } }); }
  log(req, 'Envoi parti de France', { id: s.id }, `${s.orderIds.length} colis`);
  res.json(shipmentView(shipments.get(s.id)));
});
// Arrivée au Congo (équipe Kamwa) : les commandes deviennent « à livrer » ; douane éventuelle inscrite en dépense
router.post('/shipments/:sid/arrive', requireRole('orders'), (req, res) => {
  const s = shipments.get(req.params.sid);
  if (!s || s.status !== 'departed') return res.status(400).json({ error: "Envoi introuvable ou pas encore parti" });
  const customs = Number(req.body?.customs || 0);
  if (!(Number.isInteger(customs) && customs >= 0)) return res.status(400).json({ error: 'Montant de douane invalide (FCFA, entier)' });
  const method = ['cash', 'momo', 'bank'].includes(req.body?.method) ? req.body.method : 'cash';
  const now = new Date().toISOString();
  const fin = expense(req, { category: 'customs', amount: customs, method, label: `Douane ${s.id}`, ref: s.id });
  shipments.update(s.id, { status: 'arrived', arrivedAt: now, customs, customsLedgerId: fin?.id || null });
  for (const id of s.orderIds) { const o = orders.get(id); if (o?.import) orders.update(id, { import: { ...o.import, stage: 'arrived', arrivedAt: now } }); }
  log(req, 'Envoi arrivé au Congo', { id: s.id }, `${s.orderIds.length} colis${customs ? `, douane ${customs} FCFA` : ''}`);
  res.json(shipmentView(shipments.get(s.id)));
});

module.exports = router;
