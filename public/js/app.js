// Zado — front-end léger (aucune dépendance) pour rester rapide sur les réseaux mobiles.
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;

  // Univers et catégories affichés dans le menu : fournis par le serveur (src/catalog.js), même liste que l'admin
  let UNIVERSES = [];
  // Icônes Phosphor (fichier /icons.svg, récupérées via Iconify)
  const icon = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="/icons.svg?v=14#${name}"></use></svg>`;
  const ICONS = { 'Téléphones': 'device-mobile-duotone', 'Tablettes': 'device-tablet-duotone', 'Ordinateurs': 'laptop-duotone', 'Montres': 'watch-duotone', 'Audio': 'headphones-duotone', 'TV & Maison': 'television-duotone', 'Jeux vidéo & consoles': 'game-controller-duotone', 'Composants': 'cpu-duotone', 'Accessoires': 'plug-duotone' };
  const catIcon = (cat, cls = '') => icon(ICONS[cat] || 'shopping-bag-duotone', cls);
  // Vignettes sans photo : une des trois teintes de la charte, selon la catégorie
  const tintOf = (cat) => Object.keys(ICONS).indexOf(cat) % 3;
  const hasUniverse = (name) => UNIVERSES.some((u) => u.name === name);
  const universeOf = (cat) => UNIVERSES.find((u) => u.categories.includes(cat))?.name;

  const state = { products: [], config: {}, cart: loadCart(), sort: 'pertinence', timers: [], customer: null };

  // ---------- API ----------
  async function api(path, options = {}) {
    const res = await fetch('/api' + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.maintenance && typeof setMaintenance === 'function') setMaintenance({ enabled: true, message: data.error, until: data.until || null });
      throw Object.assign(new Error(data.error || 'Erreur réseau, réessayez.'), { data });
    }
    return data;
  }

  // ---------- Mode maintenance (activé dans Zado Pro → Réglages) ----------
  // Écran plein à l'ouverture de la boutique ; restent accessibles : suivi des commandes, compte, pages légales, Aide.
  // Aperçu pour l'équipe : /?apercu=maintenance&msg=…&until=… (rien n'est fermé, seul cet écran s'affiche).
  const MAINT_OPEN = ['compte', 'suivi', 'merci', 'legal', 'cookies', 'demo-suivi'];
  let maint = null, maintPreview = null;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('apercu') === 'maintenance') maintPreview = { enabled: true, message: q.get('msg') || '', until: q.get('until') || null, preview: true };
  } catch {}
  function setMaintenance(m) {
    const was = Boolean(maint?.enabled);
    maint = m || null;
    renderMaintenance();
    if (was && !maint?.enabled) toast('La boutique est rouverte, bonnes affaires !');
  }
  function renderMaintenance() {
    const m = maintPreview ? { ...maintPreview, message: maintPreview.message || maint?.message || '' } : maint;
    const page = (location.hash || '#/').slice(2).split('/')[0];
    const show = Boolean(m?.enabled) && (maintPreview || !MAINT_OPEN.includes(page));
    document.body.classList.toggle('maint-on', show);
    let el = document.getElementById('maintScreen');
    if (!show) { el?.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'maintScreen'; el.className = 'maint-screen'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'maintTitle'); document.body.appendChild(el); }
    const until = m.until ? new Date(m.until) : null;
    const hh = until && until.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const sameDay = until && until.toDateString() === new Date().toDateString();
    el.innerHTML = `<div class="maint-card">
        ${m.preview ? '<span class="maint-preview">Aperçu visible uniquement sur cet écran : la boutique reste ouverte</span>' : ''}
        <img class="maint-logo for-light" src="/brand/logo-zado.svg?v=8" alt="Zado" width="115" height="36"><img class="maint-logo for-dark" src="/brand/logo-zado-clair.svg?v=8" alt="Zado" width="115" height="36">
        <div class="maint-ico">${icon('clock-bold')}</div>
        <h1 id="maintTitle">Petite pause, on revient vite</h1>
        <p class="maint-msg">${esc(m.message || 'La boutique est en maintenance pour quelques instants.')}</p>
        ${until && until > Date.now() ? `<p class="maint-until">${icon('clock-bold')} Retour prévu ${sameDay ? "aujourd'hui" : 'le ' + until.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} vers ${hh}</p>` : ''}
        <p class="hint">Votre panier est gardé. Vous pouvez toujours suivre vos commandes en cours.</p>
        <div class="maint-actions">
          <a class="btn cta" href="#/compte">${icon('package')} Suivre ma commande</a>
          <button type="button" class="btn ghost" id="maintHelp">${icon('chat-circle')} Écrire à l'Aide</button>
        </div>
        ${m.preview ? '<button type="button" class="linkish" id="maintClose">Fermer l\'aperçu</button>' : '<button type="button" class="linkish" id="maintRetry">Réessayer</button>'}
      </div>`;
    el.querySelector('#maintHelp').addEventListener('click', () => window.kamwaChat?.open());
    el.querySelector('#maintClose')?.addEventListener('click', () => { maintPreview = null; history.replaceState(null, '', location.pathname + location.hash); renderMaintenance(); });
    el.querySelector('#maintRetry')?.addEventListener('click', checkMaintenance);
  }
  async function checkMaintenance() {
    try { const c = await fetch('/api/config', { cache: 'no-store' }).then((r) => r.json()); setMaintenance(c.maintenance); } catch {}
  }
  setInterval(() => { if (!document.hidden) checkMaintenance(); }, 60000);

  // ---------- Commande en cours (une seule commande et un seul paiement par panier) ----------
  // On garde la commande et sa clé secrète : si le client réessaie, recharge la page ou revient plus tard,
  // on reprend la même commande au lieu d'en créer une nouvelle (ce qui pourrait le faire payer deux fois).
  const cartKey = () => JSON.stringify(Object.entries(state.cart).sort());
  const loadJSON = (key) => { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } };
  const saveJSON = (key, value) => { try { value ? localStorage.setItem(key, JSON.stringify(value)) : localStorage.removeItem(key); } catch {} };
  // Message bref en bas de l'écran (ex. « Ajouté au panier ✓ »), avec un bouton d'action facultatif
  let toastTimer = null;
  function toast(msg, action) {
    let t = document.getElementById('shopToast');
    if (!t) { t = document.createElement('div'); t.id = 'shopToast'; t.className = 'shop-toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    if (action) t.querySelector('button').addEventListener('click', () => { t.classList.remove('show'); action.run(); });
    t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), action ? 4500 : 2800);
  }
  // Rangées d'onglets / pastilles qui défilent : fondu à droite tant qu'il reste quelque chose à voir (audit 17/10/2026)
  const SCROLLERS = '.chips, .acc-tabs, .filters, .catnav';
  const markScroll = (el) => el.classList.toggle('scroll-more', el.scrollWidth > el.clientWidth + 4 && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  const markScrollers = () => document.querySelectorAll(SCROLLERS).forEach(markScroll);
  document.addEventListener('scroll', (e) => { if (e.target.matches?.(SCROLLERS)) markScroll(e.target); }, true);
  addEventListener('resize', markScrollers);
  new MutationObserver(() => requestAnimationFrame(markScrollers)).observe(document.getElementById('app'), { childList: true });
  // Numéro congolais (9 chiffres commençant par 0, avec ou sans +242), comme le serveur
  const localPhone = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('242') && d.length === 12) d = d.slice(3); return /^0\d{8}$/.test(d) ? d : null; };
  // Frais de livraison (réglés dans Zado Pro, envoyés par /api/config) : villes, quartiers, livraison offerte
  const feeCfg = () => state.config?.deliveryFees || { cities: [{ city: 'Pointe-Noire', fee: 0, zones: [] }], other: { allowed: false, fee: 0 }, freeFrom: 0 };
  const normCity = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cityFees = (city) => feeCfg().cities.find((c) => normCity(c.city) === normCity(city));
  const deliveryCities = () => [...feeCfg().cities.map((c) => c.city), ...(feeCfg().other.allowed ? ['Autre ville'] : [])];
  function deliveryFee(city, zone, subtotal) {
    const cfg = feeCfg(), c = cityFees(city);
    const f = c ? (zone ? c.zones.find((z) => normCity(z.name) === normCity(zone))?.fee : undefined) ?? c.fee : cfg.other.allowed ? cfg.other.fee : null;
    if (f == null) return null;
    return cfg.freeFrom > 0 && subtotal >= cfg.freeFrom ? 0 : f;
  }
  // Erreurs de formulaire : message SOUS chaque champ fautif, curseur placé sur le premier (audit 17/10/2026)
  function fieldErrors(form, list) {
    form.querySelectorAll('.field-err').forEach((e) => e.remove());
    form.querySelectorAll('.has-err').forEach((e) => e.classList.remove('has-err'));
    for (const [el, msg] of list) {
      if (!el) continue;
      const anchor = el.closest('.kmap, .relay-picker, .methods, .id-pick') || el;
      el.classList.add('has-err');
      anchor.insertAdjacentHTML('afterend', `<p class="field-err" role="alert">${icon('warning-duotone')} ${esc(msg)}</p>`);
    }
    const first = list.find(([el]) => el)?.[0];
    if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (first.focus && first.type !== 'hidden') setTimeout(() => first.focus({ preventScroll: true }), 300); }
    return list.length === 0;
  }
  const loadCheckout = () => loadJSON('kamwa-checkout');
  const saveCheckout = (c) => saveJSON('kamwa-checkout', c);
  const orderHeaders = (token) => ({ 'X-Order-Token': token });

  function finishPaid(checkout) {
    state.cart = {}; saveCart(); saveCheckout(null);
    saveJSON('kamwa-last-order', { id: checkout.orderId, token: checkout.token });
    location.hash = '#/merci/' + checkout.orderId;
  }

  // Commandes passées depuis ce téléphone (numéro + clé secrète), pour « Mes commandes » même sans compte.
  const deviceOrders = () => loadJSON('kamwa-orders') || [];
  function rememberOrder(id, token) {
    const list = deviceOrders().filter((o) => o.id !== id);
    list.unshift({ id, token });
    saveJSON('kamwa-orders', list.slice(0, 50));
  }
  const tokenOf = (id) => deviceOrders().find((o) => o.id === id)?.token;

  // Statuts et étapes de suivi d'une commande
  const STATUS = { pending_payment: 'En attente de paiement', paid: 'Payée', confirmed: 'Confirmée — à payer à la livraison', shipped: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée' };
  const STEP_INDEX = { pending_payment: 0, paid: 1, confirmed: 1, shipped: 2, delivered: 3 };
  // Encadré du code de livraison : le client le donne au livreur seulement quand il a son colis en main
  const codeCard = (o) => (o.deliveryCode && o.fulfillment !== 'pickup' && ['paid', 'confirmed', 'shipped'].includes(o.status) ? `
    <div class="code-card">
      <span>Votre code de livraison</span>
      <strong>${esc(o.deliveryCode)}</strong>
      <p>Donnez-le au livreur <b>seulement quand vous avez votre colis en main</b>${o.paymentPlan === 'cod' && o.balance ? ` et après avoir payé ${fcfa(o.balance)}` : ''}. Ne le communiquez à personne d'autre, même au téléphone.</p>
    </div>` : '');
  const isPickup = (o) => o.fulfillment === 'pickup';
  const statusLabel = (o) => {
    if (o.agency && o.status === 'pending_payment') return 'Réservée — à payer au point relais';
    if (isPickup(o) && o.status === 'delivered') return 'Retirée';
    return STATUS[o.status] || o.status;
  };
  const statusBadge = (o) => `<span class="st st-${o.status}">${esc(statusLabel(o))}</span>`;
  // Étapes de suivi : livraison (4 étapes) ou retrait en agence (3 étapes)
  const stepIndex = (o) => (isPickup(o) ? { pending_payment: 0, paid: 1, delivered: 2 } : STEP_INDEX)[o.status] ?? -1;
  const stepCount = (o) => (isPickup(o) ? 3 : 4);
  const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const longDate = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const formatCode = (c) => `${c.slice(0, 3)} ${c.slice(3)}`;
  // Badge « identité vérifiée » (sceau Zado) : à côté du nom de chaque client dont la pièce a été validée
  const VERIFIED = '<svg class="vbadge" viewBox="0 0 24 24" role="img" aria-label="Identité vérifiée"><title>Identité vérifiée par Zado</title><path class="vb-seal" d="M12 .7l2.41 2.32 3.24-.81.93 3.21 3.21.93-.81 3.24L23.3 12l-2.32 2.41.81 3.24-3.21.93-.93 3.21-3.24-.81L12 23.3l-2.41-2.32-3.24.81-.93-3.21-3.21-.93.81-3.24L.7 12l2.32-2.41-.81-3.24 3.21-.93.93-3.21 3.24.81z"/><path class="vb-check" d="M7.4 12.4l3.1 3 6-6.2"/></svg>';
  const verifiedBadge = (c) => (c && c.idStatus === 'verified' ? VERIFIED : '');
  // Code Zado en 6 tuiles qui apparaissent une à une (3 + 3)
  const codeDigits = (c) => `<div class="cr-digits" aria-label="Code ${esc(c.split('').join(' '))}">${c.split('').map((d, i) => `${i === 3 ? '<i></i>' : ''}<span style="--i:${i}">${esc(d)}</span>`).join('')}</div>`;

  function renderAccountBtn() {
    const first = state.customer ? state.customer.name.split(' ')[0] : '';
    $('#accountHello').innerHTML = first ? `Mbote ${esc(first)} !${verifiedBadge(state.customer)}` : 'Mon espace';
    $('#accountLabel').textContent = first ? 'Mon compte' : 'Se connecter';
    $('#menuHello').innerHTML = first ? `Mbote ${esc(first)} !${verifiedBadge(state.customer)}` : 'Mon espace Zado';
    try { idWatch(); } catch {}
  }
  // ---------- Vérification de la pièce d'identité : compte à rebours fixe + animation « vérifiée » (demande Joseph 21/10/2026) ----------
  // Tant que la pièce est en attente, une pastille reste à l'écran sur TOUTES les pages : décompte d'une minute à partir de l'envoi
  // (heure du serveur : idSubmittedAt, donc le même après un changement de page ou un rechargement). Après la minute : « encore un instant ».
  // Dès que Zado valide (signal instantané du serveur + vérification toutes les 5 s en secours), l'animation « Identité vérifiée » se joue une fois.
  const ID_WAIT_S = 60;
  const ID_KEY = 'kamwa-id-state';
  let idTick = null, idPoll = null;
  function idWatch() {
    const c = state.customer;
    let prev = null; try { prev = JSON.parse(localStorage.getItem(ID_KEY) || 'null'); } catch {}
    if (!c) { idTimerHide(); return; }
    const st = c.idStatus || 'missing';
    if (prev && prev.id === c.id && prev.st === 'pending' && st === 'verified') idVerifiedShow(c);
    else if (prev && prev.id === c.id && prev.st === 'pending' && st === 'rejected') toast('Votre pièce d\'identité a été refusée : voyez pourquoi dans Mon compte.', { label: 'Voir', run: () => { location.hash = '#/compte'; } });
    if (!prev || prev.id !== c.id || prev.st !== st) try { localStorage.setItem(ID_KEY, JSON.stringify({ id: c.id, st })); } catch {}
    if (st === 'pending') idTimerShow(c); else idTimerHide();
  }
  function idTimerShow(c) {
    let el = document.getElementById('idTimer');
    if (!el) {
      el = document.createElement('a'); el.id = 'idTimer'; el.className = 'id-timer'; el.href = '#/compte';
      el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      el.innerHTML = `<span class="idt-ring"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="idt-bg" cx="22" cy="22" r="19"/><circle class="idt-fg" cx="22" cy="22" r="19"/></svg><b class="idt-s"></b></span>
        <span class="idt-txt"><strong>Vérification de votre pièce</strong><small class="idt-sub"></small></span>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
    }
    const start = Date.parse(c.idSubmittedAt || '') || Date.now();
    const draw = () => {
      const left = Math.max(0, Math.ceil(ID_WAIT_S - (Date.now() - start) / 1000));
      const fg = el.querySelector('.idt-fg'), C = 2 * Math.PI * 19;
      fg.style.strokeDasharray = C; fg.style.strokeDashoffset = String(C * (left / ID_WAIT_S));
      el.classList.toggle('late', left === 0);
      el.querySelector('.idt-s').textContent = left ? String(left) : '';
      el.querySelector('.idt-sub').textContent = left ? `Validation dans environ ${left} s` : 'Encore un instant, Zado termine la vérification…';
    };
    draw();
    if (!idTick) idTick = setInterval(() => { if (state.customer?.idStatus === 'pending') draw(); }, 1000);
    if (!idPoll) idPoll = setInterval(() => { if (!document.hidden && state.customer?.idStatus === 'pending') refreshCustomer(); }, 5000);
  }
  function idTimerHide() {
    clearInterval(idTick); clearInterval(idPoll); idTick = idPoll = null;
    const el = document.getElementById('idTimer');
    if (el) { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }
  }
  function idVerifiedShow(c) {
    if (document.getElementById('idVerified')) return;
    const hasCart = Object.keys(state.cart || {}).length > 0;
    const first = (c.name || '').split(' ')[0];
    const ov = document.createElement('div');
    ov.id = 'idVerified'; ov.className = 'idv'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'idvTitle');
    ov.innerHTML = `<div class="idv-card">
      <div class="idv-seal" aria-hidden="true">
        ${Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg;--d:${(i % 3) * 60}ms"></i>`).join('')}
        <svg viewBox="0 0 120 120"><circle class="idv-c" cx="60" cy="60" r="50"/><path class="idv-k" d="M38 62 l15 15 l30 -32"/></svg>
      </div>
      <h2 id="idvTitle">Identité vérifiée${first ? `, ${esc(first)}` : ''} !</h2>
      <p>Zado a validé votre pièce d'identité. Vous pouvez commander dès maintenant${hasCart ? ' : votre panier vous attend' : ''}.</p>
      <div class="idv-actions">
        <a class="btn cta" href="${hasCart ? '#/commande' : '#/'}" data-close>${hasCart ? 'Passer ma commande' : 'Découvrir la boutique'}</a>
        <button type="button" class="btn ghost" data-close>Fermer</button>
      </div></div>`;
    document.body.appendChild(ov);
    const close = () => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 250); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => { ov.classList.add('show'); ov.querySelector('[data-close]')?.focus({ preventScroll: true }); });
    try { navigator.vibrate?.([30, 60, 30]); } catch {}
  }
  window.kamwaIdDemo = () => idVerifiedShow(state.customer || { name: '' }); // aperçu de l'animation (console du navigateur)

  async function refreshCustomer() {
    try {
      const me = await api('/account/me'); state.customer = me.loggedIn ? me.customer : null;
      if (state.customer?.prefs && JSON.stringify({ ...state.prefs, ...state.customer.prefs }) !== JSON.stringify(state.prefs)) savePrefs(state.customer.prefs, { remote: false });
    } catch {}
    renderAccountBtn();
    if (typeof connectEvents === 'function') try { connectEvents(); } catch {}
  }

  // ---------- Panier (conservé dans le navigateur) ----------
  function loadCart() { try { return JSON.parse(localStorage.getItem('kamwa-cart')) || {}; } catch { return {}; } }
  function saveCart() { try { localStorage.setItem('kamwa-cart', JSON.stringify(state.cart)); } catch {} renderCart(); }
  const byId = (id) => state.products.find((p) => p.id === id);
  // Clé de panier : « id » (produit simple) ou « id|{"Couleur":"Noir"} » (produit avec choix)
  const parseKey = (key) => { const i = key.indexOf('|'); if (i < 0) return { id: key, variant: null }; try { return { id: key.slice(0, i), variant: JSON.parse(key.slice(i + 1)) }; } catch { return { id: key.slice(0, i), variant: null }; } };
  const variantText = (v) => (v ? Object.entries(v).map(([k, x]) => `${k} : ${x}`).join(' · ') : '');
  const cartItems = () => Object.entries(state.cart).map(([key, qty]) => { const { id, variant } = parseKey(key); return { key, product: byId(id), variant, qty }; }).filter((l) => l.product);
  const cartTotal = () => cartItems().reduce((s, l) => s + l.product.price * l.qty, 0);
  const cartSaving = () => cartItems().reduce((s, l) => s + ((l.product.oldPrice || l.product.price) - l.product.price) * l.qty, 0);
  const addToCart = (id, variant) => { const key = variant ? `${id}|${JSON.stringify(variant)}` : id; state.cart[key] = (state.cart[key] || 0) + 1; saveCart(); };
  const setQty = (id, qty) => { if (qty <= 0) delete state.cart[id]; else state.cart[id] = qty; saveCart(); };

  function renderCart() {
    const items = cartItems();
    const count = items.reduce((s, l) => s + l.qty, 0);
    $('#cartCount').textContent = count || '';
    $('#cartCount2').textContent = count || '';
    $('#cartTotal').textContent = fcfa(cartTotal());
    const saving = cartSaving();
    $('#cartSaving').innerHTML = saving > 0 ? `<span>Vous économisez</span><span>${fcfa(saving)}</span>` : '';
    $('#cartLines').innerHTML = items.length
      ? items.map(({ key, product: p, variant, qty }) => `
        <div class="line cart-line">
          <span class="line-img">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" width="56" height="56">` : icon(ICONS[p.category] || 'package')}</span>
          <div>
            <div>${esc(p.name)}</div>
            ${variant ? `<div class="hint">${esc(variantText(variant))}</div>` : ''}
            <div class="qty">
              <button data-qty="${esc(key)}" data-d="-1" aria-label="Retirer un">−</button>
              <span>${qty}</span>
              <button data-qty="${esc(key)}" data-d="1" aria-label="Ajouter un">+</button>
            </div>
          </div>
          <strong>${fcfa(p.price * qty)}</strong>
        </div>`).join('')
      : '<p class="empty">Votre panier est vide.</p>';
    const hint = $('#cartHint'); if (hint) hint.innerHTML = items.length ? accountHint('cart') : '';
  }

  // ---------- Tiroir panier ----------
  const drawer = $('#drawer');
  const openDrawer = () => { drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.body.classList.add('drawer-open'); };
  const closeDrawer = () => { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); document.body.classList.remove('drawer-open'); };
  $('#cartBtn').addEventListener('click', openDrawer);
  $('#closeDrawer').addEventListener('click', closeDrawer);
  drawer.addEventListener('click', (e) => { if (e.target === drawer) closeDrawer(); });
  $('#checkoutLink').addEventListener('click', (e) => { if (!cartItems().length) e.preventDefault(); closeDrawer(); });

  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      e.preventDefault();
      if ((byId(add.dataset.add)?.options || []).length) { location.hash = '#/p/' + add.dataset.add; return; } // choisir la couleur / taille d'abord
      addToCart(add.dataset.add);
      added();
      const label = add.innerHTML;
      add.innerHTML = `${icon('check-bold')} Ajouté`;
      setTimeout(() => (add.innerHTML = label), 1200);
    }
    const q = e.target.closest('[data-qty]');
    if (q) setQty(q.dataset.qty, (state.cart[q.dataset.qty] || 0) + Number(q.dataset.d));
  });

  // ---------- Recherche (panneau sous l'en-tête) ----------
  const header = $('.header');
  const toggleSearch = (open) => {
    header.classList.toggle('search-open', open);
    $('#searchToggle').setAttribute('aria-expanded', String(open));
    if (open) $('#searchInput').focus();
  };
  $('#searchToggle').addEventListener('click', () => toggleSearch(!header.classList.contains('search-open')));

  // En-tête compact sur téléphone quand on descend (ville et rayons masqués, recherche gardée) ; il revient en remontant
  // (le navigateur recale la page quand l'en-tête change de hauteur : ces défilements-là sont ignorés, sinon il clignoterait)
  let lastY = scrollY, upBy = 0, settle = 0;
  const setCompact = (on) => { if (header.classList.contains('compact') !== on) { header.classList.toggle('compact', on); settle = performance.now() + 300; } };
  addEventListener('scroll', () => {
    const y = scrollY, d = y - lastY; lastY = y;
    if (performance.now() < settle) return;
    if (!matchMedia('(max-width: 860px)').matches) return setCompact(false);
    if (y < 80) { upBy = 0; return setCompact(false); }
    if (d > 0) { upBy = 0; if (y > 180 && !header.classList.contains('search-open')) setCompact(true); }
    else if ((upBy -= d) > 60) { upBy = 0; setCompact(false); }
  }, { passive: true });

  // ---------- Barre d'onglets (téléphone) et installation de l'application ----------
  $('#tabSearch').addEventListener('click', () => { window.scrollTo({ top: 0, behavior: 'smooth' }); toggleSearch(true); });
  $('#tabCart').addEventListener('click', openDrawer);
  $('#installLink').addEventListener('click', (e) => { e.preventDefault(); window.kamwaApp?.install(); });
  function markTab(page) {
    const key = { '': 'home', p: 'home', c: 'home', promos: 'promos', compte: 'compte', suivi: 'compte', recherche: 'recherche' }[page];
    document.querySelectorAll('#appTabs [data-tab]').forEach((t) => t.classList.toggle('on', t.dataset.tab === key));
  }
  // Rayon choisi à gauche de la recherche : « u:Univers » ou « c:Catégorie »
  const searchCat = () => $('#searchCat').value;
  const catHash = (v) => (v.startsWith('u:') ? '#/c/' + enc(v.slice(2)) : '#/c/' + enc(UNIVERSES.find((u) => u.categories.includes(v.slice(2)))?.name || '') + '/' + enc(v.slice(2)));
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    location.hash = q ? '#/recherche/' + enc(q) : searchCat() ? catHash(searchCat()) : '#/';
  });
  // Suggestions pendant la frappe (audit 17/10/2026) : produits, rayons et « Vouliez-vous dire » ; clavier (↑ ↓ Entrée Échap) et toucher
  const sugBox = $('#searchSuggest');
  let sugTimer = null, sugSeq = 0, sugIdx = -1;
  const sugItems = () => [...sugBox.querySelectorAll('a')];
  const hideSuggest = () => { sugBox.hidden = true; sugBox.innerHTML = ''; sugIdx = -1; };
  const markSug = (i) => { const it = sugItems(); sugIdx = Math.max(-1, Math.min(i, it.length - 1)); it.forEach((a, k) => a.classList.toggle('on', k === sugIdx)); if (sugIdx >= 0) it[sugIdx].scrollIntoView({ block: 'nearest' }); };
  async function suggest(q) {
    const seq = ++sugSeq;
    let r;
    try { r = await fetch('/api/products/suggest?q=' + enc(q)).then((x) => (x.ok ? x.json() : null)); } catch { r = null; }
    if (seq !== sugSeq || !r || $('#searchInput').value.trim() !== q) return;
    if (!r.products.length && !r.categories.length) return hideSuggest();
    sugBox.innerHTML = `
      ${r.didYouMean ? `<p class="sug-dym">Résultats pour « ${esc(r.didYouMean)} »</p>` : ''}
      ${r.categories.map((c) => `<a href="#/c/${enc(c.universe)}/${enc(c.category)}" role="option">${icon(ICONS[c.category] || 'squares-four')}<span>Rayon <b>${esc(c.category)}</b></span><small>${c.count}</small></a>`).join('')}
      ${r.products.map((p) => `<a href="#/p/${enc(p.id)}" role="option"><span class="sug-img">${p.image ? `<img src="${esc(p.image)}" alt="" width="36" height="36" loading="lazy">` : icon(ICONS[p.category] || 'package')}</span><span>${esc(p.name)}</span><small>${fcfa(p.price)}</small></a>`).join('')}
      <a href="#/recherche/${enc(q)}" role="option" class="sug-all">${icon('magnifying-glass')}<span>Voir tous les résultats pour « ${esc(q)} »</span></a>`;
    sugBox.hidden = false; sugIdx = -1;
  }
  $('#searchInput').addEventListener('input', () => {
    clearTimeout(sugTimer);
    const q = $('#searchInput').value.trim();
    if (q.length < 2) { sugSeq++; return hideSuggest(); }
    sugTimer = setTimeout(() => suggest(q), 220);
  });
  $('#searchInput').addEventListener('keydown', (e) => {
    if (sugBox.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); markSug(sugIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); markSug(sugIdx - 1); }
    else if (e.key === 'Escape') hideSuggest();
    else if (e.key === 'Enter' && sugIdx >= 0) { e.preventDefault(); location.hash = sugItems()[sugIdx].getAttribute('href'); hideSuggest(); $('#searchInput').blur(); }
  });
  sugBox.addEventListener('click', (e) => { if (e.target.closest('a')) { hideSuggest(); $('#searchInput').blur(); } });
  document.addEventListener('pointerdown', (e) => { if (!sugBox.hidden && !e.target.closest('#searchForm')) hideSuggest(); });
  window.addEventListener('hashchange', hideSuggest);
  $('#searchForm').addEventListener('submit', () => { sugSeq++; clearTimeout(sugTimer); hideSuggest(); });

  $('#searchCat').addEventListener('change', () => {
    const o = $('#searchCat').selectedOptions[0];
    $('#searchCatLabel').textContent = o.value ? o.textContent.trim() : 'Rayons';
  });

  // Ville de livraison (en-tête) : retenue pour pré-remplir la commande
  function renderDeliverCity() {
    const city = loadJSON('kamwa-customer')?.city || 'Pointe-Noire';
    if (state.config?.deliveryFees) $('#deliverSelect').innerHTML = [...new Set([...deliveryCities(), city])].map((c) => `<option>${esc(c)}</option>`).join('');
    $('#deliverCity').textContent = city;
    $('#deliverSelect').value = city;
  }
  $('#deliverSelect').addEventListener('change', (e) => {
    const c = loadJSON('kamwa-customer') || {};
    c.city = e.target.value;
    try { localStorage.setItem('kamwa-customer', JSON.stringify(c)); } catch {}
    renderDeliverCity();
    if (location.hash.startsWith('#/commande')) route();
  });
  renderDeliverCity();

  // Menu « Toutes les catégories »
  const menu = $('#menuPanel');
  const openMenu = (open) => {
    menu.classList.toggle('open', open);
    menu.setAttribute('aria-hidden', String(!open));
    ['#menuBtn', '#allBtn'].forEach((b) => $(b).setAttribute('aria-expanded', String(open)));
    document.body.classList.toggle('no-scroll', open);
  };
  $('#menuBtn').addEventListener('click', () => openMenu(true));
  $('#allBtn').addEventListener('click', () => openMenu(true));
  $('#subHelp')?.addEventListener('click', () => window.kamwaChat?.open()); // « Aide » de la barre des rayons : ouvre la messagerie
  $('#menuClose').addEventListener('click', () => openMenu(false));
  menu.addEventListener('click', (e) => { if (e.target === menu || e.target.closest('a')) openMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('open')) openMenu(false); });

  // ---------- Réglages personnels du client (ne changent l'affichage QUE pour lui) ----------
  // Gardés sur ce téléphone (kamwa-prefs) et, s'il est connecté, sur son compte (ils le suivent d'un téléphone à l'autre).
  const PREF_DEFAULTS = { theme: 'light', textSize: 'normal', density: 'comfort', motion: 'normal', splash: true, dataSaver: false, showFlash: true, homeUniverse: '', hiddenUniverses: [], city: '', relayId: '', notify: { orders: true, chat: true } };
  state.prefs = { ...PREF_DEFAULTS, ...(loadJSON('kamwa-prefs') || {}) };
  function applyPrefs() {
    const h = document.documentElement, p = state.prefs;
    h.setAttribute('data-text', p.textSize); h.setAttribute('data-density', p.density);
    h.setAttribute('data-motion', p.motion); h.setAttribute('data-saver', p.dataSaver ? 'on' : 'off');
    if (window.kamwaTheme && window.kamwaTheme.mode() !== p.theme) window.kamwaTheme.set(p.theme);
  }
  function savePrefs(patch, { remote = true } = {}) {
    state.prefs = { ...state.prefs, ...patch };
    saveJSON('kamwa-prefs', state.prefs);
    applyPrefs();
    if (remote && state.customer) api('/account/prefs', { method: 'PUT', body: patch }).catch(() => {});
  }
  // Rayons dans l'ordre du client (rayon préféré d'abord, rayons masqués retirés de l'accueil et de l'en-tête)
  const myUniverses = () => {
    const hidden = state.prefs.hiddenUniverses || [];
    const list = UNIVERSES.filter((u) => !hidden.includes(u.name));
    const fav = list.find((u) => u.name === state.prefs.homeUniverse);
    return fav ? [fav, ...list.filter((u) => u !== fav)] : (list.length ? list : UNIVERSES);
  };
  applyPrefs();

  // ---------- Apparence : clair / sombre / automatique (comme le téléphone) ----------
  const themeSwitch = () => {
    const m = window.kamwaTheme?.mode() || 'light';
    return `<div class="theme-switch" role="group" aria-label="Apparence">${[['light', 'sun', 'Clair'], ['dark', 'moon', 'Sombre'], ['auto', 'circle-half', 'Auto']]
      .map(([k, ic, l]) => `<button type="button" data-theme-set="${k}" class="${m === k ? 'on' : ''}" aria-pressed="${m === k}">${icon(ic)} ${l}</button>`).join('')}</div>`;
  };
  const renderThemeSwitches = () => document.querySelectorAll('[data-theme-host]').forEach((h) => { h.innerHTML = themeSwitch(); });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-theme-set]'); if (b) { savePrefs({ theme: b.dataset.themeSet }); renderThemeSwitches(); } });

  // ---------- Menu déroulant des grandes catégories (en-tête) ----------
  let dropTimer = null;
  function closeDrop() {
    const d = $('#catDrop'); if (d) d.hidden = true;
    document.querySelectorAll('#catnav .uni').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  function openDrop(btn) {
    clearTimeout(dropTimer);
    const u = UNIVERSES.find((x) => x.name === btn.dataset.uni); if (!u) return;
    let d = $('#catDrop');
    if (!d) { d = document.createElement('div'); d.id = 'catDrop'; d.className = 'cat-drop'; $('.hdr-sub .sub-inner').appendChild(d);
      d.addEventListener('mouseenter', () => clearTimeout(dropTimer)); d.addEventListener('mouseleave', () => { dropTimer = setTimeout(closeDrop, 250); });
      d.addEventListener('click', (e) => { if (e.target.closest('a')) closeDrop(); }); }
    d.innerHTML = `<a class="drop-all" href="#/c/${enc(u.name)}">Tout ${esc(u.name.toLowerCase())} ${icon('caret-right')}</a>
      <div class="drop-grid">${u.categories.map((c) => `<a href="#/c/${enc(u.name)}/${enc(c)}">${catIcon(c)}<span>${esc(c)}</span></a>`).join('')}</div>`;
    const box = $('.hdr-sub .sub-inner').getBoundingClientRect(); const r = btn.getBoundingClientRect();
    d.style.left = Math.max(8, Math.min(r.left - box.left, box.width - 348)) + 'px';
    d.hidden = false;
    document.querySelectorAll('#catnav .uni').forEach((b) => b.setAttribute('aria-expanded', String(b === btn)));
  }
  $('#catnav').addEventListener('click', (e) => {
    const b = e.target.closest('.uni'); if (!b) return;
    // Ordinateur (souris) : le survol ouvre le menu, le clic mène à la catégorie. Téléphone : le toucher ouvre / ferme.
    if (matchMedia('(hover: hover)').matches) { closeDrop(); location.hash = '#/c/' + enc(b.dataset.uni); return; }
    if (b.getAttribute('aria-expanded') === 'true') closeDrop(); else openDrop(b);
  });
  $('#catnav').addEventListener('mouseover', (e) => { const b = e.target.closest('.uni'); if (b && matchMedia('(hover: hover)').matches) openDrop(b); });
  $('#catnav').addEventListener('mouseout', (e) => { if (e.target.closest('.uni') && matchMedia('(hover: hover)').matches) dropTimer = setTimeout(closeDrop, 250); });
  $('#catnav').addEventListener('scroll', closeDrop);
  document.addEventListener('click', (e) => { if (!e.target.closest('#catDrop, #catnav .uni')) closeDrop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrop(); });

  // ---------- Menu catégories ----------
  function renderNav(active) {
    // Barre des rayons (vitrine tech, 19/10/2026) : « Bonnes affaires » en premier ; avec un seul univers (électronique),
    // ses rayons sont affichés directement (ceux qui ont des produits) ; avec plusieurs, menu déroulant par univers.
    const links = [`<a href="#/promos" class="deals-link ${active === 'promos' ? 'active' : ''}">${icon('fire')} Bonnes affaires <span class="nb">Promo</span></a>`];
    const unis = myUniverses();
    if (unis.length === 1) {
      const u = unis[0];
      for (const c of u.categories.filter((c) => state.products.some((p) => p.category === c))) {
        links.push(`<a href="#/c/${enc(u.name)}/${enc(c)}" class="${active === c ? 'active' : ''}">${esc(c)}</a>`);
      }
    } else {
      links.unshift(`<a href="#/" class="${!active ? 'active' : ''}">Accueil</a>`);
      for (const u of unis) {
        const on = active === u.name || u.categories.includes(active);
        links.push(`<button type="button" class="uni ${on ? 'active' : ''}" data-uni="${esc(u.name)}" aria-expanded="false">${esc(u.name)} ${icon('caret-down')}</button>`);
      }
    }
    $('#catnav').innerHTML = links.join('');
    closeDrop();
    // Menu « Toutes » et liste des rayons de la recherche (une seule fois)
    if (!$('#menuBody').innerHTML) {
      $('#menuBody').innerHTML = `<h3>À la une</h3>
        <a href="#/promos">${icon('seal-percent')} Bonnes affaires</a>` +
        UNIVERSES.map((u) => `<h3>${esc(u.name)}</h3><a href="#/c/${enc(u.name)}">Tout ${esc(u.name.toLowerCase())}</a>` +
          u.categories.map((c) => `<a href="#/c/${enc(u.name)}/${enc(c)}">${catIcon(c)} ${esc(c)}</a>`).join('')).join('') +
        `<h3>Aide et compte</h3><a href="#/compte">${icon('user-circle')} Mon compte et mes commandes</a>
        <a href="#/legal/vente">${icon('arrow-counter-clockwise')} Livraison et retours</a>
        <h3>Apparence</h3><div style="padding:6px 20px 0" data-theme-host></div>`;
      renderThemeSwitches();
      $('#searchCat').innerHTML = '<option value="">Tous les rayons</option>' +
        UNIVERSES.map((u) => `<option value="u:${esc(u.name)}">${esc(u.name)}</option>` + u.categories.map((c) => `<option value="c:${esc(c)}">&nbsp;&nbsp;${esc(c)}</option>`).join('')).join('');
    }
    $('#footerShop').innerHTML = (UNIVERSES.length === 1 ? UNIVERSES[0].categories.filter((c) => state.products.some((p) => p.category === c)).map((c) => `<li><a href="#/c/${enc(UNIVERSES[0].name)}/${enc(c)}">${esc(c)}</a></li>`) : UNIVERSES.map((u) => `<li><a href="#/c/${enc(u.name)}">${esc(u.name)}</a></li>`)).join('') + '<li><a href="#/promos">Bonnes affaires</a></li>';
  }

  // ---------- Composants ----------
  const discount = (p) => (p.oldPrice && p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0);

  // Image du produit si elle existe, sinon pictogramme sur fond coloré (repli)
  function visual(p, cls = 'thumb') {
    if (p.image) {
      return `<div class="${cls} has-img" style="--fallback:${esc(p.color || '#10264A')}">${catIcon(p.category, 'fallback-ico')}
        <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('img-failed');this.remove()">`;
    }
    return `<div class="${cls} no-img tint-${tintOf(p.category)}">${catIcon(p.category)}`;
  }

  // Familles : même produit en plusieurs couleurs (fiche « family » saisie dans Zado Pro, sinon couleur en fin de nom)
  const COLORS = { 'lumiere stellaire': '#F2EEE6', 'gris sideral': '#5B5E63', 'titane naturel': '#C2BCB2', 'titane noir': '#3B3B3D', 'titane blanc': '#F1F0EC', 'titane bleu': '#3E4A5C', 'titane desert': '#C8B49B', 'bleu ciel': '#A7C6ED', 'bleu nuit': '#1E2A44', minuit: '#1F2933', noir: '#1B1B1F', blanc: '#F5F5F5', bleu: '#3B6BD6', rose: '#F4C6CF', vert: '#A9CFA0', jaune: '#F7E27A', rouge: '#D23B3B', violet: '#8E6FD8', argent: '#D9DCE1', or: '#E8C77A', gris: '#8B8F96', mauve: '#B9A5D6', graphite: '#4A4A4F', orange: '#F28C38', beige: '#E3D3B4', marron: '#7A5233', kaki: '#7A7A4A', creme: '#F3EBD9', corail: '#FF7F66' };
  const COLOR_KEYS = Object.keys(COLORS).sort((a, b) => b.length - a.length);
  const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const colorOf = (p) => { const n = plain(p.name); const c = COLOR_KEYS.find((k) => n.endsWith(' ' + k)); return c ? { key: c, label: p.name.slice(p.name.length - c.length), hex: COLORS[c] } : null; };
  const familyKey = (p) => { if (p.family) return 'f:' + plain(p.family); const c = colorOf(p); return c ? `${p.category}|${plain(p.name).slice(0, -c.key.length).trim()}` : null; };
  const familyName = (p) => p.family || (colorOf(p) ? p.name.slice(0, p.name.length - colorOf(p).label.length).trim() : p.name);
  const siblings = (p) => { const k = familyKey(p); return k ? state.products.filter((x) => familyKey(x) === k) : [p]; };
  function groupFamilies(list) {
    const seen = new Map(); const out = [];
    for (const p of list) {
      const k = familyKey(p);
      if (k && seen.has(k)) { seen.get(k).push(p); continue; }
      const g = [p]; if (k) seen.set(k, g); out.push(g);
    }
    return out;
  }
  const cardsOf = (list) => groupFamilies(list).map((g) => card(g[0], g)).join('');

  // Compte vérifié obligatoire : annoncé DÈS le début du parcours (audit 17/10/2026), pas seulement au moment de commander
  function accountHint(where = 'pdp') {
    if (state.config?.accountRequired === false) return '';
    const c = state.customer;
    if (c && c.idStatus === 'verified') return '';
    const msg = !c
      ? `<b>Première commande ?</b> Créez votre compte Zado avec la photo de votre pièce d'identité : nous la vérifions (en général en 1 minute), puis vous commandez. <a href="#/compte/creer">Créer mon compte</a> · <a href="#/compte">Me connecter</a>`
      : c.idStatus === 'pending' ? `<b>Votre pièce d'identité est en cours de vérification.</b> Vous pourrez commander dès sa validation (en général en 1 minute). Votre panier est gardé.`
      : `<b>Pièce d'identité à envoyer</b> pour pouvoir commander. <a href="#/compte">Envoyer ma pièce</a>`;
    return `<div class="acct-hint ${where}">${icon('identification-card')}<span>${msg}</span></div>`;
  }
  // Confirmation d'ajout au panier (message + accès direct au panier)
  const added = () => toast('Ajouté au panier ✓', { label: 'Voir le panier', run: openDrawer });

  // Étoiles des avis clients (note sur 5, demi-étoile arrondie à l'affichage)
  const stars = (n, cls = '') => `<span class="stars ${cls}" aria-label="${String(n).replace('.', ',')} sur 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${n >= i - 0.25 ? 'on' : n >= i - 0.75 ? 'half' : ''}"></i>`).join('')}</span>`;
  const famRating = (family) => {
    const r = family.filter((x) => x.rating); const count = r.reduce((n, x) => n + x.rating.count, 0);
    return count ? { avg: Math.round((r.reduce((n, x) => n + x.rating.avg * x.rating.count, 0) / count) * 10) / 10, count } : null;
  };
  const ratingLine = (r) => (r ? `<span class="rating">${stars(r.avg)}<small>${String(r.avg).replace('.', ',')} (${r.count})</small></span>` : '');
  function card(p, family = [p]) {
    const multi = family.length > 1;
    const d = discount(p);
    const tag = p.condition && p.condition !== 'neuf' ? `<span class="tag tag-violet">${esc(p.condition === 'reconditionné' ? 'Reconditionné' : 'Occasion')}</span>`
      : p.featured ? '<span class="tag tag-mango">Nouveau</span>' : '';
    return `
      <article class="card">
        <a href="#/p/${p.id}" class="card-link">
          ${visual(p)}</div>
          ${d ? `<span class="disc">-${d} %</span>` : ''}
          ${tag ? `<span class="card-badge">${tag}</span>` : ''}
        </a>
        <div class="card-body">
          <div class="card-tag">${p.provenance ? `<span class="orig">${icon('airplane-tilt')} ${esc(p.provenance)}</span>` : ''}${p.sourceSupplier ? `<span class="orig src" title="Fournisseur : ${esc(p.sourceSupplier)}">${icon('seal-check-duotone')} <span>${esc(p.sourceSupplier)}</span></span>` : ''}</div>
          <a href="#/p/${p.id}"><h3>${esc(multi ? familyName(p) : p.name)}</h3></a>
          ${ratingLine(famRating(family))}
          ${multi ? `<div class="swatches" aria-label="${family.length} couleurs">${family.slice(0, 6).map((x) => `<i style="background:${colorOf(x)?.hex || '#ccc'}" title="${esc(colorOf(x)?.label || '')}"></i>`).join('')}<small>${family.length} couleurs</small></div>` : ''}
          <div class="prices"><span class="price ${d && !multi ? 'sale' : ''}">${multi && family.some((x) => x.price !== p.price) ? 'dès ' : ''}${fcfa(multi ? Math.min(...family.map((x) => x.price)) : p.price)}</span><span class="old">${d && !multi ? fcfa(p.oldPrice) : ''}</span></div>
          <span class="stock-low ${!multi && p.stock > 0 && p.stock <= 6 ? '' : 'ok'}">${!multi && p.stock > 0 && p.stock <= 6 ? `${icon('fire')} Plus que ${p.stock} en stock` : multi || p.stock > 0 ? '<i class="dot"></i> En stock' : ''}</span>
          ${multi ? `<a class="btn cta small" href="#/p/${p.id}">Choisir la couleur</a>` : `<button class="btn cta small" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>${p.stock === 0 ? 'Épuisé' : (p.options || []).length ? 'Choisir' : `${icon('plus')} Ajouter`}</button>`}
        </div>
      </article>`;
  }

  // Rangée de produits défilante, avec flèches sur ordinateur (glisser au doigt sur téléphone)
  let railSeq = 0;
  function railCarousel(list) {
    const id = 'rail' + ++railSeq;
    return `<div class="rail-wrap">
      <button class="rail-arrow prev" data-rail="${id}" data-dir="-1" aria-label="Produits précédents">${icon('caret-left')}</button>
      <div class="rail" id="${id}">${cardsOf(list)}</div>
      <button class="rail-arrow next" data-rail="${id}" data-dir="1" aria-label="Produits suivants">${icon('caret-right')}</button>
    </div>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rail]');
    if (!b) return;
    const rail = document.getElementById(b.dataset.rail);
    rail?.scrollBy({ left: Number(b.dataset.dir) * rail.clientWidth * 0.85, behavior: 'smooth' });
  });

  // Grand carrousel de l'accueil : défile seul toutes les 6 s (pause au survol / au toucher), flèches et points
  function setupSlider(root, delay = 6000) {
    const track = root.querySelector('.slider-track');
    const n = track.children.length;
    const dots = root.querySelector('.slider-dots');
    dots.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<button type="button" aria-label="Diapositive ${i + 1}" data-go="${i}"></button>`).join('') : '';
    const cur = () => Math.round(track.scrollLeft / track.clientWidth);
    const go = (i) => track.scrollTo({ left: ((i + n) % n) * track.clientWidth, behavior: 'smooth' });
    const mark = () => [...dots.children].forEach((d, j) => d.classList.toggle('on', j === cur()));
    let t;
    track.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(mark, 60); }, { passive: true });
    root.addEventListener('click', (e) => {
      const d = e.target.closest('[data-go]'); if (d) go(Number(d.dataset.go));
      const a = e.target.closest('[data-slide]'); if (a) go(cur() + Number(a.dataset.slide));
    });
    let paused = false;
    root.addEventListener('mouseenter', () => (paused = true));
    root.addEventListener('mouseleave', () => (paused = false));
    root.addEventListener('touchstart', () => { paused = true; setTimeout(() => (paused = false), 8000); }, { passive: true });
    if (n > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      state.timers.push(setInterval(() => { if (!paused && !document.hidden && state.prefs.motion !== 'reduce') go(cur() + 1); }, delay)); // défilement auto coupé si « réduire les animations »
    }
    mark();
  }

  // Temps restant jusqu'à minuit (ventes flash du jour)
  function untilMidnight() {
    const now = new Date(); const end = new Date(now); end.setHours(24, 0, 0, 0);
    const sec = Math.floor((end - now) / 1000);
    return [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((x) => String(x).padStart(2, '0'));
  }

  function sortList(list) {
    const l = [...list];
    if (state.sort === 'prix-asc') l.sort((a, b) => a.price - b.price);
    if (state.sort === 'prix-desc') l.sort((a, b) => b.price - a.price);
    if (state.sort === 'remise') l.sort((a, b) => discount(b) - discount(a));
    return l;
  }

  // ---------- Vues ----------
  function viewHome() {
    renderNav(null);
    const deals = [...state.products].filter((p) => discount(p) > 0).sort((a, b) => discount(b) - discount(a)).slice(0, 12);
    const inUniverse = (u) => state.products.filter((p) => p.universe === u);
    const featured = (u) => inUniverse(u).filter((p) => p.featured).concat(inUniverse(u).filter((p) => !p.featured)).slice(0, 12);
    const withImg = (list) => list.find((p) => p.image);
    const heroP = withImg(state.products.filter((p) => p.featured)) || withImg(state.products) || state.products.find((p) => p.featured) || state.products[0];
    const used = new Set([heroP?.id]);
    const pick = (list) => { const p = list.find((x) => x.image && !used.has(x.id)) || list.find((x) => !used.has(x.id)); if (p) used.add(p.id); return p; }; // photo de préférence

    // Diapositives du grand carrousel (construites à partir du catalogue)
    const slide = ({ theme, kicker, title, text, href, cta, p, extra = '' }) => `
      <div class="slide theme-${theme}">
        <div class="slide-text">
          <span class="pill">${kicker}</span>
          <h2>${title}</h2>
          <p>${text}</p>
          ${extra}
          <div class="slide-ctas"><a class="btn ${theme === 'light' || theme === 'mango' ? 'cta' : 'light'}" href="${href}">${esc(cta)} ${icon('arrow-right')}</a>${p ? `<a class="slide-more" href="#/p/${p.id}">Voir la fiche</a>` : ''}</div>
        </div>
        <div class="slide-visual">
          <span class="deco o1"></span><span class="deco o2"></span><span class="deco o3"></span>
          ${p?.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" ${p === heroP ? '' : 'loading="lazy"'}>` : p ? `<span class="slide-ico">${catIcon(p.category)}</span>` : ''}
          ${p && discount(p) ? `<span class="slide-badge">-${discount(p)} %</span>` : ''}
        </div>
      </div>`;
    const slides = [];
    if (heroP) slides.push(slide({ theme: 'violet', kicker: `${icon('sparkle-fill')} Nouveauté`, title: esc(heroP.name.replace(/^Apple /, '')), text: `À partir de <strong>${fcfa(heroP.price)}</strong>, avec livraison rapide chez vous.`, href: `#/p/${heroP.id}`, cta: 'Je le veux', p: heroP }));
    if (deals.length) slides.push(slide({ theme: 'coral', kicker: `${icon('lightning-fill')} Bonnes affaires`, title: `Jusqu'à -${discount(deals[0])} %`, text: 'Des prix cassés sur une sélection de produits, dans la limite des stocks.', href: '#/promos', cta: 'Voir les offres', p: pick(deals) }));
    for (const u of myUniverses()) {
      const p = pick(featured(u.name));
      if (p) slides.push(slide({ theme: 'mango', kicker: esc(u.name), title: 'Le meilleur de la tech', text: esc(u.categories.slice(0, 4).join(' · ')), href: `#/c/${enc(u.name)}`, cta: 'Découvrir', p }));
    }
    slides.push(slide({
      theme: 'light', kicker: `${icon('wallet')} Paiement`, title: 'Réservez en ligne, payez au point relais', text: 'Choisissez un point relais près de chez vous sur la carte, payez-y en espèces, puis repartez avec votre commande ou faites-vous livrer.', href: '#/promos', cta: 'Commencer mes achats',
      extra: '<div class="pay-chips"><span>' + icon('storefront') + 'Paiement au point relais</span><span>' + icon('truck') + 'Retrait ou livraison</span><span>' + icon('shield-check') + 'Clients vérifiés</span></div>',
    }));

    const [h, m, sec] = untilMidnight();
    // Accueil « vitrine tech » (19/10/2026, inspiré des grandes boutiques d'électronique, mise en page propre à Zado)
    const cats = myUniverses().flatMap((u) => u.categories.map((c) => ({ u: u.name, c, list: state.products.filter((p) => p.category === c) }))).filter((x) => x.list.length);
    const href = (x) => `#/c/${enc(x.u)}/${enc(x.c)}`;
    const firstImg = (list) => list.find((p) => p.image);
    // Deux cartes à côté du carrousel : meilleure remise de deux autres rayons (photo obligatoire)
    const sideCards = [];
    for (const x of [...cats].sort((a, b) => Math.max(0, ...b.list.map(discount)) - Math.max(0, ...a.list.map(discount)))) {
      if (sideCards.length === 2) break;
      const sorted = [...x.list].sort((a, b) => discount(b) - discount(a)); const p = sorted.find((q) => q.image && q.id !== heroP?.id) || sorted.find((q) => q.id !== heroP?.id);
      if (p) sideCards.push({ x, p });
    }
    const sideCard = ({ x, p }, i) => `<a class="side-card sc-${i}" href="#/p/${p.id}">
        <span class="sc-k">${esc(x.c)}</span><b>${esc(p.name.replace(/^Apple /, ''))}</b>
        <span class="sc-price">${discount(p) ? 'Seulement ' : 'À partir de '}${fcfa(p.price)}</span><span class="sc-go">Découvrir ${icon('arrow-right')}</span>
        ${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="sc-ico">${catIcon(p.category)}</span>`}${discount(p) ? `<span class="zl">-${discount(p)} %</span>` : ''}</a>`;
    // Blocs « Explorer les rayons » : 4 vignettes par rayon + prix d'entrée
    const blocks = [...cats].sort((a, b) => b.list.length - a.list.length).slice(0, 4).map((x) => {
      const seenImg = new Set(); const pics = groupFamilies(x.list).map((g) => g[0]).filter((p) => !p.image || (!seenImg.has(p.image) && seenImg.add(p.image))).slice(0, 4); // 4 produits différents
      return `<a class="ublock" href="${href(x)}">
        <span class="ub-h"><b>${esc(x.c)}</b><small>${x.list.length} article${x.list.length > 1 ? 's' : ''} · dès ${fcfa(Math.min(...x.list.map((p) => p.price)))}</small></span>
        <span class="ub-g">${pics.map((p) => p.image ? `<span><img src="${esc(p.image)}" alt="" loading="lazy"></span>` : `<span class="ub-ico">${catIcon(p.category)}<small>${esc(familyName(p).replace(/^Apple /, ''))}</small></span>`).join('')}</span>
        <span class="ub-go">Voir le rayon ${icon('caret-right')}</span></a>`;
    }).join('');
    // Onglets « Les meilleures offres » : sélection, remises, puis deux rayons
    const picks = state.products.filter((p) => p.featured).concat(state.products.filter((p) => !p.featured && p.image), state.products.filter((p) => !p.featured && !p.image)).slice(0, 12);
    const tabs = [{ k: 'sel', label: 'Sélection Zado', ic: 'sparkle-fill', list: picks }, { k: 'deal', label: 'Bonnes affaires', ic: 'tag', list: deals }]
      .concat([...cats].sort((a, b) => b.list.length - a.list.length).slice(1, 3).map((x) => ({ k: 'c:' + x.c, label: x.c, ic: (ICONS[x.c] || 'tag').replace('-duotone', ''), list: x.list.slice(0, 12) })))
      .filter((t) => t.list.length);
    state.homeTabs = tabs;

    app.innerHTML = `
      <nav class="cat-chips" aria-label="Rayons">
        ${cats.map((x) => { const p = firstImg(x.list); return `<a href="${href(x)}"><span class="cc-img">${p ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : catIcon(x.c)}</span><span><b>${esc(x.c)}</b><small>${x.list.length} article${x.list.length > 1 ? 's' : ''}</small></span></a>`; }).join('')}
      </nav>

      <div class="hero-grid">
        <section class="hero slider" id="hero" aria-roledescription="carrousel" aria-label="Offres du moment">
          <div class="slider-track">${slides.join('')}</div>
          <button type="button" class="slider-arrow prev" data-slide="-1" aria-label="Offre précédente">${icon('caret-left')}</button>
          <button type="button" class="slider-arrow next" data-slide="1" aria-label="Offre suivante">${icon('caret-right')}</button>
          <div class="slider-dots"></div>
        </section>
        ${sideCards.length ? `<div class="hero-side">${sideCards.map(sideCard).join('')}</div>` : ''}
      </div>

      ${deals.length && state.prefs.showFlash !== false ? `<section class="shelf flash">
        <div class="shelf-head">
          <div class="fl-title"><p class="kicker">${icon('lightning-fill')} Ventes flash</p><h2>Les prix fondent aujourd'hui</h2></div>
          <div class="countdown" aria-label="Temps restant"><span>Fin dans</span><b id="cdH">${h}</b><i>h</i><b id="cdM">${m}</b><i>min</i><b id="cdS">${sec}</b><i>s</i></div>
          <a class="see-all" href="#/promos">Tout voir ${icon('caret-right')}</a>
        </div>
        ${railCarousel(deals)}
      </section>` : ''}

      <section class="relay-band">
        <div class="rb-text"><p class="kicker">${icon('storefront')} Réservez en ligne</p><h2>Payez au point relais, repartez avec</h2>
          <p>Pas besoin de carte : choisissez un point relais près de chez vous, payez-y en espèces, puis retirez votre commande ou faites-vous livrer.</p></div>
        <ol class="rb-steps"><li><b>1</b>Je réserve sur Zado</li><li><b>2</b>Je paie au point relais</li><li><b>3</b>Je repars ou je suis livré</li></ol>
        <a class="btn light" href="#/promos">Commencer mes achats ${icon('arrow-right')}</a>
      </section>

      ${blocks ? `<section class="shelf">
        <div class="shelf-head"><div><p class="kicker">${icon('squares-four')} Nos rayons</p><h2>Explorer les rayons</h2></div></div>
        <div class="ublocks">${blocks}</div>
      </section>` : ''}

      ${tabs.length ? `<section class="shelf best">
        <div class="shelf-head"><div><p class="kicker">${icon('seal-check-duotone')} Choisis pour vous</p><h2>Les meilleures offres du moment</h2></div></div>
        <div class="home-tabs" role="tablist">${tabs.map((t, i) => `<button type="button" role="tab" class="${i ? '' : 'on'}" aria-selected="${!i}" data-home-tab="${i}">${icon(t.ic)} ${esc(t.label)}</button>`).join('')}</div>
        <div id="homeTabRail">${railCarousel(tabs[0].list)}</div>
      </section>` : ''}

      <section class="trust-row" aria-label="Acheter en confiance">
        <div>${icon('truck')}<span><b>Livraison rapide</b><small>Partout à Pointe-Noire, à l'adresse ou au repère indiqué</small></span></div>
        <div>${icon('storefront')}<span><b>Paiement au point relais</b><small>En espèces, sans carte ni frais cachés</small></span></div>
        <div>${icon('shield-check')}<span><b>Achat en confiance</b><small>Clients vérifiés, code remis à la livraison</small></span></div>
        <div>${icon('chat-circle')}<span><b>Service client</b><small>Nous vous appelons après chaque commande</small></span></div>
      </section>`;

    setupSlider($('#hero'));
    app.querySelector('.home-tabs')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-home-tab]'); if (!b) return;
      app.querySelectorAll('[data-home-tab]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      $('#homeTabRail').innerHTML = railCarousel(state.homeTabs[Number(b.dataset.homeTab)].list);
    });
    state.timers.push(setInterval(() => {
      const [hh, mm, ss] = untilMidnight();
      if (!$('#cdS')) return;
      $('#cdH').textContent = hh; $('#cdM').textContent = mm; $('#cdS').textContent = ss;
    }, 1000));
  }

  // Filtres de liste (prix, marque, promo, en stock) : gardés tant qu'on reste sur la même page
  const PRICE_BANDS = [['', 'Tous les prix'], ['0-50000', 'Moins de 50 000 FCFA'], ['50000-150000', '50 000 à 150 000'], ['150000-500000', '150 000 à 500 000'], ['500000-', 'Plus de 500 000']];
  function applyFilters(list, f) {
    return list.filter((p) => {
      if (f.brand && (p.brand || '') !== f.brand) return false;
      if (f.price) { const [a, b] = f.price.split('-').map((x) => (x ? Number(x) : null)); if ((a != null && p.price < a) || (b != null && p.price >= b)) return false; }
      if (f.deal && !discount(p)) return false;
      if (f.stock && p.stock === 0) return false;
      return true;
    });
  }
  function viewList({ title, crumbs, list, active, chips, notice = '', empty = '' }) {
    renderNav(active);
    const key = location.hash;
    if (state.filterKey !== key) { state.filterKey = key; state.filters = {}; }
    const f = state.filters;
    const brands = [...new Set(list.map((p) => p.brand).filter(Boolean))].sort();
    const shown = applyFilters(list, f);
    const groups = groupFamilies(sortList(shown));
    const active2 = Object.values(f).filter(Boolean).length;
    app.innerHTML = `
      <div class="crumbs">${crumbs}</div>
      <div class="list-head">
        <h1>${esc(title)} <small style="color:var(--muted);font-weight:400;font-size:.85rem">(${groups.length} produit${groups.length > 1 ? 's' : ''})</small></h1>
        <select id="sort" aria-label="Trier">
          <option value="pertinence">Trier : pertinence</option>
          <option value="prix-asc">Prix croissant</option>
          <option value="prix-desc">Prix décroissant</option>
          <option value="remise">Meilleures remises</option>
        </select>
      </div>
      ${notice}
      ${chips || ''}
      ${list.length ? `<div class="filters" role="group" aria-label="Filtrer">
        <select data-f="price" aria-label="Prix">${PRICE_BANDS.map(([v, l]) => `<option value="${v}" ${f.price === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${brands.length > 1 ? `<select data-f="brand" aria-label="Marque"><option value="">Toutes les marques</option>${brands.map((b) => `<option ${f.brand === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>` : ''}
        <label class="fchip"><input type="checkbox" data-f="deal" ${f.deal ? 'checked' : ''}> En promo</label>
        <label class="fchip"><input type="checkbox" data-f="stock" ${f.stock ? 'checked' : ''}> Disponible</label>
        ${active2 ? '<button type="button" class="linkish" data-f-reset>Effacer les filtres</button>' : ''}
      </div>` : ''}
      ${groups.length ? `<div class="grid">${groups.map((g) => card(g[0], g)).join('')}</div>`
        : list.length ? '<p class="empty">Aucun produit avec ces filtres. <button type="button" class="linkish" data-f-reset>Effacer les filtres</button></p>'
        : (empty || '<p class="empty">Aucun produit trouvé. Essayez un autre mot-clé.</p>')}`;
    const sel = $('#sort'); sel.value = state.sort;
    sel.addEventListener('change', () => { state.sort = sel.value; route({ keep: true }); });
    app.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', () => { f[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; route({ keep: true }); }));
    app.querySelectorAll('[data-f-reset]').forEach((b) => b.addEventListener('click', () => { state.filters = {}; route({ keep: true }); }));
  }

  function viewCategory(universe, category) {
    const u = UNIVERSES.find((x) => x.name === universe);
    if (!u) return viewHome();
    const list = state.products.filter((p) => p.universe === universe && (!category || p.category === category));
    const chips = `<div class="chips">
      <a class="chip ${!category ? 'active' : ''}" href="#/c/${enc(universe)}">Tout ${esc(universe)}</a>
      ${u.categories.map((c) => `<a class="chip ${c === category ? 'active' : ''}" href="#/c/${enc(universe)}/${enc(c)}">${esc(c)}</a>`).join('')}
    </div>`;
    viewList({
      title: category || universe,
      crumbs: `<a href="#/">Accueil</a> › ${category ? `<a href="#/c/${enc(universe)}">${esc(universe)}</a> › ${esc(category)}` : esc(universe)}`,
      list, active: category || universe, chips,
    });
  }

  async function viewSearch(q) {
    $('#searchInput').value = q;
    let list = [], partial = false, fixed = null;
    try {
      const r = await fetch('/api/products?q=' + enc(q));
      list = await r.json();
      partial = r.headers.get('X-Search-Partial') === '1';
      fixed = r.headers.get('X-Search-Suggest') ? decodeURIComponent(r.headers.get('X-Search-Suggest')) : null;
    } catch {}
    const cat = searchCat();
    if (cat) list = list.filter((p) => (cat.startsWith('u:') ? p.universe === cat.slice(2) : p.category === cat.slice(2)));
    const notice = fixed && list.length ? `<p class="search-note">${icon('magnifying-glass')} Résultats pour <strong>« ${esc(fixed)} »</strong> — vous avez tapé « ${esc(q)} ».</p>`
      : partial && list.length ? `<p class="search-note">${icon('magnifying-glass')} Aucun produit ne correspond à tous vos mots : voici les plus proches.</p>` : '';
    const popular = state.products.filter((p) => p.featured || discount(p)).slice(0, 8);
    const empty = `<div class="empty-search">
        <p><strong>Aucun produit pour « ${esc(q)} ».</strong> Vérifiez l'orthographe, essayez un mot plus simple (ex. « téléphone », « écouteurs »), ou parcourez un rayon :</p>
        <div class="chips">${UNIVERSES.flatMap((u) => u.categories.map((c) => `<a class="chip" href="#/c/${enc(u.name)}/${enc(c)}">${esc(c)}</a>`)).join('')}</div>
        <p class="hint">Vous ne trouvez pas ? Écrivez-nous dans « Aide » : nous vous répondons.</p>
        ${popular.length ? `<h2 style="margin-top:22px">Nos produits du moment</h2><div class="grid">${cardsOf(popular)}</div>` : ''}
      </div>`;
    viewList({ title: `Résultats pour « ${q} »`, crumbs: '<a href="#/">Accueil</a> › Recherche', list, active: null, notice, empty });
  }

  function viewPromos() {
    viewList({ title: 'Bonnes affaires', crumbs: '<a href="#/">Accueil</a> › Bonnes affaires', list: state.products.filter((p) => discount(p) > 0), active: 'promos' });
  }

  // Crédit obligatoire des photos sous licence libre (Wikimedia Commons) : auteur, licence, source.
  function photoCredit(p) {
    const c = p.imageCredit;
    if (!c) return '';
    return `<p class="photo-credit">Photo d'illustration · <a href="${esc(c.source)}" target="_blank" rel="noopener">${esc(c.author)}</a>,
      ${c.licenseUrl ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener">${esc(c.license)}</a>` : esc(c.license)}, via Wikimedia Commons</p>`;
  }

  // Page « Crédits photos » : toutes les photos libres utilisées, avec leurs auteurs et licences
  function viewCredits() {
    renderNav(null);
    const byImage = new Map();
    for (const p of state.products) if (p.imageCredit && !byImage.has(p.image)) byImage.set(p.image, p);
    app.innerHTML = `
      <div class="panel">
        <h1>Crédits photos</h1>
        <p class="hint">Les photos de produits ci-dessous sont publiées sous licence libre sur Wikimedia Commons par leurs auteurs. Ce sont des photos d'illustration : le modèle est le même, la couleur ou les accessoires peuvent différer.</p>
        <div class="credits">
          ${[...byImage.values()].map((p) => `
            <div class="credit-row">
              <img src="${esc(p.image)}" alt="" loading="lazy" width="64" height="64">
              <span><strong>${esc(p.name.replace(/^Apple /, ''))}</strong><br>
              <span class="hint"><a href="${esc(p.imageCredit.source)}" target="_blank" rel="noopener">${esc(p.imageCredit.author)}</a> · ${p.imageCredit.licenseUrl ? `<a href="${esc(p.imageCredit.licenseUrl)}" target="_blank" rel="noopener">${esc(p.imageCredit.license)}</a>` : esc(p.imageCredit.license)}</span></span>
            </div>`).join('') || '<p class="empty">Aucune photo sous licence libre pour le moment.</p>'}
        </div>
      </div>`;
  }

  // Avis clients de la fiche produit (+ formulaire pour un client qui a reçu ce produit)
  async function loadReviews(p) {
    const box = $('#reviews'); if (!box) return;
    let d;
    try { d = await api('/products/' + enc(p.id) + '/reviews'); } catch { box.remove(); return; }
    if (!box.isConnected) return;
    const mine = d.mine;
    const formHtml = mine?.can ? `
      <form class="review-form panel" id="reviewForm">
        <h3>${mine.review ? 'Modifier mon avis' : 'Donner mon avis'}</h3>
        <div class="star-pick" role="radiogroup" aria-label="Votre note">${[5, 4, 3, 2, 1].map((n) /* ordre inversé + row-reverse : survol et choix colorent les étoiles de gauche */ => `<label><input type="radio" name="rating" value="${n}" ${mine.review?.rating === n ? 'checked' : ''}><i title="${n} sur 5"></i></label>`).join('')}</div>
        <label for="rvText">Votre commentaire <span class="hint">(facultatif)</span></label>
        <textarea id="rvText" rows="3" maxlength="1000" placeholder="Qualité, livraison, conformité…">${esc(mine.review?.text || '')}</textarea>
        <div id="rvMsg"></div>
        <button class="btn cta">${mine.review ? 'Mettre à jour' : 'Publier mon avis'}</button>
        <p class="hint">Publié avec votre prénom et l'initiale de votre nom.</p>
      </form>` : '';
    if (!d.count && !formHtml) { box.innerHTML = `<h2>Avis clients</h2><p class="hint">Pas encore d'avis. Seuls les clients qui ont reçu ce produit peuvent en donner un.</p>`; return; }
    box.innerHTML = `
      <h2>Avis clients</h2>
      ${d.count ? `<div class="rv-sum"><div class="rv-avg"><b>${String(d.avg).replace('.', ',')}</b>${stars(d.avg, 'lg')}<small>${d.count} avis · achats vérifiés</small></div>
        <div class="rv-dist">${d.dist.map((n, i) => `<div><span>${5 - i} ${icon('star-fill')}</span><i><b style="width:${d.count ? Math.round((n / d.count) * 100) : 0}%"></b></i><small>${n}</small></div>`).join('')}</div></div>` : ''}
      ${formHtml}
      ${d.list.map((r) => `<article class="rv"><div class="rv-head">${stars(r.rating)}<strong>${esc(r.name)}</strong><span class="verified">${icon('seal-check-duotone')} Achat vérifié</span><small>${new Date(r.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</small></div>${r.text ? `<p>${esc(r.text).replace(/\n/g, '<br>')}</p>` : ''}</article>`).join('')}`;
    $('#reviewForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rating = e.target.rating.value;
      if (!rating) { $('#rvMsg').innerHTML = `<p class="field-err">${icon('warning-duotone')} Choisissez une note (1 à 5 étoiles).</p>`; return; }
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try { await api('/account/reviews', { method: 'POST', body: { productId: p.id, rating: Number(rating), text: $('#rvText').value } }); toast('Merci pour votre avis !'); loadReviews(p); }
      catch (err) { $('#rvMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; btn.disabled = false; }
    });
  }

  // Description en paragraphes (ligne vide = nouveau paragraphe)
  const richText = (t) => String(t || '').split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  // « En détail » : points forts, réparabilité, vidéo d'analyse, prix constatés en France (décision Joseph 21/10/2026)
  const REPAIR = { fr: ['Indice de réparabilité', '/10'], eu: ['Classe de réparabilité (UE)', ''], ifixit: ['Note de réparabilité iFixit', '/10'] };
  const repairLevel = (r) => { if (r.kind === 'eu') return { A: 5, B: 4, C: 3, D: 2, E: 1 }[r.value] || 0; const n = Number(r.value); return n >= 8 ? 5 : n >= 6.5 ? 4 : n >= 5 ? 3 : n >= 3 ? 2 : 1; };
  function detailSection(p) {
    const hl = p.highlights || [], r = p.repair, v = p.video, refs = p.priceRefs || [];
    if (!hl.length && !r && !v && !refs.length) return '';
    const eurFcfa = 655.957;
    const cards = [];
    if (hl.length) cards.push(`<div class="dt-card dt-hl"><h3>${icon('sparkle')} Points forts</h3><ul>${hl.map((x) => `<li>${icon('check-circle-duotone')}<span>${esc(x)}</span></li>`).join('')}</ul></div>`);
    if (r) {
      const [label, unit] = REPAIR[r.kind] || ['Réparabilité', ''], lvl = repairLevel(r);
      cards.push(`<div class="dt-card dt-repair"><h3>${icon('wrench')} Réparabilité</h3>
        <div class="dt-score lv${lvl}"><b>${esc(String(r.value).replace('.', ','))}</b><small>${esc(unit)}</small></div>
        <p class="dt-sub">${esc(label)}</p>
        <div class="dt-gauge" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= lvl ? 'on lv' + lvl : ''}"></i>`).join('')}</div>
        ${r.note ? `<p class="dt-note">${esc(r.note)}</p>` : ''}
        ${r.url ? `<a class="dt-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Voir la source ${icon('arrow-square-out-bold')}</a>` : ''}</div>`);
    }
    if (v) cards.push(`<a class="dt-card dt-video" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">
        <h3>${icon('youtube-logo')} L'avis d'un expert en vidéo</h3>
        <span class="dt-play">${icon('play-circle')}</span>
        <b>${esc(v.title || 'Voir l\'analyse du produit')}</b>${v.channel ? `<small>${esc(v.channel)} · YouTube</small>` : '<small>YouTube</small>'}
        <span class="dt-link">Regarder sur YouTube ${icon('arrow-square-out-bold')}</span></a>`);
    if (refs.length) {
      const low = Math.min(...refs.map((x) => x.priceEur));
      cards.push(`<div class="dt-card dt-prices"><h3>${icon('storefront')} Prix constatés en France</h3>
        <table>${refs.map((x) => `<tr><th>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(x.store)}</a>` : esc(x.store)}</th><td>${x.from ? '<small>dès </small>' : ''}${x.priceEur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €<small>≈ ${fcfa(Math.round(x.priceEur * eurFcfa))}</small></td></tr>`).join('')}</table>
        <p class="dt-note">Prix publics TTC en France${refs.some((x) => x.date) ? `, relevés le ${esc(new Date(refs.map((x) => x.date).filter(Boolean).sort().pop()).toLocaleDateString('fr-FR'))}` : ''}, hors frais d'acheminement jusqu'à Pointe-Noire. Chez Zado : <b>${fcfa(p.price)}</b>, produit déjà sur place, facture et garantie.</p></div>`);
    }
    return `<section class="dt"><div class="shelf-head"><div><p class="kicker">${esc(p.brand || p.category)}</p><h2>En détail</h2></div></div><div class="dt-grid">${cards.join('')}</div></section>`;
  }

  function viewProduct(id) {
    const p = byId(id);
    if (!p) return viewHome();
    renderNav(p.category);
    const d = discount(p);
    const similar = state.products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 10);
    app.innerHTML = `
      <div class="crumbs"><a href="#/">Accueil</a> › <a href="#/c/${enc(p.universe)}">${esc(p.universe)}</a> › <a href="#/c/${enc(p.universe)}/${enc(p.category)}">${esc(p.category)}</a></div>
      <div class="pdp">
        <div>
          <div class="pdp-main">${visual(p)}${d ? `<span class="disc">-${d}%</span>` : ''}${photoCredit(p)}</div></div>
          ${(p.images || []).length > 1 ? `<div class="pdp-thumbs">${p.images.map((src, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-img="${esc(src)}" aria-label="Photo ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        </div>
        <div>
          <h1>${esc(p.name)}</h1>
          ${p.provenance || p.sourceSupplier ? `<div class="origin-row">${p.provenance ? `<span>${icon('airplane-tilt')} Provenance : <b>${esc(p.provenance)}</b></span>` : ''}${p.sourceSupplier ? `<span>${icon('seal-check-duotone')} Fournisseur : <b>${esc(p.sourceSupplier)}</b></span>` : ''}</div>` : ''}
          <div class="pdp-meta">${p.rating ? `<a href="#reviews" class="rating-link" data-scroll="reviews">${ratingLine(p.rating)}</a>` : ''}<button type="button" class="share-btn" id="shareBtn">${icon('export')} Partager</button></div>
          ${(() => { const sib = siblings(p); return sib.length > 1 ? `<div class="color-pick"><span class="lbl">Couleur : <b>${esc(colorOf(p)?.label || '')}</b></span><div>${sib.map((x) => `<a href="#/p/${enc(x.id)}" class="${x.id === p.id ? 'on' : ''}" title="${esc(colorOf(x)?.label || x.name)}" aria-label="${esc(colorOf(x)?.label || x.name)}"><i style="background:${colorOf(x)?.hex || '#ccc'}"></i></a>`).join('')}</div></div>` : ''; })()}
          ${p.condition && p.condition !== 'neuf' ? `<span class="cond-tag">${esc(p.condition === 'reconditionné' ? 'Reconditionné' : 'Occasion')}</span>` : ''}
          ${richText(p.description)}
          ${(p.specs || []).length ? `<table class="specs">${p.specs.map((x) => `<tr><th>${esc(x.label)}</th><td>${esc(x.value)}</td></tr>`).join('')}</table>` : ''}
          <div class="buybox">
            ${d ? `<div><span class="old">${fcfa(p.oldPrice)}</span> <span class="save-tag">Économisez ${fcfa(p.oldPrice - p.price)}</span></div>` : ''}
            <span class="price">${fcfa(p.price)}</span>
            ${(p.options || []).map((o, i) => `<label class="opt-label" for="opt${i}">${esc(o.name)}</label><div class="opt-choices" id="opt${i}" data-opt="${esc(o.name)}">${o.values.map((v) => `<button type="button" class="opt" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>`).join('')}
            <span class="momo-note">${icon('check-circle-duotone')} Payable en espèces au point relais · retrait ou livraison</span>
            <span class="hint">${icon('truck-duotone')} Livraison rapide à Pointe-Noire</span>
            ${p.stock === 0 ? '<span class="stock-low">Épuisé</span>' : p.stock <= 6 ? `<span class="stock-low">Plus que ${p.stock} en stock</span>` : '<span class="momo-note">En stock</span>'}
            <div id="optErr"></div>
            <button class="btn cta block" ${(p.options || []).length ? 'id="addOpt"' : `data-add="${p.id}"`} ${p.stock === 0 ? 'disabled' : ''}>Ajouter au panier</button>
            <a class="btn ghost block" href="#/commande" id="buyNow">Acheter maintenant</a>
            ${accountHint('pdp')}
          </div>
          <div class="buybar"><span><small>${esc(p.name)}</small><b>${fcfa(p.price)}</b></span><button class="btn cta" type="button" id="buybarAdd" ${p.stock === 0 ? 'disabled' : ''}>${p.stock === 0 ? 'Épuisé' : 'Ajouter au panier'}</button></div>
        </div>
      </div>
      ${detailSection(p)}
      <section class="reviews" id="reviews"></section>
      ${similar.length ? `<section class="shelf"><div class="shelf-head"><div><p class="kicker">${esc(p.category)}</p><h2>Vous aimerez aussi</h2></div></div>${railCarousel(similar)}</section>` : ''}`;
    loadReviews(p);
    app.querySelector('[data-scroll="reviews"]')?.addEventListener('click', (e) => { e.preventDefault(); $('#reviews').scrollIntoView({ behavior: 'smooth' }); });
    // Partager (WhatsApp…) : le lien /p/<id> donne un aperçu avec photo, nom et prix
    $('#shareBtn').addEventListener('click', async () => {
      const url = `${location.origin}/p/${enc(p.id)}`;
      const text = `${p.name} à ${fcfa(p.price)} sur Zado`;
      if (navigator.share) { try { await navigator.share({ title: p.name, text, url }); return; } catch (err) { if (err?.name === 'AbortError') return; } }
      window.open(`https://wa.me/?text=${enc(text + '\n' + url)}`, '_blank', 'noopener');
    });
    // Choix couleur / taille : un bouton par valeur
    const sel = {};
    app.querySelectorAll('.opt-choices').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('.opt'); if (!b) return;
      sel[g.dataset.opt] = b.dataset.v;
      g.querySelectorAll('.opt').forEach((x) => x.classList.toggle('on', x === b));
      $('#optErr').innerHTML = '';
    }));
    const missing = () => (p.options || []).find((o) => !sel[o.name]);
    const addWithChoice = () => {
      const m = missing();
      if (m) { $('#optErr').innerHTML = `<div class="alert err">Choisissez : ${esc(m.name)}</div>`; return false; }
      addToCart(p.id, { ...sel }); return true;
    };
    // Barre d'achat fixe (téléphone) : même effet que le bouton principal ; cachée quand le bouton principal est à l'écran
    const mainAdd = app.querySelector('.buybox .btn.cta.block'), bar = app.querySelector('.buybar');
    if (mainAdd && bar && 'IntersectionObserver' in window) new IntersectionObserver(([en]) => bar.classList.toggle('off', en.isIntersecting), { rootMargin: '0px 0px -130px 0px' }).observe(mainAdd);
    $('#buybarAdd')?.addEventListener('click', () => {
      if ((p.options || []).length) { if (!addWithChoice()) { $('#optErr').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; } added(); return; }
      addToCart(p.id); added();
    });
    $('#addOpt')?.addEventListener('click', (e) => {
      if (!addWithChoice()) return;
      added();
      const b = e.currentTarget; const label = b.innerHTML; b.innerHTML = `${icon('check-bold')} Ajouté`; setTimeout(() => (b.innerHTML = label), 1200);
    });
    $('#buyNow').addEventListener('click', (e) => {
      if ((p.options || []).length) { if (!addWithChoice()) e.preventDefault(); return; }
      if (!state.cart[p.id]) addToCart(p.id);
    });
    // Galerie : cliquer sur une miniature change la photo principale (le crédit ne vaut que pour la photo d'origine)
    app.querySelectorAll('[data-img]').forEach((b) => b.addEventListener('click', () => {
      const img = app.querySelector('.pdp-main img');
      if (img) img.src = b.dataset.img;
      const credit = app.querySelector('.photo-credit');
      if (credit) credit.hidden = b.dataset.img !== p.image;
      app.querySelectorAll('[data-img]').forEach((x) => x.classList.toggle('on', x === b));
    }));
  }

  // Bouton « Annuler ma réservation » (page de suivi) : tant que rien n'est payé
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('#orderCancel'); if (!b) return;
    const id = currentParts()[1];
    if (!confirm('Annuler cette commande ? Les articles ne seront plus réservés pour vous.')) return;
    b.disabled = true;
    try {
      await api('/orders/' + enc(id) + '/cancel', { method: 'POST', headers: orderHeaders(tokenOf(id) || ''), body: {} });
      const c = loadCheckout(); if (c?.orderId === id) saveCheckout(null);
      toast('Commande annulée');
      route({ keep: true });
    } catch (err) { alert(err.message); b.disabled = false; }
  });

  // Bouton « Changer de point relais » (page de suivi)
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#relayChange')) return;
    const id = currentParts()[1];
    const box = $('#relayChangeBox'); if (!box) return;
    let methods; try { methods = await api('/payments/methods'); } catch { return; }
    let o; try { o = await api('/orders/' + enc(id), { headers: orderHeaders(tokenOf(id) || '') }); } catch { return; }
    box.innerHTML = '<div class="panel" style="margin-top:10px"><h3 style="margin-top:0">Choisissez votre nouveau point relais</h3><div id="relayPick2"></div><div id="relayMsg"></div></div>';
    $('#relayChange').hidden = true;
    relayPicker($('#relayPick2'), methods.agencies, o.agency?.id, async (agencyId) => {
      if (agencyId === o.agency?.id) return;
      try {
        await api('/orders/' + enc(id) + '/relay', { method: 'POST', headers: orderHeaders(tokenOf(id) || ''), body: { agencyId } });
        $('#relayMsg').innerHTML = `<div class="alert ok">${icon('check-circle-duotone')} Point relais changé. Zado est prévenu.</div>`;
        setTimeout(() => route({ keep: true }), 1200);
      } catch (err) { $('#relayMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    }, o.agency?.city);
  });

  // ---------- Choix du point relais sur une carte (commande, et changement après commande) ----------
  const RELAY_KIND = { agency: 'Agence Zado', partner: 'Point relais partenaire' };
  const defaultRelay = (list, city) => list.find((a) => a.id === state.prefs.relayId) || list.find((a) => a.city === city) || list[0];
  function relayPicker(host, list, selected, onPick, city) {
    let me = null; let map = null; let L = null; const markers = {};
    host.innerHTML = `<div class="kmap" id="relayMap"></div>
      <div class="relay-tools"><button type="button" class="btn ghost small" id="relayNear">${icon('map-pin-bold')} Les plus proches de moi</button></div>
      <div class="relay-list" id="relayList" role="listbox" aria-label="Points relais"></div>`;
    const sorted = () => (me ? [...list].sort((a, b) => (kamwaMap.hasPos(a) ? kamwaMap.distanceKm(me, a) : 1e9) - (kamwaMap.hasPos(b) ? kamwaMap.distanceKm(me, b) : 1e9)) : list);
    const renderList = () => {
      host.querySelector('#relayList').innerHTML = sorted().map((a) => `
        <button type="button" class="relay-card ${a.id === selected ? 'on' : ''}" data-relay="${esc(a.id)}" role="option" aria-selected="${a.id === selected}">
          ${icon(a.kind === 'partner' ? 'storefront' : 'map-pin')}
          <span><b>${esc(a.name)}</b><small>${esc(RELAY_KIND[a.kind || 'agency'])} · ${esc(a.city)}${a.address ? ' · ' + esc(a.address) : ''}${a.hours ? '<br>' + esc(a.hours) : ''}</small></span>
          ${me && kamwaMap.hasPos(a) ? `<span class="dist">${kamwaMap.distanceKm(me, a).toFixed(1).replace('.', ',')} km</span>` : ''}
        </button>`).join('');
    };
    const pick = (id, pan) => {
      selected = id; renderList(); onPick(id);
      if (map) {
        Object.entries(markers).forEach(([k, m]) => m.setIcon(kamwaMap.pin(L, k === id ? 'relay on' : 'relay')));
        const a = list.find((x) => x.id === id);
        if (pan && kamwaMap.hasPos(a)) map.setView([a.lat, a.lng], Math.max(map.getZoom(), 15));
      }
    };
    renderList();
    host.querySelector('#relayList').addEventListener('click', (e) => { const b = e.target.closest('[data-relay]'); if (b) pick(b.dataset.relay, true); });
    const placed = list.filter((a) => kamwaMap.hasPos(a));
    if (!placed.length) { host.querySelector('#relayMap').remove(); }
    else kamwaMap.create(host.querySelector('#relayMap'), { city }).then((r) => {
      ({ L, map } = r);
      for (const a of placed) {
        markers[a.id] = L.marker([a.lat, a.lng], { icon: kamwaMap.pin(L, a.id === selected ? 'relay on' : 'relay'), title: a.name }).addTo(map)
          .bindPopup(`<b>${esc(a.name)}</b><br><span style="color:#5F6B80">${esc(RELAY_KIND[a.kind || 'agency'])}</span><br>${esc(a.address || '')}${a.hours ? '<br>' + esc(a.hours) : ''}<br><button type="button" class="btn cta small" data-relay-pop="${esc(a.id)}">Choisir ce point relais</button>`);
      }
      const inCity = placed.filter((a) => a.city === city);
      map.fitBounds(L.featureGroup((inCity.length ? inCity : placed).map((a) => markers[a.id])).getBounds().pad(0.25), { maxZoom: 15 });
      map.on('popupopen', (e) => e.popup.getElement().querySelector('[data-relay-pop]')?.addEventListener('click', (ev) => { pick(ev.target.dataset.relayPop); map.closePopup(); }));
    }).catch(() => host.querySelector('#relayMap')?.remove());
    host.querySelector('#relayNear').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        me = await kamwaMap.locate();
        const best = sorted().find((a) => kamwaMap.hasPos(a));
        if (map) { L.marker([me.lat, me.lng], { icon: kamwaMap.pin(L, 'me') }).addTo(map); }
        if (best) pick(best.id, true); else renderList();
      } catch (err) { toastMsg(err.message); }
      e.target.disabled = false;
    });
  }
  const toastMsg = (m) => toast(m);

  async function viewCheckout() {
    renderNav(null);
    const items = cartItems();
    if (!items.length) { location.hash = '#/'; return; }

    // Un paiement était en cours pour ce panier (page rechargée, retour de la page carte…) : on reprend.
    const current = loadCheckout();
    if (current?.paymentId && current.cartKey === cartKey()) {
      try {
        const p = await api('/payments/' + enc(current.paymentId));
        if (p.status === 'PENDING' && p.operator !== 'cash') return viewWaiting(current, p, p.operator !== 'card');
        if (p.status === 'SUCCESSFUL') return finishPaid(current);
        if (p.status === 'FAILED' && p.operator === 'card') { saveCheckout({ ...current, paymentId: null }); return viewFailed(p); }
      } catch {}
    }
    // Moyens de paiement disponibles (les espèces seulement s'il existe une agence)
    let methods = { momo: true, card: false, cash: false, agencies: [] };
    try { methods = await api('/payments/methods'); } catch {}

    // Compte vérifié obligatoire pour commander (le panier reste gardé en attendant)
    if (methods.accountRequired) {
      await refreshCustomer(); // l'admin a peut-être validé la pièce depuis la dernière visite
      const c = state.customer;
      const st = c ? (c.idStatus || 'missing') : null;
      if (st !== 'verified') {
        app.innerHTML = `
          <div class="panel gate" style="max-width:620px;margin:0 auto;text-align:center">
            <div class="big-check">${icon(c ? 'clock-countdown-duotone' : 'identification-card-duotone')}</div>
            ${!c ? `<h1>Un compte Zado est nécessaire pour commander</h1>
              <p class="hint">Pour lutter contre les fausses commandes, chaque client crée son compte avec la photo de sa pièce d'identité (passeport, CNI ou NIU). Zado la vérifie, puis vous pouvez commander. Votre panier est gardé.</p>
              <a class="btn cta block" href="#/compte/creer">Créer mon compte</a>
              <a class="btn ghost block" href="#/compte" style="margin-top:10px">J'ai déjà un compte : me connecter</a>`
            : st === 'pending' ? `<h1>Votre identité est en cours de vérification</h1>
              <p class="hint">Zado vérifie votre pièce d'identité (en général en 1 minute). Vous pourrez commander dès qu'elle sera validée : votre panier vous attend.</p>
              <a class="btn ghost block" href="#/compte">Voir mon compte</a>`
            : `<h1>Pièce d'identité ${st === 'rejected' ? 'refusée' : 'manquante'}</h1>
              <p class="hint">${st === 'rejected' && c.idRejectReason ? `Motif : ${esc(c.idRejectReason)}. ` : ''}Envoyez la photo de votre pièce d'identité depuis votre compte pour pouvoir commander.</p>
              <a class="btn cta block" href="#/compte">Envoyer ma pièce</a>`}
          </div>`;
        return;
      }
    }
    if (!methods.momo && !methods.card && !methods.cash && !methods.cod?.enabled) {
      app.innerHTML = '<div class="panel empty">Aucun point relais n\'est ouvert pour le moment : la commande n\'est pas possible. Revenez bientôt ou contactez-nous.</div>';
      return;
    }

    const saved = (() => { try { return JSON.parse(localStorage.getItem('kamwa-customer')) || {}; } catch { return {}; } })();
    if (state.customer) {
      saved.name = saved.name || state.customer.name;
      saved.phone = saved.phone || state.customer.phone || '';
    }
    const total = fcfa(cartTotal());

    app.innerHTML = `
      <h1>Finaliser ma commande</h1>
      ${state.config.paymentMode === 'simulation' && (methods.momo || methods.card)
        ? '<div class="sim">Mode test : aucun argent n\'est débité. Mobile Money : un numéro finissant par 000 simule un refus. Carte : une page de test vous laisse accepter ou refuser.</div>' : ''}
      <div class="checkout">
        <form class="panel" id="checkoutForm" novalidate>
          <h2>1. Vos coordonnées</h2>
          <label for="name">Nom complet</label>
          <input id="name" name="name" autocomplete="name" required value="${esc(saved.name)}">
          <label for="phone">Téléphone (contact)</label>
          <input id="phone" name="phone" type="tel" inputmode="tel" placeholder="06 123 45 67" required value="${esc(saved.phone)}">
          <div id="deliveryFields">
            <label for="city">Ville de livraison</label>
            <select id="city" name="city">
              ${deliveryCities().map((c) => `<option ${saved.city === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
            <div id="zoneBox" hidden><label for="zone">Quartier</label><select id="zone" name="zone"></select></div>
            ${feeCfg().other.allowed ? '' : `<p class="hint">Livraison à ${esc(deliveryCities().join(', '))} uniquement pour le moment. Ailleurs, choisissez le retrait au point relais.</p>`}
            <label for="address">Quartier / adresse / repère</label>
            <textarea id="address" name="address" rows="2" placeholder="Ex. Quartier Tié-Tié, près de la pharmacie…">${esc(saved.address)}</textarea>
            <label>Votre adresse sur la carte <span class="hint">(conseillé)</span></label>
            <p class="hint" style="margin:0 0 6px">Touchez la carte à l'endroit exact de livraison : le livreur vous trouve plus vite et vous le suivez en direct.</p>
            <div class="kmap" id="homeMap" style="height:240px"></div>
            <div class="relay-tools"><button type="button" class="btn ghost small" id="homeLocate">${icon('map-pin-bold')} Je suis à l'adresse de livraison</button><span class="hint" id="homeTxt"></span></div>
          </div>

          <h2 style="margin-top:24px">2. Paiement</h2>
          <div class="methods">
            ${methods.momo ? `<label class="op"><input type="radio" name="method" value="momo"><span>${icon('device-mobile-duotone')}<span class="txt">Mobile Money<small>MTN MoMo · Airtel Money</small></span></span></label>` : ''}
            ${methods.card ? `<label class="op"><input type="radio" name="method" value="card"><span>${icon('credit-card-duotone')}<span class="txt">Carte bancaire<small>Visa · Mastercard</small></span></span></label>` : ''}
            ${methods.cod?.enabled ? `<label class="op"><input type="radio" name="method" value="cod"><span>${icon('hand-coins-duotone')}<span class="txt">Payer à la réception<small>Espèces ou Mobile Money au livreur${methods.cod.deposit ? ` · acompte de ${fcfa(methods.cod.deposit)} pour confirmer` : ''}</small></span></span></label>` : ''}
            ${methods.cash ? `<label class="op"><input type="radio" name="method" value="cash"><span>${icon('storefront-duotone')}<span class="txt">Espèces au point relais<small>Vous payez au point relais choisi sur la carte, puis retrait sur place ou livraison</small></span></span></label>` : ''}
          </div>

          <div id="momoFields">
            <div class="operators">
              <label class="op mtn"><input type="radio" name="operator" value="mtn" checked><span class="dot"></span>MTN MoMo</label>
              <label class="op airtel"><input type="radio" name="operator" value="airtel"><span class="dot"></span>Airtel Money</label>
            </div>
            <label for="momo">Numéro Mobile Money à débiter</label>
            <input id="momo" name="momo" type="tel" inputmode="tel" placeholder="06 123 45 67" value="${esc(saved.phone)}">
            <p class="hint">MTN : numéros en 06 · Airtel : numéros en 05 ou 04</p>
          </div>
          <div id="codFields" hidden>
            <p class="hint cod-hint">${icon('check-circle-duotone')} <span>Vous payez <strong>à la livraison</strong>, en espèces ou en Mobile Money, après avoir vérifié votre colis.
            ${methods.cod?.deposit ? `Pour confirmer une première commande, un <strong>acompte de ${fcfa(methods.cod.deposit)}</strong> est demandé en Mobile Money (déduit du total). Il est offert aux clients fidèles. En cas de refus du colis, il couvre le déplacement du livreur.` : ''}</span></p>
          </div>
          <div id="cardFields" hidden>
            <p class="hint">${icon('lock-key-bold')} Vous allez être redirigé vers la page de paiement sécurisée de notre partenaire bancaire. Zado ne voit jamais votre numéro de carte.</p>
          </div>
          <div id="cashFields" hidden>
            <p class="lbl" style="margin-top:4px">Point relais : où payer (et retirer votre colis)</p>
            <input type="hidden" name="agency" id="agency" value="${esc(defaultRelay(methods.agencies, saved.city)?.id || '')}">
            <div id="relayPick"></div>
            <p class="hint" id="agencyInfo"></p>
            <p class="lbl">Comment recevoir votre commande ?</p>
            <div class="methods two">
              <label class="op"><input type="radio" name="receive" value="pickup" checked><span>${icon('storefront-duotone')}<span class="txt">Retrait au point relais<small>Vous payez et repartez avec</small></span></span></label>
              <label class="op"><input type="radio" name="receive" value="delivery"><span>${icon('truck-duotone')}<span class="txt">Livraison à domicile<small>Après votre paiement à l'agence</small></span></span></label>
            </div>
            <p class="hint" id="cashHint"></p>
          </div>
          <div id="formError"></div>
          <button class="btn cta block" style="margin-top:16px;min-height:48px;font-size:1rem" id="payBtn">Payer ${total}</button>
        </form>

        <div class="panel">
          <h2>Récapitulatif</h2>
          ${items.map(({ product: p, qty, variant }) => `<div class="line"><span>${qty} × ${esc(p.name)}${variant ? `<br><span class="hint">${esc(variantText(variant))}</span>` : ''}</span><strong>${fcfa(p.price * qty)}</strong></div>`).join('')}
          ${cartSaving() > 0 ? `<div class="row saving" style="margin-top:10px"><span>Vous économisez</span><span>${fcfa(cartSaving())}</span></div>` : ''}
          <div class="row" style="margin-top:10px"><span>Livraison</span><span id="feeLine">—</span></div>
          <div class="row total" style="margin-top:10px"><span>Total</span><strong id="sumTotal">${total}</strong></div>
        </div>
      </div>`;

    const form = $('#checkoutForm');
    // Frais de livraison : même calcul que le serveur (qui recalcule de toute façon au paiement)
    const zoneSync = () => {
      const zones = cityFees(form.city.value)?.zones || [];
      $('#zoneBox').hidden = !zones.length;
      if (zones.length && form.zone.dataset.city !== form.city.value) {
        form.zone.innerHTML = `<option value="">Autre quartier</option>` + zones.map((z) => `<option ${saved.zone === z.name ? 'selected' : ''}>${esc(z.name)}</option>`).join('');
        form.zone.dataset.city = form.city.value;
      }
    };
    const fee = () => (method() === 'cash' && receive() === 'pickup' ? 0 : deliveryFee(form.city.value, $('#zoneBox').hidden ? '' : form.zone.value, cartTotal()));
    const grand = () => fcfa(cartTotal() + (fee() || 0));
    const BTN = { momo: () => `Payer ${grand()}`, card: () => `Payer ${grand()} par carte`, cash: () => 'Réserver et payer au point relais', cod: () => 'Confirmer ma commande' };
    const BUTTON = new Proxy({}, { get: (_, k) => BTN[k]?.() });
    const showFee = () => {
      const f = fee();
      $('#feeLine').innerHTML = method() === 'cash' && receive() === 'pickup' ? 'Gratuite (retrait)' : f == null ? 'Non disponible : retrait au point relais' : f ? fcfa(f) : '<span class="ok-txt">Offerte</span>';
      $('#sumTotal').textContent = grand();
    };
    // Point de livraison placé par le client (gardé sur ce téléphone pour la prochaine fois)
    let homePos = saved.location && kamwaMap.hasPos(saved.location) ? saved.location : null;
    let homeMap = null;
    const showHome = () => { $('#homeTxt').textContent = homePos ? 'Adresse placée ✓' : 'Pas encore placée'; };
    function initHomeMap() {
      if (homeMap) { homeMap.map.invalidateSize(); return; }
      homeMap = {};
      kamwaMap.create($('#homeMap'), { center: homePos && [homePos.lat, homePos.lng], zoom: homePos ? 17 : 13, city: form.city?.value }).then(({ L, map }) => {
        homeMap = { L, map };
        let mk = null;
        const place = (p, pan) => {
          homePos = { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
          if (!mk) { mk = L.marker([homePos.lat, homePos.lng], { draggable: true, icon: kamwaMap.pin(L, 'home') }).addTo(map); mk.on('dragend', () => place(mk.getLatLng())); }
          else mk.setLatLng([homePos.lat, homePos.lng]);
          if (pan) map.setView([homePos.lat, homePos.lng], 17);
          showHome();
        };
        if (homePos) place(homePos);
        map.on('click', (e) => place(e.latlng));
        $('#homeLocate').addEventListener('click', async () => { try { place(await kamwaMap.locate(), true); } catch (err) { alert(err.message); } });
        form.city?.addEventListener('change', () => { if (!homePos && kamwaMap.CITIES[form.city.value]) map.setView(kamwaMap.CITIES[form.city.value], 13); });
      }).catch(() => { $('#homeMap')?.remove(); });
      showHome();
    }
    const method = () => form.method.value || 'cash';
    const receive = () => (form.receive?.value === 'delivery' ? 'delivery' : 'pickup');
    // Premier moyen proposé coché par défaut
    if (!form.querySelector('input[name="method"]:checked')) { const first = form.querySelector('input[name="method"]'); if (first) first.checked = true; }
    // Affiche les champs du moyen de paiement choisi (pas d'adresse de livraison pour un retrait en agence)
    const syncMethod = () => {
      const m = method();
      $('#momoFields').hidden = !(m === 'momo' || (m === 'cod' && methods.cod?.deposit));
      $('#codFields').hidden = m !== 'cod';
      const momoLbl = form.querySelector('label[for="momo"]');
      if (momoLbl) momoLbl.textContent = m === 'cod' ? "Numéro Mobile Money pour l'acompte" : 'Numéro Mobile Money à débiter';
      $('#cardFields').hidden = m !== 'card';
      $('#cashFields').hidden = m !== 'cash';
      $('#deliveryFields').hidden = m === 'cash' && receive() === 'pickup';
      if (!$('#deliveryFields').hidden) initHomeMap();
      if (m === 'cash') $('#cashHint').innerHTML = receive() === 'pickup'
          ? `Vos articles sont réservés <strong>${methods.pickupHoldHours} h</strong>. Vous payez <strong>${grand()}</strong> en espèces au point relais et repartez avec votre commande.`
          : `Vos articles sont réservés <strong>${methods.pickupHoldHours} h</strong>. Vous payez <strong>${grand()}</strong> en espèces au point relais (livraison comprise), puis nous vous livrons à l'adresse indiquée (code de livraison à donner au livreur).`;
      $('#payBtn').textContent = BUTTON[m];
      showFee();
      const a = methods.agencies.find((x) => x.id === form.agency?.value);
      if (a) $('#agencyInfo').innerHTML = `<strong>${esc(a.name)}</strong><br>${icon('map-pin-bold')} ${esc(a.address || 'Adresse communiquée par téléphone')}${a.hours ? `<br>${icon('clock-bold')} ` + esc(a.hours) : ''}${a.phone ? `<br>${icon('phone-bold')} ` + esc(a.phone) : ''}${kamwaMap.hasPos(a) ? `<br><a href="${kamwaMap.directions(a)}" target="_blank" rel="noopener">${icon('arrow-square-out-bold')} Itinéraire (Google Maps)</a>` : ''}`;
    };
    form.querySelectorAll('input[name="method"]').forEach((r) => r.addEventListener('change', syncMethod));
    relayPicker($('#relayPick'), methods.agencies, form.agency.value, (id) => { form.agency.value = id; syncMethod(); }, saved.city);
    form.querySelectorAll('input[name="receive"]').forEach((r) => r.addEventListener('change', syncMethod));
    form.city.addEventListener('change', () => { zoneSync(); syncMethod(); });
    form.zone.addEventListener('change', syncMethod);
    zoneSync();
    syncMethod();

    // Pré-sélection automatique de l'opérateur selon le préfixe du numéro
    const syncOperator = () => {
      const d = (form.momo?.value || '').replace(/\D/g, '').replace(/^242/, '');
      if (d.startsWith('06')) form.operator.value = 'mtn';
      else if (d.startsWith('05') || d.startsWith('04')) form.operator.value = 'airtel';
    };
    form.momo?.addEventListener('input', syncOperator);
    syncOperator();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const m = method();
      const err = $('#formError'); err.innerHTML = '';
      const agency = methods.agencies.find((x) => x.id === form.agency?.value);
      const pickup = m === 'cash' && receive() === 'pickup';
      // Tout est vérifié AVANT d'envoyer quoi que ce soit : plus de commande créée pour rien
      const problems = [];
      if (!form.name.value.trim()) problems.push([form.name, 'Indiquez votre nom complet']);
      if (!localPhone(form.phone.value)) problems.push([form.phone, 'Numéro invalide : 9 chiffres, ex. 06 123 45 67']);
      if (!m) problems.push([form.querySelector('[name=method]'), 'Choisissez comment payer']);
      if (m === 'cash' && !agency) problems.push([form.agency, 'Choisissez le point relais sur la carte ou dans la liste']);
      if (!pickup && !form.address.value.trim()) problems.push([form.address, 'Indiquez votre quartier, votre rue ou un repère pour le livreur']);
      if ((m === 'momo' || m === 'cod') && !localPhone(form.momo?.value)) problems.push([form.momo, 'Numéro Mobile Money invalide']);
      if (!fieldErrors(form, problems)) return;
      const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Envoi de la demande…';
      const customer = pickup
        ? { name: form.name.value, phone: form.phone.value, city: agency?.city || '', address: `Retrait au point relais : ${agency?.name || ''}` }
        : { name: form.name.value, phone: form.phone.value, city: form.city.value, ...(!$('#zoneBox').hidden && form.zone.value ? { zone: form.zone.value } : {}), address: form.address.value, ...(homePos ? { location: homePos } : {}) };
      if (!pickup) { try { localStorage.setItem('kamwa-customer', JSON.stringify(customer)); } catch {} }
      try {
        // Même panier qu'une tentative précédente non payée : on réutilise la MÊME commande
        // (coordonnées changées, ex. adresse ajoutée ou retrait → livraison : elles sont mises à jour, pas de nouvelle commande).
        let checkout = loadCheckout();
        let order = null;
        const sig = JSON.stringify(customer);
        if (checkout?.cartKey === cartKey()) {
          try { order = await api('/orders/' + enc(checkout.orderId), { headers: orderHeaders(checkout.token) }); } catch {}
          if (['paid', 'confirmed'].includes(order?.status)) return finishPaid(checkout);
          if (order?.status !== 'pending_payment') order = null;
          if (order && checkout.sig !== sig) {
            await api('/orders/' + enc(checkout.orderId) + '/customer', { method: 'PATCH', headers: orderHeaders(checkout.token), body: { customer } });
            checkout = { ...checkout, sig }; saveCheckout(checkout);
          }
        }
        if (!order) {
          const created = await api('/orders', { method: 'POST', body: { customer, items: items.map(({ product, qty, variant }) => ({ productId: product.id, qty, variant: variant || undefined })) } });
          checkout = { orderId: created.id, token: created.token, cartKey: cartKey(), sig };
          rememberOrder(created.id, created.token);
          saveCheckout(checkout);
        }
        const body = { orderId: checkout.orderId, token: checkout.token, method: m };
        if (m === 'momo' || m === 'cod') Object.assign(body, { phone: form.momo.value, operator: form.operator.value });
        if (m === 'cash') Object.assign(body, { agencyId: form.agency.value, fulfillment: receive() });
        let payment;
        try {
          payment = await api('/payments', { method: 'POST', body });
        } catch (ex) {
          if (['paid', 'confirmed'].includes(ex.data?.orderStatus)) return finishPaid(checkout);
          throw ex;
        }
        if (payment.operator === 'cash') return finishReservation(checkout);
        if (payment.cod && payment.status === 'SUCCESSFUL') return finishPaid(checkout); // client fiable : confirmée sans acompte
        saveCheckout({ ...checkout, paymentId: payment.id });
        if (payment.redirectUrl) { location.href = payment.redirectUrl; return; } // page sécurisée de paiement par carte
        viewWaiting(checkout, payment, payment.resumed);
      } catch (ex) {
        err.innerHTML = `<div class="alert err">${esc(ex.message)}</div>`;
        btn.disabled = false; btn.textContent = BUTTON[m];
      }
    });
  }

  // Réservation en agence enregistrée : le panier est vidé, le client voit le récapitulatif de retrait.
  function finishReservation(checkout) {
    state.cart = {}; saveCart();
    saveCheckout(null);
    saveJSON('kamwa-last-order', { id: checkout.orderId, token: checkout.token });
    location.hash = '#/suivi/' + checkout.orderId;
  }

  function viewWaiting(checkout, payment, resumed) {
    const isCard = payment.operator === 'card';
    const opName = payment.operator === 'mtn' ? 'MTN MoMo' : 'Airtel Money';
    app.innerHTML = `
      <div class="panel waiting" id="waiting">
        <div class="spinner"></div>
        ${isCard ? `
        <h1>Vérification de votre paiement par carte</h1>
        <p>Nous confirmons le paiement de <strong>${fcfa(payment.amount)}</strong> auprès de notre partenaire bancaire.</p>` : `
        <h1>${payment.purpose === 'deposit' ? "Validez l'acompte sur votre téléphone" : 'Validez le paiement sur votre téléphone'}</h1>
        ${resumed ? '<div class="sim">Une demande de paiement est déjà en cours pour cette commande. Validez-la sur votre téléphone : nous n\'en envoyons pas une deuxième.</div>' : ''}
        <p>Une demande de <strong>${fcfa(payment.amount)}</strong> a été envoyée via <strong>${opName}</strong>.<br>
        Saisissez votre <strong>code secret</strong> sur votre téléphone pour confirmer.${payment.purpose === 'deposit' ? '<br>Le reste se paie à la livraison.' : ''}</p>`}
        <p class="hint" id="waitHint">Commande ${esc(checkout.orderId)}. Ne fermez pas cette page.</p>
      </div>`;
    const box = $('#waiting');
    const started = Date.now();
    const poll = async () => {
      if (!box.isConnected) return; // le client a quitté la page : l'attente reprendra s'il revient sur « commande »
      const elapsed = Date.now() - started;
      try {
        const p = await api('/payments/' + enc(payment.id));
        if (p.status === 'SUCCESSFUL') return finishPaid(checkout);
        if (p.status === 'FAILED') { saveCheckout({ ...checkout, paymentId: null }); return viewFailed(p); }
      } catch {}
      // Pas de confirmation après 3 min : on ne dit PAS « échec » (le client a peut-être validé), on continue de vérifier.
      if (elapsed > 3 * 60 * 1000) {
        $('#waitHint').innerHTML = `Commande ${esc(checkout.orderId)}. Nous attendons encore la confirmation ${isCard ? 'de la banque' : "de l'opérateur"}.<br>
          <strong>Si vous avez déjà validé, ne payez pas une deuxième fois</strong> : cette page se met à jour toute seule.`;
      }
      if (elapsed > 15 * 60 * 1000) {
        return viewFailed({ reason: `Aucune confirmation reçue. Si votre compte a été débité, contactez-nous en indiquant la commande ${checkout.orderId} : nous vérifierons avant tout nouveau paiement.` });
      }
      setTimeout(poll, elapsed > 3 * 60 * 1000 ? 10000 : 4000);
    };
    setTimeout(poll, isCard ? 1000 : 4000);
  }

  function viewFailed(p) {
    app.innerHTML = `
      <div class="panel waiting">
        <h1>Paiement non abouti</h1>
        <p>${esc(p.reason || 'Le paiement a été refusé ou annulé.')}</p>
        <p class="hint">Vérifiez votre solde ou votre carte, puis réessayez (vous pouvez aussi choisir un autre moyen de paiement). Votre panier est conservé.</p>
        <button class="btn cta" id="retryBtn">Réessayer</button>
      </div>`;
    // Bouton (et non lien) : on est déjà sur #/commande, un lien vers la même adresse ne ferait rien.
    $('#retryBtn').addEventListener('click', route);
  }

  async function viewThanks(orderId) {
    renderNav(null);
    // Les détails de la commande ne sont lisibles qu'avec sa clé secrète, gardée par ce navigateur.
    const last = loadJSON('kamwa-last-order');
    let order = null;
    if (last?.id === orderId) {
      try { order = await api('/orders/' + enc(orderId), { headers: orderHeaders(last.token) }); } catch {}
    }
    try { state.products = await api('/products'); } catch {} // stock à jour
    if (order && order.status === 'pending_payment') {
      app.innerHTML = `
        <div class="panel waiting">
          <h1>Paiement en attente</h1>
          <p>Commande <strong>${esc(order.id)}</strong> : le paiement n'est pas encore confirmé.</p>
          <a class="btn cta" href="#/commande">Retour à la commande</a>
        </div>`;
      return;
    }
    app.innerHTML = `
      <div class="panel waiting">
        <div class="big-check">${icon('check-circle-duotone')}</div>
        <h1>${order?.paymentPlan === 'cod' ? 'Merci, commande confirmée&nbsp;!' : 'Merci, paiement reçu&nbsp;!'}</h1>
        ${order ? `<p>Commande <strong>${esc(order.id)}</strong> : ${fcfa(order.total)}</p>
        ${order.paymentPlan === 'cod' ? `<p>${order.deposit ? `Acompte reçu : ${fcfa(order.deposit)}. ` : ''}Vous paierez <strong>${fcfa(order.balance ?? order.total)}</strong> à la livraison, en espèces ou en Mobile Money.</p>` : ''}
        <p>Nous vous appelons au <strong>${esc(order.customer.phone)}</strong> pour organiser la livraison à ${esc(order.customer.city)}.</p>
        ${codeCard(order)}
        <p><a class="btn ghost" href="#/suivi/${enc(order.id)}">Suivre ma commande</a></p>` : ''}
        <a class="btn cta" href="#/">Continuer mes achats</a>
      </div>
      ${state.customer ? '' : `<div class="panel" style="text-align:center">
        <strong>Retrouvez vos commandes sur n'importe quel téléphone</strong>
        <p class="hint">Créez votre compte Zado en 30 secondes : vous recevez un code à 6 chiffres.</p>
        <a class="btn ghost" href="#/compte/creer">Créer mon compte</a>
      </div>`}`;
  }

  // ---------- Espace client ----------
  // Commandes visibles : celles du compte (si connecté) + celles passées depuis ce téléphone.
  async function loadMyOrders() {
    const byId = new Map();
    if (state.customer) {
      try { for (const o of await api('/account/orders')) byId.set(o.id, o); } catch {}
    }
    const local = deviceOrders().filter((d) => !byId.has(d.id));
    const fetched = await Promise.all(local.map((d) => api('/orders/' + enc(d.id), { headers: orderHeaders(d.token) }).catch(() => null)));
    for (const o of fetched) if (o) byId.set(o.id, o);
    return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  // Factures, reçus, avoirs de la commande (ouverts dans un nouvel onglet : imprimer ou enregistrer en PDF)
  const DOC_ICON = { invoice: 'receipt', receipt: 'money-duotone', credit: 'arrow-counter-clockwise' };
  function docsBlock(docs, title = 'Factures et reçus') {
    if (!docs?.length) return '';
    return `<div class="docs-box"><h3>${icon('receipt')} ${esc(title)}</h3>
      ${docs.map((d) => `<a class="doc-row" href="${esc(d.link)}" target="_blank" rel="noopener">
        <span class="doc-ico ${d.type}">${icon(DOC_ICON[d.type] || 'receipt')}</span>
        <span class="doc-txt"><b>${esc(d.label)} ${esc(d.number)}</b><small>${shortDate(d.issuedAt)} · ${d.type === 'credit' ? '− ' : ''}${fcfa(d.amount)}${d.orderId ? ` · ${esc(d.orderId)}` : ''}</small></span>
        <span class="doc-open">Ouvrir ${icon('arrow-square-out-bold')}</span></a>`).join('')}
      <p class="hint">Ouvrez un document pour l'imprimer ou l'enregistrer en PDF.</p></div>`;
  }

  // Colis de la commande (page de suivi) : étape de chaque colis, point relais où il attend
  const PCL_ICON = { preparing: 'package', ready: 'package', with_courier: 'truck', at_relay: 'storefront', delivered: 'check-circle-duotone', returned: 'arrow-counter-clockwise' };
  function parcelsBlock(o) {
    const list = (o.parcels || []).filter((p) => p.stage !== 'returned');
    if (!list.length || o.status === 'delivered') return '';
    const waiting = list.some((p) => p.stage === 'at_relay');
    return `<div class="parcels-box ${waiting ? 'wait' : ''}">
      ${list.map((p) => `<div class="pcl-row"><span class="pcl-ico">${icon(PCL_ICON[p.stage] || 'package')}</span>
        <span><b>${list.length > 1 ? `Colis ${p.index}/${list.length} · ` : 'Votre colis · '}${esc(p.label)}${p.place ? ` : ${esc(p.place)}` : ''}</b>
        <small>N° ${esc(p.number)} · depuis ${shortDate(p.at)} à ${new Date(p.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small></span></div>`).join('')}
      ${waiting ? `<p class="hint">${icon('key-bold')}<span>Présentez votre <b>code de retrait</b> au point relais pour récupérer votre colis.</span></p>` : ''}
    </div>`;
  }

  function orderCard(o) {
    const step = stepIndex(o);
    const items = o.lines.reduce((n, l) => n + l.qty, 0);
    return `
      <a class="order-card" href="#/suivi/${enc(o.id)}">
        <div class="top"><strong>${esc(o.id)}</strong>${statusBadge(o)}</div>
        <div class="hint">${shortDate(o.createdAt)} · ${items} article${items > 1 ? 's' : ''} · <strong style="color:var(--ink)">${fcfa(o.total)}</strong></div>
        <div class="hint">${esc(o.lines.map((l) => l.name).join(', ').slice(0, 90))}</div>
        ${o.documents?.length ? `<div class="hint doc-hint">${icon('receipt')} ${esc(o.documents.map((d) => d.label).join(' + '))} : à ouvrir dans le suivi</div>` : ''}
        ${o.status === 'cancelled' ? '' : `<div class="progress" style="grid-template-columns:repeat(${stepCount(o)},1fr)">${Array.from({ length: stepCount(o) }, (_, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>`}
      </a>`;
  }

  async function viewAccount(sub) {
    renderNav(null);
    if (sub === 'creer') return viewRegister();
    app.innerHTML = '<p class="empty">Chargement…</p>';
    const list = await loadMyOrders();
    const c = state.customer;

    if (c) return accountSpace(c, list, sub);

    app.innerHTML = `
      <div class="account-grid">
        <form class="panel" id="loginForm" novalidate>
          <h1>Se connecter</h1>
          <label for="identifier">Numéro de téléphone ou e-mail</label>
          <input id="identifier" autocomplete="username" placeholder="06 123 45 67 ou nom@exemple.com" required>
          <label for="code">Code Zado (6 chiffres)</label>
          <input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="••• •••" required>
          <div id="loginError"></div>
          <button class="btn cta block" style="margin-top:14px">Me connecter</button>
          <p class="hint">Code oublié ? Contactez notre service client : nous vous en donnerons un nouveau.</p>
        </form>
        <div class="panel">
          <h2>Pas encore de compte ?</h2>
          <p class="hint">Un compte est nécessaire pour commander. Créez-le avec votre numéro ou votre e-mail et la photo de votre pièce d'identité : Zado vous attribue un code à 6 chiffres pour vous connecter sur n'importe quel téléphone.</p>
          <a class="btn ghost block" href="#/compte/creer">Créer mon compte</a>
        </div>
      </div>
      <div class="panel">
        <h2>Commandes passées depuis ce téléphone</h2>
        ${list.length ? list.map(orderCard).join('') : '<p class="empty">Aucune commande sur ce téléphone pour le moment.</p>'}
      </div>`;
    const codeInput = $('#code');
    codeInput.addEventListener('input', () => {
      const d = codeInput.value.replace(/\D/g, '').slice(0, 6);
      codeInput.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
    });
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const res = await api('/account/login', { method: 'POST', body: { identifier: $('#identifier').value, code: codeInput.value.replace(/\D/g, ''), deviceOrders: deviceOrders() } });
        state.customer = res.customer; renderAccountBtn(); route();
      } catch (err) {
        $('#loginError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    });
  }

  // ---------- Pièce d'identité (obligatoire pour commander) ----------
  const ID_TYPES = { passeport: 'Passeport', cni: "Carte nationale d'identité (CNI)", niu: 'NIU' };
  // Photo réduite dans le téléphone avant l'envoi (1600 px, JPEG) : rapide même avec une connexion lente
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Choisissez une photo'));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Photo illisible, réessayez')); };
      img.src = url;
    });
  }
  const idFieldsHtml = () => `
    <fieldset class="id-box">
      <legend>${icon('identification-card')} Pièce d'identité <span class="req">obligatoire</span></legend>
      ${state.config?.demo ? `<div class="alert err" style="margin-top:6px"><strong>Site de démonstration public :</strong> n'envoyez pas votre vraie pièce d'identité ni votre vrai numéro. Une photo quelconque (un papier, une carte de fidélité…) suffit pour essayer.</div>` : ''}
      <p class="hint">Pour lutter contre les fausses commandes, Zado vérifie l'identité de chaque client avant sa première commande. Votre photo reste confidentielle : seule l'équipe de vérification de Zado peut la voir.</p>
      <label for="idType">Type de pièce</label>
      <select id="idType" required><option value="">Choisissez…</option>${Object.entries(ID_TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <label for="idNumber">Numéro de la pièce (facultatif)</label>
      <input id="idNumber" maxlength="40" autocomplete="off" placeholder="Tel qu'il figure sur la pièce">
      <label>Photo de la pièce</label>
      <div class="id-pick">
        <button type="button" class="btn ghost" id="idCamBtn">${icon('camera')} Prendre une photo</button>
        <label class="btn ghost" for="idFile">${icon('image-square')} Choisir une photo</label>
      </div>
      <input id="idCamera" type="file" accept="image/*" capture="environment" hidden>
      <input id="idFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" hidden>
      <div class="id-preview" id="idPreview" hidden></div>
      <p class="hint">« Prendre une photo » ouvre l'appareil photo. « Choisir une photo » accepte aussi une version scannée (image ou PDF, 4 Mo max). Pièce en entier, à plat, bien éclairée et lisible (pas de reflet).</p>
    </fieldset>`;
  // Lit un PDF (pièce scannée) tel quel, sans le modifier
  const readPdf = (file) => new Promise((resolve, reject) => {
    if (file.size > 4 * 1024 * 1024) return reject(new Error('PDF trop lourd (4 Mo maximum). Scannez en qualité normale ou envoyez une image.'));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;,]*;/, 'data:application/pdf;'));
    r.onerror = () => reject(new Error('Fichier illisible, réessayez'));
    r.readAsDataURL(file);
  });
  const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));

  // Appareil photo DANS la page (téléphone : caméra arrière ; ordinateur : webcam).
  // Si le navigateur ne le permet pas (ancien téléphone, site sans https), on ouvre l'appareil photo du système.
  function openCamera(onShot, fallback) {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) return fallback();
    const ov = document.createElement('div');
    ov.className = 'cam-overlay';
    ov.innerHTML = `<div class="cam-box" role="dialog" aria-label="Appareil photo">
        <div class="cam-view"><video playsinline autoplay muted></video><div class="cam-frame"></div></div>
        <p class="cam-msg">Placez la pièce dans le cadre, bien à plat et lisible.</p>
        <div class="cam-actions">
          <button type="button" class="btn ghost" data-cam="cancel">Annuler</button>
          <button type="button" class="btn ghost" data-cam="switch" hidden>${icon('arrow-counter-clockwise')} Changer de caméra</button>
          <button type="button" class="btn cta" data-cam="shoot" disabled>${icon('camera')} Prendre la photo</button>
        </div></div>`;
    document.body.appendChild(ov);
    document.body.classList.add('no-scroll');
    const video = ov.querySelector('video');
    let stream = null; let facing = 'environment';
    const stop = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
    const close = () => { stop(); ov.remove(); document.body.classList.remove('no-scroll'); };
    const start = async () => {
      stop();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        video.srcObject = stream; await video.play().catch(() => {});
        ov.querySelector('[data-cam="shoot"]').disabled = false;
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        ov.querySelector('[data-cam="switch"]').hidden = cams.length < 2;
      } catch (err) {
        ov.querySelector('.cam-msg').innerHTML = err?.name === 'NotAllowedError'
          ? "L'accès à l'appareil photo est refusé. Autorisez-le dans les réglages du navigateur (icône à gauche de l'adresse), puis réessayez."
          : "Aucun appareil photo n'est disponible sur cet appareil. Utilisez « Choisir une photo » avec une version scannée.";
        ov.querySelector('[data-cam="shoot"]').disabled = true;
        ov.querySelector('[data-cam="switch"]').hidden = true;
      }
    };
    ov.addEventListener('click', (e) => {
      const a = e.target.closest('[data-cam]')?.dataset.cam;
      if (a === 'cancel') close();
      if (a === 'switch') { facing = facing === 'environment' ? 'user' : 'environment'; start(); }
      if (a === 'shoot' && video.videoWidth) {
        const k = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(video.videoWidth * k); c.height = Math.round(video.videoHeight * k);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        const shot = c.toDataURL('image/jpeg', 0.88);
        close(); onShot(shot);
      }
    });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    start();
  }

  // Branche les boutons photo ; renvoie une fonction qui donne { idType, idNumber, idPhoto } ou lève une erreur
  function bindIdFields(root) {
    let photo = null;
    const box = root.querySelector('#idPreview');
    const show = (data, name) => {
      photo = data; box.hidden = false;
      box.innerHTML = data.startsWith('data:application/pdf')
        ? `<span class="pdf-tag">${icon('file-pdf')} ${esc(name || 'Document PDF')}</span><span class="ok-tag">${icon('check')} Document prêt</span>`
        : `<img src="${data}" alt="Aperçu de la pièce"><span class="ok-tag">${icon('check')} Photo prête</span>`;
    };
    const onPick = async (input) => {
      const f = input.files?.[0]; if (!f) return;
      box.hidden = false; box.innerHTML = '<span class="hint">Préparation…</span>';
      try { show(isPdf(f) ? await readPdf(f) : await shrinkPhoto(f), f.name); }
      catch (err) { photo = null; box.innerHTML = `<span class="alert err">${esc(err.message)}</span>`; }
      input.value = '';
    };
    root.querySelector('#idCamBtn').addEventListener('click', () => openCamera((shot) => show(shot), () => root.querySelector('#idCamera').click()));
    root.querySelector('#idCamera').addEventListener('change', (e) => onPick(e.target));
    root.querySelector('#idFile').addEventListener('change', (e) => onPick(e.target));
    return () => {
      const idType = root.querySelector('#idType').value;
      if (!idType) throw new Error("Choisissez le type de votre pièce d'identité");
      if (!photo) throw new Error("Ajoutez la photo (ou le scan) de votre pièce d'identité");
      return { idType, idNumber: root.querySelector('#idNumber').value, idPhoto: photo };
    };
  }
  // Encadré « état de ma pièce » sur la page compte (+ formulaire si elle manque ou a été refusée)
  function idStatusPanel(c) {
    const st = c.idStatus || 'missing';
    if (st === 'verified') return `<div class="alert ok id-status">${icon('seal-check-duotone')} <span><strong>Identité vérifiée</strong> — vous pouvez commander.</span></div>`;
    if (st === 'pending') return `<div class="alert warn id-status">${icon('clock-countdown-duotone')} <span><strong>Pièce d'identité en cours de vérification.</strong> Vous pourrez commander dès sa validation par Zado (en général en 1 minute). Votre panier vous attend.</span></div>`;
    return `<form class="panel" id="idForm" novalidate>
      ${st === 'rejected' ? `<div class="alert err"><strong>Votre pièce a été refusée</strong>${c.idRejectReason ? ` : ${esc(c.idRejectReason)}` : ''}. Envoyez une nouvelle photo.</div>`
        : `<div class="alert warn">Pour commander, ajoutez la photo de votre pièce d'identité.</div>`}
      ${idFieldsHtml()}
      <div id="idError"></div>
      <button class="btn cta block" style="margin-top:12px">Envoyer ma pièce</button>
    </form>`;
  }

  // ---------- Espace client : vue d'ensemble, commandes, réglages personnels ----------
  const ACC_TABS = [['', 'Vue d\'ensemble', 'squares-four'], ['commandes', 'Mes commandes', 'receipt'], ['reglages', 'Réglages', 'gear-six']];
  function accountSpace(c, list, sub) {
    const tab = ACC_TABS.some(([k]) => k === (sub || '')) ? (sub || '') : '';
    const nav = `<nav class="acc-tabs" aria-label="Mon compte">${ACC_TABS.map(([k, l, ic]) => `<a href="#/compte${k ? '/' + k : ''}" class="${tab === k ? 'on' : ''}">${icon(ic)} ${l}</a>`).join('')}</nav>`;
    const head = `<div class="acc-head">
        <div class="acc-avatar">${esc(c.name.trim()[0] || 'K').toUpperCase()}</div>
        <div><h1>Bonjour ${esc(c.name.split(' ')[0])}${verifiedBadge(c)}</h1>
          <span class="hint">${esc([c.phone, c.email].filter(Boolean).join(' · '))} · client depuis le ${shortDate(c.createdAt)}</span></div>
        <span class="acc-id ${c.idStatus === 'verified' ? 'ok' : 'warn'}">${icon(c.idStatus === 'verified' ? 'seal-check-duotone' : 'clock-countdown-duotone')} ${c.idStatus === 'verified' ? 'Identité vérifiée' : c.idStatus === 'pending' ? 'Vérification en cours' : 'Pièce à fournir'}</span>
      </div>`;
    if (tab === 'commandes') {
      const docs = list.flatMap((o) => (o.documents || []).map((d) => ({ ...d, orderId: o.id }))).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
      app.innerHTML = `<div class="acc">${head}${nav}<div class="panel"><h2>Mes commandes</h2>${list.length ? list.map(orderCard).join('') : '<p class="empty">Pas encore de commande. <a href="#/">Découvrir la boutique</a></p>'}</div>
        ${docs.length ? `<div class="panel">${docsBlock(docs, 'Mes factures et reçus')}</div>` : ''}</div>`;
      return;
    }
    if (tab === 'reglages') return accountSettings(c, head, nav);
    // Vue d'ensemble
    const paid = list.filter((o) => ['paid', 'confirmed', 'shipped', 'delivered'].includes(o.status));
    const ongoing = list.filter((o) => !['delivered', 'cancelled'].includes(o.status));
    const relay = state.prefs.relayId && (state.relays || []).find((a) => a.id === state.prefs.relayId);
    app.innerHTML = `<div class="acc">${head}${nav}
      ${idStatusPanel(c).startsWith('<form') ? idStatusPanel(c) : idStatusPanel(c).replace('alert ok id-status', 'alert ok id-status slim')}
      <div class="acc-stats">
        <a href="#/compte/commandes"><span>${icon('package')}</span><b>${ongoing.length}</b><small>en cours</small></a>
        <a href="#/compte/commandes"><span>${icon('receipt')}</span><b>${paid.length}</b><small>commande(s) payée(s)</small></a>
        <a href="#/compte/commandes"><span>${icon('wallet')}</span><b>${fcfa(paid.reduce((n, o) => n + o.total, 0))}</b><small>total de vos achats</small></a>
      </div>
      ${ongoing.length ? `<div class="panel"><h2>En cours</h2>${ongoing.slice(0, 4).map((o) => `
        <a class="acc-ongoing" href="#/suivi/${enc(o.id)}">
          <span><strong class="mono">${esc(o.id)}</strong><small>${o.lines.map((l) => l.name).join(', ').slice(0, 70)}</small></span>
          <span class="acc-prog"><i style="width:${Math.round(((Math.max(0, stepIndex(o)) + 1) / stepCount(o)) * 100)}%"></i></span>
          ${statusBadge(o)}
        </a>`).join('')}</div>` : ''}
      <div class="acc-actions">
        <a href="#/compte/commandes">${icon('package')}<span>Suivre mes commandes</span></a>
        <button type="button" data-open-chat>${icon('chat-circle')}<span>Aide et messages</span></button>
        <a href="#/compte/reglages">${icon('gear-six')}<span>Personnaliser Zado</span></a>
        <a href="#/promos">${icon('tag')}<span>Bonnes affaires</span></a>
        ${relay ? `<a href="${kamwaMap.hasPos(relay) ? kamwaMap.directions(relay) : '#/compte/reglages'}" ${kamwaMap.hasPos(relay) ? 'target="_blank" rel="noopener"' : ''}>${icon('map-pin')}<span>Mon point relais<br><small>${esc(relay.name)}</small></span></a>` : `<a href="#/compte/reglages">${icon('map-pin')}<span>Choisir mon point relais</span></a>`}
      </div>
      ${pushCard(null)}
      ${list.length ? `<div class="panel"><div class="row" style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Dernières commandes</h2><a href="#/compte/commandes">Tout voir</a></div>${list.slice(0, 3).map(orderCard).join('')}</div>` : '<div class="panel empty">Pas encore de commande. <a href="#/">Découvrir la boutique</a></div>'}
    </div>`;
    if ($('#idForm')) {
      const readId = bindIdFields($('#idForm'));
      $('#idForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button.cta'); btn.disabled = true; btn.textContent = 'Envoi en cours…';
        try {
          const res = await api('/account/identity', { method: 'POST', body: readId() });
          state.customer = res.customer; route();
        } catch (err) {
          $('#idError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
          btn.disabled = false; btn.textContent = 'Envoyer ma pièce';
        }
      });
    }
    if (!state.relays) api('/payments/methods').then((m) => { state.relays = m.agencies || []; if (state.prefs.relayId && location.hash === '#/compte') route({ keep: true }); }).catch(() => {});
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-open-chat]')) window.kamwaChat?.open(); });

  // Réglages personnels : ne modifient QUE l'affichage pour ce client
  async function accountSettings(c, head, nav) {
    const p = state.prefs;
    if (!state.relays) { try { state.relays = (await api('/payments/methods')).agencies || []; } catch { state.relays = []; } }
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-pref="${key}" data-val="${esc(String(v))}" class="${String(p[key]) === String(v) ? 'on' : ''}" aria-pressed="${String(p[key]) === String(v)}">${l}</button>`).join('')}</div>`;
    const toggle = (key, label, hint, on) => `<label class="pref-row"><span><b>${label}</b><small>${hint}</small></span><span class="switch"><input type="checkbox" data-pref-bool="${key}" ${on ? 'checked' : ''}><span></span></span></label>`;
    app.innerHTML = `<div class="acc">${head}${nav}
      <p class="hint" style="margin:0 0 12px">Ces réglages ne changent Zado <strong>que pour vous</strong> (sur vos téléphones). Ils n'affectent ni le site des autres clients, ni les produits.</p>
      <div class="panel prefs">
        <h2>${icon('palette')} Apparence</h2>
        <div class="pref-row"><span><b>Thème</b><small>« Auto » suit le réglage de votre téléphone</small></span><span data-theme-host></span></div>
        <div class="pref-row"><span><b>Taille du texte</b><small>Pour lire plus confortablement</small></span>${seg('textSize', [['normal', 'A'], ['large', '<span style="font-size:1.15em">A</span>'], ['xlarge', '<span style="font-size:1.35em">A</span>']])}</div>
        <div class="pref-row"><span><b>Affichage des produits</b><small>« Compact » montre plus de produits à la fois</small></span>${seg('density', [['comfort', 'Confort'], ['compact', 'Compact']])}</div>
        ${toggle('motionReduce', 'Réduire les animations', 'Moins de mouvements (formes, carrousel automatique)', p.motion === 'reduce')}
        ${toggle('splash', "Animation d'ouverture", 'Le logo animé au lancement de Zado', p.splash !== false)}
        ${toggle('dataSaver', 'Économie de données', 'Les cartes ne se chargent que si vous les demandez', p.dataSaver)}
      </div>
      <div class="panel prefs">
        <h2>${icon('storefront')} Ma boutique</h2>
        ${UNIVERSES.length > 1 ? `<div class="pref-row"><span><b>Rayon préféré</b><small>Affiché en premier sur l'accueil et dans le menu</small></span>${seg('homeUniverse', [['', 'Aucun'], ...UNIVERSES.map((u) => [u.name, esc(u.name)])])}</div>
        <div class="pref-row"><span><b>Rayons affichés</b><small>Masquez un rayon qui ne vous intéresse pas (il reste accessible par la recherche)</small></span>
          <span class="chips">${UNIVERSES.map((u) => `<label class="chip-check"><input type="checkbox" data-uni-show="${esc(u.name)}" ${(p.hiddenUniverses || []).includes(u.name) ? '' : 'checked'}> ${esc(u.name)}</label>`).join('')}</span></div>` : ''}
        ${toggle('showFlash', 'Ventes flash sur l\'accueil', 'Afficher le bloc des prix qui fondent', p.showFlash !== false)}
        <div class="pref-row"><span><b>Ville de livraison</b><small>Pré-remplie à chaque commande</small></span>
          <select data-pref-select="city"><option value="">—</option>${deliveryCities().map((v) => `<option ${p.city === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
        <div class="pref-row"><span><b>Point relais favori</b><small>Proposé en premier à chaque commande</small></span>
          <select data-pref-select="relayId"><option value="">—</option>${state.relays.map((a) => `<option value="${esc(a.id)}" ${p.relayId === a.id ? 'selected' : ''}>${esc(a.city)} — ${esc(a.name)}</option>`).join('')}</select></div>
      </div>
      <div class="panel prefs">
        <h2>${icon('bell')} Notifications</h2>
        ${pushCard(null)}
        ${toggle('notifyOrders', 'Suivi de mes commandes', 'Payée, en route, livreur tout près, livrée', p.notify?.orders !== false)}
        ${toggle('notifyChat', 'Réponses de Zado', 'Quand un conseiller vous répond dans la messagerie', p.notify?.chat !== false)}
      </div>
      <div class="panel prefs">
        <h2>${icon('user-circle')} Mon profil</h2>
        <div class="pref-row"><span><b>Nom</b><small>Celui de votre pièce d'identité</small></span><span>${esc(c.name)}</span></div>
        <div class="pref-row"><span><b>Identifiant</b><small>Pour le changer, écrivez-nous dans « Aide »</small></span><span>${esc([c.phone, c.email].filter(Boolean).join(' · '))}</span></div>
        <form class="pref-row" id="codeForm"><span><b>Changer mon code Zado</b><small>Code actuel obligatoire ; vos autres appareils seront déconnectés${c.codeChangedAt ? ` · dernier changement le ${shortDate(c.codeChangedAt)}` : ''}</small></span>
          <span class="code-change"><input id="curCode" inputmode="numeric" maxlength="7" placeholder="Code actuel" autocomplete="current-password"><button class="btn ghost small">Changer</button></span></form>
        <div id="codeMsg"></div>
      </div>
      <div class="row" style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 30px">
        <button class="btn ghost" id="prefsReset">${icon('arrow-counter-clockwise')} Remettre l'affichage par défaut</button>
        <button class="btn ghost" id="logoutBtn">${icon('sign-out-bold')} Se déconnecter</button>
      </div>
    </div>`;
    renderThemeSwitches();
    const rerender = () => route({ keep: true });
    app.querySelectorAll('[data-pref]').forEach((b) => b.addEventListener('click', () => { savePrefs({ [b.dataset.pref]: b.dataset.val }); rerender(); }));
    app.querySelectorAll('[data-pref-bool]').forEach((i) => i.addEventListener('change', () => {
      const k = i.dataset.prefBool;
      if (k === 'motionReduce') savePrefs({ motion: i.checked ? 'reduce' : 'normal' });
      else if (k === 'notifyOrders' || k === 'notifyChat') savePrefs({ notify: { ...state.prefs.notify, [k === 'notifyOrders' ? 'orders' : 'chat']: i.checked } });
      else savePrefs({ [k]: i.checked });
    }));
    app.querySelectorAll('[data-uni-show]').forEach((i) => i.addEventListener('change', () => {
      const hidden = UNIVERSES.map((u) => u.name).filter((n) => !app.querySelector(`[data-uni-show="${CSS.escape(n)}"]`).checked);
      if (hidden.length >= UNIVERSES.length) { i.checked = true; alert('Gardez au moins un rayon affiché.'); return; }
      savePrefs({ hiddenUniverses: hidden }); renderNav(null);
    }));
    app.querySelectorAll('[data-pref-select]').forEach((sel) => sel.addEventListener('change', () => {
      savePrefs({ [sel.dataset.prefSelect]: sel.value });
      if (sel.dataset.prefSelect === 'city' && sel.value) { const k = loadJSON('kamwa-customer') || {}; k.city = sel.value; saveJSON('kamwa-customer', k); renderDeliverCity(); }
    }));
    $('#prefsReset').addEventListener('click', () => { if (confirm("Remettre l'affichage par défaut ?")) { savePrefs({ ...PREF_DEFAULTS }); rerender(); } });
    $('#logoutBtn').addEventListener('click', async () => { await api('/account/logout', { method: 'POST' }).catch(() => {}); state.customer = null; renderAccountBtn(); location.hash = '#/compte'; });
    $('#codeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/account/code', { method: 'POST', body: { code: $('#curCode').value.replace(/\D/g, '') } });
        if (state.customer) state.customer.codeChangedAt = r.codeChangedAt;
        $('#curCode').value = '';
        $('#codeForm').hidden = true;
        const box = $('#codeMsg');
        box.innerHTML = `<div class="code-reveal" role="status">
          <span class="cr-spark s1">${icon('sparkle-fill')}</span><span class="cr-spark s2">${icon('sparkle-fill')}</span>
          <div class="cr-head"><span class="cr-ico">${icon('key-bold')}</span>
            <div><b>C'est fait, ${esc(c.name.split(' ')[0])} !</b><small>Votre nouveau code Zado est actif dès maintenant</small></div></div>
          ${codeDigits(r.code)}
          <div class="cr-actions">
            <button type="button" class="btn ghost small" data-cr-copy>${icon('clipboard-text')} Copier</button>
            <button type="button" class="btn cta small" data-cr-done>${icon('check-bold')} Je l'ai noté</button>
          </div>
          <ul class="cr-tips">
            <li>${icon('device-mobile')}<span>Vos autres appareils ont été déconnectés : reconnectez-les avec ce code.</span></li>
            <li>${icon('lock-key-bold')}<span>Zado ne vous demandera <b>jamais</b> ce code, ni par téléphone ni par WhatsApp.</span></li>
            <li>${icon('camera')}<span>Notez-le ou faites une capture d'écran : il ne sera plus affiché.</span></li>
          </ul></div>`;
        box.querySelector('[data-cr-copy]').addEventListener('click', async (ev) => {
          const b = ev.currentTarget;
          try { await navigator.clipboard.writeText(r.code); b.innerHTML = `${icon('check-bold')} Copié`; } catch { b.textContent = formatCode(r.code); }
        });
        box.querySelector('[data-cr-done]').addEventListener('click', () => {
          box.innerHTML = `<div class="alert ok id-status">${icon('shield-check')} <span><strong>Code Zado changé</strong> le ${shortDate(new Date().toISOString())}. Utilisez-le à votre prochaine connexion.</span></div>`;
          $('#codeForm').hidden = false;
        });
      } catch (err) { $('#codeMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
  }

  function viewRegister() {
    if (state.customer) { location.hash = '#/compte'; return; }
    const saved = loadJSON('kamwa-customer') || {};
    app.innerHTML = `
      <form class="panel" id="registerForm" novalidate style="max-width:520px;margin:0 auto">
        <h1>Créer mon compte Zado</h1>
        <p class="hint">Indiquez votre numéro de téléphone <strong>ou</strong> votre e-mail (ou les deux) : c'est votre identifiant. Un compte vérifié est nécessaire pour commander.</p>
        <label for="rName">Nom complet</label>
        <input id="rName" autocomplete="name" value="${esc(saved.name)}" required>
        <label for="rPhone">Numéro de téléphone</label>
        <input id="rPhone" type="tel" inputmode="tel" placeholder="06 123 45 67" value="${esc(saved.phone)}">
        <label for="rEmail">E-mail (facultatif)</label>
        <input id="rEmail" type="email" inputmode="email" autocomplete="email" placeholder="nom@exemple.com">
        ${idFieldsHtml()}
        <div id="registerError"></div>
        <button class="btn cta block" style="margin-top:14px">Créer mon compte</button>
        <p class="hint">Déjà un compte ? <a href="#/compte">Se connecter</a></p>
      </form>`;
    const readId = bindIdFields($('#registerForm'));
    $('#registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      // Tout est vérifié AVANT l'envoi : un message sous chaque champ à corriger (audit 17/10/2026)
      const form = e.target, phone = $('#rPhone').value.trim(), email = $('#rEmail').value.trim();
      const problems = [];
      if ($('#rName').value.trim().length < 2) problems.push([$('#rName'), 'Indiquez votre nom complet.']);
      if (phone && !localPhone(phone)) problems.push([$('#rPhone'), 'Numéro congolais à 9 chiffres, par exemple 06 123 45 67.']);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) problems.push([$('#rEmail'), 'Adresse e-mail incomplète (exemple : nom@exemple.com).']);
      if (!phone && !email) problems.push([$('#rPhone'), 'Indiquez un numéro de téléphone ou une adresse e-mail : ce sera votre identifiant.']);
      let id = null;
      try { id = readId(); } catch (err) { problems.push([/type/.test(err.message) ? $('#idType') : form.querySelector('.id-pick'), err.message]); }
      $('#registerError').innerHTML = '';
      if (!fieldErrors(form, problems)) return;
      const btn = form.querySelector('button.cta'); btn.disabled = true; btn.textContent = 'Envoi en cours…';
      try {
        const res = await api('/account/register', { method: 'POST', body: { name: $('#rName').value, phone: $('#rPhone').value, email: $('#rEmail').value, ...id, deviceOrders: deviceOrders() } });
        state.customer = res.customer; renderAccountBtn();
        const who = res.customer.phone || res.customer.email;
        app.innerHTML = `
          <div class="panel" style="max-width:520px;margin:0 auto;text-align:center">
            <div class="big-check">${icon('check-circle-duotone')}</div>
            <h1>Bienvenue ${esc(res.customer.name.split(' ')[0])} !</h1>
            <p>Voici votre <strong>code Zado</strong> :</p>
            ${codeDigits(res.code)}
            <div class="alert err" style="text-align:left"><strong>Notez-le bien</strong> (ou faites une capture d'écran) : il ne sera plus affiché.<br>
            Pour vous connecter : <strong>${esc(who)}</strong> + ce code.</div>
            ${res.claimed ? `<p class="hint">${res.claimed} commande(s) de ce téléphone ajoutée(s) à votre compte.</p>` : ''}
            <div class="alert warn" style="text-align:left">${icon('clock-countdown-duotone')} Votre pièce d'identité est <strong>en cours de vérification</strong>. Vous pourrez commander dès sa validation par Zado (en général en 1 minute).</div>
            <a class="btn cta block" href="#/compte" style="margin-top:14px">J'ai noté mon code</a>
          </div>`;
      } catch (err) {
        $('#registerError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
        btn.disabled = false; btn.textContent = 'Créer mon compte';
      }
    });
  }

  async function viewTracking(id) {
    renderNav(null);
    app.innerHTML = '<p class="empty">Chargement…</p>';
    let o = null;
    try { o = await api('/orders/' + enc(id), { headers: orderHeaders(tokenOf(id) || '') }); } catch {}
    if (!o) {
      app.innerHTML = `<div class="panel waiting"><h1>Commande introuvable</h1>
        <p class="hint">Connectez-vous avec le compte qui a passé cette commande, ou ouvrez ce lien sur le téléphone qui l'a passée.</p>
        <a class="btn cta" href="#/compte">Mon compte</a></div>`;
      return;
    }
    const at = (status) => [...(o.history || [])].reverse().find((h) => h.status === status)?.at;
    const ag = o.agency || {};
    const payAg = Boolean(o.agency); // espèces à payer à l'agence (retrait ou livraison ensuite)
    const expired = payAg && o.status === 'pending_payment' && o.pickupDeadline && Date.now() > Date.parse(o.pickupDeadline);
    const agencyStep = expired
      ? 'Le délai de réservation est dépassé : vos articles ne sont plus réservés. Contactez-nous ou repassez commande.'
      : `Rendez-vous au point relais <strong>${esc(ag.name)}</strong> (${esc(ag.city)}) avant le <strong>${longDate(o.pickupDeadline)}</strong> et payez <strong>${fcfa(o.total)}</strong> en espèces.`;
    const steps = isPickup(o)
      ? [
          ['Commande réservée', o.createdAt, agencyStep],
          ['Payée au point relais', o.paidAt || at('paid'), 'Paiement reçu. Votre commande vous est remise au point relais.'],
          ['Retirée', at('delivered'), 'Vous avez retiré votre commande. Merci pour votre confiance !'],
        ]
      : [
          ['Commande passée', o.createdAt, payAg ? agencyStep : 'Nous avons bien reçu votre commande.'],
          payAg
            ? ['Payée au point relais', o.paidAt || at('paid'), 'Paiement reçu. Nous préparons votre colis et vous appelons pour la livraison.']
            : o.paymentPlan === 'cod'
            ? ['Commande confirmée', o.confirmedAt || at('confirmed'), `${o.deposit ? `Acompte de ${fcfa(o.deposit)} reçu. ` : ''}Vous paierez ${fcfa(o.balance ?? o.total)} à la livraison. Nous préparons votre colis et vous appelons.`]
            : ['Paiement confirmé', o.paidAt || at('paid'), 'Votre paiement est validé. Nous préparons votre colis et vous appelons.'],
          ['En livraison', at('shipped'), `Le livreur arrive à ${esc(o.customer.city || 'votre adresse')}. Gardez votre téléphone allumé et préparez votre code de livraison.`],
          ['Livrée', at('delivered'), 'Votre commande a été livrée. Merci pour votre confiance !'],
        ];
    const current = Math.max(0, stepIndex(o));
    const cancelled = o.status === 'cancelled';
    app.innerHTML = `
      <div class="crumbs"><a href="#/compte">Mon compte</a> › Suivi de commande</div>
      <div class="checkout">
        <div class="panel">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h1 style="margin:0">${esc(o.id)}</h1>${statusBadge(o)}</div>
          <p class="hint">Passée le ${longDate(o.createdAt)}</p>
          ${cancelled ? `<div class="alert err">Cette commande a été annulée${at('cancelled') ? ' le ' + longDate(at('cancelled')) : ''}. Si vous avez payé, notre service client vous recontacte pour le remboursement.</div>` : `
          <ol class="timeline">
            ${steps.map(([label, when, text], i) => `
              <li class="${i < current ? 'done' : i === current ? 'done current' : 'todo'}">
                <span class="dot">${i <= current ? '✓' : ''}</span>
                <strong>${label}</strong>
                <span class="when">${i <= current ? (when ? longDate(when) : '') : i === current + 1 ? 'Étape suivante' : 'À venir'}</span>
                ${i === current ? `<p class="hint" style="margin:4px 0 0">${text}</p>` : ''}
              </li>`).join('')}
          </ol>
          ${!['delivered', 'cancelled'].includes(o.status) ? pushCard(o.id) : ''}
          ${o.status === 'shipped' && !isPickup(o) ? '<div class="live-box" id="liveBox"></div>' : ''}
          ${o.planned && !['delivered', 'cancelled'].includes(o.status) && !isPickup(o) ? `<div class="plan-box">${icon('clock-bold')}<span><b>Livraison prévue le ${new Date(o.planned.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</b><small>${esc(o.planned.label)} · nous vous appelons avant de passer. Gardez votre code de livraison.</small></span></div>` : ''}
          ${parcelsBlock(o)}
          ${codeCard(o)}
          ${docsBlock(o.documents)}
          ${(o.attempts || []).length && !['delivered', 'cancelled'].includes(o.status) ? `<div class="alert warn">${o.attempts.map((a) => `Tentative de livraison le ${longDate(a.at)} : ${esc(a.label)}.`).join('<br>')} Nous vous recontactons.</div>` : ''}
          ${o.status === 'pending_payment' && !payAg ? '<div class="alert err">Paiement pas encore reçu. Si vous venez de valider sur votre téléphone, patientez quelques minutes.</div>' : ''}
          ${o.status === 'cancelled' && o.cancelReason ? `<div class="alert warn">${icon('warning-duotone')} ${esc(o.cancelReason === 'Non payée dans les délais' ? "Cette commande a été annulée car elle n'a pas été payée à temps. Vos articles ne sont plus réservés : vous pouvez repasser commande." : o.cancelReason)}</div>` : ''}
          ${payAg && (isPickup(o) ? ['pending_payment', 'paid', 'confirmed'].includes(o.status) : o.status === 'pending_payment') ? `<div class="relay-change">
            ${kamwaMap.hasPos(ag) ? `<a class="btn ghost small" href="${kamwaMap.directions(ag)}" target="_blank" rel="noopener">${icon('map-pin-bold')} Itinéraire</a>` : ''}
            <button type="button" class="btn ghost small" id="relayChange">${icon('storefront')} Changer de point relais</button>
            <div id="relayChangeBox"></div></div>` : ''}
          ${payAg && o.status === 'pending_payment' && !expired ? `<div class="panel pay-here">
            <strong>${icon('map-pin-bold')} ${esc(ag.name)} — ${esc(ag.city)}</strong>
            <p class="hint" style="margin:4px 0 0">${esc(ag.address || 'Adresse communiquée par téléphone')}${ag.hours ? `<br>${icon('clock-bold')} ` + esc(ag.hours) : ''}${ag.phone ? `<br>${icon('phone-bold')} ` + esc(ag.phone) : ''}</p>
            <p class="hint">Présentez le numéro de commande <strong>${esc(o.id)}</strong> au point relais.</p></div>` : ''}
          ${o.status === 'pending_payment' ? `<div class="cancel-box"><button type="button" class="btn ghost small" id="orderCancel">${icon('x-bold')} ${payAg ? 'Annuler ma réservation' : 'Annuler ma commande'}</button><span class="hint">Possible tant que vous n'avez pas payé.</span></div>` : ''}`}
        </div>
        <div class="panel">
          <h2>Récapitulatif</h2>
          ${o.lines.map((l) => `<div class="line"><span>${l.qty} × ${esc(l.name)}${o.status === 'delivered' && l.productId && byId(l.productId) ? `<br><a class="rv-link" href="#/p/${enc(l.productId)}">${icon('star-fill')} Donner mon avis</a>` : ''}</span><strong>${fcfa(l.total)}</strong></div>`).join('')}
          ${o.deliveryFee ? `<div class="line"><span>Livraison</span><strong>${fcfa(o.deliveryFee)}</strong></div>` : ''}
          <div class="row total" style="margin-top:10px"><span>Total</span><strong>${fcfa(o.total)}</strong></div>
          <p class="hint" style="margin-top:12px">${isPickup(o) ? `Retrait au point relais : ${esc(ag.name)} (${esc(ag.city)})` : `Livraison : ${esc(o.customer.city || '—')} · ${esc(o.customer.address || '')}`}<br>Contact : ${esc(o.customer.phone)}</p>
        </div>
      </div>`;
    if ($('#liveBox')) startLive(id, o);
  }

  // ---------- Notifications de suivi sur le téléphone (Android et iPhone) ----------
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const pushOn = () => pushSupported() && Notification.permission === 'granted';
  const b64ToBytes = (b) => { const p = '='.repeat((4 - (b.length % 4)) % 4); const r = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  async function enablePush(orderId) {
    if (Notification.permission === 'denied') throw new Error('Notifications bloquées : autorisez-les dans les réglages du navigateur pour Zado.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications non autorisées');
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), orderId, token: orderId ? tokenOf(orderId) : undefined } });
  }
  // Abonnement déjà accordé : on rattache aussi cette commande / ce compte, sans rien demander
  async function linkPush(orderId) { if (pushOn()) { try { await enablePush(orderId); } catch {} } }
  function pushCard(orderId) {
    if (pushOn()) { linkPush(orderId); return `<div class="push-card on">${icon('bell-bold')} <span>Notifications de suivi activées sur ce téléphone.</span></div>`; }
    if (isIOS && !isStandalone) return `<div class="push-card">${icon('bell-bold')} <span><strong>Suivez votre commande en direct sur votre iPhone</strong>Touchez ${icon('export')} <b>Partager</b>, puis <b>« Sur l'écran d'accueil »</b>. Ouvrez ensuite Zado depuis l'écran d'accueil et activez les notifications.</span></div>`;
    if (!pushSupported()) return '';
    return `<div class="push-card">${icon('bell-bold')} <span><strong>Être prévenu à chaque étape</strong>Paiement reçu, colis en route, livreur tout près, livré : recevez une notification sur ce téléphone.</span><button type="button" class="btn cta small" data-push="${esc(orderId || '')}">Activer</button></div>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-push]'); if (!b) return;
    b.disabled = true; b.textContent = '…';
    try { await enablePush(b.dataset.push || null); b.closest('.push-card').outerHTML = `<div class="push-card on">${icon('bell-bold')} <span>Notifications activées ✓ Vous serez prévenu à chaque étape.</span></div>`; }
    catch (err) { b.disabled = false; b.textContent = 'Activer'; alert(err.message); }
  });

  // ---------- Suivi EN DIRECT de la course (façon Grab, décision Joseph 18/10/2026) ----------
  // Carte où le livreur GLISSE vers le client (animation entre deux positions, icône tournée dans sa direction),
  // trajet restant, heure d'arrivée, étapes, carte du livreur (prénom, véhicule, plaque), plein écran, « arrivé ».
  // Données : GET /api/orders/:id/live (src/live.js), toutes les 4 s + signal instantané « kamwa-live ».
  function startLive(id, order = {}) {
    const box = $('#liveBox');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';
    let L = null, map = null, rider = null, home = null, casing = null, line = null, follow = true, last = null, anim = 0, picking = false, pickMk = null, data = null;
    box.innerHTML = `
      <div class="live-map-wrap">
        <div class="kmap" id="liveMap"></div>
        <button type="button" class="live-btn live-fs" id="liveFs">${icon('arrow-square-out-bold')}<span>Agrandir</span></button>
        <button type="button" class="live-btn live-center" id="liveCenter" hidden>${icon('map-pin-bold')}<span>Recentrer</span></button>
      </div>
      <div class="live-sheet">
        <div class="live-top"><span class="live-dot"></span><small id="liveKicker">Suivi en direct</small></div>
        <div class="live-eta2"><b id="liveClock">…</b><span id="liveSub">Recherche de la position du livreur…</span></div>
        <div class="live-bar"><span id="liveBar" style="width:6%"></span></div>
        <ol class="live-steps" id="liveSteps"></ol>
        <div class="live-courier" id="liveCourier" hidden></div>
        <p class="live-note" id="liveNote" hidden></p>
        <div id="livePick"></div>
      </div>`;
    const hhmm = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const ll = (p) => [p.lat, p.lng];
    const riderIcon = () => L.divIcon({ className: 'kmap-rider', iconSize: [46, 46], iconAnchor: [23, 23], html: '<span class="rider-halo"></span><span class="rider-dot"><i class="rider-arrow"></i></span>' });
    const setHeading = (h) => { const a = rider?.getElement()?.querySelector('.rider-arrow'); if (a && h != null) a.style.transform = `rotate(${h}deg)`; };
    const pathFrom = (pos) => (data?.route?.length ? [ll(pos), ...data.route.slice(1)] : home ? [ll(pos), home.getLatLng()] : [ll(pos)]);
    const drawPath = (pos) => {
      const pts = pathFrom(pos);
      if (pts.length < 2) return;
      const roads = data?.routeKind === 'roads' && data?.route?.length > 1;
      if (!line) {
        casing = L.polyline(pts, { color: '#fff', weight: 9, opacity: 0.9, lineCap: 'round' }).addTo(map);
        line = L.polyline(pts, { color: '#1E56C2', weight: 5, opacity: 0.95, lineCap: 'round', dashArray: roads ? null : '2 10' }).addTo(map);
      } else { casing.setLatLngs(pts); line.setLatLngs(pts); line.setStyle({ dashArray: roads ? null : '2 10' }); }
    };
    const fit = () => {
      if (!map || !follow) return;
      const pts = [rider?.getLatLng(), home?.getLatLng()].filter(Boolean);
      if (!pts.length) return;
      const full = box.classList.contains('full');
      if (pts.length === 1) map.setView(pts[0], 16, { animate: !reduce });
      else map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 70], paddingBottomRight: [40, full ? 300 : 40], maxZoom: 17, animate: !reduce });
    };
    // Le livreur glisse de son ancienne à sa nouvelle position (au lieu de sauter)
    const moveRider = (to, heading) => {
      cancelAnimationFrame(anim);
      if (!rider) { rider = L.marker(ll(to), { icon: riderIcon(), zIndexOffset: 1000, keyboard: false, title: 'Votre livreur' }).addTo(map); setHeading(heading); drawPath(to); return; }
      setHeading(heading);
      const from = rider.getLatLng();
      if (reduce) { rider.setLatLng(ll(to)); drawPath(to); return; }
      const t0 = performance.now(), dur = 3600;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const p = { lat: from.lat + (to.lat - from.lat) * e, lng: from.lng + (to.lng - from.lng) * e };
        rider.setLatLng(ll(p)); drawPath(p);
        if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    };
    const renderSteps = (d) => {
      const st = d.steps || {};
      const items = [['Commande confirmée', st.confirmedAt], [`Confiée à ${d.courier?.name || 'votre livreur'}`, st.assignedAt], ['En route vers vous', st.startedAt], ['Arrivé', st.arrivedAt]];
      const cur = items.findIndex(([, at]) => !at);
      $('#liveSteps').innerHTML = items.map(([t, at], k) => `<li class="${at ? 'done' : k === cur ? 'now' : ''}"><i></i><span>${esc(t)}${at ? `<small>${hhmm(at)}</small>` : ''}</span></li>`).join('');
    };
    const renderCourier = (d) => {
      const c = d.courier; if (!c) return;
      const el = $('#liveCourier'); el.hidden = false;
      el.innerHTML = `<span class="av">${esc(c.initial || 'L')}</span><div><b>${esc(c.name)}</b><small>${c.vehicle ? esc(c.vehicle) : 'Livreur Zado'}</small></div>
        <div class="acts"><button type="button" class="live-act" id="liveMsg">${icon('chat-circle-dots-fill')}<span>Message</span></button>${d.supportPhone ? `<a class="live-act" href="tel:${esc(String(d.supportPhone).replace(/[^\d+]/g, ''))}">${icon('phone-bold')}<span>Appeler</span></a>` : ''}</div>`;
      $('#liveMsg').addEventListener('click', () => { closeFull(); window.kamwaChat?.open(); });
    };
    const note = (html) => { const n = $('#liveNote'); n.hidden = !html; n.innerHTML = html || ''; };
    // Pas d'adresse sur la carte : le client la place (comme le point de dépôt dans Grab)
    const askPin = () => {
      if (picking || !map) return;
      $('#livePick').innerHTML = `<div class="live-pick">${icon('map-pin-bold')}<span><b>Où êtes-vous exactement ?</b> Touchez la carte à l'endroit de la livraison : votre livreur vous trouve plus vite et vous voyez l'heure d'arrivée.</span><button type="button" class="btn cta small" id="pickOk" disabled>Confirmer ce point</button></div>`;
      picking = true;
      map.on('click', (e) => {
        if (!picking) return;
        if (!pickMk) pickMk = L.marker(e.latlng, { icon: kamwaMap.pin(L, 'home'), draggable: true }).addTo(map); else pickMk.setLatLng(e.latlng);
        $('#pickOk').disabled = false;
      });
      $('#livePick').addEventListener('click', async (e) => {
        if (!e.target.closest('#pickOk') || !pickMk) return;
        const p = pickMk.getLatLng();
        try {
          await api('/orders/' + enc(id) + '/location', { method: 'POST', headers: orderHeaders(tokenOf(id) || ''), body: { location: { lat: p.lat, lng: p.lng } } });
          picking = false; pickMk.remove(); pickMk = null; $('#livePick').innerHTML = ''; toast('Adresse enregistrée : votre livreur la voit'); tick();
        } catch (err) { toast(err.message); }
      });
    };
    async function tick() {
      if (!document.body.contains(box) || (box.classList.contains('full') && !document.body.contains(spot))) return;
      let d; try { d = await api('/orders/' + enc(id) + '/live', { headers: orderHeaders(tokenOf(id) || '') }); } catch { return; }
      if (d.status !== 'shipped') { closeFull(); route({ keep: true }); return; }
      data = d;
      if (!map) {
        try {
          ({ L, map } = await kamwaMap.create($('#liveMap'), { center: d.courier?.lat ? [d.courier.lat, d.courier.lng] : d.destination ? ll(d.destination) : null, zoom: 15 }));
          // Le client déplace ou zoome la carte lui-même : on arrête de la recadrer, bouton « Recentrer »
          const byHand = () => { if (picking) return; follow = false; $('#liveCenter').hidden = false; };
          ['pointerdown', 'wheel', 'touchstart'].forEach((ev) => $('#liveMap').addEventListener(ev, byHand, { passive: true }));
        } catch { $('#liveMap')?.remove(); }
      }
      if (map && d.destination && !home) home = L.marker(ll(d.destination), { icon: kamwaMap.pin(L, 'home'), title: 'Votre adresse' }).addTo(map);
      renderSteps(d); renderCourier(d);
      if (!d.active) {
        $('#liveKicker').textContent = 'Livraison en cours';
        $('#liveClock').textContent = d.courier ? `${d.courier.name} est en route` : 'Votre colis est en route';
        $('#liveSub').textContent = d.waiting ? 'Le suivi sur la carte apparaîtra dès que le livreur partagera sa position. Il vous appelle avant d\'arriver.' : 'Le suivi sur la carte commence quand le livreur part.';
        note(''); if (!d.destination) askPin();
        return;
      }
      const c = d.courier;
      if (d.arrived) {
        $('#liveKicker').textContent = 'Votre livreur est arrivé';
        $('#liveClock').textContent = `${c.name} est là`;
        $('#liveSub').innerHTML = order.deliveryCode ? `Donnez votre code <b class="mono">${esc(order.deliveryCode)}</b> seulement quand vous avez le colis en main.` : 'Donnez votre code de livraison seulement quand vous avez le colis en main.';
      } else if (d.etaAt) {
        $('#liveKicker').textContent = d.near ? `${c.name} arrive` : 'Arrivée prévue';
        $('#liveClock').textContent = d.near ? 'Dans un instant' : `vers ${hhmm(d.etaAt)}`;
        $('#liveSub').textContent = `${d.etaMin} min · ${String(d.distanceKm).replace('.', ',')} km${d.routeKind === 'direct' ? ' environ' : ''}`;
      } else {
        $('#liveKicker').textContent = `${c.name} est en route`;
        $('#liveClock').textContent = 'En route';
        $('#liveSub').textContent = 'Placez votre adresse sur la carte pour voir l\'heure d\'arrivée.';
      }
      $('#liveBar').style.width = Math.max(6, Math.min(100, Math.round((d.arrived ? 1 : d.progress || 0) * 100))) + '%';
      note(c.ageSec > 45 ? `${icon('clock-bold')} Dernière position il y a ${c.ageSec < 120 ? c.ageSec + ' s' : Math.round(c.ageSec / 60) + ' min'} : le réseau du livreur est faible.`
        : d.stopsBefore ? `${icon('package')} ${esc(c.name)} termine ${d.stopsBefore} livraison${d.stopsBefore > 1 ? 's' : ''} avant la vôtre.` : '');
      if (!d.destination) askPin();
      if (map) {
        const first = !rider;
        moveRider({ lat: c.lat, lng: c.lng }, c.heading);
        if (first || follow) { fit(); }
      }
    }
    // Plein écran (comme l'écran de course de Grab) : carte entière + volet d'informations en bas
    // (le volet est déplacé à la racine de la page : l'animation d'apparition des pages l'empêcherait de couvrir l'écran)
    const spot = document.createComment('suivi');
    const closeFull = () => {
      if (!box.classList.contains('full')) return;
      box.classList.remove('full'); document.body.classList.remove('live-open');
      if (spot.parentNode) spot.replaceWith(box);
      const b = box.querySelector('#liveFs'); if (b) b.innerHTML = `${icon('arrow-square-out-bold')}<span>Agrandir</span>`;
      setTimeout(() => { map?.invalidateSize(); fit(); }, 60);
    };
    box.querySelector('#liveFs').addEventListener('click', () => {
      const on = !box.classList.contains('full');
      if (on) { box.replaceWith(spot); document.body.appendChild(box); box.classList.add('full'); document.body.classList.add('live-open'); box.querySelector('#liveFs').innerHTML = `${icon('x-bold')}<span>Fermer</span>`; } else closeFull();
      setTimeout(() => { map?.invalidateSize(); follow = true; $('#liveCenter').hidden = true; fit(); }, 60);
    });
    $('#liveCenter').addEventListener('click', () => { follow = true; $('#liveCenter').hidden = true; fit(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape' && box.classList.contains('full')) closeFull(); if (!document.body.contains(box)) document.removeEventListener('keydown', esc); });
    tick();
    state.timers.push(setInterval(() => { if (!document.hidden) tick(); }, 4000));
    const onLive = () => tick();
    window.addEventListener('kamwa-live', onLive);
    const gone = () => !document.body.contains(box.classList.contains('full') ? spot : box);
    const stopLive = () => { if (gone()) { cancelAnimationFrame(anim); box.classList.contains('full') && (box.remove(), document.body.classList.remove('live-open')); window.removeEventListener('kamwa-live', onLive); window.removeEventListener('hashchange', stopLive); } };
    window.addEventListener('hashchange', stopLive);
  }

  // ---------- Pages légales (textes dans /js/legal.js) ----------
  function viewLegal(key) {
    renderNav(null);
    const page = window.KAMWA_LEGAL?.[key];
    if (!page) return viewHome();
    app.innerHTML = `
      <article class="legal">
        <p class="legal-kicker">Informations légales</p>
        <h1>${esc(page.title)}</h1>
        <p class="legal-date">Dernière mise à jour : ${esc(page.updated)}</p>
        ${page.html}
        <nav class="legal-nav">${Object.entries(window.KAMWA_LEGAL).map(([k, x]) => `<a href="#/legal/${k}" class="${k === key ? 'on' : ''}">${esc(x.title)}</a>`).join('')}<a href="#/cookies">Gérer les cookies</a></nav>
      </article>`;
    const anchor = location.hash.split('#')[2];
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
  }

  // ---------- Routeur ----------
  // ---------- Site « vivant » : données toujours à jour, sans relancer l'application ----------
  // 1) À chaque changement de page : compte client revérifié (pièce validée, déconnexion…) et catalogue
  //    rechargé s'il date de plus de 30 s (prix, stock, nouveaux produits) ; la page se redessine si quelque chose a changé.
  // 2) Sur les pages qui attendent une action de Zado (mon compte, suivi, merci, commande bloquée), on revérifie
  //    toutes les 15 s tant que la page est affichée, et dès qu'on revient sur l'application.
  //    On ne redessine jamais une page pendant que le client écrit ou a choisi une photo.
  const currentParts = () => (location.hash || '#/').slice(2).split('#')[0].split('/').map(decodeURIComponent);
  const custSig = (c) => JSON.stringify(c ? [c.id, c.name, c.idStatus, c.idRejectReason] : null);
  const prodSig = (list) => JSON.stringify((list || []).map((p) => [p.id, p.price, p.oldPrice, p.stock, p.active, p.image, p.name]));
  let productsAt = Date.now();
  let liveBase = null; let liveBusy = false;
  const userBusy = () => {
    const a = document.activeElement;
    if (a && app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'radio' && a.type !== 'checkbox') return true;
    if ($('#idPreview') && !$('#idPreview').hidden) return true; // photo de pièce choisie, pas encore envoyée
    if ($('#checkoutForm') || $('.cam-overlay') || $('.code-reveal')) return true; // commande en cours, appareil photo, nouveau code affiché : on n'y touche pas
    return [...app.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=hidden]), textarea')].some((i) => i.value && i.defaultValue !== i.value);
  };
  async function refreshProducts(force) {
    if (!force && Date.now() - productsAt < 30000) return false;
    productsAt = Date.now();
    try {
      const fresh = await api('/products');
      if (prodSig(fresh) === prodSig(state.products)) return false;
      state.products = fresh;
      UNIVERSES = (state.config.universes || []).map((u) => ({ ...u, categories: u.categories.filter((c) => state.products.some((p) => p.category === c)) })).filter((u) => u.categories.length);
      $('#menuBody').innerHTML = ''; // menu « Rayons » reconstruit avec les nouveaux rayons
      return true;
    } catch { return false; }
  }
  // Empreinte de ce qu'affiche la page (pour savoir s'il faut la redessiner)
  async function pageSig(parts) {
    try {
      if (parts[0] === 'compte' || parts[0] === 'commande') {
        const me = await api('/account/me');
        let sig = custSig(me.loggedIn ? me.customer : null);
        if (parts[0] === 'compte' && me.loggedIn) sig += JSON.stringify((await api('/account/orders')).map((o) => [o.id, o.status, o.paidAt, (o.attempts || []).length]));
        return sig;
      }
      if (parts[0] === 'suivi' || parts[0] === 'merci') {
        const o = await api('/orders/' + enc(parts[1]), { headers: orderHeaders(tokenOf(parts[1]) || '') });
        return JSON.stringify([o.status, o.paidAt, o.attempts, o.fulfillment, o.planned, o.parcels]);
      }
    } catch {}
    return null;
  }
  const LIVE_PAGES = ['compte', 'commande', 'suivi', 'merci'];
  async function armLive() {
    const parts = currentParts();
    liveBase = LIVE_PAGES.includes(parts[0]) ? { key: location.hash, sig: await pageSig(parts) } : null;
  }
  async function pulse() {
    if (document.hidden || liveBusy) return;
    liveBusy = true;
    try {
      const parts = currentParts();
      // Compte client (bouton « Mon compte » de l'en-tête) toujours à jour
      const before = custSig(state.customer);
      await refreshCustomer();
      const changedCustomer = before !== custSig(state.customer);
      if (await refreshProducts(false) && ['', 'c', 'recherche', 'promos', 'p'].includes(parts[0]) && !userBusy()) { route({ keep: true }); return; }
      if (liveBase && liveBase.key === location.hash) {
        const sig = await pageSig(parts);
        if (sig !== null && sig !== liveBase.sig && !userBusy()) { liveBase.sig = sig; route({ keep: true }); return; }
      } else if (changedCustomer && LIVE_PAGES.includes(parts[0]) && !userBusy()) route({ keep: true });
    } finally { liveBusy = false; }
  }
  setInterval(pulse, 15000);

  // Signal instantané du serveur (« quelque chose a changé pour vous ») : la page se met à jour tout de suite.
  // Reconnexion automatique ; si le flux est coupé, les vérifications régulières ci-dessus prennent le relais.
  let es = null; let esFor = undefined;
  function connectEvents() {
    const who = state.customer?.id || null;
    if (es && esFor === who) return;
    es?.close(); esFor = who;
    if (!('EventSource' in window)) return;
    es = new EventSource('/api/events');
    es.addEventListener('change', (e) => {
      let t = {}; try { t = JSON.parse(e.data); } catch {}
      if (t.topic === 'catalog') productsAt = 0;
      if (t.topic === 'chat') window.kamwaChat?.refresh?.();
      if (t.topic === 'live') { window.dispatchEvent(new CustomEvent('kamwa-live')); return; }
      if (t.topic === 'maintenance') { checkMaintenance(); return; }
      pulse();
    });
  }
  setInterval(connectEvents, 5000); // compte connecté / déconnecté : on rouvre le flux avec les bons droits
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pulse(); });
  window.addEventListener('online', () => pulse());

  function route(opts = {}) {
    state.timers.forEach(clearInterval); state.timers = [];
    const parts = currentParts();
    document.body.dataset.route = parts[0] || 'accueil'; // sert au style (ex. bulle « Aide » réduite sur les pages d'achat)
    renderMaintenance();
    if (parts[0] !== 'recherche') $('.header').classList.remove('search-open');
    if (parts[0] !== 'recherche') $('#searchInput').value = '';
    markTab(parts[0]);
    if (opts.keep) { const y = window.scrollY; [0, 150, 450].forEach((ms) => setTimeout(() => { if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y); }, ms)); }
    if (!opts.keep) {
      window.scrollTo(0, 0);
      // Changement de page : le compte et le catalogue sont revérifiés en arrière-plan
      setTimeout(() => { pulse(); }, 50);
    }
    setTimeout(armLive, 400);
    setTimeout(renderThemeSwitches, 0);
    switch (parts[0]) {
      case 'c': return viewCategory(parts[1], parts[2]);
      case 'p': return viewProduct(parts[1]);
      case 'recherche': return viewSearch(parts.slice(1).join('/'));
      case 'promos': return viewPromos();
      case 'commande': return viewCheckout();
      case 'merci': return viewThanks(parts[1]);
      case 'compte': return viewAccount(parts[1]);
      case 'suivi': return viewTracking(parts[1]);
      case 'demo-suivi': // démo : course simulée (clé publique de la commande CMD-DEMO-0002)
        if (state.config.demoTrack) { rememberOrder(state.config.demoTrack.id, state.config.demoTrack.token); location.replace('#/suivi/' + state.config.demoTrack.id); return; }
        return viewHome();
      case 'credits': return viewCredits();
      case 'legal': return viewLegal(parts[1]);
      case 'cookies': renderNav(null); return window.kamwaConsent?.renderSettings(app);
      default: return viewHome();
    }
  }

  (async () => {
    app.innerHTML = '<p class="empty">Chargement…</p>';
    try {
      [state.products, state.config] = await Promise.all([api('/products'), api('/config')]);
      // On n'affiche que les rayons qui ont au moins un produit visible (les rayons vides réapparaissent
      // automatiquement dès qu'un produit y est ajouté ou réaffiché depuis l'admin).
      // Vitrine de démonstration (Vercel) : bandeau bien visible, pour que personne ne prenne le site pour la vraie boutique
      if (state.config.demo && !document.querySelector('.demo-strip')) {
        document.body.insertAdjacentHTML('afterbegin', `<div class="demo-strip">Site de démonstration : commandes fictives, aucun paiement réel, données remises à zéro régulièrement.${state.config.demoTrack ? ' <a href="#/demo-suivi">Voir une course en direct</a>' : ''}</div>`);
      }
      UNIVERSES = (state.config.universes || [])
        .map((u) => ({ ...u, categories: u.categories.filter((c) => state.products.some((p) => p.category === c)) }))
        .filter((u) => u.categories.length);
    } catch {
      app.innerHTML = '<p class="empty">Connexion impossible. Vérifiez votre réseau.</p>';
      return;
    }
    renderCart();
    setMaintenance(state.config.maintenance);
    renderDeliverCity(); // villes de livraison réglées dans Zado Pro
    $('#year').textContent = new Date().getFullYear();
    const last = loadJSON('kamwa-last-order');
    if (last?.id && !tokenOf(last.id)) rememberOrder(last.id, last.token);
    await refreshCustomer();
    window.addEventListener('hashchange', route);
    route();
  })();
})();
