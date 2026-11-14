// Écosystème d'alertes de Zado (demande Joseph 12/11/2026 : « des notifications mail pour chaque nouvelle demande client,
// chaque étape de commande… pour que je reste toujours à l'affût »).
// Principe : le serveur signale déjà CHAQUE changement de la base (src/events.js, avec l'état avant/après). Ce module écoute
// ces signaux, reconnaît les moments importants (nouveau client, pièce à vérifier, commande, dépôt attendu, paiement, livreur,
// livraison, annulation, message client, avis, stock bas, dépense récurrente…) et :
//   1) les garde dans un historique (collection `alerts`, visible dans Zado Pro → Notifications) ;
//   2) les envoie par e-mail aux adresses choisies, REGROUPÉES (une rafale = un seul e-mail) ; les URGENTES partent tout de
//      suite (dépôt à vérifier, pièce d'identité, client qui demande un conseiller, livraison ratée, paiement sur commande
//      annulée) ;
//   3) envoient chaque matin (7 h, heure du Congo) un RÉSUMÉ : chiffres de la veille et liste de ce qui attend.
// Chaque type se coupe dans Zado Pro. Jamais de photo de pièce d'identité, de code client ni de code de livraison dans un e-mail.
// Sans réglages SMTP (.env), rien ne part : l'alerte est notée « e-mail non configuré » dans l'historique.
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const config = require('./config');
const store = require('./store');
const { settings } = store;

