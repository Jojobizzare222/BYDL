// Messagerie — côté boutique (/api/chat) : la bulle « Aide ».
// Client connecté : sa conversation est liée à son compte. Visiteur : à une clé secrète gardée par son navigateur
// (en-tête X-Chat-Token), jamais dans l'adresse. Limites : 2 000 caractères par message, 20 messages par minute.
const crypto = require('crypto');
const router = require('express').Router();
const { conversations } = require('../store');
const { currentCustomer, publicCustomer } = require('../customer/auth');
const { normalizeLocal } = require('../utils/phone');
const chat = require('../chat');
const { notifyChat } = require('../notify');

const rate = new Map(); // clé -> dates des derniers messages
function tooFast(key, max = 20) {
  const now = Date.now();
  const list = (rate.get(key) || []).filter((t) => now - t < 60000);
  list.push(now); rate.set(key, list);
  return list.length > max;
}

// Conversation en cours du client (ou du visiteur)
function findConv(req) {
  const customer = currentCustomer(req);
  const token = String(req.get('X-Chat-Token') || '');
  const mine = conversations.all().filter((c) => c.kind === 'support' && c.status !== 'closed'
    && ((customer && c.customerId === customer.id) || (/^[a-f0-9]{32}$/.test(token) && c.guestHash === chat.sha256(token))));
  return { customer, token, conv: mine.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))[0] || null };
}
// Ce que voit le client : jamais les notes internes, prénom seulement pour l'équipe
const publicMessage = ({ id, at, from, text, quick, links, staffName }) => ({ id, at, from, text, quick, links, staffName: from === 'staff' ? String(staffName || 'Zado').split(' ')[0] : undefined });
const publicConv = (c) => (c ? { id: c.id, status: c.status, unread: c.unreadCustomer || 0, messages: (c.messages || []).filter((m) => !m.internal).map(publicMessage) } : null);

router.get('/', (req, res) => {
  const { conv } = findConv(req);
  res.set('Cache-Control', 'no-store');
  res.json({ conversation: publicConv(conv), welcome: chat.WELCOME });
});

router.post('/messages', (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Message vide' });
  let { customer, token, conv } = findConv(req);
  if (tooFast(conv?.id || req.ip)) return res.status(429).json({ error: 'Trop de messages, patientez une minute.' });
  let newToken = null;
  if (!conv) {
    if (!customer && tooFast('new:' + req.ip, 5)) return res.status(429).json({ error: 'Trop de conversations ouvertes, réessayez plus tard.' });
    if (!customer && !/^[a-f0-9]{32}$/.test(token)) { newToken = crypto.randomBytes(16).toString('hex'); token = newToken; }
    conv = conversations.insert({
      id: chat.newId('CONV'), kind: 'support', status: 'bot', customerId: customer?.id || null, guestHash: customer ? null : chat.sha256(token),
      name: customer?.name || null, phone: customer?.phone || null, messages: [], unreadStaff: 0, unreadCustomer: 0, createdAt: new Date().toISOString(),
    });
  }
  conv = chat.addMessage(conv, { from: 'customer', text }).conv;
  // Assistant automatique tant qu'aucun conseiller n'a pris la conversation
  if (conv.status === 'bot') {
    const a = chat.botAnswer(text, { customer, conv });
    if (a.handoff) return res.status(201).json({ needContact: !customer && !conv.phone, conversation: publicConv(handoff(conversations.get(conv.id), customer)), token: newToken });
    conv = chat.addMessage(conversations.get(conv.id), { from: 'bot', text: a.text, quick: a.quick, links: a.links }).conv;
  }
  res.status(201).json({ conversation: publicConv(conv), token: newToken });
});

// Passage à un conseiller : la conversation arrive dans Zado Pro (Messagerie) + alerte
function handoff(conv, customer) {
  if (conv.status === 'open') return conv;
  conv = conversations.update(conv.id, { status: 'open', handoffAt: new Date().toISOString(), unreadStaff: Math.max(1, conv.unreadStaff || 0) });
  const who = customer || conv.phone ? '' : " Indiquez votre nom et votre numéro ci-dessous pour qu'il puisse vous recontacter.";
  conv = chat.addMessage(conv, { from: 'bot', text: `C'est noté : un conseiller Zado vous répond ici dès que possible (du lundi au samedi, en journée).${who}` }).conv;
  notifyChat(conv);
  return conv;
}
router.post('/human', (req, res) => {
  const { customer, conv } = findConv(req);
  if (!conv) return res.status(404).json({ error: 'Écrivez d\'abord votre question' });
  if (!customer) {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const phone = normalizeLocal(req.body?.phone);
    if (name || req.body?.phone) {
      if (!name) return res.status(400).json({ error: 'Votre nom, s\'il vous plaît' });
      if (!phone) return res.status(400).json({ error: 'Numéro invalide (ex. 06 123 45 67)' });
      conversations.update(conv.id, { name, phone });
    }
  }
  res.json({ conversation: publicConv(handoff(conversations.get(conv.id), customer)) });
});

router.post('/read', (req, res) => {
  const { conv } = findConv(req);
  if (conv) conversations.update(conv.id, { unreadCustomer: 0 });
  res.json({ ok: true });
});

module.exports = router;
module.exports.publicMessage = publicMessage;
