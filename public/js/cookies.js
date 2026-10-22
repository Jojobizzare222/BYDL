// Zado — consentement aux cookies.
// Aujourd'hui, Zado n'utilise QUE des traceurs indispensables (connexion au compte, panier, commande en cours) :
// ils sont exemptés de consentement. Les catégories « mesure d'audience » et « publicité » sont prêtes pour plus tard :
// tout futur outil (statistiques, publicité…) doit être chargé UNIQUEMENT si kamwaConsent.has('audience' | 'marketing').
// Le choix est gardé 6 mois dans le navigateur (clé « kamwa-consent »), puis redemandé.
(() => {
  const KEY = 'kamwa-consent';
  const VERSION = 1;
  const MAX_AGE_MS = 182 * 24 * 3600 * 1000; // environ 6 mois
  const OPTIONAL = [
    { key: 'audience', title: "Mesure d'audience", text: "Compter les visites et les pages vues, de façon anonyme, pour améliorer le site. Aucun outil de ce type n'est utilisé pour le moment." },
    { key: 'marketing', title: 'Publicité et réseaux sociaux', text: "Vous montrer des offres Zado sur d'autres sites ou réseaux sociaux. Aucun outil de ce type n'est utilisé pour le moment." },
  ];
  // Ce que le site enregistre réellement dans votre navigateur (tous indispensables)
  const ESSENTIAL = [
    ['kamwa_client', 'Cookie', 'Garder votre compte client connecté', '30 jours'],
    ['kamwa-cart', 'Stockage local', 'Mémoriser votre panier', "Jusqu'à la commande"],
    ['kamwa-checkout', 'Stockage local', 'Reprendre une commande en cours sans payer deux fois', "Jusqu'au paiement"],
    ['kamwa-orders', 'Stockage local', 'Retrouver les commandes passées depuis cet appareil', "Jusqu'à effacement"],
    ['kamwa-consent', 'Stockage local', 'Mémoriser vos choix sur les cookies', '6 mois'],
  ];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function read() {
    try {
      const c = JSON.parse(localStorage.getItem(KEY));
      if (!c || c.v !== VERSION || Date.now() - Date.parse(c.date) > MAX_AGE_MS) return null;
      return c;
    } catch { return null; }
  }
  function save(choices) {
    const c = { v: VERSION, date: new Date().toISOString(), choices: Object.fromEntries(OPTIONAL.map((o) => [o.key, Boolean(choices[o.key])])) };
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
    hideBanner();
    window.dispatchEvent(new CustomEvent('kamwa-consent', { detail: c.choices }));
    return c;
  }
  const all = (value) => Object.fromEntries(OPTIONAL.map((o) => [o.key, value]));

  // ---------- Bandeau ----------
  const banner = () => document.getElementById('cookieBanner');
  function hideBanner() { const b = banner(); if (b) { b.hidden = true; b.innerHTML = ''; } }
  function showBanner() {
    const b = banner();
    if (!b || location.hash.startsWith('#/cookies')) return;
    b.className = 'cookie-banner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Vos choix en matière de cookies');
    b.innerHTML = `
      <button type="button" class="skip" data-c="none">Continuer sans accepter</button>
      <h2><svg class="ico" aria-hidden="true"><use href="/icons.svg?v=16#cookie"></use></svg>Vos choix en matière de cookies</h2>
      <p>Zado utilise des cookies indispensables au fonctionnement du site (panier, connexion à votre compte, commande en cours).
      Avec votre accord, nous pourrons aussi en utiliser pour mesurer l'audience et améliorer le site. Vous pouvez changer d'avis à tout moment
      via « Gérer les cookies » en bas de page. <a href="#/legal/confidentialite">Politique de confidentialité</a></p>
      <div class="cookie-actions">
        <button type="button" class="btn" data-c="all">Tout accepter</button>
        <button type="button" class="btn ghost" data-c="settings">Paramétrer</button>
      </div>`;
    b.hidden = false;
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('#cookieBanner [data-c]');
    if (!t) return;
    if (t.dataset.c === 'all') save(all(true));
    if (t.dataset.c === 'none') save(all(false));
    if (t.dataset.c === 'settings') { hideBanner(); location.hash = '#/cookies'; }
  });

  // ---------- Page « Gérer les cookies » ----------
  function renderSettings(el) {
    const current = read()?.choices || all(false);
    el.innerHTML = `
      <article class="legal cookie-settings">
        <p class="legal-kicker">Informations légales</p>
        <h1>Gérer les cookies</h1>
        <p class="legal-date">${read() ? `Votre choix actuel date du ${new Date(read().date).toLocaleDateString('fr-FR', { dateStyle: 'long' })}.` : "Vous n'avez pas encore fait de choix."}</p>
        <p>Un cookie (ou un « traceur ») est une petite information enregistrée par le site dans votre navigateur. Certains sont
        indispensables : sans eux, le panier ou la connexion à votre compte ne fonctionneraient pas. Les autres ne sont utilisés qu'avec votre accord.</p>
        <div class="opt">
          <div><b>Indispensables</b><p>Toujours actifs. Ils servent uniquement au fonctionnement du site et ne permettent pas de vous suivre sur d'autres sites.</p></div>
          <label class="switch" aria-label="Indispensables (toujours actifs)"><input type="checkbox" checked disabled><span></span></label>
        </div>
        <table>
          <thead><tr><th>Nom</th><th>Type</th><th>À quoi il sert</th><th>Durée</th></tr></thead>
          <tbody>${ESSENTIAL.map((r) => `<tr>${r.map((x, i) => `<td>${i === 0 ? `<code>${esc(x)}</code>` : esc(x)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
        ${OPTIONAL.map((o) => `
        <div class="opt">
          <div><b>${esc(o.title)}</b><p>${esc(o.text)}</p></div>
          <label class="switch" aria-label="${esc(o.title)}"><input type="checkbox" data-opt="${o.key}" ${current[o.key] ? 'checked' : ''}><span></span></label>
        </div>`).join('')}
        <div class="cookie-actions">
          <button type="button" class="btn" id="cookieSave">Enregistrer mes choix</button>
          <button type="button" class="btn ghost" id="cookieAll">Tout accepter</button>
          <button type="button" class="btn ghost" id="cookieNone">Tout refuser</button>
        </div>
        <p class="hint" id="cookieDone" role="status"></p>
        <p>Pour en savoir plus sur vos données, lisez notre <a href="#/legal/confidentialite">politique de confidentialité</a>.</p>
      </article>`;
    const done = (c) => {
      el.querySelectorAll('[data-opt]').forEach((i) => { i.checked = c.choices[i.dataset.opt]; });
      el.querySelector('#cookieDone').textContent = 'Vos choix sont enregistrés ✓';
    };
    el.querySelector('#cookieSave').addEventListener('click', () => done(save(Object.fromEntries([...el.querySelectorAll('[data-opt]')].map((i) => [i.dataset.opt, i.checked])))));
    el.querySelector('#cookieAll').addEventListener('click', () => done(save(all(true))));
    el.querySelector('#cookieNone').addEventListener('click', () => done(save(all(false))));
    hideBanner();
  }

  window.kamwaConsent = {
    /** true si la personne a accepté cette catégorie ('audience' ou 'marketing') */
    has: (key) => Boolean(read()?.choices?.[key]),
    get: () => read(),
    renderSettings,
  };

  const start = () => { if (!read()) showBanner(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('hashchange', () => { if (!read() && !location.hash.startsWith('#/cookies')) showBanner(); });
})();
