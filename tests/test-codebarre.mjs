// Codes-barres des colis : un par colis, imprimé sur l'étiquette, lisible (décodé par ZXing), lu par le livreur
import fs from 'node:fs';
import { createRequire } from 'node:module';
const req = createRequire('/Users/josephgambaka/Desktop/BYDL/package.json');
const sharp = req('sharp');
const Z = createRequire(import.meta.url)(process.argv[3] + '/package/umd/index.js');
const B = 'http://localhost:3999/api', PW = fs.readFileSync(process.argv[2], 'utf8').trim();
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const decode = async (svgText) => {
  const { data, info } = await sharp(Buffer.from(svgText.replace('<svg ', '<svg width="900" height="120" ').replace(/width="\d+" height="60"/, ''))).flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const lum = new Uint8ClampedArray(info.width * info.height); for (let i = 0; i < lum.length; i++) lum[i] = data[i * info.channels];
  const r = new Z.MultiFormatReader(); r.setHints(new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128]]]));
  try { return r.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, info.width, info.height)))).getText(); } catch { return null; }
};
const A = { c: '' }; await call(A, '/admin/login', { body: { login: 'admin', password: PW } });
await call(A, '/admin/settings/sales', { method: 'PUT', body: { accountRequired: false } });
const ag = (await call(A, '/admin/agencies', { body: { name: 'Agence Centre', city: 'Pointe-Noire', lat: -4.7792, lng: 11.8638 } })).data;
const cu = (await call(A, '/admin/staff', { body: { name: 'Junior', login: 'junior', role: 'courier' } })).data;
const cu2 = (await call(A, '/admin/staff', { body: { name: 'Paul', login: 'paul', role: 'courier' } })).data;
const C = { c: '' }; await call(C, '/admin/login', { body: { login: 'junior', password: cu.password } });
const C2 = { c: '' }; await call(C2, '/admin/login', { body: { login: 'paul', password: cu2.password } });
const o = (await call(null, '/orders', { body: { items: [{ productId: 'a002', qty: 1 }], customer: { name: 'Awa', phone: '061234567', city: 'Pointe-Noire', address: 'Mpita' } } })).data;
await call(null, '/payments', { body: { orderId: o.id, token: o.token, method: 'cash', agencyId: ag.id, fulfillment: 'delivery' } });
await call(A, `/admin/orders/${o.id}/cash-received`, { body: {} });
await new Promise((r) => setTimeout(r, 300));
await call(A, `/admin/parcels/order/${o.id}`, { body: {} }); // 2e colis
const list = (await call(A, '/admin/parcels')).data.parcels.filter((p) => p.orderId === o.id);
ok(list.length === 2 && list.every((p) => p.barcode === p.number && /^KM-\d{6}-\d{3}$/.test(p.barcode)), 'chaque colis a son code-barres (= numéro du colis)');
ok(list[0].siblings.length === 2, 'le scan renvoie tous les colis de la commande (pour vérifier qu\'aucun ne manque)');
const html = (await call(A, `/admin/parcels/labels?order=${o.id}`)).data;
const svgs = html.match(/<svg[^>]*aria-label="Code-barres [^"]+"[\s\S]*?<\/svg>/g) || [];
ok(svgs.length === 2, 'code-barres imprimé sur chaque étiquette');
const read = await decode(svgs[0]);
ok(read === list.find((p) => p.index === 1).number, `code-barres de l'étiquette lisible par un lecteur : « ${read} »`);
ok((await call(A, '/admin/parcels/lookup?code=' + encodeURIComponent(read))).data.orderId === o.id, 'lecture du code-barres → bon colis, bonne commande');
// Livreur
ok((await call(C, '/admin/parcels/lookup?code=' + read)).status === 404, 'livreur : colis pas encore confié → refusé');
await call(A, `/admin/orders/${o.id}/assign`, { body: { courierId: cu.user.id } });
const lk = await call(C, '/admin/parcels/lookup?code=' + read);
ok(lk.status === 200 && lk.data.order.customer.name === 'Awa' && lk.data.order.status === 'shipped', 'livreur : scanne son colis → client et adresse pour la remise');
ok((await call(C2, '/admin/parcels/lookup?code=' + read)).status === 404, 'autre livreur : ce colis ne lui est pas confié');
const code = (await call(A, '/admin/orders')).data.orders.find((x) => x.id === o.id).deliveryCode;
ok((await call(C, `/admin/courier/deliveries/${o.id}/deliver`, { body: { code: '0000' === code ? '1111' : '0000' } })).status === 400, 'remise après scan : code faux refusé');
ok((await call(C, `/admin/courier/deliveries/${o.id}/deliver`, { body: { code } })).status === 200, 'remise après scan : code du client → livrée');
const after = (await call(A, '/admin/parcels')).data.parcels.filter((p) => p.orderId === o.id);
ok(after.every((p) => p.stage === 'delivered'), 'les deux colis passent « remis »');
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
