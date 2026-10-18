// Messagerie — côté Zado Pro (/api/admin/chat)
//  - conversations des clients : admin + employés Commandes (service client) ;
//  - fils « Fournisseur ↔ Zado » (audit 17/10/2026) : un fil par fournisseur, lu par l'admin et les employés
//    Commandes / Catalogue ; le fournisseur ne voit que le sien (jamais les clients ni le salon de l'équipe) ;
//  - salon « Équipe Zado » : toute l'équipe interne (admin, catalogue, commandes, livreurs), pas les fournisseurs.
const router = require('express').Router();
const { conversations, customers, orders, staff } = require('../store');
const { requireRole } = require('../admin/auth');
const chat = require('../chat');

const SUPPORT = requireRole('orders');
const TEAM = requireRole('orders', 'catalog', 'courier');
const canSupport = (u) => ['admin', 'orders'].includes(u.role);
const staffName = (u) => u.name || (u.role === 'admin' ? 'Administrateur' : u.login);

// Résumé d'une conversation pour la liste
function summary(c) {
  const acc = c.customerId && customers.get(c.customerId);
  return {
    id: c.id, status: c.status, name: acc?.name || c.name || 'Visiteur', phone: acc?.phone || c.phone || null, customerId: c.customerId || null,
    idStatus: acc ? (acc.idStatus || 'missing') : null, lastAt: c.lastAt, lastText: c.lastText, lastFrom: c.lastFrom,
    unread: c.unreadStaff || 0, assignedTo: c.assignedTo || null, handoffAt: c.handoffAt || null, createdAt: c.createdAt,
  };
}

// Compteurs pour les pastilles du menu (et la sonnerie)
router.get('/unread', (req, res) => {
  const out = { support: 0, waiting: 0, team: 0 };
  if (canSupport(req.user)) {
    const list = conversations.all().filter((c) => c.kind === 'support' && c.status === 'open');
    out.support = list.filter((c) => c.unreadStaff > 0).length;
    out.waiting = list.filter((c) => c.lastFrom === 'customer' || (c.lastFrom === 'bot' && c.unreadStaff > 0)).length;
  }
  if (['admin', 'orders', 'catalog'].includes(req.user.role)) out.suppliers = conversations.all().filter((c) => c.kind === 'supplier' && c.unreadStaff > 0).length;
  if (req.user.role === 'supplier') {
    const c = conversations.get(chat.supplierConvId(req.user.id));
    const seen = c?.reads?.[req.user.id] || '';
    out.kamwa = (c?.messages || []).filter((m) => m.at > seen && m.from !== 'supplier').length;
  }
  if (req.user.role !== 'supplier') {
    const t = conversations.get(chat.TEAM_ID);
    const seen = t?.reads?.[req.user.id] || '';
    out.team = (t?.messages || []).filter((m) => m.at > seen && m.userId !== req.user.id).length;
  }
  res.json(out);
});

router.get('/conversations', SUPPORT, (req, res) => {
  const list = conversations.all().filter((c) => c.kind === 'support').map(summary).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  res.json(list);
});

router.get('/conversations/:id', SUPPORT, (req, res) => {
  const c = conversations.get(req.params.id);
  if (!c || c.kind !== 'support') return res.status(404).json({ error: 'Conversation introuvable' });
  const read = conversations.update(c.id, { unreadStaff: 0 });
  const acc = c.customerId && customers.get(c.customerId);
  const recent = acc ? orders.all().filter((o) => o.customerId === acc.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5).map((o) => ({ id: o.id, status: o.status, total: o.total, createdAt: o.createdAt })) : [];
  res.json({ ...summary(read), messages: read.messages || [], orders: recent });
});

