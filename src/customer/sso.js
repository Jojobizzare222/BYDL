// Connexion sans code (décision Joseph 22/10/2026) : clés d'accès (passkeys, WebAuthn), Google et Apple.
//  - Clés d'accès : empreinte / Face ID / code du téléphone, aucun compte extérieur (@simplewebauthn/server, MIT).
//    La clé publique est gardée dans le compte client ; la clé privée ne quitte jamais le téléphone.
//  - Google / Apple : le navigateur reçoit un jeton signé (id_token) ; le SERVEUR vérifie sa signature avec les clés
//    publiques de Google / Apple, l'émetteur, le destinataire (notre identifiant) et la date. Rien n'est envoyé à Google
//    ou Apple par le serveur à part la lecture de leurs clés publiques.
//  - Un compte Google / Apple n'est JAMAIS rattaché automatiquement à un compte Zado par l'e-mail (les e-mails des comptes
//    Zado ne sont pas vérifiés : risque de prise de compte) : soit on crée un compte avec, soit le client connecté le lie
//    dans ses réglages.
//  - La pièce d'identité reste obligatoire pour commander, quelle que soit la façon de se connecter.
// Réglages (.env) : GOOGLE_CLIENT_ID ; APPLE_SERVICE_ID + APPLE_REDIRECT_URI ; RP_ID (domaine des clés d'accès, sinon celui de la page).
const crypto = require('crypto');
const { customers, settings, db } = require('../store');
const config = require('../config');
const wa = require('@simplewebauthn/server');

