// Codes Zado des clients (21/10/2026) : l'administrateur voit le code d'un client (copie chiffrée, inscrit au journal)
// et peut le modifier (code choisi ou tiré au hasard). Lancer : zsh tests/run-test.sh test-codes.mjs tests/id.jpg
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '' }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; return { status: r.status, data: await r.json().catch(() => null), headers: r.headers }; };
const ID = { idType: 'cni', idPhoto: 'data:image/jpeg;base64,' + fs.readFileSync(process.argv[3]).toString('base64') };

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const C = { c: '' };
const reg = (await call(C, '/account/register', { body: { name: 'Awa Code', phone: '069991234', ...ID } })).data;
const id = reg.customer.id;
ok(/^[1-9]\d{5}$/.test(reg.code) && !('codeSealed' in reg.customer) && !('codeHash' in reg.customer), 'création du compte : code montré au client, jamais sa copie chiffrée');
ok(!('codeSealed' in (await call(C, '/account/me')).data.customer), 'compte client : pas de copie chiffrée dans les réponses');

const row = (await call(A, '/admin/customers')).data.find((c) => c.id === id);
ok(row.hasCode === true && !('code' in row) && !('codeSealed' in row) && !('codeHash' in row), 'liste des clients : indique seulement que le code est consultable');
const shown = await call(A, `/admin/customers/${id}/code`);
ok(shown.status === 200 && shown.data.code === reg.code && /no-store/.test(shown.headers.get('cache-control')), 'administrateur : voit le code exact du client (sans mise en cache)');
ok((await call(A, '/admin/activity')).data.some((a) => a.action === 'Code client affiché' && /Awa Code/.test(a.target?.name || a.targetName || JSON.stringify(a))), 'journal : affichage du code inscrit');

// Droits : seul l'administrateur
const mk = async (role, login) => { const r = (await call(A, '/admin/staff', { body: { name: login, login, role } })).data; const J = { c: '' }; await call(J, '/admin/login', { body: { login, password: r.password } }); return J; };
const O = await mk('orders', 'ord-code'), K = await mk('catalog', 'cat-code');
ok((await call(O, `/admin/customers/${id}/code`)).status === 403 && (await call(K, `/admin/customers/${id}/code`)).status === 403, 'employé Commandes / responsable catalogue : code refusé');
ok((await call(O, `/admin/customers/${id}/new-code`, { body: { code: '482913' } })).status === 403, 'employé Commandes : modification refusée');

// Modifier : code choisi
for (const [code, label] of [['012345', 'code commençant par 0 refusé'], ['12345', 'code de 5 chiffres refusé'], ['12a456', 'code avec lettre refusé']]) ok((await call(A, `/admin/customers/${id}/new-code`, { body: { code } })).status === 400, label);
const ch = await call(A, `/admin/customers/${id}/new-code`, { body: { code: '482 913' } });
ok(ch.status === 200 && ch.data.code === '482913', 'administrateur : code choisi enregistré (espaces ignorés)');
ok((await call(C, '/account/me')).data.loggedIn === false, 'client déconnecté de ses appareils après le changement');
ok((await call({ c: '' }, '/account/login', { body: { identifier: '069991234', code: reg.code } })).status === 401, 'ancien code refusé');
const C2 = { c: '' };
ok((await call(C2, '/account/login', { body: { identifier: '069991234', code: '482913' } })).status === 200, 'nouveau code accepté');
ok((await call(A, `/admin/customers/${id}/code`)).data.code === '482913', 'administrateur : voit le nouveau code');
ok((await call(A, '/admin/activity')).data.some((a) => a.action === 'Code client modifié'), 'journal : modification inscrite');

// Tiré au hasard, puis changé par le client lui-même : l'admin voit toujours le bon code
const rnd = (await call(A, `/admin/customers/${id}/new-code`, { body: {} })).data.code;
ok(/^[1-9]\d{5}$/.test(rnd) && rnd !== '482913', 'code tiré au hasard');
const C3 = { c: '' }; await call(C3, '/account/login', { body: { identifier: '069991234', code: rnd } });
const own = (await call(C3, '/account/code', { body: { code: rnd } })).data.code;
ok(/^[1-9]\d{5}$/.test(own) && (await call(A, `/admin/customers/${id}/code`)).data.code === own, 'code changé par le client : l\'administrateur voit le nouveau');

ok((await call(A, '/admin/customers/CLI-INCONNU/code')).status === 404, 'client inconnu : 404 avec explication');
console.log(fails ? `\n${fails} échec(s)` : '\nCodes clients : tout est OK');
process.exit(fails ? 1 : 0);
