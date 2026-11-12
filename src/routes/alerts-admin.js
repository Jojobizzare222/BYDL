// Zado Pro → Notifications [admin] : choisir qui reçoit les alertes e-mail et lesquelles, voir l'historique,
// envoyer un e-mail de test ou le résumé du matin tout de suite. Le moteur est dans src/alerts.js.
const express = require('express');
const crypto = require('crypto');
const alerts = require('../alerts');
const { alerts: col, activity } = require('../store');

const router = express.Router();
const log = (req, action, details = '') => activity.insert({ id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), userId: req.user.id, userName: req.user.name, role: req.user.role, action, targetId: null, targetName: 'Notifications', details });

router.get('/', (req, res) => {
  const type = String(req.query.type || '');
  const cat = String(req.query.cat || '');
  let list = col.all().sort((a, b) => (a.at < b.at ? 1 : -1));
  if (type) list = list.filter((a) => a.type === type);
  if (cat) list = list.filter((a) => alerts.TYPES[a.type]?.cat === cat);
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  res.json({
    settings: alerts.getSettings(),
    types: Object.entries(alerts.TYPES).map(([key, t]) => ({ key, ...t })),
    categories: alerts.CATEGORIES,
    smtp: alerts.smtpInfo(),
    last24h: col.all().filter((a) => a.at >= since).length,
    history: list.slice(0, 300),
  });
});

router.put('/settings', (req, res) => {
  const r = alerts.saveSettings(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  log(req, 'Réglages des notifications modifiés', `destinataires : ${r.value.to.join(', ') || 'aucun'}`);
  res.json(r.value);
});

router.post('/test', async (req, res) => {
  if (!alerts.smtpInfo().configured) return res.status(400).json({ error: "L'envoi d'e-mails n'est pas encore réglé sur le serveur (voir l'encadré « Envoi des e-mails »)." });
  if (!alerts.getSettings().to.length) return res.status(400).json({ error: 'Ajoutez au moins une adresse qui reçoit les alertes.' });
  const r = await alerts.sendTest();
  log(req, 'E-mail de test des notifications', r.ok ? 'envoyé' : r.reason);
  if (!r.ok) return res.status(502).json({ error: r.reason });
  res.json({ ok: true });
});

router.post('/digest', async (req, res) => {
  const r = await alerts.sendDigest({ force: true });
  log(req, 'Résumé du matin envoyé à la main', r.ok ? 'envoyé' : r.reason);
  res.json(r);
});

module.exports = router;
