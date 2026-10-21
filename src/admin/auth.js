// Connexion à l'espace d'administration : identifiant + mot de passe.
//  - « admin » : Joseph (mot de passe créé avec `npm run admin:password`), accès complet ;
//  - membres de l'équipe et fournisseurs (collection « staff ») : comptes créés par l'admin, avec un rôle :
//      catalog  = employé « Catalogue » (ajout et modification des produits)
//      orders   = employé « Commandes » (suivi des commandes)
//      (rôle « supplier » = fournisseur partenaire local : RETIRÉ le 21/10/2026, Zado achète tout en Europe ; ces comptes n'ont plus accès)
//      courier  = livreur (ses livraisons en cours ; valide une livraison avec le code du client)
//  - les mots de passe ne sont jamais stockés en clair : seulement leur empreinte (scrypt) ;
//  - après connexion, cookie de session HttpOnly, SameSite=Strict, 7 jours ;
//  - 5 essais ratés depuis une même adresse ou sur un même compte => blocage 15 minutes.
const crypto = require('crypto');
const { db, settings, staff } = require('../store');
const config = require('../config');

const COOKIE = 'kamwa_admin';
const SESSION_DAYS = 7;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const ADMIN_LOGIN = 'admin';

const ROLES = { admin: 'Administrateur', catalog: 'Responsable catalogue', orders: 'Employé Commandes', courier: 'Livreur' };
const RETIRED_ROLES = ['supplier']; // anciens comptes fournisseurs : connexion et sessions refusées

db.exec('CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
try {
  db.exec("ALTER TABLE admin_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'admin'");
} catch {} // colonne déjà présente
// « Se connecter en tant que » (décision Joseph 21/10/2026) : session d'un membre de l'équipe ouverte par l'administrateur
try { db.exec('ALTER TABLE admin_sessions ADD COLUMN imp_by TEXT'); } catch {}
const IMPERSONATE_HOURS = 8;

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

// Mot de passe admin : dans la base, ou (vitrine de démo Vercel, base temporaire) dans le réglage ADMIN_PASSWORD_HASH
// créé avec `npm run admin:hash` — seule l'empreinte est stockée, jamais le mot de passe.
const adminHash = () => settings.get('admin_password') || process.env.ADMIN_PASSWORD_HASH || null;
const isPasswordSet = () => Boolean(adminHash());

function setPassword(password) {
  settings.set('admin_password', hashPassword(password));
  db.prepare("DELETE FROM admin_sessions WHERE user_id = 'admin'").run(); // changer le mot de passe déconnecte partout
}

const closeSessionsOf = (userId) => db.prepare('DELETE FROM admin_sessions WHERE user_id = ?').run(userId);

const normLogin = (s) => String(s || '').trim().toLowerCase();
const findStaff = (login) => staff.find((u) => u.login === normLogin(login));

function readCookie(req) {
  const match = (req.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64}|d\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)`));
  return match ? match[1] : null;
}

// Vitrine de démo UNIQUEMENT (Vercel) : l'hébergeur lance plusieurs copies du serveur, chacune avec sa propre base
// temporaire ; une session enregistrée dans une copie est inconnue des autres (« Session expirée » à chaque clic).
// On y utilise donc une session « signée » portée par le cookie : identifiant + date d'expiration + signature HMAC.
// Les comptes de démo sont publics : la clé n'a pas besoin d'être secrète (réglable par DEMO_SESSION_SECRET).
// Sur la vraie boutique (config.demo = false), seules les sessions enregistrées en base sont acceptées.
const DEMO_KEY = process.env.DEMO_SESSION_SECRET || 'kamwa-demo-sessions-publiques';
const b64 = (s) => Buffer.from(s).toString('base64url');
const demoSign = (payload) => crypto.createHmac('sha256', DEMO_KEY).update(payload).digest('base64url');
function demoToken(login, maxAgeSec, by = null) {
  const payload = b64(JSON.stringify({ l: login, e: Date.now() + maxAgeSec * 1000, ...(by ? { b: by } : {}) }));
  return `d.${payload}.${demoSign(payload)}`;
}
function demoLogin(token) {
  if (!config.demo || !token?.startsWith('d.')) return null;
  const [, payload, sig] = token.split('.');
  const expected = demoSign(payload);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { l, e, b } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return e > Date.now() ? { login: l, by: b || null } : null;
  } catch { return null; }
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
    return res.status(503).json({
      error: process.env.VERCEL
        ? 'Démo : mot de passe admin non défini. Ajoutez ADMIN_PASSWORD_HASH dans les réglages Vercel (créé avec npm run admin:hash).'
        : 'Mot de passe admin pas encore défini. Dans le Terminal : npm run admin:password',
    });
  }
  const ipKey = 'ip:' + req.ip;
  const accKey = 'acc:' + loginName;
  const wait = Math.max(lockedFor(ipKey), lockedFor(accKey));
  if (wait) return res.status(429).json({ error: `Trop d'essais. Réessayez dans ${Math.ceil(wait / 60000)} min.` });

  let userId = null;
  if (loginName === ADMIN_LOGIN) {
    if (checkPassword(password, adminHash())) userId = ADMIN_LOGIN;
  } else {
    const u = findStaff(loginName);
    if (u && u.active !== false && !RETIRED_ROLES.includes(u.role) && checkPassword(password, u.passwordHash)) userId = u.id;
  }
  if (!userId) {
    addFailure(ipKey);
    addFailure(accKey);
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }
  failures.delete(ipKey);
  failures.delete(accKey);

  openSession(req, res, userId, loginName);
  res.json({ ok: true });
}