const fcfa = (n) => `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(n) || 0)).replace(/[  ]/g, ' ')} FCFA`;
const congoNow = () => new Date(Date.now() + 3600e3); // UTC+1
const congoDay = () => congoNow().toISOString().slice(0, 10);
const admin = (hash) => `${config.publicUrl}/admin/${hash}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Catalogue des alertes ----------
const CATEGORIES = { clients: 'Clients', commandes: 'Commandes', paiements: 'Paiements', livraison: 'Logistique et livraison', messagerie: 'Messagerie', catalogue: 'Catalogue et stock', finances: 'Finances', resume: 'Résumé' };
const TYPES = {
  'customer.new': { cat: 'clients', label: 'Nouveau client inscrit' },
  'customer.identity': { cat: 'clients', label: "Pièce d'identité à vérifier", urgent: true },
  'order.new': { cat: 'commandes', label: 'Nouvelle commande (en attente de paiement)' },
  'order.cancelled': { cat: 'commandes', label: 'Commande annulée' },
  'order.relay': { cat: 'commandes', label: 'Point relais changé par le client' },
  'payment.transfer': { cat: 'paiements', label: 'Dépôt Mobile Money attendu : à vérifier', urgent: true },
  'order.confirmed': { cat: 'paiements', label: 'Acompte reçu : commande confirmée' },
  'order.paid': { cat: 'paiements', label: 'Commande payée' },
  'order.reservation': { cat: 'paiements', label: 'Réservation à payer au point relais' },
  'order.paidAfterCancel': { cat: 'paiements', label: 'Paiement reçu sur une commande annulée (à rembourser)', urgent: true },
  'order.logistics': { cat: 'livraison', label: 'Logistique : achetée, dans l\'avion, arrivée' },
  'order.planned': { cat: 'livraison', label: 'Livraison planifiée ou déplacée' },
  'order.shipped': { cat: 'livraison', label: 'Commande confiée au livreur' },
  'order.delivered': { cat: 'livraison', label: 'Commande livrée' },
  'order.failed': { cat: 'livraison', label: 'Livraison ratée', urgent: true },
  'chat.human': { cat: 'messagerie', label: 'Un client demande un conseiller', urgent: true },
  'chat.message': { cat: 'messagerie', label: 'Nouveau message d\'un client' },
  'review.new': { cat: 'catalogue', label: 'Nouvel avis client' },
  'product.pending': { cat: 'catalogue', label: 'Produit proposé à valider' },
  'stock.low': { cat: 'catalogue', label: 'Stock bas ou rupture' },
  'finance.recurring': { cat: 'finances', label: 'Dépense récurrente enregistrée' },
  'daily.digest': { cat: 'resume', label: 'Résumé quotidien (chaque matin)' },
};

// ---------- Réglages ----------
const KEY = 'alerts:settings';
const DEFAULTS = { to: [], types: {}, digestHour: 7, batchSeconds: 60, lowStock: 3 };
function getSettings() {
  let v = {}; try { v = JSON.parse(settings.get(KEY) || '{}'); } catch {}
  const s = { ...DEFAULTS, ...v };
  if (!s.to.length && config.smtp.to) s.to = String(config.smtp.to).split(/[,;\s]+/).filter(Boolean);
  for (const k of Object.keys(TYPES)) if (typeof s.types[k] !== 'boolean') s.types[k] = true; // tout est actif par défaut
  return s;
}
const isEmail = (e) => /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e);
function saveSettings(input = {}) {
  const s = getSettings();
  if ('to' in input) {
    const list = (Array.isArray(input.to) ? input.to : String(input.to || '').split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    const bad = list.find((e) => !isEmail(e));
    if (bad) return { error: `Adresse e-mail invalide : ${bad}` };
    if (list.length > 5) return { error: '5 adresses au maximum' };
    s.to = [...new Set(list)];
  }
  if (input.types && typeof input.types === 'object') for (const [k, v] of Object.entries(input.types)) if (TYPES[k]) s.types[k] = Boolean(v);
  if ('digestHour' in input) { const h = Math.round(Number(input.digestHour)); if (!(h >= 0 && h <= 23)) return { error: 'Heure du résumé : 0 à 23' }; s.digestHour = h; }
  if ('batchSeconds' in input) { const b = Math.round(Number(input.batchSeconds)); if (!(b >= 0 && b <= 900)) return { error: 'Regroupement : 0 à 900 secondes' }; s.batchSeconds = b; }
  if ('lowStock' in input) { const l = Math.round(Number(input.lowStock)); if (!(l >= 0 && l <= 100)) return { error: 'Seuil de stock bas : 0 à 100' }; s.lowStock = l; }
  settings.set(KEY, JSON.stringify(s));
  return { value: s };
}

// ---------- Envoi des e-mails ----------
const smtp = config.smtp;
const smtpReady = () => Boolean(smtp.host && smtp.user && smtp.pass);
let transport = null;
const getTransport = () => (transport ||= nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass }, connectionTimeout: 15000 }));
let sentLog = []; // pour les tests et le diagnostic (dernier envoi)

function emailHtml(items, intro) {
  const blocks = items.map((a) => {
    const t = TYPES[a.type] || {};
    return `<tr><td style="padding:14px 18px;border-top:1px solid #E6EAF1">
      <div style="font-size:12px;color:${t.urgent ? '#C2410C' : '#64748B'};font-weight:600;text-transform:uppercase;letter-spacing:.04em">${t.urgent ? '⚡ ' : ''}${esc(CATEGORIES[t.cat] || '')}</div>
      <div style="font-size:16px;font-weight:700;color:#10264A;margin:4px 0 6px">${esc(a.title)}</div>
      ${(a.lines || []).map((l) => `<div style="font-size:14px;color:#334155;line-height:1.5">${esc(l)}</div>`).join('')}
      ${a.link ? `<div style="margin-top:10px"><a href="${esc(a.link)}" style="display:inline-block;background:#10264A;color:#fff;text-decoration:none;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600">Ouvrir dans Zado Pro</a></div>` : ''}
    </td></tr>`;
  }).join('');
  return `<!doctype html><html><body style="margin:0;background:#F3F5F9;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:20px 0"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #DDE3EC">
    <tr><td style="background:#10264A;padding:16px 18px;color:#fff;font-size:18px;font-weight:700">Zado Pro <span style="color:#FFB300">·</span> <span style="font-weight:400;font-size:14px">${esc(intro)}</span></td></tr>
    ${blocks}
    <tr><td style="padding:14px 18px;border-top:1px solid #E6EAF1;font-size:12px;color:#64748B">Choisir les alertes reçues : <a href="${esc(admin('#/notifications'))}" style="color:#1E56C2">Zado Pro → Notifications</a>.</td></tr>
  </table></td></tr></table></body></html>`;
}
const emailText = (items) => items.map((a) => [a.title, ...(a.lines || []), a.link ? `→ ${a.link}` : ''].filter(Boolean).join('\n')).join('\n\n— — —\n\n');

async function sendMail({ subject, items, intro, to }) {
  const dest = to || getSettings().to;
  if (!smtpReady() || !dest.length) return { ok: false, reason: !smtpReady() ? 'e-mail non configuré' : 'aucun destinataire' };
  try {
    await getTransport().sendMail({ from: `"Zado Pro" <${smtp.from || smtp.user}>`, to: dest.join(', '), subject, text: emailText(items), html: emailHtml(items, intro) });
    sentLog = [{ at: new Date().toISOString(), subject, to: dest }, ...sentLog].slice(0, 20);
    return { ok: true };
  } catch (err) {
    console.error('[alertes] envoi impossible :', err.message);
    return { ok: false, reason: 'échec de l\'envoi : ' + err.message.slice(0, 120) };
  }
}

// ---------- File d'attente : les alertes d'une même rafale partent dans un seul e-mail ----------
let queue = []; let timer = null;
async function flush() {
  timer = null;
  const items = queue; queue = [];
  if (!items.length) return;
  const subject = items.length === 1 ? `${TYPES[items[0].type]?.urgent ? '⚡ ' : ''}${items[0].title}` : `${items.some((a) => TYPES[a.type]?.urgent) ? '⚡ ' : ''}${items.length} alertes Zado : ${items.slice(0, 2).map((a) => a.title).join(' · ')}${items.length > 2 ? '…' : ''}`;
  const r = await sendMail({ subject, items, intro: items.length === 1 ? 'Alerte' : `${items.length} alertes` });
  for (const a of items) store.alerts.update(a.id, { emailed: r.ok, emailNote: r.ok ? null : r.reason, emailedAt: r.ok ? new Date().toISOString() : null });
}
const schedule = (urgent) => {
  const s = getSettings();
  const wait = urgent ? 3000 : s.batchSeconds * 1000;
  if (timer && !urgent) return;
  clearTimeout(timer); timer = setTimeout(() => flush().catch((e) => console.error('[alertes]', e.message)), wait);
  timer.unref?.();
};

/** Déclenche une alerte. type = clé de TYPES ; data = { title, lines[], link, ref } */
function emit(type, data) {
  if (!TYPES[type]) return null;
  const s = getSettings();
  const on = s.types[type] !== false;
  const a = store.alerts.insert({
    id: 'AL-' + crypto.randomBytes(6).toString('hex'), type, at: new Date().toISOString(), title: String(data.title).slice(0, 200),
    lines: (data.lines || []).filter(Boolean).map((l) => String(l).slice(0, 400)).slice(0, 12), link: data.link || null, ref: data.ref || null,
    emailed: on ? null : false, emailNote: on ? 'en attente' : 'alerte désactivée',
  });
  prune();
  if (on && !config.demo) { queue.push(a); schedule(TYPES[type].urgent); }
  else if (on && config.demo) store.alerts.update(a.id, { emailed: false, emailNote: 'démo : aucun e-mail' });
  return a;
}
let pruneCount = 0;
function prune() {
  if (++pruneCount % 50) return;
  const all = store.alerts.all().sort((a, b) => (a.at < b.at ? 1 : -1));
  for (const a of all.slice(2000)) store.alerts.remove(a.id);
}

// ---------- Reconnaître les moments importants dans les changements de la base ----------
const who = (c) => [c?.name, c?.phone, c?.email].filter(Boolean).join(' · ');
const orderLines = (o) => [
  ...(o.lines || []).slice(0, 6).map((l) => `• ${l.qty} × ${l.name} — ${fcfa(l.total ?? (l.price || 0) * l.qty)}`),
  `Total : ${fcfa(o.total)}${o.transportFee ? ` (dont transport ${fcfa(o.transportFee)})` : ''}${o.discount?.amount ? ` · remise ${o.discount.code}` : ''}`,
  `Client : ${who(o.customer)}`,
  o.fulfillment === 'pickup' ? `Retrait au point relais${o.agency?.name ? ' : ' + o.agency.name : ''}` : `Livraison : ${[o.customer?.city, o.customer?.zone, o.customer?.address].filter(Boolean).join(', ')}`,
  o.gift ? `🎁 Cadeau pour ${o.gift.name}` : '',
];
const orderLink = (o) => admin(`#/commande/${encodeURIComponent(o.id)}`);
const OPN = { mtn: 'MTN MoMo', airtel: 'Airtel Money' };

