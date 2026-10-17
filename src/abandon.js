// Commandes jamais payées (audit du 17/10/2026 : « commandes fantômes ») :
//  - le client peut annuler lui-même une commande pas encore payée (cancelByCustomer) ;
//  - les commandes abandonnées sont annulées automatiquement (sweep), le stock réservé est libéré :
//      · aucune demande de paiement : après NO_PAYMENT_HOURS (2 h) ;
//      · réservation en agence expirée : après l'échéance + GRACE_HOURS (24 h, l'admin peut encore encaisser un client en retard) ;
//      · paiement échoué ou abandonné : GRACE_HOURS après la dernière tentative.
// Un paiement validé APRÈS une annulation reste signalé « à rembourser » (paidAfterCancel, circuit existant).
const config = require('./config');
const { orders, payments } = require('./store');
const { isFreshPending } = require('./utils/stock');

const NO_PAYMENT_HOURS = config.abandonNoPaymentHours;
const GRACE_HOURS = config.abandonGraceHours;
const H = 3600 * 1000;

function cancel(order, reason, extra = {}) {
  const now = new Date().toISOString();
  for (const p of payments.all().filter((x) => x.orderId === order.id && x.status === 'PENDING')) {
    payments.update(p.id, { status: 'CANCELLED', reason });
  }
  return orders.update(order.id, {
    status: 'cancelled', cancelReason: reason, cancelledAt: now, ...extra,
    history: [...(order.history || []), { status: 'cancelled', at: now, note: reason }],
  });
}

/** Le client annule sa commande tant qu'elle n'est pas payée. */
function cancelByCustomer(order) {
  if (order.status !== 'pending_payment') return { error: order.status === 'cancelled' ? 'Commande déjà annulée' : 'Cette commande est déjà payée : contactez-nous pour l\'annuler' };
  if (payments.all().some((p) => p.orderId === order.id && p.status === 'SUCCESSFUL')) return { error: 'Paiement déjà reçu : contactez-nous' };
  return { value: cancel(order, 'Annulée par le client', { cancelledByCustomer: true }) };
}

/** Annule les commandes abandonnées. Renvoie le nombre de commandes annulées. */
function sweep(now = Date.now()) {
  let n = 0;
  const all = payments.all();
  for (const o of orders.all().filter((x) => x.status === 'pending_payment')) {
    const mine = all.filter((p) => p.orderId === o.id);
    if (mine.some((p) => p.status === 'SUCCESSFUL')) continue; // le circuit de paiement s'en occupe
    if (mine.some(isFreshPending)) continue; // paiement en cours ou réservation encore valable
    let deadline;
    if (!mine.length) deadline = Date.parse(o.createdAt) + NO_PAYMENT_HOURS * H;
    else {
      const last = Math.max(...mine.map((p) => Date.parse(p.expiresAt || p.updatedAt || p.createdAt) || 0));
      deadline = last + GRACE_HOURS * H;
    }
    if (now > deadline) { cancel(o, 'Non payée dans les délais', { autoCancelled: true }); n++; }
  }
  return n;
}

let timer = null;
function start() {
  if (timer || process.env.VERCEL) return;
  timer = setInterval(() => { try { sweep(); } catch (err) { console.error('[abandon]', err.message); } }, 10 * 60 * 1000);
  timer.unref?.();
  try { sweep(); } catch {}
}

module.exports = { cancelByCustomer, sweep, start };