/** Ouvre une session (cookie) ; `by` = 'admin' quand l'administrateur se connecte en tant que ce membre. */
function openSession(req, res, userId, loginName, { by = null } = {}) {
  const maxAge = by ? IMPERSONATE_HOURS * 3600 : SESSION_DAYS * 24 * 3600;
  const old = readCookie(req); // la session précédente de ce navigateur est fermée
  if (old && !old.startsWith('d.')) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(old));
  if (config.demo) return res.setHeader('Set-Cookie', cookieHeader(req, demoToken(loginName, maxAge, by), maxAge));
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO admin_sessions (token_hash, expires_at, user_id, imp_by) VALUES (?, ?, ?, ?)').run(sha256(token), Date.now() + maxAge * 1000, userId, by);
  res.setHeader('Set-Cookie', cookieHeader(req, token, maxAge));
}

function logout(req, res) {
  const token = readCookie(req);
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
  res.json({ ok: true });
}

/** Personne connectée : { id, name, role, login, company?, mustChangePassword?, impersonatedBy? } ou null. */
const ADMIN_USER = () => ({ id: ADMIN_LOGIN, login: ADMIN_LOGIN, name: 'Administrateur', role: 'admin' });
function staffUser(u, by) {
  if (!u || u.active === false || RETIRED_ROLES.includes(u.role)) return null; // compte désactivé (ou rôle retiré) : accès coupé immédiatement
  return {
    id: u.id, login: u.login, name: u.name, role: u.role, company: u.company || null,
    // l'administrateur qui « se connecte en tant que » n'a pas à changer le mot de passe de la personne
    mustChangePassword: by ? false : Boolean(u.mustChangePassword),
    ...(by === ADMIN_LOGIN ? { impersonatedBy: 'Administrateur' } : {}),
  };
}
function currentUser(req) {
  const token = readCookie(req);
  if (!token) return null;
  if (token.startsWith('d.')) {
    const d = demoLogin(token);
    if (!d) return null;
    if (d.login === ADMIN_LOGIN) return ADMIN_USER();
    return staffUser(findStaff(d.login), d.by);
  }
  const row = db.prepare('SELECT expires_at, user_id, imp_by FROM admin_sessions WHERE token_hash = ?').get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  if (row.user_id === ADMIN_LOGIN) return ADMIN_USER();
  return staffUser(staff.get(row.user_id), row.imp_by);
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
  openSession,
};
