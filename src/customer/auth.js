// Comptes clients : identifiant = numéro de téléphone OU e-mail + code Kamwa à 6 chiffres attribué par le site.
//  - le code n'est jamais stocké en clair (empreinte scrypt) ; il n'est montré qu'une fois, à la création ;
//  - le code seul ne suffit pas (900 000 possibilités) : il faut aussi le numéro ou l'e-mail ;
//  - 5 essais ratés sur un compte => compte bloqué 15 minutes ; 20 essais ratés depuis une même adresse => 15 minutes.
const crypto = require('crypto');
const { db, customers } = require('../store');
const { normalizeLocal } = require('../utils/phone');

const COOKIE = 'kamwa_client';
const SESSION_DAYS = 30;
const MAX_FAILS_ACCOUNT = 5;
const MAX_FAILS_IP = 20;
const LOCK_MS = 15 * 60 * 1000;

db.exec('CREATE TABLE IF NOT EXISTS customer_sessions (token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL, expires_at INTEGER NOT NULL)');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Code à 6 chiffres, de 100000 à 999999 (jamais de 0 en tête). */
const newCode = () => String(crypto.randomInt(100000, 1000000));

function hashCode(code) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(code, salt, 32).toString('hex')}`;
}

function checkCode(code, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash || !/^\d{6}$/.test(String(code))) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(String(code), salt, 32), Buffer.from(hash, 'hex'));
}

const normEmail = (s) => {
  const e = String(s || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && e.length <= 120 ? e : null;
};

/** Retrouve un compte à partir d'un numéro ou d'un e-mail tapé par le client. */
function findByIdentifier(identifier) {
  const raw = String(identifier || '').trim();
  if (raw.includes('@')) {
    const email = normEmail(raw);
    return email ? customers.find((c) => c.email === email) : undefined;
  }
  const phone = normalizeLocal(raw);
  return phone ? customers.find((c) => c.phone === phone) : undefined;
}

// Données renvoyées au navigateur (jamais l'empreinte du code)
// Jamais l'empreinte du code ni le nom du fichier de la pièce d'identité
const publicCustomer = ({ codeHash, idPhoto, idCheckedBy, ...c }) => ({ ...c, idStatus: c.idStatus || 'missing' });

function readCookie(req) {
  const match = (req.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return match ? match[1] : null;
}

function openSession(req, res, customerId) {
  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_DAYS * 24 * 3600;
  db.prepare('DELETE FROM customer_sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), customerId, Date.now() + maxAge * 1000);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`);
}

function closeSession(req, res) {
  const token = readCookie(req);
  if (token) db.prepare('DELETE FROM customer_sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${req.secure ? '; Secure' : ''}`);
}

/** Client connecté (ou null). */
function currentCustomer(req) {
  const token = readCookie(req);
  if (!token) return null;
  const row = db.prepare('SELECT customer_id, expires_at FROM customer_sessions WHERE token_hash = ?').get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  return customers.get(row.customer_id) || null;
}

// ---------- Anti « devinette » ----------
const failures = new Map(); // clé (compte ou ip) -> { count, lockedUntil }
const isLocked = (key) => Date.now() < (failures.get(key)?.lockedUntil || 0);
function addFailure(key, max) {
  const f = failures.get(key) || { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= max) Object.assign(f, { count: 0, lockedUntil: Date.now() + LOCK_MS });
  failures.set(key, f);
}

/** Vérifie identifiant + code. Renvoie { customer } ou { error, status }. */
function verifyLogin(req, identifier, code) {
  const ipKey = 'ip:' + req.ip;
  if (isLocked(ipKey)) return { status: 429, error: "Trop d'essais. Réessayez dans 15 minutes." };
  const customer = findByIdentifier(identifier);
  const accountKey = customer ? 'acc:' + customer.id : null;
  if (accountKey && isLocked(accountKey)) {
    return { status: 429, error: 'Compte bloqué 15 minutes après plusieurs codes erronés. Réessayez plus tard.' };
  }
  if (!customer || !checkCode(code, customer.codeHash)) {
    addFailure(ipKey, MAX_FAILS_IP);
    if (accountKey) addFailure(accountKey, MAX_FAILS_ACCOUNT);
    // Même message dans tous les cas : on ne révèle pas si le numéro a un compte
    return { status: 401, error: 'Numéro / e-mail ou code incorrect' };
  }
  failures.delete(accountKey);
  return { customer };
}

/** Nouveau code pour un compte (création ou « code oublié » via l'admin). Renvoie le code en clair, à montrer une seule fois. */
function assignNewCode(customerId) {
  const code = newCode();
  customers.update(customerId, { codeHash: hashCode(code) });
  db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(customerId); // déconnecte les anciens appareils
  failures.delete('acc:' + customerId);
  return code;
}

module.exports = {
  newCode,
  hashCode,
  normEmail,
  findByIdentifier,
  publicCustomer,
  openSession,
  closeSession,
  currentCustomer,
  verifyLogin,
  assignNewCode,
};
