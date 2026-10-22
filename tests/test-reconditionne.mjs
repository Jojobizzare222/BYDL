// Appareils reconditionnés (22/10/2026) : sélection de départ, état / batterie / garantie, fournisseur réel, filtres côté données
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };

const list = (await call(null, '/products')).data;
const refurb = list.filter((p) => p.condition === 'reconditionné');
ok(refurb.length >= 8, `boutique : ${refurb.length} appareils reconditionnés au catalogue`);
const r4 = refurb.find((p) => p.id === 'r004');
ok(r4 && r4.refurb.grade === 'parfait' && r4.refurb.battery === 80 && r4.refurb.warrantyMonths === 6 && r4.refurb.newPriceEur === 719 && r4.sourceSupplier === 'Back Market' && r4.provenance === 'France', 'iPhone 16e : parfait état, batterie ≥ 80 %, garantie Zado 6 mois, prix du neuf, fournisseur Back Market');
ok(refurb.every((p) => p.sourcePrice > 0 && p.price > p.sourcePrice && !('priceRefs' in p) && !('costPrice' in p)), 'prix fournisseur public < prix Zado ; prix relevés et prix d\'achat jamais publiés');
ok(refurb.filter((p) => p.refurb.newPriceEur).every((p) => ['r004', 'r006'].includes(p.id)), 'prix du neuf seulement pour les modèles encore vendus neufs (pas de comparaison trompeuse)');

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const up = await call(A, '/admin/products/r002', { method: 'PATCH', body: { refurb: { grade: 'tres-bon', battery: '88', warrantyMonths: '6', newPriceEur: '' } } });
ok(up.status === 200 && up.data.refurb.grade === 'tres-bon' && up.data.refurb.battery === 88 && up.data.refurb.warrantyMonths === 6 && up.data.sourceSupplier === 'Back Market', 'Zado Pro : état, batterie, garantie modifiés ; Apple reconditionné garde son vrai vendeur');
ok((await call(A, '/admin/products/r002', { method: 'PATCH', body: { refurb: { grade: 'abime' } } })).status === 400, 'niveau d\'état inconnu : refusé');
const nw = await call(A, '/admin/products/r003', { method: 'PATCH', body: { condition: 'neuf' } });
ok(nw.status === 200 && !nw.data.refurb && nw.data.sourceSupplier === 'Apple Store', 'repassé en « neuf » : plus de détails reconditionné, Apple Store forcé');
// Points relais (22/10/2026) : masqués tant qu'aucun n'est actif, de retour dès qu'un point relais est ouvert
const cfg0 = (await call(null, '/config')).data, w0 = (await call(null, '/chat')).data.welcome;
ok(cfg0.relays === 0 && !w0.quick.includes('Points relais'), 'sans point relais : la boutique et l\'assistant n\'en parlent pas');
await call(A, '/admin/agencies', { body: { name: 'Relais Test', city: 'Pointe-Noire', kind: 'partner', lat: -4.78, lng: 11.86 } });
const cfg1 = (await call(null, '/config')).data, w1 = (await call(null, '/chat')).data.welcome;
ok(cfg1.relays === 1 && w1.quick.includes('Points relais'), 'un point relais ouvert : il réapparaît partout');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
