// Messagerie — côté Kamwa Pro (/api/admin/chat)
//  - conversations des clients : admin + employés Commandes (service client) ;
//  - salon « Équipe Kamwa » : toute l'équipe interne (admin, catalogue, commandes, livreurs), pas les fournisseurs.
const router = require('express').Router();
const { conversations, customers, orders } = require('../store');
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
  else if (c.customerId) require('../push').notifyCustomer(c.customerId, `Kamwa : réponse de ${staffName(req.user).split(' ')[0]}`, text.slice(0, 140), '/?aide=1#/', 'kamwa-chat');
  res.status(201).json(r.message);
});

router.post('/conversations/:id/close', SUPPORT, (req, res) => {
  const c = conversations.get(req.params.id);
  if (!c || c.kind !== 'support') return res.status(404).json({ error: 'Conversation introuvable' });
  chat.addMessage(c, { from: 'bot', text: 'Conversation terminée. Merci d\'avoir contacté Kamwa ! Écrivez à nouveau à tout moment.' });
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

module.exports = router;
