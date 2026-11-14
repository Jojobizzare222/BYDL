// Envoi des e-mails par l'API Brevo (14/11/2026 : le VPS OVH « Local Zone » bloque les ports SMTP).
// Faux serveur Brevo sur le port 3995 (BREVO_API_URL). Lancer : zsh tests/run-all.sh (voir la ligne « t brevo »)
import http from 'node:http';
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const got = [];
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    got.push({ key: req.headers['api-key'], url: req.url, body: JSON.parse(body || '{}') });
    res.writeHead(req.headers['api-key'] === 'xkeysib-test' ? 201 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.headers['api-key'] === 'xkeysib-test' ? { messageId: '<m1@brevo>' } : { message: 'Key not found' }));
  });
}).listen(3995);
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '' }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; let data = null; try { data = await r.json(); } catch {} return { status: r.status, data }; };

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const info = (await call(A, '/admin/alerts')).data;
ok(info?.smtp?.configured && info.smtp.via === 'brevo' && info.smtp.from === 'contact@zado-congo.com', `Zado Pro : envoi réglé par Brevo depuis ${info?.smtp?.from}`);
const t = await call(A, '/admin/alerts/test', { body: {} });
await sleep(500);
const m = got.at(-1);
ok(t.status === 200 && m?.key === 'xkeysib-test' && m.url === '/v3/smtp/email', 'e-mail de test envoyé par l\'API Brevo avec la clé');
ok(m?.body?.sender?.email === 'contact@zado-congo.com' && m.body.sender.name === 'Zado Pro' && m.body.to?.[0]?.email === 'joseph@zado.test', 'expéditeur contact@zado-congo.com « Zado Pro », destinataire de l\'équipe');
ok(m?.body?.htmlContent && m.body.subject, 'contenu HTML et objet transmis');
// Mauvaise clé : erreur lisible, pas de plantage
const { brevoSend } = await import('../src/mailer.js');
let err = null; try { await brevoSend({ key: 'mauvaise', url: 'http://localhost:3995/v3/smtp/email', from: 'contact@zado-congo.com', to: ['a@b.test'], subject: 's', text: 't' }); } catch (e) { err = e.message; }
ok(/Brevo a refusé l'envoi \(401\) : Key not found/.test(err || ''), `clé refusée : message clair (${err})`);
srv.close();
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
