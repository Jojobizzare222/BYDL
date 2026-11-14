// E-mails aux CLIENTS (décision Joseph 14/11/2026) : bon de commande à la validation de l'achat, puis confirmation de commande
// quand Zado a reçu le paiement. Seulement si le client a un e-mail (compte créé avec un e-mail, ou Google) et si l'envoi
// d'e-mails est réglé (SMTP_* dans .env, `npm run email:config`). Sans réglage : rien n'est envoyé (le site et « Aide »
// préviennent quand même le client). Jamais de code client, de code de livraison ni de photo de pièce dans un e-mail.
const config = require('./config');
const { customers } = require('./store');
const mailer = require('./mailer'); // API Brevo (HTTPS) ou SMTP selon .env
const ready = () => mailer.ready();
let sentLog = []; // diagnostic et tests

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const abs = (link) => (/^https?:/.test(link) ? link : `${String(config.publicUrl || '').replace(/\/$/, '')}${link}`);

// steps : frise [{ label, done, now }] ; next : { title, text } = encadré « Prochaine étape » (e-mails d'étape, 14/11/2026)
function html({ title, lines = [], button, foot, steps, next }) {
  return `<!doctype html><html><body style="margin:0;background:#F3F5F9;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:20px 0"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #DDE3EC">
    <tr><td style="background:#10264A;padding:16px 20px;color:#fff;font-size:20px;font-weight:700">Zado <span style="color:#FFB300">·</span></td></tr>
    <tr><td style="padding:20px">
      <div style="font-size:18px;font-weight:700;color:#10264A;margin-bottom:10px">${esc(title)}</div>
      ${lines.map((l) => (l === '' ? '<div style="height:8px"></div>' : `<div style="font-size:14px;color:#334155;line-height:1.55">${esc(l)}</div>`)).join('')}
      ${steps?.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 4px;width:100%">${steps.map((s) => `<tr><td style="width:26px;vertical-align:top;padding:3px 0"><span style="display:inline-block;width:18px;height:18px;line-height:18px;border-radius:9px;text-align:center;font-size:11px;font-weight:700;${s.done ? 'background:#0E8A66;color:#fff' : s.now ? 'background:#FFB300;color:#10264A' : 'background:#E6EAF1;color:#94A3B8'}">${s.done ? '✓' : s.now ? '•' : ''}</span></td><td style="padding:3px 0;font-size:14px;color:${s.done || s.now ? '#0E1424' : '#94A3B8'};${s.now ? 'font-weight:700' : ''}">${esc(s.label)}</td></tr>`).join('')}</table>` : ''}
      ${next ? `<div style="margin-top:14px;padding:12px 14px;border-radius:10px;background:#FFF8E6;border:1px solid #FFB300"><div style="font-size:12px;font-weight:700;color:#8A5A00;text-transform:uppercase;letter-spacing:.04em">Prochaine étape</div><div style="font-size:15px;font-weight:700;color:#10264A;margin:4px 0 2px">${esc(next.title)}</div>${next.text ? `<div style="font-size:14px;color:#334155;line-height:1.5">${esc(next.text)}</div>` : ''}</div>` : ''}
      ${button ? `<div style="margin-top:16px"><a href="${esc(abs(button.url))}" style="display:inline-block;background:#FFB300;color:#10264A;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:700">${esc(button.label)}</a></div>` : ''}
    </td></tr>
    <tr><td style="padding:14px 20px;border-top:1px solid #E6EAF1;font-size:12px;color:#64748B">${esc(foot || 'Une question ? Écrivez-nous dans « Aide » sur le site Zado.')}</td></tr>
  </table></td></tr></table></body></html>`;
}

/** Envoie un e-mail au client de la commande (s'il a un e-mail). Ne bloque jamais : renvoie { ok, reason }. */
async function toCustomer(order, { subject, title, lines, button, attachments = [], steps, next }) {
  const c = order?.customerId && customers.get(order.customerId);
  const to = c?.email || order?.customer?.email;
  if (!to) return { ok: false, reason: 'pas d\'e-mail' };
  if (!ready()) return { ok: false, reason: 'e-mail non configuré' };
  try {
    await mailer.send({ fromName: 'Zado', replyTo: mailer.fromAddress(), to, subject, attachments, html: html({ title, lines, button, steps, next }),
      text: [title, '', ...lines, ...(next ? ['', `Prochaine étape : ${next.title}${next.text ? ` - ${next.text}` : ''}`] : []), button ? `\n${button.label} : ${abs(button.url)}` : ''].join('\n') });
    sentLog = [{ at: new Date().toISOString(), to, subject }, ...sentLog].slice(0, 20);
    return { ok: true };
  } catch (err) {
    console.error('[e-mail client] envoi impossible :', err.message);
    return { ok: false, reason: err.message.slice(0, 120) };
  }
}

module.exports = { toCustomer, ready, sentLog: () => sentLog };
