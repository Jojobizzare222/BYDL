// Volet Mode supprimé (19/10/2026) : rayon absent, ancien produit de Mode caché et refusé à la commande
import { DatabaseSync } from 'node:sqlite';
const BASE = process.env.BASE || 'http://localhost:3999';
let okN = 0, ko = 0; const ok = (c, m) => { if (c) { okN++; console.log('OK   ', m); } else { ko++; console.log('ÉCHEC', m); } };
const cfg = await (await fetch(BASE + '/api/config')).json();
ok(cfg.universes.length === 1 && cfg.universes[0].name === 'Électronique', 'un seul rayon : Électronique');
ok(!JSON.stringify(cfg.universes).includes('Chaussures'), 'plus de catégorie Homme / Femme / Chaussures');
const list = await (await fetch(BASE + '/api/products')).json();
ok(list.length > 0 && list.every((p) => p.universe === 'Électronique'), 'boutique : uniquement de l\'électronique (' + list.length + ' produits)');
// Ancien produit de Mode resté dans la base (comme chez Joseph) : on l'ajoute directement dans la base
const db = new DatabaseSync(process.env.DB_FILE || (process.argv[2].replace(/pw\.txt$/, '') + 't-run.db'));
db.prepare('INSERT INTO products (id, data) VALUES (?, ?)').run('OLD-MODE-1', JSON.stringify({ id: 'OLD-MODE-1', name: 'Chemise ancienne', universe: 'Mode', category: 'Homme', price: 9000, stock: 5, active: true }));
db.close();
await new Promise((r) => setTimeout(r, 300));
const list2 = await (await fetch(BASE + '/api/products?q=chemise')).json();
ok(!list2.some((p) => p.id === 'OLD-MODE-1'), 'ancien produit de Mode : absent de la recherche');
ok((await fetch(BASE + '/api/products/OLD-MODE-1')).status === 404, 'ancien produit de Mode : fiche introuvable');
const sug = await (await fetch(BASE + '/api/products/suggest?q=chemise')).json();
ok(!(sug.products || []).some((p) => p.id === 'OLD-MODE-1'), 'ancien produit de Mode : pas dans les suggestions');
const share = await (await fetch(BASE + '/p/OLD-MODE-1')).text();
ok(!share.includes('Chemise ancienne'), 'ancien produit de Mode : pas d\'aperçu de partage');
console.log(ko ? `${ko} ÉCHEC(S)` : 'TOUT EST OK');
process.exit(ko ? 1 : 0);
