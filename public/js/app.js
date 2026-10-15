// Baydel — front-end léger (aucune dépendance) pour rester rapide sur les réseaux mobiles.
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;

  // Univers et catégories affichés dans le menu : fournis par le serveur (src/catalog.js), même liste que l'admin
  let UNIVERSES = [];
  const ICONS = { 'Téléphones': '📱', 'Tablettes': '📲', 'Ordinateurs': '💻', 'Montres': '⌚', 'Audio': '🎧', 'TV & Maison': '📺', 'Composants': '💾', 'Accessoires': '🔌', 'Homme': '👕', 'Femme': '👚', 'Chaussures': '👟' };
  const universeOf = (cat) => UNIVERSES.find((u) => u.categories.includes(cat))?.name;

  const state = { products: [], config: {}, cart: loadCart(), sort: 'pertinence', timers: [] };

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
  const loadCheckout = () => loadJSON('baydel-checkout');
  const saveCheckout = (c) => saveJSON('baydel-checkout', c);
  const orderHeaders = (token) => ({ 'X-Order-Token': token });

  function finishPaid(checkout) {
    state.cart = {}; saveCart();
    saveCheckout(null);
    saveJSON('baydel-last-order', { id: checkout.orderId, token: checkout.token });
    location.hash = '#/merci/' + checkout.orderId;
  }

  // ---------- Panier (conservé dans le navigateur) ----------
  function loadCart() { try { return JSON.parse(localStorage.getItem('baydel-cart')) || {}; } catch { return {}; } }
  function saveCart() { try { localStorage.setItem('baydel-cart', JSON.stringify(state.cart)); } catch {} renderCart(); }
  const byId = (id) => state.products.find((p) => p.id === id);
  const cartItems = () => Object.entries(state.cart).map(([id, qty]) => ({ product: byId(id), qty })).filter((l) => l.product);
  const cartTotal = () => cartItems().reduce((s, l) => s + l.product.price * l.qty, 0);
  const cartSaving = () => cartItems().reduce((s, l) => s + ((l.product.oldPrice || l.product.price) - l.product.price) * l.qty, 0);
  const addToCart = (id) => { state.cart[id] = (state.cart[id] || 0) + 1; saveCart(); };
  const setQty = (id, qty) => { if (qty <= 0) delete state.cart[id]; else state.cart[id] = qty; saveCart(); };

  function renderCart() {
    const items = cartItems();
    $('#cartCount').textContent = items.reduce((s, l) => s + l.qty, 0);
    $('#cartTotal').textContent = fcfa(cartTotal());
    const saving = cartSaving();
    $('#cartSaving').innerHTML = saving > 0 ? `<span>Vous économisez</span><span>${fcfa(saving)}</span>` : '';
    $('#cartLines').innerHTML = items.length
      ? items.map(({ product: p, qty }) => `
        <div class="line">
          <div>
            <div>${esc(p.name)}</div>
            <div class="qty">
              <button data-qty="${p.id}" data-d="-1" aria-label="Retirer un">−</button>
              <span>${qty}</span>
              <button data-qty="${p.id}" data-d="1" aria-label="Ajouter un">+</button>
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
      addToCart(add.dataset.add);
      const label = add.textContent;
      add.textContent = 'Ajouté ✓';
      setTimeout(() => (add.textContent = label), 1200);
    }
    const q = e.target.closest('[data-qty]');
    if (q) setQty(q.dataset.qty, (state.cart[q.dataset.qty] || 0) + Number(q.dataset.d));
  });

  // ---------- Recherche ----------
  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    location.hash = q ? '#/recherche/' + enc(q) : '#/';
  });

  // ---------- Menu catégories ----------
  function renderNav(active) {
    const links = [`<a href="#/" class="${!active ? 'active' : ''}">Accueil</a>`];
    for (const u of UNIVERSES) {
      links.push(`<a href="#/c/${enc(u.name)}" class="${active === u.name ? 'active' : ''}">${esc(u.name)}</a>`);
      for (const c of u.categories) links.push(`<a href="#/c/${enc(u.name)}/${enc(c)}" class="${active === c ? 'active' : ''}">${esc(c)}</a>`);
    }
    links.push(`<a href="#/promos" class="${active === 'promos' ? 'active' : ''}" style="color:#FFB366">Bonnes affaires</a>`);
    $('#catnav').innerHTML = links.join('');
  }

  // ---------- Composants ----------
  const discount = (p) => (p.oldPrice && p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0);

  // Image du produit si elle existe, sinon pictogramme sur fond coloré (repli)
  function visual(p, cls = 'thumb') {
    if (p.image) {
      return `<div class="${cls} has-img" style="--fallback:${esc(p.color || '#2B3440')}" data-icon="${ICONS[p.category] || '🛍️'}">
        <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('img-failed');this.remove()">`;
    }
    return `<div class="${cls}" style="background:${esc(p.color || '#2B3440')}">${ICONS[p.category] || '🛍️'}`;
  }

  function card(p) {
    const d = discount(p);
    return `
      <article class="card">
        <a href="#/p/${p.id}">
          ${visual(p)}</div>
          ${d ? `<span class="disc">-${d}%</span>` : ''}
        </a>
        <div class="card-body">
          ${p.brand ? `<span class="brand">${esc(p.brand)}</span>` : ''}
          <a href="#/p/${p.id}"><h3>${esc(p.name)}</h3></a>
          ${d ? `<span class="old">${fcfa(p.oldPrice)}</span>` : '<span class="old" style="visibility:hidden">0</span>'}
          <span class="price">${fcfa(p.price)}</span>
          <span class="momo-note">Payable en Mobile Money</span>
          ${p.stock > 0 && p.stock <= 6 ? `<span class="stock-low">Plus que ${p.stock} en stock</span>` : ''}
          <button class="btn cta" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>${p.stock === 0 ? 'Épuisé' : 'Ajouter au panier'}</button>
        </div>
      </article>`;
  }

  function sortList(list) {
    const l = [...list];
    if (state.sort === 'prix-asc') l.sort((a, b) => a.price - b.price);
    if (state.sort === 'prix-desc') l.sort((a, b) => b.price - a.price);
    if (state.sort === 'remise') l.sort((a, b) => discount(b) - discount(a));
    return l;
  }

  function msToMidnight() {
    const now = new Date(); const end = new Date(now); end.setHours(24, 0, 0, 0);
    const s = Math.floor((end - now) / 1000);
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  }

  // ---------- Vues ----------
  function viewHome() {
    renderNav(null);
    const deals = [...state.products].filter((p) => discount(p) > 0).sort((a, b) => discount(b) - discount(a)).slice(0, 10);
    const featured = (u) => state.products.filter((p) => p.universe === u && p.featured).concat(state.products.filter((p) => p.universe === u && !p.featured)).slice(0, 10);

    app.innerHTML = `
      <section class="hero" aria-label="Offres du moment">
        <div class="slides" id="slides">
          <div class="slide s1">
            <span class="kicker">Semaine high-tech</span>
            <h2>iPhone, iPad &amp; MacBook</h2>
            <span class="big">jusqu'à -11%</span>
            <a class="btn light" href="#/c/${enc('Électronique')}">J'en profite</a>
          </div>
          <div class="slide s2">
            <span class="kicker">Nouveau</span>
            <h2>Payez en Mobile Money</h2>
            <span>MTN MoMo et Airtel Money, validation avec votre code secret.</span>
            <a class="btn light" href="#/promos">Voir les bonnes affaires</a>
          </div>
          <div class="slide s3">
            <span class="kicker">Mode</span>
            <h2>T-shirts, joggings &amp; baskets</h2>
            <span class="big">dès 4 000 FCFA</span>
            <a class="btn light" href="#/c/Mode">Découvrir</a>
          </div>
        </div>
        <div class="dots" id="dots"></div>
      </section>

      <div class="reassure">
        <div><span class="ic">📲</span><span><b>Mobile Money</b>MTN MoMo · Airtel Money</span></div>
        <div><span class="ic">🚚</span><span><b>Livraison 24-48 h</b>Pointe-Noire · Brazzaville</span></div>
        <div><span class="ic">📞</span><span><b>Service client</b>On vous rappelle après la commande</span></div>
      </div>

      <nav class="universes" aria-label="Rayons">
        ${UNIVERSES.flatMap((u) => u.categories.map((c) => `<a href="#/c/${enc(u.name)}/${enc(c)}"><span class="ic">${ICONS[c]}</span>${esc(c)}</a>`)).join('')}
      </nav>

      <section class="section deals">
        <div class="section-head">
          <h2>⚡ Bonnes affaires du jour</h2>
          <span class="countdown" id="countdown">${msToMidnight()}</span>
        </div>
        <div class="rail">${deals.map(card).join('')}</div>
      </section>

      ${UNIVERSES.map((u) => `
        <section class="section">
          <div class="section-head"><h2>${esc(u.name)}</h2><a href="#/c/${enc(u.name)}">Tout voir ›</a></div>
          <div class="grid">${featured(u.name).map(card).join('')}</div>
        </section>`).join('')}`;

    // Carrousel
    const slides = $('#slides'); const n = slides.children.length; let i = 0;
    const dots = $('#dots');
    dots.innerHTML = Array.from({ length: n }, (_, k) => `<button aria-label="Offre ${k + 1}" data-slide="${k}"></button>`).join('');
    const go = (k) => { i = (k + n) % n; slides.style.transform = `translateX(-${i * 100}%)`; [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i)); };
    dots.addEventListener('click', (e) => { const b = e.target.closest('[data-slide]'); if (b) go(Number(b.dataset.slide)); });
    go(0);
    state.timers.push(setInterval(() => go(i + 1), 5000));
    state.timers.push(setInterval(() => { const c = $('#countdown'); if (c) c.textContent = msToMidnight(); }, 1000));
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
    viewList({ title: `Résultats pour « ${q} »`, crumbs: '<a href="#/">Accueil</a> › Recherche', list, active: null });
  }

  function viewPromos() {
    viewList({ title: 'Bonnes affaires', crumbs: '<a href="#/">Accueil</a> › Bonnes affaires', list: state.products.filter((p) => discount(p) > 0), active: 'promos' });
  }

  function viewProduct(id) {
    const p = byId(id);
    if (!p) return viewHome();
    renderNav(p.category);
    const d = discount(p);
    const similar = state.products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 5);
    app.innerHTML = `
      <div class="crumbs"><a href="#/">Accueil</a> › <a href="#/c/${enc(p.universe)}">${esc(p.universe)}</a> › <a href="#/c/${enc(p.universe)}/${enc(p.category)}">${esc(p.category)}</a></div>
      <div class="pdp">
        ${visual(p)}${d ? `<span class="disc">-${d}%</span>` : ''}</div>
        <div>
          <h1>${esc(p.name)}</h1>
          <p>${esc(p.description)}</p>
          <div class="buybox">
            ${d ? `<div><span class="old">${fcfa(p.oldPrice)}</span> <span class="save-tag">Économisez ${fcfa(p.oldPrice - p.price)}</span></div>` : ''}
            <span class="price">${fcfa(p.price)}</span>
            <span class="momo-note">✓ Payable en MTN MoMo ou Airtel Money</span>
            <span class="hint">🚚 Livraison 24-48 h à Pointe-Noire et Brazzaville</span>
            ${p.stock === 0 ? '<span class="stock-low">Épuisé</span>' : p.stock <= 6 ? `<span class="stock-low">Plus que ${p.stock} en stock</span>` : '<span class="momo-note">En stock</span>'}
            <button class="btn cta block" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>Ajouter au panier</button>
            <a class="btn ghost block" href="#/commande" id="buyNow">Acheter maintenant</a>
          </div>
        </div>
      </div>
      ${similar.length ? `<section class="section" style="margin-top:12px"><div class="section-head"><h2>Dans la même catégorie</h2></div><div class="rail">${similar.map(card).join('')}</div></section>` : ''}`;
    $('#buyNow').addEventListener('click', () => { if (!state.cart[p.id]) addToCart(p.id); });
  }

  async function viewCheckout() {
    renderNav(null);
    const items = cartItems();
    if (!items.length) { location.hash = '#/'; return; }

    // Un paiement était en cours pour ce panier (page rechargée, retour en arrière…) : on reprend l'attente.
    const current = loadCheckout();
    if (current?.paymentId && current.cartKey === cartKey()) {
      try {
        const p = await api('/payments/' + enc(current.paymentId));
        if (p.status === 'PENDING') return viewWaiting(current, p, true);
        if (p.status === 'SUCCESSFUL') return finishPaid(current);
      } catch {}
    }
    const saved = (() => { try { return JSON.parse(localStorage.getItem('baydel-customer')) || {}; } catch { return {}; } })();

    app.innerHTML = `
      <h1>Finaliser ma commande</h1>
      ${state.config.paymentMode === 'simulation'
        ? '<div class="sim">Mode test : aucun argent n\'est débité. Un numéro finissant par 000 simule un paiement refusé.</div>' : ''}
      <div class="checkout">
        <form class="panel" id="checkoutForm" novalidate>
          <h2>1. Livraison</h2>
          <label for="name">Nom complet</label>
          <input id="name" name="name" autocomplete="name" required value="${esc(saved.name)}">
          <label for="phone">Téléphone (contact)</label>
          <input id="phone" name="phone" type="tel" inputmode="tel" placeholder="06 123 45 67" required value="${esc(saved.phone)}">
          <label for="city">Ville</label>
          <select id="city" name="city">
            ${['Pointe-Noire', 'Brazzaville', 'Dolisie', 'Autre'].map((c) => `<option ${saved.city === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
          <label for="address">Quartier / adresse / repère</label>
          <textarea id="address" name="address" rows="2" placeholder="Ex. Quartier Tié-Tié, près de la pharmacie…">${esc(saved.address)}</textarea>

          <h2 style="margin-top:24px">2. Paiement Mobile Money</h2>
          <div class="operators">
            <label class="op mtn"><input type="radio" name="operator" value="mtn" checked><span class="dot"></span>MTN MoMo</label>
            <label class="op airtel"><input type="radio" name="operator" value="airtel"><span class="dot"></span>Airtel Money</label>
          </div>
          <label for="momo">Numéro Mobile Money à débiter</label>
          <input id="momo" name="momo" type="tel" inputmode="tel" placeholder="06 123 45 67" required value="${esc(saved.phone)}">
          <p class="hint">MTN : numéros en 06 · Airtel : numéros en 05 ou 04</p>
          <div id="formError"></div>
          <button class="btn cta block" style="margin-top:16px;min-height:48px;font-size:1rem" id="payBtn">Payer ${fcfa(cartTotal())}</button>
        </form>

        <div class="panel">
          <h2>Récapitulatif</h2>
          ${items.map(({ product: p, qty }) => `<div class="line"><span>${qty} × ${esc(p.name)}</span><strong>${fcfa(p.price * qty)}</strong></div>`).join('')}
          ${cartSaving() > 0 ? `<div class="row saving" style="margin-top:10px"><span>Vous économisez</span><span>${fcfa(cartSaving())}</span></div>` : ''}
          <div class="row total" style="margin-top:10px"><span>Total</span><strong>${fcfa(cartTotal())}</strong></div>
        </div>
      </div>`;

    const form = $('#checkoutForm');
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
      const err = $('#formError'); err.innerHTML = '';
      const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Envoi de la demande…';
      const customer = { name: form.name.value, phone: form.phone.value, city: form.city.value, address: form.address.value };
      try { localStorage.setItem('baydel-customer', JSON.stringify(customer)); } catch {}
      try {
        // Même panier qu'une tentative précédente non payée : on réutilise la commande.
        let checkout = loadCheckout();
        let order = null;
        if (checkout?.cartKey === cartKey()) {
          try { order = await api('/orders/' + enc(checkout.orderId), { headers: orderHeaders(checkout.token) }); } catch {}
          if (order?.status === 'paid') return finishPaid(checkout);
          if (order?.status !== 'pending_payment') order = null;
        }
        if (!order) {
          const created = await api('/orders', { method: 'POST', body: { customer, items: items.map(({ product, qty }) => ({ productId: product.id, qty })) } });
          checkout = { orderId: created.id, token: created.token, cartKey: cartKey() };
          saveCheckout(checkout);
        }
        let payment;
        try {
          payment = await api('/payments', { method: 'POST', body: { orderId: checkout.orderId, token: checkout.token, phone: form.momo.value, operator: form.operator.value } });
        } catch (ex) {
          if (ex.data?.orderStatus === 'paid') return finishPaid(checkout);
          throw ex;
        }
        saveCheckout({ ...checkout, paymentId: payment.id });
        viewWaiting(checkout, payment, payment.resumed);
      } catch (ex) {
        err.innerHTML = `<div class="alert err">${esc(ex.message)}</div>`;
        btn.disabled = false; btn.textContent = `Payer ${fcfa(cartTotal())}`;
      }
    });
  }

  function viewWaiting(checkout, payment, resumed) {
    const opName = payment.operator === 'mtn' ? 'MTN MoMo' : 'Airtel Money';
    app.innerHTML = `
      <div class="panel waiting" id="waiting">
        <div class="spinner"></div>
        <h1>Validez le paiement sur votre téléphone</h1>
        ${resumed ? '<div class="sim">Une demande de paiement est déjà en cours pour cette commande. Validez-la sur votre téléphone : nous n\'en envoyons pas une deuxième.</div>' : ''}
        <p>Une demande de <strong>${fcfa(payment.amount)}</strong> a été envoyée via <strong>${opName}</strong>.<br>
        Saisissez votre <strong>code secret</strong> sur votre téléphone pour confirmer.</p>
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
        $('#waitHint').innerHTML = `Commande ${esc(checkout.orderId)}. Nous attendons encore la confirmation de l'opérateur.<br>
          <strong>Si vous avez déjà saisi votre code, ne payez pas une deuxième fois</strong> : cette page se met à jour toute seule.`;
      }
      if (elapsed > 15 * 60 * 1000) {
        return viewFailed({ reason: `Aucune confirmation reçue de l'opérateur. Si votre compte a été débité, contactez-nous en indiquant la commande ${checkout.orderId} : nous vérifierons avant tout nouveau paiement.` });
      }
      setTimeout(poll, elapsed > 3 * 60 * 1000 ? 10000 : 4000);
    };
    setTimeout(poll, 4000);
  }

  function viewFailed(p) {
    app.innerHTML = `
      <div class="panel waiting">
        <h1>Paiement non abouti</h1>
        <p>${esc(p.reason || 'Le paiement a été refusé ou annulé.')}</p>
        <p class="hint">Vérifiez votre solde Mobile Money puis réessayez. Votre panier est conservé.</p>
        <button class="btn cta" id="retryBtn">Réessayer</button>
      </div>`;
    // Bouton (et non lien) : on est déjà sur #/commande, un lien vers la même adresse ne ferait rien.
    $('#retryBtn').addEventListener('click', route);
  }

  async function viewThanks(orderId) {
    renderNav(null);
    // Les détails de la commande ne sont lisibles qu'avec sa clé secrète, gardée par ce navigateur.
    const last = loadJSON('baydel-last-order');
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
        <div class="big-check">✓</div>
        <h1>Merci, paiement reçu&nbsp;!</h1>
        ${order ? `<p>Commande <strong>${esc(order.id)}</strong> : ${fcfa(order.total)}</p>
        <p>Nous vous appelons au <strong>${esc(order.customer.phone)}</strong> pour organiser la livraison à ${esc(order.customer.city)}.</p>` : ''}
        <a class="btn cta" href="#/">Continuer mes achats</a>
      </div>`;
  }

  // ---------- Routeur ----------
  function route() {
    state.timers.forEach(clearInterval); state.timers = [];
    const parts = (location.hash || '#/').slice(2).split('/').map(decodeURIComponent);
    window.scrollTo(0, 0);
    switch (parts[0]) {
      case 'c': return viewCategory(parts[1], parts[2]);
      case 'p': return viewProduct(parts[1]);
      case 'recherche': return viewSearch(parts.slice(1).join('/'));
      case 'promos': return viewPromos();
      case 'commande': return viewCheckout();
      case 'merci': return viewThanks(parts[1]);
      default: return viewHome();
    }
  }

  (async () => {
    app.innerHTML = '<p class="empty">Chargement…</p>';
    try {
      [state.products, state.config] = await Promise.all([api('/products'), api('/config')]);
      UNIVERSES = state.config.universes || [];
    } catch {
      app.innerHTML = '<p class="empty">Connexion impossible. Vérifiez votre réseau.</p>';
      return;
    }
    renderCart();
    window.addEventListener('hashchange', route);
    route();
  })();
})();
