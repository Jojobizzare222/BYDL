// Stockage dans une base SQLite (un seul fichier : data/baydel.db — nom historique, d'avant Kamwa), intégrée à Node.js, rien à installer.
// Chaque collection est une table (id + document JSON) : les routes gardent la même interface qu'avant.
// Au premier démarrage, le contenu de data/products.json (et des anciens orders.json / payments.json) est importé.
// Ensuite, c'est la base qui fait foi : les produits se modifient depuis l'espace admin, plus dans products.json.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
// Sur Vercel, le disque est en lecture seule sauf /tmp, qui est vidé régulièrement :
// la base y est donc TEMPORAIRE (vitrine de démonstration), et repart du catalogue de départ à chaque redémarrage.
const DB_FILE = process.env.DB_FILE || (process.env.VERCEL ? '/tmp/kamwa-demo.db' : path.join(DATA_DIR, 'baydel.db'));
// Catalogue de départ chargé avec require() : ainsi Vercel l'embarque avec le serveur.
const SEEDS = { products: () => require('../data/products.json') };

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

const settings = {
  get: (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null,
  set: (key, value) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value)),
};

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function createCollection(name) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  const q = {
    all: db.prepare(`SELECT data FROM ${name} ORDER BY rowid`),
    get: db.prepare(`SELECT data FROM ${name} WHERE id = ?`),
    insert: db.prepare(`INSERT INTO ${name} (id, data) VALUES (?, ?)`),
    update: db.prepare(`UPDATE ${name} SET data = ? WHERE id = ?`),
  };

  // Import unique des anciens fichiers JSON
  const seedFile = path.join(DATA_DIR, `${name}.json`);
  if (!settings.get(`imported:${name}`)) {
    let seed = [];
    try {
      seed = SEEDS[name] ? SEEDS[name]() : JSON.parse(fs.readFileSync(seedFile, 'utf8'));
    } catch {}
    transaction(() => {
      for (const item of seed) q.insert.run(item.id, JSON.stringify(item));
      settings.set(`imported:${name}`, new Date().toISOString());
    });
    if (seed.length) console.log(`[base] ${seed.length} ${name} importés depuis ${name}.json`);
  }

  const all = () => q.all.all().map((r) => JSON.parse(r.data));
  const get = (id) => {
    const row = q.get.get(String(id));
    return row ? JSON.parse(row.data) : undefined;
  };

  return {
    all,
    find: (fn) => all().find(fn),
    get,
    insert(item) {
      q.insert.run(item.id, JSON.stringify(item));
      return item;
    },
    update(id, patch) {
      const item = get(id);
      if (!item) return null;
      Object.assign(item, patch, { updatedAt: new Date().toISOString() });
      q.update.run(JSON.stringify(item), id);
      return item;
    },
  };
}

module.exports = {
  db,
  settings,
  transaction,
  products: createCollection('products'),
  orders: createCollection('orders'),
  payments: createCollection('payments'),
  customers: createCollection('customers'),
  agencies: createCollection('agencies'),
  staff: createCollection('staff'), // équipe et fournisseurs (comptes de l'espace d'administration)
  activity: createCollection('activity'), // journal : qui a fait quoi
};
