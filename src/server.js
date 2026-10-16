const path = require('path');
const express = require('express');
const config = require('./config');
const { UNIVERSES } = require('./catalog');
const { UPLOAD_DIR } = require('./routes/admin');

const app = express();
app.disable('x-powered-by');
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
  res.json({ shopName: config.shopName, currency: config.currency, paymentMode: config.paymentMode, demo: config.demo, universes: UNIVERSES, version: siteVersion() });
});
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/account', require('./routes/account'));
app.use('/api/imports', require('./routes/imports'));
app.use('/api/chat', require('./routes/chat')); // messagerie (bulle « Aide » de la boutique)
// Notifications de suivi sur le téléphone (Web Push)
const push = require('./push');
push.watchOrders();
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
app.use('/api/admin', require('./routes/admin'));
// Vitrine de démo (Vercel) : comptes et données d'exemple, créés une fois par démarrage de la base temporaire
require('./demo').seed();

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
