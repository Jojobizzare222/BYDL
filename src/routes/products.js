const router = require('express').Router();
const { products } = require('../store');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Ce que voient les clients : jamais le prix fournisseur, le fournisseur ni les informations internes.
// Données internes jamais montrées en boutique (dont la page source et le prix en euros d'un produit venu de France)
const publicProduct = ({ supplierPrice, costPrice, supplierId, createdBy, updatedBy, pending, approvedAt, sourceUrl, priceEur, weightKg, ...p }) => p;
// Visible sur la boutique : actif et validé par l'admin
const isPublic = (p) => p.active !== false && !p.pending;

// Filtres : ?universe=Électronique  ?category=Téléphones  ?q=recherche
router.get('/', (req, res) => {
  const { universe, category, q } = req.query;
  const words = norm(q).split(/\s+/).filter(Boolean);
  const list = products.all().filter((p) => {
    if (!isPublic(p)) return false;
    if (universe && p.universe !== universe) return false;
    if (category && p.category !== category) return false;
    const text = norm(`${p.name} ${p.brand || ''} ${p.category} ${p.universe} ${p.description} ${(p.specs || []).map((s) => s.value).join(' ')}`);
    return words.every((w) => text.includes(w));
  });
  // Recherche d'un client : comptée (anonyme) pour l'agent tendances — « ce que les clients cherchent sans trouver »
  if (q && req.query.log !== '0') logSearch(q, list.length);
  res.json(list.map(publicProduct));
});

function logSearch(q, results) {
  const text = norm(q).replace(/[^a-z0-9 -]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (text.length < 3) return;
  const { searches } = require('../store');
  const day = new Date().toISOString().slice(0, 10);
  const id = `${day}|${text}`;
  const cur = searches.get(id);
  if (cur) searches.update(id, { n: cur.n + 1, results });
  else searches.insert({ id, day, q: text, n: 1, results });
}

router.get('/:id', (req, res) => {
  const product = products.get(req.params.id);
  if (!product || product.pending) return res.status(404).json({ error: 'Produit introuvable' });
  res.json(publicProduct(product));
});

module.exports = router;
