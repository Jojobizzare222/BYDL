import fs from 'node:fs';
import { createRequire } from 'node:module';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data = null; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Montants en lettres
process.env.DB_FILE = process.argv[2].replace('pw.txt', 't-words.db');
const billing = createRequire(import.meta.url)('/Users/josephgambaka/Desktop/BYDL/src/billing.js');
const W = { 0: 'zéro', 21: 'vingt-et-un', 71: 'soixante-et-onze', 80: 'quatre-vingts', 81: 'quatre-vingt-un', 91: 'quatre-vingt-onze', 100: 'cent', 200: 'deux-cents', 201: 'deux-cent-un', 1000: 'mille', 1001: 'mille-un', 1100: 'mille-cent', 2000: 'deux-mille', 80000: 'quatre-vingt-mille', 200000: 'deux-cent-mille', 113500: 'cent-treize-mille-cinq-cents', 1000000: 'un-million', 2500000: 'deux-millions-cinq-cent-mille', 1999999: 'un-million-neuf-cent-quatre-vingt-dix-neuf-mille-neuf-cent-quatre-vingt-dix-neuf' };
const bad = Object.entries(W).filter(([n, w]) => billing.inWords(+n) !== w).map(([n]) => `${n} → ${billing.inWords(+n)}`);
ok(!bad.length, 'montants en lettres corrects' + (bad.length ? ' : ' + bad.join(' ; ') : ''));
ok(billing.amountInWords(113500) === 'Cent-treize-mille-cinq-cents francs CFA', 'phrase « … francs CFA »');
const t = billing.taxes(118900, { vatEnabled: true, vatRate: 18, vatExtra: 5 });
ok(t.ht === 100000 && t.vat === 18000 && t.extra === 900, 'TVA 18 % + centime additionnel 5 % calculés depuis le prix TTC');

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
await call(A, '/admin/settings/sales', { method: 'PUT', body: { accountRequired: false } });
const ag = (await call(A, '/admin/agencies', { body: { name: 'Agence Centre', city: 'Pointe-Noire', kind: 'agency', lat: -4.78, lng: 11.86 } })).data;
const cust = { name: 'Awa Facture', phone: '061234567', city: 'Pointe-Noire', address: 'Quartier Mpita' };
const order = async (fulfillment = 'pickup') => {
  const o = (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty: 2 }], customer: cust } })).data;
  await call(null, '/payments', { body: { orderId: o.id, token: o.token, method: 'cash', agencyId: ag.id, fulfillment } });
  return o;
};
const o1 = await order();
await sleep(100);
ok(!(await call(A, '/admin/orders')).data.orders.find((x) => x.id === o1.id).documents.length, 'réservation pas encore payée : aucun document');
await call(A, `/admin/orders/${o1.id}/cash-received`, { body: {} });
await sleep(150);
const d1 = (await call(A, '/admin/orders')).data.orders.find((x) => x.id === o1.id).documents;
const inv1 = d1.find((d) => d.type === 'invoice'), rc1 = d1.find((d) => d.type === 'receipt');
const Y = new Date().getFullYear();
const seq = (n) => parseInt(n.split('-')[2], 10);
ok(/^FA-\d{4}-\d{5}$/.test(inv1?.number) && /^RC-\d{4}-\d{5}$/.test(rc1?.number), `paiement en agence : facture ${inv1?.number} + reçu ${rc1?.number}`);
ok(rc1.invoiceNumber === inv1.number && rc1.methodLabel === 'Espèces' && rc1.agency === 'Agence Centre' && rc1.collectedBy, 'reçu : facture liée, espèces, point relais, encaissé par');
ok(rc1.amount === inv1.amount && inv1.amount > 0, 'montant du reçu = montant de la facture');

