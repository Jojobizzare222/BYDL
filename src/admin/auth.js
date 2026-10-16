// Connexion à l'espace d'administration : identifiant + mot de passe.
//  - « admin » : Joseph (mot de passe créé avec `npm run admin:password`), accès complet ;
//  - membres de l'équipe et fournisseurs (collection « staff ») : comptes créés par l'admin, avec un rôle :
//      catalog  = employé « Catalogue » (ajout et modification des produits)
//      orders   = employé « Commandes » (suivi des commandes)
//      supplier = fournisseur (ses produits, son stock, les commandes de ses produits)
//  - les mots de passe ne sont jamais stockés en clair : seulement leur empreinte (scrypt) ;
//  - après connexion, cookie de session HttpOnly, SameSite=Strict, 7 jours ;
//  - 5 essais ratés depuis une même adresse ou sur un même compte => blocage 15 minutes.
const crypto = require('crypto');
const { db, settings, staff } = require('../store');

const COOKIE = 'kamwa_admin';
const SESSION_DAYS = 7;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const ADMIN_LOGIN = 'admin';

const ROLES = { admin: 'Administrateur', catalog: 'Employé Catalogue', orders: 'Employé Commandes', supplier: 'Fournisseur' };

db.exec('CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
try {
  db.exec("ALTER TABLE admin_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'");
} catch {} // colonne déjà présente

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

/** Mot de passe provisoire lisible (sans caractères ambigus), à transmettre à la personne. */
function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[crypto.randomInt(chars.length)]).join('').replace(/(.{5})/, '$1-');
}

const isPasswordSet = () => Boolean(settings.get('admin_password'));

function setPassword(password) {
  settings.set('admin_password', hashPassword(password));
  db.prepare("DELETE FROM admin_sessions WHERE user_id = 'admin'").run(); // changer le mot de passe déconnecte partout
}

const closeSessionsOf = (userId) => db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId);

const normLogin = (s) => String(s || '').trim().toLowerCase();
const findStaff = (login) => staff.find((u) => u.login === normLogin(login));

function readCookie(req) {
  const match = (req.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return match ? match[1] : null;
}

function cookieHeader(req, value, maxAgeSec) {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${req.secure ? '; Secure' : ''}`;
}

// Anti « devinette » du mot de passe (par adresse et par compte)
const failures = new Map(); // clé -> { count, lockedUntil }
const lockedFor = (key) => Math.max(0, (failures.get(key)?.lockedUntil || 0) - Date.now());
function addFailure(key) {
  const f = failures.get(key) || { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) Object.assign(f, { count: 0, lockedUntil: Date.now() + LOCK_MS });
  failures.set(key, f);
}

function login(req, res) {
  const loginName = normLogin(req.body?.login) || ADMIN_LOGIN; // ancien formulaire sans identifiant = admin
  const password = req.body?.password || '';
  if (loginName === ADMIN_LOGIN && !isPasswordSet()) {
    return res.status(503).json({ error: 'Mot de passe admin pas encore défini. Dans le Terminal : npm run admin:password' });
  }
  const ipKey = 'ip:' + req.ip;
  const accKey = 'acc:' + loginName;
  const wait = Math.max(lockedFor(ipKey), lockedFor(accKey));
  if (wait) return res.status(429).json({ error: `Trop d'essais. Réessayez dans ${Math.ceil(wait / 60000)} min.` });

  let userId = null;
  if (loginName === ADMIN_LOGIN) {
    if (checkPassword(password, settings.get('admin_password'))) userId = ADMIN_LOGIN;
  } else {
    const u = findStaff(loginName);
    if (u && u.active !== false && checkPassword(password, u.passwordHash)) userId = u.id;
  }
  if (!userId) {
    addFailure(ipKey);
    addFailure(accKey);
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }
  failures.delete(ipKey);
  failures.delete(accKey);

  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_DAYS * 24 * 3600;
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO admin_sessions (token_hash, expires_at, user_id) VALUES (?, ?, ?)').run(sha256(token), Date.now() + maxAge * 1000, userId);
  res.setHeader('Set-Cookie', cookieHeader(req, token, maxAge));
  res.json({ ok: true });
}

function logout(req, res) {
  const token = readCookie(req);
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
  res.json({ ok: true });
}

/** Personne connectée : { id, name, role, login, company?, mustChangePassword? } ou null. */
function currentUser(req) {
  const token = readCookie(req);
  if (!token) return null;
  const row = db.prepare('SELECT expires_at, user_id FROM admin_sessions WHERE token_hash = ?').get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  if (row.user_id === ADMIN_LOGIN) return { id: ADMIN_LOGIN, login: ADMIN_LOGIN, name: 'Administrateur', role: 'admin' };
  const u = staff.get(row.user_id);
  if (!u || u.active === false) return null; // compte désactivé : accès coupé immédiatement
  return { id: u.id, login: u.login, name: u.name, role: u.role, company: u.company || null, mustChangePassword: Boolean(u.mustChangePassword) };
}

const isLoggedIn = (req) => Boolean(currentUser(req));

function requireStaff(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });
  req.user = user;
  next();
}

/** Limite une route à certains rôles (l'admin a toujours accès). */
const requireRole = (...roles) => (req, res, next) => {
  if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
  res.status(403).json({ error: "Vous n'avez pas accès à cette partie" });
};

module.exports = {
  ROLES,
  ADMIN_LOGIN,
  login,
  logout,
  currentUser,
  isLoggedIn,
  requireStaff,
  requireRole,
  requireAdmin: requireStaff, // ancien nom
  setPassword,
  isPasswordSet,
  hashPassword,
  checkPassword,
  tempPassword,
  normLogin,
  findStaff,
  closeSessionsOf,
};
