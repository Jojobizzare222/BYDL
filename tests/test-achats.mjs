import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
const mk = async (name, login, role, extra = {}) => { const r = (await call(A, '/admin/staff', { body: { name, login, role, ...extra } })).data; const J = { c: '' }; await call(J, '/admin/login', { body: { login, password: r.password || r.user?.password } }); return { J, id: r.user?.id || r.id }; };
const cat = await mk('Céline Catalogue', 'celine.cat3', 'catalog');
const cour = await mk('Didier Livreur', 'didier.liv2', 'courier');
const prod = async (id) => (await call(A, '/admin/products')).data.find((p) => p.id === id);
// Produit Zado (a002 : stock suivi). Plus de fournisseur local ni de dépôt-vente (21/10/2026) : tout est acheté en Europe.
const a0 = await prod('a002');

// 1) Création : contrôles
ok((await call(A, '/admin/purchases', { body: { supplier: {}, lines: [{ productId: 'a002', qty: 5, unitPrice: 100000 }] } })).status === 400, 'bon sans fournisseur refusé');
ok((await call(A, '/admin/purchases', { body: { supplier: { name: 'Fnac Pro Paris' }, lines: [] } })).status === 400, 'bon sans article refusé');
ok((await call(A, '/admin/purchases', { body: { supplier: { name: 'Fnac Pro Paris' }, lines: [{ productId: 'a002', qty: 0, unitPrice: 1 }] } })).status === 400, 'quantité 0 refusée');
const bc = (await call(A, '/admin/purchases', { body: { supplier: { name: 'Fnac Pro Paris', phone: '+33 1 55 00 00 00', contact: 'Service pro' }, lines: [{ productId: 'a002', qty: 10, unitPrice: 400000 }, { productId: 'a003', qty: 4, unitPrice: 250000 }], expectedAt: '2026-10-25', note: 'Livraison par avion' } })).data;
const Y = new Date().getFullYear();
ok(/^BC-\d{4}-\d{5}$/.test(bc.number) && bc.status === 'draft' && bc.total === 5000000 && bc.qty === 14, `bon ${bc.number} créé en brouillon, total 5 000 000 FCFA`);
ok((await call(cat.J, '/admin/purchases')).status === 200 && (await call(cour.J, '/admin/purchases')).status === 403, 'responsable catalogue : accès ; livreur : refusé');
const pr = await call(A, `/admin/purchases/${bc.id}/print`);
ok(pr.status === 200 && pr.data.includes('Bon de commande') && pr.data.includes('Fnac Pro Paris') && pr.data.includes(bc.number) && pr.data.includes('5 000 000 FCFA'), 'bon imprimable (A4) avec fournisseur et total');

// 2) Envoi, modification bloquée, réception partielle puis complète
ok((await call(A, `/admin/purchases/${bc.id}/status`, { body: { status: 'sent' } })).data.status === 'sent', 'bon envoyé');
ok((await call(A, `/admin/purchases/${bc.id}`, { method: 'PATCH', body: { lines: [{ productId: 'a002', qty: 1, unitPrice: 1 }] } })).status === 400, 'articles figés une fois envoyé');
ok((await call(A, `/admin/purchases/${bc.id}`, { method: 'PATCH', body: { expectedAt: '2026-10-28' } })).data.expectedAt === '2026-10-28', 'date prévue modifiable');
ok((await call(A, `/admin/purchases/${bc.id}/receive`, { body: { lines: [{ productId: 'a002', qty: 11 }] } })).status === 400, 'réception > commandé refusée');
const stock0 = a0.stock;
const r1 = await call(A, `/admin/purchases/${bc.id}/receive`, { body: { lines: [{ productId: 'a002', qty: 6 }], note: 'Premier carton' } });
ok(r1.data.status === 'partial' && r1.data.receivedQty === 6 && r1.data.lines[0].received === 6, 'réception partielle : 6/10 → « Reçu en partie »');
const a1 = await prod('a002');
ok(a1.stock === stock0 + 6, `stock a002 : ${stock0} → ${a1.stock} (+6)`);
const expectedCost = Math.round((stock0 * (a0.costPrice ?? 400000) + 6 * 400000) / (stock0 + 6));
ok(a1.costPrice === expectedCost && a1.lastPurchasePrice === 400000, `coût moyen pondéré mis à jour (${a1.costPrice} FCFA)`);
ok(r1.data.owed === 6 * 400000 && r1.data.due === 6 * 400000 && r1.data.paid === 0, 'dette = valeur reçue (2 400 000) tant que pas de facture');
const r2 = await call(A, `/admin/purchases/${bc.id}/receive`, { body: { lines: [{ productId: 'a002', qty: 4 }, { productId: 'a003', qty: 4 }] } });
ok(r2.data.status === 'received' && r2.data.receivedQty === 14 && r2.data.receipts.length === 2, 'réception complète : « Reçu », 2 réceptions dans l\'historique');
ok((await call(A, `/admin/purchases/${bc.id}/receive`, { body: { lines: [{ productId: 'a003', qty: 1 }] } })).status === 400, 'plus rien à recevoir');
ok((await call(A, `/admin/purchases/${bc.id}/status`, { body: { status: 'cancelled' } })).status === 400, 'bon reçu : plus annulable');

