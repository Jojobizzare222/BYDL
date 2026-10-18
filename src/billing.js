// Factures, reçus et avoirs (ERP, étape 1 — décision Joseph 17/10/2026).
// Chaque document est créé AUTOMATIQUEMENT à partir des commandes (sync) :
//   - REÇU (RC-) à chaque argent reçu : paiement complet (espèces en agence, Mobile Money, carte), acompte, reste payé à la livraison ;
//   - FACTURE (FA-) quand la vente est réalisée (payée ; livrée pour le paiement à la réception) ;
//   - AVOIR (AV-) quand une commande facturée est annulée.
// Numérotation CONTINUE par année et par type (FA-2026-00001…), jamais réutilisée ; un document émis n'est JAMAIS
// modifié ni supprimé (le nom de la société, les lignes et les montants sont figés à l'émission).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, settings, transaction, orders, payments, staff, documents } = require('./store');

const TYPES = {
  invoice: { prefix: 'FA', label: 'Facture' },
  receipt: { prefix: 'RC', label: 'Reçu' },
  credit: { prefix: 'AV', label: 'Avoir' },
};
const METHOD_LABEL = { cash: 'Espèces', momo: 'Mobile Money', card: 'Carte bancaire' };
const OPERATOR_METHOD = { mtn: 'momo', airtel: 'momo', card: 'card', cash: 'cash' };
const OPERATOR_LABEL = { mtn: 'MTN Mobile Money', airtel: 'Airtel Money', card: 'Carte bancaire', cash: 'Espèces' };

// ---------- Société (en-tête des documents) — Zado Pro → Réglages [admin] ----------
const TODO = 'À compléter';
const COMPANY_DEFAULTS = {
  name: 'Zado', legalForm: '', capital: '', rccm: '', niu: '',
  address: '', city: 'Pointe-Noire', country: 'République du Congo', phone: '', email: '', website: 'zado.cg',
  vatEnabled: false, vatRate: 18, vatExtra: 5, // TVA 18 % + centime additionnel (5 % de la TVA) : à confirmer par le comptable
  vatNote: 'Prix toutes taxes comprises.',
  footer: 'Merci pour votre confiance. Conservez ce document : il vous sera demandé pour tout retour ou garantie.',
};
const COMPANY_FIELDS = Object.keys(COMPANY_DEFAULTS);
function company() {
  let saved = {};
  try { saved = JSON.parse(settings.get('company') || '{}'); } catch {}
  return { ...COMPANY_DEFAULTS, ...saved };
}
function saveCompany(input = {}) {
  const cur = company();
  const out = { ...cur };
  for (const k of COMPANY_FIELDS) {
    if (!(k in input)) continue;
    if (k === 'vatEnabled') out[k] = input[k] === true;
    else if (k === 'vatRate' || k === 'vatExtra') {
      const n = Number(String(input[k]).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 50) return { error: 'Taux de TVA invalide' };
      out[k] = Math.round(n * 100) / 100;
    } else out[k] = String(input[k] ?? '').trim().slice(0, k === 'footer' || k === 'vatNote' ? 300 : 120);
  }
  if (!out.name) return { error: 'Le nom de la société est obligatoire' };
  settings.set('company', JSON.stringify(out));
  return { company: out };
}
const missingCompany = (c = company()) => ['legalForm', 'rccm', 'niu', 'address', 'phone'].filter((k) => !c[k]);

// ---------- Montant en lettres (français, francs CFA) ----------
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
function below100(n) {
  if (n <= 16) return UNITS[n];
  if (n < 20) return 'dix-' + UNITS[n - 10];
  if (n < 70) { const t = Math.floor(n / 10), u = n % 10; return TENS[t] + (u === 0 ? '' : u === 1 ? '-et-un' : '-' + UNITS[u]); }
  if (n < 80) return n === 71 ? 'soixante-et-onze' : 'soixante-' + below100(n - 60);
  if (n === 80) return 'quatre-vingts';
  return 'quatre-vingt-' + below100(n - 80);
}
function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  if (!h) return below100(r);
  const head = h === 1 ? 'cent' : UNITS[h] + '-cent' + (r === 0 ? 's' : '');
  return r ? head + '-' + below100(r) : head;
}
function inWords(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'zéro';
  const parts = [];
  for (const [value, one, many] of [[1e9, 'un-milliard', 'milliards'], [1e6, 'un-million', 'millions']]) {
    const q = Math.floor(n / value);
    if (q) { parts.push(q === 1 ? one : below1000(q) + '-' + many); n %= value; }
  }
  const th = Math.floor(n / 1000);
  if (th) { parts.push(th === 1 ? 'mille' : below1000(th).replace(/(cent|vingt)s$/, '$1') + '-mille'); n %= 1000; }
  if (n) parts.push(below1000(n));
  return parts.join('-'); // orthographe rectifiée de 1990 : tous les nombres reliés par des traits d'union
}
const amountInWords = (n) => { const w = inWords(n); return w.charAt(0).toUpperCase() + w.slice(1) + ' francs CFA'; };

