// Logo Zado = le SYMBOLE de Kamwa « La flèche » + le nom Zado (décision Joseph 19/10/2026 : « le logo de Kamwa reste,
// c'est le plus original, mais le nom c'est maintenant Zado ») :
//  - symbole : un trait vertical + un chevron (le K de Kamwa, gardé tel quel : la flèche, on avance, on livre) ;
//  - mot « zado » en lettres au trait (SANS police : chemins SVG), même alphabet que l'ancien « kamwa » ;
//  - UNE couleur : bleu marine #10264A sur clair, blanc sur foncé ; le chevron passe en mangue sur l'icône de Zado Pro.
// Pistes refusées (ne pas y revenir) : « l'élan » (mot en lettres pleines + flèche dessous), « les deux chevrons ».
// Ce script RÉGÉNÈRE tous les fichiers de public/brand/ :   node scripts/brand.js
// Après un changement de logo : augmenter ?v= dans les adresses /brand/… (HTML, JS, CSS, manifestes, service worker, notifications).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'public', 'brand');
const NAVY = '#10264A', INK = '#111318', WHITE = '#FFFFFF', MANGO = '#FFB300';
const sw = (c, w) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

// ---- Symbole (carré 100 × 100), identique à Kamwa ----
const STEM = { x: 16, y: 14, w: 16, h: 72, r: 3 };
const CHEVRON = 'M46 22 L76 50 46 78';
const symbol = (c, chevron = c) => `<rect x="${STEM.x}" y="${STEM.y}" width="${STEM.w}" height="${STEM.h}" rx="${STEM.r}" fill="${c}"/><path d="${CHEVRON}" ${sw(chevron, 16)}/>`;

// ---- Mot « zado » au trait (218 × 100 avec la graisse) ----
const WORD = 'M8 30H48L8 78H48 M82 54m-20 0a20 22 0 1 0 40 0a20 22 0 1 0-40 0 M102 34V78 M136 54m-20 0a20 22 0 1 0 40 0a20 22 0 1 0-40 0 M156 4V78 M190 54m-20 0a20 22 0 1 0 40 0a20 22 0 1 0-40 0';
const word = (c) => `<path d="${WORD}" ${sw(c, 13)}/>`;

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Zado"><title>Zado</title>${body}</svg>`;
// Logo complet : symbole + mot (336 × 100). Le symbole est posé sur la ligne de base des lettres (comme une lettre
// à hampe : son pied = le pied du « z », son haut entre le haut des lettres et le haut du « d »).
const LOCK_SYMBOL = 'translate(0 7.5)', LOCK_WORD = 'translate(112 9)';
const lockup = (c, chevron = c) => svg(336, 100, `<g transform="${LOCK_SYMBOL}">${symbol(c, chevron)}</g><g transform="${LOCK_WORD}">${word(c)}</g>`);
// Mot seul (232 × 100)
const wordmark = (c) => svg(232, 100, `<g transform="translate(8 9)">${word(c)}</g>`);
// Icône d'application : carré arrondi + symbole blanc centré (zone sûre « maskable » : le symbole reste dans les 80 % du centre)
const icon = (size, bg, scale, chevron = WHITE) => {
  const m = size * scale, off = (size - m) / 2, r = Math.round(size * 0.22);
  return svg(size, size, `<rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/><g transform="translate(${off} ${off}) scale(${m / 100})">${symbol(WHITE, chevron)}</g>`);
};
const share = () => svg(1200, 630, `<rect width="1200" height="630" fill="${NAVY}"/><rect x="0" y="0" width="1200" height="8" fill="${MANGO}"/><g transform="translate(348 240) scale(1.5)"><g transform="${LOCK_SYMBOL}">${symbol(WHITE)}</g><g transform="${LOCK_WORD}">${word(WHITE)}</g></g>`);

const files = {
  'logo-zado.svg': lockup(NAVY),             // fond clair (documents, étiquettes, thème clair)
  'logo-zado-clair.svg': lockup(WHITE),      // fond foncé (en-tête de la boutique, Zado Pro)
  'mot-zado.svg': wordmark(NAVY),            // mot seul
  'mot-zado-clair.svg': wordmark(WHITE),
  'symbole-zado.svg': svg(100, 100, symbol(WHITE)),       // symbole seul, blanc (rail de Zado Pro, bulle « Aide »)
  'symbole-zado-fonce.svg': svg(100, 100, symbol(NAVY)),  // symbole seul, bleu marine
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
  // Zado Pro : même symbole, fond encre, chevron mangue (pour distinguer les deux applications sur le téléphone)
  await png('pro-192.png', icon(100, INK, 0.56, MANGO), 192);
  await png('pro-512.png', icon(100, INK, 0.56, MANGO), 512);
  await png('pro-apple-touch.png', icon(100, INK, 0.56, MANGO), 180);
  await png('partage-zado.png', share(), 1200, 630);
  await sharp(Buffer.from(lockup(NAVY)), { density: 300 }).resize(672, 200).png().toFile(path.join(OUT, 'logo-zado.png'));
  console.log(`Logo Zado (symbole Kamwa « La flèche ») écrit dans ${OUT} (${Object.keys(files).length} SVG + 11 PNG)`);
})();

module.exports = { STEM, CHEVRON, WORD, LOCK_SYMBOL, LOCK_WORD, MANGO, NAVY };
