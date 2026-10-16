// Volet Finances de l'espace pro (administrateur uniquement) : suivre l'argent de Kamwa sans outil externe.
//  - les VENTES viennent automatiquement des commandes payées (rien à ressaisir) ;
//  - les DÉPENSES, AUTRES ENTRÉES et TRANSFERTS entre caisses sont saisis à la main (collection « ledger ») ;
//  - deux lectures :
//      rentabilité : ventes − coût des produits vendus = marge brute ; − charges = résultat ;
//      trésorerie  : argent entré − argent sorti, caisse par caisse (espèces, Mobile Money, carte, banque).
//  - dettes envers les fournisseurs : ce qui a été vendu de leurs produits (au prix fournisseur) − ce qui leur a été payé.
// Ce n'est pas une comptabilité certifiée (SYSCOHADA) : l'export CSV sert à la transmettre à un comptable.
const crypto = require('crypto');
const express = require('express');
const { orders, payments, products, staff, ledger, activity } = require('../store');

const router = express.Router();

const METHODS = { cash: 'Caisse espèces', momo: 'Mobile Money', card: 'Carte (prestataire)', bank: 'Banque' };
// accrual = compte dans la rentabilité. Les achats de stock, paiements fournisseurs et remboursements ne comptent
// qu'en trésorerie (le coût des produits est déjà compté à la vente ; une vente annulée n'est pas une vente).
const CATEGORIES = {
  expense: [
    { key: 'stock', label: 'Achat de marchandises', accrual: false },
    { key: 'supplier', label: 'Paiement fournisseur', accrual: false },
    { key: 'refund', label: 'Remboursement client', accrual: false },
    { key: 'delivery', label: 'Livraison et transport', accrual: true },
    { key: 'rent', label: 'Loyer et agence', accrual: true },
    { key: 'salary', label: 'Salaires et primes', accrual: true },
    { key: 'marketing', label: 'Publicité et marketing', accrual: true },
    { key: 'fees', label: 'Frais Mobile Money et bancaires', accrual: true },
    { key: 'telecom', label: 'Internet, téléphone, site', accrual: true },
    { key: 'tax', label: 'Impôts et taxes', accrual: true },
    { key: 'supplies', label: 'Fournitures et emballages', accrual: true },
    { key: 'other', label: 'Autre dépense', accrual: true },
  ],
  income: [
    { key: 'capital', label: 'Apport / solde de départ', accrual: false },
    { key: 'loan', label: 'Prêt reçu', accrual: false },
    { key: 'other_income', label: 'Autre recette', accrual: true },
  ],
  transfer: [{ key: 'transfer', label: 'Transfert entre caisses', accrual: false }],
};
const catOf = (type, key) => CATEGORIES[type]?.find((c) => c.key === key);
const OPERATOR_METHOD = { mtn: 'momo', airtel: 'momo', card: 'card', cash: 'cash' };

const day = (iso) => String(iso || '').slice(0, 10);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);
const sum = (list, fn) => list.reduce((s, x) => s + (fn(x) || 0), 0);
const SOLD = ['paid', 'shipped', 'delivered'];

function log(req, action, target, details = '') {
  activity.insert({
    id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(),
    userId: req.user.id, userName: req.user.name, role: req.user.role,
    action, targetId: target?.id || null, targetName: target?.label || null, details,
  });
}

// Coût d'une ligne vendue : figé au paiement (unitCost), sinon le coût actuel du produit (anciennes commandes)
function lineCost(l) {
  if (Number.isInteger(l.unitCost)) return l.unitCost;
  const p = products.get(l.productId);
  const c = p ? (p.supplierId ? p.supplierPrice : p.costPrice) : null;
  return Number.isInteger(c) ? c : null;
}
const lineSupplier = (l) => (l.supplierId !== undefined ? l.supplierId : products.get(l.productId)?.supplierId || null);
const methodOf = (o) => OPERATOR_METHOD[(o.paymentId && payments.get(o.paymentId)?.operator) || ''] || 'momo';