// ---------- TVA (prix TTC → HT + TVA + centime additionnel) ----------
function taxes(totalTtc, c) {
  if (!c.vatEnabled || !c.vatRate) return null;
  const rate = c.vatRate / 100, extra = (c.vatExtra || 0) / 100;
  const ht = Math.round(totalTtc / (1 + rate * (1 + extra)));
  const vat = Math.round(ht * rate);
  return { ht, vat, extra: totalTtc - ht - vat, rate: c.vatRate, extraRate: c.vatExtra };
}

// ---------- Numérotation continue ----------
function nextNumber(type, year) {
  const key = `seq:${TYPES[type].prefix}:${year}`;
  const n = (parseInt(settings.get(key), 10) || 0) + 1;
  settings.set(key, n);
  return `${TYPES[type].prefix}-${year}-${String(n).padStart(5, '0')}`;
}
const byKeyStmt = () => db.prepare("SELECT data FROM documents WHERE json_extract(data, '$.key') = ?");
const byOrderStmt = () => db.prepare("SELECT data FROM documents WHERE json_extract(data, '$.orderId') = ? ORDER BY rowid");
const findByKey = (key) => { const r = byKeyStmt().get(key); return r ? JSON.parse(r.data) : null; };
const forOrder = (orderId) => byOrderStmt().all(orderId).map((r) => JSON.parse(r.data));

const snapshotCustomer = (o) => ({ name: o.customer?.name || '', phone: o.customer?.phone || '', city: o.customer?.city || '', address: o.customer?.address || '' });
const snapshotLines = (o) => (o.lines || []).map((l) => ({
  name: l.name || l.title || 'Article',
  variant: l.variant ? Object.entries(l.variant).map(([k, v]) => `${k} : ${v}`).join(', ') : '',
  qty: l.qty || 1, unitPrice: l.unitPrice ?? l.price ?? 0, total: l.total ?? (l.unitPrice || 0) * (l.qty || 1),
}));
const staffName = (id) => (id === 'admin' ? 'Administrateur' : (id && staff.get(id)?.name) || null);

/** Crée un document (une seule fois par clé), avec son numéro, dans une transaction. */
function issue(type, key, order, fields) {
  const existing = findByKey(key);
  if (existing) return existing;
  const at = fields.issuedAt || new Date().toISOString();
  const run = () => {
    if (findByKey(key)) return findByKey(key);
    const c = company();
    const doc = {
      id: 'DOC-' + crypto.randomBytes(6).toString('hex'),
      type, key, number: nextNumber(type, at.slice(0, 4)),
      orderId: order.id, customerId: order.customerId || null,
      token: crypto.randomBytes(12).toString('hex'), // lien de partage (WhatsApp) : seul celui qui a le lien voit le document
      issuedAt: at,
      customer: snapshotCustomer(order),
      company: Object.fromEntries(COMPANY_FIELDS.map((k) => [k, c[k]])),
      ...fields,
      createdAt: new Date().toISOString(),
    };
    documents.insert(doc);
    return doc;
  };
  return transaction(run);
}

const isSold = (o) => (o.paymentPlan === 'cod' ? o.status === 'delivered' : ['paid', 'shipped', 'delivered'].includes(o.status));

