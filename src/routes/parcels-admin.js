// Kamwa Pro → Colis (/api/admin/parcels) : liste, scan (recherche par numéro ou QR), étapes, étiquettes.
// Employé Commandes / admin : tout. Livreur : seulement les colis des commandes qui lui sont confiées (« Je prends le colis »).
const crypto = require('crypto');
const router = require('express').Router();
const { orders, staff, agencies, activity, parcels: store } = require('../store');
const { requireRole } = require('../admin/auth');
const P = require('../parcels');
const delivery = require('../delivery');
const push = require('../push');

function log(req, action, target, details = '') {
  activity.insert({
    id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(),
    userId: req.user.id, userName: req.user.name, role: req.user.role,
    action, targetId: target?.id || null, targetName: target?.name || null, details,
  });
}
const actor = (req) => ({ id: req.user.id, role: req.user.role, name: req.user.name });
const isOrdersRole = (req) => ['admin', 'orders'].includes(req.user.role);
const readyToDeliver = (o) => ['paid', 'confirmed', 'shipped'].includes(o.status);
const HOURS = (iso) => (Date.now() - Date.parse(iso)) / 3600000;
// Colis qui attend trop longtemps à la même étape
const STALE_AFTER = { preparing: 24, ready: 24, with_courier: 12, at_relay: 72 };

/** Actions possibles pour cette personne sur ce colis */
function actionsFor(req, p, o) {
  if (!o || !P.OPEN.includes(p.stage)) return [];
  const pickup = P.isPickup(o);
  if (req.user.role === 'courier') return !pickup && o.courierId === req.user.id && p.stage !== 'with_courier' ? ['take'] : [];
  if (!isOrdersRole(req)) return [];
  const out = [];
  if (p.stage === 'preparing') out.push('prepare');
  if (!pickup && ['preparing', 'ready'].includes(p.stage) && readyToDeliver(o)) out.push('to_courier');
  if (pickup && ['preparing', 'ready'].includes(p.stage)) out.push('at_relay');
  if (pickup && p.stage === 'at_relay' && o.status === 'paid') out.push('handover');
  if (['with_courier', 'at_relay'].includes(p.stage)) out.push('back');
  return out;
}

function view(req, p) {
  const o = orders.get(p.orderId);
  const count = P.forOrder(p.orderId).length;
  const pickup = o ? P.isPickup(o) : false;
  return {
    id: p.id, number: p.number, index: p.index, count, stage: p.stage, stageLabel: P.STAGES[p.stage], stageAt: p.stageAt,
    place: p.place, history: p.history, orderId: p.orderId, createdAt: p.createdAt,
    stale: P.OPEN.includes(p.stage) && STALE_AFTER[p.stage] && HOURS(p.stageAt) > STALE_AFTER[p.stage] ? Math.floor(HOURS(p.stageAt)) : 0,
    order: o ? {
      status: o.status, fulfillment: o.fulfillment || 'delivery', total: o.total, paymentPlan: o.paymentPlan || null,
      toCollect: delivery.amountToCollect(o), courierId: o.courierId || null, courierName: delivery.courierName(o.courierId),
      relay: pickup ? P.relayPlace(o) : null, items: (o.lines || []).reduce((n, l) => n + (l.qty || 1), 0),
      customer: { name: o.customer?.name || '', phone: o.customer?.phone || '', city: o.customer?.city || '', address: pickup ? '' : o.customer?.address || '' },
      codeLocked: Boolean(o.codeLocked),
    } : null,
    actions: actionsFor(req, p, o),
  };
}
// Le livreur ne voit que les colis des commandes qui lui sont confiées
const visible = (req, p) => isOrdersRole(req) || (req.user.role === 'courier' && orders.get(p.orderId)?.courierId === req.user.id);

router.get('/', requireRole('orders', 'courier'), (req, res) => {
  const list = store.all().filter((p) => visible(req, p)).sort((a, b) => (a.stageAt < b.stageAt ? 1 : -1));
  const recentDone = (p) => P.OPEN.includes(p.stage) || HOURS(p.stageAt) < 24 * 7;
  res.json({
    parcels: list.filter(recentDone).map((p) => view(req, p)), stages: P.STAGES,
    couriers: isOrdersRole(req) ? staff.all().filter((u) => u.role === 'courier' && u.active !== false).map((u) => ({ id: u.id, name: u.name })) : [],
    relays: isOrdersRole(req) ? agencies.all().filter((a) => a.active !== false).map((a) => ({ id: a.id, name: a.name, city: a.city || '' })) : [],
  });
});

// Scan : numéro KM-… ou adresse contenue dans le QR code
router.get('/lookup', requireRole('orders', 'courier'), (req, res) => {
  const p = P.findByCode(req.query.code);
  if (!p || !visible(req, p)) return res.status(404).json({ error: req.user.role === 'courier' && p ? "Ce colis ne vous est pas confié" : 'Colis introuvable' });
  res.json(view(req, p));
});

