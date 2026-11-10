// Mode Noël (décision Joseph 10/11/2026, « pack Noël ») : bandeau + diapositive « Commandez avant le … pour être livré
// avant Noël », compte à rebours, page « Idées cadeaux ». Zado Pro → Réglages → « Mode Noël » [admin].
// Date limite AUTOMATIQUE à partir des délais annoncés (Réglages → Transport) : 24 décembre − (logistique max + livraison)
// − marge de sécurité (vols 2 à 4 fois par semaine) ; avec 5 jours + 24 h et 3 jours de marge → 15 décembre.
// Affiché du `start` au 25 décembre ; après la date limite, le message devient « livré après Noël » (jamais de promesse fausse).
const { settings } = require('./store');

const congoDay = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Brazzaville' })).toLocaleDateString('en-CA');
const DEFAULTS = { enabled: true, auto: true, start: '11-10', deadline: null, margin: 3 };

function noelSettings() {
  let v = {}; try { v = JSON.parse(settings.get('noel') || 'null') || {}; } catch {}
  return { ...DEFAULTS, ...v };
}

function saveNoelSettings(input = {}) {
  const s = noelSettings();
  if ('enabled' in input) s.enabled = Boolean(input.enabled);
  if ('auto' in input) s.auto = Boolean(input.auto);
  if ('start' in input) { const v = String(input.start || '').slice(-5); if (!/^(1[0-2])-(\d\d)$/.test(v)) return { error: 'Date de début invalide (mois-jour, ex. 11-10)' }; s.start = v; }
  if ('deadline' in input) {
    const v = input.deadline ? String(input.deadline).slice(-5) : null;
    if (v && !/^12-(0[1-9]|1\d|2[0-4])$/.test(v)) return { error: 'Date limite : entre le 1er et le 24 décembre' };
    s.deadline = v;
  }
  if ('margin' in input) { const m = Math.round(Number(input.margin)); if (!(m >= 0 && m <= 10)) return { error: 'Marge : 0 à 10 jours' }; s.margin = m; }
  settings.set('noel', JSON.stringify(s));
  return { value: s };
}

/** Date limite « mois-jour » : saisie à la main, ou calculée à partir des délais. */
function deadlineMD(s = noelSettings()) {
  if (!s.auto && s.deadline) return s.deadline;
  const f = require('./freight').freightSettings();
  const days = (f.logisticsMax || 5) + Math.ceil((f.deliveryHours || 24) / 24) + (s.margin ?? 3);
  const d = Math.max(1, 24 - days);
  return `12-${String(d).padStart(2, '0')}`;
}

/** État public (boutique) : null hors période. `phase` = before (on peut encore être livré) | late (trop tard). */
function publicNoel(today = congoDay()) {
  const s = noelSettings();
  if (!s.enabled) return null;
  const year = today.slice(0, 4), md = today.slice(5);
  if (md < s.start || md > '12-25') return null;
  const deadline = `${year}-${deadlineMD(s)}`;
  return { deadline, phase: today <= deadline ? 'before' : 'late', christmas: `${year}-12-25` };
}

module.exports = { noelSettings, saveNoelSettings, publicNoel, deadlineMD };
