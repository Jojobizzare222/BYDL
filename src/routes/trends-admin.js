// Agent Tendances — Kamwa Pro (/api/admin/trends), réservé à l'administrateur (décision d'intégrer un produit).
const router = require('express').Router();
const { requireRole } = require('../admin/auth');
const { trends } = require('../store');
const agent = require('../trends');
const aliexpress = require('../trends/aliexpress');

router.use(requireRole());

router.get('/', (req, res) => {
  const list = trends.all().filter((t) => t.status !== 'skipped').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 300);
  res.json({ proposals: list, runs: agent.runs().slice(0, 10), settings: agent.trendSettings(), keys: agent.publicSecrets(), demand: agent.demand().slice(0, 15) });
});

router.post('/run', async (req, res) => {
  try { res.json(await agent.run({ reason: `lancé par ${req.user.name || 'l\'admin'}` })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/decision', (req, res) => {
  const t = trends.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Proposition introuvable' });
  const status = req.body?.status;
  if (!['new', 'kept', 'ignored', 'integrated'].includes(status)) return res.status(400).json({ error: 'Décision inconnue' });
  res.json(trends.update(t.id, { status, decidedAt: new Date().toISOString(), decidedBy: req.user.name || 'admin' }));
});

router.put('/settings', (req, res) => res.json(agent.saveTrendSettings(req.body || {})));
router.put('/keys', (req, res) => res.json(agent.saveSecrets(req.body || {})));

// Vérifier les clés saisies (petite requête à chaque service)
router.post('/test', async (req, res) => {
  const keys = agent.secrets(); const out = {};
  if (keys.aliexpress.appKey && keys.aliexpress.appSecret) {
    try { out.aliexpress = await aliexpress.test(keys.aliexpress); } catch (err) { out.aliexpress = { ok: false, error: err.message }; }
  } else out.aliexpress = { ok: false, error: 'Clés AliExpress non saisies' };
  if (keys.anthropicKey) {
    try {
      const r = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', 'x-api-key': keys.anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: require('../trends/analyze').MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'Réponds OK' }] }) });
      const d = await r.json().catch(() => null);
      out.ai = r.ok ? { ok: true } : { ok: false, error: d?.error?.message || `Erreur ${r.status}` };
    } catch (err) { out.ai = { ok: false, error: err.message }; }
  } else out.ai = { ok: false, error: 'Clé Anthropic non saisie' };
  res.json(out);
});

module.exports = router;
