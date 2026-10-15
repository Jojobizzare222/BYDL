// Rayons de la boutique : liste unique utilisée par le site (via /api/config) et par l'espace admin.
const UNIVERSES = [
  { name: 'Électronique', categories: ['Téléphones', 'Tablettes', 'Ordinateurs', 'Montres', 'Audio', 'TV & Maison', 'Composants', 'Accessoires'] },
  { name: 'Mode', categories: ['Homme', 'Femme', 'Chaussures'] },
];

const universeOf = (category) => UNIVERSES.find((u) => u.categories.includes(category))?.name || null;

module.exports = { UNIVERSES, universeOf };
