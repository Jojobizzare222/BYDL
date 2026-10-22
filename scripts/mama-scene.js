// Génère la scène « l'étal de Mama Zando » du bas de la boutique (SVG statique, aucune bibliothèque)
// à partir du système de personnage public/js/mama-zando.js, et l'insère dans public/index.html
// entre <!-- MAMA-SCENE --> et <!-- /MAMA-SCENE -->. Lancer : node scripts/mama-scene.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/mama-zando.js'), 'utf8'), ctx);
const M = ctx.window.MamaZando, C = M.C, P = M.P;

// Auvent rayé mangue / blanc, bord festonné
const stripes = [];
for (let x = 30, i = 0; x < 490; x += 46, i++) stripes.push(`<rect x="${x}" y="10" width="46" height="44" fill="${i % 2 ? C.white : C.mango}"/>`);
// Bord festonné tracé de droite à gauche
let edge = 'M30 14h460v26'; for (let x = 490; x > 30; x -= 46) edge += 'a23 14 0 0 1-46 0'; edge += 'z';
const awningSvg = `<clipPath id="mzAwc"><path d="${edge}"/></clipPath><g clip-path="url(#mzAwc)">${stripes.join('')}</g><path d="${edge}" fill="none" stroke="${C.navy}" stroke-width="5" stroke-linejoin="round"/><path d="M24 14h472" stroke="${C.navy}" stroke-width="8" stroke-linecap="round"/>`;

// Comptoir : plateau + façade marine avec la bande de chevrons Zado
const chev = []; for (let x = 70; x <= 450; x += 22) chev.push(`M${x} 290l7 6-7 6`);
const counter = `<rect x="44" y="262" width="432" height="60" rx="6" fill="${C.navy2}" stroke="${C.navy}" stroke-width="5"/>
  <rect x="46" y="284" width="428" height="24" fill="${C.mango}"/><path d="${chev.join('')}" fill="none" stroke="${C.navy}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="34" y="252" width="452" height="14" rx="7" fill="${C.white}" stroke="${C.navy}" stroke-width="5"/>`;

const posts = `<path d="M54 20v236M466 20v236" stroke="${C.navy}" stroke-width="7" stroke-linecap="round"/>`;
const stack = `${P.parcel(104, 230, 1)}${P.parcel(108, 190, .8)}${P.parcel(408, 232, .9)}`;

// Deux poses enchaînées : elle prépare le colis, puis elle vous le tend
const fig = (o) => `<g transform="translate(140 34)">${M.mama({ shadow: false, ...o })}</g>`;
const poseA = fig({ L: 'hold', R: 'hold', face: 'focus', over: `<g class="tape">${P.parcel(120, 196, 1.15)}</g>` });
const poseB = fig({ L: 'down', R: 'give', face: 'joy', over: P.parcel(190, 184, 1) });
const ok = `<g class="ok">${P.check(372, 178, 14)}</g>`;

let svg = `<svg class="mz-scene" viewBox="0 0 520 330" role="img" aria-label="Mama Zando prépare un colis derrière son étal et vous le tend">
  ${posts}${awningSvg}
  <g class="pa">${poseA}</g><g class="pb">${poseB}</g>
  ${counter}${stack}${ok}
</svg>`;
// Préfixe des classes et des identifiants pour ne rien mélanger avec la boutique
const prefix = (out, idp) => out.replace(/class="([^"]*)"/g, (m, c) => `class="${c.split(/\s+/).filter(Boolean).map((k) => (k.startsWith('mz-') ? k : 'mz-' + k)).join(' ')}"`)
  .replace(/id="dc(\d+)"/g, `id="${idp}$1"`).replace(/url\(#dc(\d+)\)/g, `url(#${idp}$1)`)
  .replace(/\n\s*/g, ' ');
svg = prefix(svg, 'mzDc');

// Écran d'ouverture : après le logo, Mama Zando apparaît dans un disque mangue, salue et dit « Mbote ! »
const splash = `<div class="sp-mama"><span class="sp-disc"><svg viewBox="44 18 152 152" aria-hidden="true">${prefix(M.mama({ R: 'wave', armR: 'wave-r', face: 'smile', shadow: false }), 'mzSp')}</svg></span><span class="sp-bub">Mbote !</span></div>
    <style>
      .sp-mama { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
      .sp-disc { width: 84px; height: 84px; border-radius: 50%; background: #FFF6E0; overflow: hidden; display: block; box-shadow: 0 0 0 4px #FFB300; transform: scale(0); animation: sp-pop .5s cubic-bezier(.3,1.6,.5,1) 1.15s forwards; }
      .sp-disc svg { width: 100%; height: 100%; display: block; }
      .sp-mama .mz-wave-r { transform-box: view-box; transform-origin: 141px 166px; animation: sp-wave .45s ease-in-out 1.5s 4 alternate; }
      .sp-bub { font: 800 1rem/1 "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #10264A; background: #fff; padding: 9px 13px; border-radius: 14px 14px 14px 4px; opacity: 0; transform: translateX(-8px) scale(.8); animation: sp-word .4s ease-out 1.55s forwards; }
      @keyframes sp-pop { to { transform: scale(1); } }
      @keyframes sp-wave { from { transform: rotate(6deg); } to { transform: rotate(-18deg); } }
    </style>`;

const file = path.join(__dirname, '../public/index.html');
let html = fs.readFileSync(file, 'utf8');
for (const [name, content] of [['MAMA-SCENE', svg], ['MAMA-SPLASH', splash]]) {
  const re = new RegExp(`(<!-- ${name} -->)[\\s\\S]*?(<!-- \\/${name} -->)`);
  if (!re.test(html)) throw new Error(`Repères ${name} absents de public/index.html`);
  html = html.replace(re, (m, a, b) => `${a}${content}${b}`);
}
fs.writeFileSync(file, html);
console.log('Mama Zando insérée : étal', Math.round(svg.length / 1024), 'Ko, écran d\'ouverture', Math.round(splash.length / 1024), 'Ko');
