// Bons de commande fournisseurs (ERP, étape 3 — décision Joseph 17/10/2026).
// Zado commande des articles à un fournisseur (compte fournisseur de Zado Pro, ou fournisseur extérieur saisi à la main) :
//   brouillon (draft) → envoyé (sent : PDF / WhatsApp) → confirmé (confirmed : par le fournisseur dans son espace, ou par Zado)
//   → reçu en partie (partial) → reçu (received) ; annulé (cancelled) tant que rien n'est reçu.
// Chaque réception AUGMENTE le stock (mouvement « Réception fournisseur ») et met à jour le coût d'achat du produit
// (coût moyen pondéré). La facture du fournisseur, saisie sur le bon, crée une dette réglée par les écritures Finances
// « Achat de marchandises » rattachées au bon (purchaseId). Numéros continus BC-AAAA-NNNNN, jamais réutilisés.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { settings, transaction, products, staff, ledger, purchases } = require('./store');
const { moveStock } = require('./stock-moves');

const STATUS = { draft: 'Brouillon', sent: 'Envoyé', confirmed: 'Confirmé', partial: 'Reçu en partie', received: 'Reçu', cancelled: 'Annulé' };
const OPEN = ['draft', 'sent', 'confirmed', 'partial'];

function nextNumber(year) {
  const key = `seq:BC:${year}`;
  const n = (parseInt(settings.get(key), 10) || 0) + 1;
  settings.set(key, n);
  return `BC-${year}-${String(n).padStart(5, '0')}`;
}
const toInt = (v) => { const n = Number(String(v ?? '').replace(/[\s ]/g, '')); return Number.isInteger(n) ? n : NaN; };
const sum = (lines, fn) => lines.reduce((s, l) => s + fn(l), 0);
const total = (lines) => sum(lines, (l) => l.qty * l.unitPrice);
const receivedTotal = (lines) => sum(lines, (l) => (l.received || 0) * l.unitPrice);

/** Fournisseur du bon (Europe : Apple Store, revendeur…) : nom + contact + téléphone, saisis librement. */
function cleanSupplier(input = {}) {
  const name = String(input.name || '').trim().slice(0, 100);
  if (!name) return { error: 'Indiquez le fournisseur (ex. Apple Store, Fnac…)' };
  return { value: { supplierId: null, name, contact: String(input.contact || '').trim().slice(0, 100), phone: String(input.phone || '').replace(/[^\d+ ]/g, '').trim().slice(0, 30) } };
}
function cleanLines(input, supplierId) {
  if (!Array.isArray(input) || !input.length) return { error: 'Ajoutez au moins un article' };
  if (input.length > 200) return { error: '200 articles maximum par bon' };
  const out = [];
  for (const l of input) {
    const p = products.get(l.productId);
    if (!p) return { error: 'Produit introuvable' };
    if (supplierId && p.supplierId && p.supplierId !== supplierId) return { error: `« ${p.name} » appartient à un autre fournisseur` };
    const qty = toInt(l.qty), unitPrice = toInt(l.unitPrice);
    if (!(qty > 0 && qty <= 100000)) return { error: `Quantité invalide pour « ${p.name} »` };
    if (!(unitPrice >= 0 && unitPrice <= 100000000)) return { error: `Prix d'achat invalide pour « ${p.name} »` };
    if (out.some((x) => x.productId === p.id)) return { error: `« ${p.name} » apparaît deux fois` };
    out.push({ productId: p.id, name: p.name, qty, unitPrice, received: 0 });
  }
  return { value: out };
}
function cleanFields(input = {}) {
  const out = {};
  if ('expectedAt' in input) {
    const d = String(input.expectedAt || '').slice(0, 10);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: 'Date de livraison prévue invalide' };
    out.expectedAt = d || null;
  }
  if ('note' in input) out.note = String(input.note || '').trim().slice(0, 1000);
  if ('reference' in input) out.reference = String(input.reference || '').trim().slice(0, 60); // référence chez le fournisseur
  return { value: out };
}
const hist = (p, event, by, note = '') => [...(p.history || []), { event, at: new Date().toISOString(), by: by?.id || null, byName: by?.name || '', note }];

