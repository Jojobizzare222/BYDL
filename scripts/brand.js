// Logo Kamwa « La flèche » (choix de Joseph, 17/10/2026) : un trait et un chevron qui forment un K, mot « kamwa » en lettres au trait.
// Une seule couleur : bleu marine sur fond clair, blanc sur fond foncé. Ce script RÉGÉNÈRE tous les fichiers de public/brand/ :
//   node scripts/brand.js
// SVG écrits tels quels ; PNG (icônes d'application, favicon, image de partage) rendus avec sharp.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'brand');
const NAVY = '#10264A', INK = '#111318', WHITE = '#FFFFFF', MANGO = '#FFB300', VIOLET = '#2D1B69';

// Symbole dans un carré 100 × 100
const mark = (color, chevron = color) => `<rect x="16" y="14" width="16" height="72" rx="3" fill="${color}"/><path d="M46 22 L76 50 46 78" fill="none" stroke="${chevron}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`;
// Mot « kamwa » (lettres au trait, 324 × 100 avec la graisse), à placer avec translate(112 9) à côté du symbole
const WORD = 'M10 4V78 M36 26 10 54 M18 46 40 78 M70 52m-20 0a20 20 0 1 0 40 0a20 20 0 1 0-40 0 M90 32V78 M112 78V26 M112 44a18 18 0 0 1 36 0V78 M148 44a18 18 0 0 1 36 0V78 M206 26 218 78 232 40 246 78 258 26 M290 52m-20 0a20 20 0 1 0 40 0a20 20 0 1 0-40 0 M310 32V78';
const word = (color) => `<path d="${WORD}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`;

const svg = (w, h, body, viewBox = `0 0 ${w} ${h}`) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" role="img" aria-label="Kamwa"><title>Kamwa</title>${body}</svg>`;
const lockup = (color) => svg(440, 100, `${mark(color)}<g transform="translate(112 9)">${word(color)}</g>`);
// Icône d'application : carré arrondi + symbole blanc centré (zone sûre « maskable » : le symbole reste dans les 80 % du centre)
const icon = (size, bg, scale, chevron = WHITE) => {
  const m = size * scale, off = (size - m) / 2, r = Math.round(size * 0.22);
  return svg(size, size, `<rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/><g transform="translate(${off} ${off}) scale(${m / 100})">${mark(WHITE, chevron)}</g>`);
};
const share = () => svg(1200, 630, `<rect width="1200" height="630" fill="${NAVY}"/><rect x="0" y="0" width="1200" height="8" fill="${MANGO}"/><g transform="translate(270 215) scale(1.5)">${mark(WHITE)}<g transform="translate(112 9)">${word(WHITE)}</g></g>`);

const files = {
  'logo-kamwa.svg': lockup(NAVY),            // fond clair (documents, thème clair)
  'logo-kamwa-clair.svg': lockup(WHITE),     // fond foncé (en-tête de la boutique, Kamwa Pro)
  'symbole-kamwa.svg': svg(100, 100, mark(WHITE)),        // symbole seul, blanc (rail de Kamwa Pro, bulle « Aide »)
  'symbole-kamwa-fonce.svg': svg(100, 100, mark(NAVY)),   // symbole seul, bleu marine
  'favicon.svg': icon(100, NAVY, 0.74),
  'partage-kamwa.svg': share(),
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
  // Kamwa Pro : même symbole, fond encre, chevron mangue (pour distinguer les deux applications sur le téléphone)
  await png('pro-192.png', icon(100, INK, 0.56, MANGO), 192);
  await png('pro-512.png', icon(100, INK, 0.56, MANGO), 512);
  await png('pro-apple-touch.png', icon(100, INK, 0.56, MANGO), 180);
  await png('partage-kamwa.png', share(), 1200, 630);
  await sharp(Buffer.from(lockup(NAVY)), { density: 300 }).resize(880, 200).png().toFile(path.join(OUT, 'logo-kamwa.png'));
  console.log(`Logo « La flèche » écrit dans ${OUT} (${Object.keys(files).length} SVG + 11 PNG)`);
})();
