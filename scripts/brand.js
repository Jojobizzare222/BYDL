// Logo Zado (renommage décidé par Joseph le 18/10/2026 : Kamwa → Zado, de « zando », le marché en lingala).
// Lettres « zado » dessinées au trait (sans police) ; une couleur principale (bleu marine sur clair, blanc sur foncé)
// + une touche mangue sur le symbole. 6 pistes de symbole proposées dans design/logo-zado-pistes.html.
// CHOIX : 'mot' = logo provisoire (le mot seul, un « z » en icône) en attendant le choix de Joseph ;
//         sinon 'fleche' | 'etal' | 'point' | 'colis' | 'mono' | 'vitesse'.
// Ce script RÉGÉNÈRE tous les fichiers de public/brand/ :   node scripts/brand.js
// Après un changement de logo : augmenter ?v= dans les adresses /brand/… (HTML, JS, CSS, manifestes, service worker).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CHOIX = process.env.LOGO || 'mot';

const OUT = path.join(__dirname, '..', 'public', 'brand');
const NAVY = '#10264A', INK = '#111318', WHITE = '#FFFFFF', MANGO = '#FFB300', CORAL = '#FF5A3C';

// Mot « zado » (x-height 30 → 78, hampe du d depuis 4) ; 218 × 100 avec la graisse, placé avec translate(118 9)
const WORD = 'M8 30H48L8 78H48 M82 54m-20 0a20 22 0 1 0 40 0a20 22 0 1 0-40 0 M102 34V78 M136 54m-20 0a20 22 0 1 0 40 0a20 22 0 1 0-40 0 M156 4V78 M190 54m-20 0a20 22 0 1 0 40 0a20 22 0 1 0-40 0';
const WORD_NO_O = WORD.slice(0, WORD.lastIndexOf(' M190'));
const sw = (c, w = 14) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

// Symboles (carré 100 × 100) : c = couleur principale, a = touche de couleur
const MARKS = {
  mot: (c, a) => `<path d="M24 26H76L24 76H76" ${sw(c, 15)}/><circle cx="80" cy="22" r="8" fill="${a}"/>`,
  fleche: (c, a) => `<path d="M18 24H74L22 76H64" ${sw(c)}/><path d="M60 62L76 76 60 90" ${sw(a)}/>`,
  etal: (c, a) => `<path d="M10 34L22 14H78L90 34Z" fill="${c}"/><path d="M10 34H90V40a10 10 0 0 1-20 0 10 10 0 0 1-20 0 10 10 0 0 1-20 0 10 10 0 0 1-20 0Z" fill="${a}"/><rect x="20" y="56" width="60" height="30" rx="4" ${sw(c, 10)}/>`,
  point: (c, a) => `<path d="M50 94C50 94 18 60 18 40a32 32 0 0 1 64 0C82 60 50 94 50 94Z" fill="${a}"/><path d="M36 28H64L36 54H64" ${sw(WHITE, 9)}/>`,
  colis: (c, a) => `<rect x="12" y="20" width="76" height="66" rx="8" ${sw(c, 10)}/><path d="M12 40H88" ${sw(c, 10)}/><path d="M36 52H64L36 74H64" ${sw(a, 9)}/>`,
  mono: (c) => `<path d="M20 26H54a24 24 0 0 1 0 48H20L54 26" ${sw(c)}/>`,
  vitesse: (c, a) => `<path d="M6 38H20M4 52H18M6 66H20" ${sw(a, 9)}/><path d="M36 26H86L40 76H90" ${sw(c)}/>`,
};
// Piste « point » : le « o » du mot devient un repère de carte
const O_PIN = (a) => `<path d="M190 82C190 82 168 62 168 50a22 22 0 0 1 44 0C212 62 190 82 190 82Z" fill="${a}"/><circle cx="190" cy="50" r="8" fill="#fff"/>`;
const mark = MARKS[CHOIX] || MARKS.mot;
const word = (c, a) => CHOIX === 'point'
  ? `<path d="${WORD_NO_O}" ${sw(c, 13)}/>${O_PIN(a)}`
  : `<path d="${WORD}" ${sw(c, 13)}/>`;

