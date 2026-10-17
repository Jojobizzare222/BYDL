const router = require('express').Router();
const { products } = require('../store');

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Ce que voient les clients : jamais le prix fournisseur, le fournisseur ni les informations internes.
// Données internes jamais montrées en boutique (anciens champs de l'achat en Europe compris)
const publicProduct = ({ supplierPrice, costPrice, supplierId, createdBy, updatedBy, pending, approvedAt, sourceUrl, priceEur, weightKg, origin, lastPurchasePrice, ...p }) => p;
// Visible sur la boutique : actif et validé par l'admin
const isPublic = (p) => p.active !== false && !p.pending;

const { search } = require('../search');
// Filtres : ?universe=Électronique  ?category=Téléphones  ?q=recherche (tolérante : fautes, pluriels, synonymes — src/search.js)
// Avec ?q=, l'en-tête X-Search-Partial / X-Search-Suggest dit si le résultat est approché et propose une correction.
router.get('/', (req, res) => {
  const { universe, category, q } = req.query;
  let list = products.all().filter((p) => isPublic(p) && (!universe || p.universe === universe) && (!category || p.category === category));
  if (q && String(q).trim()) {
    const r = search(list, String(q).slice(0, 120));
    list = r.list;
    if (r.partial) res.set('X-Search-Partial', '1');
    if (r.didYouMean) res.set('X-Search-Suggest', encodeURIComponent(r.didYouMean));
  }
  res.json(list.map(publicProduct));
});

// Suggestions pendant la frappe : quelques produits + rayons correspondants
router.get('/suggest', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return res.json({ products: [], categories: [], didYouMean: null });
  const pub = products.all().filter(isPublic);
  const r = search(pub, q);
  const cats = new Map();
  for (const p of r.list) { const k = `${p.universe}|${p.category}`; cats.set(k, (cats.get(k) || 0) + 1); }
  res.set('Cache-Control', 'no-store');
  res.json({
    products: r.list.slice(0, 6).map((p) => ({ id: p.id, name: p.name, price: p.price, image: p.image || null, category: p.category })),
    categories: [...cats.entries()].sort((a, b) => b[1] - a[1]).filter(([, n], i, all) => i === 0 || n >= Math.max(2, all[0][1] / 10)).slice(0, 3).map(([k, n]) => { const [universe, category] = k.split('|'); return { universe, category, count: n }; }),
    didYouMean: r.didYouMean, partial: r.partial,
  });
});


router.get('/:id', (req, res) => {
  const product = products.get(req.params.id);
  if (!product || product.pending) return res.status(404).json({ error: 'Produit introuvable' });
  res.json(publicProduct(product));
});

module.exports = router;