function onChange({ col, doc, before }) {
  try {
    if (col === 'customers') {
      if (!before) {
        emit('customer.new', { title: `Nouveau client : ${doc.name}`, lines: [who(doc), doc.oauth?.google ? 'Inscrit avec Google' : 'Inscrit avec son numéro / e-mail', doc.idStatus === 'pending' ? 'Pièce d\'identité envoyée : à vérifier' : ''], link: admin('#/clients'), ref: doc.id });
      }
      if (doc.idStatus === 'pending' && (before?.idStatus !== 'pending' || before.idSubmittedAt !== doc.idSubmittedAt)) {
        emit('customer.identity', { title: `Pièce d'identité à vérifier : ${doc.name}`, lines: [who(doc), 'Le client ne peut pas commander avant votre vérification (annoncée « en général en 1 minute »).'], link: admin('#/clients'), ref: doc.id });
      }
      return;
    }
    if (col === 'orders') {
      const o = doc;
      if (!before) { emit('order.new', { title: `Nouvelle commande ${o.id} : ${fcfa(o.total)}`, lines: ['En attente de paiement.', ...orderLines(o)], link: orderLink(o), ref: o.id }); return; }
      const st = o.status, was = before.status;
      if (st !== was) {
        if (st === 'confirmed' && !require('./mobile-pay').isFull(o)) emit('order.confirmed', { title: `Acompte reçu : ${o.id} confirmée`, lines: [`Acompte ${fcfa(o.deposit || o.depositPaid || 0)} reçu, reste ${fcfa(o.balance ?? 0)} à encaisser.`, ...orderLines(o)], link: orderLink(o), ref: o.id });
        if (st === 'paid' && was !== 'shipped') emit('order.paid', { title: `Commande payée ${o.id} : ${fcfa(o.total)}`, lines: [o.balancePaid ? 'Le solde est réglé : la commande est entièrement payée.' : 'Paiement complet reçu.', 'Prochaine étape : acheter l\'article et lancer la logistique.', ...orderLines(o)], link: orderLink(o), ref: o.id });
        if (st === 'shipped') emit('order.shipped', { title: `En livraison : ${o.id}`, lines: [`Confiée à ${require('./delivery').courierName(o.courierId) || 'un livreur'}.`, `Client : ${who(o.customer)}`], link: orderLink(o), ref: o.id });
        if (st === 'delivered') emit('order.delivered', { title: `Livrée : ${o.id} (${fcfa(o.total)})`, lines: [`Client : ${who(o.customer)}`, o.deliveredWithoutCode ? '⚠️ Remise forcée sans le code du client.' : 'Remise avec le code du client.'], link: orderLink(o), ref: o.id });
        if (st === 'cancelled') emit('order.cancelled', { title: `Annulée : ${o.id}`, lines: [`Motif : ${o.cancelReason || 'non précisé'}`, ['paid', 'confirmed', 'shipped'].includes(was) ? '⚠️ Elle avait été payée : vérifiez le remboursement (Finances).' : '', `Client : ${who(o.customer)}`], link: orderLink(o), ref: o.id });
      }
      if (o.paidAfterCancel && !before.paidAfterCancel) emit('order.paidAfterCancel', { title: `Paiement sur commande ANNULÉE ${o.id} : à rembourser`, lines: ['Le client a payé alors que la commande était annulée. Remboursez-le via Mobile Money.', `Client : ${who(o.customer)}`], link: orderLink(o), ref: o.id });
      if ((o.attempts || []).length > (before.attempts || []).length && st !== 'cancelled') {
        const last = o.attempts[o.attempts.length - 1];
        emit('order.failed', { title: `Livraison ratée : ${o.id}`, lines: [`Motif : ${last.label || last.reason}${last.note ? ' — ' + last.note : ''}`, `Livreur : ${last.byName || '—'}`, `Client : ${who(o.customer)}`], link: orderLink(o), ref: o.id });
      }
      if (o.planned?.date && JSON.stringify(o.planned) !== JSON.stringify(before.planned || null)) {
        const SL = { morning: 'le matin', afternoon: "l'après-midi", evening: 'le soir' };
        emit('order.planned', { title: `${before.planned ? 'Livraison déplacée' : 'Livraison planifiée'} : ${o.id}`, lines: [`Le ${o.planned.date.split('-').reverse().join('/')} ${SL[o.planned.slot] || ''}${o.planned.byName ? ` (par ${o.planned.byName})` : ''}`, `Client : ${who(o.customer)}`], link: orderLink(o), ref: o.id });
      }
      const L = o.logistics || {}, B = before.logistics || {};
      const step = L.localAt && !B.localAt ? 'Déjà sur place à Pointe-Noire' : L.arrivedAt && !B.arrivedAt ? 'Arrivée à Pointe-Noire' : L.flyingAt && !B.flyingAt ? 'Dans l\'avion' : L.boughtAt && !B.boughtAt ? 'Achetée en France' : null;
      if (step) emit('order.logistics', { title: `${step} : ${o.id}`, lines: [`Client prévenu automatiquement.${L.byName ? ` Étape notée par ${L.byName}.` : ''}`], link: orderLink(o), ref: o.id });
      if ((o.relayChanges || []).length > (before.relayChanges || []).length) {
        const last = o.relayChanges[o.relayChanges.length - 1] || {};
        emit('order.relay', { title: `Point relais changé : ${o.id}`, lines: [`Avant : ${last.from || '—'} → maintenant : ${last.to || o.agency?.name || '—'}`, `Client : ${who(o.customer)}`], link: orderLink(o), ref: o.id });
      }
      return;
    }
    if (col === 'payments' && !before) {
      const p = doc, o = store.orders.get(p.orderId);
      if (p.operator === 'transfer' && p.status === 'PENDING') {
        emit('payment.transfer', { title: `Dépôt attendu : ${fcfa(p.amount)} (${p.orderId})`, lines: [`${p.purpose === 'rest' ? 'Solde' : (p.purpose === 'deposit' || p.purpose === 'mobile') && !(o && o.total && p.amount >= o.total) ? 'Acompte' : 'Paiement'} à recevoir par ${OPN[p.network] || 'Mobile Money'} depuis le ${p.phone || 'numéro du client'}, référence ${p.orderId}.`, 'Vérifiez votre téléphone, puis cliquez « Dépôt reçu » sur la commande.', o ? `Client : ${who(o.customer)}` : ''], link: o ? orderLink(o) : admin('#/commandes'), ref: p.orderId });
      }
      if (p.operator === 'cash' && o) emit('order.reservation', { title: `Réservation au point relais : ${o.id} (${fcfa(o.total)})`, lines: [`À encaisser en espèces${o.agency?.name ? ' à ' + o.agency.name : ''}.`, ...orderLines(o)], link: orderLink(o), ref: o.id });
      return;
    }
    if (col === 'conversations' && doc.kind !== 'team') {
      const c = doc;
      if (c.status === 'open' && before && before.status !== 'open' && c.handoffAt !== before.handoffAt) {
        const last = (c.messages || []).filter((m) => m.from === 'customer').slice(-3).map((m) => `« ${String(m.text).slice(0, 200)} »`);
        emit('chat.human', { title: `${c.name || 'Un visiteur'} demande un conseiller`, lines: [c.phone ? `Téléphone : ${c.phone}` : 'Visiteur sans numéro pour l\'instant.', ...last], link: admin(`#/messagerie/${encodeURIComponent(c.id)}`), ref: c.id });
      } else if (before && c.status === 'open' && c.lastFrom === 'customer' && c.lastAt !== before.lastAt) {
        emit('chat.message', { title: `Message de ${c.name || 'un visiteur'}`, lines: [`« ${String(c.lastText || '').slice(0, 300)} »`], link: admin(`#/messagerie/${encodeURIComponent(c.id)}`), ref: c.id });
      }
      return;
    }
    if (col === 'reviews' && !before) {
      const p = store.products.get(doc.productId);
      emit('review.new', { title: `Nouvel avis ${'★'.repeat(doc.rating)}${'☆'.repeat(5 - doc.rating)} : ${p?.name || doc.productId}`, lines: [`${doc.name} : « ${String(doc.text || '').slice(0, 300)} »`], link: admin('#/avis'), ref: doc.id });
      return;
    }
    if (col === 'products' && doc.pending && (!before || !before.pending)) {
      emit('product.pending', { title: `Produit à valider : ${doc.name}`, lines: [`Proposé par le responsable catalogue${doc.price ? ` à ${fcfa(doc.price)}` : ''}.`], link: admin(`#/produit/${encodeURIComponent(doc.id)}`), ref: doc.id });
      return;
    }
    if (col === 'stock_moves' && !before) {
      const lim = getSettings().lowStock;
      if (doc.after <= lim && doc.before > lim || (doc.after === 0 && doc.before > 0)) {
        emit('stock.low', { title: `${doc.after === 0 ? 'Rupture' : 'Stock bas'} : ${doc.name}`, lines: [`Il reste ${doc.after} article(s) (${doc.label || doc.reason}${doc.ref ? ' ' + doc.ref : ''}).`], link: admin(`#/produit/${encodeURIComponent(doc.productId)}`), ref: doc.productId });
      }
      return;
    }
    if (col === 'ledger' && !before && doc.recurringKey) {
      emit('finance.recurring', { title: `Dépense enregistrée : ${doc.label} (${fcfa(doc.amount)})`, lines: [/à ajuster/.test(doc.note || '') ? 'Montant prévu : corrigez-le dans Finances → Journal quand le relevé arrive.' : 'Ajoutée automatiquement dans Finances.'], link: admin('#/finances/journal'), ref: doc.id });
    }
  } catch (err) { console.error('[alertes]', err.message); }
}

