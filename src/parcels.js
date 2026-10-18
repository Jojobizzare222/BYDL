// Colis (ERP, étape 2 — décision Joseph 17/10/2026) : chaque commande prête à partir donne un ou plusieurs colis,
// avec une étiquette (numéro + QR code) qu'on scanne au téléphone à chaque étape.
// Étapes : preparing (à préparer) → ready (emballé, étiquette collée) → with_courier (chez le livreur) | at_relay (au point relais)
//          → delivered (remis au client) ; returned = commande annulée, colis à remettre en stock.
// Le colis suit la commande AUTOMATIQUEMENT (livreur choisi, livraison, annulation : sync), et l'inverse :
// scanner « remis au livreur » confie la commande au livreur, « remis au client » exige le code du client.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-generator');
const { settings, transaction, orders, staff, agencies, parcels, products } = require('./store');

const STAGES = {
  preparing: 'À préparer',
  ready: 'Prêt (emballé)',
  with_courier: 'Chez le livreur',
  at_relay: 'Au point relais',
  delivered: 'Remis au client',
  returned: 'Retour en stock',
};
const OPEN = ['preparing', 'ready', 'with_courier', 'at_relay'];
const isPickup = (o) => o.fulfillment === 'pickup';
// Commande prête à préparer : payée (ou confirmée à la réception)
const eligible = (o) => ['paid', 'confirmed', 'shipped', 'delivered'].includes(o.status);

function nextNumber(at = new Date()) {
  const d = new Date(at.toLocaleString('en-US', { timeZone: 'Africa/Brazzaville' }));
  const day = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const key = `seq:KM:${day}`;
  const n = (parseInt(settings.get(key), 10) || 0) + 1;
  settings.set(key, n);
  return `KM-${day}-${String(n).padStart(3, '0')}`;
}
const forOrder = (orderId) => parcels.all().filter((p) => p.orderId === orderId).sort((a, b) => a.index - b.index);
const findByCode = (code) => {
  const c = String(code || '').trim();
  const m = c.match(/KM-\d{6}-\d{3,}/i);
  const num = m ? m[0].toUpperCase() : c;
  return parcels.find((p) => p.number === num || p.barcode === num || p.id === c) || null;
};
const who = (by) => (by ? { by: by.id || null, byName: by.name || '' } : { by: null, byName: 'Kamwa (automatique)' });
const relayPlace = (o, agencyId) => {
  const a = (agencyId && agencies.get(agencyId)) || (o.agency?.id && agencies.get(o.agency.id)) || o.agency;
  return a ? { type: 'relay', id: a.id || null, name: a.name || 'Point relais', city: a.city || '' } : { type: 'relay', id: null, name: 'Point relais', city: '' };
};
const courierPlace = (id) => { const u = id && staff.get(id); return { type: 'courier', id: id || null, name: u ? u.name : 'Livreur' }; };
const WAREHOUSE = { type: 'warehouse', id: null, name: 'Entrepôt Kamwa' };

function move(p, stage, place, by, note) {
  if (p.stage === stage && JSON.stringify(p.place) === JSON.stringify(place)) return p;
  const now = new Date().toISOString();
  return parcels.update(p.id, { stage, place, stageAt: now, ...(place?.type === 'relay' ? { relay: place } : {}), history: [...(p.history || []), { stage, at: now, place: place?.name || '', note: note || '', ...who(by) }] });
}

function create(o, { stage = 'preparing', by = null } = {}) {
  return transaction(() => {
    const list = forOrder(o.id);
    const now = new Date().toISOString();
    const number = nextNumber();
    const place = stage === 'with_courier' ? courierPlace(o.courierId) : stage === 'at_relay' ? relayPlace(o) : stage === 'delivered' ? { type: 'customer', id: null, name: 'Client' } : WAREHOUSE;
    const p = parcels.insert({
      id: 'PCL-' + crypto.randomBytes(6).toString('hex'), number, barcode: number, orderId: o.id, // code-barres CODE 128 = numéro du colis
      index: list.length + 1, stage, place, stageAt: now, createdAt: now,
      history: [{ stage, at: now, place: place.name, note: list.length ? 'Colis supplémentaire' : '', ...who(by) }],
    });
    return p;
  });
}