// Date à laquelle l'argent d'une commande est entré (paiement validé, ou paiement arrivé après une annulation)
const cashedAt = (o) => o.paidAt || (o.paidAfterCancel ? (payments.get(o.paymentId)?.updatedAt || o.updatedAt) : null);
// Toutes les commandes encaissées (y compris annulées ensuite : l'argent est bien entré, le remboursement sort à part)
const cashedOrders = () => orders.all().filter((o) => cashedAt(o));
const toRefund = (o) => o.status === 'cancelled' && cashedAt(o) && !o.refundedAt;

function supplierBalances() {
  const owed = new Map();
  for (const o of orders.all().filter((x) => SOLD.includes(x.status))) {
    for (const l of o.lines) {
      const sid = lineSupplier(l);
      if (!sid) continue;
      owed.set(sid, (owed.get(sid) || 0) + (lineCost(l) || 0) * l.qty);
    }
  }
  const paid = new Map();
  for (const e of ledger.all().filter((x) => x.type === 'expense' && x.category === 'supplier' && x.supplierId)) {
    paid.set(e.supplierId, (paid.get(e.supplierId) || 0) + e.amount);
  }
  const ids = new Set([...owed.keys(), ...paid.keys()]);
  return [...ids].map((id) => {
    const u = staff.get(id);
    const o = owed.get(id) || 0; const p = paid.get(id) || 0;
    return { id, name: u?.company || u?.name || 'Fournisseur supprimé', sold: o, paid: p, due: o - p };
  }).sort((a, b) => b.due - a.due);
}

function balancesUntil(to) {
  const bal = Object.fromEntries(Object.keys(METHODS).map((m) => [m, 0]));
  for (const o of cashedOrders()) if (!to || day(cashedAt(o)) <= to) bal[methodOf(o)] += o.total;
  for (const e of ledger.all()) {
    if (to && e.date > to) continue;
    if (e.type === 'income') bal[e.method] += e.amount;
    if (e.type === 'expense') bal[e.method] -= e.amount;
    if (e.type === 'transfer') { bal[e.method] -= e.amount; bal[e.toMethod] += e.amount; }
  }
  return bal;
}