// 3) Facture fournisseur + paiement dans Finances
const inv = await call(A, `/admin/purchases/${bc.id}/invoice`, { method: 'PUT', body: { number: 'F-2026-77', amount: 4900000, date: '2026-10-20', dueAt: '2026-11-20' } });
ok(inv.data.invoice.number === 'F-2026-77' && inv.data.owed === 4900000 && inv.data.due === 4900000, 'facture fournisseur : la dette suit la facture (4 900 000)');
ok((await call(cour.J, `/admin/purchases/${bc.id}/invoice`, { method: 'PUT', body: { amount: 1 } })).status === 403, 'facture fournisseur : refusée au livreur');
const pay = await call(A, '/admin/finance/entries', { body: { type: 'expense', category: 'stock', amount: 2000000, date: '2026-10-21', method: 'bank', purchaseId: bc.id } });
ok(pay.status === 201 && pay.data.purchaseId === bc.id && /BC-/.test(pay.data.label), 'paiement « Achat de marchandises » rattaché au bon');
const v = (await call(A, `/admin/purchases/${bc.id}`)).data;
ok(v.paid === 2000000 && v.due === 2900000, 'reste à payer sur le bon : 2 900 000');
const fin = (await call(A, '/admin/finance?from=&to=')).data;
const pd = fin.purchaseDebts.find((s) => s.name === 'Fnac Pro Paris');
ok(pd && pd.due === 2900000 && pd.purchases[0].number === bc.number, 'Finances : dette d\'achat par fournisseur');

