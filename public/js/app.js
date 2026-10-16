// Kamwa — front-end léger (aucune dépendance) pour rester rapide sur les réseaux mobiles.
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;

  // Univers et catégories affichés dans le menu : fournis par le serveur (src/catalog.js), même liste que l'admin
  let UNIVERSES = [];
  // Icônes Phosphor (fichier /icons.svg, récupérées via Iconify)
  const icon = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="/icons.svg?v=7#${name}"></use></svg>`;
  const ICONS = { 'Téléphones': 'device-mobile-duotone', 'Tablettes': 'device-tablet-duotone', 'Ordinateurs': 'laptop-duotone', 'Montres': 'watch-duotone', 'Audio': 'headphones-duotone', 'TV & Maison': 'television-duotone', 'Jeux vidéo & consoles': 'game-controller-duotone', 'Composants': 'cpu-duotone', 'Accessoires': 'plug-duotone', 'Homme': 't-shirt-duotone', 'Femme': 'dress-duotone', 'Chaussures': 'sneaker-duotone' };
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
    if (!res.ok) throw Object.assign(new Error(data.error || 'Erreur réseau, réessayez.'), { data });
    return data;
  }

  // ---------- Commande en cours (une seule commande et un seul paiement par panier) ----------
  // On garde la commande et sa clé secrète : si le client réessaie, recharge la page ou revient plus tard,
  // on reprend la même commande au lieu d'en créer une nouvelle (ce qui pourrait le faire payer deux fois).
  const cartKey = () => JSON.stringify(Object.entries(state.cart).sort());
  const loadJSON = (key) => { try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; } };
  const saveJSON = (key, value) => { try { value ? localStorage.setItem(key, JSON.stringify(value)) : localStorage.removeItem(key); } catch {} };
  const loadCheckout = () => loadJSON('kamwa-checkout');
  const saveCheckout = (c) => saveJSON('kamwa-checkout', c);
  const orderHeaders = (token) => ({ 'X-Order-Token': token });

  function finishPaid(checkout) {
    if (!checkout.import) { state.cart = {}; saveCart(); saveCheckout(null); } // un achat en Europe ne vide pas le panier
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
    if (isPickup(o) && o.status === 'pending_payment') return 'Réservée — à payer en agence';
    if (isPickup(o) && o.status === 'delivered') return 'Retirée';
    return STATUS[o.status] || o.status;
  };
  const statusBadge = (o) => `<span class="st st-${o.status}">${esc(statusLabel(o))}</span>`;
  // Étapes de suivi : livraison (4 étapes) ou retrait en agence (3 étapes)
  // Achat en Europe : payée → achetée → reçue par l'agent → partie d’Europe → arrivée au Congo → en livraison → livrée
  const IMPORT_STAGE = { to_buy: 1, bought: 2, received: 3, shipped_fr: 4, arrived: 5 };
  const importStep = (o) => (o.status === 'pending_payment' ? 0 : o.status === 'delivered' ? 7 : o.status === 'shipped' ? 6 : IMPORT_STAGE[o.import.stage] ?? 1);
  const stepIndex = (o) => (o.import ? importStep(o) : (isPickup(o) ? { pending_payment: 0, paid: 1, delivered: 2 } : STEP_INDEX)[o.status] ?? -1);
  const stepCount = (o) => (o.import ? 8 : isPickup(o) ? 3 : 4);
  const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const longDate = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const formatCode = (c) => `${c.slice(0, 3)} ${c.slice(3)}`;

  function renderAccountBtn() {
    const first = state.customer ? state.customer.name.split(' ')[0] : '';
    $('#accountHello').textContent = first ? 'Mbote ' + first + ' !' : 'Mon espace';
    $('#accountLabel').textContent = first ? 'Mon compte' : 'Se connecter';
    $('#menuHello').textContent = first ? 'Mbote ' + first + ' !' : 'Mon espace Kamwa';
  }
  async function refreshCustomer() {
    try { const me = await api('/account/me'); state.customer = me.loggedIn ? me.customer : null; } catch {}
    renderAccountBtn();
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
        <div class="line">
          <div>
            <div>${esc(p.name)}</div>
            ${variant ? `<div class="hint">${esc(variantText(variant))}</div>` : ''}${p.origin === 'FR' ? `<div class="hint fr-hint">${icon('airplane-tilt')} Venu d’Europe · ${esc(state.frDelay || '10 jours maximum')}</div>` : ''}
            <div class="qty">
              <button data-qty="${esc(key)}" data-d="-1" aria-label="Retirer un">−</button>
              <span>${qty}</span>
              <button data-qty="${esc(key)}" data-d="1" aria-label="Ajouter un">+</button>
            </div>
          </div>
          <strong>${fcfa(p.price * qty)}</strong>
        </div>`).join('')
      : '<p class="empty">Votre panier est vide.</p>';
  }

  // ---------- Tiroir panier ----------
  const drawer = $('#drawer');
  const openDrawer = () => { drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); };
  const closeDrawer = () => { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); };
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
  $('#searchCat').addEventListener('change', () => {
    const o = $('#searchCat').selectedOptions[0];
    $('#searchCatLabel').textContent = o.value ? o.textContent.trim() : 'Rayons';
  });

  // Ville de livraison (en-tête) : retenue pour pré-remplir la commande
  function renderDeliverCity() {
    const city = loadJSON('kamwa-customer')?.city || 'Pointe-Noire';
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
  $('#menuClose').addEventListener('click', () => openMenu(false));
  menu.addEventListener('click', (e) => { if (e.target === menu || e.target.closest('a')) openMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('open')) openMenu(false); });

  // ---------- Menu catégories ----------
  function renderNav(active) {
    const links = [`<a href="#/" class="${!active ? 'active' : ''}">Accueil</a>`];
    for (const u of UNIVERSES) {
      links.push(`<a href="#/c/${enc(u.name)}" class="${active === u.name ? 'active' : ''}">${esc(u.name)}</a>`);
      for (const c of u.categories) links.push(`<a href="#/c/${enc(u.name)}/${enc(c)}" class="${active === c ? 'active' : ''}">${esc(c)}</a>`);
    }
    links.push(`<a href="#/promos" class="deals-link ${active === 'promos' ? 'active' : ''}">Bonnes affaires</a>`);
    links.splice(1, 0, `<a href="#/europe" class="france-link ${active === 'france' ? 'active' : ''}">${icon('airplane-tilt')} Achat en Europe</a>`);
    $('#catnav').innerHTML = links.join('');
    // Menu « Toutes » et liste des rayons de la recherche (une seule fois)
    if (!$('#menuBody').innerHTML) {
      $('#menuBody').innerHTML = `<h3>À la une</h3>
        <a href="#/promos">${icon('seal-percent')} Bonnes affaires</a>
        <a href="#/europe">${icon('airplane-tilt')} Achat en Europe</a>` +
        UNIVERSES.map((u) => `<h3>${esc(u.name)}</h3><a href="#/c/${enc(u.name)}">Tout ${esc(u.name.toLowerCase())}</a>` +
          u.categories.map((c) => `<a href="#/c/${enc(u.name)}/${enc(c)}">${catIcon(c)} ${esc(c)}</a>`).join('')).join('') +
        `<h3>Aide et compte</h3><a href="#/compte">${icon('user-circle')} Mon compte et mes commandes</a>
        <a href="#/legal/vente">${icon('arrow-counter-clockwise')} Livraison et retours</a>`;
      $('#searchCat').innerHTML = '<option value="">Tous les rayons</option>' +
        UNIVERSES.map((u) => `<option value="u:${esc(u.name)}">${esc(u.name)}</option>` + u.categories.map((c) => `<option value="c:${esc(c)}">&nbsp;&nbsp;${esc(c)}</option>`).join('')).join('');
    }
    $('#footerShop').innerHTML = UNIVERSES.map((u) => `<li><a href="#/c/${enc(u.name)}">${esc(u.name)}</a></li>`).join('') + '<li><a href="#/promos">Bonnes affaires</a></li>';
  }

  // ---------- Composants ----------
  const discount = (p) => (p.oldPrice && p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0);

  // Image du produit si elle existe, sinon pictogramme sur fond coloré (repli)
  function visual(p, cls = 'thumb') {
    if (p.image) {
      return `<div class="${cls} has-img" style="--fallback:${esc(p.color || '#2D1B69')}">${catIcon(p.category, 'fallback-ico')}
        <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('img-failed');this.remove()">`;
    }
    return `<div class="${cls} no-img tint-${tintOf(p.category)}">${catIcon(p.category)}`;
  }

  function card(p) {
    const d = discount(p);
    const tag = p.origin === 'FR' ? `<span class="tag tag-fr">${icon('airplane-tilt')} Venu d’Europe</span>`
      : p.condition && p.condition !== 'neuf' ? `<span class="tag tag-violet">${esc(p.condition === 'reconditionné' ? 'Reconditionné' : 'Occasion')}</span>`
      : p.featured ? '<span class="tag tag-mango">Nouveau</span>' : '';
    return `
      <article class="card">
        <a href="#/p/${p.id}" class="card-link">
          ${visual(p)}</div>
          ${d ? `<span class="disc">-${d} %</span>` : ''}
        </a>
        <div class="card-body">
          <div class="card-tag">${tag}</div>
          <a href="#/p/${p.id}"><h3>${esc(p.name)}</h3></a>
          <div class="prices"><span class="price">${fcfa(p.price)}</span><span class="old">${d ? fcfa(p.oldPrice) : ''}</span></div>
          <span class="stock-low">${p.stock > 0 && p.stock <= 6 ? `${icon('fire')} Plus que ${p.stock} en stock` : ''}</span>
          <button class="btn cta small" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>${p.stock === 0 ? 'Épuisé' : (p.options || []).length ? 'Choisir' : `${icon('plus')} Ajouter`}</button>
        </div>
      </article>`;
  }

  // Rangée de produits défilante, avec flèches sur ordinateur (glisser au doigt sur téléphone)
  let railSeq = 0;
  function railCarousel(list) {
    const id = 'rail' + ++railSeq;
    return `<div class="rail-wrap">
      <button class="rail-arrow prev" data-rail="${id}" data-dir="-1" aria-label="Produits précédents">${icon('caret-left')}</button>
      <div class="rail" id="${id}">${list.map(card).join('')}</div>
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
      state.timers.push(setInterval(() => { if (!paused && !document.hidden) go(cur() + 1); }, delay));
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
    const heroP = withImg(state.products.filter((p) => p.featured)) || withImg(state.products);
    const used = new Set([heroP?.id]);
    const pick = (list) => { const p = list.find((x) => x.image && !used.has(x.id)); if (p) used.add(p.id); return p; };

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
          ${p?.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" ${p === heroP ? '' : 'loading="lazy"'}>` : ''}
          ${p && discount(p) ? `<span class="slide-badge">-${discount(p)} %</span>` : ''}
        </div>
      </div>`;
    const slides = [];
    if (heroP) slides.push(slide({ theme: 'violet', kicker: `${icon('sparkle-fill')} Nouveauté`, title: esc(heroP.name.replace(/^Apple /, '')), text: `À partir de <strong>${fcfa(heroP.price)}</strong>, livré chez vous en 24-48 h.`, href: `#/p/${heroP.id}`, cta: 'Je le veux', p: heroP }));
    if (deals.length) slides.push(slide({ theme: 'coral', kicker: `${icon('lightning-fill')} Bonnes affaires`, title: `Jusqu'à -${discount(deals[0])} %`, text: 'Des prix cassés sur une sélection de produits, dans la limite des stocks.', href: '#/promos', cta: 'Voir les offres', p: pick(deals) }));
    for (const u of UNIVERSES) {
      const p = pick(featured(u.name));
      if (p) slides.push(slide({ theme: 'mango', kicker: esc(u.name), title: u.name === 'Mode' ? 'Le style, sans se ruiner' : 'Le meilleur de la tech', text: esc(u.categories.slice(0, 4).join(' · ')), href: `#/c/${enc(u.name)}`, cta: 'Découvrir', p }));
    }
    slides.splice(1, 0, slide({
      theme: 'violet', kicker: `${icon('airplane-tilt')} Nouveau`, title: 'Achetez en Europe, recevez au Congo', text: 'Des produits venus d’Europe à un prix tout compris en FCFA : transport en avion et douane inclus, payé en Mobile Money, livré chez vous.', href: '#/france', cta: 'Voir les produits',
      extra: '<div class="pay-chips"><span>Avion</span><span>Prix tout compris</span><span>Suivi étape par étape</span></div>',
    }));
    slides.push(slide({
      theme: 'light', kicker: `${icon('wallet')} Paiement`, title: 'Payez comme vous voulez', text: 'Vous validez le paiement sur votre téléphone, avec votre code secret.', href: '#/promos', cta: 'Commencer mes achats',
      extra: '<div class="pay-chips"><span><i class="dot mtn"></i>MTN MoMo</span><span><i class="dot airtel"></i>Airtel Money</span><span>' + icon('credit-card') + 'Carte</span><span>' + icon('storefront') + 'Espèces en agence</span></div>',
    }));

    const [h, m, sec] = untilMidnight();
    const tints = ['violet', 'mango', 'coral'];
    app.innerHTML = `
      <section class="hero slider" id="hero" aria-roledescription="carrousel" aria-label="Offres du moment">
        <div class="slider-track">${slides.join('')}</div>
        <button type="button" class="slider-arrow prev" data-slide="-1" aria-label="Offre précédente">${icon('caret-left')}</button>
        <button type="button" class="slider-arrow next" data-slide="1" aria-label="Offre suivante">${icon('caret-right')}</button>
        <div class="slider-dots"></div>
      </section>

      <nav class="bubbles" aria-label="Rayons">
        ${UNIVERSES.flatMap((u) => u.categories).map((c, i) => `<a href="#/c/${enc(universeOf(c))}/${enc(c)}"><span class="ic tint-${tints[i % 3]}">${icon((ICONS[c] || 'shopping-bag-duotone').replace('-duotone', ''))}</span>${esc(c)}</a>`).join('')}
      </nav>

      ${deals.length ? `<section class="shelf flash">
        <div class="shelf-head">
          <div><p class="kicker">${icon('fire')} Ventes flash</p><h2>Les prix fondent aujourd'hui</h2></div>
          <div class="countdown" aria-label="Temps restant"><span>Fin dans</span><b id="cdH">${h}</b>:<b id="cdM">${m}</b>:<b id="cdS">${sec}</b></div>
        </div>
        ${railCarousel(deals)}
      </section>` : ''}

      <section class="duo">
        <a class="promo-card pc-violet" href="#/compte/creer">
          <span class="ic">${icon('gift')}</span>
          <span><b>Créez votre compte Kamwa</b><small>Gratuit, sans SMS : suivez vos commandes et retrouvez vos achats.</small></span>
          <span class="go">${icon('arrow-right')}</span>
        </a>
        <a class="promo-card pc-mango" href="#/legal/vente">
          <span class="ic">${icon('truck')}</span>
          <span><b>Livré en 24-48 h</b><small>À Pointe-Noire et Brazzaville, ou retrait en agence.</small></span>
          <span class="go">${icon('arrow-right')}</span>
        </a>
      </section>

      ${UNIVERSES.map((u, i) => `
        <section class="shelf">
          <div class="shelf-head">
            <div><p class="kicker k-${tints[(i + 1) % 3]}">${esc(u.name)}</p><h2>${i === 0 ? 'Nos coups de cœur' : 'À ne pas manquer'}</h2></div>
            <a class="see-all" href="#/c/${enc(u.name)}">Tout voir ${icon('caret-right')}</a>
          </div>
          ${railCarousel(featured(u.name))}
        </section>`).join('')}

      <section class="shelf">
        <div class="shelf-head"><div><p class="kicker">${icon('seal-check-duotone')} Acheter en confiance</p><h2>Pourquoi choisir Kamwa</h2></div></div>
        <div class="reassure">
          <div class="r-violet"><span class="ic">${icon('credit-card')}</span><b>Paiement simple</b><p>Mobile Money (MTN, Airtel), carte bancaire ou espèces en agence.</p></div>
          <div class="r-mango"><span class="ic">${icon('truck')}</span><b>Livraison rapide</b><p>24-48 h à Pointe-Noire et Brazzaville. Autres villes sur demande.</p></div>
          <div class="r-coral"><span class="ic">${icon('storefront')}</span><b>Retrait en agence</b><p>Réservez en ligne, payez et repartez avec votre commande.</p></div>
          <div class="r-green"><span class="ic">${icon('chat-circle')}</span><b>Service client</b><p>Nous vous appelons après chaque commande.</p></div>
        </div>
      </section>`;

    setupSlider($('#hero'));
    state.timers.push(setInterval(() => {
      const [hh, mm, ss] = untilMidnight();
      if (!$('#cdS')) return;
      $('#cdH').textContent = hh; $('#cdM').textContent = mm; $('#cdS').textContent = ss;
    }, 1000));
  }

  function viewList({ title, crumbs, list, active, chips }) {
    renderNav(active);
    app.innerHTML = `
      <div class="crumbs">${crumbs}</div>
      <div class="list-head">
        <h1>${esc(title)} <small style="color:var(--muted);font-weight:400;font-size:.85rem">(${list.length} produit${list.length > 1 ? 's' : ''})</small></h1>
        <select id="sort" aria-label="Trier">
          <option value="pertinence">Trier : pertinence</option>
          <option value="prix-asc">Prix croissant</option>
          <option value="prix-desc">Prix décroissant</option>
          <option value="remise">Meilleures remises</option>
        </select>
      </div>
      ${chips || ''}
      ${list.length ? `<div class="grid">${sortList(list).map(card).join('')}</div>` : '<p class="empty">Aucun produit trouvé. Essayez un autre mot-clé.</p>'}`;
    const sel = $('#sort'); sel.value = state.sort;
    sel.addEventListener('change', () => { state.sort = sel.value; route(); });
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
    let list = [];
    try { list = await api('/products?q=' + enc(q)); } catch {}
    const cat = searchCat();
    if (cat) list = list.filter((p) => (cat.startsWith('u:') ? p.universe === cat.slice(2) : p.category === cat.slice(2)));
    viewList({ title: `Résultats pour « ${q} »`, crumbs: '<a href="#/">Accueil</a> › Recherche', list, active: null });
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
          ${p.condition && p.condition !== 'neuf' ? `<span class="cond-tag">${esc(p.condition === 'reconditionné' ? 'Reconditionné' : 'Occasion')}</span>` : ''}
          <p>${esc(p.description)}</p>
          ${(p.specs || []).length ? `<table class="specs">${p.specs.map((x) => `<tr><th>${esc(x.label)}</th><td>${esc(x.value)}</td></tr>`).join('')}</table>` : ''}
          <div class="buybox">
            ${d ? `<div><span class="old">${fcfa(p.oldPrice)}</span> <span class="save-tag">Économisez ${fcfa(p.oldPrice - p.price)}</span></div>` : ''}
            <span class="price">${fcfa(p.price)}</span>
            ${(p.options || []).map((o, i) => `<label class="opt-label" for="opt${i}">${esc(o.name)}</label><div class="opt-choices" id="opt${i}" data-opt="${esc(o.name)}">${o.values.map((v) => `<button type="button" class="opt" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>`).join('')}
            ${p.origin === 'FR'
              ? `<span class="momo-note fr-note">${icon('airplane-tilt')} Venu d’Europe par avion · livré en ${esc(state.frDelay || '10 jours maximum')}</span>
                 <span class="hint">${icon('check-circle-duotone')} Prix tout compris (transport et douane inclus) · payable à la commande en Mobile Money ou par carte</span>`
              : `<span class="momo-note">${icon('check-circle-duotone')} Payable en Mobile Money, par carte ou en espèces</span>
            <span class="hint">${icon('truck-duotone')} Livraison 24-48 h à Pointe-Noire et Brazzaville</span>`}
            ${p.stock === 0 ? '<span class="stock-low">Épuisé</span>' : p.stock <= 6 ? `<span class="stock-low">Plus que ${p.stock} en stock</span>` : '<span class="momo-note">En stock</span>'}
            <div id="optErr"></div>
            <button class="btn cta block" ${(p.options || []).length ? 'id="addOpt"' : `data-add="${p.id}"`} ${p.stock === 0 ? 'disabled' : ''}>Ajouter au panier</button>
            <a class="btn ghost block" href="#/commande" id="buyNow">Acheter maintenant</a>
          </div>
        </div>
      </div>
      ${similar.length ? `<section class="shelf"><div class="shelf-head"><div><p class="kicker">${esc(p.category)}</p><h2>Vous aimerez aussi</h2></div></div>${railCarousel(similar)}</section>` : ''}`;
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
    $('#addOpt')?.addEventListener('click', (e) => {
      if (!addWithChoice()) return;
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

    const saved = (() => { try { return JSON.parse(localStorage.getItem('kamwa-customer')) || {}; } catch { return {}; } })();
    if (state.customer) {
      saved.name = saved.name || state.customer.name;
      saved.phone = saved.phone || state.customer.phone || '';
    }
    const total = fcfa(cartTotal());
    const hasFr = items.some((l) => l.product.origin === 'FR');

    app.innerHTML = `
      <h1>Finaliser ma commande</h1>
      ${state.config.paymentMode === 'simulation'
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
              ${['Pointe-Noire', 'Brazzaville', 'Dolisie', 'Autre'].map((c) => `<option ${saved.city === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
            <label for="address">Quartier / adresse / repère</label>
            <textarea id="address" name="address" rows="2" placeholder="Ex. Quartier Tié-Tié, près de la pharmacie…">${esc(saved.address)}</textarea>
          </div>

          <h2 style="margin-top:24px">2. Paiement</h2>
          ${hasFr ? `<div class="alert warn">${icon('airplane-tilt')} Votre panier contient des articles venus d’Europe : nous les achetons pour vous, la commande se paie donc à la commande (Mobile Money ou carte). Livraison de toute la commande en ${esc(state.frDelay || '10 jours maximum')}.</div>` : ''}
          <div class="methods">
            <label class="op"><input type="radio" name="method" value="momo" checked><span>${icon('device-mobile-duotone')}<span class="txt">Mobile Money<small>MTN MoMo · Airtel Money</small></span></span></label>
            ${methods.card ? `<label class="op"><input type="radio" name="method" value="card"><span>${icon('credit-card-duotone')}<span class="txt">Carte bancaire<small>Visa · Mastercard</small></span></span></label>` : ''}
            ${methods.cod?.enabled && !hasFr ? `<label class="op"><input type="radio" name="method" value="cod"><span>${icon('hand-coins-duotone')}<span class="txt">Payer à la réception<small>Espèces ou Mobile Money au livreur${methods.cod.deposit ? ` · acompte de ${fcfa(methods.cod.deposit)} pour confirmer` : ''}</small></span></span></label>` : ''}
            ${methods.cash && !hasFr ? `<label class="op"><input type="radio" name="method" value="cash"><span>${icon('storefront-duotone')}<span class="txt">Espèces en agence<small>Retrait en agence</small></span></span></label>` : ''}
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
            <p class="hint">${icon('lock-key-bold')} Vous allez être redirigé vers la page de paiement sécurisée de notre partenaire bancaire. Kamwa ne voit jamais votre numéro de carte.</p>
          </div>
          <div id="cashFields" hidden>
            <label for="agency">Agence de retrait</label>
            <select id="agency" name="agency">
              ${methods.agencies.map((a) => `<option value="${esc(a.id)}">${esc(a.city)} — ${esc(a.name)}</option>`).join('')}
            </select>
            <p class="hint" id="agencyInfo"></p>
            <p class="hint">Vos articles sont réservés <strong>${methods.pickupHoldHours} h</strong>. Vous payez <strong>${total}</strong> en espèces à l'agence et repartez avec votre commande.</p>
          </div>
          <div id="formError"></div>
          <button class="btn cta block" style="margin-top:16px;min-height:48px;font-size:1rem" id="payBtn">Payer ${total}</button>
        </form>

        <div class="panel">
          <h2>Récapitulatif</h2>
          ${items.map(({ product: p, qty, variant }) => `<div class="line"><span>${qty} × ${esc(p.name)}${variant ? `<br><span class="hint">${esc(variantText(variant))}</span>` : ''}</span><strong>${fcfa(p.price * qty)}</strong></div>`).join('')}
          ${cartSaving() > 0 ? `<div class="row saving" style="margin-top:10px"><span>Vous économisez</span><span>${fcfa(cartSaving())}</span></div>` : ''}
          <div class="row total" style="margin-top:10px"><span>Total</span><strong>${total}</strong></div>
        </div>
      </div>`;

    const form = $('#checkoutForm');
    const BUTTON = { momo: `Payer ${total}`, card: `Payer ${total} par carte`, cash: 'Réserver et payer en agence', cod: 'Confirmer ma commande' };
    const method = () => form.method.value || 'momo';
    // Affiche les champs du moyen de paiement choisi (pas d'adresse de livraison pour un retrait en agence)
    const syncMethod = () => {
      const m = method();
      $('#momoFields').hidden = !(m === 'momo' || (m === 'cod' && methods.cod?.deposit));
      $('#codFields').hidden = m !== 'cod';
      const momoLbl = form.querySelector('label[for="momo"]');
      if (momoLbl) momoLbl.textContent = m === 'cod' ? "Numéro Mobile Money pour l'acompte" : 'Numéro Mobile Money à débiter';
      $('#cardFields').hidden = m !== 'card';
      $('#cashFields').hidden = m !== 'cash';
      $('#deliveryFields').hidden = m === 'cash';
      $('#payBtn').textContent = BUTTON[m];
      const a = methods.agencies.find((x) => x.id === form.agency?.value);
      if (a) $('#agencyInfo').innerHTML = `${icon('map-pin-bold')} ${esc(a.address || 'Adresse communiquée par téléphone')}${a.hours ? `<br>${icon('clock-bold')} ` + esc(a.hours) : ''}${a.phone ? `<br>${icon('phone-bold')} ` + esc(a.phone) : ''}`;
    };
    form.querySelectorAll('input[name="method"]').forEach((r) => r.addEventListener('change', syncMethod));
    form.agency?.addEventListener('change', syncMethod);
    syncMethod();

    // Pré-sélection automatique de l'opérateur selon le préfixe du numéro
    const syncOperator = () => {
      const d = form.momo.value.replace(/\D/g, '').replace(/^242/, '');
      if (d.startsWith('06')) form.operator.value = 'mtn';
      else if (d.startsWith('05') || d.startsWith('04')) form.operator.value = 'airtel';
    };
    form.momo.addEventListener('input', syncOperator);
    syncOperator();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const m = method();
      const err = $('#formError'); err.innerHTML = '';
      const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Envoi de la demande…';
      const agency = methods.agencies.find((x) => x.id === form.agency?.value);
      const customer = m === 'cash'
        ? { name: form.name.value, phone: form.phone.value, city: agency?.city || '', address: `Retrait en agence : ${agency?.name || ''}` }
        : { name: form.name.value, phone: form.phone.value, city: form.city.value, address: form.address.value };
      if (m !== 'cash') { try { localStorage.setItem('kamwa-customer', JSON.stringify(customer)); } catch {} }
      try {
        // Même panier qu'une tentative précédente non payée : on réutilise la commande.
        let checkout = loadCheckout();
        let order = null;
        if (checkout?.cartKey === cartKey()) {
          try { order = await api('/orders/' + enc(checkout.orderId), { headers: orderHeaders(checkout.token) }); } catch {}
          if (['paid', 'confirmed'].includes(order?.status)) return finishPaid(checkout);
          if (order?.status !== 'pending_payment') order = null;
        }
        if (!order) {
          const created = await api('/orders', { method: 'POST', body: { customer, items: items.map(({ product, qty, variant }) => ({ productId: product.id, qty, variant: variant || undefined })) } });
          checkout = { orderId: created.id, token: created.token, cartKey: cartKey() };
          rememberOrder(created.id, created.token);
          saveCheckout(checkout);
        }
        const body = { orderId: checkout.orderId, token: checkout.token, method: m };
        if (m === 'momo' || m === 'cod') Object.assign(body, { phone: form.momo.value, operator: form.operator.value });
        if (m === 'cash') body.agencyId = form.agency.value;
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
        if (p.status === 'FAILED') { if (!checkout.import) saveCheckout({ ...checkout, paymentId: null }); return viewFailed(p); }
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
        ${order.import ? `<p>Nous nous occupons de l'achat de votre article. Vous suivez chaque étape (achat, photos, départ, arrivée) dans « Suivre ma commande ». Délai : ${esc(order.import.delay || '10 jours maximum')}.</p>` : ''}
        ${order.paymentPlan === 'cod' ? `<p>${order.deposit ? `Acompte reçu : ${fcfa(order.deposit)}. ` : ''}Vous paierez <strong>${fcfa(order.balance ?? order.total)}</strong> à la livraison, en espèces ou en Mobile Money.</p>` : ''}
        <p>${order.import ? `Nous vous tenons informé au <strong>${esc(order.customer.phone)}</strong>, puis nous organisons la livraison à ${esc(order.customer.city)} dès l'arrivée au Congo.` : `Nous vous appelons au <strong>${esc(order.customer.phone)}</strong> pour organiser la livraison à ${esc(order.customer.city)}.`}</p>
        ${order.import ? '' : codeCard(order)}
        <p><a class="btn ghost" href="#/suivi/${enc(order.id)}">Suivre ma commande</a></p>` : ''}
        <a class="btn cta" href="#/">Continuer mes achats</a>
      </div>
      ${state.customer ? '' : `<div class="panel" style="text-align:center">
        <strong>Retrouvez vos commandes sur n'importe quel téléphone</strong>
        <p class="hint">Créez votre compte Kamwa en 30 secondes : vous recevez un code à 6 chiffres.</p>
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

  function orderCard(o) {
    const step = stepIndex(o);
    const items = o.lines.reduce((n, l) => n + l.qty, 0);
    return `
      <a class="order-card" href="#/suivi/${enc(o.id)}">
        <div class="top"><strong>${esc(o.id)}</strong>${statusBadge(o)}</div>
        <div class="hint">${shortDate(o.createdAt)} · ${items} article${items > 1 ? 's' : ''} · <strong style="color:var(--ink)">${fcfa(o.total)}</strong></div>
        <div class="hint">${esc(o.lines.map((l) => l.name).join(', ').slice(0, 90))}</div>
        ${o.status === 'cancelled' ? '' : `<div class="progress" style="grid-template-columns:repeat(${stepCount(o)},1fr)">${Array.from({ length: stepCount(o) }, (_, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>`}
      </a>`;
  }

  async function viewAccount(sub) {
    renderNav(null);
    if (sub === 'creer') return viewRegister();
    app.innerHTML = '<p class="empty">Chargement…</p>';
    const list = await loadMyOrders();
    const c = state.customer;

    if (c) {
      const paid = list.filter((o) => ['paid', 'shipped', 'delivered'].includes(o.status));
      app.innerHTML = `
        <div class="panel">
          <div class="row" style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
            <div><h1 style="margin:0">Bonjour ${esc(c.name.split(' ')[0])} ${icon('hand-waving-duotone')}</h1>
              <span class="hint">Identifiant : ${esc([c.phone, c.email].filter(Boolean).join(' · '))} · client depuis le ${shortDate(c.createdAt)}</span></div>
            <button class="btn ghost" id="logoutBtn">Se déconnecter</button>
          </div>
          <div class="stats">
            <div><span class="hint">Commandes payées</span><b>${paid.length}</b></div>
            <div><span class="hint">Total de vos achats</span><b>${fcfa(paid.reduce((s, o) => s + o.total, 0))}</b></div>
          </div>
        </div>
        <div class="panel">
          <h2>Mes commandes</h2>
          ${list.length ? list.map(orderCard).join('') : '<p class="empty">Pas encore de commande. <a href="#/">Découvrir la boutique</a></p>'}
        </div>`;
      $('#logoutBtn').addEventListener('click', async () => {
        await api('/account/logout', { method: 'POST' }).catch(() => {});
        state.customer = null; renderAccountBtn(); route();
      });
      return;
    }

    app.innerHTML = `
      <div class="account-grid">
        <form class="panel" id="loginForm" novalidate>
          <h1>Se connecter</h1>
          <label for="identifier">Numéro de téléphone ou e-mail</label>
          <input id="identifier" autocomplete="username" placeholder="06 123 45 67 ou nom@exemple.com" required>
          <label for="code">Code Kamwa (6 chiffres)</label>
          <input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="••• •••" required>
          <div id="loginError"></div>
          <button class="btn cta block" style="margin-top:14px">Me connecter</button>
          <p class="hint">Code oublié ? Contactez notre service client : nous vous en donnerons un nouveau.</p>
        </form>
        <div class="panel">
          <h2>Pas encore de compte ?</h2>
          <p class="hint">Créez votre compte avec votre numéro ou votre e-mail. Kamwa vous attribue un code à 6 chiffres pour retrouver vos commandes sur n'importe quel téléphone.</p>
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

  function viewRegister() {
    if (state.customer) { location.hash = '#/compte'; return; }
    const saved = loadJSON('kamwa-customer') || {};
    app.innerHTML = `
      <form class="panel" id="registerForm" novalidate style="max-width:520px;margin:0 auto">
        <h1>Créer mon compte Kamwa</h1>
        <p class="hint">Indiquez votre numéro de téléphone <strong>ou</strong> votre e-mail (ou les deux). C'est votre identifiant.</p>
        <label for="rName">Nom complet</label>
        <input id="rName" autocomplete="name" value="${esc(saved.name)}" required>
        <label for="rPhone">Numéro de téléphone</label>
        <input id="rPhone" type="tel" inputmode="tel" placeholder="06 123 45 67" value="${esc(saved.phone)}">
        <label for="rEmail">E-mail (facultatif)</label>
        <input id="rEmail" type="email" inputmode="email" autocomplete="email" placeholder="nom@exemple.com">
        <div id="registerError"></div>
        <button class="btn cta block" style="margin-top:14px">Créer mon compte</button>
        <p class="hint">Déjà un compte ? <a href="#/compte">Se connecter</a></p>
      </form>`;
    $('#registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const res = await api('/account/register', { method: 'POST', body: { name: $('#rName').value, phone: $('#rPhone').value, email: $('#rEmail').value, deviceOrders: deviceOrders() } });
        state.customer = res.customer; renderAccountBtn();
        const who = res.customer.phone || res.customer.email;
        app.innerHTML = `
          <div class="panel" style="max-width:520px;margin:0 auto;text-align:center">
            <div class="big-check">${icon('check-circle-duotone')}</div>
            <h1>Bienvenue ${esc(res.customer.name.split(' ')[0])} !</h1>
            <p>Voici votre <strong>code Kamwa</strong> :</p>
            <div class="code-box">${formatCode(res.code)}</div>
            <div class="alert err" style="text-align:left"><strong>Notez-le bien</strong> (ou faites une capture d'écran) : il ne sera plus affiché.<br>
            Pour vous connecter : <strong>${esc(who)}</strong> + ce code.</div>
            ${res.claimed ? `<p class="hint">${res.claimed} commande(s) de ce téléphone ajoutée(s) à votre compte.</p>` : ''}
            <a class="btn cta block" href="#/compte" style="margin-top:14px">J'ai noté mon code</a>
          </div>`;
      } catch (err) {
        $('#registerError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
        btn.disabled = false;
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
    const expired = isPickup(o) && o.status === 'pending_payment' && o.pickupDeadline && Date.now() > Date.parse(o.pickupDeadline);
    const im = o.import;
    const steps = im
      ? [
          ['Commande passée', o.createdAt, 'Devis accepté. Le paiement confirme la commande.'],
          ['Payée', o.paidAt, `Paiement reçu. Nous achetons votre article (délai total annoncé : ${esc(im.delay || '10 jours maximum')}).`],
          ['Achetée en Europe', im.boughtAt, 'Votre article est commandé auprès du vendeur en Europe.'],
          ['Article vérifié', im.receivedAt, "Votre article a été reçu et vérifié. Il part avec le prochain envoi vers le Congo."],
          ['Partie d’Europe', im.departedAt, `Votre colis est en route vers le Congo${im.eta ? ` — arrivée prévue vers le <strong>${shortDate(im.eta)}</strong>` : ''}.`],
          ['Arrivée au Congo', im.arrivedAt, 'Votre colis est arrivé. Nous vous appelons pour la livraison.'],
          ['En livraison', at('shipped'), 'Le livreur arrive. Préparez votre code de livraison.'],
          ['Livrée', at('delivered'), 'Votre commande a été livrée. Merci pour votre confiance !'],
        ]
      : isPickup(o)
      ? [
          ['Commande réservée', o.createdAt, expired
            ? 'Le délai de réservation est dépassé : vos articles ne sont plus réservés. Contactez-nous ou repassez commande.'
            : `Rendez-vous à l'agence <strong>${esc(ag.name)}</strong> (${esc(ag.city)}) avant le <strong>${longDate(o.pickupDeadline)}</strong> et payez <strong>${fcfa(o.total)}</strong> en espèces.`],
          ['Payée en agence', o.paidAt || at('paid'), 'Paiement reçu. Votre commande vous est remise à l\'agence.'],
          ['Retirée', at('delivered'), 'Vous avez retiré votre commande. Merci pour votre confiance !'],
        ]
      : [
          ['Commande passée', o.createdAt, 'Nous avons bien reçu votre commande.'],
          o.paymentPlan === 'cod'
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
          ${im && im.photos?.length ? `<div class="import-photos"><strong>${icon('camera')} Photos de votre article, prises à sa réception</strong><div>${im.photos.map((src) => `<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="Votre article" loading="lazy"></a>`).join('')}</div></div>` : ''}
          ${im && o.status === 'pending_payment' ? `<p><a class="btn cta" href="#/devis/${enc(im.requestId || '')}">Payer ma commande</a></p>` : ''}
          ${im && im.stage !== 'arrived' ? '' : codeCard(o)}
          ${(o.attempts || []).length && !['delivered', 'cancelled'].includes(o.status) ? `<div class="alert warn">${o.attempts.map((a) => `Tentative de livraison le ${longDate(a.at)} : ${esc(a.label)}.`).join('<br>')} Nous vous recontactons.</div>` : ''}
          ${o.status === 'pending_payment' && !isPickup(o) ? '<div class="alert err">Paiement pas encore reçu. Si vous venez de valider sur votre téléphone, patientez quelques minutes.</div>' : ''}
          ${isPickup(o) && o.status === 'pending_payment' && !expired ? `<div class="panel" style="background:#F0F7F4;margin:12px 0 0">
            <strong>${icon('map-pin-bold')} ${esc(ag.name)} — ${esc(ag.city)}</strong>
            <p class="hint" style="margin:4px 0 0">${esc(ag.address || 'Adresse communiquée par téléphone')}${ag.hours ? `<br>${icon('clock-bold')} ` + esc(ag.hours) : ''}${ag.phone ? `<br>${icon('phone-bold')} ` + esc(ag.phone) : ''}</p>
            <p class="hint">Présentez le numéro de commande <strong>${esc(o.id)}</strong> à l'agence.</p></div>` : ''}`}
        </div>
        <div class="panel">
          <h2>Récapitulatif</h2>
          ${o.lines.map((l) => `<div class="line"><span>${l.qty} × ${esc(l.name)}</span><strong>${fcfa(l.total)}</strong></div>`).join('')}
          <div class="row total" style="margin-top:10px"><span>Total</span><strong>${fcfa(o.total)}</strong></div>
          <p class="hint" style="margin-top:12px">${isPickup(o) ? `Retrait en agence : ${esc(ag.name)} (${esc(ag.city)})` : `Livraison : ${esc(o.customer.city || '—')} · ${esc(o.customer.address || '')}`}<br>Contact : ${esc(o.customer.phone)}</p>
        </div>
      </div>`;
  }

  // ---------- Achat en Europe : demande de devis, devis, paiement ----------
  const deviceDevis = () => loadJSON('kamwa-devis') || [];
  const rememberDevis = (id, token) => saveJSON('kamwa-devis', [{ id, token }, ...deviceDevis().filter((d) => d.id !== id)].slice(0, 30));
  const DEVIS_STATUS = { requested: ['Devis en préparation', 'st-pending_payment'], quoted: ['Devis prêt', 'st-confirmed'], accepted: ['Accepté', 'st-paid'], expired: ['Devis expiré', 'st-cancelled'], declined: ['Non disponible', 'st-cancelled'], cancelled: ['Annulé', 'st-cancelled'] };
  const devisBadge = (st) => `<span class="st ${DEVIS_STATUS[st]?.[1] || ''}">${esc(DEVIS_STATUS[st]?.[0] || st)}</span>`;

  async function viewFrance() {
    renderNav('france');
    let conf = { enabled: true, delay: '10 jours maximum', validityHours: 48 };
    try { conf = await api('/imports/settings'); } catch {}
    const saved = (() => { try { return JSON.parse(localStorage.getItem('kamwa-customer')) || {}; } catch { return {}; } })();
    if (state.customer) { saved.name = saved.name || state.customer.name; saved.phone = saved.phone || state.customer.phone || ''; }
    const mine = (await Promise.all(deviceDevis().slice(0, 10).map((d) => api('/imports/' + enc(d.id), { headers: { 'X-Import-Token': d.token } }).then((r) => ({ ...r, token: d.token })).catch(() => null)))).filter(Boolean);
    const itemRow = (i) => `
      <fieldset class="fr-item" data-i="${i}">
        <legend>Article ${i + 1}</legend>
        <label>Lien du produit (copiez l'adresse de la page)</label>
        <input name="url" type="url" inputmode="url" placeholder="https://www.amazon.fr/… ou https://www.decathlon.fr/…" ${i === 0 ? 'required' : ''}>
        <div class="fr-row">
          <div><label>Nom de l'article</label><input name="title" type="text" maxlength="140" placeholder="Ex. Chaussures de running"></div>
          <div><label>Quantité</label><input name="qty" type="number" min="1" max="20" value="1"></div>
        </div>
        <div class="fr-row">
          <div><label>Taille, couleur, modèle…</label><input name="options" type="text" maxlength="200" placeholder="Ex. Pointure 43, noir"></div>
          <div><label>Prix affiché (€, facultatif)</label><input name="priceEur" type="text" inputmode="decimal" placeholder="Ex. 59,99"></div>
        </div>
      </fieldset>`;
    app.innerHTML = `
      <section class="fr-hero">
        <span class="deco o1"></span><span class="deco o2"></span>
        <div>
          <span class="pill">${icon('airplane-tilt')} Venu d’Europe</span>
          <h1>Achetez en Europe,<br>recevez au Congo.</h1>
          <p>Des produits choisis en Europe, à un <strong>prix tout compris en FCFA</strong> (transport en avion et douane inclus). Vous payez en Mobile Money, nous nous occupons de tout jusqu'à votre porte. <strong>Vous achetez, vous recevez, point.</strong></p>
        </div>
      </section>
      <div class="fr-steps">
        <div>${icon('shield-check')}<span><strong>Achat pris en charge</strong>Nous achetons et contrôlons chaque article pour vous.</span></div>
        <div>${icon('airplane-tilt')}<span><strong>Acheminement maîtrisé</strong>Transport et formalités de douane gérés par nos soins.</span></div>
        <div>${icon('wallet')}<span><strong>Prix tout compris</strong>En FCFA, payé en Mobile Money, sans frais cachés.</span></div>
        <div>${icon('truck')}<span><strong>Livré chez vous</strong>Suivi à chaque étape, livraison en ${esc(conf.delay)}.</span></div>
      </div>
      ${(() => { const list = state.products.filter((x) => x.origin === 'FR'); return list.length ? `<section class="shelf" style="margin-top:8px"><div class="shelf-head"><div><p class="kicker k-violet">${icon('airplane-tilt')} Venus d’Europe</p><h2>Nos produits</h2></div></div><div class="grid">${list.map(card).join('')}</div></section>` : '<div class="panel empty">Les premiers produits venus d’Europe arrivent très bientôt.</div>'; })()}
      ${mine.length ? `<section class="panel"><h2>Mes demandes</h2>${mine.map((d) => `<a class="order-card" href="#/devis/${enc(d.id)}/${enc(d.token)}"><div class="top"><strong>${esc(d.id)}</strong>${devisBadge(d.status)}</div><div class="hint">${esc(d.items.map((it) => it.title || it.url).join(', ').slice(0, 100))}${d.quote ? ` · <strong style="color:var(--ink)">${fcfa(d.quote.total)}</strong>` : ''}</div></a>`).join('')}</section>` : ''}
      ${conf.enabled && conf.customerRequests ? `
      <form class="panel" id="frForm" novalidate>
        <h2>Vous cherchez autre chose ? Demandez un devis</h2>
        <div id="frItems">${itemRow(0)}</div>
        <button type="button" class="btn ghost" id="frAdd">${icon('plus')} Ajouter un autre article</button>
        <h2 style="margin-top:22px">Mes coordonnées</h2>
        <div class="fr-row">
          <div><label for="frName">Nom complet</label><input id="frName" required value="${esc(saved.name)}"></div>
          <div><label for="frPhone">Téléphone (WhatsApp de préférence)</label><input id="frPhone" type="tel" inputmode="tel" placeholder="06 123 45 67" value="${esc(saved.phone)}"></div>
        </div>
        <div class="fr-row">
          <div><label for="frCity">Ville de livraison</label><select id="frCity">${['Pointe-Noire', 'Brazzaville', 'Dolisie', 'Autre'].map((c) => `<option ${saved.city === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
          <div><label for="frAddress">Quartier / repère</label><input id="frAddress" value="${esc(saved.address)}" placeholder="Ex. Tié-Tié, près de la pharmacie"></div>
        </div>
        <label for="frNote">Précisions (facultatif)</label><textarea id="frNote" rows="2" maxlength="500" placeholder="Ex. je veux la version 128 Go, couleur bleue si possible"></textarea>
        <div id="frError"></div>
        <button class="btn cta block" style="margin-top:16px">Recevoir mon devis gratuit</button>
        <p class="hint">Gratuit et sans engagement. Le devis est valable ${conf.validityHours} h. Certains articles ne peuvent pas voyager (produits dangereux, liquides inflammables…) : nous vous le dirons.</p>
      </form>` : ''}`;
    if (!(conf.enabled && conf.customerRequests)) return;
    let n = 1;
    $('#frAdd').addEventListener('click', () => {
      if (n >= 5) return;
      $('#frItems').insertAdjacentHTML('beforeend', itemRow(n++));
      if (n >= 5) $('#frAdd').hidden = true;
    });
    $('#frForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = (f, name) => f.querySelector(`[name="${name}"]`).value; // (un <fieldset> n'expose pas ses champs par leur nom)
      const items = [...app.querySelectorAll('.fr-item')].map((f) => ({ url: v(f, 'url').trim(), title: v(f, 'title'), qty: v(f, 'qty'), options: v(f, 'options'), priceEur: v(f, 'priceEur') })).filter((it) => it.url);
      const customer = { name: $('#frName').value, phone: $('#frPhone').value, city: $('#frCity').value, address: $('#frAddress').value };
      const btn = e.target.querySelector('button.cta'); btn.disabled = true;
      try {
        const r = await api('/imports', { method: 'POST', body: { items, customer, note: $('#frNote').value } });
        rememberDevis(r.id, r.token);
        try { localStorage.setItem('kamwa-customer', JSON.stringify(customer)); } catch {}
        location.hash = `#/devis/${enc(r.id)}/${enc(r.token)}`;
      } catch (err) {
        $('#frError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    });
  }

  async function viewDevis(id, token) {
    renderNav('france');
    if (token) rememberDevis(id, token); // ouvert depuis le lien WhatsApp : on garde la clé sur ce téléphone
    token = token || deviceDevis().find((d) => d.id === id)?.token;
    let r = null;
    try { r = await api('/imports/' + enc(id), { headers: { 'X-Import-Token': token || '' } }); } catch {}
    if (!r) { app.innerHTML = '<div class="panel waiting"><h1>Devis introuvable</h1><p class="hint">Ouvrez le lien reçu par WhatsApp sur ce téléphone.</p><a class="btn cta" href="#/europe">Achat en Europe</a></div>'; return; }
    const q = r.quote;
    let order = null;
    if (r.orderId) {
      const ot = tokenOf(r.orderId);
      if (ot) { try { order = await api('/orders/' + enc(r.orderId), { headers: orderHeaders(ot) }); } catch {} }
    }
    const items = (q?.items || r.items).map((it, i) => `<div class="line"><span>${it.qty} × ${esc(it.title || r.items[i]?.title || 'Article')}${(r.items[i]?.options) ? `<br><span class="hint">${esc(r.items[i].options)}</span>` : ''}<br><a class="hint" href="${esc(r.items[i]?.url || it.url)}" target="_blank" rel="noopener">${icon('link')} voir le produit</a></span>${it.priceEur ? `<span class="hint">${Number(it.priceEur).toFixed(2).replace('.', ',')} €</span>` : ''}</div>`).join('');
    const body = {
      requested: `<div class="alert warn">Nous préparons votre devis tout compris : vous recevez une réponse sous 24 h, ici et par WhatsApp au <strong>${esc(r.customer.phone)}</strong>.</div>`,
      quoted: q ? `
        <div class="quote-box">
          <div class="row"><span>Articles (prix en Europe + port, convertis en FCFA)</span><span>${fcfa(q.breakdown.goods)}</span></div>
          <div class="row"><span>Transport Europe → Congo</span><span>${fcfa(q.breakdown.freight)}</span></div>
          <div class="row"><span>Douane et taxes</span><span>${fcfa(q.breakdown.customs)}</span></div>
          <div class="row"><span>Service Kamwa (achat, suivi, livraison)</span><span>${fcfa(q.breakdown.commission)}</span></div>
          <div class="row total"><span>Prix tout compris</span><strong>${fcfa(q.total)}</strong></div>
          <p class="hint">Livraison à ${esc(r.customer.city)} incluse · délai ${esc(q.delay)} après paiement · devis valable jusqu'au ${longDate(q.validUntil)}.</p>
          ${q.message ? `<p class="quote-msg">${esc(q.message)}</p>` : ''}
        </div>
        <button class="btn cta block" id="acceptBtn">Accepter et payer ${fcfa(q.total)}</button>
        <button class="btn ghost block" id="cancelBtn" style="margin-top:8px">Non merci</button>` : '',
      expired: '<div class="alert err">Ce devis a expiré (les prix en Europe changent vite). Refaites une demande : c\'est gratuit.</div><a class="btn cta" href="#/europe">Nouvelle demande</a>',
      declined: `<div class="alert err">${esc(r.declineReason || "Nous ne pouvons pas faire venir cet article.")}</div><a class="btn cta" href="#/europe">Faire une autre demande</a>`,
      cancelled: '<div class="alert err">Vous avez annulé cette demande.</div><a class="btn cta" href="#/europe">Nouvelle demande</a>',
      accepted: order && order.status !== 'pending_payment' ? `<p>Commande <strong>${esc(order.id)}</strong> payée.</p><a class="btn cta" href="#/suivi/${enc(order.id)}">Suivre ma commande</a>` : '',
    }[r.status] || '';
    app.innerHTML = `
      <div class="crumbs"><a href="#/europe">Achat en Europe</a> › Devis</div>
      <div class="checkout">
        <div class="panel">
          <div class="row" style="gap:10px;align-items:center"><h1 style="margin:0">Devis ${esc(r.id)}</h1>${devisBadge(r.status)}</div>
          <p class="hint">Demandé le ${longDate(r.createdAt)}</p>
          ${body}
          <div id="payBox"></div>
        </div>
        <div class="panel"><h2>Votre demande</h2>${items}${r.note ? `<p class="hint">${esc(r.note)}</p>` : ''}</div>
      </div>`;
    const showPay = (o, oToken) => {
      const checkout = { orderId: o.id, token: oToken, import: true };
      $('#payBox').innerHTML = `
        <form id="frPay" novalidate>
          <h2 style="margin-top:18px">Paiement de ${fcfa(o.total)}</h2>
          <p class="hint">Nous achetons votre article pour vous : la commande se paie en entier à l'avance.</p>
          <div class="operators">
            <label class="op mtn"><input type="radio" name="operator" value="mtn" checked><span class="dot"></span>MTN MoMo</label>
            <label class="op airtel"><input type="radio" name="operator" value="airtel"><span class="dot"></span>Airtel Money</label>
          </div>
          <label for="frMomo">Numéro Mobile Money</label>
          <input id="frMomo" type="tel" inputmode="tel" value="${esc(r.customer.phone)}">
          <div id="frPayErr"></div>
          <button class="btn cta block" style="margin-top:12px">Payer ${fcfa(o.total)}</button>
        </form>`;
      const f = $('#frPay');
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const payment = await api('/payments', { method: 'POST', body: { orderId: o.id, token: oToken, method: 'momo', phone: $('#frMomo').value, operator: f.operator.value } });
          viewWaiting(checkout, payment, payment.resumed);
        } catch (err) {
          if (['paid'].includes(err.data?.orderStatus)) return finishPaid(checkout);
          $('#frPayErr').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
        }
      });
    };
    if (r.status === 'accepted' && order?.status === 'pending_payment') showPay(order, tokenOf(order.id));
    $('#acceptBtn')?.addEventListener('click', async () => {
      try {
        const a = await api('/imports/' + enc(r.id) + '/accept', { method: 'POST', body: { token } });
        rememberOrder(a.orderId, a.token);
        $('#acceptBtn').hidden = true; $('#cancelBtn').hidden = true;
        showPay(a.order, a.token);
        $('#payBox').scrollIntoView({ behavior: 'smooth' });
      } catch (err) { $('#payBox').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    $('#cancelBtn')?.addEventListener('click', async () => {
      if (!confirm('Annuler cette demande ?')) return;
      try { await api('/imports/' + enc(r.id) + '/cancel', { method: 'POST', body: { token } }); route(); } catch (err) { alert(err.message); }
    });
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
  function route() {
    state.timers.forEach(clearInterval); state.timers = [];
    const parts = (location.hash || '#/').slice(2).split('#')[0].split('/').map(decodeURIComponent);
    if (parts[0] !== 'recherche') $('.header').classList.remove('search-open');
    if (parts[0] !== 'recherche') $('#searchInput').value = '';
    markTab(parts[0]);
    window.scrollTo(0, 0);
    switch (parts[0]) {
      case 'c': return viewCategory(parts[1], parts[2]);
      case 'p': return viewProduct(parts[1]);
      case 'recherche': return viewSearch(parts.slice(1).join('/'));
      case 'promos': return viewPromos();
      case 'commande': return viewCheckout();
      case 'merci': return viewThanks(parts[1]);
      case 'compte': return viewAccount(parts[1]);
      case 'suivi': return viewTracking(parts[1]);
      case 'credits': return viewCredits();
      case 'legal': return viewLegal(parts[1]);
      case 'europe':
      case 'france': return viewFrance(); // ancienne adresse #/france gardée
      case 'devis': return viewDevis(parts[1], parts[2]);
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
        document.body.insertAdjacentHTML('afterbegin', '<div class="demo-strip">Site de démonstration : commandes fictives, aucun paiement réel, données remises à zéro régulièrement.</div>');
      }
      UNIVERSES = (state.config.universes || [])
        .map((u) => ({ ...u, categories: u.categories.filter((c) => state.products.some((p) => p.category === c)) }))
        .filter((u) => u.categories.length);
    } catch {
      app.innerHTML = '<p class="empty">Connexion impossible. Vérifiez votre réseau.</p>';
      return;
    }
    renderCart();
    $('#year').textContent = new Date().getFullYear();
    api('/imports/settings').then((c) => { state.frDelay = c.delay; state.frConf = c; }).catch(() => {});
    const last = loadJSON('kamwa-last-order');
    if (last?.id && !tokenOf(last.id)) rememberOrder(last.id, last.token);
    await refreshCustomer();
    window.addEventListener('hashchange', route);
    route();
  })();
})();
