// Livraison sécurisée et paiement à la réception (décision Joseph, 16/10/2026) — contre les « livraisons fictives » :
//  1. Paiement à la réception avec ACOMPTE Mobile Money pour les nouveaux clients (filtre les fausses commandes) ;
//     le reste se paie à la livraison, en espèces ou en Mobile Money devant le livreur.
//  2. CODE DE LIVRAISON à 4 chiffres donné au client : le livreur ne peut valider « Livrée » qu'avec ce code
//     (impossible d'inventer une livraison). 5 codes faux = commande bloquée, seul l'admin peut débloquer.
//  3. FIABILITÉ par numéro de téléphone : livraisons réussies / refus. Client fiable = plus d'acompte ;
//     trop de refus = paiement à la réception refusé (il doit payer en ligne).
//  4. Espèces encaissées par un livreur : suivies jusqu'à leur remise à Kamwa (volet Finances).
const crypto = require('crypto');
const { settings, orders, products, payments, staff } = require('./store');
const { normalizeLocal } = require('./utils/phone');

const DEFAULTS = { enabled: true, deposit: 2000, depositPercent: 0, trustedAfter: 2, maxRefusals: 2 };
function codSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(settings.get('cod') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveCodSettings(input) {
  const cur = codSettings();
  const int = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
  const next = {
    enabled: 'enabled' in input ? Boolean(input.enabled) : cur.enabled,
    deposit: 'deposit' in input ? int(input.deposit, 0, 1000000) : cur.deposit,
    depositPercent: 'depositPercent' in input ? int(input.depositPercent, 0, 100) : cur.depositPercent,
    trustedAfter: 'trustedAfter' in input ? int(input.trustedAfter, 0, 100) : cur.trustedAfter,
    maxRefusals: 'maxRefusals' in input ? int(input.maxRefusals, 1, 100) : cur.maxRefusals,
  };
  if (Object.values(next).some((v) => v === null)) return { error: 'Valeurs invalides (nombres entiers)' };
  settings.set('cod', JSON.stringify(next));
  return { value: next };
}

const FAIL_REASONS = {
  absent: 'Client absent',
  injoignable: 'Client injoignable',
  adresse: 'Adresse introuvable',
  report: 'Le client demande un autre jour',
  refus: 'Colis refusé par le client',
  autre: 'Autre raison',
};

const newDeliveryCode = () => String(crypto.randomInt(1000, 10000));

// Historique du client, par numéro de téléphone (le numéro n'est pas vérifié : simple indicateur de confiance)
function reliability(phone) {
  const p = normalizeLocal(phone) || phone;
  const mine = orders.all().filter((o) => o.customer?.phone === p);
  const delivered = mine.filter((o) => o.status === 'delivered' && o.fulfillment !== 'pickup').length;
  const refused = mine.filter((o) => o.refused).length;
  const failedAttempts = mine.reduce((n, o) => n + (o.attempts || []).length, 0);
  const s = codSettings();
  return { delivered, refused, failedAttempts, trusted: delivered >= s.trustedAfter && refused === 0, blocked: refused >= s.maxRefusals };
}

/** Acompte demandé pour payer cette commande à la réception, ou { allowed: false, reason }. */
function codQuote(order) {
  const s = codSettings();
  if (!s.enabled) return { allowed: false, reason: "Le paiement à la réception n'est pas proposé pour le moment" };
  const r = reliability(order.customer?.phone);
  if (r.blocked) return { allowed: false, reason: 'Paiement à la réception indisponible pour ce numéro (colis refusés). Vous pouvez payer en Mobile Money.' };
  if (r.trusted) return { allowed: true, deposit: 0, trusted: true };
  const deposit = Math.min(order.total, Math.max(s.deposit, Math.round((order.total * s.depositPercent) / 100)));
  return { allowed: true, deposit, trusted: false };
}

const decrementStock = (lines) => {
  for (const line of lines) {
    const p = products.get(line.productId);
    if (p && p.stock != null) products.update(p.id, { stock: Math.max(0, p.stock - line.qty) });
  }
};
const restoreStock = (lines) => {
  for (const line of lines) {
    const p = products.get(line.productId);
    if (p && p.stock != null) products.update(p.id, { stock: p.stock + line.qty });
  }
};

/** Commande à payer à la réception confirmée (acompte reçu, ou client fiable) : articles réservés, à livrer. */
function confirmCod(order, { depositPaymentId = null } = {}) {
  const now = new Date().toISOString();
  const updated = orders.update(order.id, {
    status: 'confirmed',
    confirmedAt: now,
    depositPaidAt: depositPaymentId ? now : order.depositPaidAt || null,
    depositPaymentId: depositPaymentId || order.depositPaymentId || null,
    history: [...(order.history || []), { status: 'confirmed', at: now }],
  });
  decrementStock(order.lines);
  return updated;
}

// Coût d'achat figé (même règle que pour un paiement en ligne)
function costSnapshot(p) {
  if (!p) return { unitCost: null, supplierId: null };
  const cost = p.supplierId ? p.supplierPrice : p.costPrice;
  return { unitCost: Number.isInteger(cost) ? cost : null, supplierId: p.supplierId || null };
}

const amountToCollect = (o) => (o.paymentPlan === 'cod' && !o.balancePaid ? o.balance ?? o.total - (o.deposit || 0) : 0);

/** Commande remise au client. by = personne qui a livré ; balance = { method, paymentId? } si un reste a été encaissé. */
function finishDelivery(order, { by, balance = null, forced = false }) {
  const now = new Date().toISOString();
  const patch = {
    status: 'delivered', deliveredAt: now, deliveredBy: by?.id || null, deliveredWithoutCode: forced || undefined,
    history: [...(order.history || []), { status: 'delivered', at: now }],
  };
  if (order.paymentPlan === 'cod') {
    patch.paidAt = now; // la vente est réalisée à la livraison
    patch.lines = order.lines.map((l) => (l.productId ? { ...l, ...costSnapshot(products.get(l.productId)) } : l));
    if (balance) {
      patch.balancePaid = { method: balance.method, at: now, paymentId: balance.paymentId || null, by: by?.id || null };
      if (balance.method === 'cash') {
        patch.cashHeldBy = by?.id || null;
        patch.cashRemittedAt = by?.role === 'admin' ? now : null; // l'admin encaisse directement dans la caisse
      }
    }
  }
  return orders.update(order.id, patch);
}

/** Vérifie le code de livraison donné par le client (5 erreurs = commande bloquée). */
function checkCode(order, code) {
  if (order.codeLocked) return { error: "Trop de codes faux pour cette commande : l'administrateur doit la débloquer" };
  if (String(code || '').trim() === order.deliveryCode) {
    orders.update(order.id, { codeVerifiedAt: new Date().toISOString(), codeFails: 0 });
    return { ok: true };
  }
  const fails = (order.codeFails || 0) + 1;
  orders.update(order.id, { codeFails: fails, codeLocked: fails >= 5 || undefined });
  return { error: fails >= 5 ? "Code faux. Commande bloquée après 5 essais : contactez l'administrateur." : `Code faux (${5 - fails} essai(s) restant(s)). Demandez au client le code reçu à la commande.` };
}

/** Échec de livraison : tentative notée ; un refus annule la commande (stock remis, acompte conservé). */
function failDelivery(order, { by, reason, note }) {
  const now = new Date().toISOString();
  const attempt = { at: now, by: by?.id || null, byName: by?.name || '', reason, label: FAIL_REASONS[reason], note: String(note || '').slice(0, 300) };
  const attempts = [...(order.attempts || []), attempt];
  if (reason === 'refus') {
    restoreStock(order.lines);
    return orders.update(order.id, {
      attempts, refused: true, status: 'cancelled', cancelReason: 'Colis refusé à la livraison',
      depositRetained: order.paymentPlan === 'cod' && Boolean(order.depositPaidAt),
      history: [...(order.history || []), { status: 'cancelled', at: now }],
    });
  }
  const back = order.paymentPlan === 'cod' ? 'confirmed' : 'paid';
  return orders.update(order.id, { attempts, status: back, history: [...(order.history || []), { status: back, at: now, note: FAIL_REASONS[reason] }] });
}

const courierName = (id) => { const u = id && staff.get(id); return u ? u.name : null; };

module.exports = {
  FAIL_REASONS, codSettings, saveCodSettings, reliability, codQuote, newDeliveryCode,
  confirmCod, finishDelivery, checkCode, failDelivery, amountToCollect, restoreStock, courierName,
};