// 4) Responsable catalogue = acheteur : crée, envoie et reçoit des bons, voit les prix d'achat ; livreur et commandes : rien
const bc2r = await call(cat.J, '/admin/purchases', { body: { supplier: { name: 'Apple Store', contact: 'Opéra', phone: '+33 1 00 00 00 00' }, lines: [{ productId: 'a003', qty: 3, unitPrice: 260000 }], note: 'Fret aérien' } });
const bc2 = bc2r.data;
ok([200, 201].includes(bc2r.status) && bc2.supplier.name === 'Apple Store' && bc2.total === 780000, 'responsable catalogue : crée un bon chez un fournisseur européen (Apple Store)');
const catList = (await call(cat.J, '/admin/purchases')).data;
ok(catList.canEdit === true && catList.products.length > 0 && catList.purchases.some((b) => b.total === 5000000) && catList.products.some((p) => 'costPrice' in p), 'responsable catalogue : voit les montants et les prix d\'achat');
const catOne = (await call(cat.J, `/admin/purchases/${bc.id}`)).data;
ok(!catOne.pricesHidden && catOne.invoice?.number === 'F-2026-77' && catOne.lines.every((l) => 'unitPrice' in l), 'responsable catalogue : fiche du bon avec prix et facture');
ok((await call(cat.J, `/admin/purchases/${bc.id}/print`)).status === 200, 'responsable catalogue : imprime le bon');
const catStock = (await call(cat.J, '/admin/stock/overview')).data;
ok(!catStock.pricesHidden && catStock.totalValue > 0, 'responsable catalogue : valeur du stock visible');
ok((await call(cat.J, `/admin/purchases/${bc2.id}/status`, { body: { status: 'sent' } })).data.status === 'sent', 'responsable catalogue : envoie le bon');
ok((await call(cour.J, '/admin/purchases', { body: { supplier: { name: 'X' }, lines: [{ productId: 'a002', qty: 1, unitPrice: 1 }] } })).status === 403, 'livreur : ne crée pas de bon');
ok((await call(A, '/admin/purchases', { body: { supplier: { supplierId: 'U-X' }, lines: [{ productId: 'a002', qty: 1, unitPrice: 1 }] } })).status === 400, 'bon vers un « compte fournisseur » : refusé (nom du fournisseur obligatoire)');
ok([403, 404].includes((await call(cat.J, '/admin/purchases/mine')).status), 'ancien espace fournisseur « Mes bons » : supprimé');
const a3 = (await prod('a003')).stock;
ok((await call(cat.J, `/admin/purchases/${bc2.id}/receive`, { body: { lines: [{ productId: 'a003', qty: 3 }] } })).status === 200, 'responsable catalogue : enregistre l\'arrivée du fret');
const v2 = (await call(A, `/admin/purchases/${bc2.id}`)).data;
ok((await prod('a003')).stock === a3 + 3 && v2.owed === 780000 && !v2.consigned, 'réception : stock +3, dette 780 000 FCFA (plus de dépôt-vente)');
ok((await call(A, `/admin/purchases/${bc2.id}/status`, { body: { status: 'cancelled' } })).status === 400, 'reçu : non annulable');

// 5) Mouvements de stock et inventaire
const mv = (await call(A, '/admin/stock/moves?product=a002')).data.moves;
ok(mv.length >= 2 && mv.every((m) => m.reason === 'purchase' && m.ref === bc.number) && mv[0].after === stock0 + 10, 'journal : 2 réceptions notées avec le n° du bon');
await call(A, '/admin/products/a002', { method: 'PATCH', body: { stock: stock0 + 8 } });
const mv2 = (await call(A, '/admin/stock/moves?product=a002')).data.moves[0];
ok(mv2.reason === 'adjust' && mv2.qty === -2 && mv2.byName === 'Administrateur', 'correction dans la fiche produit : mouvement « Correction manuelle » −2');
const cust = { name: 'Awa Achat', phone: '061234567', city: 'Pointe-Noire', address: 'Mpita' };
const o = (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty: 2 }], customer: cust } })).data;
const pm = (await call(null, '/payments', { body: { orderId: o.id, token: o.token, method: 'momo', phone: '061234567' } })).data;
await sleep(9000); await call(null, '/payments/' + pm.id);
const mv3 = (await call(A, '/admin/stock/moves?product=a002')).data.moves[0];
ok(mv3.reason === 'sale' && mv3.qty === -2 && mv3.ref === o.id, 'vente payée : mouvement « Vente » −2 avec le n° de commande');
await call(A, `/admin/orders/${o.id}`, { method: 'PATCH', body: { status: 'cancelled' } });
const mv4 = (await call(A, '/admin/stock/moves?product=a002')).data.moves[0];
ok(mv4.reason === 'cancel' && mv4.qty === 2, 'commande annulée : mouvement « articles remis » +2');
const cnt = await call(A, '/admin/stock/count', { body: { items: [{ productId: 'a002', counted: stock0 + 5 }, { productId: 'a003', counted: (await prod('a003')).stock }], note: 'Inventaire du soir' } });
ok(cnt.data.changed.length === 1 && cnt.data.changed[0].after === stock0 + 5 && (await prod('a002')).stock === stock0 + 5, 'inventaire : seul l\'écart est enregistré');
const ov = (await call(A, '/admin/stock/overview')).data;
ok(ov.products.find((p) => p.id === 'a002').stock === stock0 + 5 && ov.totalValue > 0, 'vue d\'ensemble du stock : valeur totale');
ok((await call(cour.J, '/admin/stock/moves')).status === 403 && (await call(cour.J, '/admin/stock/overview')).status === 403, 'stock : réservé à admin / responsable catalogue');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