const svg = (w, h, body, viewBox = `0 0 ${w} ${h}`) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" role="img" aria-label="Zado"><title>Zado</title>${body}</svg>`;
// Logo provisoire : le mot seul ; avec un symbole : symbole + mot
const lockup = (c, a = MANGO) => (CHOIX === 'mot'
  ? svg(240, 100, `<g transform="translate(8 9)">${word(c, a)}</g>`)
  : svg(360, 100, `${mark(c, a)}<g transform="translate(118 9)">${word(c, a)}</g>`));
// Icône d'application : carré arrondi + symbole blanc centré (zone sûre « maskable » : le symbole reste dans les 80 % du centre)
const icon = (size, bg, scale, accent = MANGO) => {
  const m = size * scale, off = (size - m) / 2, r = Math.round(size * 0.22);
  return svg(size, size, `<rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/><g transform="translate(${off} ${off}) scale(${m / 100})">${mark(WHITE, accent)}</g>`);
};
const share = () => svg(1200, 630, `<rect width="1200" height="630" fill="${NAVY}"/><rect x="0" y="0" width="1200" height="8" fill="${MANGO}"/><g transform="translate(${CHOIX === 'mot' ? 420 : 330} 215) scale(1.5)">${CHOIX === 'mot' ? `<g transform="translate(8 9)">${word(WHITE, MANGO)}</g>` : `${mark(WHITE, MANGO)}<g transform="translate(118 9)">${word(WHITE, MANGO)}</g>`}</g>`);

const files = {
  'logo-zado.svg': lockup(NAVY, CHOIX === 'point' || CHOIX === 'etal' ? CORAL : MANGO), // fond clair (documents, thème clair)
  'logo-zado-clair.svg': lockup(WHITE),       // fond foncé (en-tête de la boutique, Zado Pro)
  'symbole-zado.svg': svg(100, 100, mark(WHITE, MANGO)),       // symbole seul, blanc (rail de Zado Pro, bulle « Aide »)
  'symbole-zado-fonce.svg': svg(100, 100, mark(NAVY, MANGO)),  // symbole seul, bleu marine
  'favicon.svg': icon(100, NAVY, 0.74),
  'partage-zado.svg': share(),
};
fs.mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), content);

async function png(name, svgText, width, height = width) {
  await sharp(Buffer.from(svgText), { density: 300 }).resize(width, height).png().toFile(path.join(OUT, name));
}
(async () => {
  await png('favicon-32.png', icon(100, NAVY, 0.74), 32);
  await png('icone-192.png', icon(100, NAVY, 0.64), 192);
  await png('icone-512.png', icon(100, NAVY, 0.64), 512);
  await png('app-maskable-192.png', icon(100, NAVY, 0.5), 192);
  await png('app-maskable-512.png', icon(100, NAVY, 0.5), 512);
  await png('apple-touch-icon.png', icon(100, NAVY, 0.64), 180);
  // Zado Pro : même symbole sur fond encre (pour distinguer les deux applications sur le téléphone)
  await png('pro-192.png', icon(100, INK, 0.56), 192);
  await png('pro-512.png', icon(100, INK, 0.56), 512);
  await png('pro-apple-touch.png', icon(100, INK, 0.56), 180);
  await png('partage-zado.png', share(), 1200, 630);
  const w = CHOIX === 'mot' ? 480 : 720;
  await sharp(Buffer.from(lockup(NAVY)), { density: 300 }).resize(w, 200).png().toFile(path.join(OUT, 'logo-zado.png'));
  console.log(`Logo Zado (« ${CHOIX} ») écrit dans ${OUT} (${Object.keys(files).length} SVG + 11 PNG)`);
})();