// ---------- Résumé quotidien ----------
function digestItems(now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600e3).toISOString();
  const orders = store.orders.all();
  const fresh = orders.filter((o) => o.createdAt >= since);
  const paid = orders.filter((o) => o.paidAt && o.paidAt >= since);
  const custs = store.customers.all();
  const todo = [
    [custs.filter((c) => c.idStatus === 'pending').length, "pièce(s) d'identité à vérifier", '#/clients'],
    [store.payments.all().filter((p) => p.operator === 'transfer' && p.status === 'PENDING').length, 'dépôt(s) Mobile Money à confirmer', '#/commandes'],
    [store.conversations.all().filter((c) => c.kind !== 'team' && c.status === 'open' && (c.unreadStaff || 0) > 0).length, 'conversation(s) en attente de réponse', '#/messagerie'],
    [orders.filter((o) => o.status === 'paid' && !(o.logistics || {}).boughtAt && !(o.logistics || {}).localAt).length, 'commande(s) payée(s) à acheter en France', '#/commandes'],
    [orders.filter((o) => (o.logistics || {}).arrivedAt && ['paid', 'confirmed'].includes(o.status) && o.fulfillment !== 'pickup' && !o.planned).length, 'livraison(s) à planifier', '#/calendrier'],
    [store.products.all().filter((p) => p.pending).length, 'produit(s) à valider', '#/produits'],
    [store.products.all().filter((p) => p.active !== false && p.stock === 0).length, 'produit(s) en rupture', '#/stock'],
  ].filter(([n]) => n > 0);
  return [{
    type: 'daily.digest', title: `Résumé du ${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Brazzaville' })}`,
    lines: [
      `Dernières 24 h : ${fresh.length} commande(s) créée(s), ${paid.length} payée(s) pour ${fcfa(paid.reduce((s, o) => s + (o.total || 0), 0))}, ${custs.filter((c) => c.createdAt >= since).length} nouveau(x) client(s), ${store.alerts.all().filter((a) => a.at >= since && a.type !== 'daily.digest').length} alerte(s).`,
      todo.length ? 'À faire maintenant :' : 'Rien en attente : tout est à jour. 👍',
      ...todo.map(([n, l]) => `• ${n} ${l}`),
    ],
    link: admin('#/tableau'),
  }];
}
async function sendDigest({ force = false } = {}) {
  const s = getSettings();
  if (!force && s.types['daily.digest'] === false) return { ok: false, reason: 'résumé désactivé' };
  const items = digestItems();
  const a = store.alerts.insert({ id: 'AL-' + crypto.randomBytes(6).toString('hex'), type: 'daily.digest', at: new Date().toISOString(), title: items[0].title, lines: items[0].lines, link: items[0].link, emailed: null, emailNote: 'en attente' });
  const r = config.demo ? { ok: false, reason: 'démo : aucun e-mail' } : await sendMail({ subject: `☀️ ${items[0].title}`, items, intro: 'Résumé du matin' });
  store.alerts.update(a.id, { emailed: r.ok, emailNote: r.ok ? null : r.reason, emailedAt: r.ok ? new Date().toISOString() : null });
  return r;
}
function digestDue() {
  const s = getSettings();
  const now = congoNow();
  return now.getUTCHours() >= s.digestHour && settings.get('alerts:lastDigest') !== congoDay();
}

