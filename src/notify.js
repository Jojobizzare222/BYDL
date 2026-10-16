// Alerte e-mail à chaque commande payée.
// Sans réglages SMTP dans .env, l'e-mail est simplement affiché dans le Terminal (pratique pour tester).
const nodemailer = require('nodemailer');
const config = require('./config');
const { formatXAF } = require('./utils/money');

const { smtp } = config;
const configured = Boolean(smtp.host && smtp.user && smtp.pass && smtp.to);
const transport = configured
  ? nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass } })
  : null;

function paidOrderEmail(order, { afterCancel = false } = {}) {
  const c = order.customer;
  const cod = order.paymentPlan === 'cod';
  const subject = afterCancel
    ? `⚠️ Paiement reçu sur une commande ANNULÉE ${order.id} : à rembourser`
    : cod
      ? `Nouvelle commande À LA RÉCEPTION ${order.id} : ${formatXAF(order.total)} (acompte ${formatXAF(order.deposit || 0)})`
      : `Nouvelle commande payée ${order.id} : ${formatXAF(order.total)}`;
  const text = [
    afterCancel ? 'ATTENTION : cette commande avait été annulée, mais le client a payé. Remboursez-le via Mobile Money.\n' : '',
    cod
      ? `Commande ${order.id} à payer à la réception : ${formatXAF(order.total)}. Acompte reçu : ${formatXAF(order.deposit || 0)}. Reste à encaisser à la livraison : ${formatXAF(order.balance ?? order.total)}.\nAppelez le client pour confirmer avant d'envoyer le livreur.`
      : `Commande ${order.id} payée : ${formatXAF(order.total)}`,
    '',
    ...order.lines.map((l) => `- ${l.qty} × ${l.name} : ${formatXAF(l.total)}`),
    '',
    `Client : ${c.name}`,
    `Téléphone : ${c.phone}`,
    `Ville : ${c.city || '-'}`,
    `Adresse / repère : ${c.address || '-'}`,
    '',
    `Gérer la commande : ${config.publicUrl}/admin/#/commande/${encodeURIComponent(order.id)}`,
  ].join('\n');
  return { subject, text };
}

async function notifyPaidOrder(order, options) {
  const { subject, text } = paidOrderEmail(order, options);
  await send(subject, text, order.id);
}

async function send(subject, text, orderId) {
  if (!transport) {
    console.log(`\n[e-mail non configuré : affiché ici à la place]\nObjet : ${subject}\n${text}\n`);
    return;
  }
  try {
    await transport.sendMail({ from: `"${config.shopName}" <${smtp.user}>`, to: smtp.to, subject, text });
    console.log(`[e-mail] alerte envoyée pour ${orderId}`);
  } catch (err) {
    console.error(`[e-mail] échec de l'envoi pour ${orderId} :`, err.message);
  }
}

// Réservation pour un retrait en agence : l'admin prépare l'article avant la venue du client.
async function notifyReservation(order) {
  const c = order.customer;
  const deadline = new Date(order.pickupDeadline).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
  const subject = `Réservation en agence ${order.id} : ${formatXAF(order.total)} à encaisser`;
  const text = [
    order.fulfillment === 'pickup'
      ? `Le client vient payer en espèces et retirer sa commande à l'agence ${order.agency?.name} (${order.agency?.city}).`
      : `Le client vient payer en espèces à l'agence ${order.agency?.name} (${order.agency?.city}), puis la commande est LIVRÉE chez lui : ${c.city || ''} — ${c.address || ''}.`,
    `À encaisser : ${formatXAF(order.total)} — réservation valable jusqu'au ${deadline}.`,
    '',
    ...order.lines.map((l) => `- ${l.qty} × ${l.name} : ${formatXAF(l.total)}`),
    '',
    `Client : ${c.name} — ${c.phone}`,
    '',
    `Gérer la commande : ${config.publicUrl}/admin/#/commande/${encodeURIComponent(order.id)}`,
  ].join('\n');
  await send(subject, text, order.id);
}

// Nouvelle demande d'achat en Europe : à chiffrer (devis) dans Kamwa Pro
async function notifyImportRequest(r) {
  const subject = `Achat en Europe : nouvelle demande de devis ${r.id}`;
  const text = [
    `Demande ${r.id} de ${r.customer.name} (${r.customer.phone}, ${r.customer.city || '-'}) :`,
    '',
    ...r.items.map((it) => `- ${it.qty} × ${it.title || 'article'}${it.options ? ' (' + it.options + ')' : ''}${it.priceEur ? ' — ' + it.priceEur + ' €' : ''}\n  ${it.url}`),
    r.note ? `\nNote du client : ${r.note}` : '',
    '',
    `Faire le devis : ${config.publicUrl}/admin/#/france/${encodeURIComponent(r.id)}`,
  ].join('\n');
  await send(subject, text, r.id);
}

// Nouvelle pièce d'identité à vérifier (la photo n'est JAMAIS jointe à l'e-mail : elle reste dans Kamwa Pro)
async function notifyIdentity(customer) {
  const subject = `Pièce d'identité à vérifier : ${customer.name}`;
  const text = [
    `${customer.name} (${[customer.phone, customer.email].filter(Boolean).join(' · ')}) a envoyé sa pièce d'identité.`,
    'Il ne pourra commander qu\'après votre vérification.',
    '',
    `Vérifier : ${config.publicUrl}/admin/#/clients`,
  ].join('\n');
  await send(subject, text, customer.id);
}

// Un client demande un conseiller dans la messagerie
async function notifyChat(conv) {
  const last = (conv.messages || []).filter((m) => m.from === 'customer').slice(-3).map((m) => `« ${m.text.slice(0, 200)} »`);
  const subject = `Messagerie : ${conv.name || 'un visiteur'} demande un conseiller`;
  const text = [
    `${conv.name || 'Un visiteur'}${conv.phone ? ' (' + conv.phone + ')' : ''} attend une réponse dans la messagerie.`,
    '',
    ...last,
    '',
    `Répondre : ${config.publicUrl}/admin/#/messagerie/${encodeURIComponent(conv.id)}`,
  ].join('\n');
  await send(subject, text, conv.id);
}

module.exports = { notifyPaidOrder, notifyReservation, notifyImportRequest, notifyIdentity, notifyChat };
