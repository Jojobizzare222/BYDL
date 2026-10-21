// Zado Pro → Factures & reçus (/api/admin/documents) [admin, orders] ; société sur les documents [admin].
// Les documents ne se modifient pas et ne se suppriment pas : seule la création (automatique, ou « Établir les documents ») existe.
const crypto = require('crypto');
const router = require('express').Router();
const { documents, orders, activity } = require('../store');
const { requireRole } = require('../admin/auth');
const billing = require('../billing');

function log(req, action, target, details = '') {
  activity.insert({
    id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(),
    userId: req.user.id, userName: req.user.impersonatedBy ? `${req.user.name} (par l'administrateur)` : req.user.name, role: req.user.role,
    action, targetId: target?.id || null, targetName: target?.name || null, details,
  });
}

// Résumé pour les listes (avec le lien de partage, pour l'envoyer au client par WhatsApp)
const summary = (d) => ({
  id: d.id, type: d.type, label: billing.TYPES[d.type].label, number: d.number, issuedAt: d.issuedAt,
  orderId: d.orderId, customer: { name: d.customer?.name || '', phone: d.customer?.phone || '' },
  amount: d.type === 'receipt' ? d.amount : d.total, method: d.method || null, methodLabel: d.methodLabel || d.paymentLabel || null,
  purpose: d.purpose || null, collectedBy: d.collectedBy || null, invoiceNumber: d.invoiceNumber || null,
  agency: d.agency?.name || null, link: `/api/documents/${d.id}?k=${d.token}`,
});
router.get('/', requireRole('orders'), (req, res) => {
  const list = documents.all().sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : a.number < b.number ? 1 : -1));
  res.json({ documents: list.map(summary), companyMissing: billing.missingCompany() });
});

router.get('/company', requireRole(), (req, res) => res.json({ company: billing.company(), missing: billing.missingCompany() }));
router.put('/company', requireRole(), (req, res) => {
  const r = billing.saveCompany(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  log(req, 'Informations de la société modifiées (factures)', null, r.company.name);
  res.json({ company: r.company, missing: billing.missingCompany(r.company) });
});

router.get('/export.csv', requireRole('orders'), (req, res) => {
  const list = documents.all().sort((a, b) => (a.issuedAt < b.issuedAt ? -1 : 1));
  const cell = (v) => { const t = v == null ? '' : String(v); return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const rows = [['Numéro', 'Type', 'Date', 'Commande', 'Client', 'Téléphone', 'Montant (FCFA)', 'Mode / paiement', 'Facture liée', 'Encaissé par', 'Point relais']]
    .concat(list.map((d) => [d.number, billing.TYPES[d.type].label, d.issuedAt.slice(0, 16).replace('T', ' '), d.orderId, d.customer?.name, d.customer?.phone,
      d.type === 'credit' ? -d.total : d.type === 'receipt' ? d.amount : d.total, d.methodLabel || d.paymentLabel || '', d.invoiceNumber || '', d.collectedBy || '', d.agency?.name || '']));
  log(req, 'Export des factures et reçus', null, `${list.length} documents`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zado-factures-recus-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n'));
});

router.get('/:id/print', requireRole('orders'), (req, res) => {
  const d = documents.get(req.params.id);
  if (!d) return res.status(404).type('text').send('Document introuvable');
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.type('html').send(billing.render(d, { format: req.query.format === 'ticket' ? 'ticket' : 'a4', admin: true }));
});

// Établir maintenant les documents qui manquent pour une commande (ex. commande d'avant la mise en place)
router.post('/order/:orderId', requireRole('orders'), (req, res) => {
  const o = orders.get(req.params.orderId);
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  const before = billing.forOrder(o.id).length;
  const list = billing.sync(o);
  if (list.length > before) log(req, 'Documents établis', { id: o.id, name: o.id }, list.slice(before).map((d) => d.number).join(', '));
  res.json({ documents: list.map(summary) });
});

module.exports = router;
module.exports.summary = summary;
