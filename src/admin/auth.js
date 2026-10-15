// Connexion à l'espace admin : un seul compte (Joseph), protégé par mot de passe.
//  - le mot de passe n'est jamais stocké en clair : seulement son empreinte (scrypt) dans la base ;
//  - après connexion, le navigateur reçoit un cookie de session (HttpOnly, SameSite=Strict, 7 jours) ;
//  - 5 essais ratés depuis une même adresse => blocage 15 minutes.
const crypto = require('crypto');
const { db, settings } = require('../store');

const COOKIE = 'kamwa_admin';
const SESSION_DAYS = 7;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

db.exec('CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function checkPassword(password, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

const isPasswordSet = () => Boolean(settings.get('admin_password'));

function setPassword(password) {
  settings.set('admin_password', hashPassword(password));
  db.exec('DELETE FROM admin_sessions'); // changer le mot de passe déconnecte partout
}

function readCookie(req) {
  const match = (req.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return match ? match[1] : null;
}

function cookieHeader(req, value, maxAgeSec) {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${req.secure ? '; Secure' : ''}`;
}

// Anti « devinette » du mot de passe
const failures = new Map(); // ip -> { count, lockedUntil }

function login(req, res) {
  if (!isPasswordSet()) {
    return res.status(503).json({ error: "Mot de passe admin pas encore défini. Dans le Terminal : npm run admin:password" });
  }
  const ip = req.ip;
  const f = failures.get(ip) || { count: 0, lockedUntil: 0 };
  if (Date.now() < f.lockedUntil) {
    const min = Math.ceil((f.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Trop d'essais. Réessayez dans ${min} min.` });
  }
  if (!checkPassword(req.body?.password || '', settings.get('admin_password'))) {
    f.count += 1;
    if (f.count >= MAX_FAILS) Object.assign(f, { count: 0, lockedUntil: Date.now() + LOCK_MS });
    failures.set(ip, f);
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  failures.delete(ip);

  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_DAYS * 24 * 3600;
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)').run(sha256(token), Date.now() + maxAge * 1000);
  res.setHeader('Set-Cookie', cookieHeader(req, token, maxAge));
  res.json({ ok: true });
}

function logout(req, res) {
  const token = readCookie(req);
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
  res.json({ ok: true });
}

function isLoggedIn(req) {
  const token = readCookie(req);
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?').get(sha256(token));
  return Boolean(row && row.expires_at > Date.now());
}

function requireAdmin(req, res, next) {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });
  next();
}

module.exports = { login, logout, isLoggedIn, requireAdmin, setPassword, isPasswordSet };
