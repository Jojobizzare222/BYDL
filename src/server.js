const path = require('path');
const express = require('express');
const config = require('./config');
const { UNIVERSES } = require('./catalog');
const { UPLOAD_DIR } = require('./routes/admin');

const app = express();
app.disable('x-powered-by');
// Adresse IP réelle du client derrière un relais (Vercel ; plus tard nginx sur le VPS avec TRUST_PROXY=1) :
// utilisée par toutes les limites (connexions, codes, messagerie, requêtes). Sans relais déclaré, on ne croit pas l'en-tête X-Forwarded-For.
app.set('trust proxy', process.env.VERCEL ? true : process.env.TRUST_PROXY ? (Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY) : false);
const security = require('./security');
app.use(security.headers);
// Compression (gzip) des pages, scripts et réponses de l'API : beaucoup moins de données sur les connexions mobiles.
// Jamais sur les flux en direct (/events), qui doivent partir tout de suite.
app.use(require('compression')({ filter: (req, res) => !/\/events$/.test(req.path) && require('compression').filter(req, res) }));
app.use('/api', security.rateLimit);
app.use(require('./maintenance').guard); // maintenance : nouvelles commandes, paiements et comptes refusés (503)
// Création de compte / envoi de la pièce d'identité : la photo est jointe (réduite par le navigateur), d'où une limite plus haute
app.use(['/api/account/register', '/api/account/identity'], express.json({ limit: '6mb' }));
app.use(express.json({ limit: '100kb' }));