function create(input, by) {
  const s = cleanSupplier(input.supplier || {});
  if (s.error) return s;
  const l = cleanLines(input.lines, s.value.supplierId);
  if (l.error) return l;
  const f = cleanFields(input);
  if (f.error) return f;
  const now = new Date().toISOString();
  const bc = transaction(() => purchases.insert({
    id: 'PO-' + crypto.randomBytes(6).toString('hex'), number: nextNumber(now.slice(0, 4)),
    status: 'draft', supplier: s.value, lines: l.value, expectedAt: null, note: '', reference: '', ...f.value,
    invoice: null, receipts: [], createdAt: now, createdBy: by?.id || null, createdByName: by?.name || '',
    history: [{ event: 'Bon créé', at: now, by: by?.id || null, byName: by?.name || '', note: '' }],
  }));
  return { value: bc };
}
/** Modification : seulement en brouillon (lignes, fournisseur) ; date prévue / note / référence tant que le bon est ouvert. */
function update(bc, input, by) {
  const patch = {};
  if (bc.status === 'draft') {
    if (input.supplier) { const s = cleanSupplier(input.supplier); if (s.error) return s; patch.supplier = s.value; }
    if (input.lines) { const l = cleanLines(input.lines, (patch.supplier || bc.supplier).supplierId); if (l.error) return l; patch.lines = l.value; }
  } else if (input.lines || input.supplier) return { error: 'Les articles et le fournisseur ne se changent plus une fois le bon envoyé (annulez-le et refaites-en un)' };
  if (!OPEN.includes(bc.status)) return { error: 'Ce bon est terminé' };
  const f = cleanFields(input);
  if (f.error) return f;
  Object.assign(patch, f.value);
  return { value: purchases.update(bc.id, { ...patch, history: hist(bc, 'Bon modifié', by) }) };
}
function setStatus(bc, status, by, note = '') {
  const allowed = { draft: ['sent', 'confirmed', 'cancelled'], sent: ['confirmed', 'cancelled'], confirmed: ['cancelled'] };
  if (!allowed[bc.status]?.includes(status)) return { error: `Impossible de passer de « ${STATUS[bc.status]} » à « ${STATUS[status] || status} »` };
  const label = { sent: 'Bon envoyé au fournisseur', confirmed: 'Bon confirmé', cancelled: 'Bon annulé' }[status];
  const extra = status === 'sent' ? { sentAt: new Date().toISOString() } : status === 'confirmed' ? { confirmedAt: new Date().toISOString(), confirmedBy: by?.name || '' } : { cancelledAt: new Date().toISOString(), cancelReason: note };
  return { value: purchases.update(bc.id, { status, ...extra, history: hist(bc, label, by, note) }) };
}

