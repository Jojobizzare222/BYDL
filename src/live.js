// Suivi EN DIRECT de la course, façon Grab (décision Joseph 18/10/2026 : « un suivi identique à celui de Grab ») :
//  - position du livreur (partagée par son téléphone toutes les 5 s pendant SA livraison en cours), cap (direction) ;
//  - heure d'arrivée estimée + minutes + distance, livraisons à faire avant la vôtre, « arrive » (< 500 m), « arrivé » (< 80 m) ;
//  - étapes : confirmée → confiée au livreur → en route → arrivé ;
//  - carte du livreur : prénom, véhicule (type, couleur, plaque), sans son numéro personnel ;
//  - trajet par les rues si un calculateur d'itinéraire est branché (ROUTING_URL, compatible OSRM, à héberger sur le VPS ;
//    rien n'est envoyé ailleurs sans ce réglage), sinon trait direct « à vol d'oiseau ».
// Démo (config.demo) : la commande CMD-DEMO-0002 a une course SIMULÉE qui boucle toutes les 6 minutes (même position dans
// chaque copie du serveur, car calculée à partir de l'heure), pour voir le suivi sans vrai livreur.
const config = require('./config');
const { orders, staff } = require('./store');

const R = 6371, rad = (x) => (x * Math.PI) / 180, deg = (x) => (x * 180) / Math.PI;
const distanceKm = (a, b) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const bearing = (a, b) => {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return Math.round((deg(Math.atan2(y, x)) + 360) % 360);
};
const SPEED_KMH = 18; // moyenne en ville (moto, embouteillages)
const DETOUR = 1.35; // les rues ne vont pas en ligne droite
const STOP_MIN = 6; // temps passé à chaque livraison avant la vôtre
const firstName = (n) => String(n || 'Votre livreur').trim().split(/\s+/)[0];

