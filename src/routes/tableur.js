// « Base de données » de Zado Pro (demande Joseph 10/11/2026 : « toutes les données côté admin, une base de données aux
// airs d'Excel ») — réservée à l'ADMINISTRATEUR. Chaque collection de la base devient une FEUILLE (onglets en bas, comme
// Excel) : produits, commandes, lignes de commande, clients, paiements, factures, colis, achats, stock, finances, avis,
// codes promo, points relais, équipe, messagerie, journal. Lecture de tout ; seuls les PRODUITS se modifient dans la
// grille (via PATCH /api/admin/products/:id : mêmes contrôles, même journal, mêmes mouvements de stock que la fiche).
// Les autres feuilles se modifient dans leurs écrans (factures jamais modifiables, statuts de commande avec leurs règles).
// JAMAIS dans le tableur : codes clients, mots de passe, empreintes, clés d'accès, sessions, photos de pièces d'identité.
// Export : un vrai classeur Excel (.xlsx, toutes les feuilles, en-têtes figés, filtres) ou une feuille en CSV.
const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const { UNIVERSES } = require('../catalog');
const freight = require('../freight');
const xlsx = require('../xlsx');

const router = express.Router();
const { products, orders, payments, customers, agencies, staff, activity, conversations, purchases, stockMoves, parcels, documents, reviews, ledger, promos } = store;

const STATUS = { pending_payment: 'Non payée', paid: 'Payée', confirmed: 'Confirmée', shipped: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée' };
const PAY_STATUS = { PENDING: 'En attente', SUCCESSFUL: 'Réussi', FAILED: 'Échoué', CANCELLED: 'Annulé', EXPIRED: 'Expiré' };
const OPS = { mtn: 'MTN MoMo', airtel: 'Airtel Money', card: 'Carte', cash: 'Espèces', transfer: 'Dépôt Mobile Money', cod: 'À la réception', simulation: 'Simulation' };
const ROLES = { admin: 'Administrateur', catalog: 'Responsable catalogue', orders: 'Commandes', courier: 'Livreur', supplier: 'Fournisseur (retiré)' };
const ID_STATUS = { missing: 'À fournir', pending: 'À vérifier', verified: 'Vérifiée', rejected: 'Refusée' };
const DOC_TYPES = { invoice: 'Facture', receipt: 'Reçu', credit: 'Avoir' };
const LOGI = { bought: 'Acheté en France', flight: 'Dans l\'avion', arrived: 'Arrivé à Pointe-Noire', local: 'Déjà sur place' };
const FIN_TYPES = { expense: 'Dépense', income: 'Entrée', transfer: 'Transfert' };

const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
const at = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : null);
const yes = (b) => Boolean(b);
const safe = (fn) => { try { return fn(); } catch { return null; } };

// Ventes par produit (commandes payées, confirmées, en livraison, livrées)
function salesByProduct(all) {
  const m = new Map();
  for (const o of all) {
    if (!['paid', 'confirmed', 'shipped', 'delivered'].includes(o.status)) continue;
    for (const l of o.lines || []) {
      const x = m.get(l.productId) || { qty: 0, ca: 0 };
      x.qty += l.qty || 0; x.ca += (l.total ?? (l.price || 0) * (l.qty || 0)); m.set(l.productId, x);
    }
  }
  return m;
}