/** Met les documents d'une commande à jour (idempotent : ne crée que ce qui manque). */
function sync(orderOrId) {
  const o = typeof orderOrId === 'string' ? orders.get(orderOrId) : orderOrId;
  if (!o || !o.lines) return [];
  const pay = o.paymentId && payments.get(o.paymentId);
  const lines = snapshotLines(o);
  const base = { lines, subtotal: o.subtotal ?? o.total, deliveryFee: o.deliveryFee || 0, total: o.total };
  const agency = o.agency ? { name: o.agency.name || '', city: o.agency.city || '' } : null;

  // 1) Facture (vente réalisée)
  let invoice = findByKey(`${o.id}:invoice`);
  if (!invoice && isSold(o)) {
    const saleAt = o.paymentPlan === 'cod' ? (o.deliveredAt || o.updatedAt) : (o.paidAt || o.updatedAt);
    const method = o.paymentPlan === 'cod' ? 'cod' : OPERATOR_METHOD[pay?.operator] || 'momo';
    invoice = issue('invoice', `${o.id}:invoice`, o, {
      ...base, saleAt, taxes: taxes(o.total, company()),
      paymentLabel: o.paymentPlan === 'cod' ? 'Payée à la réception' : `Payée — ${OPERATOR_LABEL[pay?.operator] || METHOD_LABEL[method] || 'Mobile Money'}`,
      fulfillment: o.fulfillment || 'delivery', agency,
    });
  }

  // 2) Reçus : chaque somme reçue
  const receipt = (kind, amount, method, at, extra = {}) => amount > 0 && issue('receipt', `${o.id}:${kind}`, o, {
    purpose: kind, amount, method, methodLabel: extra.operator ? OPERATOR_LABEL[extra.operator] : METHOD_LABEL[method] || method,
    receivedAt: at, issuedAt: at, total: o.total, invoiceNumber: invoice?.number || null, agency: method === 'cash' && kind === 'pay' ? agency : null,
    collectedBy: extra.collectedBy || null, lines,
  });
  if (o.paymentPlan !== 'cod') {
    if (pay && pay.status === 'SUCCESSFUL' && (o.paidAt || o.paidAfterCancel)) {
      receipt('pay', o.total, OPERATOR_METHOD[pay.operator] || 'momo', o.paidAt || pay.confirmedAt || pay.updatedAt, { operator: pay.operator, collectedBy: pay.confirmedBy || null });
    }
  } else {
    if (o.depositPaidAt && o.deposit) {
      const dp = o.depositPaymentId && payments.get(o.depositPaymentId);
      receipt('deposit', o.deposit, OPERATOR_METHOD[dp?.operator] || 'momo', o.depositPaidAt, { operator: dp?.operator });
    }
    if (o.balancePaid && o.balance) {
      receipt('balance', o.balance, o.balancePaid.method === 'cash' ? 'cash' : 'momo', o.balancePaid.at, { collectedBy: staffName(o.balancePaid.by) });
    }
  }

  // 3) Avoir : vente facturée puis annulée
  if (invoice && o.status === 'cancelled') {
    issue('credit', `${o.id}:credit`, o, {
      ...base, invoiceNumber: invoice.number, taxes: invoice.taxes || null,
      reason: o.depositRetained ? 'Colis refusé à la livraison' : 'Commande annulée',
      refund: o.refundedAt ? 'Remboursé' : 'Remboursement à effectuer',
    });
  }
  return forOrder(o.id);
}

/** Toutes les commandes, dans l'ordre chronologique (numéros dans l'ordre des ventes). */
function syncAll() {
  const list = orders.all().sort((a, b) => String(a.paidAt || a.createdAt).localeCompare(String(b.paidAt || b.createdAt)));
  for (const o of list) { try { sync(o); } catch (err) { console.error('[documents]', o.id, err.message); } }
}

/** Après chaque modification d'une commande : documents mis à jour (hors de la transaction en cours). */
function watchOrders() {
  if (orders._billingWatched) return;
  const orig = orders.update.bind(orders);
  orders.update = (id, patch) => {
    const out = orig(id, patch);
    if (out) queueMicrotask(() => { try { sync(id); } catch (err) { console.error('[documents]', id, err.message); } });
    return out;
  };
  orders._billingWatched = true;
}

/** Version publique (client) : sans le jeton ni la note interne. */
const publicDoc = (d) => ({ id: d.id, type: d.type, label: TYPES[d.type].label, number: d.number, issuedAt: d.issuedAt, amount: d.type === 'receipt' ? d.amount : d.total, link: `/api/documents/${d.id}?k=${d.token}` });

