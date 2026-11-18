// Avis sur le SERVICE et sur l'APPLICATION (18/11/2026, demande Joseph : « un système d'avis / notation de service et
// d'ergonomie de l'application »). Différent des avis PRODUITS (src/reviews.js).
//  - service : après une commande LIVRÉE, par son propriétaire (compte connecté ou clé de la commande) : note 1-5,
//    « recommanderiez-vous Zado ? » 0-10 (NPS), points forts / points à améliorer, commentaire ; un avis par commande (modifiable) ;
//  - application : facilité d'utilisation 1-5, ce qui a plu / gêné, commentaire, page et type d'appareil (téléphone,
//    application installée) ; tout visiteur peut répondre ; un client connecté garde un seul avis par mois (modifiable).
// L'équipe lit, filtre et traite les avis dans Zado Pro → Satisfaction ; les avis négatifs déclenchent une alerte (alerts.js).
// Le client ne voit que son propre avis ; la boutique n'affiche publiquement que la note moyenne du service (≥ 5 avis).
const crypto = require('crypto');
const { feedback, orders } = require('./store');

const TAGS = {
  service: {
    good: ['Livraison rapide', 'Livreur aimable', 'Colis en bon état', 'Prix clair', 'Bon suivi du colis', 'Service client à l\'écoute'],
    bad: ['Retard de livraison', 'Colis abîmé', 'Article différent', 'Difficile de joindre Zado', 'Paiement compliqué', 'Prix trop élevé'],
  },
  app: {
    good: ['Facile à utiliser', 'Belle présentation', 'Rapide', 'Prix bien expliqués', 'Recherche efficace'],
    bad: ['Produit difficile à trouver', 'Commande compliquée', 'Paiement pas clair', 'Création de compte difficile', 'Site lent', 'Texte trop petit'],
  },
};
const KINDS = Object.keys(TAGS);
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
const shortName = (name) => { const [first = '', last = ''] = clean(name, 80).split(/\s+/); return first ? `${first}${last ? ' ' + last[0].toUpperCase() + '.' : ''}` : 'Client Zado'; };
const isDelivered = (o) => o && o.status === 'delivered';

function validate(kind, input) {
  if (!KINDS.includes(kind)) return { error: 'Type d\'avis inconnu' };
  const rating = Math.round(Number(input.rating));
  if (!(rating >= 1 && rating <= 5)) return { error: 'Choisissez une note de 1 à 5 étoiles' };
  let nps = null;
  if (kind === 'service' && input.nps !== undefined && input.nps !== null && input.nps !== '') {
    nps = Math.round(Number(input.nps));
    if (!(nps >= 0 && nps <= 10)) return { error: 'Note de recommandation invalide (0 à 10)' };
  }
  const allowed = [...TAGS[kind].good, ...TAGS[kind].bad];
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : []).map((t) => String(t)).filter((t) => allowed.includes(t)))].slice(0, 8);
  const text = clean(input.text, 1000);
  const route = /^#\/[\w\/%.-]{0,120}$/.test(String(input.route || '')) ? String(input.route).slice(0, 120) : null;
  const d = input.device && typeof input.device === 'object' ? input.device : {};
  const device = { mobile: Boolean(d.mobile), standalone: Boolean(d.standalone), width: Math.max(0, Math.min(10000, Math.round(Number(d.width) || 0))) };
  return { value: { rating, nps, tags, text, route, device } };
}

