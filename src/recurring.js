// Dépenses récurrentes (demande Joseph 12/11/2026 : abonnement Claude, connexion internet le 26 du mois, serveur OVH…).
// Une règle = libellé, catégorie, montant, caisse, jour du mois, chaque mois ou chaque année. Le jour venu (heure du Congo),
// l'écriture est AJOUTÉE TOUTE SEULE dans Finances (collection `ledger`, `recurringId` + `recurringKey`), une seule fois :
// les mois déjà passés sont notés dans la règle (`posted`), donc une écriture supprimée à la main n'est jamais recréée.
// Vérifié au démarrage, toutes les heures, et à chaque ouverture de Finances (indispensable sur la démo Vercel, sans minuterie).
// Montant « variable » (ex. abonnement payé en dollars) : écriture marquée « montant prévu, à ajuster selon le relevé ».
const crypto = require('crypto');
const { settings, ledger, activity } = require('./store');

const KEY = 'finance:recurring';
const congoDay = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10); // UTC+1
const all = () => { try { return JSON.parse(settings.get(KEY) || '[]'); } catch { return []; } };
const save = (list) => settings.set(KEY, JSON.stringify(list));
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));

function clean(input, current = {}, { methods, categories }) {
  const r = { ...current };
  if ('label' in input) r.label = String(input.label || '').trim().slice(0, 120);
  if (!r.label) return { error: 'Donnez un libellé (ex. « Connexion internet »)' };
  if ('category' in input) r.category = input.category;
  // Charges seulement (les achats de stock passent par les bons de commande, les remboursements par la commande)
  if (!categories.some((c) => c.key === r.category && c.accrual !== false)) return { error: 'Choisissez une catégorie de charge (loyer, internet, salaires…)' };
  if ('amount' in input) r.amount = Number(String(input.amount ?? '').replace(/[\s  ]/g, ''));
  if (!Number.isInteger(r.amount) || r.amount <= 0 || r.amount > 1_000_000_000) return { error: 'Montant invalide (nombre entier en FCFA)' };
  if ('method' in input) r.method = input.method;
  if (!methods[r.method]) return { error: 'Choisissez la caisse' };
  if ('frequency' in input) r.frequency = input.frequency === 'yearly' ? 'yearly' : 'monthly';
  r.frequency ||= 'monthly';
  if ('day' in input) r.day = Math.round(Number(input.day));
  if (!(r.day >= 1 && r.day <= 31)) return { error: 'Jour du mois : 1 à 31' };
  if ('start' in input) r.start = String(input.start || '').slice(0, 7);
  if (!isMonth(r.start)) return { error: 'Premier mois invalide (AAAA-MM)' };
  if ('end' in input) r.end = input.end ? String(input.end).slice(0, 7) : null;
  if (r.end && (!isMonth(r.end) || r.end < r.start)) return { error: 'Dernier mois invalide' };
  if ('variable' in input) r.variable = Boolean(input.variable);
  if ('active' in input) r.active = Boolean(input.active);
  if (r.active === undefined) r.active = true;
  if ('note' in input) r.note = String(input.note || '').trim().slice(0, 300);
  return { value: r };
}

// Dates des échéances de la règle, du premier mois jusqu'à `until` (inclus), au jour réglé (ramené au dernier jour du mois)
function dates(r, until) {
  const out = [];
  let [y, m] = r.start.split('-').map(Number);
  for (let i = 0; i < 600; i++) {
    const ym = `${y}-${pad(m)}`;
    if (r.end && ym > r.end) break;
    const d = `${ym}-${pad(Math.min(r.day, lastDay(y, m)))}`;
    if (d > until) break;
    out.push({ ym, date: d });
    m += r.frequency === 'yearly' ? 12 : 1;
    while (m > 12) { m -= 12; y++; }
  }
  return out;
}
const nextDate = (r, today = congoDay()) => (r.active === false ? null : dates(r, '9999-12-31').find((x) => x.date > today && !(r.posted || []).includes(x.ym))?.date || null);
const monthly = (r) => (r.frequency === 'yearly' ? Math.round(r.amount / 12) : r.amount);

/** Ajoute dans Finances les échéances arrivées. Renvoie le nombre d'écritures créées. */
function postDue(today = congoDay()) {
  const list = all();
  let n = 0, changed = false;
  for (const r of list) {
    if (r.active === false) continue;
    const posted = new Set(r.posted || []);
    for (const { ym, date } of dates(r, today)) {
      if (posted.has(ym)) continue;
      const key = `${r.id}:${ym}`;
      if (!ledger.all().some((e) => e.recurringKey === key)) {
        const note = [r.note, r.variable ? 'Montant prévu (variable) : à ajuster selon le relevé.' : '', 'Ajoutée automatiquement (dépense récurrente).'].filter(Boolean).join(' ');
        const e = ledger.insert({
          id: 'FIN-' + crypto.randomBytes(5).toString('hex').toUpperCase(), type: 'expense', category: r.category, amount: r.amount, date, method: r.method,
          label: r.frequency === 'yearly' ? `${r.label} — ${date.slice(0, 4)}` : `${r.label} — ${new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`,
          note, toMethod: null, supplierId: null, purchaseId: null, receipt: null, recurringId: r.id, recurringKey: key, createdBy: 'auto', createdAt: new Date().toISOString(),
        });
        activity.insert({ id: 'ACT-' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), userId: 'auto', userName: 'Zado (automatique)', role: 'admin', action: 'Dépense récurrente enregistrée', targetId: e.id, targetName: e.label, details: `${r.amount} FCFA` });
        n++;
      }
      posted.add(ym); changed = true;
    }
    r.posted = [...posted].sort().slice(-60);
  }
  if (changed) save(list);
  return n;
}

function create(input, ctx) {
  const r = clean(input, {}, ctx);
  if (r.error) return r;
  const rule = { id: 'REC-' + crypto.randomBytes(4).toString('hex').toUpperCase(), ...r.value, posted: [], createdAt: new Date().toISOString() };
  // Mois déjà réglés à la main avant la création de la règle : ne pas les compter deux fois
  if (Array.isArray(input.alreadyPaid)) rule.posted = input.alreadyPaid.filter(isMonth);
  save([...all(), rule]);
  return { value: rule };
}
function update(id, input, ctx) {
  const list = all(), i = list.findIndex((x) => x.id === id);
  if (i < 0) return { error: 'Dépense récurrente introuvable', status: 404 };
  const r = clean(input, list[i], ctx);
  if (r.error) return r;
  list[i] = { ...r.value, updatedAt: new Date().toISOString() };
  save(list);
  return { value: list[i] };
}
function remove(id) {
  const list = all();
  if (!list.some((x) => x.id === id)) return false;
  save(list.filter((x) => x.id !== id));
  return true; // les écritures déjà enregistrées restent dans Finances
}

let timer = null;
function start() {
  if (timer || process.env.VERCEL) return;
  const tick = () => { try { const n = postDue(); if (n) console.log(`[finances] ${n} dépense(s) récurrente(s) enregistrée(s)`); } catch (err) { console.error('[finances]', err.message); } };
  setTimeout(tick, 5000).unref?.();
  timer = setInterval(tick, 3600e3); timer.unref?.();
}

module.exports = { all, create, update, remove, postDue, nextDate, monthly, dates, start, congoDay };