router.post('/:id/action', requireRole('orders', 'courier'), (req, res) => {
  const p = store.get(req.params.id) || P.findByCode(req.params.id);
  if (!p || !visible(req, p)) return res.status(404).json({ error: 'Colis introuvable' });
  const o = orders.get(p.orderId);
  const action = req.body?.action;
  if (!actionsFor(req, p, o).includes(action)) {
    return res.status(400).json({ error: `Impossible ici : le colis est « ${P.STAGES[p.stage]} »${o ? ` (commande ${o.status === 'cancelled' ? 'annulée' : o.status === 'delivered' ? 'déjà remise' : 'en cours'})` : ''}` });
  }
  const by = actor(req);
  if (action === 'prepare') {
    P.move(p, 'ready', P.WAREHOUSE, by, 'Emballé, étiquette collée');
    log(req, 'Colis préparé', { id: o.id, name: p.number });
  } else if (action === 'take') {
    P.move(p, 'with_courier', P.courierPlace(req.user.id), by, 'Pris en charge par le livreur');
    log(req, 'Colis pris par le livreur', { id: o.id, name: p.number });
  } else if (action === 'to_courier') {
    const courier = staff.get(req.body?.courierId || o.courierId);
    if (!courier || courier.role !== 'courier' || courier.active === false) return res.status(400).json({ error: 'Choisissez un livreur' });
    if (o.status === 'shipped' && o.courierId && o.courierId !== courier.id) return res.status(409).json({ error: `Commande déjà confiée à ${delivery.courierName(o.courierId)}` });
    P.move(p, 'with_courier', P.courierPlace(courier.id), by, 'Remis au livreur');
    if (o.status !== 'shipped') {
      const now = new Date().toISOString();
      orders.update(o.id, { courierId: courier.id, assignedAt: now, status: 'shipped', history: [...(o.history || []), { status: 'shipped', at: now }] });
    }
    log(req, 'Colis remis au livreur', { id: o.id, name: p.number }, courier.name);
  } else if (action === 'at_relay') {
    const ag = req.body?.agencyId ? agencies.get(req.body.agencyId) : null;
    if (req.body?.agencyId && (!ag || ag.active === false)) return res.status(400).json({ error: 'Point relais introuvable' });
    const place = P.relayPlace(o, ag?.id);
    P.move(p, 'at_relay', place, by, 'Arrivé au point relais');
    log(req, 'Colis arrivé au point relais', { id: o.id, name: p.number }, place.name);
    // Tous les colis de la commande sont au point relais : le client est prévenu (une seule fois)
    const all = P.forOrder(o.id).filter((x) => P.OPEN.includes(x.stage));
    if (all.every((x) => x.stage === 'at_relay') && !o.readyAtRelayAt) {
      const fresh = orders.update(o.id, { readyAtRelayAt: new Date().toISOString() });
      push.notifyOrder(fresh, 'Votre colis vous attend', `Il est au point relais ${place.name}. Venez avec votre code de retrait.`, { urgent: true });
    }
  } else if (action === 'handover') {
    const forced = Boolean(req.body?.force) && req.user.role === 'admin';
    if (!forced) {
      const check = delivery.checkCode(o, req.body?.code);
      if (check.error) { log(req, 'Code de retrait faux', { id: o.id, name: p.number }, check.error); return res.status(400).json({ error: check.error }); }
    }
    delivery.finishDelivery(orders.get(o.id), { by, forced });
    log(req, 'Colis remis au client (point relais)', { id: o.id, name: p.number }, forced ? 'sans code (forcé par l\'admin)' : 'code du client vérifié');
  } else if (action === 'back') {
    if (p.stage === 'with_courier' && o.status === 'shipped' && P.forOrder(o.id).filter((x) => x.stage === 'with_courier').length <= 1) {
      return res.status(400).json({ error: 'Commande en livraison : utilisez « Problème » (livraison ratée) sur la commande pour la faire revenir' });
    }
    P.move(p, 'ready', P.WAREHOUSE, by, 'Revenu à l\'entrepôt');
    log(req, 'Colis revenu à l\'entrepôt', { id: o.id, name: p.number });
  }
  P.sync(o.id); // la commande a peut-être changé : colis à jour tout de suite
  res.json(view(req, store.get(p.id)));
});

// Colis supplémentaire (commande en plusieurs cartons)
router.post('/order/:orderId', requireRole('orders'), (req, res) => {
  const o = orders.get(req.params.orderId);
  if (!o) return res.status(404).json({ error: 'Commande introuvable' });
  if (!P.eligible(o) || ['delivered', 'cancelled'].includes(o.status)) return res.status(400).json({ error: 'Commande pas encore payée ou déjà terminée' });
  const had = P.forOrder(o.id).length;
  const p = had ? P.create(o, { by: actor(req) }) : P.sync(o)[0];
  log(req, 'Colis ajouté', { id: o.id, name: p.number }, `${P.forOrder(o.id).length} colis`);
  res.status(201).json({ parcels: P.forOrder(o.id).map((x) => view(req, x)) });
});

// Étiquettes (une ou plusieurs) : page à imprimer
const origin = (req) => `${String(req.get('x-forwarded-proto') || req.protocol).split(',')[0]}://${req.get('host')}`;
router.get('/labels', requireRole('orders'), (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean).slice(0, 100);
  const list = req.query.order ? P.forOrder(req.query.order) : ids.map((id) => store.get(id)).filter(Boolean);
  if (!list.length) return res.status(404).type('text').send('Aucun colis');
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.type('html').send(P.labels(list, origin(req)));
});

module.exports = router;
module.exports.view = view;
