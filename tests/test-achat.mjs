const B = 'http://localhost:3999/api';
const j = async (path, opt = {}) => {
  const r = await fetch(B + path, { ...opt, headers: { 'Content-Type': 'application/json', ...opt.headers }, body: opt.body && JSON.stringify(opt.body) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
let fails = 0;
const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const customer = { name: 'Test', phone: '061234567', city: 'Pointe-Noire' };
for (const [p, want] of [['/', 'no-cache'], ['/js/app.js', 'no-cache'], ['/admin/', 'no-cache'], ['/brand/icone-192.png', 'public, max-age=86400']]) {
  const r = await fetch('http://localhost:3999' + p); ok(r.headers.get('cache-control') === want, `cache ${p}`);
}
const prods = (await j('/products')).data;
const p = prods.filter((x) => x.stock >= 2).sort((a, b) => a.stock - b.stock)[0];
const A = await j('/orders', { method: 'POST', body: { customer, items: [{ productId: p.id, qty: p.stock }] } });
ok(A.status === 201 && A.data.token, 'commande créée avec clé');
ok((await j('/orders/' + A.data.id)).status === 404, 'lecture sans clé refusée');
ok((await j('/orders/' + A.data.id, { headers: { 'X-Order-Token': A.data.token } })).status === 200, 'lecture avec clé OK');
const p1 = await j('/payments', { method: 'POST', body: { orderId: A.data.id, token: A.data.token, phone: '061234567' } });
const p2 = await j('/payments', { method: 'POST', body: { orderId: A.data.id, token: A.data.token, phone: '061234567' } });
ok(p1.status === 201 && p2.data.resumed && p2.data.id === p1.data.id, 'pas de double demande de paiement');
const B2 = await j('/orders', { method: 'POST', body: { customer, items: [{ productId: p.id, qty: 1 }] } });
ok(B2.status === 400, 'stock réservé pendant le paiement');
await sleep(9000);
ok((await j('/payments/' + p1.data.id)).data.status === 'SUCCESSFUL', 'paiement validé');
ok((await j('/products/' + p.id)).data.stock === 0, 'stock décrémenté');
ok((await j('/payments', { method: 'POST', body: { orderId: A.data.id, token: A.data.token, phone: '061234567' } })).status === 409, 'commande payée : pas de 2e paiement');
const C = await j('/orders', { method: 'POST', body: { customer, items: [{ productId: prods.find((x) => x.stock >= 3).id, qty: 1 }] } });
const f1 = await j('/payments', { method: 'POST', body: { orderId: C.data.id, token: C.data.token, phone: '061234000' } });
await sleep(9000);
ok((await j('/payments/' + f1.data.id)).data.status === 'FAILED', 'numéro en 000 refusé');
ok((await j('/payments', { method: 'POST', body: { orderId: C.data.id, token: C.data.token, phone: '061234567' } })).status === 201, 'nouvel essai après refus');
console.log(fails ? `\n${fails} échec(s)` : '\nParcours d\'achat : tout est OK');
process.exit(fails ? 1 : 0);