/** Réception : quantités reçues par ligne → stock + coût moyen pondéré. Le suivi de stock commence si le produit n'en avait pas. */
function receive(bc, input, by) {
  if (!['sent', 'confirmed', 'partial', 'draft'].includes(bc.status)) return { error: 'Ce bon ne peut plus recevoir d\'articles' };
  const items = Array.isArray(input.lines) ? input.lines : [];
  const got = [];
  for (const it of items) {
    const line = bc.lines.find((l) => l.productId === it.productId);
    const qty = toInt(it.qty);
    if (!line || !(qty >= 0)) return { error: 'Quantité reçue invalide' };
    const left = line.qty - (line.received || 0);
    if (qty > left) return { error: `« ${line.name} » : ${qty} reçus pour ${left} attendus. Pour un surplus, corrigez le bon ou faites un inventaire.` };
    if (qty > 0) got.push({ line, qty });
  }
  if (!got.length) return { error: 'Indiquez au moins une quantité reçue' };
  const now = new Date().toISOString();
  const value = transaction(() => {
    const lines = bc.lines.map((l) => ({ ...l }));
    for (const { line, qty } of got) {
      const l = lines.find((x) => x.productId === line.productId);
      l.received = (l.received || 0) + qty;
      const p = products.get(l.productId);
      if (p) {
        // Coût moyen pondéré (produits achetés par Zado ; un produit en dépôt-vente garde son prix fournisseur)
        const patch = {};
        if (!p.supplierId) {
          const oldQty = Math.max(0, p.stock || 0), oldCost = Number.isInteger(p.costPrice) ? p.costPrice : l.unitPrice;
          patch.costPrice = Math.round((oldQty * oldCost + qty * l.unitPrice) / (oldQty + qty));
          patch.lastPurchasePrice = l.unitPrice;
        }
        moveStock(l.productId, qty, { reason: 'purchase', ref: bc.number, by, note: `${bc.supplier.name}`, force: true, patch });
      }
    }
    const done = lines.every((l) => (l.received || 0) >= l.qty);
    const receipt = { at: now, by: by?.id || null, byName: by?.name || '', note: String(input.note || '').trim().slice(0, 300), lines: got.map(({ line, qty }) => ({ productId: line.productId, name: line.name, qty })) };
    return purchases.update(bc.id, {
      lines, status: done ? 'received' : 'partial', receivedAt: done ? now : bc.receivedAt || null,
      receipts: [...(bc.receipts || []), receipt],
      history: hist(bc, done ? 'Réception complète' : 'Réception partielle', by, got.map(({ line, qty }) => `${qty} × ${line.name}`).join(', ')),
    });
  });
  return { value };
}

/** Facture du fournisseur (numéro, montant, date, échéance) : ce que Zado doit pour ce bon. */
function setInvoice(bc, input, by) {
  if (bc.status === 'cancelled') return { error: 'Bon annulé' };
  if (input === null) return { value: purchases.update(bc.id, { invoice: null, history: hist(bc, 'Facture fournisseur retirée', by) }) };
  const amount = toInt(input.amount);
  if (!(amount >= 0 && amount <= 1e9)) return { error: 'Montant de la facture invalide' };
  const date = String(input.date || '').slice(0, 10), dueAt = String(input.dueAt || '').slice(0, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Date de facture invalide' };
  if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) return { error: 'Échéance invalide' };
  const invoice = { number: String(input.number || '').trim().slice(0, 60), amount, date: date || new Date().toISOString().slice(0, 10), dueAt: dueAt || null, addedAt: new Date().toISOString() };
  return { value: purchases.update(bc.id, { invoice, history: hist(bc, 'Facture fournisseur enregistrée', by, `${invoice.number || 'sans numéro'} · ${amount} FCFA`) }) };
}

