const router = require('express').Router();
const { products } = require('../store');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Filtres : ?universe=Électronique  ?category=Téléphones  ?q=recherche
router.get('/', (req, res) => {
  const { universe, category, q } = req.query;
  const words = norm(q).split(/\s+/).filter(Boolean);
  const list = products.all().filter((p) => {
    if (p.active === false) return false;
    if (universe && p.universe !== universe) return false;
    if (category && p.category !== category) return false;
    const text = norm(`${p.name} ${p.category} ${p.universe} ${p.description}`);
    return words.every((w) => text.includes(w));
  });
  res.json(list);
});

router.get('/:id', (req, res) => {
  const product = products.get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  res.json(product);
});

module.exports = router;
