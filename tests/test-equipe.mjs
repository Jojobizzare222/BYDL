// Équipe : mot de passe provisoire visible par l'admin, « Se connecter en tant que » et retour à son compte
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const created = (await call(A, '/admin/staff', { body: { name: 'Didier Livreur', login: 'didier.eq', role: 'courier' } })).data;
const id = created.user.id;
const row = async () => (await call(A, '/admin/staff')).data.staff.find((u) => u.id === id);
let r = await row();
ok(r.password.state === 'temp' && r.password.value === created.password && !('passwordSealed' in r) && !('passwordHash' in r), 'liste de l\'équipe : mot de passe provisoire affiché, empreinte et copie chiffrée jamais envoyées');
const reset = (await call(A, `/admin/staff/${id}/reset-password`, { body: {} })).data;
r = await row();
ok(reset.password && reset.password !== created.password && r.password.value === reset.password, 'nouveau mot de passe : affiché dans la colonne');

// La personne se connecte et choisit son mot de passe : il n'est plus lisible
const D = { c: '' };
ok((await call(D, '/admin/login', { body: { login: 'didier.eq', password: reset.password } })).status === 200, 'connexion avec le mot de passe provisoire');
ok((await call(D, '/admin/staff')).status === 403, 'livreur : pas d\'accès à l\'équipe');
await call(D, '/admin/me/password', { body: { current: reset.password, next: 'mon-secret-perso-42' } });
r = await row();
ok(r.password.state === 'own' && r.password.value === null, 'mot de passe choisi par la personne : plus affiché (illisible)');
const raw = fs.readFileSync(new URL('./.run/t-run.db', import.meta.url)).toString('latin1');
ok(!raw.includes('mon-secret-perso-42'), 'le mot de passe personnel n\'est stocké nulle part en clair');

// Se connecter en tant que
const before = { ...A };
const imp = await call(A, `/admin/staff/${id}/impersonate`, { body: {} });
ok(imp.status === 200, 'admin : « Se connecter en tant que » Didier');
const me = (await call(A, '/admin/me')).data.user;
ok(me.id === id && me.role === 'courier' && me.impersonatedBy === 'Administrateur' && me.mustChangePassword === false, 'session : Didier (livreur), marquée « par l\'administrateur »');
ok((await call(A, '/admin/staff')).status === 403 && (await call(A, '/admin/courier/deliveries')).status === 200, 'droits exactement ceux du livreur');
ok((await call(A, '/admin/me/password', { body: { current: 'x', next: 'xxxxxxxxxxxx' } })).status === 403, 'en tant que : impossible de changer le mot de passe de la personne');
ok((await call(before, '/admin/me')).data.user === null, 'l\'ancienne session admin de ce navigateur est fermée');
ok((await call(D, '/admin/staff/' + id + '/impersonate', { body: {} })).status === 403, 'un livreur ne peut pas se connecter en tant qu\'un autre');
ok((await call(D, '/admin/me/impersonate/stop', { body: {} })).status === 400, 'le vrai Didier ne peut pas « revenir » au compte admin');
const back = await call(A, '/admin/me/impersonate/stop', { body: {} });
const me2 = (await call(A, '/admin/me')).data.user;
ok(back.status === 200 && me2.role === 'admin' && !me2.impersonatedBy, '« Revenir à mon compte » : de nouveau administrateur');
const act = (await call(A, '/admin/activity')).data;
ok(act.some((x) => x.action === 'Connexion en tant que') && act.some((x) => x.action === 'Retour à son compte'), 'début et fin notés dans le journal');
await call(A, `/admin/staff/${id}`, { method: 'PATCH', body: { active: false } });
ok((await call(A, `/admin/staff/${id}/impersonate`, { body: {} })).status === 400, 'compte désactivé : connexion « en tant que » refusée');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
