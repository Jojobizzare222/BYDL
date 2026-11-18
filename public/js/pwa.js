// Zado — application web (PWA) : enregistrement du service worker, proposition d'installation, mode hors ligne.
// Utilisé par la boutique (/) et par l'espace pro (/admin/). Aucune donnée personnelle n'est utilisée ici.
(() => {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const isAdmin = location.pathname.startsWith('/admin');
  const DISMISS_KEY = isAdmin ? 'kamwa-pro-install-later' : 'kamwa-install-later';
  const DISMISS_DAYS = 21;
  let deferred = null; // l'invitation d'installation fournie par Chrome / Android
  const ico = (n) => `<svg class="ico" aria-hidden="true"><use href="/icons.svg?v=18#${n}"></use></svg>`;
  if (standalone) document.documentElement.classList.add('standalone');

  // Défaut d'iOS 26 (application installée sur iPhone / iPad, signalé par Joseph le 18/11/2026) : après la fermeture du
  // clavier, l'écran reste « raccourci » de la hauteur du clavier : la barre d'onglets et la bulle « Aide » restent bloquées
  // au milieu de la page. Parade connue : quand aucun champ n'est en cours de saisie et que la hauteur de la fenêtre est
  // plus petite que sa vraie hauteur, on fait recalculer la fenêtre (élément plein écran invisible masqué puis réaffiché,
  // petit défilement nul). Sans effet sur les autres appareils (rien n'est fait si la hauteur est normale).
  if (ios) {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;inset:0;height:100vh;visibility:hidden;pointer-events:none;z-index:-1';
    const add = () => document.body && !probe.isConnected && document.body.appendChild(probe);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
    let maxH = window.innerHeight, lastW = window.innerWidth;
    const typing = () => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
    window.addEventListener('resize', () => {
      if (window.innerWidth !== lastW) { lastW = window.innerWidth; maxH = window.innerHeight; return; } // téléphone tourné
      maxH = Math.max(maxH, window.innerHeight);
    });
    const heal = () => {
      if (typing() || maxH - window.innerHeight <= 4) return;
      add();
      const x = window.scrollX, y = window.scrollY;
      probe.style.display = 'none';
      void probe.offsetHeight; // recalcul immédiat
      probe.style.display = '';
      void document.documentElement.offsetHeight;
      window.scrollTo(x, y);
    };
    const later = () => { setTimeout(heal, 160); setTimeout(heal, 600); };
    document.addEventListener('focusout', later, true);
    window.addEventListener('hashchange', later);
    window.addEventListener('pageshow', later);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) later(); });
    window.visualViewport?.addEventListener('resize', () => { if (!typing()) later(); });
  }

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
  // Rechargement DISCRET (demande Joseph 14/11/2026 : « sans que ça se remarque, sans fermer l'application ») :
  // de préférence pendant que l'application est en arrière-plan (invisible), sinon au changement de page ;
  // la page suivante démarre sans écran de chargement et revient à la même position (classe « soft-boot », index.html).
  const softReload = () => {
    try { sessionStorage.setItem('kamwa-soft', JSON.stringify({ y: window.scrollY, hash: location.hash, at: Date.now() })); } catch {}
    location.reload();
  };
  checkVersion(true);
  window.addEventListener('hashchange', async () => { if (!updateReady) await checkVersion(); if (updateReady && !typing()) softReload(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (updateReady && !typing()) softReload(); return; } // invisible : l'application est en arrière-plan
    if (updateReady && !typing()) softReload(); else checkVersion(true);
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
  const net = () => {
    const b = bar(); if (!b) return;
    b.hidden = navigator.onLine;
    // Boutique : Mama Zando, désolée, devant son téléphone sans réseau (public/js/mama.js)
    if (!navigator.onLine && window.kamwaMama && !b.querySelector('.mz-avatar')) b.insertAdjacentHTML('afterbegin', window.kamwaMama.head('sorry', { size: 'xs' }));
  };
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