/** Test : un e-mail tout de suite aux destinataires choisis. */
async function sendTest() {
  return sendMail({ subject: 'Zado Pro : e-mail de test ✅', intro: 'Test', items: [{ type: 'daily.digest', title: 'Les alertes e-mail de Zado fonctionnent', lines: ['Vous recevrez ici les nouvelles commandes, dépôts à vérifier, clients, messages, livraisons…', 'Choisissez ce que vous recevez dans Zado Pro → Notifications.'], link: admin('#/notifications') }] });
}

let started = false;
function start() {
  if (started) return; started = true;
  require('./events').bus.on('change', onChange);
  if (process.env.VERCEL || process.env.ALERTS_DIGEST === 'off') return;
  const tick = () => { if (digestDue()) { settings.set('alerts:lastDigest', congoDay()); sendDigest().catch((e) => console.error('[alertes]', e.message)); } };
  const t = setInterval(tick, 10 * 60e3); t.unref?.();
  setTimeout(tick, 30e3).unref?.();
}

module.exports = { TYPES, CATEGORIES, getSettings, saveSettings, emit, flush, sendTest, sendDigest, digestItems, smtpReady, start, sentLog: () => sentLog, smtpInfo: () => ({ configured: smtpReady(), from: smtp.user || null, host: smtp.host || null }) };