/** Payé pour ce bon : écritures Finances « Achat de marchandises » rattachées (purchaseId). */
const paidFor = (bc) => ledger.all().filter((e) => e.type === 'expense' && e.purchaseId === bc.id).reduce((s, e) => s + e.amount, 0);
/** Dette d'un bon : facture si saisie, sinon valeur reçue (produits achetés par Zado seulement : le dépôt-vente se règle à la vente). */
function owedFor(bc) {
  if (bc.status === 'cancelled') return 0;
  if (bc.invoice) return bc.invoice.amount;
  return sum(bc.lines, (l) => (products.get(l.productId)?.supplierId ? 0 : (l.received || 0) * l.unitPrice));
}
const view = (bc) => {
  const paid = paidFor(bc), owed = owedFor(bc);
  const hasConsigned = bc.lines.some((l) => products.get(l.productId)?.supplierId);
  return {
    ...bc, statusLabel: STATUS[bc.status], total: total(bc.lines), receivedTotal: receivedTotal(bc.lines), paid, owed, due: Math.max(0, owed - paid),
    qty: sum(bc.lines, (l) => l.qty), receivedQty: sum(bc.lines, (l) => l.received || 0), consigned: hasConsigned,
    late: bc.expectedAt && OPEN.includes(bc.status) && bc.status !== 'draft' && bc.expectedAt < new Date().toISOString().slice(0, 10),
  };
};
/** Dettes d'achats par fournisseur (pour Finances) : bons reçus/facturés − paiements rattachés. */
function purchaseDebts() {
  const by = new Map();
  for (const bc of purchases.all()) {
    if (bc.status === 'cancelled') continue;
    const owed = owedFor(bc), paid = paidFor(bc);
    if (!owed && !paid) continue;
    const key = bc.supplier.supplierId || 'ext:' + bc.supplier.name.toLowerCase();
    const cur = by.get(key) || { id: bc.supplier.supplierId || null, name: bc.supplier.name, owed: 0, paid: 0, purchases: [] };
    cur.owed += owed; cur.paid += paid; cur.purchases.push({ id: bc.id, number: bc.number, due: Math.max(0, owed - paid) });
    by.set(key, cur);
  }
  return [...by.values()].map((s) => ({ ...s, due: s.owed - s.paid })).sort((a, b) => b.due - a.due);
}

