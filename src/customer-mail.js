// E-mails aux CLIENTS (décision Joseph 14/11/2026) : bon de commande à la validation de l'achat, puis confirmation de commande
// quand Zado a reçu le paiement. Seulement si le client a un e-mail (compte créé avec un e-mail, ou Google) et si l'envoi
// d'e-mails est réglé (SMTP_* dans .env, `npm run email:config`). Sans réglage : rien n'est envoyé (le site et « Aide »
// préviennent quand même le client). Jamais de code client, de code de livraison ni de photo de pièce dans un e-mail.
const nodemailer = require('nodemailer');
const config = require('./config');
const { customers } = require('./store');

const smtp = config.smtp;
const ready = () => Boolean(smtp.host && smtp.user && smtp.pass) && !config.demo;
let transport = null;
const getTransport = () => (transport ||= nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass }, connectionTimeout: 15000 }));
let sentLog = []; // diagnostic et tests

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const abs = (link) => (/^https?:/.test(link) ? link : `${String(config.publicUrl || '').replace(/\/$/, '')}${link}`);

function html({ title, lines = [], button, foot }) {
  return `<!doctype html><html><body style="margin:0;background:#F3F5F9;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:20px 0"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #DDE3EC">
    <tr><td style="background:#10264A;padding:16px 20px;color:#fff;font-size:20px;font-weight:700">Zado <span style="color:#FFB300">·</span></td></tr>
    <tr><td style="padding:20px">
      <div style="font-size:18px;font-weight:700;color:#10264A;margin-bottom:10px">${esc(title)}</div>
      ${lines.map((l) => (l === '' ? '<div style="height:8px"></div>' : `<div style="font-size:14px;color:#334155;line-height:1.55">${esc(l)}</div>`)).join('')}
      ${button ? `<div style="margin-top:16px"><a href="${esc(abs(button.url))}" style="display:inline-block;background:#FFB300;color:#10264A;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:700">${esc(button.label)}</a></div>` : ''}
    </td></tr>
    <tr><td style="padding:14px 20px;border-top:1px solid #E6EAF1;font-size:12px;color:#64748B">${esc(foot || 'Une question ? Écrivez-nous dans « Aide » sur le site Zado.')}</td></tr>
  </table></td></tr></table></body></html>`;
}

/** Envoie un e-mail au client de la commande (s'il a un e-mail). Ne bloque jamais : renvoie { ok, reason }. */
async function toCustomer(order, { subject, title, lines, button }) {
  const c = order?.customerId && customers.get(order.customerId);
  const to = c?.email || order?.customer?.email;
  if (!to) return { ok: false, reason: 'pas d\'e-mail' };
  if (!ready()) return { ok: false, reason: 'e-mail non configuré' };
  try {
    await getTransport().sendMail({ from: `"Zado" <${smtp.user}>`, to, subject, html: html({ title, lines, button }),
      text: [title, '', ...lines, button ? `\n${button.label} : ${abs(button.url)}` : ''].join('\n') });
    sentLog = [{ at: new Date().toISOString(), to, subject }, ...sentLog].slice(0, 20);
    return { ok: true };
  } catch (err) {
    console.error('[e-mail client] envoi impossible :', err.message);
    return { ok: false, reason: err.message.slice(0, 120) };
  }
}

module.exports = { toCustomer, ready, sentLog: () => sentLog };
