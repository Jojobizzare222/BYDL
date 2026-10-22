// Connexion sans code (22/10/2026) : clés d'accès (authentificateur simulé en logiciel, ES256) + Google / Apple
// (faux jetons signés par une clé RSA de test, clés publiques servies par un petit serveur local GOOGLE_JWKS_URL / APPLE_JWKS_URL).
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
const B = 'http://localhost:3999/api', ORIGIN = 'http://localhost:3999';
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK    ' : 'ÉCHEC ') + m); if (!c) fails++; };
const call = async (j, p, o = {}) => { const r = await fetch(B + p, { method: o.method || (o.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: j?.c || '', ...o.headers }, body: o.body && JSON.stringify(o.body) }); const sc = r.headers.get('set-cookie'); if (sc && j) j.c = sc.split(';')[0]; const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data }; };
const ID = { idType: 'cni', idPhoto: 'data:image/jpeg;base64,' + fs.readFileSync(process.argv[3]).toString('base64') };
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (b) => crypto.createHash('sha256').update(b).digest();

// ---- Mini CBOR (ce qu'il faut pour une attestation « none ») ----
const head = (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
function cbor(v) {
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor');
}
// ---- Authentificateur simulé ----
const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwkPub = keyPair.publicKey.export({ format: 'jwk' });
const credId = crypto.randomBytes(16);
let counter = 0;
const rpHash = sha('localhost');
function attestation(challenge) {
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwkPub.x, 'base64url')], [-3, Buffer.from(jwkPub.y, 'base64url')]]));
  const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN, crossOrigin: false }));
  return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))), transports: ['internal'] } };
}
function assertion(challenge, origin = ORIGIN) {
  counter += 1;
  const authData = Buffer.concat([rpHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, counter])]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
  const signature = crypto.sign('sha256', Buffer.concat([authData, sha(clientDataJSON)]), keyPair.privateKey);
  return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: undefined } };
}

// ---- Faux Google / Apple : clé RSA de test + serveur de clés publiques ----
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'test-key-1';
const jwks = { keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] };
const srv = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(jwks)); }).listen(3997);
function idToken(claims, { key = rsa.privateKey, k = kid } = {}) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid: k, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64u(JSON.stringify({ iat: now, exp: now + 600, ...claims }));
  return `${h}.${p}.${b64u(crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key))}`;
}
const G = (extra = {}) => idToken({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID || 'zado-test.apps.googleusercontent.com', sub: 'g-123', email: 'awa.sso@gmail.com', email_verified: true, name: 'Awa Sso', ...extra });