// Fichiers statiques :
//  - HTML/CSS/JS (et le jeu d'icônes) en « no-cache » : le navigateur revérifie à chaque visite (réponse 304 très légère si rien n'a changé),
//    donc les clients voient tout de suite la dernière version du site ;
//  - images en cache 24 h : important pour les connexions mobiles lentes.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', /\.(html|css|js)$|icons\.svg$/.test(filePath) ? 'no-cache' : 'public, max-age=86400');
    },
  })
);
// Photos envoyées depuis l'espace pro (rangées dans data/uploads, hors de GitHub).
// Route explicite (et non express.static, ignoré par Vercel) ; seuls des noms de fichiers simples sont acceptés.
app.get('/images/uploads/:name', (req, res) => {
  if (!/^[\w.-]+\.(jpg|png|webp)$/.test(req.params.name)) return res.sendStatus(404);
  res.sendFile(path.join(UPLOAD_DIR, req.params.name), { maxAge: '1d' }, (err) => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
});

// Aperçu de partage (WhatsApp, Facebook…) : /p/<id> donne le nom, le prix et la photo du produit (balises Open Graph),
// puis ouvre la fiche dans la boutique (#/p/<id>). Rien d'autre que ce qui est déjà public sur la fiche.
app.get('/p/:id', (req, res) => {
  const { products } = require('./store');
  const p = products.get(req.params.id);
  const ok = p && p.active !== false && !p.pending && require('./catalog').inCatalog(p);
  const host = /localhost|127\.0\.0\.1/.test(config.publicUrl) ? `${req.protocol}://${req.get('host')}` : config.publicUrl;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const target = ok ? `/#/p/${encodeURIComponent(p.id)}` : '/';
  const img = ok && p.image ? (/^https?:/.test(p.image) ? p.image : host + p.image) : `${host}/brand/partage-zado.png?v=8`;
  const price = ok ? new Intl.NumberFormat('fr-FR').format(p.price).replace(/\u202f/g, ' ') + ' FCFA' : '';
  const title = ok ? `${p.name} — ${price}` : 'Zado';
  const desc = ok ? `${p.description ? String(p.description).slice(0, 150) + ' · ' : ''}Payez au point relais · livraison rapide à Pointe-Noire.` : 'Électronique au meilleur prix, livraison rapide à Pointe-Noire.';
  res.set('Cache-Control', 'public, max-age=300');
  res.status(ok ? 200 : 404).type('html').send(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<meta property="og:type" content="product"><meta property="og:site_name" content="Zado">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:url" content="${esc(host + req.originalUrl)}">
<meta name="twitter:card" content="summary_large_image"><meta name="description" content="${esc(desc)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}"><link rel="canonical" href="${esc(host + target)}">
</head><body style="font-family:sans-serif;padding:24px"><p><a href="${esc(target)}">Voir ${esc(ok ? p.name : 'la boutique Zado')}</a></p></body></html>`);
});

// Version du site : change à chaque mise à jour (déploiement Vercel, ou fichier modifié sur le serveur).
// Le navigateur la compare en changeant de page et se recharge tout seul : pas besoin de relancer l'application.
const fs = require('fs');
const SITE_FILES = ['index.html', 'js/app.js', 'js/legal.js', 'js/cookies.js', 'js/pwa.js', 'js/chat.js', 'js/map.js', 'css/style.css', 'sw.js', 'admin/index.html', 'admin/admin.js', 'admin/admin.css']
  .map((f) => path.join(__dirname, '..', 'public', f));
let versionCache = { at: 0, v: null };
function siteVersion() {
  const fixed = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA;
  if (fixed) return fixed;
  if (Date.now() - versionCache.at < 3000) return versionCache.v;
  let latest = 0;
  for (const f of SITE_FILES) { try { latest = Math.max(latest, fs.statSync(f).mtimeMs); } catch {} }
  versionCache = { at: Date.now(), v: String(Math.round(latest)) };
  return versionCache.v;
}
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ shopName: config.shopName, currency: config.currency, paymentMode: config.paymentMode, demo: config.demo, universes: UNIVERSES, version: siteVersion(), accountRequired: require('./sales').salesSettings().accountRequired, deliveryFees: require('./fees').publicFees(), maintenance: require('./maintenance').publicState(), ...(config.demo ? { demoTrack: { id: 'CMD-DEMO-0002', token: require('./demo').DEMO_TRACK_TOKEN } } : {}) , freight: require('./freight').publicFreight(), mobileDeposit: require('./mobile-pay').mobileSettings().deposit });
});
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/account', require('./routes/account'));
app.use('/api/chat', require('./routes/chat')); // messagerie (bulle « Aide » de la boutique)
// Notifications de suivi sur le téléphone (Web Push)
const push = require('./push');
push.watchOrders();
const billing = require('./billing');
billing.watchOrders(); // factures, reçus, avoirs créés automatiquement à chaque étape d'une commande
const parcels = require('./parcels');
parcels.watchOrders(); // colis créés et mis à jour avec la commande
require('./price-watch').start(); // prix constatés en France : relevés une fois par jour (à partir de 6 h, heure du Congo)
require('./abandon').start(); // commandes jamais payées annulées automatiquement (toutes les 10 min ; sur Vercel : à la lecture)
// Rafraîchissement instantané des écrans ouverts (boutique) : seulement ce qui concerne ce client
const events = require('./events');
events.watchStore();
app.get('/api/events', (req, res) => {
  const { currentCustomer } = require('./customer/auth');
  const me = currentCustomer(req)?.id || null;
  events.stream(req, res, ({ col, doc, before }) => {
    if (col === 'maintenance') return { topic: 'maintenance' };
    if (col === 'products' || col === 'agencies' || col === 'reviews') return { topic: 'catalog' };
    if (!me) return null;
    if (col === 'orders' && (doc.customerId === me || before?.customerId === me)) return { topic: 'order', id: doc.id };
    if (col === 'customers' && doc.id === me) return { topic: 'account' };
    if (col === 'conversations' && doc.customerId === me) return { topic: 'chat' };
    // Position du livreur : signal « live » au client dont la commande est en cours de livraison par ce livreur
    if (col === 'staff' && doc.role === 'courier' && doc.livePos !== before?.livePos) {
      const { orders } = require('./store');
      const o = orders.all().find((x) => x.courierId === doc.id && x.status === 'shipped' && x.customerId === me);
      return o ? { topic: 'live', id: o.id } : null;
    }
    return null;
  });
});
app.get('/api/push/key', (req, res) => res.json({ key: push.publicKey() }));
app.post('/api/push/subscribe', (req, res) => {
  const { orders } = require('./store');
  const { hasAccess } = require('./routes/orders');
  const { currentCustomer } = require('./customer/auth');
  const customer = currentCustomer(req);
  const orderId = String(req.body?.orderId || '');
  const order = orderId && orders.get(orderId);
  const okOrder = order && (hasAccess(order, req.body?.token) || (customer && order.customerId === customer.id));
  if (!customer && !okOrder) return res.status(400).json({ error: 'Connectez-vous ou ouvrez une de vos commandes pour activer les notifications' });
  const r = push.subscribe(req.body?.subscription, { customerId: customer?.id || null, orderId: okOrder ? order.id : null });
  if (r.error) return res.status(400).json(r);
  res.json({ ok: true });
});
// Tâche planifiée de Vercel (vercel.json « crons ») : relevé quotidien des prix en France. Protégée par CRON_SECRET (sinon désactivée).
app.get('/api/cron/prices', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Non autorisé' });
  res.json(await require('./price-watch').runAll({ budgetMs: 45000 }));
});
app.use('/api/admin', require('./routes/admin'));
// Vitrine de démo (Vercel) : comptes et données d'exemple, créés une fois par démarrage de la base temporaire
require('./demo').seed();
// Photos d'illustration du catalogue de départ supprimées (décision Joseph 19/10/2026) : une seule fois par base,
// on retire des produits les adresses vers ces fichiers (et leurs crédits). Les photos envoyées depuis Zado Pro restent.
(() => {
  const { products, settings } = require('./store');
  if (settings.get('migr:photos-illustration')) return;
  const gone = (u) => typeof u === 'string' && /^\/images\/(commons|products)\//.test(u);
  let n = 0;
  for (const p of products.all()) {
    if (!gone(p.image) && !(p.images || []).some(gone) && !p.imageCredit) continue;
    const images = (p.images || []).filter((u) => !gone(u));
    products.update(p.id, { images, image: gone(p.image) ? images[0] || null : p.image, imageCredit: null });
    n++;
  }
  settings.set('migr:photos-illustration', new Date().toISOString());
  if (n) console.log(`[photos] ${n} produit(s) : photos d'illustration retirées`);
})();
// Provenance affichée au client (décision Joseph 21/10/2026 : le matériel vient principalement de France) : une seule fois
// par base, les produits sans provenance reçoivent « France » et, comme fournisseur d'origine, leur marque (modifiable dans Zado Pro) ;
// les produits Apple ont toujours « Apple Store ».
(() => {
  const { products, settings } = require('./store');
  if (settings.get('migr:provenance-france')) return;
  let n = 0;
  for (const p of products.all()) {
    const apple = /^apple$/i.test(String(p.brand || '').trim()) && (p.condition || 'neuf') === 'neuf'; // reconditionné : son vrai vendeur
    if (p.provenance && (!apple || p.sourceSupplier === 'Apple Store')) continue;
    products.update(p.id, { provenance: p.provenance || 'France', sourceSupplier: apple ? 'Apple Store' : p.sourceSupplier || p.brand || null });
    n++;
  }
  settings.set('migr:provenance-france', new Date().toISOString());
  if (n) console.log(`[provenance] ${n} produit(s) : provenance France`);
})();
// Fiches détaillées (21/10/2026) : points forts, réparabilité, vidéo, prix en France du catalogue de départ copiés UNE fois
// dans une base existante, seulement pour les produits qui n'en ont pas encore (rien n'est écrasé).
(() => {
  const { products, settings } = require('./store');
  if (settings.get('migr:fiches-v1')) return;
  let start = [];
  try { start = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'products.json'), 'utf8')); } catch { return; }
  let n = 0;
  for (const ref of start) {
    const p = products.get(ref.id);
    if (!p || p.name !== ref.name) continue;
    const add = {};
    for (const k of ['highlights', 'repair', 'video', 'priceRefs']) if (ref[k] && !(p[k] && (Array.isArray(p[k]) ? p[k].length : true))) add[k] = ref[k];
    if (Object.keys(add).length) { products.update(p.id, add); n++; }
  }
  settings.set('migr:fiches-v1', new Date().toISOString());
  if (n) console.log(`[fiches] ${n} produit(s) : fiche détaillée ajoutée`);
})();
// Appareils reconditionnés (décision Joseph 22/10/2026) : la sélection de départ de data/products.json (r001…) est ajoutée
// UNE fois aux bases existantes (produits déjà présents jamais écrasés ; supprimés dans Zado Pro : pas remis).
(() => {
  const { products, settings } = require('./store');
  if (settings.get('migr:reconditionne-v1')) return;
  let n = 0;
  try {
    for (const p of require('../data/products.json').filter((x) => x.condition === 'reconditionné')) {
      if (!products.get(p.id)) { products.insert(p); n++; }
    }
  } catch (err) { console.error('[reconditionné]', err.message); }
  settings.set('migr:reconditionne-v1', new Date().toISOString());
  if (n) console.log(`[reconditionné] ${n} appareil(s) reconditionné(s) ajouté(s) au catalogue`);
})();
billing.syncAll(); // documents manquants (anciennes commandes, données de démo), dans l'ordre des ventes
parcels.syncAll(); // colis des commandes prêtes

// Facture / reçu / avoir ouvert par le client depuis son compte, son suivi ou un lien WhatsApp : clé secrète du document obligatoire
app.get('/api/documents/:id', (req, res) => {
  const d = require('./store').documents.get(req.params.id);
  const k = String(req.query.k || '');
  if (!d || k.length !== d.token.length || !require('crypto').timingSafeEqual(Buffer.from(k), Buffer.from(d.token))) return res.status(404).type('text').send('Document introuvable');
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' });
  res.type('html').send(billing.render(d, { format: req.query.format === 'ticket' ? 'ticket' : 'a4' }));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop lourd' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide' });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne' });
});

app.listen(config.port, () => {
  console.log(`${config.shopName} en ligne sur http://localhost:${config.port}`);
  console.log(`Mode de paiement : ${config.paymentMode.toUpperCase()}`);
});