// ---------- Bon de commande imprimable (A4) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fcfa = (n) => `${Math.round(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Brazzaville', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
let LOGO = null;
const logo = () => {
  if (LOGO === null) { try { LOGO = fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'logo-zado.svg'), 'utf8').replace(/<\?xml[^>]*>/, ''); } catch { LOGO = '<strong>Zado</strong>'; } }
  return LOGO;
};
function render(bc, company) {
  const c = company;
  const todo = (v) => (v ? esc(v) : '<span class="todo">À compléter</span>');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Bon de commande ${esc(bc.number)} — ${esc(c.name)}</title>
<style>
@font-face { font-family: "Plus Jakarta Sans"; src: url(/fonts/plus-jakarta-sans-latin-wght-normal.woff2) format("woff2"); font-weight: 200 800; }
* { box-sizing: border-box; } body { margin: 0; font-family: "Plus Jakarta Sans", Arial, sans-serif; color: #1B1530; background: #EEEAF7; font-size: 13px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.bar { position: sticky; top: 0; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #2D1B69; }
.bar button { font: inherit; font-weight: 600; border: 0; border-radius: 999px; padding: 8px 16px; cursor: pointer; background: #FFB300; color: #2D1B69; }
.sheet { background: #fff; margin: 20px auto; padding: 36px 40px; width: 210mm; max-width: calc(100% - 24px); min-height: 280mm; box-shadow: 0 10px 40px rgba(45,27,105,.15); position: relative; }
.sheet::before { content: ""; position: absolute; inset: 0 0 auto; height: 6px; background: linear-gradient(90deg, #2D1B69, #FF5A3C, #FFB300); }
.head { display: flex; justify-content: space-between; gap: 20px; } .logo svg { height: 34px; width: auto; display: block; margin-bottom: 8px; }
.co p { margin: 0; color: #4A4466; font-size: 12px; } .doc { text-align: right; } .doc h1 { margin: 0; font-size: 24px; color: #2D1B69; text-transform: uppercase; }
.doc .num { font-size: 15px; font-weight: 700; } .doc .date { color: #6B6585; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 26px 0 18px; } .parties > div { background: #F6F4FC; border-radius: 12px; padding: 12px 14px; }
.lbl { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6B6585; margin-bottom: 4px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #fff; background: #2D1B69; padding: 8px 10px; }
th:first-child { border-radius: 8px 0 0 8px; } th:last-child { border-radius: 0 8px 8px 0; } td { padding: 9px 10px; border-bottom: 1px solid #ECE9F5; vertical-align: top; }
.n { text-align: right; white-space: nowrap; } .grand td { font-size: 16px; font-weight: 700; color: #2D1B69; border-top: 2px solid #2D1B69; border-bottom: 0; }
.note { margin: 18px 0 0; padding: 12px 14px; border-radius: 12px; background: #FFF1CC; } .todo { background: #FFF1CC; color: #8A5A00; padding: 0 4px; border-radius: 4px; }
.foot { position: absolute; left: 40px; right: 40px; bottom: 24px; border-top: 1px solid #ECE9F5; padding-top: 10px; color: #6B6585; font-size: 11px; display: flex; justify-content: space-between; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 40px; } .sign div { border-top: 1px solid #1B1530; padding-top: 6px; font-size: 12px; color: #6B6585; }
@media (max-width: 760px) { .sheet { padding: 24px 18px 90px; min-height: 0; } .head { flex-direction: column; } .doc { text-align: left; } .parties { grid-template-columns: 1fr; } }
@media print { body { background: #fff; } .bar { display: none; } .sheet { margin: 0; box-shadow: none; width: auto; max-width: none; min-height: 0; } @page { size: A4; margin: 12mm; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
<div class="sheet">
  <div class="head"><div class="co"><div class="logo">${logo()}</div><p><strong>${esc(c.name)}</strong>${c.legalForm ? ` — ${esc(c.legalForm)}` : ''}<br>${todo(c.address)}${c.city ? `, ${esc(c.city)}` : ''} — ${esc(c.country)}<br>RCCM : ${todo(c.rccm)} · NIU : ${todo(c.niu)}<br>Tél. : ${todo(c.phone)}${c.email ? ` · ${esc(c.email)}` : ''}</p></div>
    <div class="doc"><h1>Bon de commande</h1><div class="num">N° ${esc(bc.number)}</div><div class="date">Du ${dateFr(bc.sentAt || bc.createdAt)}</div>${bc.expectedAt ? `<div class="date">Livraison souhaitée : ${dateFr(bc.expectedAt)}</div>` : ''}</div></div>
  <div class="parties">
    <div><span class="lbl">Fournisseur</span><strong>${esc(bc.supplier.name)}</strong>${bc.supplier.contact && bc.supplier.contact !== bc.supplier.name ? `<br>${esc(bc.supplier.contact)}` : ''}${bc.supplier.phone ? `<br>${esc(bc.supplier.phone)}` : ''}${bc.reference ? `<br>Votre référence : ${esc(bc.reference)}` : ''}</div>
    <div><span class="lbl">Livrer à</span><strong>${esc(c.name)}</strong><br>${todo(c.address)}${c.city ? `, ${esc(c.city)}` : ''}<br>${todo(c.phone)}</div>
  </div>
  <table><thead><tr><th>Article</th><th class="n">Quantité</th><th class="n">Prix unitaire</th><th class="n">Total</th></tr></thead><tbody>
    ${bc.lines.map((l) => `<tr><td>${esc(l.name)}<br><small style="color:#6B6585">réf. ${esc(l.productId)}</small></td><td class="n">${l.qty}</td><td class="n">${fcfa(l.unitPrice)}</td><td class="n">${fcfa(l.qty * l.unitPrice)}</td></tr>`).join('')}
    <tr class="grand"><td colspan="3">Total</td><td class="n">${fcfa(total(bc.lines))}</td></tr></tbody></table>
  ${bc.note ? `<div class="note">${esc(bc.note).replace(/\n/g, '<br>')}</div>` : ''}
  <div class="sign"><div>Pour ${esc(c.name)}${bc.createdByName ? ` — ${esc(bc.createdByName)}` : ''}</div><div>Bon pour accord, le fournisseur</div></div>
  <div class="foot"><span>Merci de confirmer ce bon et d'indiquer la date de livraison.</span><span>${esc(c.name)} · ${esc(bc.number)}</span></div>
</div></body></html>`;
}

module.exports = { STATUS, OPEN, create, update, setStatus, receive, setInvoice, view, paidFor, owedFor, purchaseDebts, render, total };
