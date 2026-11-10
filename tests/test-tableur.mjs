// Sélection Noël 2026 (585 articles) + « Base de données » façon Excel dans Zado Pro (10/11/2026).
// Lancer : zsh tests/run-test.sh test-tableur.mjs tests/id.jpg
import fs from 'node:fs';
import zlib from 'node:zlib';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const buf = Buffer.from(await r.arrayBuffer()); let data; try { data = JSON.parse(buf.toString('utf8')); } catch { data = buf; } return { status: r.status, data, type: r.headers.get('content-type') || '' }; };

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });

// ---- Catalogue : sélection importée ----
const sel = JSON.parse(fs.readFileSync(new URL('../data/selection-noel-2026.json', import.meta.url)));
const list = (await call(null, '/products')).data;
const mine = list.filter((p) => p.selection === 'Noël 2026');
ok(sel.length === 585 && mine.length === 585, `sélection Noël : ${mine.length} articles visibles dans la boutique (185 de la liste + 400 nouveaux)`);
const cfg = (await call(null, '/config')).data;
const cats = (cfg.universes || []).flatMap((u) => u.categories);
ok(['Photo & vidéo', 'Jouets high-tech', 'Beauté & bien-être'].every((c) => cats.includes(c)), 'nouveaux rayons : Photo & vidéo, Jouets high-tech, Beauté & bien-être');
ok(mine.every((p) => cats.includes(p.category)), 'chaque article est dans un rayon de la boutique');
const one = mine.find((p) => p.sourceSupplier === 'Cdiscount');
ok(one && !('priceRefs' in one) && !('sourceRating' in one) && !('costPrice' in one), 'boutique : ni lien source, ni note du site, ni prix d\'achat');
ok(mine.every((p) => p.stock == null && p.price >= 4500 && p.price <= 23000), 'stock « sur commande » et prix entre 4 500 et 23 000 FCFA');
ok(mine.every((p) => p.sourcePrice > 0 && p.price > p.sourcePrice), 'prix Zado = prix fournisseur (prix normal en France) + marge');
const n001 = sel.find((p) => p.id === 'n001');
ok(n001.priceRefs[0].watch === false && n001.priceRefs[0].status === 'manual', 'Cdiscount / Boulanger refusent les robots : pas de relevé quotidien (watch: false)');

// ---- Tableur : accès ----
ok((await call(null, '/admin/tableur')).status === 401, 'tableur : refusé sans connexion');
const staff = (await call(A, '/admin/staff', { body: { login: 'cata-tab', name: 'Cata Tab', role: 'catalog' } })).data;
const C = { c: '' };
const tmp = staff.tempPassword || staff.password;
await call(C, '/admin/login', { body: { login: 'cata-tab', password: tmp } });
ok((await call(C, '/admin/tableur')).status === 403, 'tableur : refusé au responsable catalogue (administrateur seulement)');

const sheets = (await call(A, '/admin/tableur')).data.sheets;
ok(sheets.length >= 16 && sheets.find((s) => s.key === 'produits')?.count >= 680, `${sheets.length} feuilles : ${sheets.map((s) => s.label).join(', ')}`);
const prod = (await call(A, '/admin/tableur/sheet/produits')).data;
ok(prod.editable === true && prod.cols.some((c) => c.k === 'price' && c.e) && prod.rows.length >= 680, 'feuille Produits : modifiable, colonnes typées');
const row = prod.rows.find((r) => r.id === 'n001');
ok(row && row.sourceUrl?.startsWith('https://') && row.sourceRating !== undefined && row.margin === row.price - row.costPrice && row._href === '#/produit/n001', 'ligne produit : lien source, marge calculée, lien vers la fiche');

// ---- Rien de secret dans le tableur ----
const C1 = (await call(null, '/account/register', { body: { name: 'Awa Tableur', phone: '061234111', idType: 'cni', idPhoto: 'data:image/jpeg;base64,' + fs.readFileSync(process.argv[3]).toString('base64') } })).data;
const all = [];
for (const s of sheets) all.push(JSON.stringify((await call(A, '/admin/tableur/sheet/' + s.key)).data));
const blob = all.join('');
ok(blob.includes('Awa Tableur') && !/codeHash|codeSealed|passwordHash|passwordSealed|passkeys|idPhoto|tempPassword/.test(blob) && !blob.includes(C1.code || 'xxxxxx'), 'aucun code client, mot de passe ni photo de pièce dans le tableur');

// ---- Modifier depuis le tableur (via la fiche produit) ----
let r = await call(A, '/admin/products/n001', { method: 'PATCH', body: { price: 15000 } });
ok(r.status === 200 && r.data.price === 15000, 'modification du prix depuis la grille');
r = await call(A, '/admin/products/n001', { method: 'PATCH', body: { stock: 4 } });
r = await call(A, '/admin/products/n001', { method: 'PATCH', body: { stock: '' } });
ok(r.status === 200 && r.data.stock == null, 'stock vidé = de nouveau « sur commande »');
ok((await call(A, '/admin/products/n001', { method: 'PATCH', body: { stock: -2 } })).status === 400, 'stock négatif refusé');
const journal = (await call(A, '/admin/activity')).data;
ok(journal.some((a) => a.action === 'Produit modifié' && a.targetId === 'n001'), 'chaque modification est notée au journal');

// ---- Exports ----
const csv = await call(A, '/admin/tableur/csv/produits');
ok(/text\/csv/.test(csv.type) && csv.data.toString('utf8').startsWith('﻿Réf;Nom;'), 'export CSV de la feuille (Excel, « ; », accents)');
const x = await call(A, '/admin/tableur/zado.xlsx');
const buf = x.data;
ok(/spreadsheetml/.test(x.type) && buf.slice(0, 2).toString() === 'PK', 'export Excel : vrai fichier .xlsx');
// lecture du ZIP : noms des fichiers + contenu d'une feuille
const files = {}; let o = 0;
while (buf.readUInt32LE(o) === 0x04034b50) { const csz = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), el = buf.readUInt16LE(o + 28); const name = buf.slice(o + 30, o + 30 + nl).toString(); const data = buf.slice(o + 30 + nl + el, o + 30 + nl + el + csz); files[name] = zlib.inflateRawSync(data).toString('utf8'); o += 30 + nl + el + csz; }
const wb = files['xl/workbook.xml'] || '';
ok((wb.match(/<sheet /g) || []).length === sheets.length + 1 && wb.includes('name="Synthèse"') && wb.includes('name="Produits"'), `classeur : ${sheets.length + 1} feuilles (Synthèse + une par sujet)`);
const s2 = files['xl/worksheets/sheet2.xml'] || '';
ok(s2.includes('state="frozen"') && s2.includes('<autoFilter') && s2.includes('n001') && s2.includes('s="2"'), 'feuille Produits : en-tête figé, filtres, montants au format FCFA');
ok((await call(C, '/admin/tableur/zado.xlsx')).status === 403, 'export Excel refusé hors administrateur');

console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