/** Enregistre (ou met à jour) un avis. who = { customer, order (déjà vérifiée), visitor } */
function save(kind, input, who = {}) {
  const v = validate(kind, input || {});
  if (v.error) return { status: 400, error: v.error };
  const now = new Date().toISOString();
  const c = who.customer || null;
  if (kind === 'service') {
    const o = who.order;
    if (!o) return { status: 400, error: 'Commande introuvable' };
    if (!isDelivered(o)) return { status: 409, error: 'Vous pourrez noter le service dès que votre commande sera livrée' };
    const prev = feedback.all().find((f) => f.kind === 'service' && f.orderId === o.id);
    const base = { ...v.value, orderId: o.id, customerId: o.customerId || c?.id || null, name: shortName(o.customer?.name || c?.name), phone: o.customer?.phone || c?.phone || null };
    if (prev) { const doc = { ...prev, ...base, updatedAt: now, status: 'new' }; feedback.update(prev.id, doc); return { value: doc, updated: true }; }
    const doc = { id: 'SAT-' + crypto.randomBytes(5).toString('hex'), kind, ...base, createdAt: now, status: 'new' };
    feedback.insert(doc);
    return { value: doc };
  }
  // application
  const month = Date.now() - 30 * 864e5;
  const prev = c ? feedback.all().find((f) => f.kind === 'app' && f.customerId === c.id && Date.parse(f.createdAt) > month) : null;
  const base = { ...v.value, customerId: c?.id || null, name: c ? shortName(c.name) : 'Visiteur', phone: c?.phone || null, visitor: c ? null : clean(who.visitor, 40) || null };
  if (prev) { const doc = { ...prev, ...base, updatedAt: now, status: 'new' }; feedback.update(prev.id, doc); return { value: doc, updated: true }; }
  const doc = { id: 'SAT-' + crypto.randomBytes(5).toString('hex'), kind, ...base, createdAt: now, status: 'new' };
  feedback.insert(doc);
  return { value: doc };
}

const mine = (f) => (f ? { id: f.id, kind: f.kind, rating: f.rating, nps: f.nps, tags: f.tags, text: f.text, createdAt: f.createdAt, updatedAt: f.updatedAt || null } : null);
const forOrder = (orderId) => mine(feedback.all().find((f) => f.kind === 'service' && f.orderId === orderId));
const forCustomerApp = (customerId) => mine(feedback.all().filter((f) => f.kind === 'app' && f.customerId === customerId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]);

const avg = (l) => (l.length ? Math.round((l.reduce((n, f) => n + f.rating, 0) / l.length) * 10) / 10 : 0);
/** Indice de recommandation (NPS) : % de 9-10 moins % de 0-6, entre -100 et +100 */
function npsOf(l) {
  const r = l.filter((f) => Number.isInteger(f.nps));
  if (!r.length) return null;
  const pro = r.filter((f) => f.nps >= 9).length, det = r.filter((f) => f.nps <= 6).length;
  return { score: Math.round(((pro - det) / r.length) * 100), count: r.length, promoters: pro, passives: r.length - pro - det, detractors: det };
}

/** Chiffres de Zado Pro → Satisfaction */
function stats(list = feedback.all()) {
  const out = {};
  for (const k of KINDS) {
    const l = list.filter((f) => f.kind === k);
    const tags = {};
    for (const f of l) for (const t of f.tags || []) tags[t] = (tags[t] || 0) + 1;
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
      const key = d.toISOString().slice(0, 7);
      const m = l.filter((f) => String(f.createdAt).startsWith(key));
      months.push({ month: key, count: m.length, avg: avg(m) });
    }
    out[k] = {
      count: l.length, avg: avg(l), toHandle: l.filter((f) => f.status !== 'done').length, negative: l.filter((f) => f.rating <= 2).length,
      dist: [5, 4, 3, 2, 1].map((n) => l.filter((f) => f.rating === n).length),
      good: TAGS[k].good.map((t) => [t, tags[t] || 0]).sort((a, b) => b[1] - a[1]),
      bad: TAGS[k].bad.map((t) => [t, tags[t] || 0]).sort((a, b) => b[1] - a[1]),
      months, nps: k === 'service' ? npsOf(l) : null,
      mobile: l.filter((f) => f.device?.mobile).length, installed: l.filter((f) => f.device?.standalone).length,
    };
  }
  out.delivered = orders.all().filter(isDelivered).length;
  out.rate = out.delivered ? Math.round((list.filter((f) => f.kind === 'service').length / out.delivered) * 100) : 0;
  return out;
}

/** Note publique du service (boutique) : seulement à partir de 5 avis, sinon rien */
function publicSummary() {
  const l = feedback.all().filter((f) => f.kind === 'service');
  return l.length >= 5 ? { count: l.length, avg: avg(l) } : null;
}

module.exports = { TAGS, KINDS, save, forOrder, forCustomerApp, stats, publicSummary, npsOf };