/** Met les colis d'une commande à jour selon la commande (idempotent). */
function sync(orderOrId) {
  const o = typeof orderOrId === 'string' ? orders.get(orderOrId) : orderOrId;
  if (!o || !o.lines) return [];
  let list = forOrder(o.id);
  if (!list.length) {
    if (!eligible(o)) return [];
    const stage = o.status === 'delivered' ? 'delivered' : o.status === 'shipped' && !isPickup(o) ? 'with_courier' : 'preparing';
    create(o, { stage });
    return forOrder(o.id);
  }
  for (const p of list) {
    if (o.status === 'cancelled' && OPEN.includes(p.stage)) move(p, 'returned', WAREHOUSE, null, o.cancelReason || 'Commande annulée');
    else if (o.status === 'delivered' && OPEN.includes(p.stage)) move(p, 'delivered', { type: 'customer', id: null, name: o.customer?.name || 'Client' }, null);
    else if (o.status === 'shipped' && !isPickup(o) && ['preparing', 'ready'].includes(p.stage) && !list.some((x) => x.stage === 'with_courier')) {
      move(p, 'with_courier', courierPlace(o.courierId), null, 'Commande confiée au livreur');
    } else if (['paid', 'confirmed'].includes(o.status) && p.stage === 'with_courier' && !isPickup(o)) {
      move(p, 'ready', WAREHOUSE, null, 'Retour à l\'entrepôt après une tentative de livraison');
    } else if (p.stage === 'returned' && eligible(o) && o.status !== 'delivered') move(p, 'preparing', WAREHOUSE, null, 'Commande réactivée');
  }
  return forOrder(o.id);
}
function syncAll() {
  // Colis créés avant les codes-barres (18/10/2026) : chacun reçoit le sien (= son numéro)
  for (const p of parcels.all().filter((x) => !x.barcode)) parcels.update(p.id, { barcode: p.number });
  const list = orders.all().sort((a, b) => String(a.paidAt || a.createdAt).localeCompare(String(b.paidAt || b.createdAt)));
  for (const o of list) { try { sync(o); } catch (err) { console.error('[colis]', o.id, err.message); } }
}
function watchOrders() {
  if (orders._parcelsWatched) return;
  const orig = orders.update.bind(orders);
  orders.update = (id, patch) => {
    const out = orig(id, patch);
    if (out) queueMicrotask(() => { try { sync(id); } catch (err) { console.error('[colis]', id, err.message); } });
    return out;
  };
  orders._parcelsWatched = true;
}

// ---------- Vue client (page de suivi) : étape et point relais seulement ----------
const clientParcels = (orderId) => forOrder(orderId).map((p) => ({
  number: p.number, index: p.index, stage: p.stage, label: STAGES[p.stage], at: p.stageAt,
  place: p.stage === 'at_relay' ? p.place?.name || null : null,
}));

// ---------- Étiquette 100 × 150 mm (QR + numéro + destination) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fcfa = (n) => `${Math.round(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
function qrSvg(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}
let LOGO = null;
const logo = () => {
  if (LOGO === null) { try { LOGO = fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'logo-kamwa.svg'), 'utf8').replace(/<\?xml[^>]*>/, ''); } catch { LOGO = '<strong>Kamwa</strong>'; } }
  return LOGO;
};
const scanUrl = (origin, p) => `${origin}/admin/#/colis/${p.number}`;