// ---------- Mise en page (A4 ou ticket 80 mm) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fcfa = (n) => `${Math.round(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const dateFr = (iso, time) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Brazzaville', day: '2-digit', month: '2-digit', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }) : '');
let LOGO = null;
const logo = () => {
  if (LOGO === null) { try { LOGO = fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'logo-zado.svg'), 'utf8').replace(/<\?xml[^>]*>/, ''); } catch { LOGO = '<strong>Zado</strong>'; } }
  return LOGO;
};
const todo = (v) => (v ? esc(v) : `<span class="todo">${TODO}</span>`);
const PURPOSE = { pay: 'Règlement de la commande', deposit: 'Acompte sur la commande', balance: 'Solde payé à la livraison de la commande' };

function companyBlock(c) {
  return `<div class="co"><div class="logo">${logo()}</div>
    <p><strong>${esc(c.name)}</strong>${c.legalForm ? ` — ${esc(c.legalForm)}` : ''}${c.capital ? ` au capital de ${esc(c.capital)}` : ''}<br>
    ${todo(c.address)}${c.city ? `, ${esc(c.city)}` : ''} — ${esc(c.country)}<br>
    RCCM : ${todo(c.rccm)} · NIU : ${todo(c.niu)}<br>
    Tél. : ${todo(c.phone)}${c.email ? ` · ${esc(c.email)}` : ''}${c.website ? ` · ${esc(c.website)}` : ''}</p></div>`;
}
function linesTable(d) {
  return `<table class="lines"><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unitaire</th><th class="n">Total</th></tr></thead><tbody>
    ${d.lines.map((l) => `<tr><td>${esc(l.name)}${l.variant ? `<br><small>${esc(l.variant)}</small>` : ''}</td><td class="n">${l.qty}</td><td class="n">${fcfa(l.unitPrice)}</td><td class="n">${fcfa(l.total)}</td></tr>`).join('')}
    </tbody></table>`;
}
function totalsBlock(d, sign = '') {
  const t = d.taxes;
  return `<table class="totals">
    ${d.deliveryFee ? `<tr><td>Sous-total</td><td>${sign}${fcfa(d.subtotal)}</td></tr><tr><td>Livraison</td><td>${sign}${fcfa(d.deliveryFee)}</td></tr>` : ''}
    ${t ? `<tr><td>Total hors taxes</td><td>${sign}${fcfa(t.ht)}</td></tr><tr><td>TVA ${t.rate} %</td><td>${sign}${fcfa(t.vat)}</td></tr>${t.extra ? `<tr><td>Centime additionnel ${t.extraRate} %</td><td>${sign}${fcfa(t.extra)}</td></tr>` : ''}` : ''}
    <tr class="grand"><td>Total ${t ? 'TTC' : ''}</td><td>${sign}${fcfa(d.total)}</td></tr></table>`;
}

function render(d, { format = 'a4', admin = false } = {}) {
  const c = d.company || company();
  const T = TYPES[d.type];
  const ticket = format === 'ticket';
  const title = d.type === 'receipt' ? 'Reçu de paiement' : T.label;
  let body = '';
  if (d.type === 'receipt') {
    body = `<div class="big"><span>Montant reçu</span><strong>${fcfa(d.amount)}</strong><em>${esc(amountInWords(d.amount))}</em></div>
      <table class="kv">
        <tr><td>Reçu de</td><td><strong>${esc(d.customer.name)}</strong>${d.customer.phone ? ` · ${esc(d.customer.phone)}` : ''}</td></tr>
        <tr><td>Pour</td><td>${esc(PURPOSE[d.purpose] || 'Commande')} <strong>${esc(d.orderId)}</strong>${d.invoiceNumber ? ` (facture ${esc(d.invoiceNumber)})` : ''}${d.purpose !== 'pay' ? ` — total de la commande ${fcfa(d.total)}` : ''}</td></tr>
        <tr><td>Mode de paiement</td><td>${esc(d.methodLabel)}</td></tr>
        <tr><td>Date</td><td>${dateFr(d.receivedAt, true)}</td></tr>
        ${d.agency ? `<tr><td>Point relais</td><td>${esc(d.agency.name)}${d.agency.city ? ` — ${esc(d.agency.city)}` : ''}</td></tr>` : ''}
        ${d.collectedBy ? `<tr><td>Encaissé par</td><td>${esc(d.collectedBy)}</td></tr>` : ''}
      </table>
      ${ticket ? '' : `<h3>Détail de la commande</h3>${linesTable(d)}`}`;
  } else {
    const credit = d.type === 'credit';
    body = `<div class="parties">
        <div><span class="lbl">${credit ? 'Avoir établi pour' : 'Facturé à'}</span><strong>${esc(d.customer.name)}</strong><br>${esc(d.customer.phone)}${d.customer.address ? `<br>${esc(d.customer.address)}` : ''}${d.customer.city ? `<br>${esc(d.customer.city)}` : ''}</div>
        <div><span class="lbl">Références</span>Commande <strong>${esc(d.orderId)}</strong><br>${credit ? `Annule la facture <strong>${esc(d.invoiceNumber)}</strong><br>Motif : ${esc(d.reason)}` : `Date de la vente : ${dateFr(d.saleAt)}<br>${esc(d.paymentLabel)}`}${d.agency ? `<br>Point relais : ${esc(d.agency.name)}` : ''}</div>
      </div>
      ${linesTable(d)}${totalsBlock(d, credit ? '− ' : '')}
      <p class="words">${credit ? 'Arrêté le présent avoir' : 'Arrêtée la présente facture'} à la somme de : <strong>${esc(amountInWords(d.total))}</strong>.</p>
      ${credit ? `<p class="note">${esc(d.refund)}.</p>` : ''}
      ${!d.taxes && c.vatNote ? `<p class="note">${esc(c.vatNote)}</p>` : ''}`;
  }
  const missing = missingCompany(c).length;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} ${esc(d.number)} — ${esc(c.name)}</title>
