// Protections générales du serveur (audit du 17/10/2026) :
//  - en-têtes de sécurité (CSP, anti-iframe, nosniff, HSTS en HTTPS…) ;
//  - limite de requêtes par adresse IP, GÉNÉREUSE : au Congo, beaucoup de téléphones sortent sur Internet par la même
//    adresse (opérateur mobile), il ne faut pas bloquer des clients honnêtes. Les connexions et codes ont déjà leurs
//    propres limites plus strictes (comptes, Zado Pro, messagerie).
//  - Sur Vercel, ces en-têtes valent pour les réponses du serveur ; les fichiers de public/ reçoivent les mêmes via vercel.json.

// Sources autorisées : tout vient de Zado, sauf les fonds de carte OpenStreetMap.
// 'unsafe-inline' reste nécessaire pour les scripts (petits scripts du thème et de l'animation d'ouverture dans les pages)
// et les styles (attributs style=) : à durcir plus tard avec des empreintes (hash).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function headers(req, res, next) {
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  if (req.secure || String(req.get('x-forwarded-proto') || '').startsWith('https')) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

// Limite par IP et par minute (fenêtre glissante simple, en mémoire)
const WINDOW = 60 * 1000;
const LIMITS = { read: 600, write: 120 }; // lectures / écritures par minute et par adresse
const hits = new Map();
const ipOf = (req) => req.ip || 'inconnu'; // vraie adresse du client : voir « trust proxy » dans server.js
function rateLimit(req, res, next) {
  if (process.env.RATE_LIMIT === 'off') return next();
  const kind = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'read' : 'write';
  const key = `${kind}:${ipOf(req)}`;
  const now = Date.now();
  let h = hits.get(key);
  if (!h || now - h.start > WINDOW) { h = { start: now, n: 0 }; hits.set(key, h); }
  h.n += 1;
  if (h.n > LIMITS[kind]) {
    res.setHeader('Retry-After', String(Math.ceil((h.start + WINDOW - now) / 1000)));
    return res.status(429).json({ error: 'Trop de demandes en peu de temps. Patientez une minute puis réessayez.' });
  }
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.start > WINDOW) hits.delete(k); }, WINDOW).unref?.();

module.exports = { headers, rateLimit, CSP, HEADERS, LIMITS };