// ---------- Itinéraire par les rues (facultatif) ----------
const routeCache = new Map(); // orderId -> { from, at, coords, durationS, distanceM }
async function fetchRoute(from, to) {
  const base = String(process.env.ROUTING_URL || '').replace(/\/$/, '');
  if (!base) return null;
  const url = `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Zado-suivi/1.0' } });
    const j = await r.json();
    const rt = j?.routes?.[0];
    if (!rt?.geometry?.coordinates?.length) return null;
    return { coords: rt.geometry.coordinates.map(([lng, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]), durationS: rt.duration, distanceM: rt.distance };
  } catch { return null; } finally { clearTimeout(t); }
}
async function routeFor(orderId, from, to) {
  const c = routeCache.get(orderId);
  if (c && Date.now() - c.at < 60000 && distanceKm(c.from, from) < 0.2) return c;
  const r = await fetchRoute(from, to);
  if (!r) return c || null;
  const v = { ...r, from, at: Date.now() };
  routeCache.set(orderId, v);
  return v;
}

// ---------- Course simulée de la démo ----------
const DEMO_ORDER = 'CMD-DEMO-0002';
const DEMO_PATH = [[-4.7792, 11.8638], [-4.7771, 11.8649], [-4.7752, 11.8668], [-4.7731, 11.8697], [-4.7709, 11.8716], [-4.7688, 11.8739], [-4.7667, 11.8768], [-4.7646, 11.8792], [-4.7627, 11.8818], [-4.7606, 11.8846], [-4.7591, 11.8869]];
const DEMO_DEST = { lat: -4.7588, lng: 11.8874 };
function demoPosition(now = Date.now()) {
  const LOOP = 360, DRIVE = 300; // 5 min de trajet, 1 min « arrivé », puis ça recommence
  const s = (now / 1000) % LOOP;
  const segs = DEMO_PATH.slice(1).map((p, i) => distanceKm({ lat: DEMO_PATH[i][0], lng: DEMO_PATH[i][1] }, { lat: p[0], lng: p[1] }));
  const total = segs.reduce((a, b) => a + b, 0);
  let left = Math.min(1, s / DRIVE) * total, i = 0;
  while (i < segs.length - 1 && left > segs[i]) { left -= segs[i]; i++; }
  const f = segs[i] ? Math.min(1, left / segs[i]) : 1;
  const a = DEMO_PATH[i], b = DEMO_PATH[i + 1];
  const pos = { lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f };
  return { pos, heading: bearing({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }), remaining: [[pos.lat, pos.lng], ...DEMO_PATH.slice(i + 1)], startedAt: new Date(now - s * 1000).toISOString() };
}

/** Données du suivi en direct pour le client (jamais le téléphone du livreur, jamais l'historique de ses positions). */
async function forOrder(order) {
  const demo = config.demo && order.id === DEMO_ORDER;
  const dest = demo ? DEMO_DEST : order.customer?.location || null;
  const steps = { confirmedAt: order.paidAt || order.confirmedAt || order.createdAt, assignedAt: order.assignedAt || null, startedAt: order.liveStartAt || null, arrivedAt: order.liveArrivedAt || null };
  const base = { status: order.status, destination: dest, steps, supportPhone: require('./billing').company().phone || null };
  if (order.status !== 'shipped' || !order.courierId) return { ...base, active: false };
  const c = staff.get(order.courierId);
  const courier = { name: firstName(c?.name), initial: firstName(c?.name)[0]?.toUpperCase() || 'L', vehicle: c?.vehicle || null };
  let pos, heading = null, remaining = null, at;
  if (demo) {
    const d = demoPosition();
    pos = { lat: Math.round(d.pos.lat * 1e6) / 1e6, lng: Math.round(d.pos.lng * 1e6) / 1e6 }; heading = d.heading; remaining = d.remaining; at = new Date().toISOString();
    const t0 = Date.parse(d.startedAt);
    Object.assign(steps, { confirmedAt: new Date(t0 - 25 * 60000).toISOString(), assignedAt: new Date(t0 - 6 * 60000).toISOString(), startedAt: d.startedAt });
  } else {
    const p = c?.livePos;
    if (!p || Date.now() - Date.parse(p.at) > 3 * 60 * 1000) return { ...base, active: false, waiting: true, courier };
    pos = { lat: p.lat, lng: p.lng }; heading = p.heading ?? p.bearing ?? null; at = p.at;
  }
  const out = { ...base, active: true, courier: { ...courier, lat: pos.lat, lng: pos.lng, heading, at, ageSec: Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000)) } };
  if (!dest) return out;
  const km = distanceKm(pos, dest);
  // Livraisons du même livreur plus proches de lui que la vôtre : il les fera sans doute avant (aucun détail sur ces clients)
  const stopsBefore = demo ? 0 : orders.all().filter((o) => o.id !== order.id && o.courierId === order.courierId && o.status === 'shipped' && o.customer?.location && distanceKm(pos, o.customer.location) < km).length;
  let routeKm = km * DETOUR, minutes = (routeKm / SPEED_KMH) * 60;
  if (demo) { const lineKm = remaining.slice(1).reduce((n, p, i) => n + distanceKm({ lat: remaining[i][0], lng: remaining[i][1] }, { lat: p[0], lng: p[1] }), 0); routeKm = lineKm; minutes = (lineKm / SPEED_KMH) * 60; }
  else {
    const r = await routeFor(order.id, pos, dest);
    if (r) { remaining = r.coords; routeKm = r.distanceM / 1000; minutes = (r.durationS / 60) * 1.3; } // circulation réelle plus lente que la théorie
  }
  minutes += stopsBefore * STOP_MIN;
  const arrived = km < 0.08;
  const etaMin = arrived ? 0 : Math.max(1, Math.round(minutes));
  // Première position de cette livraison et arrivée : notées une fois (étapes + barre de progression)
  if (!demo) {
    const patch = {};
    if (!order.liveStartKm) { patch.liveStartKm = Math.max(routeKm, 0.1); patch.liveStartAt = new Date().toISOString(); steps.startedAt = patch.liveStartAt; }
    if (arrived && !order.liveArrivedAt) { patch.liveArrivedAt = new Date().toISOString(); steps.arrivedAt = patch.liveArrivedAt; }
    if (Object.keys(patch).length) orders.update(order.id, patch);
  } else if (arrived) steps.arrivedAt = new Date().toISOString();
  const start = demo ? DEMO_PATH.slice(1).reduce((n, p, i) => n + distanceKm({ lat: DEMO_PATH[i][0], lng: DEMO_PATH[i][1] }, { lat: p[0], lng: p[1] }), 0) : order.liveStartKm || Math.max(routeKm, 0.1);
  return {
    ...out, distanceKm: Math.round(routeKm * 10) / 10, etaMin, etaAt: new Date(Date.now() + etaMin * 60000).toISOString(),
    near: km < 0.5, arrived, stopsBefore, progress: Math.max(0, Math.min(1, 1 - routeKm / Math.max(start, routeKm))),
    route: remaining, routeKind: demo || routeCache.has(order.id) ? 'roads' : 'direct',
  };
}

/** Cap du livreur quand le téléphone ne le donne pas : calculé à partir de son déplacement. */
function headingFrom(prev, next) {
  if (!prev || distanceKm(prev, next) < 0.012) return prev?.bearing ?? null;
  return bearing(prev, next);
}

module.exports = { forOrder, headingFrom, distanceKm, DEMO_ORDER, DEMO_DEST };