<style>
@font-face { font-family: "IBM Plex Sans"; src: url(/fonts/ibm-plex-sans-latin-wght-normal.woff2) format("woff2"); font-weight: 100 700; }
@font-face { font-family: "IBM Plex Sans"; src: url(/fonts/ibm-plex-sans-latin-ext-wght-normal.woff2) format("woff2"); font-weight: 100 700; unicode-range: U+0100-024F, U+1E00-1EFF, U+20A0-20CF, U+2C60-2C7F, U+A720-A7FF; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "IBM Plex Sans", Arial, sans-serif; color: #1B1530; background: #EEEAF7; font-size: 13px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.bar { position: sticky; top: 0; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; padding: 10px; background: #2D1B69; }
.bar a, .bar button { font: inherit; font-weight: 600; color: #fff; background: rgba(255,255,255,.12); border: 0; border-radius: 999px; padding: 8px 16px; text-decoration: none; cursor: pointer; }
.bar .main { background: #FFB300; color: #2D1B69; }
.sheet { background: #fff; margin: 20px auto; padding: 36px 40px; width: 210mm; max-width: calc(100% - 24px); min-height: 280mm; box-shadow: 0 10px 40px rgba(45,27,105,.15); position: relative; overflow: hidden; }
.sheet::before { content: ""; position: absolute; inset: 0 0 auto; height: 6px; background: linear-gradient(90deg, #2D1B69, #FF5A3C, #FFB300); }
.head { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
.logo svg { height: 34px; width: auto; display: block; margin-bottom: 8px; }
.co p { margin: 0; color: #4A4466; font-size: 12px; }
.doc { text-align: right; }
.doc h1 { margin: 0; font-size: 26px; letter-spacing: .02em; color: #2D1B69; text-transform: uppercase; }
.doc .num { font-size: 15px; font-weight: 700; margin-top: 2px; } .doc .date { color: #6B6585; }
.stamp { display: inline-block; margin-top: 8px; padding: 4px 12px; border-radius: 999px; font-weight: 700; font-size: 12px; background: #E1F5EC; color: #0E8A66; }
.stamp.credit { background: #FFE6DF; color: #C62E1F; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 28px 0 20px; }
.parties > div { background: #F6F4FC; border-radius: 12px; padding: 12px 14px; }
.lbl { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6B6585; margin-bottom: 4px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; }
.lines th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #fff; background: #2D1B69; padding: 8px 10px; }
.lines th:first-child { border-radius: 8px 0 0 8px; } .lines th:last-child { border-radius: 0 8px 8px 0; }
.lines td { padding: 9px 10px; border-bottom: 1px solid #ECE9F5; vertical-align: top; } .lines small { color: #6B6585; }
.n, .lines th.n { text-align: right; white-space: nowrap; }
.totals { width: 300px; margin: 14px 0 0 auto; } .totals td { padding: 5px 10px; } .totals td:last-child { text-align: right; white-space: nowrap; }
.totals .grand td { font-size: 16px; font-weight: 700; color: #2D1B69; border-top: 2px solid #2D1B69; padding-top: 8px; }
.words { margin: 22px 0 6px; } .note { color: #6B6585; margin: 4px 0; }
.big { margin: 28px 0 18px; padding: 18px; border-radius: 14px; background: linear-gradient(135deg, #2D1B69, #4B2FB0); color: #fff; text-align: center; }
.big span { display: block; opacity: .8; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
.big strong { display: block; font-size: 30px; margin: 4px 0; } .big em { font-style: normal; color: #FFD27A; }
.kv td { padding: 7px 0; border-bottom: 1px solid #ECE9F5; vertical-align: top; } .kv td:first-child { color: #6B6585; width: 170px; }
h3 { margin: 24px 0 8px; font-size: 13px; color: #2D1B69; }
.foot { position: absolute; left: 40px; right: 40px; bottom: 24px; border-top: 1px solid #ECE9F5; padding-top: 10px; color: #6B6585; font-size: 11px; display: flex; justify-content: space-between; gap: 12px; }
.todo { background: #FFF1CC; color: #8A5A00; padding: 0 4px; border-radius: 4px; }
.warn { max-width: 210mm; margin: 12px auto 0; padding: 10px 14px; border-radius: 10px; background: #FFF1CC; color: #8A5A00; font-size: 12px; }
/* Ticket de caisse 80 mm */
body.ticket .sheet { width: 80mm; min-height: 0; padding: 14px 12px 18px; font-size: 11.5px; }
body.ticket .head { display: block; text-align: center; } body.ticket .logo svg { margin: 0 auto 6px; height: 26px; }
body.ticket .co p { font-size: 10.5px; } body.ticket .doc { text-align: center; margin-top: 10px; } body.ticket .doc h1 { font-size: 16px; }
body.ticket .parties { grid-template-columns: 1fr; gap: 8px; margin: 12px 0; } body.ticket .totals { width: 100%; }
body.ticket .lines th:nth-child(3), body.ticket .lines td:nth-child(3) { display: none; }
body.ticket .big { margin: 12px 0; padding: 10px; } body.ticket .big strong { font-size: 22px; }
body.ticket .kv td:first-child { width: 90px; } body.ticket .foot { position: static; display: block; text-align: center; margin-top: 14px; } body.ticket .foot span { display: block; }
@media (max-width: 760px) { .sheet { padding: 24px 18px 90px; min-height: 0; } .head { flex-direction: column; } .doc { text-align: left; } .parties { grid-template-columns: 1fr; } .totals { width: 100%; } }
@media print {
  body { background: #fff; } .bar, .warn { display: none; }
  .sheet { margin: 0; box-shadow: none; width: auto; max-width: none; min-height: 0; }
  @page { size: A4; margin: 12mm; }
  body.ticket { width: 80mm; } body.ticket .sheet::before { display: none; }
}
${ticket ? '@media print { @page { size: 80mm auto; margin: 3mm; } }' : ''}
</style></head>
<body class="${ticket ? 'ticket' : ''}">
<div class="bar"><button class="main" onclick="window.print()">Imprimer / Enregistrer en PDF</button>
  <a href="?${new URLSearchParams({ ...(admin ? {} : { k: d.token }), format: ticket ? 'a4' : 'ticket' })}">${ticket ? 'Format A4' : 'Format ticket (80 mm)'}</a></div>
${admin && missing ? `<div class="warn">Informations de la société incomplètes (RCCM, NIU, adresse…) : à remplir dans Zado Pro → Réglages → « Société ». Ce document les gardera telles qu'au jour de son émission.</div>` : ''}
<div class="sheet">
  <div class="head">${companyBlock(c)}
    <div class="doc"><h1>${esc(title)}</h1><div class="num">N° ${esc(d.number)}</div><div class="date">Émis le ${dateFr(d.issuedAt, d.type === 'receipt')}</div>
      ${d.type === 'invoice' ? `<span class="stamp">${d.paymentLabel?.startsWith('Payée à la') ? 'Payée' : 'Acquittée'}</span>` : d.type === 'credit' ? '<span class="stamp credit">Avoir</span>' : '<span class="stamp">Payé</span>'}</div></div>
  ${body}
  <div class="foot"><span>${esc(c.footer)}</span><span>${esc(c.name)} · ${esc(d.number)}</span></div>
</div></body></html>`;
}

module.exports = { TYPES, company, saveCompany, missingCompany, amountInWords, inWords, taxes, sync, syncAll, watchOrders, forOrder, publicDoc, render, isSold };
