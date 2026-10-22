// Parcours d'achat du 21/10/2026 : transport France → Pointe-Noire (15 €/kg, 1 kg minimum par article), détail du prix,
// acompte de 500 FCFA qui confirme la commande + récapitulatif automatique, reste par « retrait » (demande sur le téléphone)
// ou par « dépôt » (numéro de Zado), facture avec l'acompte déduit, étapes logistiques France → Pointe-Noire.
// Lancer : zsh tests/run-test.sh test-mobile.mjs tests/id.jpg
import fs from 'node:fs';
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...(o.headers || {}) }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KG = Math.round(15 * 655.957); // 9 839 FCFA

const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
// Client vérifié
const C = { c: '' };
const reg = (await call(C, '/account/register', { body: { name: 'Awa Mobile', phone: '061112233', idType: 'cni', idPhoto: 'data:image/jpeg;base64,' + fs.readFileSync(process.argv[3]).toString('base64') } })).data;
await call(A, `/admin/customers/${reg.customer.id}/identity`, { body: { decision: 'verify' } });

// 1) Réglages, poids et prix fournisseur
ok((await call(A, '/admin/settings/transport', { method: 'PUT', body: { freight: { minKg: 'abc' } } })).status === 400, 'réglage : poids minimum invalide refusé');
ok((await call(A, '/admin/settings/transport', { method: 'PUT', body: { freight: { logisticsMin: 6, logisticsMax: 3 } } })).status === 400, 'réglage : délai minimum > maximum refusé');
const tr = (await call(A, '/admin/settings/transport', { method: 'PUT', body: { mobile: { numbers: { mtn: '06 600 00 00' } } } })).data;
ok(tr.freight.eurPerKg === 15 && tr.freight.minKg === 1 && tr.freight.perArticle && tr.perKg === KG && tr.mobile.deposit === 500 && tr.mobile.numbers.mtn === '066000000', 'par défaut : 15 €/kg, 1 kg minimum par article, acompte 500 FCFA ; numéro de dépôt MTN enregistré');
ok((await call(A, '/admin/products/a003', { method: 'PATCH', body: { weightKg: '0,45', sourcePrice: 500000 } })).data.weightKg === 0.45, 'fiche produit : poids 0,45 kg');
ok((await call(A, '/admin/products/a003', { method: 'PATCH', body: { weightKg: '-1' } })).status === 400, 'poids négatif refusé');
const pub = (await call(null, '/products/a003')).data;
ok(pub.weightKg === 0.45 && pub.sourcePrice === 500000 && !('costPrice' in pub), 'boutique : poids et prix fournisseur visibles (jamais le prix d\'achat interne)');
const cfg = (await call(null, '/config')).data;
ok(cfg.freight?.perKg === KG && cfg.freight.logisticsMin === 2 && cfg.freight.logisticsMax === 5 && cfg.freight.deliveryHours === 24 && cfg.mobileDeposit === 500, 'boutique : transport, délais (2 à 5 j + 24 h) et acompte publiés');
const m = (await call(C, '/payments/methods')).data.mobile;
ok(m.enabled && m.deposit === 500 && m.push === true, 'moyen « Mobile Money en deux temps » proposé, dépôt possible');

// 2) Commande : transport calculé par le serveur (1 kg minimum par article)
const items = [{ productId: 'a003', qty: 1 }, { productId: 'a072', qty: 2 }];
const o1 = (await call(C, '/orders', { body: { customer: { name: 'Awa Mobile', phone: '061112233', city: 'Pointe-Noire', address: 'Tié-Tié' }, items } })).data;
const p003 = pub.price, p072 = (await call(null, '/products/a072')).data.price;
ok(o1.transportKg === 3 && o1.transportFee === Math.round(3 * 15 * 655.957) && o1.total === p003 + 2 * p072 + o1.transportFee, `transport : 3 kg facturés (0,45 kg → 1 kg + 2 × 1 kg) = ${o1.transportFee} FCFA, ajouté au total`);
ok(!('transportZadoFee' in o1) && !('zadoFeeEurPerKg' in cfg.freight), 'frais Zado sur le transport (2 €/kg) : jamais montré au client (commande, réglages publics)');
const ao1 = (await call(A, '/admin/orders')).data.orders.find((x) => x.id === o1.id);
ok(ao1.transportZadoFee === Math.round(3 * 2 * 655.957) && ao1.transportFee - ao1.transportZadoFee === Math.round(3 * 15 * 655.957) - Math.round(3 * 2 * 655.957), `commande : dont frais Zado ${ao1.transportZadoFee} FCFA (3 kg × 2 €), le reste paie le fret`);
const fin = (await call(A, '/admin/finance')).data;
ok(typeof fin.kpis.transportZadoFees === 'number', `Finances : frais Zado sur le transport suivis à part (${fin.kpis.transportZadoFees} FCFA pour les ventes réalisées)`);

