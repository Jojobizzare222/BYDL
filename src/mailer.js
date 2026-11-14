// Envoi des e-mails de Zado (alertes de l'équipe ET e-mails aux clients), un seul endroit pour tout le site.
// Deux façons d'envoyer, réglées dans .env par `npm run email:config` :
//   1) BREVO (décision Joseph 14/11/2026) : API HTTPS de Brevo (port 443). Le VPS OVH est dans une « Local Zone » où les
//      ports d'envoi d'e-mails (25, 465, 587) sont fermés par OVH sans date de réouverture (réponse au ticket CS17142837) ;
//      BREVO_API_KEY dans .env, expéditeur SMTP_FROM (contact@zado-congo.com, domaine authentifié chez Brevo).
//   2) SMTP classique (SMTP_HOST / SMTP_USER / SMTP_PASS), si le serveur peut l'utiliser.
// Brevo passe avant le SMTP quand les deux sont réglés. Démo : jamais d'envoi.
const nodemailer = require('nodemailer');
const config = require('./config');

const smtp = config.smtp;
const brevoKey = () => process.env.BREVO_API_KEY || '';
const BREVO_URL = () => process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email'; // BREVO_API_URL : tests seulement
const mode = () => (config.demo ? null : brevoKey() ? 'brevo' : smtp.host && smtp.user && smtp.pass ? 'smtp' : null);
const ready = () => Boolean(mode());
const fromAddress = () => smtp.from || smtp.user || '';
const info = () => ({ configured: ready(), from: fromAddress() || null, host: mode() === 'brevo' ? 'Brevo (API)' : smtp.host || null, via: mode() });

let transport = null;
const getTransport = () => (transport ||= nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass: smtp.pass }, connectionTimeout: 15000 }));

/** Envoie un e-mail par l'API Brevo (clé et URL données pour le réglage `npm run email:config`). */
// attachments : [{ name, content (Buffer) }] — pièces jointes (ex. bon de commande en PDF)
async function brevoSend({ key = brevoKey(), url = BREVO_URL(), fromName, from, to, subject, text, html, replyTo, attachments = [] }) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: fromName || 'Zado', email: from },
      to: to.map((email) => ({ email })),
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      ...(attachments.length ? { attachment: attachments.map((a) => ({ name: a.name, content: Buffer.from(a.content).toString('base64') })) } : {}),
      subject, htmlContent: html || `<pre>${String(text || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`, ...(text ? { textContent: text } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    let msg = `Brevo a refusé l'envoi (${r.status})`;
    try { const j = await r.json(); if (j?.message) msg += ` : ${j.message}`; } catch {}
    throw new Error(msg);
  }
  return true;
}

/**
 * Envoie un e-mail. to = adresse ou liste. Renvoie { ok: true } ou lève une erreur (message lisible).
 * fromName : « Zado » (clients) ou « Zado Pro » (équipe).
 */
async function send({ fromName = 'Zado', to, subject, text, html, replyTo, attachments = [] }) {
  const dest = (Array.isArray(to) ? to : String(to || '').split(/[,;\s]+/)).filter(Boolean);
  if (!dest.length) throw new Error('aucun destinataire');
  const m = mode();
  if (!m) throw new Error('e-mail non configuré');
  if (m === 'brevo') return brevoSend({ fromName, from: fromAddress(), to: dest, subject, text, html, replyTo, attachments });
  await getTransport().sendMail({ from: `"${fromName}" <${fromAddress()}>`, ...(replyTo ? { replyTo } : {}), to: dest.join(', '), subject, text, html, attachments: attachments.map((a) => ({ filename: a.name, content: a.content })) });
  return true;
}

module.exports = { send, ready, info, mode, fromAddress, brevoSend };
