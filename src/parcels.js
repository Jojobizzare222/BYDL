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
const { settings, transaction, orders, staff, agencies, parcels } = require('./store');

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
// Commande prête à préparer : payée (ou confirmée à la réception), et arrivée au Congo si achat en Europe
const eligible = (o) => ['paid', 'confirmed', 'shipped', 'delivered'].includes(o.status) && (!o.import || o.import.stage === 'arrived');

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
  return parcels.find((p) => p.number === num || p.id === c) || null;
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
    const place = stage === 'with_courier' ? courierPlace(o.courierId) : stage === 'at_relay' ? relayPlace(o) : stage === 'delivered' ? { type: 'customer', id: null, name: 'Client' } : WAREHOUSE;
    const p = parcels.insert({
      id: 'PCL-' + crypto.randomBytes(6).toString('hex'), number: nextNumber(), orderId: o.id,
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
  const one = (p) => {
    const o = orders.get(p.orderId) || { customer: {}, lines: [] };
    const count = forOrder(p.orderId).length;
    const items = (o.lines || []).reduce((n, l) => n + (l.qty || 1), 0);
    const pickup = isPickup(o);
    const relay = pickup ? p.relay || relayPlace(o) : null; // point relais où le colis a été déposé, sinon celui choisi par le client
    const toCollect = o.paymentPlan === 'cod' && !o.balancePaid ? (o.balance ?? o.total - (o.deposit || 0)) : 0;
    return `<section class="label">
      <header><div class="logo">${logo()}</div><div class="num"><small>Colis ${p.index}/${count}</small><strong>${esc(p.number)}</strong></div></header>
      <div class="mode ${pickup ? 'pickup' : 'home'}">${pickup ? 'RETRAIT AU POINT RELAIS' : 'LIVRAISON À DOMICILE'}</div>
      <div class="mid"><div class="qr">${qrSvg(scanUrl(origin, p))}</div>
        <div class="dest">${pickup ? `<span class="k">Point relais</span><strong>${esc(relay.name)}</strong>${relay.city ? `<span>${esc(relay.city)}</span>` : ''}<span class="k">Client</span>` : '<span class="k">Destinataire</span>'}
          <strong>${esc(o.customer.name)}</strong><span>${esc(o.customer.phone)}</span>${!pickup ? `<span>${esc(o.customer.address)}</span><span>${esc(o.customer.city)}</span>` : ''}</div></div>
      <footer><span>Commande <b>${esc(o.id || p.orderId)}</b> · ${items} article${items > 1 ? 's' : ''}</span>
        <span class="pay ${toCollect ? 'due' : ''}">${toCollect ? `À ENCAISSER : ${fcfa(toCollect)}` : 'PAYÉ'}</span></footer>
      <p class="hint">Remise uniquement contre le code de retrait du client.</p>
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
.label { width: 100mm; height: 150mm; margin: 16px auto; background: #fff; padding: 6mm; display: flex; flex-direction: column; gap: 3mm; border: 1px dashed #bbb; page-break-after: always; break-after: page; overflow: hidden; }
header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111; padding-bottom: 2mm; }
.logo svg { height: 8mm; width: auto; display: block; }
.num { text-align: right; } .num small { display: block; font-size: 9pt; } .num strong { font-size: 15pt; letter-spacing: .02em; font-variant-numeric: tabular-nums; }
.mode { text-align: center; font-weight: 700; font-size: 12pt; padding: 1.5mm; color: #fff; background: #111; border-radius: 2mm; letter-spacing: .04em; }
.mode.pickup { background: #2D1B69; }
.mid { display: flex; gap: 4mm; align-items: flex-start; flex: 1; }
.qr { width: 40mm; flex: none; } .qr svg { width: 40mm; height: 40mm; display: block; }
.dest { display: flex; flex-direction: column; gap: .6mm; font-size: 10.5pt; min-width: 0; overflow-wrap: anywhere; }
.dest strong { font-size: 13pt; line-height: 1.15; } .dest .k { font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: #555; margin-top: 2mm; }
.dest .k:first-child { margin-top: 0; }
footer { display: flex; justify-content: space-between; gap: 3mm; align-items: center; border-top: 2px solid #111; padding-top: 2mm; font-size: 9.5pt; }
.pay { font-weight: 700; padding: 1mm 2.5mm; border: 2px solid #111; border-radius: 2mm; white-space: nowrap; } .pay.due { background: #111; color: #fff; }
.hint { margin: 0; font-size: 8pt; color: #555; text-align: center; }
@media print { body { background: #fff; } .bar { display: none; } .label { margin: 0; border: 0; } @page { size: 100mm 150mm; margin: 0; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">Imprimer ${list.length > 1 ? `les ${list.length} étiquettes` : "l'étiquette"}</button><span>Format 100 × 150 mm (imprimante d'étiquettes, ou A4 à découper)</span></div>
${list.map(one).join('')}
</body></html>`;
}

module.exports = { STAGES, OPEN, eligible, isPickup, forOrder, findByCode, move, create, sync, syncAll, watchOrders, clientParcels, labels, relayPlace, courierPlace, WAREHOUSE, scanUrl, qrSvg };