// Définition des feuilles : colonnes (k = clé, l = libellé, t = type, w = largeur, e = modifiable) + lignes
const CATS = UNIVERSES.flatMap((u) => u.categories);
const SHEETS = [
  {
    key: 'produits', label: 'Produits', color: '#1E56C2', href: (r) => `#/produit/${r.id}`, editable: true, pivot: ['price', 'margin', 'revenue'],
    cols: [
      { k: 'id', l: 'Réf', t: 'id', w: 70 },
      { k: 'name', l: 'Nom', t: 'text', w: 300, e: 'text' },
      { k: 'brand', l: 'Marque', t: 'text', w: 110, e: 'text' },
      { k: 'category', l: 'Rayon', t: 'tag', w: 150, e: 'select', opts: CATS },
      { k: 'condition', l: 'État', t: 'tag', w: 100 },
      { k: 'price', l: 'Prix de vente', t: 'money', w: 110, e: 'money' },
      { k: 'oldPrice', l: 'Prix barré', t: 'money', w: 100, e: 'money' },
      { k: 'sourcePrice', l: 'Prix fournisseur', t: 'money', w: 115, e: 'money' },
      { k: 'costPrice', l: "Prix d'achat", t: 'money', w: 105, e: 'money' },
      { k: 'margin', l: 'Marge', t: 'money', w: 95 },
      { k: 'marginPct', l: 'Marge %', t: 'pct', w: 80 },
      { k: 'transport', l: 'Transport', t: 'money', w: 95 },
      { k: 'delivered', l: 'Prix livré', t: 'money', w: 105 },
      { k: 'stock', l: 'Stock', t: 'num', w: 70, e: 'num' },
      { k: 'weightKg', l: 'Poids (kg)', t: 'num', w: 80, e: 'num' },
      { k: 'active', l: 'Visible', t: 'bool', w: 70, e: 'bool' },
      { k: 'featured', l: 'Mis en avant', t: 'bool', w: 90, e: 'bool' },
      { k: 'pending', l: 'En attente', t: 'bool', w: 80 },
      { k: 'provenance', l: 'Provenance', t: 'text', w: 90, e: 'text' },
      { k: 'sourceSupplier', l: "Fournisseur d'origine", t: 'tag', w: 140, e: 'text' },
      { k: 'selection', l: 'Sélection', t: 'tag', w: 110 },
      { k: 'giftFor', l: 'Pour qui', t: 'tag', w: 110 },
      { k: 'priceEur', l: 'Prix France (€)', t: 'num', w: 100 },
      { k: 'sourceRating', l: 'Note du site', t: 'num', w: 85 },
      { k: 'sourceReviews', l: 'Avis du site', t: 'num', w: 85 },
      { k: 'sold', l: 'Vendus', t: 'num', w: 70 },
      { k: 'revenue', l: "Chiffre d'affaires", t: 'money', w: 120 },
      { k: 'rating', l: 'Note clients', t: 'num', w: 85 },
      { k: 'sourceUrl', l: 'Lien source', t: 'link', w: 120 },
      { k: 'createdAt', l: 'Créé le', t: 'date', w: 95 },
      { k: 'updatedAt', l: 'Modifié le', t: 'date', w: 95 },
    ],
    rows: (ctx) => {
      const fr = freight.freightSettings();
      const sales = salesByProduct(ctx.orders);
      const notes = new Map();
      for (const r of reviews.all()) { if (r.hidden) continue; const x = notes.get(r.productId) || { s: 0, n: 0 }; x.s += r.rating; x.n++; notes.set(r.productId, x); }
      return products.all().map((p) => {
        const t = freight.unitFee(p, fr);
        const cost = p.costPrice ?? p.sourcePrice ?? null;
        const ref = (p.priceRefs || []).filter((r) => r.priceEur).sort((a, b) => a.priceEur - b.priceEur)[0];
        const s = sales.get(p.id), n = notes.get(p.id);
        return {
          id: p.id, name: p.name, brand: p.brand || null, category: p.category, condition: p.condition || 'neuf',
          price: p.price ?? null, oldPrice: p.oldPrice ?? null, sourcePrice: p.sourcePrice ?? null, costPrice: p.costPrice ?? null,
          margin: p.price && cost != null ? p.price - cost : null, marginPct: p.price && cost != null ? (p.price - cost) / p.price : null,
          transport: t, delivered: p.price ? p.price + t : null, stock: p.stock ?? null, weightKg: p.weightKg ?? null,
          active: p.active !== false, featured: yes(p.featured), pending: yes(p.pending), provenance: p.provenance || null, sourceSupplier: p.sourceSupplier || null,
          selection: p.selection || null, giftFor: p.giftFor || null, priceEur: ref?.priceEur ?? null,
          sourceRating: p.sourceRating?.avg ?? null, sourceReviews: p.sourceRating?.count ?? null,
          sold: s?.qty || 0, revenue: s?.ca || 0, rating: n ? Math.round((n.s / n.n) * 10) / 10 : null,
          sourceUrl: ref?.url || p.sourceUrl || null, createdAt: day(p.createdAt), updatedAt: day(p.updatedAt),
        };
      });
    },
  },
  {
    key: 'commandes', label: 'Commandes', color: '#16A34A', href: (r) => `#/commande/${r.id}`, pivot: ['total', 'discount', 'grossMargin'],
    cols: [
      { k: 'id', l: 'Commande', t: 'id', w: 105 }, { k: 'createdAt', l: 'Date', t: 'datetime', w: 125 }, { k: 'status', l: 'Statut', t: 'tag', w: 105 },
      { k: 'customer', l: 'Client', t: 'text', w: 150 }, { k: 'phone', l: 'Téléphone', t: 'text', w: 105 }, { k: 'city', l: 'Ville', t: 'text', w: 100 }, { k: 'zone', l: 'Quartier', t: 'text', w: 100 },
      { k: 'mode', l: 'Retrait / livraison', t: 'tag', w: 120 }, { k: 'plan', l: 'Paiement', t: 'tag', w: 120 },
      { k: 'items', l: 'Articles', t: 'num', w: 70 }, { k: 'subtotal', l: 'Sous-total', t: 'money', w: 105 }, { k: 'discount', l: 'Remise', t: 'money', w: 90 }, { k: 'promo', l: 'Code promo', t: 'tag', w: 95 },
      { k: 'transportFee', l: 'Transport', t: 'money', w: 95 }, { k: 'deliveryFee', l: 'Livraison', t: 'money', w: 90 }, { k: 'total', l: 'Total', t: 'money', w: 110 },
      { k: 'cost', l: 'Coût des articles', t: 'money', w: 115 }, { k: 'grossMargin', l: 'Marge brute', t: 'money', w: 105 },
      { k: 'gift', l: 'Cadeau', t: 'bool', w: 70 }, { k: 'logistics', l: 'Logistique', t: 'tag', w: 140 }, { k: 'courier', l: 'Livreur', t: 'text', w: 110 },
      { k: 'paidAt', l: 'Payée le', t: 'datetime', w: 125 }, { k: 'deliveredAt', l: 'Livrée le', t: 'datetime', w: 125 }, { k: 'cancelReason', l: "Motif d'annulation", t: 'text', w: 180 },
    ],
    rows: (ctx) => ctx.orders.map((o) => {
      const cost = (o.lines || []).reduce((s, l) => s + (Number.isInteger(l.unitCost) ? l.unitCost * l.qty : 0), 0);
      const hasCost = (o.lines || []).some((l) => Number.isInteger(l.unitCost));
      const sub = o.subtotal ?? (o.lines || []).reduce((s, l) => s + (l.total || 0), 0);
      const lastLogi = (o.logistics?.steps || o.logistics?.history || []).slice(-1)[0];
      return {
        id: o.id, createdAt: at(o.createdAt), status: STATUS[o.status] || o.status, customer: o.customer?.name || null, phone: o.customer?.phone || null,
        city: o.customer?.city || null, zone: o.customer?.zone || null, mode: o.fulfillment === 'pickup' ? 'Retrait' : 'Livraison',
        plan: o.paymentPlan === 'mobile' ? 'Mobile Money (acompte)' : o.paymentPlan === 'cod' ? 'À la réception' : (OPS[safe(() => payments.get(o.paymentId)?.operator)] || 'Paiement complet'),
        items: (o.lines || []).reduce((s, l) => s + (l.qty || 0), 0), subtotal: sub, discount: o.discount?.amount || 0, promo: o.discount?.code || null,
        transportFee: o.transportFee || 0, deliveryFee: o.deliveryFee || 0, total: o.total ?? null,
        cost: hasCost ? cost : null, grossMargin: hasCost ? sub - (o.discount?.amount || 0) - cost + (o.transportZadoFee || 0) : null,
        gift: yes(o.gift), logistics: LOGI[lastLogi?.step || lastLogi?.key || o.logistics?.stage] || null, courier: o.courierName || o.courier?.name || null,
        paidAt: at(o.paidAt), deliveredAt: at(o.deliveredAt), cancelReason: o.cancelReason || null,
      };
    }),
  },
  {
    key: 'lignes', label: 'Lignes de commande', color: '#0D9488', href: (r) => `#/commande/${r.order}`,
    cols: [
      { k: 'order', l: 'Commande', t: 'id', w: 105 }, { k: 'date', l: 'Date', t: 'date', w: 95 }, { k: 'status', l: 'Statut', t: 'tag', w: 100 },
      { k: 'productId', l: 'Réf', t: 'id', w: 70 }, { k: 'name', l: 'Article', t: 'text', w: 280 }, { k: 'qty', l: 'Qté', t: 'num', w: 55 },
      { k: 'price', l: 'Prix unitaire', t: 'money', w: 105 }, { k: 'total', l: 'Total ligne', t: 'money', w: 105 }, { k: 'unitCost', l: 'Coût unitaire', t: 'money', w: 105 }, { k: 'margin', l: 'Marge', t: 'money', w: 95 },
    ],
    rows: (ctx) => ctx.orders.flatMap((o) => (o.lines || []).map((l, i) => ({
      _id: `${o.id}:${i}`, order: o.id, date: day(o.createdAt), status: STATUS[o.status] || o.status, productId: l.productId, name: l.name, qty: l.qty,
      price: l.price ?? null, total: l.total ?? (l.price || 0) * l.qty, unitCost: Number.isInteger(l.unitCost) ? l.unitCost : null,
      margin: Number.isInteger(l.unitCost) ? (l.total ?? l.price * l.qty) - l.unitCost * l.qty : null,
    }))),
  },
  {
    key: 'clients', label: 'Clients', color: '#7C3AED', href: () => '#/clients',
    cols: [
      { k: 'id', l: 'Client', t: 'id', w: 110 }, { k: 'name', l: 'Nom', t: 'text', w: 170 }, { k: 'phone', l: 'Téléphone', t: 'text', w: 110 }, { k: 'email', l: 'E-mail', t: 'text', w: 190 },
      { k: 'idStatus', l: "Pièce d'identité", t: 'tag', w: 120 }, { k: 'idType', l: 'Type de pièce', t: 'text', w: 100 }, { k: 'createdAt', l: 'Inscrit le', t: 'date', w: 95 },
      { k: 'orders', l: 'Commandes', t: 'num', w: 85 }, { k: 'paid', l: 'Payées', t: 'num', w: 70 }, { k: 'revenue', l: 'Total acheté', t: 'money', w: 110 }, { k: 'last', l: 'Dernière commande', t: 'date', w: 125 },
      { k: 'city', l: 'Ville favorite', t: 'text', w: 110 }, { k: 'sso', l: 'Connexion rapide', t: 'bool', w: 110 },
    ],
    rows: (ctx) => {
      const by = new Map();
      for (const o of ctx.orders) { if (!o.customerId) continue; if (!by.has(o.customerId)) by.set(o.customerId, []); by.get(o.customerId).push(o); }
      return customers.all().map((c) => {
        const os = by.get(c.id) || [], ok = os.filter((o) => ['paid', 'confirmed', 'shipped', 'delivered'].includes(o.status));
        return {
          id: c.id, name: c.name, phone: c.phone || null, email: c.email || null, idStatus: ID_STATUS[c.idStatus || 'missing'], idType: c.idType ? { passport: 'Passeport', cni: 'CNI', niu: 'NIU' }[c.idType] || c.idType : null,
          createdAt: day(c.createdAt), orders: os.length, paid: ok.length, revenue: ok.reduce((s, o) => s + (o.total || 0), 0),
          last: day(os.map((o) => o.createdAt).sort().pop()), city: c.prefs?.city || null, sso: Boolean((c.passkeys || []).length || c.google || c.apple),
        };
      });
    },
  },
  {
    key: 'paiements', label: 'Paiements', color: '#CA8A04', href: (r) => (r.orderId ? `#/commande/${r.orderId}` : null),
    cols: [
      { k: 'id', l: 'Paiement', t: 'id', w: 120 }, { k: 'createdAt', l: 'Date', t: 'datetime', w: 125 }, { k: 'orderId', l: 'Commande', t: 'id', w: 105 },
      { k: 'operator', l: 'Moyen', t: 'tag', w: 135 }, { k: 'purpose', l: 'Objet', t: 'tag', w: 100 }, { k: 'phone', l: 'Téléphone', t: 'text', w: 105 },
      { k: 'amount', l: 'Montant', t: 'money', w: 105 }, { k: 'status', l: 'Statut', t: 'tag', w: 95 }, { k: 'confirmedBy', l: 'Confirmé par', t: 'text', w: 120 }, { k: 'reason', l: 'Motif', t: 'text', w: 180 },
    ],
    rows: () => payments.all().map((p) => ({
      id: p.id, createdAt: at(p.createdAt), orderId: p.orderId || null, operator: OPS[p.operator] || p.operator || null,
      purpose: { deposit: 'Acompte', rest: 'Solde', balance: 'Reste à la livraison' }[p.purpose] || 'Paiement', phone: p.phone || null, amount: p.amount ?? null,
      status: PAY_STATUS[p.status] || p.status, confirmedBy: p.confirmedBy?.name || p.confirmedByName || null, reason: p.reason || null,
    })),
  },
  {
    key: 'factures', label: 'Factures & reçus', color: '#0EA5E9', href: () => '#/documents',
    cols: [
      { k: 'number', l: 'Numéro', t: 'id', w: 130 }, { k: 'type', l: 'Type', t: 'tag', w: 80 }, { k: 'issuedAt', l: 'Émis le', t: 'datetime', w: 125 }, { k: 'orderId', l: 'Commande', t: 'id', w: 105 },
      { k: 'customer', l: 'Client', t: 'text', w: 160 }, { k: 'label', l: 'Libellé', t: 'text', w: 170 }, { k: 'total', l: 'Montant', t: 'money', w: 110 },
    ],
    rows: () => documents.all().map((d) => ({
      _id: d.id, number: d.number, type: DOC_TYPES[d.type] || d.type, issuedAt: at(d.issuedAt || d.createdAt), orderId: d.orderId || null,
      customer: d.customer?.name || null, label: d.paymentLabel || d.title || null, total: d.amount ?? d.total ?? null,
    })),
  },
  {
    key: 'colis', label: 'Colis', color: '#EA580C', href: (r) => `#/colis/${r.number}`,
    cols: [
      { k: 'number', l: 'Colis', t: 'id', w: 120 }, { k: 'orderId', l: 'Commande', t: 'id', w: 105 }, { k: 'stage', l: 'Étape', t: 'tag', w: 130 },
      { k: 'place', l: 'Où', t: 'text', w: 160 }, { k: 'createdAt', l: 'Créé le', t: 'datetime', w: 125 }, { k: 'stageAt', l: 'Dernière étape', t: 'datetime', w: 125 }, { k: 'scans', l: 'Scans', t: 'num', w: 65 },
    ],
    rows: () => { const ST = require('../parcels').STAGES; return parcels.all().map((p) => ({ _id: p.id, number: p.number, orderId: p.orderId, stage: ST[p.stage] || p.stage, place: typeof p.place === 'string' ? p.place : p.place?.label || p.place?.name || null, createdAt: at(p.createdAt), stageAt: at(p.stageAt), scans: (p.history || []).length })); },
  },
  {
    key: 'achats', label: 'Achats (BC)', color: '#9333EA', href: (r) => `#/achat/${r._id}`,
    cols: [
      { k: 'number', l: 'Bon', t: 'id', w: 120 }, { k: 'createdAt', l: 'Créé le', t: 'date', w: 95 }, { k: 'supplier', l: 'Fournisseur', t: 'text', w: 160 }, { k: 'status', l: 'Statut', t: 'tag', w: 110 },
      { k: 'lines', l: 'Lignes', t: 'num', w: 65 }, { k: 'total', l: 'Montant', t: 'money', w: 110 }, { k: 'received', l: 'Reçu', t: 'money', w: 105 }, { k: 'paid', l: 'Payé', t: 'money', w: 100 }, { k: 'due', l: 'Reste dû', t: 'money', w: 100 },
      { k: 'expectedAt', l: 'Arrivée prévue', t: 'date', w: 110 }, { k: 'invoice', l: 'Facture fournisseur', t: 'text', w: 140 },
    ],
    rows: () => { const P = require('../purchases'); return purchases.all().map((b) => { const v = safe(() => P.view(b)) || {}; return { _id: b.id, number: b.number, createdAt: day(b.createdAt), supplier: b.supplier?.name || null, status: P.STATUS[b.status] || b.status, lines: (b.lines || []).length, total: v.total ?? null, received: v.receivedTotal ?? null, paid: v.paid ?? null, due: v.due ?? null, expectedAt: day(b.expectedAt), invoice: b.invoice?.number || null }; }); },
  },
  {
    key: 'stock', label: 'Mouvements de stock', color: '#64748B', href: (r) => (r.productId ? `#/produit/${r.productId}` : null),
    cols: [
      { k: 'at', l: 'Date', t: 'datetime', w: 125 }, { k: 'productId', l: 'Réf', t: 'id', w: 70 }, { k: 'name', l: 'Article', t: 'text', w: 250 }, { k: 'label', l: 'Motif', t: 'tag', w: 120 },
      { k: 'qty', l: 'Quantité', t: 'num', w: 80 }, { k: 'before', l: 'Avant', t: 'num', w: 65 }, { k: 'after', l: 'Après', t: 'num', w: 65 }, { k: 'ref', l: 'Référence', t: 'text', w: 120 }, { k: 'byName', l: 'Par', t: 'text', w: 130 },
    ],
    rows: () => stockMoves.all().map((m) => ({ _id: m.id, at: at(m.at), productId: m.productId, name: m.name, label: m.label || m.reason, qty: m.qty, before: m.before, after: m.after, ref: m.ref || null, byName: m.byName || null })),
  },
  {
    key: 'finances', label: 'Finances', color: '#DC2626', href: () => '#/finances',
    cols: [
      { k: 'date', l: 'Date', t: 'date', w: 95 }, { k: 'type', l: 'Type', t: 'tag', w: 90 }, { k: 'category', l: 'Catégorie', t: 'tag', w: 190 }, { k: 'label', l: 'Libellé', t: 'text', w: 220 },
      { k: 'amount', l: 'Montant', t: 'money', w: 110 }, { k: 'signed', l: 'Effet sur la trésorerie', t: 'money', w: 150 }, { k: 'method', l: 'Caisse', t: 'tag', w: 120 }, { k: 'toMethod', l: 'Vers', t: 'tag', w: 100 },
    ],
    rows: () => { const F = require('./finance'); const cats = Object.values({ ...F.CATEGORIES || {} }).flat(); return ledger.all().map((e) => ({ _id: e.id, date: day(e.date || e.createdAt), type: FIN_TYPES[e.type] || e.type, category: cats.find((c) => c.key === e.category)?.label || e.category, label: e.label || null, amount: e.amount, signed: e.type === 'expense' ? -e.amount : e.type === 'income' ? e.amount : 0, method: F.METHODS?.[e.method] || e.method, toMethod: e.toMethod ? F.METHODS?.[e.toMethod] || e.toMethod : null })); },
  },
  {
    key: 'avis', label: 'Avis', color: '#F59E0B', href: () => '#/avis',
    cols: [{ k: 'createdAt', l: 'Date', t: 'date', w: 95 }, { k: 'productId', l: 'Réf', t: 'id', w: 70 }, { k: 'product', l: 'Article', t: 'text', w: 220 }, { k: 'name', l: 'Client', t: 'text', w: 110 }, { k: 'rating', l: 'Note', t: 'stars', w: 95 }, { k: 'text', l: 'Commentaire', t: 'text', w: 320 }, { k: 'hidden', l: 'Masqué', t: 'bool', w: 70 }],
    rows: () => reviews.all().map((r) => ({ _id: r.id, createdAt: day(r.createdAt), productId: r.productId, product: products.get(r.productId)?.name || null, name: r.name, rating: r.rating, text: r.text, hidden: yes(r.hidden) })),
  },
  {
    key: 'promos', label: 'Codes promo', color: '#E11D48', href: () => '#/promos',
    cols: [{ k: 'code', l: 'Code', t: 'id', w: 110 }, { k: 'remise', l: 'Remise', t: 'text', w: 110 }, { k: 'label', l: 'Note', t: 'text', w: 150 }, { k: 'uses', l: 'Utilisations', t: 'num', w: 90 }, { k: 'maxUses', l: 'Maximum', t: 'num', w: 80 }, { k: 'minTotal', l: 'Achat minimum', t: 'money', w: 110 }, { k: 'active', l: 'Actif', t: 'bool', w: 60 }, { k: 'startsAt', l: 'Début', t: 'date', w: 95 }, { k: 'endsAt', l: 'Fin', t: 'date', w: 95 }],
    rows: (ctx) => promos.all().map((p) => ({ _id: p.id, code: p.code, remise: p.type === 'percent' ? `−${p.value} %` : `−${p.value} FCFA`, label: p.label || null, uses: ctx.orders.filter((o) => o.discount?.code === p.code && o.status !== 'cancelled').length, maxUses: p.maxUses ?? null, minTotal: p.minTotal ?? null, active: p.active !== false, startsAt: p.startsAt || null, endsAt: p.endsAt || null })),
  },
  {
    key: 'relais', label: 'Points relais', color: '#059669', href: (r) => `#/agences/${r.id}`,
    cols: [{ k: 'id', l: 'Réf', t: 'id', w: 110 }, { k: 'name', l: 'Nom', t: 'text', w: 220 }, { k: 'kind', l: 'Type', t: 'tag', w: 100 }, { k: 'city', l: 'Ville', t: 'text', w: 100 }, { k: 'address', l: 'Adresse', t: 'text', w: 200 }, { k: 'phone', l: 'Téléphone', t: 'text', w: 105 }, { k: 'hours', l: 'Horaires', t: 'text', w: 140 }, { k: 'active', l: 'Actif', t: 'bool', w: 60 }, { k: 'lat', l: 'Latitude', t: 'num', w: 85 }, { k: 'lng', l: 'Longitude', t: 'num', w: 85 }],
    rows: () => agencies.all().map((a) => ({ id: a.id, name: a.name, kind: a.kind === 'partner' ? 'Partenaire' : 'Agence', city: a.city, address: a.address, phone: a.phone, hours: a.hours, active: a.active !== false, lat: a.lat ?? null, lng: a.lng ?? null })),
  },
  {
    key: 'equipe', label: 'Équipe', color: '#334155', href: (r) => `#/equipe/${r.id}`,
    cols: [{ k: 'id', l: 'Réf', t: 'id', w: 120 }, { k: 'login', l: 'Identifiant', t: 'text', w: 120 }, { k: 'name', l: 'Nom', t: 'text', w: 150 }, { k: 'role', l: 'Rôle', t: 'tag', w: 150 }, { k: 'phone', l: 'Téléphone', t: 'text', w: 105 }, { k: 'vehicle', l: 'Véhicule', t: 'text', w: 180 }, { k: 'active', l: 'Actif', t: 'bool', w: 60 }, { k: 'createdAt', l: 'Créé le', t: 'date', w: 95 }],
    rows: () => staff.all().map((u) => ({ id: u.id, login: u.login, name: u.name, role: ROLES[u.role] || u.role, phone: u.phone || null, vehicle: u.vehicle || null, active: u.active !== false, createdAt: day(u.createdAt) })),
  },
  {
    key: 'messagerie', label: 'Messagerie', color: '#2563EB', href: (r) => `#/messagerie/${r.id}`,
    cols: [{ k: 'id', l: 'Conversation', t: 'id', w: 130 }, { k: 'kind', l: 'Type', t: 'tag', w: 90 }, { k: 'name', l: 'Client', t: 'text', w: 150 }, { k: 'phone', l: 'Téléphone', t: 'text', w: 105 }, { k: 'status', l: 'État', t: 'tag', w: 120 }, { k: 'messages', l: 'Messages', t: 'num', w: 80 }, { k: 'last', l: 'Dernier message', t: 'datetime', w: 130 }, { k: 'createdAt', l: 'Ouverte le', t: 'date', w: 95 }],
    rows: () => conversations.all().map((c) => ({ id: c.id, kind: c.kind === 'team' ? 'Équipe' : 'Client', name: c.name || c.title || null, phone: c.phone || null, status: { bot: 'Avec l\'assistant', human: 'À répondre', waiting: 'À répondre', open: 'En cours', closed: 'Terminée' }[c.status] || c.status || null, messages: (c.messages || []).length, last: at((c.messages || []).slice(-1)[0]?.at), createdAt: day(c.createdAt) })),
  },
  {
    key: 'journal', label: 'Journal', color: '#475569', href: () => '#/journal',
    cols: [{ k: 'at', l: 'Date', t: 'datetime', w: 125 }, { k: 'userName', l: 'Qui', t: 'text', w: 150 }, { k: 'role', l: 'Rôle', t: 'tag', w: 120 }, { k: 'action', l: 'Action', t: 'text', w: 200 }, { k: 'target', l: 'Sur', t: 'text', w: 200 }, { k: 'details', l: 'Détails', t: 'text', w: 320 }],
    rows: () => activity.all().map((a) => ({ _id: a.id, at: at(a.at), userName: a.userName, role: ROLES[a.role] || a.role || null, action: a.action, target: a.targetName || a.targetId || null, details: a.details || null })),
  },
];

