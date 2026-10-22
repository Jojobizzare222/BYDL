// Mama Zando dans la boutique (décision Joseph 22/10/2026 : « intègre toutes les animations aux emplacements proposés »).
// Les scènes sont assemblées à partir du système de personnage (public/js/mama-zando.js) : petits dessins SVG animés
// en CSS (classes mz-…, style.css), aucune vidéo. Animations coupées si « réduire les animations » ou économie de données.
// Usage : kamwaMama.scene('load', { size: 'sm' }) → HTML ; kamwaMama.head('smile') → avatar rond ; kamwaMama.dots() → indicateur compact.
(() => {
  const M = window.MamaZando;
  if (!M) return;
  const { C, P } = M;
  let uid = 0;
  // Classes et identifiants préfixés : rien ne se mélange avec le reste de la boutique
  const scope = (svg) => {
    const n = ++uid;
    return svg
      .replace(/class="([^"]*)"/g, (m, c) => `class="${c.split(/\s+/).filter(Boolean).map((k) => (k.startsWith('mz-') ? k : 'mz-' + k)).join(' ')}"`)
      .replace(/id="dc(\d+)"/g, `id="mzr${n}-$1"`).replace(/url\(#dc(\d+)\)/g, `url(#mzr${n}-$1)`);
  };

  const conf = () => [[-70, -90, 200, C.mango], [60, -100, -160, C.coral], [-40, -120, 120, C.navy], [80, -60, 240, C.mango], [-90, -40, -200, C.coral], [30, -130, 300, C.ok], [-10, -150, 90, C.mango], [100, -110, -120, C.navy]]
    .map(([dx, dy, r, c], i) => `<rect class="conf" x="${116 + (i % 3) * 3}" y="96" width="7" height="${i % 2 ? 7 : 11}" rx="2" fill="${c}" style="--dx:${dx}px;--dy:${dy}px;--r:${r}deg;animation-delay:${(i % 4) * 0.03}s"/>`).join('');
  const txt = (x, y, s, size, color) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="800" font-family="Plus Jakarta Sans, sans-serif" fill="${color}">${s}</text>`;

  // Chaque scène : [contenu SVG, viewBox facultatif]
  const SCENES = {
    hello: () => M.mama({ R: 'wave', armR: 'wave-r', face: 'talk', over: `<g class="bub">${P.bubble(62, 62, txt(0, 5, 'Mbote !', 13, C.navy), 66)}</g>` }),
    wave: () => M.mama({ R: 'wave', armR: 'wave-r', face: 'smile' }),
    load: () => [`<g class="mama">${M.head('smile')}<g class="orbit"><g class="par">${P.parcel(120, 32, 0.5)}</g></g><circle class="dot" cx="106" cy="174" r="5" fill="${C.navy}"/><circle class="dot" cx="120" cy="174" r="5" fill="${C.mango}"/><circle class="dot" cx="134" cy="174" r="5" fill="${C.coral}"/></g>`, '40 10 160 190'],
    cart: () => M.mama({ L: 'hold', R: 'hold', face: 'joy', over: `<g class="drop">${P.parcel(120, 200, 1.2)}</g>`, behind: `<g class="plus"><circle cx="190" cy="70" r="18" fill="${C.coral}"/>${txt(190, 76, '+1', 16, '#fff')}</g>` }),
    wait: () => M.mama({ R: 'phone', face: 'focus', over: `<circle class="ring" cx="166" cy="120" r="20"/><circle class="ring r2" cx="166" cy="120" r="20"/><g class="buzz">${P.phone(166, 120)}</g>` }),
    yes: () => M.mama({ L: 'up', R: 'up', face: 'joy', behind: conf(), over: `<g class="ok">${P.check(190, 60, 16)}</g>` }),
    no: () => M.mama({ L: 'shrug', R: 'shrug', face: 'sorry', behind: `<g class="q"><circle cx="186" cy="58" r="17" fill="#fff" stroke="${C.navy}" stroke-width="3.5"/>${txt(186, 65, '?', 20, C.coral)}</g>` }),
    empty: () => M.mama({ L: 'hold', R: 'hold', face: 'surprise', over: `<g class="swing">${P.basket(120, 202)}</g>` }),
    id: () => M.mama({ L: 'hold', R: 'magnify', face: 'focus', over: `${P.card(112, 196)}<g class="scan">${P.magnifier(160, 182)}</g>` }),
    ver: () => M.mama({ L: 'up', R: 'hold', face: 'joy', over: `${P.card(130, 196)}<g class="stamp"><circle cx="146" cy="186" r="15" fill="#fff" stroke="${C.ok}" stroke-width="3.5"/><path d="M139 186l5 5 9-9" fill="none" stroke="${C.ok}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>` }),
    deliver: () => `<g class="walk">${M.mama({ L: 'down', R: 'give', face: 'proud', over: P.parcel(184, 186, 1) })}</g><g class="ok">${P.check(206, 150, 13)}</g>`,
    chat: () => M.mama({ R: 'hip', face: 'talk', over: P.bubble(60, 60, `<circle class="tdot" cx="-12" cy="0" r="4" fill="${C.navy}"/><circle class="tdot" cx="0" cy="0" r="4" fill="${C.navy}"/><circle class="tdot" cx="12" cy="0" r="4" fill="${C.navy}"/>`, 52) }),
    off: () => M.mama({ R: 'phone', face: 'sorry', over: P.phone(166, 120, '', `<rect class="bar" x="-6" y="2" width="3" height="5" fill="#fff"/><rect class="bar b2" x="-1.5" y="-2" width="3" height="9" fill="#fff"/><rect class="bar b3" x="3" y="-6" width="3" height="13" fill="#fff"/><path d="M-6 -12h12" stroke="${C.coral}" stroke-width="2.4" stroke-linecap="round"/>`) }),
    maint: () => M.mama({ L: 'hold', R: 'hold', face: 'wink', over: `<g class="sign"><path d="M98 168v-6M142 168v-6" stroke="${C.navy}" stroke-width="4"/><rect x="72" y="166" width="96" height="46" rx="8" fill="#fff" stroke="${C.navy}" stroke-width="4.5"/>${txt(120, 186, 'On revient', 12, C.navy)}${txt(120, 202, 'très vite !', 12, C.coral)}</g>` }),
  };

  /** Scène animée. size : xs (48 px) | sm (84 px) | md (130 px) | lg (180 px). */
  function scene(name, { size = 'md', label = '' } = {}) {
    const out = (SCENES[name] || SCENES.wave)();
    const [inner, vb] = Array.isArray(out) ? out : [out, '0 -8 240 288'];
    return `<span class="mz mz-${size} mz-s-${name}"${label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"'}><svg viewBox="${vb}" focusable="false">${scope(inner)}</svg></span>`;
  }
  /** Avatar rond (tête seule) : assistant de la messagerie, notifications, petits encarts. */
  function head(face = 'smile', { size = 'xs', cls = '' } = {}) {
    return `<span class="mz-avatar mz-${size} ${cls}" aria-hidden="true"><svg viewBox="72 22 96 122" focusable="false">${scope(`<g class="mama">${M.head(face, { knot: size !== 'xs' })}</g>`)}</svg></span>`;
  }
  /** Indicateur compact (boutons « Payer », « Envoyer ») : les chevrons du nœud avancent. */
  const dots = () => `<svg class="mz-dots" viewBox="0 0 40 20" aria-hidden="true">${[4, 16, 28].map((x) => `<path d="M${x} 4l6 6-6 6"/>`).join('')}</svg>`;

  window.kamwaMama = { scene, head, dots };
})();