const PROVIDERS = {
  // jwks : clés publiques de Google / Apple (GOOGLE_JWKS_URL / APPLE_JWKS_URL servent uniquement aux tests automatiques)
  google: { name: 'Google', jwks: process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs', iss: ['accounts.google.com', 'https://accounts.google.com'], aud: () => process.env.GOOGLE_CLIENT_ID || '' },
  apple: { name: 'Apple', jwks: process.env.APPLE_JWKS_URL || 'https://appleid.apple.com/auth/keys', iss: ['https://appleid.apple.com'], aud: () => process.env.APPLE_SERVICE_ID || '' },
};

/** Ce que la boutique doit savoir pour afficher les boutons (rien de secret). */
function publicAuthConfig() {
  return {
    passkeys: true,
    google: process.env.GOOGLE_CLIENT_ID ? { clientId: process.env.GOOGLE_CLIENT_ID } : null,
    apple: process.env.APPLE_SERVICE_ID && process.env.APPLE_REDIRECT_URI ? { clientId: process.env.APPLE_SERVICE_ID, redirectURI: process.env.APPLE_REDIRECT_URI } : null,
  };
}

// ---------- Jetons signés courts (défi des clés d'accès, inscription après Google / Apple) ----------
// Démo Vercel : plusieurs copies du serveur → clé commune ; ailleurs : clé aléatoire gardée dans la base.
function secret() {
  if (config.demo) return process.env.DEMO_SESSION_SECRET || 'kamwa-demo-sso';
  let s = settings.get('sso:secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); settings.set('sso:secret', s); }
  return s;
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function sign(data, minutes) {
  const payload = b64u(JSON.stringify({ ...data, x: Date.now() + minutes * 60000 }));
  return `${payload}.${crypto.createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
function unsign(token, type) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { const d = JSON.parse(Buffer.from(payload, 'base64url').toString()); return d.t === type && d.x > Date.now() ? d : null; } catch { return null; }
}

// Défis à usage unique : une réponse de clé d'accès ne peut servir qu'une fois (les clés Apple / Google gardent leur compteur à 0)
db.exec('CREATE TABLE IF NOT EXISTS sso_used (h TEXT PRIMARY KEY, exp INTEGER NOT NULL)');
function useOnce(challenge) {
  const h = crypto.createHash('sha256').update(String(challenge)).digest('hex');
  db.prepare('DELETE FROM sso_used WHERE exp < ?').run(Date.now());
  try { db.prepare('INSERT INTO sso_used (h, exp) VALUES (?, ?)').run(h, Date.now() + 15 * 60000); return true; } catch { return false; }
}

// ---------- Clés d'accès ----------
const origin = (req) => `${String(req.get('x-forwarded-proto') || req.protocol).split(',')[0]}://${req.get('host')}`;
const rpID = (req) => process.env.RP_ID || req.hostname;
const byCredential = (credId) => customers.find((c) => (c.passkeys || []).some((k) => k.id === credId));

async function passkeyRegisterOptions(req, customer) {
  const options = await wa.generateRegistrationOptions({
    rpName: 'Zado', rpID: rpID(req),
    userName: customer.email || customer.phone || customer.id, userDisplayName: customer.name,
    userID: new TextEncoder().encode(customer.id),
    attestationType: 'none',
    excludeCredentials: (customer.passkeys || []).map((k) => ({ id: k.id, transports: k.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  return { options, token: sign({ t: 'reg', c: options.challenge, u: customer.id }, 10) };
}
async function passkeyRegister(req, customer, { response, token, label }) {
  const t = unsign(token, 'reg');
  if (!t || t.u !== customer.id) return { error: 'Demande expirée : recommencez' };
  if (!useOnce(t.c)) return { error: 'Demande déjà utilisée : recommencez' };
  if ((customer.passkeys || []).length >= 10) return { error: 'Dix clés d\'accès au maximum : retirez-en une d\'abord' };
  let v;
  try { v = await wa.verifyRegistrationResponse({ response, expectedChallenge: t.c, expectedOrigin: origin(req), expectedRPID: rpID(req), requireUserVerification: false }); }
  catch (err) { return { error: 'Clé d\'accès refusée : ' + err.message }; }
  if (!v.verified) return { error: 'Clé d\'accès refusée' };
  const c = v.registrationInfo.credential;
  if (byCredential(c.id)) return { error: 'Cette clé d\'accès est déjà enregistrée' };
  const key = {
    id: c.id, publicKey: b64u(c.publicKey), counter: c.counter, transports: c.transports || [],
    label: String(label || '').trim().slice(0, 40) || 'Mon téléphone', backedUp: Boolean(v.registrationInfo.credentialBackedUp),
    createdAt: new Date().toISOString(), lastUsedAt: null,
  };
  customers.update(customer.id, { passkeys: [...(customer.passkeys || []), key] });
  return { key };
}
async function passkeyLoginOptions(req) {
  const options = await wa.generateAuthenticationOptions({ rpID: rpID(req), userVerification: 'preferred', allowCredentials: [] });
  return { options, token: sign({ t: 'auth', c: options.challenge }, 5) };
}
async function passkeyLogin(req, { response, token }) {
  const t = unsign(token, 'auth');
  if (!t) return { status: 400, error: 'Demande expirée : recommencez' };
  if (!useOnce(t.c)) return { status: 401, error: 'Demande déjà utilisée : recommencez' };
  const customer = response?.id && byCredential(response.id);
  if (!customer) return { status: 401, error: 'Clé d\'accès inconnue sur Zado : connectez-vous avec votre code, puis ajoutez-la dans vos réglages' };
  const key = customer.passkeys.find((k) => k.id === response.id);
  let v;
  try {
    v = await wa.verifyAuthenticationResponse({
      response, expectedChallenge: t.c, expectedOrigin: origin(req), expectedRPID: rpID(req), requireUserVerification: false,
      credential: { id: key.id, publicKey: Buffer.from(key.publicKey, 'base64url'), counter: key.counter, transports: key.transports },
    });
  } catch (err) { return { status: 401, error: 'Clé d\'accès refusée : ' + err.message }; }
  if (!v.verified) return { status: 401, error: 'Clé d\'accès refusée' };
  const now = new Date().toISOString();
  customers.update(customer.id, { passkeys: customer.passkeys.map((k) => (k.id === key.id ? { ...k, counter: v.authenticationInfo.newCounter, lastUsedAt: now } : k)) });
  return { customer: customers.get(customer.id) };
}
function removePasskey(customer, id) {
  const list = (customer.passkeys || []).filter((k) => k.id !== id);
  if (list.length === (customer.passkeys || []).length) return false;
  customers.update(customer.id, { passkeys: list });
  return true;
}

// ---------- Google / Apple : vérification du jeton d'identité ----------
const jwksCache = new Map(); // url → { at, keys }
async function jwks(url, force = false) {
  const hit = jwksCache.get(url);
  if (hit && !force && Date.now() - hit.at < 6 * 3600 * 1000) return hit.keys;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('clés publiques indisponibles');
  const keys = (await r.json()).keys || [];
  jwksCache.set(url, { at: Date.now(), keys });
  return keys;
}
/** Vérifie un id_token Google / Apple. Renvoie { claims } ou { error }. Exporté pour les tests (jwksUrl remplaçable). */
async function verifyIdToken(provider, token, { jwksUrl } = {}) {
  const P = PROVIDERS[provider];
  if (!P) return { error: 'Fournisseur inconnu' };
  const aud = P.aud();
  if (!aud) return { error: `Connexion ${P.name} pas encore configurée` };
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { error: 'Jeton invalide' };
  let header, claims;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { return { error: 'Jeton invalide' }; }
  if (header.alg !== 'RS256' || !header.kid) return { error: 'Jeton invalide' };
  let keys;
  try {
    keys = await jwks(jwksUrl || P.jwks);
    if (!keys.some((k) => k.kid === header.kid)) keys = await jwks(jwksUrl || P.jwks, true); // clés renouvelées
  } catch (err) { return { error: `${P.name} injoignable, réessayez (${err.message})` }; }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { error: 'Jeton invalide (clé inconnue)' };
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) return { error: 'Jeton invalide (signature)' };
  const now = Math.floor(Date.now() / 1000);
  if (!P.iss.includes(claims.iss)) return { error: 'Jeton invalide (émetteur)' };
  if (claims.aud !== aud && !(Array.isArray(claims.aud) && claims.aud.includes(aud))) return { error: 'Jeton invalide (destinataire)' };
  if (!(claims.exp > now - 60) || (claims.iat && claims.iat > now + 300)) return { error: 'Jeton expiré : recommencez' };
  if (!claims.sub) return { error: 'Jeton invalide' };
  const emailOk = claims.email && (claims.email_verified === true || claims.email_verified === 'true');
  return { claims: { sub: String(claims.sub), email: emailOk ? String(claims.email).toLowerCase() : null, name: claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || '' } };
}
const byProvider = (provider, sub) => customers.find((c) => c.oauth?.[provider]?.sub === sub);

/**
 * Après un jeton vérifié : { customer } (compte déjà lié → connexion), { linked } (client connecté qui lie son compte),
 * ou { signup, token, profile } (aucun compte lié : formulaire de création pré-rempli, avec la pièce d'identité).
 */
function resolveProvider(provider, claims, { current = null, link = false } = {}) {
  const other = byProvider(provider, claims.sub);
  if (link) {
    if (!current) return { status: 401, error: 'Connectez-vous d\'abord' };
    if (other && other.id !== current.id) return { status: 409, error: `Ce compte ${PROVIDERS[provider].name} est déjà lié à un autre compte Zado` };
    customers.update(current.id, { oauth: { ...(current.oauth || {}), [provider]: { sub: claims.sub, email: claims.email, linkedAt: new Date().toISOString() } } });
    return { linked: true };
  }
  if (other) return { customer: other };
  const emailTaken = Boolean(claims.email && customers.find((c) => c.email === claims.email));
  return {
    signup: true, emailTaken,
    profile: { name: claims.name, email: claims.email },
    token: sign({ t: 'signup', p: provider, s: claims.sub, e: claims.email, n: claims.name }, 30),
  };
}
/** Inscription après Google / Apple : champs à ajouter au nouveau compte (ou { error }). */
function signupFields(token) {
  const d = unsign(token, 'signup');
  if (!d) return { error: 'Connexion Google / Apple expirée : recommencez' };
  if (byProvider(d.p, d.s)) return { error: 'Ce compte est déjà lié à un compte Zado : connectez-vous' };
  return { email: d.e || null, name: d.n || '', oauth: { [d.p]: { sub: d.s, email: d.e || null, linkedAt: new Date().toISOString() } }, emailVerified: Boolean(d.e) };
}
function unlinkProvider(customer, provider) {
  if (!customer.oauth?.[provider]) return false;
  const { [provider]: _, ...rest } = customer.oauth;
  customers.update(customer.id, { oauth: rest });
  return true;
}

/** Vue client (jamais les clés publiques complètes ni les identifiants Google / Apple). */
const publicSso = (c) => ({
  passkeys: (c.passkeys || []).map((k) => ({ id: k.id, label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, synced: k.backedUp })),
  linked: Object.fromEntries(Object.entries(c.oauth || {}).map(([p, v]) => [p, { email: v.email || null, linkedAt: v.linkedAt }])),
});

module.exports = {
  PROVIDERS, publicAuthConfig, publicSso,
  passkeyRegisterOptions, passkeyRegister, passkeyLoginOptions, passkeyLogin, removePasskey,
  verifyIdToken, resolveProvider, signupFields, unlinkProvider, _sign: sign, _jwksCache: jwksCache,
};
