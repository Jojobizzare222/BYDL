// Nouveaux articles du 15/11/2026 (consoles, jeux, écrans, téléviseurs, petits meubles, mode, chaussures, lunettes, whey)
// Lancer : zsh tests/run-test.sh test-catalogue-1115.mjs
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const B = 'http://localhost:3999/api';
const DB = path.join(path.dirname(process.argv[2]), 't-run.db');
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const run = (...a) => execFileSync('node', ['scripts/catalogue-2026-11-15.js', ...a], { env: { ...process.env, DB_FILE: DB }, encoding: 'utf8' });
const get = async (p) => { const r = await fetch(B + p); return { status: r.status, data: await r.json().catch(() => null) }; };

const pre = run();
const n = Number(pre.match(/(\d+) article\(s\) à ajouter/)?.[1]);
ok(/Aperçu seulement/.test(pre) && n >= 150, `aperçu : ${n} articles prévus, rien n'est écrit`);
ok((await get('/products/gv021')).status === 404, 'aperçu : rien n\'est ajouté');
ok(run('--confirmer').includes(`✓ ${n} article(s) ajouté(s)`), 'import confirmé');
ok(/0 article\(s\) à ajouter/.test(run()), 'relancer : rien n\'est ajouté deux fois');
const cfg = (await get('/config')).data;
const cats = cfg.universes.flatMap((u) => u.categories);
ok(['Écrans', 'Mode homme', 'Mode femme', 'Chaussures', 'Lunettes', 'Maison & déco', 'Sport & nutrition'].every((c) => cats.includes(c)), 'nouveaux rayons servis à la boutique');
const gta = (await get('/products/gv021')).data;
ok(/Grand Theft Auto VI/.test(gta.name) && gta.preorder?.releaseDate === '2026-11-19' && gta.options.some((o) => o.name === 'Plateforme'), 'GTA VI : précommande (sortie le 19/11/2026), choix de la plateforme');
const af1 = (await get('/products/mo001')).data;
ok(af1.universe === 'Mode' && af1.category === 'Chaussures' && af1.options.map((o) => o.name).join() === 'Pointure,Couleur' && af1.provenance === 'France' && af1.sourceSupplier === 'Nike', 'baskets : univers Mode, pointure et couleur, provenance France chez Nike');
const tv = (await get('/products/tv003')).data;
ok(/^Téléviseur/.test(tv.name) && tv.weightKg >= 8 && tv.category === 'TV & Maison', 'téléviseur : rangé dans TV & Maison avec le poids réel du colis');
const md = (await get('/products?category=Maison%20%26%20d%C3%A9co')).data;
const list = Array.isArray(md) ? md : md.products;
ok(list.length > 0 && list.every((p) => p.weightKg > 0 && p.weightKg <= 15) && !list.some((p) => /miroir/i.test(p.name)), 'petits meubles : tous ≤ 15 kg, sans miroir');
const sr = async (q) => { const d = (await get('/products?q=' + encodeURIComponent(q))).data; return (Array.isArray(d) ? d : d.products).map((p) => p.id); };
ok((await sr('gta 6'))[0] === 'gv021' && (await sr('GTA VI'))[0] === 'gv021' && (await sr('gta')).includes('gv021'), 'recherche : « GTA 6 », « GTA VI » et « gta » trouvent Grand Theft Auto VI');
ok(tv.costPrice === undefined, 'prix d\'achat jamais envoyé à la boutique');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