router.post('/conversations/:id/messages', SUPPORT, (req, res) => {
  const c = conversations.get(req.params.id);
  if (!c || c.kind !== 'support') return res.status(404).json({ error: 'Conversation introuvable' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message vide' });
  const internal = Boolean(req.body?.internal); // note interne : jamais montrée au client
  conversations.update(c.id, { status: 'open', assignedTo: c.assignedTo || staffName(req.user) });
  const r = chat.addMessage(conversations.get(c.id), { from: 'staff', staffName: staffName(req.user), userId: req.user.id, text, internal });
  if (internal) conversations.update(c.id, { unreadCustomer: Math.max(0, (r.conv.unreadCustomer || 1) - 1) });
  else if (c.customerId) require('../push').notifyCustomer(c.customerId, `Zado : réponse de ${staffName(req.user).split(' ')[0]}`, text.slice(0, 140), '/?aide=1#/', 'kamwa-chat');
  res.status(201).json(r.message);
});

router.post('/conversations/:id/close', SUPPORT, (req, res) => {
  const c = conversations.get(req.params.id);
  if (!c || c.kind !== 'support') return res.status(404).json({ error: 'Conversation introuvable' });
  chat.addMessage(c, { from: 'bot', text: 'Conversation terminée. Merci d\'avoir contacté Zado ! Écrivez à nouveau à tout moment.' });
  res.json(summary(conversations.update(c.id, { status: 'closed', closedAt: new Date().toISOString(), unreadStaff: 0 })));
});

// ---------- Salon de l'équipe ----------
router.get('/team', TEAM, (req, res) => {
  const t = chat.teamConversation();
  conversations.update(t.id, { reads: { ...(t.reads || {}), [req.user.id]: new Date().toISOString() } });
  res.json({ id: t.id, title: t.title, messages: (t.messages || []).slice(-200), me: req.user.id });
});
router.post('/team', TEAM, (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message vide' });
  const t = chat.teamConversation();
  const r = chat.addMessage(t, { from: 'staff', staffName: staffName(req.user), userId: req.user.id, role: req.user.role, text });
  conversations.update(t.id, { unreadStaff: 0, reads: { ...(r.conv.reads || {}), [req.user.id]: r.message.at } });
  res.status(201).json(r.message);
});

// ---------- Fournisseurs ↔ Zado ----------
const SUPPLIER_DESK = requireRole('orders', 'catalog');
const onlySupplier = (req, res, next) => (req.user.role === 'supplier' ? next() : res.status(403).json({ error: 'Réservé aux fournisseurs' }));
const supplierSummary = (u, c) => ({
  supplierId: u.id, name: u.company || u.name, contact: u.name, phone: u.phone || null, active: u.active !== false,
  lastAt: c?.lastAt || null, lastText: c?.lastText || '', lastFrom: c?.lastFrom || null, unread: c?.unreadStaff || 0,
});

// Le fournisseur : son fil avec Zado
router.get('/kamwa', onlySupplier, (req, res) => {
  const c = chat.supplierThread(req.user);
  conversations.update(c.id, { reads: { ...(c.reads || {}), [req.user.id]: new Date().toISOString() } });
  res.json({ id: c.id, messages: (c.messages || []).filter((m) => !m.internal).slice(-200), me: req.user.id });
});
router.post('/kamwa', onlySupplier, (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message vide' });
  const c = chat.supplierThread(req.user);
  const r = chat.addMessage(c, { from: 'supplier', staffName: req.user.company || req.user.name, userId: req.user.id, text });
  conversations.update(c.id, { unreadStaff: (c.unreadStaff || 0) + 1, reads: { ...(r.conv.reads || {}), [req.user.id]: r.message.at } });
  res.status(201).json(r.message);
});

// L'équipe Zado : liste des fournisseurs et leurs fils
router.get('/suppliers', SUPPLIER_DESK, (req, res) => {
  const list = staff.all().filter((u) => u.role === 'supplier').map((u) => supplierSummary(u, conversations.get(chat.supplierConvId(u.id))));
  res.json(list.sort((a, b) => (b.unread - a.unread) || String(b.lastAt || '').localeCompare(String(a.lastAt || '')) || a.name.localeCompare(b.name)));
});
router.get('/suppliers/:sid', SUPPLIER_DESK, (req, res) => {
  const u = staff.get(req.params.sid);
  if (!u || u.role !== 'supplier') return res.status(404).json({ error: 'Fournisseur introuvable' });
  const c = chat.supplierThread(u);
  const read = conversations.update(c.id, { unreadStaff: 0 });
  res.json({ ...supplierSummary(u, read), messages: (read.messages || []).slice(-200), me: req.user.id });
});
router.post('/suppliers/:sid/messages', SUPPLIER_DESK, (req, res) => {
  const u = staff.get(req.params.sid);
  if (!u || u.role !== 'supplier') return res.status(404).json({ error: 'Fournisseur introuvable' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message vide' });
  const r = chat.addMessage(chat.supplierThread(u), { from: 'staff', staffName: staffName(req.user), userId: req.user.id, text });
  conversations.update(r.conv.id, { unreadStaff: 0 });
  res.status(201).json(r.message);
});

module.exports = router;
