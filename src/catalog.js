// Rayons de la boutique : liste unique utilisée par le site (via /api/config) et par l'espace admin.
// Zado ne vend QUE de l'électronique (décision Joseph 19/10/2026 : volet Mode supprimé).
const UNIVERSES = [
  { name: 'Électronique', categories: ['Téléphones', 'Tablettes', 'Ordinateurs', 'Montres', 'Audio', 'TV & Maison', 'Jeux vidéo & consoles', 'Composants', 'Accessoires'] },
];

const universeOf = (category) => UNIVERSES.find((u) => u.categories.includes(category))?.name || null;
// Un produit dont le rayon n'existe plus (ex. ancien produit de Mode) n'est plus montré ni vendu
const inCatalog = (p) => !!p && universeOf(p.category) !== null;

module.exports = { UNIVERSES, universeOf, inCatalog };
