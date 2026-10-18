// Mode maintenance de la boutique (décision Joseph 18/10/2026), activé depuis Zado Pro → Réglages [admin] :
//  - à l'ouverture de la boutique, les clients voient un écran avec le message choisi (et l'heure de retour prévue) ;
//  - pendant la maintenance, le serveur refuse les NOUVELLES commandes, les nouvelles demandes de paiement et les
//    créations de compte (503) ; restent possibles : consulter, suivre une commande, se connecter, écrire à l'Aide,
//    et les retours des opérateurs de paiement (callbacks) pour ne perdre aucun paiement déjà en cours ;
//  - Zado Pro n'est jamais bloqué ; un bandeau rappelle à l'équipe que la boutique est fermée.
// Changement signalé tout de suite aux boutiques ouvertes (flux /api/events, sujet « maintenance »).
const { settings } = require('./store');

const DEFAULT_MESSAGE = 'Zado fait peau neuve ! Notre boutique est en maintenance pour quelques instants. Revenez très vite.';

function get() {
  try {
    const m = JSON.parse(settings.get('maintenance') || 'null') || {};
    return { enabled: Boolean(m.enabled), message: m.message || DEFAULT_MESSAGE, until: m.until || null, since: m.since || null, by: m.by || null };
  } catch { return { enabled: false, message: DEFAULT_MESSAGE, until: null, since: null, by: null }; }
}

/** Active / désactive ; message (300 caractères max) et heure de retour prévue (facultative, dans le futur). */
function set(input, by) {
  const cur = get();
  const enabled = 'enabled' in (input || {}) ? Boolean(input.enabled) : cur.enabled;
  const message = String(input?.message ?? cur.message).replace(/\s+/g, ' ').trim().slice(0, 300) || DEFAULT_MESSAGE;
  let until = input && 'until' in input ? input.until : cur.until;
  if (until) {
    const t = Date.parse(until);
    if (!Number.isFinite(t)) return { error: 'Heure de retour invalide' };
    until = new Date(t).toISOString();
  } else until = null;
  const value = { enabled, message, until, since: enabled ? (cur.enabled ? cur.since : new Date().toISOString()) : null, by: enabled ? by || null : null };
  settings.set('maintenance', JSON.stringify(value));
  require('./events').bus.emit('change', { col: 'maintenance', doc: { id: 'maintenance' }, before: null });
  return { value };
}

/** Version publique (boutique) : jamais le nom de la personne qui a activé. */
const publicState = () => { const m = get(); return { enabled: m.enabled, message: m.message, until: m.until }; };

// Actions refusées pendant la maintenance (le reste du site reste consultable)
const BLOCKED = [
  ['POST', /^\/api\/orders\/?$/],
  ['POST', /^\/api\/payments\/?$/],
  ['POST', /^\/api\/account\/register\/?$/],
];
function guard(req, res, next) {
  if (!BLOCKED.some(([m, re]) => req.method === m && re.test(req.path))) return next();
  const m = get();
  if (!m.enabled) return next();
  res.status(503).json({ error: m.message, maintenance: true, until: m.until });
}

module.exports = { get, set, publicState, guard, DEFAULT_MESSAGE };
