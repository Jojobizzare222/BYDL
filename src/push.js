// Notifications de suivi sur le téléphone (Android et iPhone), sans application à installer depuis un store :
// norme « Web Push » des navigateurs. iPhone : il faut avoir ajouté Kamwa à l'écran d'accueil (iOS 16.4 ou plus).
// Clés VAPID créées une fois par Kamwa et gardées dans la base (ou dans .env : VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
// Envoyé à chaque étape d'une commande (payée, en route, livreur tout près, livrée…), pièce vérifiée, réponse d'un conseiller.
// La notification ne contient jamais de donnée sensible (pas d'adresse, pas de code de livraison).
const crypto = require('crypto');
const webpush = require('web-push');
const config = require('./config');
const { settings, pushSubs } = require('./store');

function keys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  let k = null;
  try { k = JSON.parse(settings.get('vapid') || 'null'); } catch {}
  if (!k) { k = webpush.generateVAPIDKeys(); settings.set('vapid', JSON.stringify(k)); }
  return k;
}
let ready = false;
function setup() {
  if (ready) return;
  const k = keys();
  webpush.setVapidDetails(`mailto:${process.env.VAPID_CONTACT || 'contact@kamwa.cg'}`, k.publicKey, k.privateKey);
  ready = true;
}
const publicKey = () => keys().publicKey;

/** Enregistre (ou met à jour) l'abonnement d'un téléphone, lié au compte client et/ou à des commandes. */
function subscribe(sub, { customerId = null, orderId = null } = {}) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return { error: 'Abonnement invalide' };
  const id = crypto.createHash('sha256').update(sub.endpoint).digest('hex').slice(0, 32);
  const cur = pushSubs.get(id);
  const data = {
    id, endpoint: String(sub.endpoint).slice(0, 800), keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) },
    customerId: customerId || cur?.customerId || null,
    orderIds: [...new Set([...(cur?.orderIds || []), ...(orderId ? [orderId] : [])])].slice(-30),
    createdAt: cur?.createdAt || new Date().toISOString(),
  };
  cur ? pushSubs.update(id, data) : pushSubs.insert(data);
  return { id };
}

async function sendTo(subs, payload) {
  if (!subs.length) return 0;
  setup();
  const body = JSON.stringify({ icon: '/brand/icone-192.png', badge: '/brand/favicon-32.png', ...payload });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 3600, urgency: payload.urgent ? 'high' : 'normal' }); sent++; }
    catch (err) { if ([404, 410].includes(err.statusCode)) pushSubs.remove(s.id); else console.error('[notification] envoi impossible :', err.statusCode || err.message); }
  }));
  return sent;
}
const subsFor = ({ customerId, orderId }) => pushSubs.all().filter((s) => (customerId && s.customerId === customerId) || (orderId && s.orderIds.includes(orderId)));

/** Notification au client d'une commande. tag = numéro de commande : la nouvelle étape REMPLACE la précédente. */
const wants = (customerId, kind) => { if (!customerId) return true; const c = require('./store').customers.get(customerId); return c?.prefs?.notify?.[kind] !== false; };
function notifyOrder(order, title, body, { urgent = false } = {}) {
  if (!order || !wants(order.customerId, 'orders')) return Promise.resolve(0);
  return sendTo(subsFor({ customerId: order.customerId, orderId: order.id }), { title, body, tag: order.id, url: `/#/suivi/${order.id}`, urgent })
    .catch((err) => { console.error('[notification]', err.message); return 0; });
}
function notifyCustomer(customerId, title, body, url = '/#/compte', tag = 'kamwa-compte') {
  if (!customerId || (tag === 'kamwa-chat' && !wants(customerId, 'chat'))) return Promise.resolve(0);
  return sendTo(subsFor({ customerId }), { title, body, tag, url }).catch(() => 0);
}

// Étapes d'une commande → texte de la notification
const STAGE_TEXT = {
  paid: (o) => ['Paiement reçu ✓', o.fulfillment === 'pickup' ? 'Merci ! Nous préparons votre colis : vous serez prévenu dès qu\'il vous attend au point relais.' : 'Merci ! Nous préparons votre commande et vous appelons avant la livraison.'],
  shipped: () => ['Votre colis est en route 🛵', 'Suivez votre livreur en direct sur la carte.'],
  near: () => ['Votre livreur arrive !', 'Il est à moins de 2 minutes. Préparez votre code de livraison.'],
  delivered: (o) => [o.fulfillment === 'pickup' ? 'Commande retirée ✓' : 'Commande livrée ✓', 'Merci pour votre confiance. À bientôt sur Kamwa !'],
  cancelled: () => ['Commande annulée', 'Ouvrez Kamwa pour voir le détail.'],
  bought: () => ['Article acheté en Europe ✓', 'Nous avons acheté votre article. Il part avec le prochain envoi.'],
  shipped_fr: () => ['Votre colis a quitté l\'Europe ✈️', 'Il est en route vers le Congo.'],
  arrived: (o) => ['Votre colis est arrivé au Congo', o.fulfillment === 'pickup' ? `Il vous attend au point relais ${o.agency?.name || ''}.` : 'Nous vous appelons pour la livraison.'],
};
function orderStage(order, stage) {
  const f = STAGE_TEXT[stage];
  if (!f) return Promise.resolve(0);
  const [title, body] = f(order);
  return notifyOrder(order, title, `${order.id} · ${body}`, { urgent: stage === 'near' });
}

// Branché une fois au démarrage : chaque changement d'étape d'une commande (où qu'il se fasse dans Kamwa)
// envoie la notification correspondante, sans rien oublier.
function watchOrders() {
  const { orders } = require('./store');
  if (orders._pushWatched) return;
  const update = orders.update.bind(orders);
  orders.update = (id, patch) => {
    const before = orders.get(id);
    const after = update(id, patch);
    if (before && after) {
      if (patch.status && patch.status !== before.status && STAGE_TEXT[patch.status]) orderStage(after, patch.status);
      const s0 = before.import?.stage, s1 = after.import?.stage;
      if (s1 && s1 !== s0 && STAGE_TEXT[s1] && s1 !== 'to_buy') orderStage(after, s1);
    }
    return after;
  };
  orders._pushWatched = true;
}

module.exports = { publicKey, subscribe, notifyOrder, notifyCustomer, orderStage, watchOrders };