const ctxOf = () => ({ orders: orders.all() });
const build = (sh, ctx) => sh.rows(ctx).map((r) => ({ ...r, _id: r._id ?? r.id, _href: sh.href ? sh.href(r) : null }));
const meta = (sh) => ({ key: sh.key, label: sh.label, color: sh.color, editable: Boolean(sh.editable), pivot: sh.pivot || null, cols: sh.cols });

function log(req, action, details = '') {
  activity.insert({ id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), userId: req.user.id, userName: req.user.name, role: req.user.role, action, targetId: null, targetName: null, details });
}

// Liste des feuilles avec leur nombre de lignes
router.get('/', (req, res) => {
  const ctx = ctxOf();
  res.json({ sheets: SHEETS.map((sh) => ({ key: sh.key, label: sh.label, color: sh.color, count: safe(() => sh.rows(ctx).length) ?? 0 })) });
});

// Une feuille : colonnes + lignes
router.get('/sheet/:key', (req, res) => {
  const sh = SHEETS.find((s) => s.key === req.params.key);
  if (!sh) return res.status(404).json({ error: 'Feuille inconnue' });
  res.json({ ...meta(sh), rows: build(sh, ctxOf()) });
});

const cellOut = (c, v) => (v == null ? '' : c.t === 'bool' ? (v ? 'oui' : 'non') : c.t === 'pct' ? Math.round(v * 1000) / 10 : v);