// Client : documents visibles avec la clé de la commande ; lien protégé
const co = (await call(null, `/orders/${o1.id}`, { headers: { 'X-Order-Token': o1.token } })).data;
ok(co.documents.length === 2 && co.documents.every((d) => d.link.includes('?k=')) && !('token' in co.documents[0]), 'client : facture et reçu dans sa commande (lien avec clé, sans exposer le reste)');
const link = co.documents.find((d) => d.type === 'receipt').link.replace('/api', '');
const html = await call(null, link);
ok(html.status === 200 && html.data.includes('Reçu de paiement') && html.data.includes(rc1.number) && html.data.includes('francs CFA'), 'lien du reçu : page imprimable avec numéro et montant en lettres');
ok((await call(null, link.replace(/k=[a-f0-9]+/, 'k=' + '0'.repeat(24)))).status === 404 && (await call(null, link.split('?')[0])).status === 404, 'sans la bonne clé : document introuvable');
ok((await call(null, `/documents/${inv1.id}?k=${link.split('k=')[1]}`)).status === 404, 'la clé d\'un document n\'ouvre pas un autre document');
const tk = await call(A, `/admin/documents/${inv1.id}/print?format=ticket`);
ok(tk.status === 200 && tk.data.includes('class="ticket"') && tk.data.includes('Facture'), 'Kamwa Pro : facture au format ticket 80 mm');
ok((await call(null, `/admin/documents/${inv1.id}/print`)).status === 401, 'impression Kamwa Pro réservée à l\'équipe');

// Annulation → avoir
await call(A, `/admin/orders/${o1.id}`, { method: 'PATCH', body: { status: 'cancelled' } });
await sleep(150);
const d1b = (await call(A, '/admin/orders')).data.orders.find((x) => x.id === o1.id).documents;
const av = d1b.find((d) => d.type === 'credit');
ok(av?.number === `AV-${Y}-00001` && av.invoiceNumber === inv1.number && d1b.length === 3, 'commande payée puis annulée : avoir AV-…-00001 qui annule la facture');

// Numérotation continue + informations de la société figées à l'émission
ok((await call(A, '/admin/documents/company', { method: 'PUT', body: { vatRate: 90 } })).status === 400, 'taux de TVA invalide refusé');
const comp = await call(A, '/admin/documents/company', { method: 'PUT', body: { legalForm: 'SARL', rccm: 'CG-PNR-01-2026-B12-00001', niu: 'M2026000001234X', address: '12 avenue de l\'Indépendance', phone: '06 000 00 00', vatEnabled: true } });
ok(comp.status === 200 && comp.data.missing.length === 0, 'société complétée (forme, RCCM, NIU, adresse, téléphone)');
const o2 = await order('delivery');
await call(A, `/admin/orders/${o2.id}/cash-received`, { body: {} });
await sleep(150);
const all = (await call(A, '/admin/documents')).data.documents;
const inv2 = all.find((d) => d.orderId === o2.id && d.type === 'invoice');
const rc2 = all.find((d) => d.orderId === o2.id && d.type === 'receipt');
ok(seq(inv2.number) === seq(inv1.number) + 1 && seq(rc2.number) === seq(rc1.number) + 1, `numérotation continue : ${inv1.number} → ${inv2.number}, ${rc1.number} → ${rc2.number}`);
const p2 = (await call(A, `/admin/documents/${inv2.id}/print`)).data, p1 = (await call(A, `/admin/documents/${inv1.id}/print`)).data;
ok(p2.includes('CG-PNR-01-2026-B12-00001') && p2.includes('TVA 18') && !p1.includes('CG-PNR-01-2026-B12-00001') && p1.includes('À compléter'), 'nouvelle facture : RCCM + TVA ; ancienne facture inchangée');

// Pas de doublon, rôles, export
const again = await call(A, `/admin/documents/order/${o2.id}`, { body: {} });
ok(again.data.documents.length === 2, '« Établir les documents » : aucun doublon');
const cat = (await call(A, '/admin/staff', { body: { name: 'Céline Catalogue', login: 'celine.cat', role: 'catalog' } })).data;
const C = { c: '' }; await call(C, '/admin/login', { body: { login: 'celine.cat', password: cat.password || cat.user?.password || cat.tempPassword } });
ok((await call(C, '/admin/documents')).status === 403, 'employé Catalogue : pas accès aux factures');
const csv = await call(A, '/admin/documents/export.csv');
ok(csv.status === 200 && csv.data.replace(/^\uFEFF/, '').startsWith('Numéro;Type;Date') && csv.data.includes(`AV-${Y}-00001`), 'export Excel des documents');
ok((await call(null, '/payments/methods')).status === 200, 'boutique toujours en marche');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