// 3) Retrait : acompte puis demande du reste sur le téléphone
const pay = (await call(C, '/payments', { body: { orderId: o1.id, token: o1.token, method: 'mobile', mode: 'pull', phone: '061112233' } })).data;
ok(pay.purpose === 'deposit' && pay.amount === 500 && pay.operator === 'mtn' && pay.mobile, 'acompte de 500 FCFA demandé sur le téléphone (retrait)');
await sleep(9000);
await call(null, '/payments/' + pay.id);
let v = (await call(C, '/orders/' + o1.id, { headers: { 'X-Order-Token': o1.token } })).data;
ok(v.status === 'confirmed' && v.deposit === 500 && v.balance === o1.total - 500, 'acompte reçu : commande confirmée, reste = total − 500');
ok(v.mobilePay?.stage === 'rest' && v.mobilePay.mode === 'pull' && v.mobilePay.status === 'PENDING' && v.mobilePay.amount === o1.total - 500, 'demande du reste envoyée automatiquement sur le téléphone');
const chat = (await call(C, '/chat')).data.conversation;
const texts = chat.messages.map((x) => x.text).join('\n');
ok(/Récapitulatif/.test(texts) && /Transport France → Pointe-Noire/.test(texts) && /Acompte reçu : − 500/.test(texts) && /Reste à payer/.test(texts) && chat.unread >= 1, 'message automatique dans « Aide » : récapitulatif de la commande');
ok(/tapez votre code secret/i.test(texts), 'instructions de finalisation envoyées (retrait)');
ok((await call(A, `/admin/orders/${o1.id}/plan`, { body: { date: new Date().toISOString().slice(0, 10), slot: 'afternoon' } })).status === 400, 'livraison impossible tant que le reste n\'est pas payé');
ok((await call(A, `/admin/orders/${o1.id}/logistics`, { body: { step: 'bought' } })).status === 400, 'logistique impossible avant le paiement complet');
await sleep(9000);
v = (await call(C, '/orders/' + o1.id, { headers: { 'X-Order-Token': o1.token } })).data;
ok(v.status === 'paid' && v.balancePaid?.method === 'momo' && v.mobilePay.stage === null, 'reste validé : commande payée');
// Documents : 2 reçus (acompte + solde) et une facture avec l'acompte déduit
const docs = v.documents.map((d) => d.type).sort().join(',');
ok(docs === 'invoice,receipt,receipt', `documents : facture + reçu d'acompte + reçu de solde (${docs})`);
const inv = v.documents.find((d) => d.type === 'invoice');
const html = await (await fetch(`http://localhost:3999${inv.link}`)).text();
ok(/Transport France → Pointe-Noire/.test(html) && /Acompte déjà versé/.test(html) && /Solde réglé/.test(html), 'facture : ligne transport, acompte déduit du total, solde réglé');

