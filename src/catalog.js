// Rayons de la boutique : liste unique utilisée par le site (via /api/config) et par l'espace admin.
// Zado vendait seulement de l'électronique (19/10/2026) ; la mode, la maison et le sport reviennent le 15/11/2026 (demande Joseph).
// 10/11/2026 (sélection cadeaux de Noël) : + Photo & vidéo, Jouets high-tech, Beauté & bien-être (petit électroménager de soin).
// 15/11/2026 (demande Joseph : « rajoute PlayStation, jeux vidéo, Xbox, table, armoire, chevet, chaussures, écran, lunettes,
// whey, habits homme et femme ») : + Écrans ; univers Mode (retour de la mode, à la demande de Joseph), Maison (petits
// meubles et déco de moins de 15 kg seulement : transport par avion, décision Joseph 15/11/2026) et Sport.
const UNIVERSES = [
  { name: 'Électronique', categories: ['Téléphones', 'Tablettes', 'Ordinateurs', 'Écrans', 'Montres', 'Audio', 'TV & Maison', 'Jeux vidéo & consoles', 'Composants', 'Accessoires', 'Photo & vidéo', 'Jouets high-tech', 'Beauté & bien-être'] },
  { name: 'Mode', categories: ['Mode homme', 'Mode femme', 'Chaussures', 'Lunettes'] },
  { name: 'Maison', categories: ['Maison & déco'] },
  { name: 'Sport', categories: ['Sport & nutrition'] },
];

const universeOf = (category) => UNIVERSES.find((u) => u.categories.includes(category))?.name || null;
// Un produit dont le rayon n'existe plus (ex. ancien produit de Mode) n'est plus montré ni vendu
const inCatalog = (p) => !!p && universeOf(p.category) !== null;

module.exports = { UNIVERSES, universeOf, inCatalog };
