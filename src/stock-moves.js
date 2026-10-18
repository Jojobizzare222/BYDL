// Mouvements de stock (ERP, étape 3 — 17/10/2026) : chaque entrée / sortie est notée dans la collection `stock_moves`
// (qui, quand, pourquoi, référence, stock après). Toute modification de `product.stock` passe par `moveStock`.
// Raisons : purchase (réception fournisseur) · sale (vente payée) · cancel (commande annulée, articles remis) ·
//           adjust (correction à la main dans la fiche produit) · count (inventaire) · return (retour fournisseur)
const crypto = require('crypto');
const { products, stockMoves } = require('./store');

const REASONS = {
  purchase: 'Réception fournisseur',
  sale: 'Vente',
  cancel: 'Commande annulée (articles remis)',
  adjust: 'Correction manuelle',
  count: 'Inventaire',
  return: 'Retour au fournisseur',
};

/**
 * Change le stock d'un produit et note le mouvement. delta > 0 = entrée, < 0 = sortie.
 * Un produit sans stock suivi (stock null) n'est pas touché, sauf `force` (réception : le suivi commence).
 */
function moveStock(productId, delta, { reason, ref = null, by = null, note = '', force = false, patch = {} } = {}) {
  const p = products.get(productId);
  if (!p || !Number.isInteger(delta)) return null;
  if (p.stock == null && !force) return null;
  const before = p.stock == null ? 0 : p.stock;
  const after = Math.max(0, before + delta);
  const applied = after - before;
  if (!applied && reason !== 'count') return products.get(productId);
  const updated = products.update(productId, { stock: after, ...patch });
  stockMoves.insert({
    id: 'MV-' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(),
    productId, name: p.name, qty: applied, before, after, reason, label: REASONS[reason] || reason, ref,
    by: by?.id || null, byName: by?.name || (by ? '' : 'Zado (automatique)'), note: String(note || '').slice(0, 300),
  });
  return updated;
}

/** Inventaire : la quantité comptée remplace le stock ; l'écart est noté. */
function countStock(productId, counted, by, note) {
  const p = products.get(productId);
  if (!p) return null;
  const before = p.stock == null ? 0 : p.stock;
  return moveStock(productId, counted - before, { reason: 'count', by, note, force: true });
}

const moves = ({ productId = null, limit = 500 } = {}) =>
  stockMoves.all().filter((m) => !productId || m.productId === productId).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);

module.exports = { REASONS, moveStock, countStock, moves };