try {
  const cfg = (await call(null, '/config')).data.auth;
  ok(cfg.passkeys && cfg.google?.clientId && cfg.apple?.clientId && !JSON.stringify(cfg).match(/secret|jwks/i), 'boutique : boutons clé d\'accès, Google, Apple annoncés (rien de secret)');

  // 1) Clés d'accès
  const C = { c: '' };
  const reg = (await call(C, '/account/register', { body: { name: 'Awa Clé', phone: '069990001', ...ID } })).data;
  ok(reg.customer && Array.isArray(reg.customer.passkeys) && !reg.customer.passkeys.length, 'compte créé (sans clé d\'accès)');
  ok((await call(null, '/account/passkey/register-options', { body: {} })).status === 401, 'ajouter une clé d\'accès : il faut être connecté');
  const ro = (await call(C, '/account/passkey/register-options', { body: {} })).data;
  ok(ro.options?.challenge && ro.options.rp.id === 'localhost' && ro.options.authenticatorSelection.residentKey === 'required', 'options de création : domaine localhost, clé « découvrable »');
  const r1 = await call(C, '/account/passkey/register', { body: { response: attestation(ro.options.challenge), token: ro.token, label: 'iPhone de test' } });
  ok(r1.status === 201 && r1.data.customer.passkeys.length === 1 && r1.data.customer.passkeys[0].label === 'iPhone de test' && !('publicKey' in r1.data.customer.passkeys[0]), 'clé d\'accès enregistrée (la clé publique ne sort jamais)');
  const ro2 = (await call(C, '/account/passkey/register-options', { body: {} })).data;
  ok((await call(C, '/account/passkey/register', { body: { response: attestation('autre-defi'), token: ro2.token } })).status === 400, 'mauvais défi : refusé');

  const L = { c: '' };
  const lo = (await call(L, '/account/passkey/login-options', { body: {} })).data;
  const first = assertion(lo.options.challenge);
  const l1 = await call(L, '/account/passkey/login', { body: { response: first, token: lo.token } });
  ok(l1.status === 200 && l1.data.customer.id === reg.customer.id && (await call(L, '/account/me')).data.loggedIn, 'connexion par clé d\'accès : connecté, sans code');
  ok((await call({ c: '' }, '/account/passkey/login', { body: { response: first, token: lo.token } })).status === 401, 'réponse rejouée telle quelle : refusée');
  ok((await call({ c: '' }, '/account/passkey/login', { body: { response: assertion(lo.options.challenge), token: lo.token } })).status === 401, 'même défi signé une 2e fois : refusé (défi à usage unique)');
  const lo2 = (await call(null, '/account/passkey/login-options', { body: {} })).data;
  ok((await call(null, '/account/passkey/login', { body: { response: assertion(lo2.options.challenge, 'https://faux-zado.example'), token: lo2.token } })).status === 401, 'réponse venue d\'un autre site : refusée');
  const tampered = assertion((await call(null, '/account/passkey/login-options', { body: {} })).data.options.challenge);
  ok((await call(null, '/account/passkey/login', { body: { response: tampered, token: 'faux.jeton' } })).status === 400, 'défi falsifié : refusé');
  const del = await call(C, '/account/passkeys/' + encodeURIComponent(b64u(credId)), { method: 'DELETE' });
  ok(del.status === 200 && !del.data.customer.passkeys.length, 'clé d\'accès retirée depuis les réglages');

  // 2) Google : aucun compte lié → création pré-remplie
  const g1 = await call({ c: '' }, '/account/oauth/google', { body: { credential: G() } });
  ok(g1.status === 200 && g1.data.signup && g1.data.profile.email === 'awa.sso@gmail.com' && g1.data.profile.name === 'Awa Sso' && g1.data.oauthToken, 'Google sans compte lié : formulaire de création pré-rempli (nom, e-mail)');
  ok((await call(null, '/account/oauth/google', { body: { credential: G({ aud: 'autre-site' }) } })).status === 400, 'jeton destiné à un autre site : refusé');
  ok((await call(null, '/account/oauth/google', { body: { credential: G({ exp: Math.floor(Date.now() / 1000) - 3600 }) } })).status === 400, 'jeton expiré : refusé');
  ok((await call(null, '/account/oauth/google', { body: { credential: idToken({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub: 'x' }, { key: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey }) } })).status === 400, 'jeton signé par une autre clé : refusé');
  ok((await call(null, '/account/oauth/google', { body: { credential: G({ iss: 'https://pirate.example' }) } })).status === 400, 'mauvais émetteur : refusé');
  const GC = { c: '' };
  const g2 = await call(GC, '/account/register', { body: { name: 'Awa Sso', phone: '069990002', ...ID, oauthToken: g1.data.oauthToken } });
  ok(g2.status === 201 && g2.data.customer.email === 'awa.sso@gmail.com' && g2.data.customer.linked.google?.email === 'awa.sso@gmail.com' && g2.data.customer.idStatus === 'pending', 'compte créé avec Google : lié, e-mail repris, pièce d\'identité quand même obligatoire');
  const g3 = await call({ c: '' }, '/account/oauth/google', { body: { credential: G() } });
  ok(g3.status === 200 && g3.data.customer?.id === g2.data.customer.id, 'ensuite : « Continuer avec Google » connecte directement');
  ok((await call({ c: '' }, '/account/register', { body: { name: 'X', phone: '069990003', ...ID, oauthToken: g1.data.oauthToken } })).status === 400, 'jeton d\'inscription réutilisé pour un 2e compte : refusé');

  // 3) Pas de rattachement automatique par e-mail : un compte Zado existant avec le même e-mail n'est PAS ouvert
  const V = { c: '' };
  await call(V, '/account/register', { body: { name: 'Bob Code', email: 'bob@gmail.com', ...ID } });
  const g4 = await call({ c: '' }, '/account/oauth/google', { body: { credential: G({ sub: 'g-bob', email: 'bob@gmail.com', name: 'Bob' }) } });
  ok(g4.data.signup && g4.data.emailTaken && !g4.data.customer, 'même e-mail qu\'un compte Zado : jamais de connexion automatique (risque de prise de compte)');
  const lk = await call(V, '/account/oauth/google', { body: { credential: G({ sub: 'g-bob', email: 'bob@gmail.com' }), link: true } });
  ok(lk.data.linked && lk.data.customer.linked.google, 'le client connecté lie lui-même Google dans ses réglages');
  ok((await call(GC, '/account/oauth/google', { body: { credential: G({ sub: 'g-bob' }), link: true } })).status === 409, 'un compte Google déjà lié ailleurs : refusé');
  const ul = await call(V, '/account/oauth/google', { method: 'DELETE' });
  ok(ul.status === 200 && !ul.data.customer.linked.google, 'délier Google');

  // 4) Apple
  const A1 = await call({ c: '' }, '/account/oauth/apple', { body: { credential: idToken({ iss: 'https://appleid.apple.com', aud: process.env.APPLE_SERVICE_ID, sub: 'a-1', email: 'x1y2@privaterelay.appleid.com', email_verified: 'true' }) } });
  ok(A1.data.signup && A1.data.profile.email === 'x1y2@privaterelay.appleid.com', 'Apple : jeton vérifié, e-mail relais d\'Apple repris');
  ok((await call(null, '/account/oauth/apple', { body: { credential: G() } })).status === 400, 'jeton Google présenté comme Apple : refusé');
  const me = (await call(GC, '/account/me')).data.customer;
  ok(!JSON.stringify(me).includes('g-123') && !('oauth' in me), 'le navigateur ne reçoit jamais l\'identifiant Google / Apple');
} finally { srv.close(); }
console.log(fails ? fails + ' ÉCHEC(S)' : 'TOUT EST OK');
process.exit(fails ? 1 : 0);
