// Kamwa — « service worker » : ce petit programme permet au site de fonctionner comme une application
// (installation sur l'écran d'accueil, ouverture rapide, consultation du catalogue même sans réseau).
// Règles de sécurité : les commandes, paiements, comptes et l'espace pro passent TOUJOURS par le réseau,
// jamais par le cache. Seuls le catalogue public et les fichiers du site sont gardés en mémoire.
const VERSION = 'kamwa-v36';
const SHELL = `${VERSION}-shell`;
const MEDIA = `${VERSION}-media`;
const DATA = `${VERSION}-data`;
const PRECACHE = ['/', '/css/style.css', '/js/app.js', '/js/legal.js', '/js/cookies.js', '/js/pwa.js', '/js/chat.js', '/js/map.js', '/icons.svg?v=12', '/fonts/ibm-plex-sans-latin-wght-normal.woff2', '/brand/logo-kamwa.svg?v=2', '/manifest.webmanifest'];
// Lecture seule et publique : utilisable hors ligne (le prix est toujours recalculé par le serveur à la commande)
const CACHEABLE_API = ['/api/products', '/api/config'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Réseau d'abord (contenu toujours à jour), mémoire si pas de réseau
async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
    return res;
  } catch {
    const hit = await caches.match(req);
    if (hit) return hit;
    throw new Error('hors ligne');
  }
}
// Mémoire d'abord (photos, polices) : rapide et économe en données mobiles
async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const c = await caches.open(MEDIA);
    c.put(req, res.clone());
    trim(c, 300);
  }
  return res;
}
async function trim(cache, max) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // paiements, envois : jamais touchés
  if (url.pathname.startsWith('/api/')) {
    if (CACHEABLE_API.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'))) e.respondWith(networkFirst(req, DATA));
    return; // tout le reste de l'API : réseau uniquement
  }
  if (req.mode === 'navigate') {
    // Pages : réseau d'abord ; hors ligne, la page d'accueil de la bonne application
    const fallback = url.pathname.startsWith('/admin') ? '/admin/' : '/';
    e.respondWith(networkFirst(req, SHELL).catch(() => caches.match(fallback)));
    return;
  }
  if (/^\/(images|brand|fonts)\//.test(url.pathname)) { e.respondWith(cacheFirst(req)); return; }
  if (/\.(css|js|svg|webmanifest)$/.test(url.pathname)) e.respondWith(networkFirst(req, SHELL));
});

// ---------- Notifications de suivi (Web Push) : Android et iPhone (Kamwa ajouté à l'écran d'accueil) ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Kamwa', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Kamwa', {
    body: d.body || '', icon: d.icon || '/brand/icone-192.png?v=2', badge: d.badge || '/brand/favicon-32.png?v=2',
    tag: d.tag || 'kamwa', renotify: true, data: { url: d.url || '/' }, vibrate: d.urgent ? [200, 100, 200] : [100],
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const shop = list.find((c) => new URL(c.url).pathname === '/' && 'focus' in c);
    if (shop) { shop.navigate(url).catch(() => {}); return shop.focus(); }
    return self.clients.openWindow(url);
  }));
});
