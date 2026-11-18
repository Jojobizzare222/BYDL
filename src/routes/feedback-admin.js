// Zado Pro → Satisfaction (/api/admin/feedback) [admin, orders] : avis sur le service et sur l'application, chiffres
// (note moyenne, indice de recommandation, points forts / à améliorer, évolution), traitement (« Traité » + note interne), export Excel.
const crypto = require('crypto');
const router = require('express').Router();
const { feedback, orders, activity } = require('../store');
const { requireRole } = require('../admin/auth');
const fb = require('../feedback');

router.use(requireRole('orders'));
function log(req, action, target, details = '') {
  activity.insert({
    id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(),
    userId: req.user.id, userName: req.user.impersonatedBy ? `${req.user.name} (par l'administrateur)` : req.user.name, role: req.user.role,
    action, targetId: target?.id || null, targetName: target?.name || null, details,
  });
}
const row = (f) => {
  const o = f.orderId ? orders.get(f.orderId) : null;
  return { ...f, order: o ? { id: o.id, total: o.total, deliveredAt: o.deliveredAt || o.updatedAt, items: (o.lines || o.items || []).length } : null };
};

router.get('/', (req, res) => {
  const list = feedback.all().sort((a, b) => ((a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1));
  res.json({ list: list.map(row), stats: fb.stats(list), tags: fb.TAGS });
});

router.patch('/:id', (req, res) => {
  const f = feedback.get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Avis introuvable' });
  const patch = {};
  if (req.body?.status !== undefined) {
    if (!['new', 'done'].includes(req.body.status)) return res.status(400).json({ error: 'Statut invalide' });
    patch.status = req.body.status;
    patch.handledBy = req.body.status === 'done' ? req.user.name : null;
    patch.handledAt = req.body.status === 'done' ? new Date().toISOString() : null;
  }
  if (req.body?.note !== undefined) patch.note = String(req.body.note || '').replace(/[<>]/g, '').trim().slice(0, 1000);
  const doc = feedback.update(f.id, patch);
  log(req, patch.status === 'done' ? 'Avis traité' : patch.status === 'new' ? 'Avis remis à traiter' : 'Note sur un avis', { id: f.id, name: `${f.kind === 'service' ? 'Service' : 'Application'} ${f.rating}/5 · ${f.name}` }, patch.note ? 'note interne modifiée' : '');
  res.json(row(doc));
});

router.get('/export.csv', (req, res) => {
  const list = feedback.all().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const cell = (v) => { const t = v == null ? '' : String(v); return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['Date', 'Type', 'Note /5', 'Recommandation /10', 'Client', 'Téléphone', 'Commande', 'Points', 'Commentaire', 'Page', 'Téléphone mobile', 'Application installée', 'Statut', 'Traité par', 'Note interne'];
  const rows = list.map((f) => [String(f.createdAt).slice(0, 16).replace('T', ' '), f.kind === 'service' ? 'Service' : 'Application', f.rating, f.nps ?? '', f.name, f.phone || '', f.orderId || '', (f.tags || []).join(', '), f.text || '', f.route || '', f.device?.mobile ? 'oui' : 'non', f.device?.standalone ? 'oui' : 'non', f.status === 'done' ? 'Traité' : 'À traiter', f.handledBy || '', f.note || '']);
  log(req, 'Export des avis (satisfaction)', null, `${list.length} avis`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zado-avis-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n'));
});

module.exports = router;
