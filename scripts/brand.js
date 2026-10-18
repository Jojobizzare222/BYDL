// Logo Zado « Les deux chevrons » (validé par Joseph le 18/10/2026 : piste 4 de design/logo-zado-fleche.html) :
//  - même esprit que l'ancien logo Kamwa « La flèche » (traits arrondis, une couleur + une touche) ;
//  - symbole : le Z coupé sur sa diagonale en deux chevrons qui se répondent (l'un vient vers nous, l'autre repart livrer) ;
//  - mot « zado » en lettres au trait (SANS police : chemins SVG), sans rien dessous ;
//  - couleurs : bleu marine #10264A sur clair / blanc sur foncé ; chevron du bas en rouge Congo #DC241F.
// Ce script RÉGÉNÈRE tous les fichiers de public/brand/ :   node scripts/brand.js
// Après un changement de logo : augmenter ?v= dans les adresses /brand/… (HTML, JS, CSS, manifestes, service worker, notifications).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'brand');
const NAVY = '#10264A', INK = '#111318', WHITE = '#FFFFFF', RED = '#DC241F';
const sw = (c, w) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

// ---- Symbole (carré 100 × 100) ----
const CHEV_TOP = 'M18 22H82L58 43';
const CHEV_BOTTOM = 'M42 57L18 78H82';
const symbol = (c, a = RED) => `<path d="${CHEV_TOP}" ${sw(c, 16)}/><path d="${CHEV_BOTTOM}" ${sw(a, 16)}/>`;

// ---- Mot « zado » au trait (218 × 100 avec la graisse) ----
const WORD = 'M8 30H48L8 78H48 M82 54m-20 0a20 22 0 1 0 40 0a20 22 0 1 0-40 0 M102 34V78 M136 54m-20 0a20 22 0 1 0 40 0a20 22 0 1 0-40 0 M156 4V78 M190 54m-20 0a20 22 0 1 0 40 0a20 22 0 1 0-40 0';
const word = (c) => `<path d="${WORD}" ${sw(c, 13)}/>`;

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Zado"><title>Zado</title>${body}</svg>`;
// Logo complet : symbole + mot (336 × 100)
const lockup = (c, a = RED) => svg(336, 100, `${symbol(c, a)}<g transform="translate(112 9)">${word(c)}</g>`);
// Mot seul (232 × 100)
const wordmark = (c) => svg(232, 100, `<g transform="translate(8 9)">${word(c)}</g>`);
// Empilé : symbole au-dessus du mot (234 × 230) — image de partage
const stacked = (c, a = RED) => `<g transform="translate(67 0)">${symbol(c, a)}</g><g transform="translate(8 128)">${word(c)}</g>`;
// Icône d'application : carré arrondi + symbole blanc (zone sûre « maskable » : le symbole reste dans les 80 % du centre)
const icon = (size, bg, scale, c = WHITE, a = RED) => {
  const m = size * scale, off = (size - m) / 2, r = Math.round(size * 0.22);
  return svg(size, size, `<rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/><g transform="translate(${off} ${off}) scale(${m / 100})">${symbol(c, a)}</g>`);
};
const share = () => svg(1200, 630, `<rect width="1200" height="630" fill="${NAVY}"/><rect x="0" y="0" width="1200" height="8" fill="${RED}"/><g transform="translate(424 142) scale(1.5)">${stacked(WHITE)}</g>`);

const files = {
  'logo-zado.svg': lockup(NAVY),             // fond clair (documents, étiquettes, thème clair)
  'logo-zado-clair.svg': lockup(WHITE),      // fond foncé (en-tête de la boutique, Zado Pro)
  'mot-zado.svg': wordmark(NAVY),            // mot seul
  'mot-zado-clair.svg': wordmark(WHITE),
  'symbole-zado.svg': svg(100, 100, symbol(WHITE)),       // symbole seul, blanc (rail de Zado Pro, bulle « Aide »)
  'symbole-zado-fonce.svg': svg(100, 100, symbol(NAVY)),  // symbole seul, bleu marine
  'favicon.svg': icon(100, NAVY, 0.78),
  'partage-zado.svg': share(),
};
fs.mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), content);

async function png(name, svgText, width, height = width) {
  await sharp(Buffer.from(svgText), { density: 300 }).resize(width, height).png().toFile(path.join(OUT, name));
}
(async () => {
  await png('favicon-32.png', icon(100, NAVY, 0.78), 32);
  await png('icone-192.png', icon(100, NAVY, 0.66), 192);
  await png('icone-512.png', icon(100, NAVY, 0.66), 512);
  await png('app-maskable-192.png', icon(100, NAVY, 0.52), 192);
  await png('app-maskable-512.png', icon(100, NAVY, 0.52), 512);
  await png('apple-touch-icon.png', icon(100, NAVY, 0.66), 180);
  // Zado Pro : même symbole sur fond encre (pour distinguer les deux applications sur le téléphone)
  await png('pro-192.png', icon(100, INK, 0.6), 192);
  await png('pro-512.png', icon(100, INK, 0.6), 512);
  await png('pro-apple-touch.png', icon(100, INK, 0.6), 180);
  await png('partage-zado.png', share(), 1200, 630);
  await sharp(Buffer.from(lockup(NAVY)), { density: 300 }).resize(672, 200).png().toFile(path.join(OUT, 'logo-zado.png'));
  console.log(`Logo Zado « Les deux chevrons » écrit dans ${OUT} (${Object.keys(files).length} SVG + 11 PNG)`);
})();

module.exports = { CHEV_TOP, CHEV_BOTTOM, WORD, RED, NAVY };
