const router = require('express').Router();
const { products } = require('../store');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Ce que voient les clients : jamais le prix fournisseur, le fournisseur ni les informations internes.
// Données internes jamais montrées en boutique (anciens champs de l'achat en Europe compris)
const publicProduct = ({ supplierPrice, costPrice, supplierId, createdBy, updatedBy, pending, approvedAt, sourceUrl, priceEur, weightKg, origin, lastPurchasePrice, ...p }) => p;
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
  res.json(list.map(publicProduct));
});


router.get('/:id', (req, res) => {
  const product = products.get(req.params.id);
  if (!product || product.pending) return res.status(404).json({ error: 'Produit introuvable' });
  res.json(publicProduct(product));
});

module.exports = router;
