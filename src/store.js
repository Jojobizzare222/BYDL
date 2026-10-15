// Stockage simple en fichiers JSON (suffisant pour démarrer).
// À remplacer par une vraie base de données (PostgreSQL, MySQL…) avant la mise en production.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function createCollection(name, { seed = [] } = {}) {
  const file = path.join(DATA_DIR, `${name}.json`);
  let items;
  try {
    items = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    items = seed;
  }

  const save = () => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
    fs.renameSync(tmp, file); // écriture atomique
  };

  return {
    all: () => items,
    find: (fn) => items.find(fn),
    get: (id) => items.find((i) => i.id === id),
    insert(item) {
      items.push(item);
      save();
      return item;
    },
    update(id, patch) {
      const item = items.find((i) => i.id === id);
      if (!item) return null;
      Object.assign(item, patch, { updatedAt: new Date().toISOString() });
      save();
      return item;
    },
  };
}

module.exports = {
  products: createCollection('products'),
  orders: createCollection('orders'),
  payments: createCollection('payments'),
};
