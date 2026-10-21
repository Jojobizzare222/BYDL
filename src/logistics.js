// Logistique France → Pointe-Noire (demandes de Joseph du 21/10/2026 : « le matériel vient de France, il faut des étapes en plus » ;
// « préciser au client une marge de 2 à 5 jours, puis 24 h pour la livraison »).
// Étapes confirmées par l'équipe dans Zado Pro (fiche commande) :
//   bought  : article acheté chez le fournisseur en France ;
//   flying  : colis remis à la société de fret, dans l'avion vers Pointe-Noire ;
//   arrived : arrivé à Pointe-Noire (dédouané) → livraison sous 24 h (réglable) ;
//   local   : l'article était déjà en stock à Pointe-Noire (pas de voyage) → livraison sous 24 h.
// Chaque étape prévient le client (message dans « Aide » + notification sur son téléphone).
const { orders, customers } = require('./store');
const { freightSettings } = require('./freight');

const STEPS = ['bought', 'flying', 'arrived'];
const DAY = 864e5;

/** La logistique peut commencer une fois la commande réglée (payée, ou confirmée pour un paiement à la réception). */
const canStart = (o) => o.status === 'paid' || (o.status === 'confirmed' && o.paymentPlan !== 'mobile');

/** Dates annoncées au client : arrivée entre J+min et J+max après le paiement, puis livraison sous X heures après l'arrivée. */
function etaOf(o, s = freightSettings()) {
  const L = o.logistics || {};
  const base = Date.parse(o.paidAt || o.confirmedAt || '') || null;
  const arrived = L.arrivedAt || L.localAt;
  return {
    from: base && !arrived ? new Date(base + s.logisticsMin * DAY).toISOString() : null,
    to: base && !arrived ? new Date(base + s.logisticsMax * DAY).toISOString() : null,
    deliverBy: arrived ? new Date(Date.parse(arrived) + s.deliveryHours * 3600e3).toISOString() : null,
    minDays: s.logisticsMin, maxDays: s.logisticsMax, deliveryHours: s.deliveryHours,
  };
}

function tell(o, text) {
  try {
    const c = o.customerId && customers.get(o.customerId);
    if (!c) return;
    require('./chat').notifyCustomer(c, text, { links: [{ label: 'Suivre ma commande', href: `#/suivi/${o.id}` }] });
    require('./push').notifyCustomer(c.id, `Commande ${o.id}`, text.slice(0, 140), `/#/suivi/${o.id}`, `zado-cmd-${o.id}`);
  } catch (err) { console.error('[logistique]', err.message); }
}

const fr = (iso) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Brazzaville' });

/** Avance (ou corrige) l'étape logistique d'une commande. by = { id, name }. */
function setStep(order, step, by) {
  if (!['bought', 'flying', 'arrived', 'local', 'undo'].includes(step)) return { error: 'Étape inconnue' };
  if (!canStart(order) && step !== 'undo') return { error: order.status === 'confirmed' ? "Attendez le paiement complet du client avant de lancer la logistique" : "La logistique commence une fois la commande payée" };
  if (['shipped', 'delivered', 'cancelled'].includes(order.status) && step !== 'undo') return { error: 'Commande déjà en livraison, livrée ou annulée' };
  const now = new Date().toISOString();
  const L = { ...(order.logistics || {}) };
  const who = { by: by?.id || null, byName: by?.name || null };
  if (step === 'undo') {
    // Retire la dernière étape notée (erreur de clic)
    if (L.localAt) delete L.localAt;
    else if (L.arrivedAt) delete L.arrivedAt;
    else if (L.flyingAt) delete L.flyingAt;
    else if (L.boughtAt) delete L.boughtAt;
    return { value: orders.update(order.id, { logistics: Object.keys(L).length ? L : null }) };
  }
  if (step === 'local') Object.assign(L, { localAt: now, ...who });
  else {
    // Une étape implique les précédentes (ex. « arrivé » sans avoir cliqué « dans l'avion »)
    for (const k of STEPS.slice(0, STEPS.indexOf(step) + 1)) if (!L[`${k}At`]) L[`${k}At`] = now;
    Object.assign(L, who);
  }
  const updated = orders.update(order.id, { logistics: L });
  const eta = etaOf(updated);
  const first = String(updated.customer?.name || '').split(' ')[0];
  if (step === 'bought') tell(updated, `Bonne nouvelle ${first} : votre commande ${updated.id} a été achetée chez notre fournisseur en France. Elle prend bientôt l'avion pour Pointe-Noire${eta.to ? ` (arrivée prévue au plus tard ${fr(eta.to)})` : ''}.`);
  if (step === 'flying') tell(updated, `Votre commande ${updated.id} est dans l'avion, en route vers Pointe-Noire ✈️${eta.to ? ` Arrivée prévue au plus tard ${fr(eta.to)}.` : ''}`);
  if (step === 'arrived' || step === 'local') tell(updated, `Votre commande ${updated.id} est arrivée à Pointe-Noire ! ${updated.fulfillment === 'pickup' ? 'Elle vous attend bientôt au point relais.' : `Nous vous la livrons dans les ${eta.deliveryHours} h : nous vous appelons pour convenir du créneau.`}`);
  return { value: updated };
}

/** Ce que voit le client (sans le nom de la personne de l'équipe). */
function clientLogistics(o) {
  const L = o.logistics || {};
  const eta = etaOf(o);
  // Étapes « France » montrées tant que le voyage est prévu ou en cours (pas pour un article déjà sur place, ni les anciennes commandes déjà livrées sans logistique)
  const show = !L.localAt && (Boolean(L.boughtAt) || ['pending_payment', 'paid', 'confirmed'].includes(o.status));
  return { show, boughtAt: L.boughtAt || null, flyingAt: L.flyingAt || null, arrivedAt: L.arrivedAt || L.localAt || null, local: Boolean(L.localAt), ...eta };
}

module.exports = { STEPS, canStart, etaOf, setStep, clientLogistics };
