// Comptes clients : identifiant = numéro de téléphone OU e-mail + code Zado à 6 chiffres attribué par le site.
//  - le code n'est jamais stocké en clair : empreinte scrypt pour la connexion + copie CHIFFRÉE (AES-256-GCM, `codeSealed`)
//    que seul l'administrateur peut afficher dans Zado Pro (décision Joseph 21/10/2026 : voir et corriger le code des clients ;
//    chaque affichage est inscrit au journal). Clé : CUSTOMER_CODE_KEY dans .env, sinon fichier code.key à côté de la base ;
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
const validCode = (c) => /^[1-9]\d{5}$/.test(String(c || ''));

// ---- Copie chiffrée du code (lisible par l'administrateur seulement) ----
let codeKey = null;
function key() {
  if (codeKey) return codeKey;
  const env = process.env.CUSTOMER_CODE_KEY;
  if (env && /^[0-9a-f]{64}$/i.test(env)) return (codeKey = Buffer.from(env, 'hex'));
  const file = require('path').join(require('path').dirname(require('../store').DB_FILE), 'code.key');
  try { codeKey = Buffer.from(require('fs').readFileSync(file, 'utf8').trim(), 'hex'); } catch { /* pas encore de clé */ }
  if (!codeKey || codeKey.length !== 32) { codeKey = crypto.randomBytes(32); require('fs').writeFileSync(file, codeKey.toString('hex'), { mode: 0o600 }); }
  return codeKey;
}
function sealCode(code) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(code), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}
function openCode(sealed) {
  const [v, iv, tag, enc] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !tag || !enc) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; } // clé changée : code illisible, l'admin en crée un nouveau
}
/** Champs à enregistrer pour un code : empreinte (connexion) + copie chiffrée (affichage admin). */
const codeFields = (code) => ({ codeHash: hashCode(code), codeSealed: sealCode(code) });

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
// ni le résultat du contrôle automatique (réservé à l'admin)
// Clés d'accès et comptes Google / Apple : seulement leur liste (src/customer/sso.js), jamais les clés ni les identifiants
const publicCustomer = ({ codeHash, codeSealed, idPhoto, idCheckedBy, idAuto, idAutoAt, passkeys, oauth, ...c }) => ({ ...c, idStatus: c.idStatus || 'missing', ...require('./sso').publicSso({ passkeys, oauth }) });

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

/** Nouveau code pour un compte (« code oublié », changement par le client, correction par l'admin). Code choisi par l'admin possible. */
function assignNewCode(customerId, chosen = null) {
  const code = chosen != null ? String(chosen).trim() : newCode();
  if (!validCode(code)) throw Object.assign(new Error('Le code doit avoir 6 chiffres et ne pas commencer par 0'), { status: 400 });
  customers.update(customerId, { ...codeFields(code), codeChangedAt: new Date().toISOString() });
  db.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').run(customerId); // déconnecte les anciens appareils
  failures.delete('acc:' + customerId);
  // Alerte de sécurité sur les téléphones du client (jamais le code lui-même)
  require('../push').notifyCustomer(customerId, 'Votre code Zado a changé', "Si ce n'est pas vous, écrivez-nous tout de suite dans « Aide ».", '/#/compte/reglages', 'zado-securite');
  return code;
}

module.exports = {
  newCode,
  hashCode,
  codeFields,
  sealCode,
  openCode,
  validCode,
  normEmail,
  findByIdentifier,
  publicCustomer,
  openSession,
  closeSession,
  currentCustomer,
  verifyLogin,
  assignNewCode,
};
