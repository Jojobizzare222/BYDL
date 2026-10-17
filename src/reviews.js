// Avis clients (audit du 17/10/2026) :
//  - seul un client CONNECTÉ qui a REÇU le produit (commande livrée sur son compte) peut donner un avis : « Achat vérifié » ;
//  - un avis par client et par produit (il peut le modifier) ; note de 1 à 5 + commentaire facultatif ;
//  - publié tout de suite ; l'admin ou l'employé Catalogue peut le masquer (et le réafficher) depuis Kamwa Pro ;
//  - sur la boutique : prénom + initiale du nom seulement, jamais le téléphone ni l'e-mail.
const crypto = require('crypto');
const { reviews, orders, products } = require('./store');

const MAX_TEXT = 1000;
const shortName = (name) => {
  const parts = String(name || 'Client').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
};

/** Commande livrée de ce client contenant ce produit (preuve d'achat), ou null. */
function deliveredOrderFor(customerId, productId) {
  return orders.all().find((o) => o.customerId === customerId && o.status === 'delivered' && o.lines.some((l) => l.productId === productId)) || null;
}

const mineFor = (customerId, productId) => reviews.all().find((r) => r.customerId === customerId && r.productId === productId) || null;

function save(customer, { productId, rating, text }) {
  const p = products.get(productId);
  if (!p) return { status: 404, error: 'Produit introuvable' };
  const order = deliveredOrderFor(customer.id, productId);
  if (!order) return { status: 403, error: 'Seuls les clients qui ont reçu ce produit peuvent donner leur avis.' };
  const r = Math.round(Number(rating));
  if (!(r >= 1 && r <= 5)) return { status: 400, error: 'Choisissez une note de 1 à 5 étoiles' };
  const body = String(text || '').replace(/\s+\n/g, '\n').trim().slice(0, MAX_TEXT);
  const now = new Date().toISOString();
  const existing = mineFor(customer.id, productId);
  const value = existing
    ? reviews.update(existing.id, { rating: r, text: body, name: shortName(customer.name), updatedAt: now })
    : reviews.insert({ id: 'AV-' + crypto.randomBytes(6).toString('hex'), productId, customerId: customer.id, orderId: order.id, rating: r, text: body, name: shortName(customer.name), hidden: false, createdAt: now });
  return { value };
}

const publicReview = (r) => ({ id: r.id, name: r.name, rating: r.rating, text: r.text, createdAt: r.createdAt, updatedAt: r.updatedAt || null, verified: true });

/** Note moyenne et nombre d'avis visibles, pour tous les produits (une seule lecture). */
function summaries() {
  const map = new Map();
  for (const r of reviews.all()) {
    if (r.hidden) continue;
    const s = map.get(r.productId) || { sum: 0, count: 0 };
    s.sum += r.rating; s.count += 1;
    map.set(r.productId, s);
  }
  for (const [k, s] of map) map.set(k, { avg: Math.round((s.sum / s.count) * 10) / 10, count: s.count });
  return map;
}

function forProduct(productId) {
  const list = reviews.all().filter((r) => r.productId === productId && !r.hidden).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const count = list.length;
  const avg = count ? Math.round((list.reduce((n, r) => n + r.rating, 0) / count) * 10) / 10 : 0;
  const dist = [5, 4, 3, 2, 1].map((n) => list.filter((r) => r.rating === n).length);
  return { avg, count, dist, list: list.slice(0, 30).map(publicReview) };
}

module.exports = { save, summaries, forProduct, mineFor, deliveredOrderFor, publicReview };
