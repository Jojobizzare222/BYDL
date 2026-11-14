// Ouverture de la vraie boutique (10/11/2026) : paiements RÉELS (PAYMENT_MODE=live) SANS compte marchand MTN / Airtel.
// La demande sur le téléphone (« par retrait ») ne doit jamais être proposée ni acceptée ; seul le « dépôt » marche.
// Lancer : PAYMENT_MODE=live zsh tests/run-test.sh test-production.mjs tests/id.jpg
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const C = { c: '' };
const reg = (await call(C, '/account/register', { body: { name: 'Awa Live', phone: '061114455', idType: 'cni', idPhoto: 'data:image/jpeg;base64,' + fs.readFileSync(process.argv[3]).toString('base64') } })).data;
await call(A, `/admin/customers/${reg.customer.id}/identity`, { body: { decision: 'verify' } });

let m = (await call(C, '/payments/methods')).data;
ok(m.mode === 'live' && m.mobile.pull === false && m.momo === false && !m.mobile.enabled, 'paiements réels sans compte marchand ni numéro de dépôt : aucun Mobile Money proposé (rien ne peut échouer au paiement)');
await call(A, '/admin/settings/transport', { method: 'PUT', body: { mobile: { numbers: { airtel: '05 590 00 00' } } } });
m = (await call(C, '/payments/methods')).data;
ok(m.mobile.enabled && m.mobile.push && m.mobile.pull === false, 'numéro Airtel de Zado saisi : seul le « dépôt » est proposé');

const order = async () => (await call(C, '/orders', { body: { customer: { name: 'Awa Live', phone: '053590000', city: 'Pointe-Noire', address: 'Tié-Tié' }, items: [{ productId: 'a072', qty: 1 }] } })).data;
const o1 = await order();
const pull = await call(C, '/payments', { body: { orderId: o1.id, token: o1.token, method: 'mobile', mode: 'pull', phone: '053590000' } });
ok(pull.status === 400 && /dépôt/.test(pull.data.error), '« par retrait » refusé par le serveur même si on le force : « choisissez Par dépôt »');
const momo = await call(C, '/payments', { body: { orderId: o1.id, token: o1.token, method: 'momo', phone: '053590000' } });
ok(momo.status === 400, 'paiement Mobile Money direct refusé sans compte marchand');
const push = await call(C, '/payments', { body: { orderId: o1.id, token: o1.token, method: 'mobile', mode: 'push', phone: '053590000' } });
ok(push.status === 201 && push.data.operator === 'transfer' && push.data.status === 'PENDING' && push.data.amount === o1.total, `dépôt : commande enregistrée, en attente du dépôt du TOTAL (${push.data.amount} FCFA, pas d'acompte depuis le 14/11/2026 ; aucune validation automatique)`);
await new Promise((r) => setTimeout(r, 9000)); // en simulation, un paiement serait validé tout seul après ~8 s
const after = (await call(C, `/orders/${o1.id}`, { headers: { 'X-Order-Token': o1.token } })).data;
ok(after.status === 'pending_payment', 'rien n\'est validé sans « Dépôt reçu » cliqué par l\'équipe (pas de paiement simulé en production)');
const rec = await call(A, `/admin/orders/${o1.id}/transfer-received`, { body: {} });
const conf = (await call(C, `/orders/${o1.id}`, { headers: { 'X-Order-Token': o1.token } })).data;
ok(rec.status === 200 && conf.status === 'paid' && conf.balancePaid, '« Dépôt reçu » du total : commande payée en une fois');
const docs = (conf.documents || []).map((d) => d.type).sort().join(',');
ok(docs === 'invoice,receipt', `documents : une facture + un seul reçu (${docs})`);
const inv = (conf.documents || []).find((d) => d.type === 'invoice');
const ih = inv ? await (await fetch(`http://localhost:3999${inv.link}`)).text() : '';
ok(ih.length > 500 && !/Acompte/.test(ih), 'facture : aucune mention d\'acompte');
const conv = (await call(C, '/chat')).data;
const txt = JSON.stringify(conv);
ok(/Paiement reçu en totalité/.test(txt) && !/Acompte reçu/.test(txt), 'récapitulatif dans « Aide » : paiement reçu en totalité, pas d\'acompte');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
