// Régler l'adresse qui ENVOIE les alertes e-mail de Zado (Zado Pro → Notifications).
// Usage, dans le Terminal (sur le serveur : dans /srv/zado/app, en tant que « zado ») :  npm run email:config
// Le mot de passe ne s'affiche pas pendant la saisie (des • apparaissent) et n'est écrit que dans le fichier .env
// de cette machine (jamais sur GitHub). La connexion est VÉRIFIÉE et un e-mail de test est envoyé AVANT d'enregistrer.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const ENV = path.join(__dirname, '..', '.env');
const PROVIDERS = {
  // Brevo : envoi par HTTPS (14/11/2026) — seul possible sur le VPS OVH « Local Zone » (ports d'envoi SMTP fermés par OVH)
  0: { name: 'Brevo (clé API) — RECOMMANDÉ sur le serveur zado-congo.com', brevo: true },
  1: { name: 'Adresse OVH (ex. contact@zado-congo.com, Zimbra / MX Plan)', host: 'ssl0.ovh.net', port: 465 },
  2: { name: "Gmail (avec un « mot de passe d'application » Google, pas votre mot de passe habituel)", host: 'smtp.gmail.com', port: 465 },
  3: { name: 'Autre fournisseur (serveur à saisir)' },
};

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return resolve(value.trim()); }
        if (ch === '\u0003') { process.stdout.write('\nAnnulé : rien n\'a été changé.\n'); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') { if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (ch < ' ') continue;
        value += ch; process.stdout.write(hidden ? '•' : ch);
      }
    };
    stdin.on('data', onData);
  });
}

function writeEnv(values) {
  let text = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
  for (const [k, v] of Object.entries(values)) {
    const val = String(v);
    // Mot de passe avec # ou espace : entre guillemets, sinon .env le couperait
    const q = /[\s#'"`\\]/.test(val) ? (val.includes("'") ? `"${val.replace(/[\\"]/g, (c) => '\\' + c)}"` : `'${val}'`) : val;
    const line = `${k}=${q}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
  }
  fs.writeFileSync(ENV, text, { mode: 0o600 });
  try { fs.chmodSync(ENV, 0o600); } catch {}
}

(async () => {
  if (!process.stdin.isTTY) { console.error('Lancez cette commande directement dans le Terminal.'); process.exit(1); }
  console.log('\nRéglage de l\'adresse qui envoie les e-mails de Zado : aux CLIENTS (bon de commande, confirmation) et à l\'équipe (alertes)\n');
  for (const [k, p] of Object.entries(PROVIDERS)) console.log(`  ${k}. ${p.name}`);
  const choice = await ask('\nVotre choix (0, 1, 2 ou 3) : ');
  const prov = PROVIDERS[choice];
  if (!prov) { console.error('Choix inconnu : rien n\'a été changé.'); process.exit(1); }
  if (prov.brevo) return brevo();
  let { host, port } = prov;
  if (!host) {
    host = await ask('Serveur d\'envoi (SMTP), ex. smtp.exemple.com : ');
    port = Number(await ask('Port (465 conseillé, ou 587) : ')) || 465;
  }
  // Adresse de Zado qui écrit aux clients et à l'équipe (décision Joseph 14/11/2026) : contact@zado-congo.com par défaut
  const DEF = choice === '1' ? 'contact@zado-congo.com' : '';
  const user = ((await ask(`Adresse e-mail qui envoie${DEF ? ` (Entrée = ${DEF})` : ''} : `)) || DEF).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(user)) { console.error('Adresse invalide : rien n\'a été changé.'); process.exit(1); }
  const pass = await ask(choice === '2' ? 'Mot de passe d\'application Google (16 lettres) : ' : 'Mot de passe de cette adresse : ', { hidden: true });
  if (!pass) { console.error('Mot de passe vide : rien n\'a été changé.'); process.exit(1); }
  const toIn = await ask(`Adresse(s) qui REÇOIVENT les alertes (virgules ; Entrée = ${user}) : `);
  const to = (toIn || user).split(/[,;\s]+/).filter(Boolean).join(',');

  console.log('\nVérification de la connexion…');
  const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass: choice === '2' ? pass.replace(/\s/g, '') : pass }, connectionTimeout: 15000 });
  try {
    await t.verify();
    await t.sendMail({ from: `"Zado Pro" <${user}>`, to, subject: 'Zado : les alertes e-mail sont prêtes ✅', text: 'Cet e-mail confirme que Zado peut envoyer ses alertes.\nChoisissez ce que vous recevez dans Zado Pro → Notifications.' });
  } catch (err) {
    console.error(`\n✗ Échec : ${err.message}\nRien n'a été changé. Vérifiez l'adresse et le mot de passe${choice === '2' ? " (il faut un mot de passe d'application : compte Google → Sécurité → Validation en deux étapes → Mots de passe des applications)" : ''}, puis relancez.`);
    process.exit(1);
  }
  writeEnv({ SMTP_HOST: host, SMTP_PORT: port, SMTP_USER: user, SMTP_FROM: user, SMTP_PASS: choice === '2' ? pass.replace(/\s/g, '') : pass, ALERT_EMAIL_TO: to });
  console.log(`\n✓ E-mail de test envoyé à ${to} et réglages enregistrés dans .env.`);
  console.log('Redémarrez la boutique pour activer les alertes (sur le serveur : sudo systemctl restart zado).\n');
})();

// Brevo : la clé API (Brevo → Paramètres → SMTP & API → Clés API) est tapée par Joseph, masquée, vérifiée par un e-mail de test
async function brevo() {
  const DEF = 'contact@zado-congo.com';
  const from = ((await ask(`Adresse qui envoie (doit être validée chez Brevo ; Entrée = ${DEF}) : `)) || DEF).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(from)) { console.error('Adresse invalide : rien n\'a été changé.'); process.exit(1); }
  const key = (await ask('Clé API Brevo (commence par xkeysib-) : ', { hidden: true })).replace(/\s/g, '');
  if (!key) { console.error('Clé vide : rien n\'a été changé.'); process.exit(1); }
  const toIn = await ask(`Adresse(s) qui REÇOIVENT les alertes de l'équipe (virgules ; Entrée = ${from}) : `);
  const to = (toIn || from).split(/[,;\s]+/).filter(Boolean);
  console.log('\nEnvoi d\'un e-mail de test par Brevo…');
  try {
    await require('../src/mailer').brevoSend({ key, fromName: 'Zado Pro', from, to, subject: 'Zado : les e-mails sont prêts ✅',
      text: 'Cet e-mail confirme que Zado peut envoyer ses e-mails par Brevo : alertes de l\'équipe, bons de commande et confirmations aux clients.\nChoisissez les alertes reçues dans Zado Pro → Notifications.' });
  } catch (err) {
    console.error(`\n✗ Échec : ${err.message}\nRien n'a été changé. Vérifiez la clé API et que l'adresse ${from} (ou le domaine) est bien validée dans Brevo → Expéditeurs, domaines et IP dédiées, puis relancez.`);
    process.exit(1);
  }
  writeEnv({ BREVO_API_KEY: key, SMTP_FROM: from, ALERT_EMAIL_TO: to.join(',') });
  console.log(`\n✓ E-mail de test envoyé à ${to.join(', ')} et réglages enregistrés dans .env.`);
  console.log('Redémarrez la boutique pour activer les e-mails (sur le serveur : sudo systemctl restart zado).\n');
}
