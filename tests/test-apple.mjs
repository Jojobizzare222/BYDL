// Catalogue Apple NEUF acheté à l'Apple Store France (demande Joseph 14/11/2026) : scripts/apple-catalogue.js + data/apple-2026-11.json.
// Lancer : zsh tests/run-test.sh test-apple.mjs tests/id.jpg
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
const DB = path.join(path.dirname(process.argv[2]), 't-run.db');
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const run = (...a) => execFileSync('node', ['scripts/apple-catalogue.js', ...a], { env: { ...process.env, DB_FILE: DB }, encoding: 'utf8' });

const preview = run();
const n = Number(preview.match(/(\d+) article\(s\) à ajouter/)?.[1]);
const dup = (preview.match(/déjà en boutique/g) || []).length;
ok(/Aperçu seulement/.test(preview) && n + dup === 90, `aperçu : ${n} articles Apple prévus + ${dup} déjà en boutique (même nom, sautés), rien n'est écrit`);
ok((await call(null, '/products/ap001')).status === 404, 'aperçu : aucun article ajouté');
const done = run('--confirmer');
ok(done.includes(`✓ ${n} article(s) Apple ajouté(s)`), `import confirmé : ${n} articles ajoutés`);
ok(/0 article\(s\) à ajouter/.test(run('--confirmer')), 'relancer l\'import : rien n\'est ajouté deux fois');

const data = JSON.parse(fs.readFileSync('data/apple-2026-11.json', 'utf8'));
ok(!data.some((m) => /iPhone (Air|Duo)|Vision/.test(m.name)), 'iPhone Air, iPhone Duo (eSIM uniquement) et Vision Pro écartés, ni leurs coques');
ok(data.filter((m) => m.category === 'Tablettes').every((m) => m.configs.every((c) => !/Cellular/.test(c.label))), 'iPad : versions Wi-Fi seulement (Cellular = eSIM uniquement chez Apple)');

const mba = (await call(null, '/products/ap009')).data;
ok(mba.provenance === 'France' && mba.sourceSupplier === 'Apple Store' && mba.condition === 'neuf' && mba.active !== false, 'MacBook Air : neuf, provenance France, fournisseur Apple Store, visible');
ok(mba.specs.some((s) => s.label === 'Provenance' && /Apple Store France \(apple\.com\/fr\)/.test(s.value)) && /acheté directement à l'Apple Store France/.test(mba.description) && /Apple Store France/.test(mba.highlights[0]), 'provenance écrite sur la fiche : caractéristique, description et 1er point fort');
ok(mba.costPrice === undefined && mba.sourceRating === undefined, 'prix d\'achat jamais envoyé à la boutique');
ok(mba.stock == null, '« sur commande » (stock vide)');
const cfg = mba.options.find((o) => o.name === 'Configuration');
const big = cfg.values[cfg.values.length - 1];
ok(cfg.values.length === 4 && cfg.extra[big] > 0 && mba.options.some((o) => o.name === 'Couleur'), `choix « Configuration » (4, dont ${big} +${cfg.extra[big]} FCFA) et « Couleur »`);
const ip16 = (await call(null, '/products/ap001')).data;
ok(ip16.name === 'Apple iPhone 16 128 Go' && ip16.price === 782500, `iPhone 16 128 Go : 1 019 € → ${ip16.price} FCFA (règle de prix Zado : marge 17 %, arrondi 500)`);
const list = (await call(null, '/products?q=apple+store')).data;
ok(Array.isArray(list) || Array.isArray(list?.products), 'catalogue lisible');

// Commande avec la configuration la plus chère : prix recalculé par le serveur
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const C = { c: '' };
const reg = (await call(C, '/account/register', { body: { name: 'Awa Apple', phone: '061117788', idType: 'cni', idPhoto: 'data:image/jpeg;base64,' + fs.readFileSync(process.argv[3]).toString('base64') } })).data;
await call(A, `/admin/customers/${reg.customer.id}/identity`, { body: { decision: 'verify' } });
const o = (await call(C, '/orders', { body: { customer: { name: 'Awa Apple', phone: '061117788', city: 'Pointe-Noire', address: 'Loandjili' }, items: [{ productId: 'ap009', qty: 1, variant: { Configuration: big, Couleur: 'Minuit' } }] } })).data;
ok(o?.lines?.[0]?.unitPrice === mba.price + cfg.extra[big], `commande : ${big} facturé ${o?.lines?.[0]?.unitPrice} FCFA (base + supplément)`);
ok(o.transportFee === Math.round(mba.weightKg * 17.8 * 655.957), `transport au poids du colis (${mba.weightKg} kg)`);

// Zado Pro : la fiche s'ouvre et se réenregistre sans rien perdre (choix, suppléments)
const pro = (await call(A, '/admin/products/ap009')).data;
const re = (await call(A, '/admin/products/ap009', { method: 'PATCH', body: { options: pro.options, specs: pro.specs, highlights: pro.highlights } })).data;
ok(JSON.stringify(re.options) === JSON.stringify(mba.options) && JSON.stringify(re.specs) === JSON.stringify(mba.specs), 'Zado Pro : réenregistrer la fiche ne change ni les choix, ni les suppléments, ni les caractéristiques');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