const monthKey = (d) => d.slice(0, 7);
function lastMonths(n) {
  const out = []; const d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`); }
  return out;
}

// ---------- Résumé ----------
router.get('/', (req, res) => {
  const from = isDay(req.query.from) ? req.query.from : null;
  const to = isDay(req.query.to) ? req.query.to : null;
  const sold = orders.all().filter((o) => SOLD.includes(o.status) && inRange(day(o.paidAt || o.createdAt), from, to));
  const lines = sold.flatMap((o) => o.lines);
  const revenue = sum(sold, (o) => o.total);
  const costKnown = lines.filter((l) => lineCost(l) != null);
  const cogs = sum(costKnown, (l) => lineCost(l) * l.qty);
  const unknownCost = lines.filter((l) => lineCost(l) == null);
  const entries = ledger.all().filter((e) => inRange(e.date, from, to));
  const expenses = entries.filter((e) => e.type === 'expense');
  const charges = expenses.filter((e) => catOf('expense', e.category)?.accrual !== false);
  const otherIncome = entries.filter((e) => e.type === 'income' && catOf('income', e.category)?.accrual);
  const grossMargin = revenue - cogs;
  const result = grossMargin - sum(charges, (e) => e.amount) + sum(otherIncome, (e) => e.amount);

  const cashIn = sum(cashedOrders().filter((o) => inRange(day(cashedAt(o)), from, to)), (o) => o.total) + sum(entries.filter((e) => e.type === 'income'), (e) => e.amount);
  const cashOut = sum(expenses, (e) => e.amount);

  // 12 derniers mois : ventes, charges (coût des produits + charges), résultat
  const months = lastMonths(12);
  const monthly = months.map((m) => {
    const s = orders.all().filter((o) => SOLD.includes(o.status) && monthKey(day(o.paidAt || o.createdAt)) === m);
    const rev = sum(s, (o) => o.total);
    const cost = sum(s.flatMap((o) => o.lines), (l) => (lineCost(l) || 0) * l.qty);
    const ch = sum(ledger.all().filter((e) => e.type === 'expense' && monthKey(e.date) === m && catOf('expense', e.category)?.accrual !== false), (e) => e.amount);
    const inc = sum(ledger.all().filter((e) => e.type === 'income' && monthKey(e.date) === m && catOf('income', e.category)?.accrual), (e) => e.amount);
    return { month: m, revenue: rev, costs: cost + ch, result: rev - cost - ch + inc };
  });

  const byCategory = new Map();
  for (const e of expenses) {
    const label = catOf('expense', e.category)?.label || 'Autre dépense';
    byCategory.set(label, (byCategory.get(label) || 0) + e.amount);
  }
  const stockValue = sum(products.all().filter((p) => !p.supplierId && p.active !== false && Number.isInteger(p.costPrice)), (p) => p.costPrice * (p.stock || 0));
  const stockNoCost = products.all().filter((p) => !p.supplierId && p.active !== false && !p.pending && (p.stock || 0) > 0 && !Number.isInteger(p.costPrice)).length;
  const refundsToDo = orders.all().filter(toRefund).map((o) => ({ id: o.id, total: o.total, customer: o.customer?.name, method: methodOf(o) }));

  res.json({
    from, to,
    kpis: { revenue, orders: sold.length, cogs, grossMargin, charges: sum(charges, (e) => e.amount), result, cashIn, cashOut, cashFlow: cashIn - cashOut, stockValue },
    unknownCostLines: unknownCost.length,
    stockNoCost,
    balances: balancesUntil(to),
    suppliers: supplierBalances(),
    monthly,
    byCategory: [...byCategory.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    refundsToDo,
    methods: METHODS,
    categories: CATEGORIES,
  });
});

// ---------- Journal : ventes + écritures saisies ----------
function journal(from, to) {
  const rows = cashedOrders().filter((o) => inRange(day(cashedAt(o)), from, to)).map((o) => ({
    id: o.id, kind: 'sale', date: day(cashedAt(o)), label: `Vente ${o.id}`, detail: o.lines.map((l) => `${l.qty} × ${l.name}`).join(', '),
    category: o.status === 'cancelled' ? (o.refundedAt ? 'Vente annulée (remboursée)' : 'Vente annulée (à rembourser)') : 'Vente', method: methodOf(o), amount: o.total, editable: false,
  }));
  for (const e of ledger.all().filter((x) => inRange(x.date, from, to))) {
    const sign = e.type === 'expense' ? -1 : e.type === 'income' ? 1 : 0;
    rows.push({
      id: e.id, kind: e.type, date: e.date, label: e.label, detail: e.note || '', category: catOf(e.type, e.category)?.label || e.category,
      method: e.method, toMethod: e.toMethod || null, amount: sign * e.amount || e.amount, supplierId: e.supplierId || null,
      receipt: e.receipt || null, editable: true,
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
router.get('/journal', (req, res) => {
  res.json(journal(isDay(req.query.from) ? req.query.from : null, isDay(req.query.to) ? req.query.to : null));
});

router.get('/journal.csv', (req, res) => {
  const rows = journal(isDay(req.query.from) ? req.query.from : null, isDay(req.query.to) ? req.query.to : null);
  const cell = (v) => { const t = v == null ? '' : String(v); return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['Date', 'Type', 'Catégorie', 'Libellé', 'Détail', 'Caisse', 'Vers caisse', 'Montant (FCFA)'];
  const kind = { sale: 'Vente', expense: 'Dépense', income: 'Entrée', transfer: 'Transfert' };
  const body = [head, ...rows.map((r) => [r.date, kind[r.kind], r.category, r.label, r.detail, METHODS[r.method] || r.method, r.toMethod ? METHODS[r.toMethod] : '', r.amount])]
    .map((r) => r.map(cell).join(';')).join('\r\n');
  log(req, 'Export du journal financier', null, `${rows.length} lignes`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="kamwa-finances-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + body);
});

// ---------- Écritures (dépenses, entrées, transferts) ----------
function cleanEntry(input) {
  const type = input.type;
  if (!CATEGORIES[type]) return { error: 'Type inconnu' };
  const category = type === 'transfer' ? 'transfer' : input.category;
  if (!catOf(type, category)) return { error: 'Choisissez une catégorie' };
  const amount = Number(String(input.amount ?? '').replace(/\s/g, ''));
  if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000_000) return { error: 'Montant invalide (nombre entier en FCFA, plus grand que 0)' };
  if (!isDay(input.date)) return { error: 'Date invalide' };
  if (!METHODS[input.method]) return { error: 'Choisissez la caisse' };
  const e = {
    type, category, amount, date: input.date, method: input.method,
    label: String(input.label || '').trim().slice(0, 120) || catOf(type, category).label,
    note: String(input.note || '').trim().slice(0, 500),
    toMethod: null, supplierId: null,
    receipt: input.receipt && /^\/images\/uploads\/[\w.-]+\.(jpg|png|webp)$/.test(input.receipt) ? input.receipt : null,
  };
  if (type === 'transfer') {
    if (!METHODS[input.toMethod] || input.toMethod === input.method) return { error: 'Choisissez deux caisses différentes' };
    e.toMethod = input.toMethod;
  }
  if (category === 'supplier') {
    const u = staff.get(input.supplierId);
    if (!u || u.role !== 'supplier') return { error: 'Choisissez le fournisseur payé' };
    e.supplierId = u.id;
  }
  return { value: e };
}

router.get('/entries/:id', (req, res) => {
  const e = ledger.get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Écriture introuvable' });
  res.json(e);
});
router.post('/entries', (req, res) => {
  const { error, value } = cleanEntry(req.body || {});
  if (error) return res.status(400).json({ error });
  const e = ledger.insert({ id: 'FIN-' + crypto.randomBytes(5).toString('hex').toUpperCase(), ...value, createdBy: req.user.id, createdAt: new Date().toISOString() });
  log(req, 'Écriture financière ajoutée', e, `${catOf(e.type, e.category).label} : ${e.amount} FCFA`);
  res.status(201).json(e);
});
router.patch('/entries/:id', (req, res) => {
  const current = ledger.get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Écriture introuvable' });
  const { error, value } = cleanEntry({ ...current, ...req.body });
  if (error) return res.status(400).json({ error });
  const e = ledger.update(current.id, { ...value, updatedBy: req.user.id });
  log(req, 'Écriture financière modifiée', e, current.amount !== e.amount ? `${current.amount} → ${e.amount} FCFA` : '');
  res.json(e);
});
router.delete('/entries/:id', (req, res) => {
  const current = ledger.get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Écriture introuvable' });
  ledger.remove(current.id);
  log(req, 'Écriture financière supprimée', current, `${current.amount} FCFA du ${current.date}`);
  res.json({ ok: true });
});

// Remboursement d'un client (paiement reçu après annulation) : enregistre la sortie d'argent et marque la commande
router.post('/refunds/:orderId', (req, res) => {
  const o = orders.get(req.params.orderId);
  if (!o || o.status !== 'cancelled' || !cashedAt(o)) return res.status(404).json({ error: 'Aucun remboursement en attente pour cette commande' });
  if (o.refundedAt) return res.status(400).json({ error: 'Déjà remboursée' });
  const method = METHODS[req.body?.method] ? req.body.method : methodOf(o);
  const date = new Date().toISOString().slice(0, 10);
  const e = ledger.insert({
    id: 'FIN-' + crypto.randomBytes(5).toString('hex').toUpperCase(), type: 'expense', category: 'refund', amount: o.total, date, method,
    label: `Remboursement ${o.id}`, note: o.customer?.name || '', toMethod: null, supplierId: null, receipt: null, orderId: o.id,
    createdBy: req.user.id, createdAt: new Date().toISOString(),
  });
  orders.update(o.id, { refundedAt: new Date().toISOString() });
  log(req, 'Remboursement enregistré', e, `${o.total} FCFA`);
  res.json(e);
});

module.exports = router;
module.exports.METHODS = METHODS;
