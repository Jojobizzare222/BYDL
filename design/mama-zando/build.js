// Assemble la planche autonome : mama.js et la police sont recopiés dans le fichier (aperçu sans serveur).
const fs = require('fs'), path = require('path');
const font = fs.readFileSync(path.join(__dirname, '../../public/fonts/plus-jakarta-sans-latin-wght-normal.woff2')).toString('base64');
const css = `@font-face { font-family: "Plus Jakarta Sans"; src: url("data:font/woff2;base64,${font}") format("woff2"); font-weight: 200 800; font-display: swap; }`;
const out = fs.readFileSync(path.join(__dirname, 'planche.src.html'), 'utf8')
  .replace('/*FONT*/', () => css).replace('/*MAMA*/', () => fs.readFileSync(path.join(__dirname, 'mama.js'), 'utf8'));
fs.writeFileSync(path.join(__dirname, '../mama-zando.html'), out);
console.log('design/mama-zando.html', Math.round(out.length / 1024), 'Ko');
