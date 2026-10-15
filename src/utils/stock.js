// Stock disponible = stock du catalogue - quantités réservées par les paiements en cours.
// Une commande réserve ses articles tant qu'une demande de paiement est en attente (et récente),
// pour éviter que deux clients paient le dernier exemplaire.
const config = require('../config');
const { orders, payments } = require('../store');

const isFreshPending = (p) =>
  p.status === 'PENDING' && Date.now() - Date.parse(p.createdAt) < config.paymentPendingMinutes * 60 * 1000;

function reservedQty(productId, excludeOrderId) {
  const orderIds = new Set(
    payments.all().filter((p) => isFreshPending(p) && p.orderId !== excludeOrderId).map((p) => p.orderId)
  );
  let qty = 0;
  for (const id of orderIds) {
    const order = orders.get(id);
    if (!order || order.status !== 'pending_payment') continue;
    for (const line of order.lines) if (line.productId === productId) qty += line.qty;
  }
  return qty;
}

/** Quantité encore achetable, ou Infinity si le produit n'a pas de stock suivi. */
function availableStock(product, excludeOrderId) {
  if (product.stock == null) return Infinity;
  return Math.max(0, product.stock - reservedQty(product.id, excludeOrderId));
}

module.exports = { availableStock, isFreshPending };
