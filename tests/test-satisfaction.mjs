// Avis sur le SERVICE (commande livrée) et sur l'APPLICATION (18/11/2026) : règles, mise à jour, Zado Pro → Satisfaction,
// alerte « avis négatif », note publique seulement à partir de 5 avis. Lancer : zsh tests/run-test.sh test-satisfaction.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
const DB = path.join(path.dirname(process.argv[2]), 't-run.db');
let ko = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) ko++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body ? JSON.stringify(o.body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };

// Deux commandes de test écrites dans la base : une livrée, une seulement payée
const mk = (id, status, token) => ({ id, status, accessToken: token, createdAt: new Date().toISOString(), customer: { name: 'Awa Mbemba', phone: '061234567', city: 'Pointe-Noire' }, lines: [{ productId: 'a002', name: 'Test', qty: 1, price: 1000 }], total: 1000, history: [] });
execFileSync('node', ['-e', `const s=require('./src/store');for(const o of ${JSON.stringify([mk('CMD-SAT-1', 'delivered', 'tok-livree-123'), mk('CMD-SAT-2', 'paid', 'tok-payee-456')])})s.orders.insert(o);`], { env: { ...process.env, DB_FILE: DB } });

const opt = (await call(null, '/feedback/options')).data;
ok(opt.tags?.service?.good?.length && opt.tags?.app?.bad?.length, 'options : points forts / à améliorer pour le service et le site');

ok((await call(null, '/feedback', { body: { kind: 'service', orderId: 'CMD-SAT-1', rating: 5 } })).status === 404, 'service : sans la clé de la commande, refusé');
ok((await call(null, '/feedback', { body: { kind: 'service', orderId: 'CMD-SAT-1', token: 'tok-livree-123', rating: 0 } })).status === 400, 'service : note obligatoire (1 à 5)');
const r1 = await call(null, '/feedback', { body: { kind: 'service', orderId: 'CMD-SAT-1', token: 'tok-livree-123', rating: 5, nps: 10, tags: ['Livraison rapide', 'pirate'], text: 'Top <script>alert(1)</script>', route: '#/suivi/CMD-SAT-1', device: { mobile: true, standalone: true, width: 390 } } });
ok(r1.status === 201 && r1.data.feedback.rating === 5 && r1.data.feedback.tags.join() === 'Livraison rapide' && !/[<>]/.test(r1.data.feedback.text), 'service : avis enregistré (point inconnu retiré, < > retirés)');
const mine = (await call(null, '/feedback/mine?order=CMD-SAT-1&token=tok-livree-123')).data;
ok(mine.canRate && mine.feedback?.rating === 5 && mine.feedback.nps === 10, 'service : le client retrouve son avis');
const r2 = await call(null, '/feedback', { body: { kind: 'service', orderId: 'CMD-SAT-1', token: 'tok-livree-123', rating: 2, nps: 4, tags: ['Retard de livraison'], text: 'Livré avec 3 jours de retard' } });
ok(r2.status === 200 && r2.data.updated && r2.data.feedback.rating === 2, 'service : un seul avis par commande, modifiable');
ok((await call(null, '/feedback', { body: { kind: 'service', orderId: 'CMD-SAT-2', token: 'tok-payee-456', rating: 4 } })).status === 409, 'service : impossible avant la livraison');
ok((await call(null, '/feedback/mine?order=CMD-SAT-2&token=tok-payee-456')).data.canRate === false, 'service : la boutique sait qu\'il faut attendre la livraison');
const a1 = await call(null, '/feedback', { body: { kind: 'app', rating: 4, tags: ['Facile à utiliser'], text: 'Très clair', route: '#/commande', device: { mobile: false } } });
ok(a1.status === 201, 'site : un visiteur peut donner son avis sur la facilité d\'utilisation');
ok((await call(null, '/feedback', { body: { kind: 'autre', rating: 3 } })).status === 400, 'type d\'avis inconnu : refusé');

// Zado Pro
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
ok((await call(null, '/admin/feedback')).status === 401, 'Zado Pro : réservé à l\'équipe');
const adm = (await call(A, '/admin/feedback')).data;
ok(adm.list.length === 2 && adm.stats.service.count === 1 && adm.stats.service.avg === 2 && adm.stats.app.avg === 4, 'Zado Pro : avis et notes moyennes');
ok(adm.stats.service.nps?.score === -100 && adm.stats.service.bad.find(([t]) => t === 'Retard de livraison')[1] === 1, 'Zado Pro : indice de recommandation et points à améliorer');
const svc = adm.list.find((x) => x.kind === 'service');
ok(svc.order?.id === 'CMD-SAT-1' && svc.phone === '061234567' && svc.status === 'new', 'Zado Pro : commande et téléphone du client pour le rappeler');
const p = await call(A, '/admin/feedback/' + svc.id, { method: 'PATCH', body: { status: 'done', note: 'Rappelée, geste commercial' } });
ok(p.status === 200 && p.data.status === 'done' && p.data.handledBy && p.data.note, 'Zado Pro : avis marqué « Traité » avec une note interne');
const csv = await fetch(B + '/admin/feedback/export.csv', { headers: { Cookie: A.c } });
ok(csv.status === 200 && (await csv.text()).includes('Recommandation /10'), 'Zado Pro : export Excel');
const al = (await call(A, '/admin/alerts?type=feedback.bad')).data;
ok(JSON.stringify(al).includes('Avis négatif'), 'alerte « avis négatif » envoyée à l\'équipe');

// Note publique : seulement à partir de 5 avis sur le service
ok((await call(null, '/config')).data.satisfaction === null, 'boutique : pas de note publique avant 5 avis');
const more = Array.from({ length: 4 }, (_, i) => mk(`CMD-SAT-${10 + i}`, 'delivered', `tok-x-${i}-abcdef`));
execFileSync('node', ['-e', `const s=require('./src/store');for(const o of ${JSON.stringify(more)})s.orders.insert(o);`], { env: { ...process.env, DB_FILE: DB } });
for (const [i, o] of more.entries()) await call(null, '/feedback', { body: { kind: 'service', orderId: o.id, token: o.accessToken, rating: i < 3 ? 5 : 4 } });
const cfg = (await call(null, '/config')).data.satisfaction;
ok(cfg && cfg.count === 5 && cfg.avg === 4.2, `boutique : note publique du service à partir de 5 avis (${cfg?.avg}/5)`);

console.log(ko ? `${ko} ÉCHEC(S)` : 'TOUT EST OK');
process.exit(ko ? 1 : 0);