function labels(list, origin) {
  const delivery = require('./delivery');
  const support = require('./billing').company().phone || '';
  const day = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const one = (p) => {
    const o = orders.get(p.orderId) || { customer: {}, lines: [] };
    const count = forOrder(p.orderId).length;
    const items = (o.lines || []).reduce((n, l) => n + (l.qty || 1), 0);
    const pickup = isPickup(o);
    const relay = pickup ? p.relay || relayPlace(o) : null; // point relais où le colis a été déposé, sinon celui choisi par le client
    const toCollect = o.paymentPlan === 'cod' && !o.balancePaid ? (o.balance ?? o.total - (o.deposit || 0)) : 0;
    // Informations utiles au préparateur et au livreur (18/10/2026, demande Joseph : « un peu plus d'information »)
    const fragile = (o.lines || []).some((l) => products.get(l.productId)?.universe === 'Électronique');
    const courier = !pickup && delivery.courierName(o.courierId);
    const when = !pickup && o.planned ? `${day(o.planned.date)} · ${(delivery.SLOTS[o.planned.slot] || '').replace(/\s*\(.*\)/, '')}` : '';
    const paidAt = !pickup && o.agency ? o.agency.name : '';
    const shown = (o.lines || []).slice(0, 5);
    const more = (o.lines || []).length - shown.length;
    const info = [
      when && ['Livraison prévue', when],
      courier && ['Livreur', courier.split(' ')[0]],
      paidAt && ['Payé au point relais', paidAt],
      ['Colis préparé le', new Date(p.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })],
    ].filter(Boolean);
    return `<section class="label">
      <header><div class="logo">${logo()}</div><div class="num"><small>Colis ${p.index}/${count}</small><strong>${esc(p.number)}</strong></div></header>
      <div class="mode ${pickup ? 'pickup' : 'home'}">${pickup ? 'RETRAIT AU POINT RELAIS' : 'LIVRAISON À DOMICILE'}</div>
      <div class="mid"><div class="qr">${qrSvg(scanUrl(origin, p))}<small>Scanner pour ouvrir le colis</small></div>
        <div class="dest">${pickup ? `<span class="k">Point relais</span><strong>${esc(relay.name)}</strong>${relay.city ? `<span>${esc(relay.city)}</span>` : ''}<span class="k">Client</span>` : '<span class="k">Destinataire</span>'}
          <strong>${esc(o.customer.name)}</strong><span class="tel">${esc(o.customer.phone)}</span>
          ${!pickup ? `${o.customer.zone ? `<span><b>Quartier :</b> ${esc(o.customer.zone)}</span>` : ''}<span>${esc(o.customer.address)}</span><span>${esc(o.customer.city)}</span>${o.customer.location ? '<span class="gps">● Point placé sur la carte (voir Kamwa Pro)</span>' : ''}` : ''}</div></div>
      ${info.length ? `<dl class="info">${info.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      <div class="items"><div class="ih"><span>Contenu · ${items} article${items > 1 ? 's' : ''}${count > 1 ? ` (commande en ${count} colis)` : ''}</span>${fragile ? '<b class="fragile">FRAGILE</b>' : ''}</div>
        <ul>${shown.map((l) => `<li><b>${l.qty} ×</b> ${esc(l.name)}${l.variant ? ` <i>(${esc(l.variant)})</i>` : ''}</li>`).join('')}${more > 0 ? `<li><i>+ ${more} autre${more > 1 ? 's' : ''} article${more > 1 ? 's' : ''}</i></li>` : ''}</ul></div>
      <div class="bc">${require('./barcode').svg(p.barcode || p.number, { height: 60 })}<span>${esc(p.barcode || p.number)}</span></div>
      <footer><span>Commande <b>${esc(o.id || p.orderId)}</b></span>
        <span class="pay ${toCollect ? 'due' : ''}">${toCollect ? `À ENCAISSER : ${fcfa(toCollect)}` : 'PAYÉ'}</span></footer>
      <p class="hint">${pickup ? 'Remise au client uniquement contre son code de retrait.' : 'Remise uniquement contre le code de livraison du client, colis en main.'}${support ? ` · Problème : Kamwa ${esc(support)}` : ''}</p>
    </section>`;
  };
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Étiquette${list.length > 1 ? 's' : ''} ${esc(list.map((p) => p.number).join(', ')).slice(0, 80)}</title>
<style>
@font-face { font-family: "IBM Plex Sans"; src: url(/fonts/ibm-plex-sans-latin-wght-normal.woff2) format("woff2"); font-weight: 100 700; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "IBM Plex Sans", Arial, sans-serif; background: #EEEAF7; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.bar { position: sticky; top: 0; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #2D1B69; z-index: 2; }
.bar button { font: inherit; font-weight: 600; border: 0; border-radius: 999px; padding: 8px 18px; background: #FFB300; color: #2D1B69; cursor: pointer; }
.bar span { color: #CFC6F2; align-self: center; font-size: 13px; }
.label { width: 100mm; height: 150mm; margin: 16px auto; background: #fff; padding: 5mm 6mm; display: flex; flex-direction: column; gap: 2mm; border: 1px dashed #bbb; page-break-after: always; break-after: page; overflow: hidden; }
header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111; padding-bottom: 2mm; }
.logo svg { height: 8mm; width: auto; display: block; }
.num { text-align: right; } .num small { display: block; font-size: 9pt; } .num strong { font-size: 15pt; letter-spacing: .02em; font-variant-numeric: tabular-nums; }
.mode { text-align: center; font-weight: 700; font-size: 12pt; padding: 1.5mm; color: #fff; background: #111; border-radius: 2mm; letter-spacing: .04em; }
.mode.pickup { background: #2D1B69; }
.mid { display: flex; gap: 4mm; align-items: flex-start; flex: 1; }
.qr { width: 31mm; flex: none; } .qr svg { width: 31mm; height: 31mm; display: block; }
.dest { display: flex; flex-direction: column; gap: .6mm; font-size: 10.5pt; min-width: 0; overflow-wrap: anywhere; }
.dest strong { font-size: 13pt; line-height: 1.15; } .dest .k { font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: #555; margin-top: 2mm; }
.dest .k:first-child { margin-top: 0; }
footer { display: flex; justify-content: space-between; gap: 3mm; align-items: center; border-top: 2px solid #111; padding-top: 2mm; font-size: 9.5pt; }
.pay { font-weight: 700; padding: 1mm 2.5mm; border: 2px solid #111; border-radius: 2mm; white-space: nowrap; } .pay.due { background: #111; color: #fff; }
.hint { margin: 0; font-size: 8pt; color: #555; text-align: center; }
.mid { flex: none; } .qr small { display: block; text-align: center; font-size: 6.5pt; color: #555; margin-top: .5mm; }
.dest .tel { font-weight: 700; font-size: 11.5pt; letter-spacing: .02em; } .dest .gps { font-size: 7.5pt; color: #333; margin-top: 1mm; }
.info { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1.5mm 3mm; padding: 2mm 0; border-top: 1px solid #ccc; }
.info div { min-width: 0; } .info dt { font-size: 7pt; text-transform: uppercase; letter-spacing: .06em; color: #555; } .info dd { margin: 0; font-size: 9.5pt; font-weight: 600; overflow-wrap: anywhere; }
.items { flex: 1 1 auto; min-height: 14mm; overflow: hidden; border: 1px solid #111; border-radius: 2mm; padding: 1.5mm 2.5mm; }
.items .ih { display: flex; justify-content: space-between; align-items: center; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: #333; margin-bottom: 1mm; }
.items ul { margin: 0; padding: 0; list-style: none; font-size: 9pt; line-height: 1.3; } .items li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .items i { color: #555; }
.bc { text-align: center; } .bc svg { display: block; width: 100%; height: 12mm; } .bc span { display: block; font-size: 9pt; font-weight: 700; letter-spacing: .25em; font-variant-numeric: tabular-nums; margin-top: .5mm; }
.fragile { background: #111; color: #fff; padding: .3mm 2mm; border-radius: 1mm; font-size: 7.5pt; letter-spacing: .08em; }
@media print { body { background: #fff; } .bar { display: none; } .label { margin: 0; border: 0; } @page { size: 100mm 150mm; margin: 0; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">Imprimer ${list.length > 1 ? `les ${list.length} étiquettes` : "l'étiquette"}</button><span>Format 100 × 150 mm (imprimante d'étiquettes, ou A4 à découper)</span></div>
${list.map(one).join('')}
</body></html>`;
}

module.exports = { STAGES, OPEN, eligible, isPickup, forOrder, findByCode, move, create, sync, syncAll, watchOrders, clientParcels, labels, relayPlace, courierPlace, WAREHOUSE, scanUrl, qrSvg };
