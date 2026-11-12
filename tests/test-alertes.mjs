// Écosystème d'alertes e-mail de l'équipe (12/11/2026) : nouveau client, pièce à vérifier, commande, dépôt attendu,
// acompte, paiement, logistique, annulation, conseiller demandé ; regroupement, types désactivables, test, résumé du matin.
// Un FAUX serveur d'e-mails (port 3996) reçoit les messages. Lancer : zsh tests/run-test.sh test-alertes.mjs tests/id.jpg
// (avec SMTP_HOST=localhost SMTP_PORT=3996 SMTP_USER=alertes@zado.test SMTP_PASS=x ALERT_EMAIL_TO=joseph@zado.test, voir run-all.sh)
import fs from 'node:fs';
import net from 'node:net';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Faux serveur SMTP ----
const mails = [];
const qp = (s) => Buffer.from(s.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
const words = (s) => s.replace(/\r\n\s+/g, ' ').replace(/=\?UTF-8\?([QB])\?([^?]*)\?=\s*/gi, (_, e, t) => (e.toUpperCase() === 'B' ? Buffer.from(t, 'base64').toString('utf8') : qp(t.replace(/_/g, ' '))));
net.createServer((sock) => {
  let buf = '', data = false, rcpt = [], login = 0;
  sock.write('220 faux-smtp\r\n');
  sock.on('data', (chunk) => {
    buf += chunk.toString('latin1');
    while (true) {
      if (data) {
        const end = buf.indexOf('\r\n.\r\n'); if (end < 0) return;
        const raw = buf.slice(0, end); buf = buf.slice(end + 5); data = false;
        const subject = words((raw.match(/^Subject: (.*(?:\r\n\s.*)*)/m) || [])[1] || '');
        mails.push({ to: rcpt, subject, body: qp(raw) }); rcpt = [];
        sock.write('250 OK\r\n'); continue;
      }
      const i = buf.indexOf('\r\n'); if (i < 0) return;
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (login) { login--; sock.write(login ? '334 UGFzc3dvcmQ6\r\n' : '235 OK\r\n'); continue; }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') sock.write('250-faux\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
      else if (cmd === 'HELO') sock.write('250 OK\r\n');
      else if (cmd === 'AUTH') { if (/LOGIN/i.test(line)) { login = 2; sock.write('334 VXNlcm5hbWU6\r\n'); } else sock.write('235 OK\r\n'); }
      else if (cmd === 'RCPT') { rcpt.push(line.replace(/.*<|>.*/g, '')); sock.write('250 OK\r\n'); }
      else if (cmd === 'DATA') { data = true; sock.write('354 Go\r\n'); }
      else if (cmd === 'QUIT') { sock.end('221 Bye\r\n'); return; }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
}).listen(3996);
const waitMail = async (test, ms = 8000) => { for (let t = 0; t < ms; t += 200) { const m = mails.find(test); if (m) return m; await sleep(200); } return null; };

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
ok((await call(null, '/admin/alerts')).status === 401, 'Notifications : réservé à Zado Pro');
let d = (await call(A, '/admin/alerts')).data;
ok(d.smtp.configured && d.settings.to.join() === 'joseph@zado.test' && d.types.length >= 20 && Object.values(d.settings.types).every(Boolean), `réglages : e-mail configuré, destinataire du .env, ${d.types.length} types d'alertes tous actifs`);
ok((await call(A, '/admin/alerts/settings', { method: 'PUT', body: { to: 'pas-une-adresse' } })).status === 400, 'adresse invalide refusée');
ok((await call(A, '/admin/alerts/settings', { method: 'PUT', body: { to: 'a@x.cg,b@x.cg,c@x.cg,d@x.cg,e@x.cg,f@x.cg' } })).status === 400, '6 adresses : refusé (5 au maximum)');
const st = (await call(A, '/admin/alerts/settings', { method: 'PUT', body: { to: 'Joseph@Zado.test, associe@zado.test', batchSeconds: 0 } })).data;
ok(st.to.join() === 'joseph@zado.test,associe@zado.test' && st.batchSeconds === 0, 'deux destinataires enregistrés (en minuscules), envoi immédiat');

// 1) Nouveau client + pièce d'identité
const C = { c: '' };
const reg = (await call(C, '/account/register', { body: { name: 'Awa Alerte', phone: '061234567', idType: 'cni', idPhoto: 'data:image/jpeg;base64,' + fs.readFileSync(process.argv[3]).toString('base64') } })).data;
let m = await waitMail((x) => /Awa Alerte/.test(x.subject + x.body) && /Nouveau client|Pièce/.test(x.subject));
ok(m && m.to.includes('joseph@zado.test') && m.to.includes('associe@zado.test'), `e-mail reçu par les 2 destinataires : « ${m?.subject} »`);
ok(mails.some((x) => /Pièce d'identité à vérifier/.test(x.body)) && !mails.some((x) => /data:image|\.jpg/.test(x.body)), "pièce d'identité à vérifier signalée, JAMAIS la photo dans l'e-mail");
await call(A, `/admin/customers/${reg.customer.id}/identity`, { body: { decision: 'verify' } });

// 2) Commande → dépôt attendu (urgent) → acompte → solde → logistique
await call(A, '/admin/settings/transport', { method: 'PUT', body: { mobile: { numbers: { mtn: '06 600 00 00' } } } });
const o = (await call(C, '/orders', { body: { customer: { name: 'Awa Alerte', phone: '061234567', city: 'Pointe-Noire', address: 'Mpita' }, items: [{ productId: 'a072', qty: 1 }] } })).data;
m = await waitMail((x) => x.subject.includes(o.id) && /Nouvelle commande/.test(x.subject));
ok(m && /En attente de paiement/.test(m.body) && /Awa Alerte/.test(m.body) && /Ouvrir dans Zado Pro/.test(m.body) && m.body.includes(`/admin/#/commande/${o.id}`), 'nouvelle commande : articles, client, lien direct vers la commande');
ok(!m.body.includes(o.deliveryCode || '§§') && !/code de livraison/i.test(m.body), "jamais le code de livraison dans l'e-mail");
await call(C, '/payments', { body: { orderId: o.id, token: o.token, method: 'mobile', mode: 'push', phone: '061234567' } });
m = await waitMail((x) => /Dépôt attendu/.test(x.subject) && x.subject.includes(o.id));
ok(m && /⚡/.test(m.subject) && /MTN MoMo/.test(m.body) && /Dépôt reçu/.test(m.body), 'dépôt attendu : alerte URGENTE (⚡) « vérifiez votre téléphone, puis Dépôt reçu »');
await call(A, `/admin/orders/${o.id}/transfer-received`, { method: 'POST' });
ok(await waitMail((x) => /Acompte reçu/.test(x.subject) && x.subject.includes(o.id)), 'acompte reçu : commande confirmée');
await call(A, `/admin/orders/${o.id}/transfer-received`, { method: 'POST' });
ok(await waitMail((x) => /Commande payée/.test(x.subject) && x.subject.includes(o.id)), 'solde reçu : commande payée');
await call(A, `/admin/orders/${o.id}/logistics`, { body: { step: 'bought' } });
ok(await waitMail((x) => /Achetée en France/.test(x.subject) && x.subject.includes(o.id)), 'logistique : « Achetée en France »');
await sleep(800);
ok(mails.filter((x) => /Commande payée/.test(x.subject) && x.subject.includes(o.id)).length === 1, 'aucun e-mail en double (anciennes alertes remplacées)');

// 3) Messagerie : un visiteur demande un conseiller
const m1 = await call(null, '/chat/messages', { body: { text: 'Bonjour, ma commande ?' } });
const H = { 'X-Chat-Token': m1.data.token };
await call(null, '/chat/human', { body: { name: 'Bob Visiteur', phone: '06 123 45 67' }, headers: H });
m = await waitMail((x) => /Bob Visiteur demande un conseiller/.test(x.subject));
ok(m && /⚡/.test(m.subject) && /ma commande/.test(m.body), 'conseiller demandé : alerte urgente avec le message du client');
await call(null, '/chat/messages', { body: { text: 'Vous êtes là ?' }, headers: H });
ok(await waitMail((x) => /Message de Bob Visiteur/.test(x.subject) && /Vous êtes là/.test(x.body)), 'message suivant du client : alerte « Message de … »');

// 4) Type désactivé : gardé dans l'historique, pas d'e-mail
await call(A, '/admin/alerts/settings', { method: 'PUT', body: { types: { 'order.new': false } } });
const n0 = mails.length;
const o2 = (await call(C, '/orders', { body: { customer: { name: 'Awa Alerte', phone: '061234567', city: 'Pointe-Noire', address: 'Mpita' }, items: [{ productId: 'a072', qty: 1 }] } })).data;
await sleep(1500);
d = (await call(A, '/admin/alerts')).data;
const h2 = d.history.find((a) => a.ref === o2.id && a.type === 'order.new');
ok(h2 && h2.emailed === false && /désactivée/.test(h2.emailNote) && !mails.slice(n0).some((x) => x.subject.includes(o2.id)), 'alerte coupée : notée dans l\'historique, aucun e-mail');
await call(C, `/orders/${o2.id}/cancel`, { headers: { 'X-Order-Token': o2.token }, body: {} });
m = await waitMail((x) => /Annulée/.test(x.subject) && x.subject.includes(o2.id));
ok(m && /Motif/.test(m.body), 'commande annulée : alerte avec le motif');

// 5) Historique, filtre, test, résumé du matin
ok(d.history.some((a) => a.type === 'payment.transfer' && a.emailed === true) && d.last24h >= 8, `historique : ${d.history.length} alertes, état de l'envoi gardé`);
ok((await call(A, '/admin/alerts?cat=paiements')).data.history.every((a) => /^(payment|order)\./.test(a.type) && ['payment.transfer', 'order.confirmed', 'order.paid', 'order.reservation', 'order.paidAfterCancel'].includes(a.type)), 'filtre par catégorie (Paiements)');
ok((await call(A, '/admin/alerts/test', { method: 'POST' })).status === 200 && await waitMail((x) => /e-mail de test/.test(x.subject)), 'bouton « Envoyer un e-mail de test »');
const dg = (await call(A, '/admin/alerts/digest', { method: 'POST' })).data;
m = await waitMail((x) => /Résumé du/.test(x.subject));
ok(dg.ok && m && /Dernières 24 h/.test(m.body) && /commande\(s\) créée\(s\)/.test(m.body), 'résumé du matin : chiffres des dernières 24 h + choses à faire');
const act = (await call(A, '/admin/activity')).data;
ok(act.some((a) => a.action === 'Réglages des notifications modifiés') && act.some((a) => a.action === 'E-mail de test des notifications'), 'journal : réglages et e-mail de test');

console.log(`(${mails.length} e-mails reçus par le faux serveur)`);
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
