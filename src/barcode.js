// Code-barres des colis (décision Joseph 18/10/2026) : chaque colis reçoit un code-barres au format CODE 128
// (le plus répandu, lu par toutes les douchettes et par l'appareil photo du téléphone), imprimé sur l'étiquette.
// Il contient le numéro du colis (KM-AAMMJJ-NNN) : le même que le QR code, donc un seul numéro à retenir.
// Dessiné ici en SVG, sans bibliothèque (le code 128 est une norme publique : ISO/IEC 15417).

// Largeurs barre / espace / barre… de chaque symbole (valeurs 0 à 106 ; 104 = début « jeu B », 106 = fin)
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104, STOP = 106;

/** Suite des largeurs de modules (barre, espace, barre…) pour un texte (jeu B : caractères ASCII 32 à 126). */
function code128(text) {
  const s = String(text);
  if (!/^[\x20-\x7e]{1,40}$/.test(s)) throw new Error('Code-barres : texte non pris en charge');
  const values = [START_B, ...[...s].map((c) => c.charCodeAt(0) - 32)];
  const check = values.reduce((sum, v, i) => sum + v * (i || 1), 0) % 103;
  return [...values, check, STOP].map((v) => PATTERNS[v]).join('');
}

/** Image SVG du code-barres (barres noires sur fond blanc, zone de silence de 10 modules de chaque côté). */
function svg(text, { height = 60, module = 2 } = {}) {
  const widths = code128(text).split('').map(Number);
  const quiet = 10;
  let x = quiet, rects = '';
  widths.forEach((w, i) => { if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`; x += w; });
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="${total * module}" height="${height}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Code-barres ${text}"><rect width="${total}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

module.exports = { code128, svg, PATTERNS };
