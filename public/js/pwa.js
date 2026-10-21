// Zado — application web (PWA) : enregistrement du service worker, proposition d'installation, mode hors ligne.
// Utilisé par la boutique (/) et par l'espace pro (/admin/). Aucune donnée personnelle n'est utilisée ici.
(() => {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isAdmin = location.pathname.startsWith('/admin');
  const DISMISS_KEY = isAdmin ? 'kamwa-pro-install-later' : 'kamwa-install-later';
  const DISMISS_DAYS = 21;
  let deferred = null; // l'invitation d'installation fournie par Chrome / Android
  const ico = (n) => `<svg class="ico" aria-hidden="true"><use href="/icons.svg?v=15#${n}"></use></svg>`;
  if (standalone) document.documentElement.classList.add('standalone');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  // Mise à jour automatique : quand une nouvelle version du site est en ligne, la page suivante la charge
  // toute seule (au prochain changement de page, ou au retour sur l'application après une pause).
  // Jamais au milieu d'une saisie : on attend que la personne change de page.
  let siteVersion = null; let updateReady = false; let checkedAt = 0;
  async function checkVersion(force) {
    if (!force && Date.now() - checkedAt < 20000) return;
    checkedAt = Date.now();
    try {
      const c = await fetch('/api/config', { cache: 'no-store' }).then((r) => r.json());
      if (!c.version) return;
      if (siteVersion && c.version !== siteVersion) {
        updateReady = true;
        navigator.serviceWorker?.getRegistration?.().then((r) => r && r.update()).catch(() => {});
      }
      siteVersion = siteVersion || c.version;
    } catch {}
  }
  // Saisie en cours (champ modifié, photo choisie) : on ne recharge pas sous les doigts de la personne
  const typing = () => [...document.querySelectorAll('input, textarea')].some((i) => !['hidden', 'radio', 'checkbox', 'file'].includes(i.type) && i.value && i.value !== i.defaultValue)
    || Boolean(document.querySelector('#idPreview:not([hidden]), .cam-overlay'));
  checkVersion(true);
  window.addEventListener('hashchange', async () => { if (!updateReady) await checkVersion(); if (updateReady) location.reload(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (updateReady && !typing()) location.reload(); else checkVersion(true);
  });
  setInterval(() => { if (!document.hidden) checkVersion(); }, 60000);

  const later = () => { try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_DAYS * 864e5; } catch { return false; } };
  const remindLater = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {} };
  // On attend que la personne ait répondu au bandeau cookies, pour ne pas empiler les fenêtres
  const cookiesAnswered = () => isAdmin || Boolean(window.kamwaConsent?.get());

  function card() {
    const el = document.getElementById('installCard');
    if (!el || standalone) return null;
    return el;
  }
  function showCard(force = false) {
    const el = card();
    if (!el || (!force && (later() || !cookiesAnswered()))) return;
    if (!deferred && !ios && !force) return;
    const how = deferred
      ? `<button type="button" class="btn small" data-install="go">${ico('download-simple')} Installer</button>`
      : ios
        ? `<p class="install-how">Touchez ${ico('export')} <b>Partager</b>, puis <b>« Sur l'écran d'accueil »</b>.</p>`
        : `<p class="install-how">Dans le menu du navigateur ${ico('dots-three-vertical')}, choisissez <b>« Installer l'application »</b> ou <b>« Ajouter à l'écran d'accueil »</b>.</p>`;
    el.innerHTML = `
      <img src="${isAdmin ? "/brand/pro-192.png?v=8" : "/brand/icone-192.png?v=8"}" alt="" width="48" height="48">
      <div class="install-text"><b>Installez l'application ${isAdmin ? 'Zado Pro' : 'Zado'}</b><span>S'ouvre en plein écran depuis votre téléphone, plus rapide, même avec peu de réseau. Gratuit, sans Play Store.</span>${deferred ? '' : how}</div>
      ${deferred ? how : ''}
      <button type="button" class="install-close" data-install="later" aria-label="Plus tard">${ico('x')}</button>`;
    el.hidden = false;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-install]');
    if (!b) return;
    if (b.dataset.install === 'later') { remindLater(); card() && (card().hidden = true); return; }
    if (b.dataset.install === 'go') await install();
  });

  async function install() {
    if (!deferred) { showCard(true); return false; }
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (card()) card().hidden = true;
    return outcome === 'accepted';
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    document.querySelectorAll('[data-install-btn]').forEach((b) => (b.hidden = false));
    setTimeout(() => showCard(), 4000);
  });
  window.addEventListener('appinstalled', () => { deferred = null; if (card()) card().hidden = true; });
  window.addEventListener('kamwa-consent', () => setTimeout(() => showCard(), 1500));
  if (ios && !standalone) setTimeout(() => showCard(), 6000);

  // Bandeau « pas de connexion »
  const bar = () => document.getElementById('offlineBar');
  const net = () => { if (bar()) bar().hidden = navigator.onLine; };
  window.addEventListener('online', net);
  window.addEventListener('offline', net);
  window.addEventListener('load', net);

  window.kamwaApp = {
    standalone, ios,
    canInstall: () => Boolean(deferred) || (ios && !standalone),
    install,
    showInstallHelp: () => showCard(true),
  };
})();