// 4) Logistique France → Pointe-Noire
ok(v.logistics?.show === true && v.logistics.from && v.logistics.to && !v.logistics.boughtAt, 'suivi : arrivée annoncée entre J+2 et J+5');
const days = (Date.parse(v.logistics.to) - Date.parse(v.logistics.from)) / 864e5;
ok(Math.round(days) === 3, 'écart entre les dates annoncées : 3 jours (2 à 5 jours)');
for (const step of ['bought', 'flying']) ok((await call(A, `/admin/orders/${o1.id}/logistics`, { body: { step } })).status === 200, `étape « ${step} » notée`);
const arr = (await call(A, `/admin/orders/${o1.id}/logistics`, { body: { step: 'arrived' } })).data;
ok(arr.logistics.arrivedAt && arr.logisticsEta.deliverBy && Math.round((Date.parse(arr.logisticsEta.deliverBy) - Date.parse(arr.logistics.arrivedAt)) / 3600e3) === 24, 'arrivé à Pointe-Noire : livraison promise sous 24 h');
const texts2 = (await call(C, '/chat')).data.conversation.messages.map((x) => x.text).join('\n');
ok(/achetée chez notre fournisseur en France/.test(texts2) && /dans l'avion/.test(texts2) && /arrivée à Pointe-Noire/.test(texts2), 'client prévenu à chaque étape (achat, avion, arrivée)');
ok((await call(A, `/admin/orders/${o1.id}/logistics`, { body: { step: 'undo' } })).data.logistics.arrivedAt === undefined, '« Annuler la dernière étape » retire l\'arrivée');
await call(A, `/admin/orders/${o1.id}/logistics`, { body: { step: 'arrived' } });
ok((await call(A, `/admin/orders/${o1.id}/plan`, { body: { date: new Date().toISOString().slice(0, 10), slot: 'evening' } })).status === 200, 'une fois payée : livraison planifiable');

// 5) Dépôt : le client envoie l'argent au numéro de Zado, l'équipe confirme
const o2 = (await call(C, '/orders', { body: { customer: { name: 'Awa Mobile', phone: '061112233', city: 'Pointe-Noire', address: 'Tié-Tié' }, items: [{ productId: 'a072', qty: 1 }] } })).data;
const p2 = (await call(C, '/payments', { body: { orderId: o2.id, token: o2.token, method: 'mobile', mode: 'push', phone: '061112233' } })).data;
ok(p2.operator === 'transfer' && p2.amount === 500 && p2.depositTo?.number === '066000000' && p2.depositTo.display === '06 600 00 00' && p2.expiresAt, 'dépôt : acompte de 500 à envoyer au 06 600 00 00 (délai indiqué)');
let w = (await call(C, '/orders/' + o2.id, { headers: { 'X-Order-Token': o2.token } })).data;
ok(w.status === 'pending_payment' && w.mobilePay.stage === 'deposit' && w.mobilePay.mode === 'push' && w.mobilePay.depositTo.display === '06 600 00 00', 'suivi : instructions de dépôt de l\'acompte');
const O = { c: '' }; const st = (await call(A, '/admin/staff', { body: { name: 'Olga', login: 'olga-mob', role: 'orders' } })).data; await call(O, '/admin/login', { body: { login: 'olga-mob', password: st.password } });
ok((await call(O, `/admin/orders/${o2.id}/transfer-received`, { method: 'POST' })).data.status === 'confirmed', 'employé Commandes : « Dépôt reçu » → commande confirmée');
w = (await call(C, '/orders/' + o2.id, { headers: { 'X-Order-Token': o2.token } })).data;
ok(w.mobilePay.stage === 'rest' && w.mobilePay.mode === 'push' && w.mobilePay.amount === o2.total - 500, 'reste à déposer indiqué au client');
const r2 = (await call(O, `/admin/orders/${o2.id}/transfer-received`, { method: 'POST' })).data;
ok(r2.status === 'paid' && r2.balancePaid?.method === 'transfer', 'second « Dépôt reçu » → commande payée');
ok((await call(O, `/admin/orders/${o2.id}/transfer-received`, { method: 'POST' })).status === 400, 'plus aucun dépôt attendu ensuite');
const rc = (await call(C, '/orders/' + o2.id, { headers: { 'X-Order-Token': o2.token } })).data.documents.filter((d) => d.type === 'receipt');
const rhtml = await (await fetch(`http://localhost:3999${rc[0].link}`)).text();
ok(rc.length === 2 && /Dépôt MTN Mobile Money/.test(rhtml) && /Olga/.test(rhtml), 'reçus de dépôt : mode « Dépôt MTN Mobile Money », encaissé par l\'employée');

// 6) Sans numéro de dépôt : seul le retrait est possible ; minimum par commande
await call(A, '/admin/settings/transport', { method: 'PUT', body: { mobile: { numbers: { mtn: '', airtel: '' } }, freight: { perArticle: false } } });
ok((await call(C, '/payments/methods')).data.mobile.push === false, 'sans numéro de dépôt : « Par dépôt » indisponible');
const o3 = (await call(C, '/orders', { body: { customer: { name: 'Awa Mobile', phone: '061112233', city: 'Pointe-Noire', address: 'Tié-Tié' }, items: [{ productId: 'a003', qty: 1 }] } })).data;
ok(o3.transportKg === 1 && o3.transportFee === KG, 'minimum par commande : 0,45 kg → 1 kg facturé');
ok((await call(C, '/payments', { body: { orderId: o3.id, token: o3.token, method: 'mobile', mode: 'push', phone: '061112233' } })).status === 400, 'dépôt refusé sans numéro de Zado');

console.log(fails ? `\n${fails} échec(s)` : '\nParcours Mobile Money en deux temps : tout est OK');
process.exit(fails ? 1 : 0);