// Une feuille en CSV (Excel, « ; », BOM)
router.get('/csv/:key', (req, res) => {
  const sh = SHEETS.find((s) => s.key === req.params.key);
  if (!sh) return res.status(404).json({ error: 'Feuille inconnue' });
  const rows = build(sh, ctxOf());
  const cell = (v) => { const t = String(v ?? ''); return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const body = [sh.cols.map((c) => c.l + (c.t === 'pct' ? ' (%)' : '')), ...rows.map((r) => sh.cols.map((c) => cellOut(c, r[c.k])))].map((r) => r.map(cell).join(';')).join('\r\n');
  log(req, 'Export du tableur', `${sh.label} (${rows.length} lignes, CSV)`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zado-${sh.key}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + body);
});

// Tout le classeur en .xlsx (une feuille par collection + une feuille « Synthèse »)
router.get('/zado.xlsx', (req, res) => {
  const ctx = ctxOf();
  const sheets = [];
  const built = SHEETS.map((sh) => ({ sh, rows: safe(() => build(sh, ctx)) || [] }));
  const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const P = built.find((b) => b.sh.key === 'produits').rows, O = built.find((b) => b.sh.key === 'commandes').rows;
  const sold = O.filter((o) => ['Payée', 'Confirmée', 'En livraison', 'Livrée'].includes(o.status));
  sheets.push({
    name: 'Synthèse', widths: [260, 160],
    rows: [
      [{ v: 'Zado — base de données', s: 'title' }], [{ v: `Exporté le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Brazzaville' })}`, s: 'muted' }], [],
      [{ v: 'Indicateur', s: 'head' }, { v: 'Valeur', s: 'head' }],
      ['Produits visibles', P.filter((p) => p.active && !p.pending).length], ['Produits au total', P.length],
      ['Commandes', O.length], ['Commandes payées ou livrées', sold.length],
      ["Chiffre d'affaires (commandes payées)", { v: sum(sold, 'total'), s: 'money' }], ['Panier moyen', { v: sold.length ? Math.round(sum(sold, 'total') / sold.length) : 0, s: 'money' }],
      ['Clients', built.find((b) => b.sh.key === 'clients').rows.length], [],
      [{ v: 'Feuille', s: 'head' }, { v: 'Lignes', s: 'head' }], ...built.map((b) => [b.sh.label, b.rows.length]),
    ],
  });
  for (const { sh, rows } of built) {
    sheets.push({
      name: sh.label.replace(/[\\/?*[\]:]/g, '-').slice(0, 31), freeze: true, filter: true, widths: sh.cols.map((c) => c.w || 100),
      rows: [sh.cols.map((c) => ({ v: c.l, s: 'head' })), ...rows.map((r) => sh.cols.map((c) => {
        const v = r[c.k];
        if (v == null || v === '') return null;
        if (c.t === 'money') return { v, s: 'money' };
        if (c.t === 'pct') return { v, s: 'pct' };
        if (c.t === 'bool') return v ? 'oui' : 'non';
        if (c.t === 'num' || c.t === 'stars') return Number(v);
        return String(v);
      }))],
    });
  }
  log(req, 'Export du tableur', `classeur Excel complet (${built.reduce((s, b) => s + b.rows.length, 0)} lignes)`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="zado-base-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(xlsx.workbook(sheets));
});

module.exports = router;
module.exports.SHEETS = SHEETS;
