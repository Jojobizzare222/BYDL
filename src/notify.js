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
  const subject = afterCancel
    ? `⚠️ Paiement reçu sur une commande ANNULÉE ${order.id} : à rembourser`
    : `Nouvelle commande payée ${order.id} : ${formatXAF(order.total)}`;
  const text = [
    afterCancel ? 'ATTENTION : cette commande avait été annulée, mais le client a payé. Remboursez-le via Mobile Money.\n' : '',
    `Commande ${order.id} payée : ${formatXAF(order.total)}`,
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
  if (!transport) {
    console.log(`\n[e-mail non configuré : affiché ici à la place]\nObjet : ${subject}\n${text}\n`);
    return;
  }
  try {
    await transport.sendMail({ from: `"${config.shopName}" <${smtp.user}>`, to: smtp.to, subject, text });
    console.log(`[e-mail] alerte envoyée pour ${order.id}`);
  } catch (err) {
    console.error(`[e-mail] échec de l'envoi pour ${order.id} :`, err.message);
  }
}

module.exports = { notifyPaidOrder };
