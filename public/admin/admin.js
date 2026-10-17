// Kamwa — espace admin (aucune dépendance). Routes : #/commandes, #/commande/<id>, #/produits, #/produit/<id|nouveau>
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Badge « identité vérifiée » (même sceau que dans la boutique) à côté du nom des clients dont la pièce est validée
  const VERIFIED = '<svg class="vbadge" viewBox="0 0 24 24" role="img" aria-label="Identité vérifiée"><title>Identité vérifiée</title><path class="vb-seal" d="M12 .7l2.41 2.32 3.24-.81.93 3.21 3.21.93-.81 3.24L23.3 12l-2.32 2.41.81 3.24-3.21.93-.93 3.21-3.24-.81L12 23.3l-2.41-2.32-3.24.81-.93-3.21-3.21-.93.81-3.24L.7 12l2.32-2.41-.81-3.24 3.21-.93.93-3.21 3.24.81z"/><path class="vb-check" d="M7.4 12.4l3.1 3 6-6.2"/></svg>';
  const vb = (st) => (st === 'verified' ? VERIFIED : '');
  const enc = encodeURIComponent;
  const date = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const ICONS = { 'Téléphones': '📱', 'Tablettes': '📲', 'Ordinateurs': '💻', 'Montres': '⌚', 'Audio': '🎧', 'TV & Maison': '📺', 'Jeux vidéo & consoles': '🎮', 'Composants': '💾', 'Accessoires': '🔌', 'Homme': '👕', 'Femme': '👚', 'Chaussures': '👟' };

  const state = { user: null, orders: [], labels: {}, transitions: {}, products: [], universes: [], suppliers: [], orderFilter: 'paid', productQuery: '', productFilter: 'all', seenPaid: null };
  // Ce que chaque rôle peut ouvrir (le serveur vérifie aussi, de son côté)
  const CAN = {
    orders: () => ['admin', 'orders'].includes(state.user?.role),
    products: () => ['admin', 'catalog', 'supplier'].includes(state.user?.role),
    supplier: () => state.user?.role === 'supplier',
    admin: () => state.user?.role === 'admin',
    courier: () => state.user?.role === 'courier',
    agent: () => state.user?.role === 'agent',
  };
  const homeHash = () => '#/tableau';

  // ---------- API ----------
  async function api(path, options = {}) {
    const res = await fetch('/api/admin' + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: options.body && !(options.body instanceof Blob) ? JSON.stringify(options.body) : options.body,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') { showLogin('Session expirée, reconnectez-vous.'); throw new Error('Session expirée'); }
    if (!res.ok) throw new Error(data.error || 'Erreur réseau, réessayez.');
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  // ---------- Outils d'affichage ----------
  const icon = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="/icons.svg?v=12#${name}"></use></svg>`;
  // En-tête de page façon « Espace pro › Commandes » + titre + description + boutons d'action à droite
  const pageHead = ({ crumb, title, desc = '', actions = '' }) => `
    <div class="page-head">
      <div><div class="crumb">Espace pro › ${esc(crumb || title)}</div><h1>${esc(title)}</h1>${desc ? `<p class="page-desc">${desc}</p>` : ''}</div>
      <div class="page-actions">${actions}</div>
    </div>`;
  const tabsBar = (items, current, attr) =>
    `<div class="tabbar">${items.map(([k, label, n]) => `<button class="tab ${k === current ? 'on' : ''}" data-${attr}="${k}">${esc(label)}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>`;
  const exportBtn = (what) => `<a class="btn" href="/api/admin/export/${what}.csv">${icon('download-simple-bold')} Exporter</a>`;

  // Tableau de données : recherche + tri par colonne (clic sur l'en-tête). Sur téléphone, chaque ligne devient une carte.
  const tableState = {};
  function dataTable(host, { id, columns, rows, searchText, placeholder = 'Rechercher…', empty = 'Rien ici pour le moment.', rowHref, defaultSort = null }) {
    const st = tableState[id] || (tableState[id] = { q: '', sort: defaultSort, dir: -1 });
    host.innerHTML = `
      <div class="table-tools">
        <label class="search">${icon('magnifying-glass-bold')}<input type="search" placeholder="${esc(placeholder)}" value="${esc(st.q)}" aria-label="Rechercher"></label>
        <span class="count-line muted"></span>
      </div>
      <div class="table-wrap"><table class="dt"><thead><tr>${columns.map((c) => `<th class="${c.cls || ''}" ${c.sortable === false ? '' : `data-sort="${c.key}"`}>${esc(c.label)}${c.sortable === false ? '' : `<span class="sort-ico">${icon('caret-down-bold')}</span>`}</th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
    const draw = () => {
      const words = norm(st.q).split(/\s+/).filter(Boolean);
      let list = rows.filter((r) => words.every((w) => norm(searchText(r)).includes(w)));
      const col = columns.find((c) => c.key === st.sort);
      if (col) {
        const v = col.sortValue || ((r) => r[col.key]);
        list = [...list].sort((a, b) => { const x = v(a) ?? ''; const y = v(b) ?? ''; return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
      }
      host.querySelector('tbody').innerHTML = list.length
        ? list.map((r) => `<tr ${rowHref ? `class="link" data-href="${esc(rowHref(r))}"` : ''}>${columns.map((c) => `<td class="${c.cls || ''}" data-label="${esc(c.label)}">${c.render ? c.render(r) : esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')
        : `<tr class="empty-row"><td colspan="${columns.length}">${empty}</td></tr>`;
      host.querySelector('.count-line').textContent = `${list.length} résultat${list.length > 1 ? 's' : ''}`;
      host.querySelectorAll('th[data-sort]').forEach((th) => { th.classList.toggle('sorted', th.dataset.sort === st.sort); th.classList.toggle('asc', th.dataset.sort === st.sort && st.dir === 1); });
    };
    host.querySelector('input').addEventListener('input', (e) => { st.q = e.target.value; draw(); });
    host.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      if (st.sort === th.dataset.sort) st.dir *= -1; else { st.sort = th.dataset.sort; st.dir = -1; }
      draw();
    }));
    host.querySelector('tbody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-href]');
      if (tr && !e.target.closest('button, a')) location.hash = tr.dataset.href;
    });
    draw();
  }

  // ---------- Tableau de bord (graphiques Chart.js, adaptés au rôle) ----------
  const charts = [];
  const PALETTE = ['#FFB300', '#9D8CFF', '#FF6B4F', '#2BC48A', '#5AB4FF', '#F278B6'];
  // Couleurs des graphiques selon l'apparence (recalculées à chaque affichage du tableau de bord)
  function chartTheme() {
    if (!window.Chart) return;
    const lightTheme = document.documentElement.getAttribute('data-theme') === 'light';
    Chart.defaults.color = lightTheme ? '#6B6585' : '#A69FBF';
    Chart.defaults.borderColor = lightTheme ? 'rgba(27,21,48,.08)' : 'rgba(255,255,255,.08)';
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
  }
  chartTheme();
  const shortNum = (n) => new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const dayLabel = (d) => d.slice(8, 10) + '/' + d.slice(5, 7);
  const isEmpty = (list) => !list || !list.length || list.every((x) => !(x.value ?? x));

  function card(title, ico, body, cls = '') {
    return `<section class="card ${cls}"><h2>${icon(ico)} ${esc(title)}</h2>${body}</section>`;
  }
  const chartSlot = (id, data) => (isEmpty(data) ? '<p class="nodata">Pas encore de données</p>' : `<div class="chart-box"><canvas id="${id}"></canvas></div>`);
  function makeChart(id, config) {
    const el = document.getElementById(id);
    if (el && window.Chart) charts.push(new Chart(el, { ...config, options: { responsive: true, maintainAspectRatio: false, ...config.options } }));
  }
  const doughnut = (id, list) => makeChart(id, {
    type: 'doughnut',
    data: { labels: list.map((x) => x.label), datasets: [{ data: list.map((x) => x.value), backgroundColor: PALETTE, borderColor: '#221D2D', borderWidth: 3 }] },
    options: { cutout: '62%', plugins: { legend: { position: 'bottom' } } },
  });
  const hbar = (id, list, money) => makeChart(id, {
    type: 'bar',
    data: { labels: list.map((x) => (x.label.length > 28 ? x.label.slice(0, 27) + '…' : x.label)), datasets: [{ data: list.map((x) => x.value), backgroundColor: PALETTE[1], borderRadius: 6, maxBarThickness: 22 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (money ? fcfa(c.raw) : c.raw) } } }, scales: { x: { ticks: { callback: (v) => shortNum(v) } }, y: { grid: { display: false } } } },
  });

  async function viewDashboard() {
    chartTheme();
    const days = state.days || 30;
    app.innerHTML = '<p class="muted">Chargement du tableau de bord…</p>';
    let d;
    try { d = await api('/stats?days=' + days); } catch { return; }
    if (!location.hash.startsWith('#/tableau') && location.hash !== '' && location.hash !== '#/') return; // la personne a changé de page entre-temps
    const who = state.user.role === 'supplier' ? state.user.company || state.user.name : state.user.name;
    const period = d.role === 'catalog' ? '' : `<div class="period">${[7, 30, 90].map((n) => `<button data-days="${n}" class="${n === days ? 'on' : ''}">${n} jours</button>`).join('')}</div>`;
    const todo = [];
    if (d.todo?.toShip) todo.push(`<a href="#/commandes" data-f="paid">${icon('package-duotone')} ${d.todo.toShip} à expédier</a>`);
    if (d.todo?.idToCheck) todo.push(`<a class="warn" href="#/clients">${icon('identification-card')} ${d.todo.idToCheck} pièce(s) d'identité à vérifier</a>`);
    if (d.todo?.toCollect) todo.push(`<a class="warn" href="#/commandes" data-f="collect">${icon('storefront-duotone')} ${d.todo.toCollect} à encaisser en agence</a>`);
    if (d.todo?.refunds) todo.push(`<a class="danger" href="#/commandes" data-f="paid">${icon('warning-duotone')} ${d.todo.refunds} à rembourser</a>`);
    if (d.pendingProducts) todo.push(`<a class="warn" href="#/produits" data-pf="pending">${icon('clock-countdown-duotone')} ${d.pendingProducts} produit(s) à valider</a>`);

    const stockList = (list) => (list?.length
      ? `<ul class="mini-list">${list.map((p) => `<li><a href="#/produit/${enc(p.id)}">${esc(p.name)}</a>${p.stock != null ? `<span class="tag ${p.stock === 0 ? 'danger' : 'warn'}">${p.stock} en stock</span>` : ''}</li>`).join('')}</ul>`
      : '<p class="nodata">Rien à signaler</p>');
    const cards = [];
    if (d.series) cards.push(card(d.role === 'supplier' ? 'Vos ventes jour par jour' : d.role === 'orders' ? 'Commandes payées par jour' : 'Ventes jour par jour', 'chart-line-up-duotone', chartSlot('cMain', d.series.flatMap((x) => x.data)), 'wide'));
    if (d.byPayment) cards.push(card('Moyens de paiement', 'wallet-duotone', chartSlot('cPay', d.byPayment), 'third'));
    if (d.byStatus) cards.push(card('Commandes par statut', 'receipt-duotone', chartSlot('cStatus', d.byStatus), d.role === 'admin' ? 'third' : ''));
    if (d.byCity) cards.push(card('Villes', 'map-pin-duotone', chartSlot('cCity', d.byCity), 'third'));
    if (d.byCategory) cards.push(card('Produits en ligne par catégorie', 'squares-four-duotone', chartSlot('cCat', d.byCategory)));
    if (d.top) cards.push(card(d.role === 'supplier' ? 'Vos produits les plus vendus' : 'Meilleures ventes (FCFA)', 'trophy-duotone', chartSlot('cTop', d.top)));
    if (d.lowStock) cards.push(card('Stock faible (3 ou moins)', 'warning-duotone', stockList(d.lowStock)));
    if (d.noPhoto) cards.push(card('Produits sans photo', 'image-broken-duotone', stockList(d.noPhoto)));

    // Raccourcis du bandeau d'accueil, selon le rôle
    const quick = [];
    if (CAN.products()) quick.push(`<a class="btn light" href="#/produit/nouveau">${icon('plus-bold')} Ajouter un produit</a>`);
    if (CAN.orders()) quick.push(`<a class="btn glass" href="#/commandes">${icon('receipt-duotone')} Voir les commandes</a>`);
    if (CAN.supplier()) quick.push(`<a class="btn glass" href="#/fournisseur">${icon('receipt-duotone')} Mes commandes</a>`);
    if (CAN.courier()) quick.push(`<a class="btn light" href="#/livraisons">${icon('truck-duotone')} Mes livraisons</a>`);
    if (CAN.agent()) quick.push(`<a class="btn light" href="#/agent">${icon('airplane-tilt')} Achats à traiter</a>`);
    if (CAN.orders()) quick.push(`<a class="btn glass" href="#/france">${icon('airplane-tilt')} Devis Europe</a>`);
    const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    app.innerHTML = `
      <section class="dash-hero">
        <span class="deco o1"></span><span class="deco o2"></span><span class="deco o3"></span><span class="hero-spark"></span>
        <div class="hero-text">
          <p class="hero-date">${esc(today.charAt(0).toUpperCase() + today.slice(1))}</p>
          <h1>Bonjour ${esc(who)}</h1>
          <p>${d.role === 'catalog' ? 'Voici où en est le catalogue.' : `Voici l'activité des ${days} derniers jours.`}</p>
          <div class="hero-actions">${quick.join('')}</div>
        </div>
        ${period ? `<div class="hero-side">${period}</div>` : ''}
      </section>`
      + `<div class="kpis">${d.kpis.map((k, i) => `<div class="kpi kc${i % 4}"><span class="kpi-ico">${icon(k.icon)}</span><span class="kpi-label">${esc(k.label)}</span><span class="kpi-value">${k.format === 'fcfa' ? fcfa(k.value) : new Intl.NumberFormat('fr-FR').format(k.value)}</span>${k.hint ? `<span class="kpi-hint">${esc(k.hint)}</span>` : ''}</div>`).join('')}</div>`
      + (todo.length ? `<div class="todo">${todo.join('')}</div>` : '')
      + `<div class="dash-grid">${cards.join('')}</div>`;

    app.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { state.days = Number(b.dataset.days); route(); }));
    app.querySelectorAll('.todo [data-f]').forEach((a) => a.addEventListener('click', () => { state.orderFilter = a.dataset.f; }));
    app.querySelectorAll('.todo [data-pf]').forEach((a) => a.addEventListener('click', () => { state.productFilter = a.dataset.pf; }));

    if (d.series) {
      const money = (lbl) => /FCFA/.test(lbl);
      makeChart('cMain', {
        data: {
          labels: d.labels.map(dayLabel),
          datasets: d.series.map((x, i) => ({
            type: x.type, label: x.label, data: x.data, yAxisID: x.axis === 'y2' ? 'y2' : 'y', order: x.type === 'line' ? 0 : 1,
            backgroundColor: x.type === 'bar' ? 'rgba(157,140,255,.55)' : 'rgba(255,179,0,.15)', borderColor: x.type === 'bar' ? 'transparent' : PALETTE[0],
            borderRadius: 4, maxBarThickness: 26, tension: 0.35, fill: x.type === 'line', pointRadius: days > 30 ? 0 : 2, borderWidth: x.type === 'line' ? 2 : 0,
          })),
        },
        options: {
          interaction: { mode: 'index', intersect: false },
          plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label} : ${money(c.dataset.label) ? fcfa(c.raw) : c.raw}` } } },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
            y: { beginAtZero: true, ticks: { precision: 0 } },
            ...(d.series.some((x) => x.axis === 'y2') ? { y2: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { callback: (v) => shortNum(v) } } } : {}),
          },
        },
      });
    }
    if (d.byPayment) doughnut('cPay', d.byPayment);
    if (d.byStatus) doughnut('cStatus', d.byStatus);
    if (d.byCategory) doughnut('cCat', d.byCategory);
    if (d.byCity) hbar('cCity', d.byCity, false);
    if (d.top) hbar('cTop', d.top, d.role !== 'supplier');
  }

  // ---------- Connexion ----------
  function showLogin(message) {
    $('#top').hidden = true;
    document.body.classList.remove('logged', 'menu-open');
    app.innerHTML = `
      <form class="panel login" id="loginForm">
        <span class="logo"><img src="/brand/logo-kamwa-clair.svg" alt="Kamwa" width="183" height="44"></span>
        <h1>Espace Kamwa</h1>
        <p class="muted" style="margin-top:-6px">Administration, équipe et fournisseurs</p>
        ${message ? `<div class="alert err">${esc(message)}</div>` : ''}
        <label for="login">Identifiant</label>
        <input id="login" type="text" autocomplete="username" autocapitalize="off" required autofocus placeholder="Ex. admin, paul.mabiala…">
        <label for="password">Mot de passe</label>
        <input id="password" type="password" autocomplete="current-password" required>
        <button class="btn" style="width:100%;margin-top:16px">Se connecter</button>
        <p class="muted">Mot de passe oublié ? Demandez-en un nouveau à l'administrateur. (Administrateur : <code>npm run admin:password</code> dans le Terminal.)</p>
        ${state.demoAccounts?.length ? `
        <div class="demo-box">
          <strong>Démonstration : connectez-vous en un clic</strong>
          <p class="muted">Comptes publics de la démo (données fictives, remises à zéro régulièrement).</p>
          ${state.demoAccounts.map((a) => `<button type="button" class="ghost" data-demo="${esc(a.login)}" data-pw="${esc(a.password)}">${esc(a.label)}</button>`).join('')}
        </div>` : ''}
      </form>`;
    app.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
      $('#login').value = b.dataset.demo;
      $('#password').value = b.dataset.pw;
      $('#loginForm').requestSubmit();
    }));
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        await api('/login', { method: 'POST', body: { login: $('#login').value, password: $('#password').value } });
        enableSound(soundWanted()); // le clic de connexion autorise le son
        await start();
      } catch (err) {
        showLogin(err.message);
      }
    });
  }

  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('menu-open'));
  $('#sideBackdrop').addEventListener('click', () => document.body.classList.remove('menu-open'));

  $('#logoutBtn').addEventListener('click', async () => {
    proEs?.close(); proEs = null;
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.hash = '';
    // On vide tout : la personne suivante (autre rôle) recharge ses propres données
    Object.assign(state, { user: null, seenPaid: null, orders: [], products: [], universes: [], suppliers: [], productFilter: 'all', productQuery: '', demoAccounts: state.demoAccounts });
    document.title = 'Kamwa Admin';
    showLogin();
  });

  // ---------- Sonnerie des nouvelles commandes ----------
  // Les navigateurs n'autorisent le son qu'après un geste (clic) : d'où le bouton « Son ».
  let audio = null;
  const soundWanted = () => { try { return localStorage.getItem('kamwa-admin-sound') !== 'off'; } catch { return true; } };
  function enableSound(on) {
    try { localStorage.setItem('kamwa-admin-sound', on ? 'on' : 'off'); } catch {}
    if (on) {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
    }
    renderSoundBtn();
  }
  const soundOn = () => soundWanted() && audio && audio.state === 'running';
  function renderSoundBtn() {
    $('#soundBtn').innerHTML = soundOn() ? `${icon('bell-bold')}Son activé` : `${icon('bell-slash-bold')}Son coupé`;
    $('#soundBtn').title = soundOn() ? 'Sonnerie activée (cliquer pour couper)' : 'Sonnerie coupée (cliquer pour activer)';
  }
  $('#soundBtn').addEventListener('click', () => {
    enableSound(!soundOn());
    if (soundOn()) ring();
  });
  function ring() {
    if (!soundOn()) return;
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = [880, 1175, 1568][i];
      g.gain.setValueAtTime(0.0001, audio.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t + 0.22);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + t);
      o.stop(audio.currentTime + t + 0.25);
    });
  }

  // ---------- Données ----------
  async function loadOrders() {
    const data = await api('/orders');
    state.orders = data.orders;
    state.labels = data.statusLabels;
    state.transitions = data.transitions;
    state.pickupTransitions = data.pickupTransitions;
    state.failReasons = data.failReasons || {};
    // Nouvelle commande payée (ou confirmée à la réception) depuis la dernière vérification ?
    const isNew = (o) => o.paidAt || o.confirmedAt;
    const paidIds = state.orders.filter(isNew).map((o) => o.id);
    if (state.seenPaid) {
      const fresh = state.orders.filter((o) => isNew(o) && !state.seenPaid.has(o.id));
      if (fresh.length) {
        ring();
        toast(`🛒 Nouvelle commande payée : ${fresh[0].customer.name}, ${fcfa(fresh[0].total)}`);
      }
    }
    state.seenPaid = new Set(paidIds);
    const todo = state.orders.filter((o) => ['paid', 'confirmed'].includes(o.status) || o.paidAfterCancel).length;
    for (const el of [$('#todoCount'), $('#todoCountMobile')]) { el.hidden = !todo; el.textContent = todo; }
    document.title = todo ? `(${todo}) Kamwa Admin` : 'Kamwa Admin';
  }

  async function loadProducts() {
    const [list, meta] = await Promise.all([api('/products'), state.universes.length ? null : api('/meta')]);
    state.products = list;
    if (meta) { state.universes = meta.universes; state.suppliers = meta.suppliers; }
  }

  // Vérifie les nouvelles commandes toutes les 20 s (et rafraîchit la liste si elle est affichée)
  setInterval(async () => {
    if ($('#top').hidden || !CAN.orders()) return;
    try {
      await loadOrders();
      if (location.hash.startsWith('#/commandes') && !document.activeElement?.matches('input, textarea, select')) viewOrders();
    } catch {}
  }, 20000);

  // ---------- Commandes ----------
  const isPickup = (o) => o.fulfillment === 'pickup';
  const paysAtAgency = (o) => Boolean(o.agency) && o.status === 'pending_payment'; // espèces à encaisser à l'agence (retrait OU livraison ensuite)
  const toCollect = (o) => o.status === 'pending_payment' && o.payment?.operator === 'cash' && o.payment.status === 'PENDING' && !(o.payment.expiresAt && Date.now() > Date.parse(o.payment.expiresAt));
  const PAY_LABELS = { mtn: 'MTN MoMo', airtel: 'Airtel Money', card: 'Carte bancaire', cash: 'Espèces en agence' };
  const PAY_STATUS = { PENDING: 'en attente', SUCCESSFUL: 'réussi', FAILED: 'échoué', CANCELLED: 'remplacé' };
  const FILTERS = [
    ['paid', 'À livrer / remettre'],
    ['collect', 'À encaisser en agence'],
    ['france', 'Achats Europe en cours'],
    ['shipped', 'En livraison'],
    ['delivered', 'Livrées'],
    ['cancelled', 'Annulées'],
    ['pending_payment', 'Non payées'],
    ['all', 'Toutes'],
  ];
  const badge = (status) => `<span class="badge st-${status}">${esc(state.labels[status] || status)}</span>`;

  function viewOrders() {
    const f = state.orderFilter;
    const waitingFr = (o) => o.import && o.paidAt && o.status === 'paid' && o.import.stage !== 'arrived';
    const matches = (o, k) => k === 'all' || (k === 'france' ? waitingFr(o) : k === 'collect' ? toCollect(o) : o.status === k && !(k === 'paid' && waitingFr(o))) || (k === 'paid' && (o.paidAfterCancel || o.status === 'confirmed'));
    const list = state.orders.filter((o) => matches(o, f));
    const qty = (o) => o.lines.reduce((s, l) => s + l.qty, 0);
    app.innerHTML = pageHead({ title: 'Commandes', desc: 'Suivez chaque commande, du paiement à la livraison. Cliquez sur une ligne pour la gérer.', actions: exportBtn('orders') })
      + tabsBar(FILTERS.map(([k, label]) => [k, label, state.orders.filter((o) => matches(o, k)).length]), f, 'filter')
      + (f === 'pending_payment' ? '<p class="muted">Commandes commencées mais pas payées (paiement refusé, abandonné, en cours, ou réservation en agence). Rien à expédier.</p>' : '')
      + (f === 'collect' ? '<p class="muted">Réservations en cours : le client vient payer en espèces à l\'agence. Préparez les articles.</p>' : '')
      + '<div id="tbl"></div>';
    dataTable($('#tbl'), {
      id: 'orders', rows: list, defaultSort: 'createdAt', rowHref: (o) => '#/commande/' + enc(o.id),
      placeholder: 'N° de commande, client, téléphone ou ville', empty: 'Aucune commande ici.',
      searchText: (o) => `${o.id} ${o.customer.name} ${o.customer.phone} ${o.customer.city}`,
      columns: [
        { key: 'id', label: 'Commande', render: (o) => `<strong class="mono">${esc(o.id)}</strong>${o.paidAfterCancel ? '<br><span class="tag danger">À rembourser</span>' : ''}${isPickup(o) ? `<br><span class="tag">Retrait ${esc(o.agency?.name || '')}</span>` : o.agency ? `<br><span class="tag">Payé à ${esc(o.agency.name || 'l\'agence')} · livré</span>` : ''}${o.paymentPlan === 'cod' ? `<br><span class="tag warn">À la réception</span>` : ''}${o.import ? `<br><span class="tag fr">${icon('airplane-tilt')} Europe : ${esc(FR_STAGES[o.import.stage] || o.import.stage)}</span>` : ''}${!isPickup(o) && ['paid', 'confirmed'].includes(o.status) && !o.callConfirmedAt ? ' <span class="tag danger">À appeler</span>' : ''}${o.courierName && o.status === 'shipped' ? `<br><span class="muted">${icon('truck-duotone')} ${esc(o.courierName)}</span>` : ''}` },
        { key: 'client', label: 'Client', sortValue: (o) => norm(o.customer.name), render: (o) => `${esc(o.customer.name)}${vb(o.account?.idStatus)}<br><span class="muted">${esc(o.customer.phone)}</span>` },
        { key: 'city', label: 'Ville', sortValue: (o) => o.customer.city || '', render: (o) => esc(o.customer.city || '—') },
        { key: 'qty', label: 'Articles', cls: 'num', sortValue: qty, render: qty },
        { key: 'total', label: 'Total', cls: 'num', render: (o) => fcfa(o.total) },
        { key: 'pay', label: 'Paiement', sortValue: (o) => o.payment?.operator || '', render: (o) => esc(PAY_LABELS[o.payment?.operator] || '—') },
        { key: 'status', label: 'Statut', render: (o) => badge(o.status) },
        { key: 'createdAt', label: 'Date', render: (o) => date(o.createdAt) },
      ],
    });
    app.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { state.orderFilter = b.dataset.filter; viewOrders(); }));
  }

  const ACTIONS = {
    shipped: ['Marquer « en livraison » 🚚', 'btn dark'],
    confirmed: ['Revenir à « à livrer »', 'ghost'],
    delivered: ['Marquer livrée ✓', 'btn green'],
    handed: ['Remise au client ✓', 'btn green'],
    paid: ['Revenir à « Payée »', 'ghost'],
    cancelled: ['Annuler la commande', 'ghost'],
  };

  function viewOrder(id) {
    const o = state.orders.find((x) => x.id === id);
    if (!o) { app.innerHTML = '<p class="empty">Commande introuvable. <a href="#/commandes">Retour</a></p>'; return; }
    const c = o.customer;
    const intl = '242' + c.phone;
    const pay = o.payment;
    app.innerHTML = `
      <p><a href="#/commandes">‹ Toutes les commandes</a></p>
      <div class="row between"><h1>${esc(o.id)}</h1>${badge(o.status)}</div>
      ${o.paidAfterCancel ? '<div class="alert err">⚠️ Le client a payé alors que la commande était annulée. Remboursez-le via Mobile Money.</div>' : ''}

      <div class="panel">
        <h2>Articles</h2>
        <div class="lines">
          ${o.lines.map((l) => `<div><span>${l.qty} × ${esc(l.name)}</span><span>${fcfa(l.total)}</span></div>`).join('')}
          <div><span>Total</span><span>${fcfa(o.total)}</span></div>
        </div>
      </div>
      ${CAN.orders() ? docsPanel(o) : ''}

      <div class="panel">
        <h2>Client</h2>
        <p style="margin:0 0 4px"><strong>${esc(c.name)}</strong>${vb(o.account?.idStatus)} · ${esc(c.phone)}</p>
        <p class="muted" style="margin:0 0 10px">${esc(c.city || '—')} · ${esc(c.address || 'pas d\'adresse')}</p>
        <div class="row">
          <a class="btn dark" href="tel:+${intl}">📞 Appeler</a>
          <a class="btn green" href="https://wa.me/${intl}" target="_blank" rel="noopener">WhatsApp</a>
          <button class="ghost" id="editCustomer">Modifier</button>
        </div>
        ${o.account ? `<p class="muted" style="margin:10px 0 0">👤 Compte client ${esc(o.account.id)}${o.account.email ? ' · ' + esc(o.account.email) : ''} <button class="ghost" id="newCodeBtn" style="min-height:32px;padding:4px 10px">Nouveau code</button></p><div id="newCodeBox"></div>` : '<p class="muted" style="margin:10px 0 0">Commande passée sans compte client.</p>'}
        <form id="customerForm" hidden>
          <label for="cName">Nom</label><input id="cName" type="text" value="${esc(c.name)}">
          <label for="cPhone">Téléphone</label><input id="cPhone" type="tel" value="${esc(c.phone)}">
          <label for="cCity">Ville</label><input id="cCity" type="text" value="${esc(c.city)}">
          <label for="cAddress">Quartier / adresse / repère</label><textarea id="cAddress" rows="2">${esc(c.address)}</textarea>
          <button class="btn" style="margin-top:12px">Enregistrer</button>
        </form>
      </div>

      ${o.import ? importPanel(o) : ''}
      ${o.import && o.import.stage !== 'arrived' ? '' : deliveryPanel(o)}

      <div class="panel">
        <h2>Suivi</h2>
        ${!isPickup(o) && o.agency ? `<p style="margin:0 0 10px"><span class="tag">🏪 Paiement en agence puis livraison</span> <strong>${esc(o.agency.name)}</strong> (${esc(o.agency.city)})${o.status === 'pending_payment' && o.pickupDeadline ? `<br><span class="muted">À payer avant le ${date(o.pickupDeadline)}${Date.now() > Date.parse(o.pickupDeadline) ? ' — <strong style="color:var(--err)">délai dépassé</strong>' : ''}</span>` : ''}</p>` : ''}
        ${isPickup(o) ? `<p style="margin:0 0 10px"><span class="tag">🏪 Retrait en agence</span> <strong>${esc(o.agency?.name)}</strong> (${esc(o.agency?.city)})${o.status === 'pending_payment' && o.pickupDeadline ? `<br><span class="muted">Réservé jusqu'au ${date(o.pickupDeadline)}${Date.now() > Date.parse(o.pickupDeadline) ? ' — <strong style="color:var(--err)">délai dépassé</strong>' : ''}</span>` : ''}</p>` : ''}
        <div class="row">
          ${paysAtAgency(o) ? `<button class="btn green" id="cashBtn">💵 Paiement reçu en agence (${fcfa(o.total)})</button>` : ''}
          ${(o.transitions || []).map((s) => {
            const [label, cls] = ACTIONS[isPickup(o) && s === 'delivered' ? 'handed' : s];
            return `<button class="${cls}" data-status="${s}">${label}</button>`;
          }).join('') || '<span class="muted">Aucune action possible.</span>'}
        </div>
        <ul class="history" style="margin-top:12px">
          <li>Créée le ${date(o.createdAt)}</li>
          ${(o.history || []).map((h) => `<li>${esc(state.labels[h.status] || h.status)} le ${date(h.at)}</li>`).join('')}
        </ul>
        ${pay ? `<p class="muted">Paiement : ${PAY_LABELS[pay.operator] || esc(pay.operator)}${pay.phone ? ' · ' + esc(pay.phone) : ''} · ${esc(PAY_STATUS[pay.status] || pay.status)}${pay.reason ? ' (' + esc(pay.reason) + ')' : ''}</p>` : ''}
        <label for="note">Note interne (le client ne la voit pas)</label>
        <textarea id="note" rows="2" placeholder="Ex. livré par Jean, client absent le matin…">${esc(o.note)}</textarea>
        <button class="ghost" id="saveNote" style="margin-top:8px">Enregistrer la note</button>
      </div>`;

    const save = async (body, okMsg) => {
      try {
        const updated = await api('/orders/' + enc(o.id), { method: 'PATCH', body });
        state.orders = state.orders.map((x) => (x.id === o.id ? updated : x));
        await loadOrders().catch(() => {});
        toast(okMsg);
        viewOrder(o.id);
      } catch (err) {
        toast('❌ ' + err.message);
      }
    };

    app.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
      const s = b.dataset.status;
      if (s === 'cancelled') {
        const msg = o.status === 'pending_payment'
          ? 'Annuler cette commande non payée ?'
          : 'Annuler cette commande ?\n\nLes articles reviendront en stock.\nLe client a payé : pensez à le rembourser via Mobile Money.';
        if (!confirm(msg)) return;
      }
      save({ status: s }, `Commande : ${state.labels[s]}`);
    }));
    $('#editCustomer').addEventListener('click', () => { $('#customerForm').hidden = !$('#customerForm').hidden; });
    $('#customerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      save({ customer: { name: $('#cName').value, phone: $('#cPhone').value, city: $('#cCity').value, address: $('#cAddress').value } }, 'Client mis à jour');
    });
    $('#saveNote').addEventListener('click', () => save({ note: $('#note').value }, 'Note enregistrée'));
    if (o.account) $('#newCodeBtn').addEventListener('click', () => newCode(o.account, $('#newCodeBox')));
    bindDeliveryPanel(o);
    $('#cashBtn')?.addEventListener('click', async () => {
      if (!confirm(`Confirmer avoir reçu ${fcfa(o.total)} en espèces de ${c.name} ?\n\nLa commande passera en « Payée » et le stock sera décompté.`)) return;
      try {
        const updated = await api('/orders/' + enc(o.id) + '/cash-received', { method: 'POST' });
        state.orders = state.orders.map((x) => (x.id === o.id ? updated : x));
        await loadOrders().catch(() => {});
        toast('Paiement en espèces enregistré ✓');
        viewOrder(o.id);
      } catch (err) {
        toast('❌ ' + err.message);
      }
    });
  }

  // Bouton « → Kamwa » (favori) : copie les informations publiques de la page produit ouverte et ouvre une fiche pré-remplie.
  // Fonction AUTONOME (convertie en texte) : elle s'exécute sur la page du site vendeur, pas dans Kamwa.
  function KAMWA_BM(origin) {
    // Outils « propres » pris dans une page vierge : certains sites modifient JSON, encodeURIComponent… et cassaient les données
    var J = JSON, E = encodeURIComponent, frame = null;
    try { frame = document.createElement('iframe'); frame.style.display = 'none'; document.documentElement.appendChild(frame); J = frame.contentWindow.JSON; E = frame.contentWindow.encodeURIComponent; } catch (e) { J = JSON; E = encodeURIComponent; }
    // Texte coupé sans jamais casser un caractère (émojis…) et sans caractère invalide
    var cut = function (x, n) { var t = String(x || '').slice(0, n); if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1); return t.toWellFormed ? t.toWellFormed() : t.replace(/[\uD800-\uDFFF]/g, ''); };
    var d = { u: location.href, n: '', b: '', de: '', im: [], p: null, c: null, co: [], si: [] };
    var A = function (x) { return x == null ? [] : Array.isArray(x) ? x : [x]; };
    var T = function (x) { return (new DOMParser().parseFromString(String(x || ''), 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim(); }; // analyse inerte (aucun script exécuté)
    var N = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      try { (function w(n) { A(n).forEach(function (x) { if (x && typeof x === 'object') { N.push(x); if (x['@graph']) w(x['@graph']); } }); })(J.parse(s.textContent)); } catch (e) { /* ignoré */ }
    });
    var isT = function (x, t) { return A(x['@type']).join(',').toLowerCase().indexOf(t.toLowerCase()) >= 0; }; // « product » en minuscules (ex. Cdiscount)
    var P = N.filter(function (x) { return isT(x, 'ProductGroup'); })[0] || N.filter(function (x) { return isT(x, 'Product'); })[0];
    if (P) {
      d.n = T(P.name); d.b = T(P.brand && P.brand.name || P.brand); d.de = T(P.description);
      A(P.image).forEach(function (i) { d.im.push(i && i.url || i); });
      var gid = P['@id'];
      var V = A(P.hasVariant).concat(N.filter(function (x) { return x !== P && isT(x, 'Product') && gid && x.isVariantOf && x.isVariantOf['@id'] === gid; })); // variantes séparées (ex. Decathlon)
      A(P.offers).concat(V.map(function (v) { return v.offers; })).forEach(function (o) {
        A(o).forEach(function (o) { var ps = o && A(o.priceSpecification)[0]; var p = parseFloat(String(o && (o.price || o.lowPrice || (ps && ps.price)) || '').replace(',', '.')); if (p && (!d.p || p < d.p)) { d.p = p; d.c = o.priceCurrency || (ps && ps.priceCurrency); } });
      });
      [P].concat(V).forEach(function (v) {
        A(v.color).forEach(function (c) { c = T(c); if (c && d.co.indexOf(c) < 0) d.co.push(c); });
        A(v.size).forEach(function (c) { c = T(c && c.name || c); if (c && d.si.indexOf(c) < 0) d.si.push(c); });
        if (V.length) A(v.image).forEach(function (i) { d.im.push(i && i.url || i); });
      });
    }
    var M = function (k) { var m = document.querySelector('meta[property="' + k + '"],meta[name="' + k + '"]'); return m && m.content; };
    d.n = d.n || M('og:title') || document.title; d.de = d.de || M('og:description') || M('description') || '';
    if (!d.im.length && M('og:image')) d.im.push(M('og:image'));
    // Grandes photos affichées sur la page (souvent plus nombreuses que dans les données structurées)
    Array.prototype.slice.call(document.images).filter(function (i) { return i.naturalWidth >= 500 && i.naturalHeight >= 400 && /^https?:/.test(i.currentSrc || i.src); })
      .forEach(function (i) { var u = i.currentSrc || i.src; if (d.im.indexOf(u) < 0) d.im.push(u); });
    if (!d.p) { d.p = parseFloat(String(M('product:price:amount') || '').replace(',', '.')) || null; d.c = M('product:price:currency'); }
    d.im = d.im.filter(Boolean).map(function (u) { try { return new URL(u, location.href).href; } catch (e) { return null; } }).filter(Boolean).slice(0, 6);
    d.u = cut(d.u, 600); d.n = cut(d.n, 160); d.b = cut(d.b, 60); d.de = cut(d.de, 1200);
    d.im = d.im.map(function (u) { return cut(u, 500); });
    d.co = d.co.slice(0, 20).map(function (x) { return cut(x, 40); }); d.si = d.si.slice(0, 30).map(function (x) { return cut(x, 30); });
    var s = E(J.stringify(d));
    if (frame) frame.remove();
    window.open(origin + '/admin/#/produit/nouveau?kamwa2=' + s, '_blank');
  }
  const bookmarklet = () => 'javascript:' + encodeURIComponent(`(${KAMWA_BM.toString()})(${JSON.stringify(location.origin)})`);

  // ---------- Achat en Europe ----------
  const FR_STAGES = { to_buy: 'à acheter', bought: 'acheté', received: "reçu par l'agent", shipped_fr: 'parti d’Europe', arrived: 'arrivé au Congo' };
  const eur = (n) => `${Number(n || 0).toFixed(2).replace('.', ',')} €`;
  const importPanel = (o) => {
    const i = o.import;
    return `<div class="panel">
      <h2>${icon('airplane-tilt')} Achat en Europe — ${esc(FR_STAGES[i.stage] || i.stage)}</h2>
      ${(i.items || []).map((it) => `<p style="margin:4px 0">${it.qty} × <a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>${it.options ? ` <span class="muted">(${esc(it.options)})</span>` : ''} <span class="muted">— devis : ${eur(it.priceEur)}</span></p>`).join('')}
      ${i.bought ? `<p class="muted">Acheté ${eur(i.bought.eur)} par ${esc(i.bought.by)} le ${date(i.bought.at)}${i.bought.ref ? ' · réf. ' + esc(i.bought.ref) : ''}${i.bought.receipt ? ` · <a href="${esc(i.bought.receipt)}" target="_blank">facture</a>` : ''}</p>` : ''}
      ${i.received ? `<div class="gallery" style="margin-top:8px">${i.received.photos.map((src) => `<div class="gal-item"><img src="${esc(src)}" alt=""></div>`).join('')}</div>` : ''}
      ${i.shipmentId ? `<p class="muted">Envoi ${esc(i.shipmentId)}${i.eta ? ` · arrivée prévue ${esc(i.eta.split('-').reverse().join('/'))}` : ''}</p>` : ''}
      ${i.stage !== 'arrived' ? '<p class="muted">La livraison au client sera possible quand l\'envoi sera marqué « arrivé au Congo » (page Envois).</p>' : ''}
    </div>`;
  };

  async function viewFrance(id) {
    if (id) return viewFranceRequest(decodeURIComponent(id));
    let list = [];
    try { list = await api('/france/requests'); } catch { return; }
    const f = state.frFilter || 'requested';
    const TABS = [['requested', 'À chiffrer'], ['quoted', 'Devis envoyés'], ['accepted', 'Acceptés'], ['closed', 'Expirés / refusés'], ['all', 'Toutes']];
    const ST = { requested: ['À chiffrer', 'warn'], quoted: ['Devis envoyé', ''], accepted: ['Accepté', 'ok'], expired: ['Expiré', 'danger'], declined: ['Refusé', 'danger'], cancelled: ['Annulé par le client', 'danger'] };
    const match = (r, k) => k === 'all' || r.status === k || (k === 'closed' && ['expired', 'declined', 'cancelled'].includes(r.status));
    app.innerHTML = pageHead({ title: 'Achat en Europe', desc: 'Les demandes de devis des clients. Chiffrez-les (prix en €, port, poids) : le prix tout compris en FCFA se calcule tout seul, puis envoyez le lien au client par WhatsApp.', actions: `<a class="btn ghost" href="#/envois">${icon('truck-duotone')} Envois</a><a class="btn ghost" href="#/reglages">Tarifs</a>` })
      + tabsBar(TABS.map(([k, l]) => [k, l, list.filter((r) => match(r, k)).length]), f, 'frf') + '<div id="tbl"></div>';
    dataTable($('#tbl'), {
      id: 'france', rows: list.filter((r) => match(r, f)), defaultSort: 'createdAt', rowHref: (r) => '#/france/' + enc(r.id), placeholder: 'N°, client, article', empty: 'Aucune demande ici.',
      searchText: (r) => `${r.id} ${r.customer.name} ${r.customer.phone} ${r.items.map((it) => it.title + ' ' + it.url).join(' ')}`,
      columns: [
        { key: 'id', label: 'Demande', render: (r) => `<strong class="mono">${esc(r.id)}</strong>` },
        { key: 'client', label: 'Client', sortValue: (r) => r.customer.name, render: (r) => `${esc(r.customer.name)}<br><span class="muted">${esc(r.customer.city || '')}</span>` },
        { key: 'items', label: 'Articles', sortable: false, render: (r) => r.items.map((it) => `${it.qty} × ${esc(it.title || new URL(it.url).hostname)}`).join('<br>') },
        { key: 'total', label: 'Devis', cls: 'num', sortValue: (r) => r.quote?.total || 0, render: (r) => (r.quote ? fcfa(r.quote.total) : '—') },
        { key: 'status', label: 'Statut', render: (r) => `<span class="tag ${ST[r.status]?.[1] || ''}">${esc(ST[r.status]?.[0] || r.status)}</span>${r.order?.stage ? `<br><span class="muted">${esc(FR_STAGES[r.order.stage] || '')}</span>` : ''}` },
        { key: 'createdAt', label: 'Date', render: (r) => date(r.createdAt) },
      ],
    });
    app.querySelectorAll('[data-frf]').forEach((b) => b.addEventListener('click', () => { state.frFilter = b.dataset.frf; viewFrance(); }));
  }

  async function viewFranceRequest(id) {
    let r, s;
    try { [r, s] = await Promise.all([api('/france/requests/' + enc(id)), api('/france/settings')]); } catch { return; }
    const q = r.quote;
    const link = `${location.origin}/#/devis/${enc(r.id)}/${enc(r.shareToken)}`;
    const intl = '242' + r.customer.phone;
    const waText = (txt) => `https://wa.me/${intl}?text=${encodeURIComponent(txt)}`;
    const editable = ['requested', 'quoted', 'expired'].includes(r.status);
    app.innerHTML = pageHead({ crumb: 'Achat en Europe', title: `Demande ${r.id}`, desc: `${esc(r.customer.name)} · ${esc(r.customer.phone)} · ${esc(r.customer.city || '')}${r.customer.address ? ' · ' + esc(r.customer.address) : ''}`, actions: `<a class="btn green" href="https://wa.me/${intl}" target="_blank" rel="noopener">WhatsApp</a>` })
      + (r.note ? `<div class="alert warn">Note du client : ${esc(r.note)}</div>` : '')
      + (r.status === 'accepted' && r.order ? `<div class="alert ok">Devis accepté : commande <a href="#/commande/${enc(r.order.id)}">${esc(r.order.id)}</a> (${esc(state.labels?.[r.order.status] || r.order.status)}${r.order.stage ? ', ' + esc(FR_STAGES[r.order.stage]) : ''}).</div>` : '')
      + (r.status === 'declined' ? `<div class="alert err">Refusée : ${esc(r.declineReason || '')}</div>` : '')
      + `<form class="panel" id="quoteForm" novalidate>
        <h2>Chiffrage</h2>
        ${r.items.map((it, i) => `<fieldset class="q-item" data-i="${i}">
          <legend>Article ${i + 1} · <a href="${esc(it.url)}" target="_blank" rel="noopener">ouvrir le lien ${icon('arrow-square-out-bold')}</a></legend>
          <p class="muted" style="margin:0 0 6px">${it.qty} × ${esc(it.title || '(sans nom)')}${it.options ? ' · ' + esc(it.options) : ''}${it.priceEur ? ` · prix indiqué par le client : ${eur(it.priceEur)}` : ''}</p>
          <div class="grid2">
            <div><label>Nom de l'article</label><input name="title" type="text" value="${esc(q?.items[i]?.title || it.title)}" ${editable ? '' : 'disabled'}></div>
            <div><label>Quantité</label><input name="qty" type="number" min="1" value="${esc(q?.items[i]?.qty || it.qty)}" ${editable ? '' : 'disabled'}></div>
            <div><label>Prix unitaire en Europe (€)</label><input name="priceEur" type="text" inputmode="decimal" value="${esc(q?.items[i]?.priceEur ?? it.priceEur ?? '')}" ${editable ? '' : 'disabled'}></div>
            <div><label>Port jusqu'à l'agent (€)</label><input name="shippingEur" type="text" inputmode="decimal" value="${esc(q?.items[i]?.shippingEur ?? 0)}" ${editable ? '' : 'disabled'}></div>
          </div>
        </fieldset>`).join('')}
        <div class="grid2">
          <div><label for="qWeight">Poids total estimé (kg, emballage compris)</label><input id="qWeight" type="text" inputmode="decimal" value="${esc(q?.weightKg ?? '')}" placeholder="Ex. 1,2" ${editable ? '' : 'disabled'}></div>
          <div><label for="qTotal">Prix final (FCFA) — vide = calcul automatique</label><input id="qTotal" type="number" step="500" value="" placeholder="${q ? q.total : ''}" ${editable ? '' : 'disabled'}></div>
        </div>
        <div class="calc" id="calc"></div>
        <label for="qMsg">Message au client (facultatif)</label><textarea id="qMsg" rows="2" maxlength="500" ${editable ? '' : 'disabled'}>${esc(q?.message || '')}</textarea>
        <div id="qErr"></div>
        ${editable ? `<div class="row" style="margin-top:14px"><button class="btn">${r.status === 'requested' ? 'Envoyer le devis' : 'Mettre à jour le devis'}</button><button type="button" class="ghost" id="declineBtn">Impossible à faire venir</button></div>` : ''}
      </form>
      ${q ? `<div class="panel"><h2>Envoyer au client</h2>
        <p class="muted">Lien personnel du devis (valable jusqu'au ${date(q.validUntil)}) :</p>
        <input type="text" readonly value="${esc(link)}" id="shareLink">
        <div class="row" style="margin-top:10px">
          <a class="btn green" target="_blank" rel="noopener" href="${esc(waText(`Bonjour ${r.customer.name.split(' ')[0]}, voici votre devis Kamwa pour votre achat en Europe : ${fcfa(q.total)} tout compris, livré à ${r.customer.city || 'domicile'} (${q.delay}). Pour accepter et payer : ${link}`))}">Envoyer par WhatsApp</a>
          <button type="button" class="ghost" id="copyLink">Copier le lien</button>
        </div></div>` : ''}`;
    const read = () => ({
      items: [...app.querySelectorAll('.q-item')].map((f) => { const v = (n) => f.querySelector(`[name="${n}"]`).value; return { title: v('title'), qty: v('qty'), priceEur: v('priceEur'), shippingEur: v('shippingEur') }; }),
      weightKg: $('#qWeight').value, total: $('#qTotal').value || undefined, message: $('#qMsg').value,
    });
    const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
    // Même calcul que le serveur (src/imports.js), pour voir le prix pendant la saisie
    const calc = () => {
      const b = read();
      const e = b.items.reduce((n, it) => n + num(it.priceEur) * (num(it.qty) || 1) + num(it.shippingEur), 0);
      const goods = Math.round(e * s.rate);
      const w = Math.max(num(b.weightKg), s.minWeightKg);
      const freight = Math.round(w * s.freightPerKg);
      const customs = Math.round((goods * s.customsPercent) / 100);
      const cost = goods + freight + customs;
      const total = Math.ceil((cost + Math.round((cost * s.commissionPercent) / 100) + s.fixedFee) / s.roundTo) * s.roundTo;
      const finalT = b.total ? num(b.total) : total;
      $('#calc').innerHTML = e ? `<div class="lines">
        <div><span>Articles + port en Europe (${eur(e)} × ${s.rate})</span><span>${fcfa(goods)}</span></div>
        <div><span>Transport (${String(w).replace('.', ',')} kg × ${fcfa(s.freightPerKg)})</span><span>${fcfa(freight)}</span></div>
        <div><span>Douane estimée (${s.customsPercent} %)</span><span>${fcfa(customs)}</span></div>
        <div><span>Coût total pour Kamwa</span><span>${fcfa(cost)}</span></div>
        <div><span>Marge Kamwa</span><span class="${finalT - cost < 0 ? 'neg' : 'pos'}">${fcfa(finalT - cost)}</span></div>
        <div><span>Prix tout compris pour le client</span><span class="price">${fcfa(finalT)}</span></div></div>` : '<p class="muted">Saisissez les prix en euros pour voir le calcul.</p>';
    };
    app.querySelectorAll('#quoteForm input').forEach((i) => i.addEventListener('input', calc));
    calc();
    $('#quoteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/france/requests/' + enc(r.id) + '/quote', { method: 'POST', body: read() }); toast('Devis enregistré ✓ Envoyez-le au client par WhatsApp'); viewFranceRequest(r.id); } catch (err) { $('#qErr').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    $('#declineBtn')?.addEventListener('click', async () => {
      const reason = prompt('Raison donnée au client :', "Cet article ne peut pas être expédié vers le Congo (produit interdit au transport ou indisponible).");
      if (reason === null) return;
      try { await api('/france/requests/' + enc(r.id) + '/decline', { method: 'POST', body: { reason } }); toast('Demande refusée'); viewFranceRequest(r.id); } catch (err) { toast('❌ ' + err.message); }
    });
    $('#copyLink')?.addEventListener('click', () => { $('#shareLink').select(); navigator.clipboard?.writeText(link).then(() => toast('Lien copié ✓'), () => {}); });
  }

  // Espace de l'agent en Europe : acheter, recevoir (photos), préparer et faire partir les envois
  async function viewAgent() {
    let list = [], ships = [];
    try { [list, ships] = await Promise.all([api('/france/orders'), api('/france/shipments')]); } catch { return; }
    const by = (st) => list.filter((o) => o.import.stage === st);
    const uploadPhoto = async (file) => { const blob = await shrinkImage(file, 1400); return (await api('/uploads', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } })).url; };
    const itemsHtml = (o) => o.import.items.map((it) => `<li>${it.qty} × <a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>${it.options ? ` — <strong>${esc(it.options)}</strong>` : ''} <span class="muted">(budget ${eur(it.priceEur)}${it.shippingEur ? ' + port ' + eur(it.shippingEur) : ''})</span></li>`).join('');
    const card = (o, form) => `<article class="deliv" data-id="${esc(o.id)}"><div class="row between"><strong class="mono">${esc(o.id)}</strong><span class="muted">payée le ${date(o.paidAt)}</span></div>
      <p class="muted" style="margin:4px 0">Pour ${esc(o.customer.name)} (${esc(o.customer.city || '')})</p><ul class="fr-list">${itemsHtml(o)}</ul>${form}</article>`;
    app.innerHTML = pageHead({ title: 'Achats Europe à traiter', desc: "Achetez les articles des commandes payées, prenez-les en photo à la réception, puis regroupez-les dans un envoi vers le Congo." })
      + `<h2>1. À acheter (${by('to_buy').length})</h2><div class="deliv-list">${by('to_buy').map((o) => card(o, `
        <form class="deliver-form" data-act="bought"><label>Montant payé (€, port compris)</label><input name="eur" type="text" inputmode="decimal" placeholder="Ex. 64,98"><label>N° de commande du site (facultatif)</label><input name="ref" type="text">
        <label class="btn ghost" style="margin:0">${icon('camera')} Photo de la facture<input name="receiptFile" type="file" accept="image/*" capture="environment" hidden></label><span class="muted rcpt"></span>
        <div class="msg"></div><button class="btn">Acheté ✓</button></form>`)).join('') || '<p class="muted">Rien à acheter.</p>'}</div>
      <h2 style="margin-top:22px">2. Achetés, en attente de réception (${by('bought').length})</h2><div class="deliv-list">${by('bought').map((o) => card(o, `
        <form class="deliver-form" data-act="received"><label class="btn ghost" style="margin:0">${icon('camera')} Photos de l'article reçu<input name="photos" type="file" accept="image/*" multiple hidden></label><span class="muted ph"></span>
        <div class="msg"></div><button class="btn">Reçu ✓</button></form>`)).join('') || '<p class="muted">Rien en attente.</p>'}</div>
      <h2 style="margin-top:22px">3. Reçus, à envoyer (${by('received').filter((o) => !o.import.shipmentId).length})</h2>
      ${by('received').filter((o) => !o.import.shipmentId).length ? `<form class="panel" id="shipForm">
        ${by('received').filter((o) => !o.import.shipmentId).map((o) => `<label class="check"><input type="checkbox" name="o" value="${esc(o.id)}" checked> ${esc(o.id)} — ${o.import.items.map((it) => `${it.qty} × ${esc(it.title)}`).join(', ')}</label>`).join('')}
        <div class="grid2">
          <div><label>Expéditeur</label><input name="carrier" type="text" placeholder="Nom du transitaire"></div>
          <div><label>Mode</label><select name="mode"><option value="avion">Avion</option><option value="bateau">Bateau</option></select></div>
          <div><label>N° de suivi / bordereau</label><input name="tracking" type="text"></div>
          <div><label>Arrivée prévue au Congo</label><input name="eta" type="date"></div>
          <div><label>Poids total (kg)</label><input name="weightKg" type="text" inputmode="decimal"></div>
          <div><label>Coût du transport (€)</label><input name="costEur" type="text" inputmode="decimal"></div>
        </div><div class="msg"></div><button class="btn" style="margin-top:10px">Préparer l'envoi</button></form>` : '<p class="muted">Aucun colis en attente d\'envoi.</p>'}
      <h2 style="margin-top:22px">Envois</h2>${shipmentsTable(ships, true)}`;
    app.querySelectorAll('input[name=receiptFile]').forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.closest('form'); const span = f.querySelector('.rcpt'); span.textContent = 'Envoi…';
      try { f.dataset.receipt = await uploadPhoto(inp.files[0]); span.textContent = 'Facture ajoutée ✓'; } catch (err) { span.textContent = '❌ ' + err.message; }
    }));
    app.querySelectorAll('input[name=photos]').forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.closest('form'); const span = f.querySelector('.ph'); span.textContent = 'Envoi…';
      try { const urls = []; for (const file of [...inp.files].slice(0, 6)) urls.push(await uploadPhoto(file)); f.dataset.photos = JSON.stringify(urls); span.textContent = `${urls.length} photo(s) ajoutée(s) ✓`; } catch (err) { span.textContent = '❌ ' + err.message; }
    }));
    app.querySelectorAll('form[data-act]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = f.closest('[data-id]').dataset.id;
      const body = f.dataset.act === 'bought' ? { eur: f.eur.value, ref: f.ref.value, receipt: f.dataset.receipt } : { photos: JSON.parse(f.dataset.photos || '[]') };
      try { await api('/france/orders/' + enc(id) + '/' + f.dataset.act, { method: 'POST', body }); toast('Enregistré ✓'); viewAgent(); } catch (err) { f.querySelector('.msg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    }));
    $('#shipForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = { orderIds: [...f.querySelectorAll('input[name=o]:checked')].map((x) => x.value), carrier: f.carrier.value, mode: f.mode.value, tracking: f.tracking.value, eta: f.eta.value, weightKg: f.weightKg.value, costEur: f.costEur.value };
      try { await api('/france/shipments', { method: 'POST', body }); toast('Envoi préparé ✓'); viewAgent(); } catch (err) { f.querySelector('.msg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    bindShipments();
  }

  const SHIP_ST = { preparing: ['En préparation', 'warn'], departed: ['Parti d’Europe', ''], arrived: ['Arrivé au Congo', 'ok'] };
  function shipmentsTable(ships, agentSide) {
    if (!ships.length) return '<p class="muted">Aucun envoi pour le moment.</p>';
    return `<div class="table-wrap"><table class="dt"><thead><tr><th>Envoi</th><th>Colis</th><th>Transport</th><th>Statut</th><th></th></tr></thead><tbody>${ships.map((x) => `<tr>
      <td data-label="Envoi"><strong class="mono">${esc(x.id)}</strong><br><span class="muted">${esc(x.carrier || '')} · ${esc(x.mode)}${x.tracking ? ' · ' + esc(x.tracking) : ''}</span></td>
      <td data-label="Colis">${x.orders.map((o) => `${esc(o.id)} <span class="muted">(${esc(o.name || '')}, ${esc(o.city || '')})</span>`).join('<br>')}</td>
      <td data-label="Transport">${String(x.weightKg).replace('.', ',')} kg · ${eur(x.costEur)}${x.eta ? `<br><span class="muted">arrivée prévue ${esc(x.eta.split('-').reverse().join('/'))}</span>` : ''}</td>
      <td data-label="Statut"><span class="tag ${SHIP_ST[x.status][1]}">${SHIP_ST[x.status][0]}</span></td>
      <td>${x.status === 'preparing' && (CAN.agent() || CAN.admin()) ? `<button class="btn small" data-depart="${esc(x.id)}">Parti ✈</button>` : ''}${x.status === 'departed' && !agentSide && CAN.orders() ? `<button class="btn small green" data-arrive="${esc(x.id)}">Arrivé au Congo</button>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
  }
  function bindShipments() {
    app.querySelectorAll('[data-depart]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm("Confirmer que l'envoi est parti ? Les clients verront « Parti d’Europe » et la date d'arrivée prévue.")) return;
      try { await api('/france/shipments/' + enc(b.dataset.depart) + '/depart', { method: 'POST', body: {} }); toast('Envoi parti ✓'); route(); } catch (err) { toast('❌ ' + err.message); }
    }));
    app.querySelectorAll('[data-arrive]').forEach((b) => b.addEventListener('click', async () => {
      const customs = prompt("Envoi arrivé au Congo. Douane payée (FCFA, 0 si aucune) :", '0');
      if (customs === null) return;
      try { await api('/france/shipments/' + enc(b.dataset.arrive) + '/arrive', { method: 'POST', body: { customs: Number(customs) || 0, method: 'cash' } }); toast('Arrivé ✓ Les commandes sont « à livrer »'); await loadOrders().catch(() => {}); route(); } catch (err) { toast('❌ ' + err.message); }
    }));
  }
  async function viewShipments() {
    let ships = [];
    try { ships = await api('/france/shipments'); } catch { return; }
    app.innerHTML = pageHead({ crumb: 'Achat en Europe', title: 'Envois Europe → Congo', desc: "Les envois préparés par l'agent en Europe. Quand un envoi arrive, cliquez « Arrivé au Congo » : ses commandes passent « à livrer » (livreur + code de livraison)." }) + shipmentsTable(ships, false);
    bindShipments();
  }

  // ---------- Livraison sécurisée (fiche commande) ----------
  // Appel de confirmation, livreur, code de livraison du client, encaissement du reste (paiement à la réception).
  function deliveryPanel(o) {
    if (isPickup(o)) return '';
    const r = o.reliability || {};
    const rel = r.blocked ? `<span class="tag danger">${r.refused} colis refusé(s) : paiement à la réception bloqué</span>`
      : r.trusted ? `<span class="tag ok">Client fiable : ${r.delivered} livraison(s) réussie(s)</span>`
      : `<span class="tag">Nouveau client : ${r.delivered || 0} livraison(s), ${r.refused || 0} refus</span>`;
    const active = ['paid', 'confirmed', 'shipped'].includes(o.status);
    const reasons = Object.entries(state.failReasons || {});
    return `
      <div class="panel">
        <h2>${icon('truck-duotone')} Livraison</h2>
        ${o.paymentPlan === 'cod' ? `<div class="cod-box">
          <span class="tag warn">Paiement à la réception</span>
          <div class="lines"><div><span>Acompte ${o.depositPaidAt ? 'reçu' : o.deposit ? 'attendu' : '(client fiable : aucun)'}</span><span>${fcfa(o.deposit || 0)}</span></div>
          <div><span>Reste ${o.balancePaid ? `encaissé (${o.balancePaid.method === 'cash' ? 'espèces' : 'Mobile Money'})` : 'à encaisser à la livraison'}</span><span>${fcfa(o.balance ?? o.total)}</span></div></div></div>` : ''}
        <p style="margin:10px 0">${rel}</p>
        ${o.deliveryCode ? `<p class="muted">Code de livraison du client : <strong class="mono code-inline">${esc(o.deliveryCode)}</strong> — visible par vous seul ; le livreur doit l'obtenir du client.</p>` : ''}
        ${o.codeLocked ? `<div class="alert err">Livraison bloquée : 5 codes faux ont été saisis. Vérifiez avec le client avant de débloquer.${CAN.admin() ? ' <button class="btn small" id="unlockBtn">Débloquer</button>' : ''}</div>` : ''}
        ${o.deliveredWithoutCode ? '<div class="alert warn">Livraison validée SANS le code du client (forcée par l\'administrateur).</div>' : ''}
        ${active ? `
          <div class="row" style="margin:8px 0 14px">${o.callConfirmedAt
            ? `<span class="tag ok">✓ Confirmée par téléphone (${esc(o.callConfirmedBy || '')}, ${date(o.callConfirmedAt)})</span>`
            : `<button class="btn" id="callOk">${icon('phone-bold')} Client joint : commande confirmée</button><button class="ghost" id="callKo">Injoignable</button>${(o.callAttempts || []).length ? `<span class="muted">${o.callAttempts.length} appel(s) sans réponse</span>` : ''}`}</div>
          <label for="courierSel">Livreur</label>
          <div class="row"><select id="courierSel" style="max-width:280px"><option value="">Chargement…</option></select><button class="btn dark" id="assignBtn">${o.status === 'shipped' ? 'Changer de livreur' : 'Confier au livreur'}</button></div>
          ${o.courierName ? `<p class="muted">Actuellement : ${esc(o.courierName)}${o.assignedAt ? ' depuis le ' + date(o.assignedAt) : ''}</p>` : ''}
          <details class="deliver-box"><summary>Remettre le colis moi-même (au bureau, en agence…)</summary>
            <form id="deliverForm" class="deliver-form">
              <label for="dCode">Code donné par le client</label><input id="dCode" inputmode="numeric" maxlength="4" placeholder="4 chiffres" autocomplete="off">
              ${o.toCollect ? `<p><strong>À encaisser : ${fcfa(o.toCollect)}</strong></p><div class="row"><label class="check"><input type="radio" name="collect" value="cash" checked> Espèces</label><label class="check"><input type="radio" name="collect" value="momo"> Mobile Money</label></div>` : ''}
              ${CAN.admin() ? '<label class="check"><input type="checkbox" id="dForce"> Forcer sans code (client sans son code, vérifié autrement)</label>' : ''}
              <div id="dMsg"></div>
              <button class="btn green">Valider la remise</button>
            </form>
          </details>
          <details class="deliver-box"><summary>Livraison ratée</summary>
            <form id="failForm" class="deliver-form">
              <select id="fReason">${reasons.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
              <input id="fNote" type="text" placeholder="Précision (facultatif)" maxlength="300">
              <p class="muted">« Colis refusé » annule la commande (articles remis en stock${o.paymentPlan === 'cod' && o.depositPaidAt ? ', acompte conservé' : ''}).</p>
              <button class="btn red">Enregistrer l'échec</button>
            </form>
          </details>` : ''}
        ${(o.attempts || []).length ? `<h3 style="margin-top:14px">Tentatives ratées</h3><ul class="history">${o.attempts.map((a) => `<li>${date(a.at)} — ${esc(a.label)}${a.byName ? ' (' + esc(a.byName) + ')' : ''}${a.note ? ' : ' + esc(a.note) : ''}</li>`).join('')}</ul>` : ''}
      </div>`;
  }

  async function refreshOrder(id, msg) {
    await loadOrders().catch(() => {});
    if (msg) toast(msg);
    viewOrder(id);
  }

  function bindDeliveryPanel(o) {
    const post = async (path, body, msg) => {
      try { await api('/orders/' + enc(o.id) + path, { method: 'POST', body: body || {} }); await refreshOrder(o.id, msg); } catch (err) { toast('❌ ' + err.message); }
    };
    $('#callOk')?.addEventListener('click', () => post('/call', { result: 'ok' }, 'Commande confirmée par téléphone ✓'));
    $('#callKo')?.addEventListener('click', () => post('/call', { result: 'injoignable' }, 'Appel sans réponse noté'));
    $('#unlockBtn')?.addEventListener('click', () => post('/unlock', {}, 'Commande débloquée'));
    if ($('#courierSel')) {
      api('/couriers').then((list) => {
        $('#courierSel').innerHTML = list.length
          ? list.map((u) => `<option value="${esc(u.id)}" ${u.id === o.courierId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')
          : '<option value="">Aucun livreur : créez-en un dans Équipe</option>';
      }).catch(() => {});
      $('#assignBtn').addEventListener('click', () => {
        const id = $('#courierSel').value;
        if (!id) return toast('Choisissez un livreur (Équipe → Ajouter → Livreur)');
        if (!o.callConfirmedAt && !confirm("Le client n'a pas encore été joint par téléphone. Envoyer quand même le livreur ?")) return;
        post('/assign', { courierId: id }, 'Commande confiée au livreur 🚚');
      });
    }
    $('#deliverForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { code: $('#dCode').value, collect: app.querySelector('input[name=collect]:checked')?.value, force: $('#dForce')?.checked };
      try {
        const res = await api('/orders/' + enc(o.id) + '/deliver', { method: 'POST', body });
        if (res.pending) return waitBalance(res, '/orders/payments/', $('#dMsg'), () => refreshOrder(o.id, 'Payé en Mobile Money : commande livrée ✓'));
        await refreshOrder(o.id, 'Commande livrée ✓');
      } catch (err) { $('#dMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    $('#failForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const reason = $('#fReason').value;
      if (reason === 'refus' && !confirm('Colis refusé : la commande sera annulée. Continuer ?')) return;
      post('/fail', { reason, note: $('#fNote').value }, 'Échec de livraison enregistré');
    });
  }

  // Paiement Mobile Money demandé devant le client : on vérifie toutes les 4 s jusqu'à la réponse de l'opérateur
  function waitBalance(res, base, box, onDone) {
    box.innerHTML = `<div class="alert warn"><span class="spin"></span> Demande de ${fcfa(res.amount)} envoyée sur le téléphone du client. Il valide avec son code secret…</div>`;
    const started = Date.now();
    const poll = async () => {
      if (!box.isConnected) return;
      try {
        const st = await api(base + enc(res.paymentId));
        if (st.status === 'SUCCESSFUL') return onDone();
        if (st.status === 'FAILED') { box.innerHTML = `<div class="alert err">Paiement refusé ou annulé${st.reason ? ' : ' + esc(st.reason) : ''}. Réessayez ou encaissez en espèces.</div>`; return; }
      } catch {}
      if (Date.now() - started > 15 * 60 * 1000) { box.innerHTML = '<div class="alert err">Pas de réponse de l\'opérateur. Ne redemandez pas : vérifiez plus tard dans la commande.</div>'; return; }
      setTimeout(poll, 4000);
    };
    setTimeout(poll, 4000);
  }

  // ---------- Espace livreur : mes livraisons ----------
  // ---------- Suivi en direct : le livreur partage sa position pendant ses livraisons (façon Grab) ----------
  // Position envoyée toutes les 10 s au plus, seulement quand il a une livraison en cours ; écran gardé allumé
  // (sinon le téléphone met la page en pause). Reprend tout seul à la réouverture de Kamwa Pro.
  const share = { watch: null, last: 0, lastSent: null, lock: null, error: '' };
  const shareWanted = () => { try { return localStorage.getItem('kamwa-share-pos') === '1'; } catch { return false; } };
  async function keepAwake() { try { share.lock = await navigator.wakeLock?.request('screen'); } catch {} }
  function startSharing() {
    if (share.watch !== null || !navigator.geolocation) return;
    try { localStorage.setItem('kamwa-share-pos', '1'); } catch {}
    keepAwake();
    share.watch = navigator.geolocation.watchPosition(async (p) => {
      if (Date.now() - share.last < 10000) return;
      share.last = Date.now();
      try {
        await api('/courier/position', { method: 'POST', body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, heading: p.coords.heading } });
        share.lastSent = new Date(); share.error = '';
      } catch (err) { share.error = err.message; if (/arrêté/.test(err.message)) stopSharing(true); }
      renderShare();
    }, (e) => { share.error = e.code === 1 ? "Autorisez l'accès à votre position (réglages du navigateur)" : 'Position introuvable : vérifiez que la localisation est activée'; renderShare(); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    renderShare();
  }
  function stopSharing(auto) {
    if (share.watch !== null) navigator.geolocation.clearWatch(share.watch);
    share.watch = null; share.lock?.release?.().catch(() => {}); share.lock = null;
    if (!auto) { try { localStorage.setItem('kamwa-share-pos', '0'); } catch {} api('/courier/position', { method: 'DELETE' }).catch(() => {}); }
    renderShare();
  }
  function renderShare() {
    const el = $('#sharePanel'); if (!el) return;
    const on = share.watch !== null;
    el.className = `panel share-panel ${on ? 'on' : ''}`;
    el.innerHTML = `<div class="row between" style="align-items:center">
        <div><strong>${icon('map-pin-duotone')} Suivi en direct pour vos clients</strong><br>
        <span class="muted">${on ? (share.error ? esc(share.error) : share.lastSent ? `Position partagée à ${share.lastSent.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. Gardez Kamwa Pro ouvert pendant la tournée.` : 'Recherche de votre position…') : 'Vos clients vous voient arriver sur leur carte. Seulement pendant vos livraisons en cours.'}</span></div>
        <button class="btn ${on ? 'ghost' : 'green'}" id="shareBtn">${on ? 'Arrêter' : 'Partager ma position'}</button></div>`;
    $('#shareBtn').addEventListener('click', () => (share.watch !== null ? stopSharing() : startSharing()));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && share.watch !== null) keepAwake(); });

  async function viewDeliveries() {
    let d;
    try { d = await api('/courier/deliveries'); } catch { return; }
    if (d.current.length && shareWanted()) startSharing();
    if (!d.current.length && share.watch !== null) stopSharing(true);
    const reasons = Object.entries(d.failReasons || {});
    const card = (x) => {
      const intl = '242' + String(x.customer.phone || ''); // au Congo, le 0 reste après +242 (ex. +242 06 123 45 67)
      return `
      <article class="deliv" data-id="${esc(x.id)}">
        <div class="row between"><strong class="mono">${esc(x.id)}</strong>${x.paymentPlan === 'cod' ? `<span class="collect-tag">À encaisser : ${fcfa(x.toCollect)}</span>` : '<span class="tag ok">Déjà payée</span>'}</div>
        <h3>${esc(x.customer.name)}</h3>
        <p class="deliv-addr">${icon('map-pin-duotone')} ${esc(x.customer.city || '')} · ${esc(x.customer.address || '')}${x.customer.location ? `<br><a href="${kamwaMap.directions(x.customer.location)}" target="_blank" rel="noopener">${icon('arrow-square-out-bold')} Itinéraire jusqu'au point placé par le client</a>` : ''}</p>
        <p class="muted">${x.lines.map((l) => `${l.qty} × ${esc(l.name)}`).join('<br>')}</p>
        ${x.attempts ? `<p class="muted">${x.attempts} tentative(s) déjà ratée(s)</p>` : ''}
        <div class="row">
          <a class="btn dark" href="tel:${esc(x.customer.phone)}">${icon('phone-bold')} Appeler</a>
          <a class="btn green" href="https://wa.me/${esc(intl)}" target="_blank" rel="noopener">WhatsApp</a>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn" data-open="ok">${icon('check-bold')} Colis remis</button>
          <button class="ghost" data-open="ko">Problème</button>
        </div>
        <form class="deliver-form" data-form="ok" hidden>
          <label>Code de livraison donné par le client</label>
          <input class="code-input-pro" inputmode="numeric" maxlength="4" placeholder="• • • •" autocomplete="off" name="code">
          ${x.toCollect ? `<p><strong>Encaisser ${fcfa(x.toCollect)}</strong></p><div class="row"><label class="check"><input type="radio" name="collect" value="cash" checked> Espèces</label><label class="check"><input type="radio" name="collect" value="momo"> Mobile Money du client</label></div>
          <input type="tel" name="phone" placeholder="Autre numéro Mobile Money (facultatif)">` : ''}
          <div class="msg"></div>
          <button class="btn green">Valider</button>
        </form>
        <form class="deliver-form" data-form="ko" hidden>
          <select name="reason">${reasons.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
          <input type="text" name="note" placeholder="Précision (facultatif)" maxlength="300">
          <button class="btn red">Enregistrer</button>
        </form>
      </article>`;
    };
    app.innerHTML = pageHead({ title: 'Mes livraisons', desc: 'Appelez le client avant de partir. Remettez le colis, puis demandez-lui son code de livraison à 4 chiffres : sans ce code, la livraison ne peut pas être validée.' })
      + (d.cashHeld ? `<div class="alert warn">${icon('wallet-duotone')} Vous avez <strong>${fcfa(d.cashHeld)}</strong> en espèces à remettre à Kamwa.</div>` : '')
      + (d.current.length ? '<div id="sharePanel"></div>' : '')
      + (d.current.length ? `<div class="deliv-list">${d.current.map(card).join('')}</div>` : '<div class="panel empty">Aucune livraison en cours. Les commandes qu\'on vous confie apparaissent ici.</div>')
      + (d.done.length ? `<h2 style="margin-top:24px">Dernières livraisons</h2><ul class="mini-list">${d.done.map((x) => `<li><span>${esc(x.id)} · ${esc(x.customer.name)}<br><span class="muted">${date(x.deliveredAt)}</span></span><span>${x.collected ? `${fcfa(x.collected.amount)} ${x.collected.method === 'cash' ? 'espèces' : 'Mobile Money'}` : '<span class="tag ok">payée</span>'}</span></li>`).join('')}</ul>` : '');
    renderShare();
    app.querySelectorAll('.deliv').forEach((el) => {
      const id = el.dataset.id;
      el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
        el.querySelectorAll('[data-form]').forEach((f) => { f.hidden = f.dataset.form !== b.dataset.open; });
        el.querySelector(`[data-form="${b.dataset.open}"] input, [data-form="${b.dataset.open}"] select`)?.focus();
      }));
      const ok = el.querySelector('[data-form="ok"]');
      ok.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(ok);
        const msg = ok.querySelector('.msg');
        try {
          const res = await api('/courier/deliveries/' + enc(id) + '/deliver', { method: 'POST', body: { code: f.get('code'), collect: f.get('collect'), phone: f.get('phone') || undefined } });
          if (res.pending) return waitBalance(res, '/courier/payments/', msg, () => { toast('Payé en Mobile Money : livraison validée ✓'); viewDeliveries(); });
          toast('Livraison validée ✓'); viewDeliveries();
        } catch (err) { msg.innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
      });
      const ko = el.querySelector('[data-form="ko"]');
      ko.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(ko);
        if (f.get('reason') === 'refus' && !confirm('Le client refuse le colis : la commande sera annulée. Confirmer ?')) return;
        try { await api('/courier/deliveries/' + enc(id) + '/fail', { method: 'POST', body: { reason: f.get('reason'), note: f.get('note') } }); toast('Problème enregistré'); viewDeliveries(); } catch (err) { toast('❌ ' + err.message); }
      });
    });
  }

  // ---------- Réglages du paiement à la réception (admin) ----------
  async function viewSettings() {
    let c, fr, sl, co;
    try { [c, fr, sl, co] = await Promise.all([api('/settings/cod'), api('/france/settings'), api('/settings/sales'), api('/documents/company')]); } catch { return; }
    const cp = co.company;
    const coField = (k, label, ph = '', wide = false) => `<div${wide ? ' style="grid-column:1/-1"' : ''}><label for="co_${k}">${label}${co.missing.includes(k) ? ' <span class="tag warn">à compléter</span>' : ''}</label><input id="co_${k}" type="text" data-co="${k}" value="${esc(cp[k] || '')}" placeholder="${esc(ph)}"></div>`;
    const PAY = [['cash', 'Espèces en agence (retrait ou livraison)'], ['momo', 'Mobile Money (MTN, Airtel)'], ['card', 'Carte bancaire (prestataire à brancher)'], ['cod', 'Paiement à la réception']];
    app.innerHTML = pageHead({ crumb: 'Gestion', title: 'Réglages', desc: 'Règles de vente, société (factures et reçus), paiement à la réception et tarifs des achats en Europe.' }) + `
      <form class="panel" id="salesForm" style="max-width:640px">
        <h2>${icon('identification-card')} Règles de vente</h2>
        <label class="check"><input type="checkbox" id="slAccount" ${sl.accountRequired ? 'checked' : ''}> Compte avec pièce d'identité <b>vérifiée</b> obligatoire pour commander</label>
        <p class="muted" style="margin:14px 0 4px">Moyens de paiement proposés aux clients :</p>
        ${PAY.map(([k, l]) => `<label class="check"><input type="checkbox" data-pay="${k}" ${sl.methods[k] ? 'checked' : ''}> ${esc(l)}</label>`).join('')}
        <p class="muted">Les espèces ne sont proposées que s'il existe au moins une agence active (onglet Agences).</p>
        <div id="slMsg"></div>
        <button class="btn" style="margin-top:14px">Enregistrer</button>
      </form>
      <form class="panel" id="companyForm" style="max-width:640px">
        <h2>${icon('receipt')} Société — factures et reçus</h2>
        <p class="muted" style="margin-top:0">Ces informations apparaissent en haut de chaque facture, reçu et avoir. Un document déjà émis garde celles du jour de son émission.</p>
        <div class="grid2">
          ${coField('name', 'Nom commercial', 'Kamwa')}${coField('legalForm', 'Forme juridique', 'SARL, SAS, Entreprise individuelle…')}
          ${coField('capital', 'Capital (facultatif)', '1 000 000 FCFA')}${coField('rccm', 'RCCM', 'CG-PNR-01-2026-B12-00000')}
          ${coField('niu', 'NIU', 'M2026…')}${coField('phone', 'Téléphone', '06 000 00 00')}
          ${coField('address', 'Adresse', 'N°, avenue, quartier', true)}
          ${coField('city', 'Ville', 'Pointe-Noire')}${coField('country', 'Pays', 'République du Congo')}
          ${coField('email', 'E-mail', 'contact@kamwa.cg')}${coField('website', 'Site', 'kamwa.cg')}
        </div>
        <label class="check" style="margin-top:12px"><input type="checkbox" id="coVat" ${cp.vatEnabled ? 'checked' : ''}> Kamwa facture la TVA (détail HT / TVA / TTC sur les factures)</label>
        <div class="grid2" id="coVatBox" ${cp.vatEnabled ? '' : 'hidden'}>
          <div><label for="co_vatRate">Taux de TVA (%)</label><input id="co_vatRate" data-co="vatRate" type="number" step="0.01" min="0" max="50" value="${cp.vatRate}"></div>
          <div><label for="co_vatExtra">Centime additionnel (% de la TVA)</label><input id="co_vatExtra" data-co="vatExtra" type="number" step="0.01" min="0" max="50" value="${cp.vatExtra}"></div>
        </div>
        <label for="co_vatNote" style="margin-top:10px">Mention sous le total (sans TVA)</label><input id="co_vatNote" type="text" data-co="vatNote" value="${esc(cp.vatNote || '')}">
        <label for="co_footer" style="margin-top:10px">Message en bas des documents</label><input id="co_footer" type="text" data-co="footer" value="${esc(cp.footer || '')}">
        <p class="muted">Régime de TVA : à confirmer avec votre comptable (au Congo : 18 % + centime additionnel de 5 % de la TVA). Les prix de la boutique restent affichés TTC.</p>
        <div id="coMsg"></div>
        <button class="btn" style="margin-top:14px">Enregistrer</button>
      </form>
      <form class="panel" id="codForm" style="max-width:640px">
        <h2>${icon('hand-coins-duotone')} Paiement à la réception</h2>
        <label class="check"><input type="checkbox" id="sEnabled" ${c.enabled ? 'checked' : ''}> Proposer « Payer à la réception » aux clients</label>
        <div class="grid2">
          <div><label for="sDeposit">Acompte des nouveaux clients (FCFA)</label><input id="sDeposit" type="number" min="0" step="500" value="${c.deposit}"></div>
          <div><label for="sPct">ou % du montant (si plus élevé)</label><input id="sPct" type="number" min="0" max="100" value="${c.depositPercent}"></div>
          <div><label for="sTrusted">Client fiable après … livraisons</label><input id="sTrusted" type="number" min="0" value="${c.trustedAfter}"></div>
          <div><label for="sRefusals">Bloqué après … colis refusés</label><input id="sRefusals" type="number" min="1" value="${c.maxRefusals}"></div>
        </div>
        <ul class="help-list" style="margin-top:14px">
          <li>Le <b>nouveau client</b> paie l'acompte en Mobile Money pour confirmer ; le reste se paie à la livraison (espèces ou Mobile Money).</li>
          <li>Un <b>client fiable</b> (livraisons réussies, aucun refus) n'a plus d'acompte à payer.</li>
          <li>Un numéro qui a <b>refusé trop de colis</b> ne peut plus payer à la réception : il doit payer en ligne.</li>
          <li>Si le client refuse le colis, <b>l'acompte est conservé</b> : il couvre le déplacement du livreur.</li>
        </ul>
        <div id="sMsg"></div>
        <button class="btn" style="margin-top:14px">Enregistrer</button>
      </form>
      <form class="panel" id="frSet" style="max-width:640px">
        <h2>${icon('airplane-tilt')} Achat en Europe — tarifs du devis</h2>
        <label class="check"><input type="checkbox" id="fEnabled" ${fr.enabled ? 'checked' : ''}> Proposer « Achat en Europe » aux clients</label>
        <div class="grid2">
          <div><label for="fFreight">Transport Europe → Congo (FCFA par kg)</label><input id="fFreight" type="number" min="0" value="${fr.freightPerKg}"></div>
          <div><label for="fMinW">Poids minimum facturé (kg)</label><input id="fMinW" type="number" min="0" step="0.1" value="${fr.minWeightKg}"></div>
          <div><label for="fCustoms">Douane et taxes estimées (%)</label><input id="fCustoms" type="number" min="0" value="${fr.customsPercent}"></div>
          <div><label for="fComm">Commission Kamwa (%)</label><input id="fComm" type="number" min="0" value="${fr.commissionPercent}"></div>
          <div><label for="fFixed">Frais fixes par commande (FCFA)</label><input id="fFixed" type="number" min="0" value="${fr.fixedFee}"></div>
          <div><label for="fRound">Arrondi du prix (FCFA)</label><input id="fRound" type="number" min="1" value="${fr.roundTo}"></div>
          <div><label for="fValid">Validité d'un devis (heures)</label><input id="fValid" type="number" min="1" value="${fr.validityHours}"></div>
          <div><label for="fDelay">Délai annoncé au client</label><input id="fDelay" type="text" value="${esc(fr.delay)}"></div>
        </div>
        <p class="muted">Taux euro fixe : 1 € = ${fr.rate} FCFA. Prix = (articles + port en Europe) × taux + transport au kilo + douane + commission + frais fixes, arrondi.</p>
        <div id="fMsg"></div>
        <button class="btn" style="margin-top:10px">Enregistrer</button>
      </form>`;
    $('#frSet').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { enabled: $('#fEnabled').checked, freightPerKg: Number($('#fFreight').value), minWeightKg: Number($('#fMinW').value), customsPercent: Number($('#fCustoms').value), commissionPercent: Number($('#fComm').value), fixedFee: Number($('#fFixed').value), roundTo: Number($('#fRound').value), validityHours: Number($('#fValid').value), delay: $('#fDelay').value };
      try { await api('/france/settings', { method: 'PUT', body }); toast('Tarifs Europe enregistrés ✓'); } catch (err) { $('#fMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    $('#coVat').addEventListener('change', () => { $('#coVatBox').hidden = !$('#coVat').checked; });
    $('#companyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { vatEnabled: $('#coVat').checked };
      app.querySelectorAll('[data-co]').forEach((i) => { body[i.dataset.co] = i.value; });
      try { await api('/documents/company', { method: 'PUT', body }); toast('Société enregistrée ✓'); $('#coMsg').innerHTML = ''; route({ keep: true }); }
      catch (err) { $('#coMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    $('#salesForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const methods = {}; app.querySelectorAll('[data-pay]').forEach((x) => { methods[x.dataset.pay] = x.checked; });
      try { await api('/settings/sales', { method: 'PUT', body: { accountRequired: $('#slAccount').checked, methods } }); toast('Règles de vente enregistrées ✓'); $('#slMsg').innerHTML = ''; }
      catch (err) { $('#slMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    $('#codForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/settings/cod', { method: 'PUT', body: { enabled: $('#sEnabled').checked, deposit: Number($('#sDeposit').value), depositPercent: Number($('#sPct').value), trustedAfter: Number($('#sTrusted').value), maxRefusals: Number($('#sRefusals').value) } });
        toast('Réglages enregistrés ✓');
      } catch (err) { $('#sMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
  }

  // « Code oublié » : génère un nouveau code et l'affiche une seule fois, à transmettre au client.
  async function newCode(account, box) {
    if (!confirm(`Créer un nouveau code pour ${account.name} ?\n\nL'ancien code ne marchera plus.`)) return;
    try {
      const { code } = await api('/customers/' + enc(account.id) + '/new-code', { method: 'POST' });
      const who = account.phone || account.email;
      const msg = `Bonjour ${account.name}, voici votre nouveau code Kamwa : ${code}. Connectez-vous avec ${who} et ce code.`;
      box.innerHTML = `
        <div class="alert ok">Nouveau code : <strong style="font-size:1.3rem;letter-spacing:.15em">${code.slice(0, 3)} ${code.slice(3)}</strong><br>
        Transmettez-le au client. Il ne sera plus affiché.</div>
        ${account.phone ? `<a class="btn green" target="_blank" rel="noopener" href="https://wa.me/242${esc(account.phone)}?text=${enc(msg)}">Envoyer par WhatsApp</a>` : ''}`;
    } catch (err) {
      toast('❌ ' + err.message);
    }
  }

  // ---------- Agences ----------
  // Points relais : agences Kamwa et commerces partenaires, placés sur la carte. Le client y paie en espèces et y retire
  // son colis (ou se fait livrer après paiement). Toute modification est visible tout de suite sur la boutique.
  const KIND = { agency: 'Agence Kamwa', partner: 'Point relais partenaire' };
  async function viewAgencies(editId) {
    let list = [];
    try { list = await api('/agencies'); } catch { return; }
    const editing = editId === 'nouvelle' ? { active: true, kind: 'partner' } : list.find((a) => a.id === editId);
    if (editing) {
      app.innerHTML = pageHead({ crumb: 'Points relais', title: editing.id ? 'Modifier le point relais' : 'Nouveau point relais' }) + `
      <form class="panel" id="agencyForm" novalidate style="max-width:820px">
        <div class="grid2">
          <div><label for="aKind">Type</label><select id="aKind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${(editing.kind || 'agency') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label for="aName">Nom *</label><input id="aName" type="text" value="${esc(editing.name)}" placeholder="Ex. Relais Tié-Tié — Boutique Mavoungou"></div>
          <div><label for="aCity">Ville *</label><input id="aCity" type="text" value="${esc(editing.city)}" placeholder="Pointe-Noire"></div>
          <div><label for="aPhone">Téléphone</label><input id="aPhone" type="tel" value="${esc(editing.phone)}"></div>
        </div>
        <label for="aAddress">Adresse / repère</label><input id="aAddress" type="text" value="${esc(editing.address)}" placeholder="Avenue…, face à…">
        <label for="aHours">Horaires</label><input id="aHours" type="text" value="${esc(editing.hours)}" placeholder="Lun-Sam 9h-18h">
        <label>Position sur la carte</label>
        <p class="muted" style="margin:0 0 6px">Touchez la carte à l'endroit exact du point relais (ou déplacez le repère). Sur place ? « Utiliser ma position ».</p>
        <div class="kmap" id="aMap" style="height:340px"></div>
        <div class="row" style="margin-top:8px;align-items:center"><button type="button" class="ghost" id="aLocate">${icon('map-pin-bold')} Utiliser ma position</button><span class="muted" id="aPos"></span><button type="button" class="ghost" id="aClear">Retirer la position</button></div>
        <label class="check" style="margin-top:12px"><input id="aActive" type="checkbox" ${editing.active !== false ? 'checked' : ''}> Actif (proposé aux clients)</label>
        <div id="aError"></div>
        <div class="row" style="margin-top:14px"><button class="btn">Enregistrer</button><a class="ghost" href="#/agences">Annuler</a></div>
      </form>`;
      let pos = kamwaMap.hasPos(editing) ? { lat: editing.lat, lng: editing.lng } : null;
      const showPos = () => { $('#aPos').textContent = pos ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : 'Pas encore placé'; };
      showPos();
      kamwaMap.create($('#aMap'), { center: pos && [pos.lat, pos.lng], zoom: pos ? 16 : 13, city: editing.city }).then(({ L, map }) => {
        let marker = null;
        const place = (p, pan) => {
          pos = { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
          if (!marker) { marker = L.marker([pos.lat, pos.lng], { draggable: true, icon: kamwaMap.pin(L, 'relay on') }).addTo(map); marker.on('dragend', () => place(marker.getLatLng())); }
          else marker.setLatLng([pos.lat, pos.lng]);
          if (pan) map.setView([pos.lat, pos.lng], 17);
          showPos();
        };
        if (pos) place(pos);
        map.on('click', (e) => place(e.latlng));
        $('#aLocate').addEventListener('click', async () => { try { place(await kamwaMap.locate(), true); } catch (err) { toast(err.message); } });
        $('#aClear').addEventListener('click', () => { pos = null; if (marker) { marker.remove(); marker = null; } showPos(); });
      }).catch((err) => { $('#aMap').innerHTML = `<p class="muted" style="padding:20px">${esc(err.message)}</p>`; });
      $('#agencyForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = { kind: $('#aKind').value, name: $('#aName').value, city: $('#aCity').value, address: $('#aAddress').value, hours: $('#aHours').value, phone: $('#aPhone').value, active: $('#aActive').checked, lat: pos ? pos.lat : null, lng: pos ? pos.lng : null };
        try {
          await api(editing.id ? '/agencies/' + enc(editing.id) : '/agencies', { method: editing.id ? 'PATCH' : 'POST', body });
          toast('Point relais enregistré ✓ (visible tout de suite sur la boutique)');
          location.hash = '#/agences';
        } catch (err) {
          $('#aError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
        }
      });
      return;
    }
    const placed = list.filter((a) => kamwaMap.hasPos(a));
    app.innerHTML = pageHead({ title: 'Points relais', desc: "Agences Kamwa et commerces partenaires. Le client choisit son point relais sur une carte au moment de commander : il y paie en espèces, puis retire son colis sur place ou se fait livrer. Placez chaque point sur la carte pour qu'il apparaisse au bon endroit.", actions: `<a class="btn" href="#/agences/nouvelle">${icon('plus-bold')} Ajouter un point relais</a>` })
      + `<div class="panel" style="padding:10px"><div class="kmap" id="allMap" style="height:360px"></div>${placed.length < list.length ? `<p class="muted" style="margin:8px 4px 0">${list.length - placed.length} point(s) pas encore placé(s) sur la carte : les clients les voient seulement dans la liste.</p>` : ''}</div>`
      + '<div id="tbl"></div>';
    dataTable($('#tbl'), {
      id: 'agencies', rows: list, rowHref: (a) => '#/agences/' + enc(a.id), placeholder: 'Nom, ville ou adresse',
      empty: 'Aucun point relais pour le moment. Ajoutez votre première agence ou un commerce partenaire.',
      searchText: (a) => `${a.name} ${a.city} ${a.address}`,
      columns: [
        { key: 'name', label: 'Point relais', render: (a) => `<strong>${esc(a.name)}</strong><br><span class="muted">${esc(KIND[a.kind || 'agency'])}</span>` },
        { key: 'city', label: 'Ville' },
        { key: 'address', label: 'Adresse', render: (a) => esc(a.address || 'à venir') },
        { key: 'map', label: 'Carte', sortValue: (a) => kamwaMap.hasPos(a), render: (a) => (kamwaMap.hasPos(a) ? '<span class="tag ok">Placé</span>' : '<span class="tag warn">À placer</span>') },
        { key: 'active', label: 'Statut', sortValue: (a) => a.active !== false, render: (a) => (a.active === false ? '<span class="tag">Inactif</span>' : '<span class="tag ok">Actif</span>') },
      ],
    });
    kamwaMap.create($('#allMap'), {}).then(({ L, map }) => {
      const ms = placed.map((a) => L.marker([a.lat, a.lng], { icon: kamwaMap.pin(L, a.active === false ? 'relay' : 'relay on') }).addTo(map)
        .bindPopup(`<b>${esc(a.name)}</b><br>${esc(a.address || '')}<br><a href="#/agences/${enc(a.id)}">Modifier</a>`));
      if (ms.length) map.fitBounds(L.featureGroup(ms).getBounds().pad(0.2), { maxZoom: 15 });
    }).catch(() => {});
  }

  // ---------- Factures, reçus, avoirs (créés automatiquement, jamais modifiés ni supprimés) ----------
  const DOC_TAG = { invoice: ['Facture', 'ok'], receipt: ['Reçu', 'info'], credit: ['Avoir', 'danger'] };
  const docPrint = (d, ticket) => `/api/admin/documents/${enc(d.id)}/print${ticket ? '?format=ticket' : ''}`;
  const docWa = (d) => {
    if (!d.customer?.phone) return '';
    const first = (d.customer.name || '').split(' ')[0];
    const what = d.type === 'receipt' ? `votre reçu de paiement n° ${d.number} (${fcfa(d.amount)})` : d.type === 'credit' ? `votre avoir n° ${d.number}` : `votre facture n° ${d.number} (${fcfa(d.amount)})`;
    const msg = `Bonjour ${first}, merci pour votre achat sur Kamwa ! Voici ${what} pour la commande ${d.orderId} : ${location.origin}${d.link}`;
    return `https://wa.me/242${String(d.customer.phone).replace(/\D/g, '')}?text=${enc(msg)}`;
  };
  const docActions = (d) => `<div class="cell-actions">
      <a class="ghost" href="${docPrint(d)}" target="_blank" rel="noopener" title="Ouvrir, imprimer ou enregistrer en PDF">${icon('download-simple-bold')} A4</a>
      <a class="ghost" href="${docPrint(d, true)}" target="_blank" rel="noopener" title="Ticket de caisse 80 mm">${icon('receipt')} Ticket</a>
      ${docWa(d) ? `<a class="ghost" href="${docWa(d)}" target="_blank" rel="noopener" title="Envoyer au client par WhatsApp">${icon('chat-circle')} WhatsApp</a>` : ''}</div>`;
  const docAmount = (d) => (d.type === 'credit' ? '− ' : '') + fcfa(d.amount);

  function docsPanel(o) {
    const docs = o.documents || [];
    const due = ['paid', 'confirmed', 'shipped', 'delivered', 'cancelled'].includes(o.status);
    return `<div class="panel">
        <h2>${icon('receipt')} Factures et reçus</h2>
        ${docs.length ? `<ul class="doc-list">${docs.map((d) => `<li>
            <span><span class="tag ${DOC_TAG[d.type][1]}">${DOC_TAG[d.type][0]}</span> <strong class="mono">${esc(d.number)}</strong><br>
              <span class="muted">${date(d.issuedAt)} · ${docAmount(d)}${d.methodLabel && d.type === 'receipt' ? ` · ${esc(d.methodLabel)}` : ''}${d.collectedBy ? ` · encaissé par ${esc(d.collectedBy)}` : ''}</span></span>
            ${docActions(d)}</li>`).join('')}</ul>` : `<p class="muted" style="margin:0">${due ? 'Aucun document pour cette commande (commande antérieure aux factures automatiques).' : 'Le reçu et la facture seront créés automatiquement dès le paiement.'}</p>`}
        ${due && !docs.length ? `<button class="ghost" data-doc-sync="${esc(o.id)}" style="margin-top:10px">${icon('check-bold')} Établir les documents manquants</button>` : ''}
      </div>`;
  }
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-doc-sync]');
    if (!b) return;
    b.disabled = true;
    try { await api(`/documents/order/${enc(b.dataset.docSync)}`, { method: 'POST', body: {} }); await loadOrders(); route({ keep: true }); }
    catch (err) { alert(err.message); b.disabled = false; }
  });

  async function viewDocuments() {
    let r;
    try { r = await api('/documents'); } catch { return; }
    const list = r.documents;
    const f = state.docFilter || 'all';
    const TABS = [['all', 'Tous'], ['invoice', 'Factures'], ['receipt', 'Reçus'], ['credit', 'Avoirs']];
    const month = new Date().toISOString().slice(0, 7);
    const inMonth = list.filter((d) => d.issuedAt.slice(0, 7) === month);
    const tot = (t, fn = () => true) => inMonth.filter((d) => d.type === t && fn(d)).reduce((s, d) => s + d.amount, 0);
    const monthName = new Date().toLocaleDateString('fr-FR', { month: 'long' });
    app.innerHTML = pageHead({
      title: 'Factures & reçus',
      desc: "Créés automatiquement : un <strong>reçu</strong> à chaque somme reçue (espèces en agence, Mobile Money, acompte, reste à la livraison), une <strong>facture</strong> à chaque vente, un <strong>avoir</strong> si une vente facturée est annulée. Numéros qui se suivent, jamais modifiés ni supprimés. Imprimez (A4 ou ticket 80 mm), enregistrez en PDF ou envoyez au client par WhatsApp.",
      actions: `<a class="btn" href="/api/admin/documents/export.csv">${icon('download-simple-bold')} Exporter</a>`,
    })
      + (r.companyMissing.length && CAN.admin() ? `<div class="alert warn">Les documents affichent « À compléter » à la place de : ${r.companyMissing.map((k) => ({ legalForm: 'forme juridique', rccm: 'RCCM', niu: 'NIU', address: 'adresse', phone: 'téléphone' }[k])).join(', ')}. <a href="#/reglages">Compléter dans Réglages → Société</a> (chaque document garde les informations du jour de son émission).</div>` : '')
      + `<div class="kpis">
          <div class="kpi kc0"><span class="kpi-ico">${icon('receipt-duotone')}</span><span class="kpi-label">Facturé en ${esc(monthName)}</span><span class="kpi-value">${fcfa(tot('invoice'))}</span><span class="kpi-hint">${inMonth.filter((d) => d.type === 'invoice').length} facture(s)</span></div>
          <div class="kpi kc1"><span class="kpi-ico">${icon('money-duotone')}</span><span class="kpi-label">Encaissé en ${esc(monthName)}</span><span class="kpi-value">${fcfa(tot('receipt'))}</span><span class="kpi-hint">dont espèces ${fcfa(tot('receipt', (d) => d.method === 'cash'))}</span></div>
          <div class="kpi kc2"><span class="kpi-ico">${icon('arrow-counter-clockwise')}</span><span class="kpi-label">Avoirs en ${esc(monthName)}</span><span class="kpi-value">${fcfa(tot('credit'))}</span><span class="kpi-hint">${inMonth.filter((d) => d.type === 'credit').length} avoir(s)</span></div>
        </div>`
      + tabsBar(TABS.map(([k, l]) => [k, l, k === 'all' ? list.length : list.filter((d) => d.type === k).length]), f, 'df')
      + '<div id="tbl"></div>';
    app.querySelectorAll('[data-df]').forEach((b) => b.addEventListener('click', () => { state.docFilter = b.dataset.df; viewDocuments(); }));
    dataTable($('#tbl'), {
      id: 'documents', rows: list.filter((d) => f === 'all' || d.type === f), defaultSort: 'issuedAt', placeholder: 'Numéro, client, téléphone ou commande', empty: 'Aucun document pour le moment : ils apparaissent au premier paiement.',
      searchText: (d) => `${d.number} ${d.customer.name} ${d.customer.phone} ${d.orderId}`,
      columns: [
        { key: 'number', label: 'Numéro', render: (d) => `<span class="tag ${DOC_TAG[d.type][1]}">${DOC_TAG[d.type][0]}</span><br><strong class="mono">${esc(d.number)}</strong>` },
        { key: 'issuedAt', label: 'Date', render: (d) => date(d.issuedAt) },
        { key: 'client', label: 'Client', sortValue: (d) => norm(d.customer.name), render: (d) => `${esc(d.customer.name)}<br><span class="muted">${esc(d.customer.phone)}</span>` },
        { key: 'orderId', label: 'Commande', render: (d) => `<a href="#/commande/${enc(d.orderId)}">${esc(d.orderId)}</a>${d.invoiceNumber && d.type !== 'invoice' ? `<br><span class="muted">${d.type === 'credit' ? 'annule' : 'facture'} ${esc(d.invoiceNumber)}</span>` : ''}` },
        { key: 'amount', label: 'Montant', cls: 'num', sortValue: (d) => (d.type === 'credit' ? -d.amount : d.amount), render: (d) => `<strong>${docAmount(d)}</strong>` },
        { key: 'method', label: 'Paiement', render: (d) => `${esc(d.methodLabel || '—')}${d.agency ? `<br><span class="muted">${esc(d.agency)}</span>` : ''}${d.collectedBy ? `<br><span class="muted">par ${esc(d.collectedBy)}</span>` : ''}` },
        { key: 'act', label: '', sortable: false, render: docActions },
      ],
    });
  }

  // ---------- Clients ----------
  // Pièce d'identité des clients : à vérifier avant leur première commande (admin seulement)
  const ID_TYPES = { passeport: 'Passeport', cni: "Carte nationale d'identité (CNI)", niu: 'NIU' };
  const ID_ST = { missing: ['Pièce à fournir', 'danger'], pending: ['À vérifier', 'warn'], verified: ['Vérifiée', 'ok'], rejected: ['Refusée', 'danger'] };
  async function viewCustomers() {
    let list = [];
    try { list = await api('/customers'); } catch { return; }
    const f = state.custFilter || (list.some((c) => c.idStatus === 'pending') ? 'pending' : 'all');
    const TABS = [['pending', 'À vérifier'], ['verified', 'Vérifiés'], ['other', 'Refusés / sans pièce'], ['all', 'Tous']];
    const match = (c, k) => k === 'all' || c.idStatus === k || (k === 'other' && ['missing', 'rejected'].includes(c.idStatus));
    app.innerHTML = pageHead({ title: 'Clients', desc: "Un compte client ne peut commander qu'après vérification de sa pièce d'identité. Comparez la photo avec le nom du compte, puis validez ou refusez (le motif est montré au client). Code oublié : « Nouveau code », puis envoyez-le par WhatsApp.", actions: exportBtn('customers') })
      + tabsBar(TABS.map(([k, l]) => [k, l, list.filter((c) => match(c, k)).length]), f, 'cf')
      + '<div id="idBox"></div><div id="codeBox"></div><div id="tbl"></div>';
    app.querySelectorAll('[data-cf]').forEach((b) => b.addEventListener('click', () => { state.custFilter = b.dataset.cf; viewCustomers(); }));
    dataTable($('#tbl'), {
      id: 'customers', rows: list.filter((c) => match(c, f)), defaultSort: 'createdAt', placeholder: 'Nom, téléphone ou e-mail', empty: 'Aucun compte client ici.',
      searchText: (c) => `${c.name} ${c.phone} ${c.email}`,
      columns: [
        { key: 'name', label: 'Client', sortValue: (c) => norm(c.name), render: (c) => `<strong>${esc(c.name)}</strong>${vb(c.idStatus)}` },
        { key: 'phone', label: 'Téléphone', render: (c) => esc(c.phone || '—') },
        { key: 'email', label: 'E-mail', render: (c) => esc(c.email || '—') },
        { key: 'idStatus', label: 'Identité', render: (c) => `<span class="tag ${ID_ST[c.idStatus]?.[1] || ''}">${esc(ID_ST[c.idStatus]?.[0] || c.idStatus)}</span>${c.idType ? `<br><span class="muted">${esc(ID_TYPES[c.idType] || '')}${c.idIsPdf ? ' · PDF' : ''}</span>` : ''}${c.idStatus === 'pending' && c.idAuto ? `<br><span class="tag ${c.idAuto.read && !(c.idAuto.flags || []).length ? 'ok' : 'warn'}">${c.idAuto.read && !(c.idAuto.flags || []).length ? 'Lecture : tout concorde' : 'Lecture : à regarder'}</span>` : ''}` },
        { key: 'orders', label: 'Commandes', cls: 'num' },
        { key: 'createdAt', label: 'Inscrit le', render: (c) => date(c.createdAt).split(' ')[0] },
        { key: 'act', label: '', sortable: false, render: (c) => `<div class="cell-actions">${c.hasIdPhoto ? `<button class="${c.idStatus === 'pending' ? 'btn small' : 'ghost'}" data-idc="${esc(c.id)}">${icon('identification-card')} ${c.idStatus === 'pending' ? 'Vérifier' : 'Voir la pièce'}</button>` : ''}<button class="ghost" data-code="${esc(c.id)}">${icon('key-bold')} Nouveau code</button></div>` },
      ],
    });
    $('#tbl').addEventListener('click', (e) => {
      const idb = e.target.closest('[data-idc]');
      if (idb) return idReview(list.find((x) => x.id === idb.dataset.idc));
      const b = e.target.closest('[data-code]');
      if (b) newCode(list.find((x) => x.id === b.dataset.code), $('#codeBox'));
    });
    const firstPending = list.find((c) => c.idStatus === 'pending');
    if (f === 'pending' && firstPending) idReview(firstPending);
  }
  // Résultat de la lecture automatique (zone MRZ des passeports / CNI, sinon texte imprimé : NIU, CNI sans MRZ)
  function autoCheckHtml(c) {
    const a = c.idAuto;
    if (!a) return `<div class="auto-check pending">${icon('magic-wand-duotone')} <span><strong>Lecture automatique</strong> en cours ou pas encore faite.</span> <button class="ghost" id="idAutoRun">Lancer la lecture</button></div>`;
    const good = a.read && !(a.flags || []).length;
    const F = a.fields || {};
    const rows = [['Nom', F.surname], ['Prénoms', F.givenNames], ['N° du document', F.documentNumber], ['Né(e) le', F.birthDate && date(F.birthDate).split(' ')[0]],
      ['Expire le', F.expiryDate && date(F.expiryDate).split(' ')[0]], ['Nationalité', F.nationality], ['Pays émetteur', F.issuer]].filter(([, v]) => v);
    const checks = a.checks ? Object.values(a.checks).filter(Boolean).length : null;
    const yes = (v, t, f) => (v === true || v === 'yes' ? `<span class="ok">${icon('check-bold')} ${t}</span>` : v === false || v === 'no' ? `<span class="bad">${icon('x-bold')} ${f}</span>` : v === 'partial' ? `<span class="mid">~ ${t} (en partie)</span>` : '');
    return `<div class="auto-check ${good ? 'good' : a.read ? 'warn' : 'none'}">
      <div class="ac-head">${icon(good ? 'seal-check-duotone' : 'warning-duotone')} <strong>Lecture automatique</strong> <span class="muted">· ${a.method === 'mrz' ? 'zone MRZ (lignes <<<)' : a.method === 'text' ? 'texte de la pièce' : '—'}</span></div>
      <p>${esc(a.summary || '')}</p>
      ${a.read ? `<div class="ac-chips">${checks !== null ? `<span class="${checks === 4 ? 'ok' : 'bad'}">${icon(checks === 4 ? 'check-bold' : 'x-bold')} Contrôles ${checks}/4</span>` : ''}
        ${yes(a.nameMatch, 'Nom du compte retrouvé', 'Nom différent')}${yes(a.typeOk, 'Type de pièce cohérent', 'Type de pièce différent')}
        ${a.numberFound !== undefined && a.numberFound !== null ? yes(a.numberFound, 'Numéro retrouvé', 'Numéro introuvable') : ''}
        ${a.expired === true ? `<span class="bad">${icon('x-bold')} Expirée</span>` : a.expired === false ? `<span class="ok">${icon('check-bold')} En cours de validité</span>` : ''}
        ${a.congo === true ? `<span class="ok">${icon('check-bold')} « Congo »</span>` : ''}</div>` : ''}
      ${rows.length ? `<table class="ac-table">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join('')}</table>` : ''}
      <button class="ghost" id="idAutoRun">Relancer la lecture</button>
    </div>`;
  }
  // Fiche de vérification : photo (servie seulement à l'admin connecté) + validation / refus
  function idReview(c) {
    const box = $('#idBox');
    const src = `/api/admin/customers/${enc(c.id)}/identity-photo?v=${enc(c.idSubmittedAt || '')}`;
    box.innerHTML = `
      <div class="panel id-review">
        <div class="id-photo">${c.idIsPdf
          ? `<iframe src="${src}" title="Pièce d'identité scannée de ${esc(c.name)}"></iframe><a class="btn ghost" href="${src}" target="_blank" rel="noopener" style="margin-top:8px">${icon('file-pdf')} Ouvrir le PDF en grand</a>`
          : `<a href="${src}" target="_blank" rel="noopener" title="Agrandir"><img src="${src}" alt="Pièce d'identité de ${esc(c.name)}"></a>`}</div>
        <div>
          <h2 style="margin-top:0">${icon('identification-card')} ${esc(c.name)}${vb(c.idStatus)}</h2>
          <p class="muted">${esc([c.phone, c.email].filter(Boolean).join(' · '))}<br>Inscrit le ${date(c.createdAt)}</p>
          <p><strong>${esc(ID_TYPES[c.idType] || 'Pièce')}</strong>${c.idNumber ? ` n° <span class="mono">${esc(c.idNumber)}</span>` : ''}<br>
            <span class="muted">Envoyée le ${date(c.idSubmittedAt)}</span></p>
          <p><span class="tag ${ID_ST[c.idStatus]?.[1] || ''}">${esc(ID_ST[c.idStatus]?.[0] || '')}</span>${c.idCheckedBy ? ` <span class="muted">par ${esc(c.idCheckedBy)} le ${date(c.idCheckedAt)}</span>` : ''}${c.idRejectReason ? `<br><span class="muted">Motif : ${esc(c.idRejectReason)}</span>` : ''}</p>
          <div id="idAuto">${autoCheckHtml(c)}</div>
          <div class="alert warn" style="margin:10px 0">Vérifiez : le <strong>nom</strong> correspond au compte, la pièce est <strong>lisible</strong>, entière et <strong>en cours de validité</strong>. La lecture automatique aide, mais c'est vous qui décidez.</div>
          <div class="row">
            <button class="btn green" id="idOk">${icon('check-bold')} Pièce vérifiée</button>
            <button class="btn ghost danger" id="idNo">${icon('x-bold')} Refuser</button>
            <button class="ghost" id="idClose">Fermer</button>
          </div>
          <div id="idMsg"></div>
        </div>
      </div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const decide = async (decision, reason) => {
      try {
        await api('/customers/' + enc(c.id) + '/identity', { method: 'POST', body: { decision, reason } });
        toast(decision === 'verify' ? `${c.name} peut maintenant commander ✓` : 'Pièce refusée : le client est invité à en renvoyer une');
        viewCustomers();
      } catch (err) { $('#idMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    };
    const bindAuto = () => $('#idAutoRun')?.addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = 'Lecture en cours… (quelques secondes)';
      try { const r = await api('/customers/' + enc(c.id) + '/identity-check', { method: 'POST' }); Object.assign(c, r); $('#idAuto').innerHTML = autoCheckHtml(c); bindAuto(); }
      catch (err) { $('#idAuto').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    bindAuto();
    // Lecture encore en cours juste après l'envoi : on revient voir dans quelques secondes
    if (!c.idAuto && !c.idIsPdf) setTimeout(async () => {
      try { const l = await api('/customers'); const f = l.find((x) => x.id === c.id); if (f?.idAuto && $('#idAuto')) { Object.assign(c, f); $('#idAuto').innerHTML = autoCheckHtml(c); bindAuto(); } } catch {}
    }, 6000);
    $('#idOk').addEventListener('click', () => decide('verify'));
    $('#idNo').addEventListener('click', () => {
      const reason = prompt('Motif du refus (montré au client) :', 'Photo illisible ou incomplète');
      if (reason && reason.trim()) decide('reject', reason.trim());
    });
    $('#idClose').addEventListener('click', () => { box.innerHTML = ''; });
  }

  // ---------- Produits ----------
  const thumb = (p) => (p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="thumb">${ICONS[p.category] || '🛍️'}</span>`);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const role = () => state.user?.role;
  const isAdmin = () => role() === 'admin';
  const isSupplier = () => role() === 'supplier';

  function viewProducts() {
    const f = state.productFilter || 'all';
    const live = (p) => p.active !== false && !p.pending;
    const FILTERS_P = [
      ['all', 'Tous', () => true],
      ['pending', isAdmin() ? 'À valider' : 'En attente de validation', (p) => p.pending],
      ['out', 'En rupture', (p) => live(p) && p.stock === 0],
      ['hidden', 'Masqués', (p) => p.active === false],
    ];
    const test = FILTERS_P.find(([k]) => k === f)?.[2] || (() => true);
    const list = state.products.filter(test);
    const statusTag = (p) => (p.pending ? '<span class="tag warn">En attente</span>' : p.active === false ? '<span class="tag">Masqué</span>' : p.stock === 0 ? '<span class="tag danger">Rupture</span>' : '<span class="tag ok">En ligne</span>');
    const columns = [
      { key: 'name', label: 'Produit', sortValue: (p) => norm(p.name), render: (p) => `<div class="cell-prod">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="ph">${ICONS[p.category] || '🛍️'}</span>`}<span><strong>${esc(p.name)}</strong>${p.featured ? ' <span class="tag">⭐</span>' : ''}<br><span class="muted">${esc(p.brand || '')}</span></span></div>` },
      { key: 'category', label: 'Catégorie' },
    ];
    if (!isSupplier()) columns.push({ key: 'supplierName', label: 'Fournisseur', render: (p) => esc(p.supplierName || 'Kamwa') });
    if (!isSupplier()) columns.push({ key: 'price', label: 'Prix de vente', cls: 'num', render: (p) => (p.price ? fcfa(p.price) : '<span class="muted">à fixer</span>') });
    if (role() !== 'catalog') columns.push({ key: 'supplierPrice', label: isSupplier() ? 'Votre prix' : 'Prix fournisseur', cls: 'num', render: (p) => (p.supplierPrice != null ? fcfa(p.supplierPrice) : '—') });
    columns.push({ key: 'stock', label: 'Stock', cls: 'num', render: (p) => (p.stock === 0 ? `<strong style="color:var(--err)">0</strong>` : p.stock) });
    columns.push({ key: 'status', label: 'Statut', sortValue: (p) => (p.pending ? 0 : p.active === false ? 1 : 2), render: statusTag });
    app.innerHTML = pageHead({
      title: isSupplier() ? 'Mes produits' : 'Produits',
      desc: isSupplier() ? 'Vos produits sur Kamwa : stock et prix. Les nouveaux produits sont publiés après validation.' : 'Le catalogue de la boutique. Cliquez sur un produit pour le modifier.',
      actions: `${exportBtn('products')}<a class="btn green" href="#/produit/nouveau">${icon('plus-bold')} Ajouter un produit</a>`,
    }) + tabsBar(FILTERS_P.map(([k, label, fn]) => [k, label, state.products.filter(fn).length]), f, 'pf') + '<div id="tbl"></div>';
    dataTable($('#tbl'), {
      id: 'products', rows: list, rowHref: (p) => '#/produit/' + enc(p.id), placeholder: `Nom, marque, catégorie${isAdmin() ? ', fournisseur' : ''}`,
      empty: 'Aucun produit ici.', searchText: (p) => `${p.name} ${p.brand} ${p.category} ${p.supplierName || ''}`, columns,
    });
    app.querySelectorAll('[data-pf]').forEach((b) => b.addEventListener('click', () => { state.productFilter = b.dataset.pf; viewProducts(); }));
  }

  // Fiche produit : ajout depuis téléphone (appareil photo), tablette ou ordinateur.
  function viewProduct(id) {
    const isNew = id === 'nouveau';
    const p = isNew ? { stock: 1, active: true, condition: 'neuf', images: [] } : state.products.find((x) => x.id === id);
    if (!p) { app.innerHTML = '<p class="empty">Produit introuvable. <a href="#/produits">Retour</a></p>'; return; }
    let images = [...(p.images?.length ? p.images : [p.image].filter(Boolean))];
    // Fournisseur sur un produit déjà publié : seuls le stock et son prix sont modifiables
    const limited = isSupplier() && !isNew && !p.pending;
    const dis = limited ? 'disabled' : '';
    const showSale = !isSupplier();
    const showSupplierPrice = role() !== 'catalog';
    const unitCost = p.supplierId ? p.supplierPrice : p.costPrice;
    const margin = p.price && unitCost != null ? p.price - unitCost : null;
    app.innerHTML = `
      <p><a href="#/produits">‹ ${isSupplier() ? 'Mes produits' : 'Tous les produits'}</a></p>
      <h1>${isNew ? 'Nouveau produit' : esc(p.name)}</h1>
      ${p.pending ? `<div class="alert warn">⏳ En attente de validation : ce produit n'est pas encore visible des clients.${isAdmin() ? ' Vérifiez la fiche, fixez le prix de vente, enregistrez, puis cliquez « Valider et publier ».' : " L'administrateur doit le valider."}</div>` : ''}
      ${isNew && !isAdmin() ? '<div class="alert warn">Le produit sera visible des clients après validation par l\'administrateur.</div>' : ''}
      ${limited ? '<div class="alert warn">Produit publié : vous pouvez modifier le <strong>stock</strong> et <strong>votre prix</strong>. Pour le reste, contactez Kamwa.</div>' : ''}
      ${isSupplier() ? '' : `<div class="panel link-import">
        <h2>${icon('airplane-tilt')} Remplir depuis un lien</h2>
        <p class="muted">Collez le lien de la page du produit (site européen) : nom, photos, description, couleurs et tailles, prix en euros se remplissent tout seuls. Vérifiez, puis indiquez la <strong>quantité</strong>.</p>
        <div class="row"><input id="srcUrl" type="text" inputmode="url" placeholder="https://www.site.fr/produit…" value="${esc(p.sourceUrl || '')}" style="flex:1;min-width:220px"><button type="button" class="btn" id="scrapeBtn">Remplir</button></div>
        <div id="scrapeMsg"></div>
        <details class="deliver-box"><summary>Le site refuse la lecture ? Utilisez le bouton « → Kamwa »</summary>
          <p class="muted">Les grands sites (Decathlon, Boulanger, Amazon…) bloquent la lecture automatique. Solution : sur ordinateur, <strong>glissez ce bouton dans votre barre de favoris</strong> :</p>
          <p><a class="btn small bookmarklet" href="${esc(bookmarklet())}" onclick="event.preventDefault(); alert('Ne cliquez pas ici : glissez ce bouton dans votre barre de favoris, puis utilisez-le sur la page du produit.')">→ Kamwa</a></p>
          <p class="muted">Ensuite, ouvrez la page du produit sur le site, cliquez sur le favori « → Kamwa » : une fiche Kamwa pré-remplie s'ouvre. C'est comme un copier-coller, mais en un clic.</p>
        </details>
        <details class="deliver-box"><summary>Règles de bonne conduite (respect des sites)</summary>
          <p class="muted">Kamwa se présente honnêtement aux sites, respecte leurs consignes aux robots (robots.txt), lit une page à la fois et espace ses demandes. Il ne se connecte jamais à un compte et ne contourne aucun blocage ni vérification « êtes-vous un robot ».</p>
          <p class="muted">De votre côté : <strong>une fiche par produit que nous vendons vraiment</strong>, jamais de copie en masse d'un catalogue. Réécrivez la description avec vos mots si possible, et préférez nos propres photos : les photos du site vendeur lui appartiennent.</p>
        </details>
      </div>`}
      <form class="panel" id="pform" novalidate>
        <h2>Photos</h2>
        <div class="gallery" id="gallery"></div>
        ${limited ? '' : `
        <div class="row" style="margin-top:8px">
          <label class="btn dark" style="margin:0" for="camera">📷 Prendre une photo</label>
          <label class="ghost" style="margin:0" for="files">🖼️ Choisir des photos</label>
        </div>
        <input id="camera" type="file" accept="image/*" capture="environment" hidden>
        <input id="files" type="file" accept="image/*" multiple hidden>
        <label class="check detour-opt"><input id="detour" type="checkbox" ${detourOn() ? 'checked' : ''}> ${icon('magic-wand-duotone')} <span><b>Détourer automatiquement</b> : l'arrière-plan est retiré et le produit posé, centré, sur un fond blanc.</span></label>
        <p class="muted" id="photoHint">Jusqu'à 8 photos. La première est la photo principale. Elles sont allégées automatiquement.</p>`}

        <h2 style="margin-top:18px">Description</h2>
        <label for="name">Nom du produit *</label>
        <input id="name" type="text" value="${esc(p.name)}" placeholder="Ex. Samsung Galaxy A15 128 Go Noir" ${dis}>
        <div class="grid2">
          <div><label for="brand">Marque</label><input id="brand" type="text" value="${esc(p.brand)}" ${dis}></div>
          <div><label for="category">Catégorie *</label>
            <select id="category" ${dis}>
              ${isNew ? '<option value="">Choisir…</option>' : ''}
              ${state.universes.map((u) => `<optgroup label="${esc(u.name)}">${u.categories.map((c) => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</optgroup>`).join('')}
            </select>
          </div>
        </div>
        <label for="condition">État</label>
        <select id="condition" ${dis}>${['neuf', 'reconditionné', 'occasion'].map((c) => `<option ${c === (p.condition || 'neuf') ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <label for="description">Description</label>
        <textarea id="description" rows="4" placeholder="Points forts, contenu de la boîte, garantie…" ${dis}>${esc(p.description)}</textarea>
        <label for="options">Choix proposés au client (une ligne par choix)</label>
        <textarea id="options" rows="2" placeholder="Couleur : Noir, Bleu, Rouge&#10;Taille : 40, 41, 42, 43" ${dis}>${esc((p.options || []).map((o) => `${o.name} : ${o.values.join(', ')}`).join('\n'))}</textarea>
        <p class="muted" style="margin-top:4px">Le client devra choisir avant d'ajouter au panier.</p>
        ${isSupplier() ? '' : `
        <label class="check" style="margin-top:14px"><input id="originFr" type="checkbox" ${p.origin === 'FR' ? 'checked' : ''}> ${icon('airplane-tilt')} Produit venu d’Europe (expédié par avion, payé à la commande)</label>
        <div id="frFields" ${p.origin === 'FR' ? '' : 'hidden'}>
          <div class="grid2">
            <div><label for="priceEur">Prix en Europe (€)</label><input id="priceEur" type="text" inputmode="decimal" value="${esc(p.priceEur ?? '')}"></div>
            <div><label for="weightKg">Poids avec emballage (kg)</label><input id="weightKg" type="text" inputmode="decimal" value="${esc(p.weightKg ?? '')}"></div>
          </div>
          <div class="calc" id="frCalc"></div>
          <button type="button" class="ghost" id="frPriceBtn">Mettre ce prix tout compris comme prix de vente</button>
        </div>`}
        <label for="specs">Caractéristiques (une par ligne)</label>
        <textarea id="specs" rows="4" placeholder="Couleur : Noir&#10;Capacité : 128 Go&#10;Taille : M" ${dis}>${esc((p.specs || []).map((x) => `${x.label} : ${x.value}`).join('\n'))}</textarea>

        <h2 style="margin-top:18px">Prix et disponibilité</h2>
        <div class="grid2">
          ${showSale ? `<div><label for="price">Prix de vente (FCFA)${p.pending || isNew ? '' : ' *'}</label><input id="price" type="number" inputmode="numeric" min="1" step="1" value="${esc(p.price ?? '')}"></div>
          <div><label for="oldPrice">Prix barré (facultatif)</label><input id="oldPrice" type="number" inputmode="numeric" min="1" step="1" value="${esc(p.oldPrice ?? '')}"></div>` : ''}
          ${showSupplierPrice ? `<div><label for="supplierPrice">${isSupplier() ? 'Votre prix (FCFA) *' : 'Prix fournisseur (FCFA)'}</label><input id="supplierPrice" type="number" inputmode="numeric" min="0" step="1" value="${esc(p.supplierPrice ?? '')}"></div>` : ''}
          ${isAdmin() ? `<div><label for="costPrice">Prix d'achat Kamwa (FCFA)</label><input id="costPrice" type="number" inputmode="numeric" min="0" step="1" value="${esc(p.costPrice ?? '')}" placeholder="pour le stock Kamwa"></div>` : ''}
          <div><label for="stock">Stock disponible *</label><input id="stock" type="number" inputmode="numeric" min="0" step="1" value="${esc(p.stock)}"></div>
        </div>
        ${isAdmin() ? '<p class="muted">Prix d\'achat : ce que Kamwa a payé ce produit (stock propre à Kamwa). Il sert au calcul de la marge dans Finances et reste invisible pour les clients et l\'équipe.</p>' : ''}
        ${isAdmin() && margin != null ? `<p class="muted">Marge actuelle : <strong>${fcfa(margin)}</strong> par article.</p>` : ''}
        ${isSupplier() ? '<p class="muted">Kamwa fixe le prix de vente aux clients. Mettez le stock à 0 si le produit n\'est plus disponible.</p>' : ''}
        ${isAdmin() ? `<label for="supplierId">Fournisseur</label>
          <select id="supplierId"><option value="">Aucun (stock Kamwa)</option>${[
            ...(state.suppliers || []),
            // le fournisseur actuel reste toujours proposé (même s'il n'est plus dans la liste), pour ne jamais l'effacer par erreur
            ...(p.supplierId && !(state.suppliers || []).some((s) => s.id === p.supplierId) ? [{ id: p.supplierId, name: p.supplierName || p.supplierId }] : []),
          ].map((s) => `<option value="${esc(s.id)}" ${s.id === p.supplierId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
        ${!isSupplier() ? `
        <label class="check"><input id="active" type="checkbox" ${p.active !== false ? 'checked' : ''}> Visible sur la boutique</label>
        <label class="check"><input id="featured" type="checkbox" ${p.featured ? 'checked' : ''}> Mettre en avant sur l'accueil</label>` : ''}
        <div id="formError"></div>
        <button class="btn" style="width:100%;margin-top:16px;min-height:48px">${isNew ? (isAdmin() ? 'Ajouter le produit' : 'Envoyer pour validation') : 'Enregistrer'}</button>
        ${isAdmin() && p.pending ? '<button type="button" class="btn green" id="approveBtn" style="width:100%;margin-top:8px;min-height:48px">✓ Valider et publier</button>' : ''}
        ${!isNew && (isAdmin() || (p.pending && p.createdBy === state.user.id)) ? `<button type="button" class="btn red" id="deleteBtn" style="width:100%;margin-top:8px;min-height:48px">${icon('trash-bold')} ${p.pending && !isAdmin() ? 'Retirer ma proposition' : 'Supprimer ce produit'}</button>` : ''}
      </form>
      ${isNew || isSupplier() ? '' : `<p class="muted">Pour retirer un produit de la boutique sans le perdre, décochez « Visible » (vous pourrez le remettre plus tard).${isAdmin() ? ' « Supprimer » l\'efface définitivement ; les commandes passées restent intactes.' : ''} ${p.pending ? '' : `<a href="/#/p/${enc(p.id)}" target="_blank">Voir sur la boutique ›</a>`}</p>`}`;

    const renderGallery = () => {
      $('#gallery').innerHTML = images.length
        ? images.map((src, i) => `
          <div class="gal-item">
            <img src="${esc(src)}" alt="">
            ${i === 0 ? '<span class="gal-main">Principale</span>' : limited ? '' : `<button type="button" class="gal-btn" data-main="${i}" title="Mettre en principale">★</button>`}
            ${limited ? '' : `<button type="button" class="gal-btn gal-del" data-del="${i}" title="Retirer">✕</button>`}
            ${limited || !/^\/images\/uploads\/[\w.-]+$/.test(src) || /-d\.jpg$/.test(src) ? '' : `<button type="button" class="gal-detour" data-detour="${i}" title="Retirer l'arrière-plan">${icon('magic-wand-duotone')} Détourer</button>`}
          </div>`).join('')
        : `<div class="gal-empty">${ICONS[$('#category')?.value] || '🛍️'}<br><span class="muted">Pas encore de photo</span></div>`;
      $('#gallery').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { images.splice(Number(b.dataset.del), 1); renderGallery(); }));
      $('#gallery').querySelectorAll('[data-main]').forEach((b) => b.addEventListener('click', () => { const [x] = images.splice(Number(b.dataset.main), 1); images.unshift(x); renderGallery(); }));
      // Détourer une photo déjà ajoutée : la version détourée remplace la photo dans la fiche
      $('#gallery').querySelectorAll('[data-detour]').forEach((b) => b.addEventListener('click', async () => {
        const i = Number(b.dataset.detour);
        b.disabled = true; b.innerHTML = '<span class="spin"></span> Détourage…';
        $('#photoHint').textContent = detourWait();
        try {
          const { url, found } = await api('/uploads/detoure-existante', { method: 'POST', body: { src: images[i] } });
          images[i] = url; renderGallery();
          $('#photoHint').textContent = found ? 'Arrière-plan retiré ✓ Pensez à enregistrer.' : 'Aucun produit net détecté : vérifiez le résultat (vous pouvez retirer la photo).';
        } catch (err) { $('#photoHint').textContent = '❌ ' + err.message; renderGallery(); }
      }));
    };
    renderGallery();
    $('#category').addEventListener('change', renderGallery);

    // Envoi des photos (appareil photo ou galerie) : réduites dans le navigateur puis envoyées une par une.
    // Avec « Détourer automatiquement », le serveur retire l'arrière-plan ; en cas d'échec, la photo est gardée telle quelle.
    $('#detour')?.addEventListener('change', (e) => { try { localStorage.setItem('kamwa-detour', e.target.checked ? '1' : '0'); } catch {} });
    const addFiles = async (files) => {
      const hint = $('#photoHint');
      for (const file of [...files].slice(0, 8 - images.length)) {
        const detour = $('#detour')?.checked;
        hint.textContent = detour ? detourWait() : 'Envoi de la photo…';
        try {
          const blob = await shrinkImage(file, detour ? 1600 : 1200);
          let res;
          if (detour) {
            try { res = await api('/uploads/detoure', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } }); } catch (err) {
              hint.textContent = '⚠️ ' + err.message;
              res = await api('/uploads', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
            }
          } else {
            res = await api('/uploads', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
          }
          images.push(res.url);
          renderGallery();
          hint.textContent = res.found === false ? 'Photo ajoutée, mais aucun produit net détecté : vérifiez le résultat.' : res.found ? 'Photo détourée et ajoutée ✓ Pensez à enregistrer.' : `Photo ajoutée (${Math.round(blob.size / 1024)} Ko). Pensez à enregistrer.`;
        } catch (err) {
          hint.textContent = '❌ ' + err.message;
        }
      }
    };
    $('#camera')?.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

    // --- Produit venu d’Europe : prix tout compris (même calcul que le serveur) ---
    let frConf = null;
    const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
    const frCalc = async () => {
      if (!$('#frCalc') || $('#frFields').hidden) return null;
      if (!frConf) { try { frConf = await api('/france/settings'); } catch { return null; } }
      const e = num($('#priceEur').value); const w = Math.max(num($('#weightKg').value), frConf.minWeightKg);
      if (!e) { $('#frCalc').innerHTML = '<p class="muted">Indiquez le prix en euros et le poids.</p>'; return null; }
      const goods = Math.round(e * frConf.rate); const freight = Math.round(w * frConf.freightPerKg); const customs = Math.round((goods * frConf.customsPercent) / 100);
      const cost = goods + freight + customs;
      const total = Math.ceil((cost + Math.round((cost * frConf.commissionPercent) / 100) + frConf.fixedFee) / frConf.roundTo) * frConf.roundTo;
      const priceNow = num($('#price')?.value);
      $('#frCalc').innerHTML = `<div class="lines"><div><span>Article (${String(e).replace('.', ',')} € × ${frConf.rate})</span><span>${fcfa(goods)}</span></div><div><span>Avion (${String(w).replace('.', ',')} kg × ${fcfa(frConf.freightPerKg)})</span><span>${fcfa(freight)}</span></div><div><span>Douane estimée (${frConf.customsPercent} %)</span><span>${fcfa(customs)}</span></div><div><span>Coût pour Kamwa</span><span>${fcfa(cost)}</span></div><div><span>Prix tout compris conseillé</span><span class="price">${fcfa(total)}</span></div>${priceNow ? `<div><span>Marge avec le prix de vente actuel</span><span class="${priceNow - cost < 0 ? 'neg' : 'pos'}">${fcfa(priceNow - cost)}</span></div>` : ''}</div>`;
      return total;
    };
    $('#originFr')?.addEventListener('change', () => { $('#frFields').hidden = !$('#originFr').checked; frCalc(); });
    ['#priceEur', '#weightKg', '#price'].forEach((sel) => $(sel)?.addEventListener('input', frCalc));
    $('#frPriceBtn')?.addEventListener('click', async () => { const t = await frCalc(); if (t && $('#price')) { $('#price').value = t; frCalc(); toast('Prix de vente mis à jour'); } });
    frCalc();

    // --- Remplissage automatique (lien lu par le serveur, ou données envoyées par le favori « → Kamwa ») ---
    const applyImport = (d) => {
      const set = (sel, v) => { if (v != null && v !== '' && $(sel)) $(sel).value = v; };
      set('#name', d.name); set('#brand', d.brand); set('#description', d.description);
      if (d.specs?.length) set('#specs', d.specs.map((x) => `${x.label} : ${x.value}`).join('\n'));
      if (d.options?.length) set('#options', d.options.map((o) => `${o.name} : ${o.values.join(', ')}`).join('\n'));
      if (d.category && [...$('#category').options].some((o) => o.value === d.category || o.text === d.category)) $('#category').value = d.category;
      if ($('#originFr')) { $('#originFr').checked = true; $('#frFields').hidden = false; }
      set('#priceEur', d.priceEur); set('#weightKg', d.weightKg); set('#srcUrl', d.source || d.url);
      for (const u of d.images || []) if (images.length < 8 && !images.includes(u)) images.push(u);
      renderGallery();
      if ($('#price') && !$('#price').value) frCalc().then((t) => { if (t) { $('#price').value = t; frCalc(); } });
      else frCalc();
    };
    const importNotice = (d) => `<div class="alert ok">Fiche remplie ✓ ${d.images?.length ? `${d.images.length} photo(s) récupérée(s)` : 'aucune photo récupérée'}${d.failedImages ? `, ${d.failedImages} impossible(s)` : ''}. Vérifiez les informations, choisissez la catégorie si besoin, puis indiquez la <strong>quantité</strong> (stock).${d.priceEur ? '' : ' Prix en euros introuvable : saisissez-le.'}</div>
      <div class="alert warn">Photos du site vendeur : assurez-vous d'avoir le droit de les utiliser, ou remplacez-les par les photos de votre agent.</div>`;
    $('#scrapeBtn')?.addEventListener('click', async () => {
      const url = $('#srcUrl').value.trim();
      if (!/^https?:\/\//.test(url)) { $('#scrapeMsg').innerHTML = '<div class="alert err">Collez un lien complet (commençant par https://)</div>'; return; }
      const b = $('#scrapeBtn'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Lecture…';
      $('#scrapeMsg').innerHTML = '<p class="muted">Lecture de la page et récupération des photos (quelques secondes)…</p>';
      try { const d = await api('/products/scrape', { method: 'POST', body: { url } }); applyImport(d); $('#scrapeMsg').innerHTML = importNotice(d); }
      catch (err) { $('#scrapeMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
      b.disabled = false; b.textContent = 'Remplir';
    });
    const qs = new URLSearchParams(location.hash.split('?').slice(1).join('?'));
    const fromBookmark = qs.get('kamwa2') || qs.get('kamwa');
    if (isNew && fromBookmark) {
      try {
        // kamwa2 = texte JSON (nouveau favori) ; kamwa = ancien favori (base64)
        const raw = qs.get('kamwa2') ? JSON.parse(fromBookmark) : JSON.parse(decodeURIComponent(escape(atob(fromBookmark.replace(/-/g, '+').replace(/_/g, '/')))));
        const d = { name: raw.n, brand: raw.b, description: raw.de, url: raw.u, priceEur: !raw.c || String(raw.c).toUpperCase() === 'EUR' ? raw.p : null, options: [raw.co?.length && { name: 'Couleur', values: raw.co }, raw.si?.length && { name: 'Taille', values: raw.si }].filter(Boolean) };
        $('#scrapeMsg').innerHTML = '<p class="muted">Récupération des photos…</p>';
        api('/products/import-images', { method: 'POST', body: { urls: raw.im || [], name: raw.n } }).then((r) => { applyImport({ ...d, ...r }); $('#scrapeMsg').innerHTML = importNotice({ ...d, ...r }); })
          .catch(() => { applyImport(d); $('#scrapeMsg').innerHTML = importNotice({ ...d, images: [] }); });
        history.replaceState(null, '', '#/produit/nouveau');
      } catch (err) {
        console.error('[favori → Kamwa]', err, fromBookmark.slice(0, 200));
        $('#scrapeMsg').innerHTML = `<div class="alert err">Données du favori illisibles (${esc(err.message)}, ${fromBookmark.length} caractères reçus). Remettez le bouton « → Kamwa » à jour (glissez-le de nouveau dans vos favoris) puis réessayez. Si cela continue, dites-nous sur quel site.</div>`;
      }
    }
    $('#files')?.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

    const val = (sel) => $(sel)?.value;
    $('#pform').addEventListener('submit', async (e) => {
      e.preventDefault();
      let body;
      if (limited) {
        body = { stock: val('#stock'), supplierPrice: val('#supplierPrice') };
      } else {
        body = {
          name: val('#name'), brand: val('#brand'), category: val('#category'), condition: val('#condition'),
          description: val('#description'), specs: val('#specs'), stock: val('#stock'), images,
        };
        if (showSale) Object.assign(body, { price: val('#price'), oldPrice: val('#oldPrice') });
        if (showSupplierPrice) body.supplierPrice = val('#supplierPrice');
        if (isAdmin()) Object.assign(body, { supplierId: val('#supplierId'), costPrice: val('#costPrice') });
        body.options = val('#options');
        if (!isSupplier()) Object.assign(body, { origin: $('#originFr').checked ? 'FR' : null, sourceUrl: val('#srcUrl'), priceEur: val('#priceEur'), weightKg: val('#weightKg') });
        if (body.origin === 'FR') delete body.costPrice; // calculé par le serveur (article + avion + douane)
        if (!isSupplier()) Object.assign(body, { active: $('#active').checked, featured: $('#featured').checked });
      }
      const btn = e.target.querySelector('button.btn');
      btn.disabled = true;
      try {
        const saved = await api(isNew ? '/products' : '/products/' + enc(p.id), { method: isNew ? 'POST' : 'PATCH', body });
        state.products = isNew ? [...state.products, saved] : state.products.map((x) => (x.id === saved.id ? saved : x));
        toast(isNew ? (saved.pending ? 'Produit envoyé pour validation ✓' : 'Produit ajouté ✓') : 'Produit enregistré ✓');
        if (isNew || !saved.pending) location.hash = '#/produits';
        else viewProduct(saved.id);
      } catch (err) {
        $('#formError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    });
    $('#deleteBtn')?.addEventListener('click', async () => {
      if (!confirm(`Supprimer définitivement « ${p.name} » ?\n\nCette action est irréversible. Si vous voulez seulement le retirer de la boutique, annulez et décochez plutôt « Visible ».`)) return;
      try {
        await api('/products/' + enc(p.id), { method: 'DELETE' });
        state.products = state.products.filter((x) => x.id !== p.id);
        toast('Produit supprimé');
        location.hash = '#/produits';
      } catch (err) {
        $('#formError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
      }
    });
    $('#approveBtn')?.addEventListener('click', async () => {
      try {
        const saved = await api('/products/' + enc(p.id) + '/approve', { method: 'POST' });
        state.products = state.products.map((x) => (x.id === saved.id ? saved : x));
        toast('Produit validé et publié ✓');
        location.hash = '#/produits';
      } catch (err) {
        $('#formError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
      }
    });
  }

  // ---------- Espace fournisseur : commandes de mes produits ----------
  async function viewSupplierOrders() {
    let data;
    try { data = await api('/supplier/orders'); } catch { return; }
    state.labels = data.statusLabels;
    const qty = (o) => o.lines.reduce((n, l) => n + l.qty, 0);
    const amount = (o) => o.lines.reduce((n, l) => n + (l.supplierPrice || 0) * l.qty, 0);
    const toPrepare = data.orders.filter((o) => o.status === 'paid');
    app.innerHTML = pageHead({ title: 'Mes commandes', desc: "Kamwa s'occupe de la livraison. Préparez les articles des commandes « Payée » pour les remettre à Kamwa." })
      + `<div class="todo"><a href="#/fournisseur">${icon('package-duotone')} À préparer : ${toPrepare.reduce((n, o) => n + qty(o), 0)} article(s)</a></div><div id="tbl"></div>`;
    dataTable($('#tbl'), {
      id: 'supplier-orders', rows: data.orders, defaultSort: 'date', placeholder: 'N° de commande ou produit', empty: 'Aucune commande de vos produits pour le moment.',
      searchText: (o) => `${o.id} ${o.lines.map((l) => l.name).join(' ')}`,
      columns: [
        { key: 'id', label: 'Commande', render: (o) => `<strong class="mono">${esc(o.id)}</strong>` },
        { key: 'date', label: 'Date', sortValue: (o) => o.paidAt || o.createdAt, render: (o) => date(o.paidAt || o.createdAt) },
        { key: 'lines', label: 'Vos articles', sortable: false, render: (o) => o.lines.map((l) => `${l.qty} × ${esc(l.name)}`).join('<br>') },
        { key: 'qty', label: 'Qté', cls: 'num', sortValue: qty, render: qty },
        { key: 'amount', label: 'Montant', cls: 'num', sortValue: amount, render: (o) => fcfa(amount(o)) },
        { key: 'mode', label: 'Mode', sortValue: (o) => o.fulfillment, render: (o) => (o.fulfillment === 'pickup' ? 'Retrait en agence' : o.agency ? 'Payé en agence, livré' : 'Livraison') },
        { key: 'status', label: 'Statut', render: (o) => badge(o.status) },
      ],
    });
  }

  // ---------- Équipe et fournisseurs (admin) ----------
  async function viewStaff(sub) {
    let data;
    try { data = await api('/staff'); } catch { return; }
    const roleLabel = (r) => data.roles[r] || r;
    if (sub === 'nouveau') {
      app.innerHTML = `
        <p><a href="#/equipe">‹ Équipe</a></p>
        <h1>Nouveau compte</h1>
        <form class="panel" id="staffForm" novalidate>
          <label for="sRole">Rôle *</label>
          <select id="sRole">
            <option value="supplier">Fournisseur — ses produits, son stock, les commandes de ses produits</option>
            <option value="catalog">Employé Catalogue — ajout et modification des produits</option>
            <option value="orders">Employé Commandes — suivi et statut des commandes</option>
            <option value="courier">Livreur — ses livraisons, validées avec le code du client</option>
            <option value="agent">Agent Europe — achète, reçoit et envoie les achats en Europe</option>
          </select>
          <div id="companyField"><label for="sCompany">Entreprise du fournisseur *</label><input id="sCompany" type="text" placeholder="Ex. Tech Import Pointe-Noire"></div>
          <label for="sName">Nom de la personne *</label><input id="sName" type="text">
          <label for="sLogin">Identifiant de connexion *</label><input id="sLogin" type="text" autocapitalize="off" placeholder="Ex. paul.mabiala">
          <label for="sPhone">Téléphone</label><input id="sPhone" type="tel">
          <div id="sError"></div>
          <button class="btn" style="width:100%;margin-top:14px">Créer le compte</button>
        </form>`;
      const syncRole = () => { $('#companyField').hidden = $('#sRole').value !== 'supplier'; };
      $('#sRole').addEventListener('change', syncRole); syncRole();
      $('#staffForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const res = await api('/staff', { method: 'POST', body: { role: $('#sRole').value, company: $('#sCompany').value, name: $('#sName').value, login: $('#sLogin').value, phone: $('#sPhone').value } });
          showPassword(res.user, res.password);
        } catch (err) { $('#sError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
      });
      return;
    }
    app.innerHTML = pageHead({ title: 'Équipe et fournisseurs', desc: 'Chaque personne a son identifiant et son mot de passe. Un compte désactivé est déconnecté immédiatement.', actions: `<a class="btn" href="#/equipe/nouveau">${icon('plus-bold')} Ajouter</a>` })
      + '<div id="tbl"></div>';
    dataTable($('#tbl'), {
      id: 'staff', rows: data.staff, placeholder: 'Nom, entreprise ou identifiant', empty: 'Aucun compte pour le moment. Ajoutez vos fournisseurs et vos employés.',
      searchText: (u) => `${u.name} ${u.company || ''} ${u.login} ${roleLabel(u.role)}`,
      columns: [
        { key: 'name', label: 'Nom', sortValue: (u) => norm(u.name), render: (u) => `<strong>${esc(u.name)}</strong>${u.company ? `<br><span class="muted">${esc(u.company)}</span>` : ''}` },
        { key: 'role', label: 'Rôle', sortValue: (u) => roleLabel(u.role), render: (u) => esc(roleLabel(u.role)) },
        { key: 'login', label: 'Identifiant', render: (u) => `<code>${esc(u.login)}</code>` },
        { key: 'products', label: 'Produits', cls: 'num', render: (u) => (u.role === 'supplier' ? u.products : '—') },
        { key: 'active', label: 'Statut', sortValue: (u) => u.active !== false, render: (u) => (u.active === false ? '<span class="tag danger">Désactivé</span>' : '<span class="tag ok">Actif</span>') },
        { key: 'act', label: '', sortable: false, render: (u) => `<div class="cell-actions"><button class="ghost" data-toggle="${esc(u.id)}" data-active="${u.active !== false}">${u.active === false ? 'Réactiver' : 'Désactiver'}</button><button class="ghost" data-reset="${esc(u.id)}">${icon('key-bold')} Mot de passe</button></div>` },
      ],
    });
    $('#tbl').addEventListener('click', async (e) => {
      const t = e.target.closest('[data-toggle]');
      const r = e.target.closest('[data-reset]');
      if (t) {
        const active = t.dataset.active !== 'true';
        if (!active && !confirm('Désactiver ce compte ? La personne sera déconnectée immédiatement.')) return;
        try { await api('/staff/' + enc(t.dataset.toggle), { method: 'PATCH', body: { active } }); toast(active ? 'Compte réactivé' : 'Compte désactivé'); viewStaff(); } catch (err) { toast('❌ ' + err.message); }
      }
      if (r) {
        if (!confirm("Créer un nouveau mot de passe provisoire ? L'ancien ne marchera plus.")) return;
        try {
          const res = await api('/staff/' + enc(r.dataset.reset) + '/reset-password', { method: 'POST' });
          showPassword(data.staff.find((u) => u.id === r.dataset.reset), res.password);
        } catch (err) { toast('❌ ' + err.message); }
      }
    });
  }

  // Mot de passe provisoire : montré une seule fois, à transmettre à la personne
  function showPassword(user, password) {
    const msg = `Bonjour ${user.name}, voici vos accès à l'espace Kamwa : ${location.origin}/admin — identifiant : ${user.login} — mot de passe provisoire : ${password} (à changer à la première connexion).`;
    app.innerHTML = `
      <div class="panel" style="text-align:center">
        <h1>Accès de ${esc(user.name)}</h1>
        <p>Identifiant : <strong>${esc(user.login)}</strong></p>
        <p>Mot de passe provisoire :</p>
        <div class="code-box">${esc(password)}</div>
        <div class="alert warn">Notez-le ou envoyez-le tout de suite : il ne sera plus affiché. La personne devra le changer à sa première connexion.</div>
        <div class="row" style="justify-content:center">
          ${user.phone ? `<a class="btn green" target="_blank" rel="noopener" href="https://wa.me/242${esc(String(user.phone).replace(/\D/g, '').replace(/^242/, ''))}?text=${enc(msg)}">Envoyer par WhatsApp</a>` : ''}
          <a class="ghost" href="#/equipe">Retour à l'équipe</a>
        </div>
      </div>`;
  }

  // ---------- Journal (admin) ----------
  async function viewActivity() {
    let list = [];
    try { list = await api('/activity'); } catch { return; }
    app.innerHTML = pageHead({ title: 'Journal', desc: 'Les 300 dernières actions : qui a fait quoi, et quand.' }) + '<div id="tbl"></div>';
    dataTable($('#tbl'), {
      id: 'activity', rows: list, defaultSort: 'at', placeholder: 'Personne, action, produit ou commande', empty: 'Rien pour le moment.',
      searchText: (a) => `${a.userName} ${a.action} ${a.targetName || ''} ${a.details || ''}`,
      columns: [
        { key: 'at', label: 'Date', render: (a) => date(a.at) },
        { key: 'userName', label: 'Qui', render: (a) => esc(a.userName) },
        { key: 'action', label: 'Action', render: (a) => `<strong>${esc(a.action)}</strong>` },
        { key: 'targetName', label: 'Concerne', render: (a) => esc(a.targetName || '—') },
        { key: 'details', label: 'Détails', sortable: false, render: (a) => `<span class="muted">${esc(a.details || '')}</span>` },
      ],
    });
  }

  // ---------- Mon mot de passe (équipe et fournisseurs) ----------
  function viewPassword() {
    app.innerHTML = `
      <h1>Mon mot de passe</h1>
      ${state.user.mustChangePassword ? '<div class="alert warn">Vous utilisez un mot de passe provisoire : choisissez-en un nouveau.</div>' : ''}
      <form class="panel" id="pwForm" novalidate>
        <label for="pwCur">Mot de passe actuel</label><input id="pwCur" type="password" autocomplete="current-password">
        <label for="pwNew">Nouveau mot de passe (10 caractères minimum)</label><input id="pwNew" type="password" autocomplete="new-password">
        <div id="pwError"></div>
        <button class="btn" style="width:100%;margin-top:14px">Changer mon mot de passe</button>
      </form>`;
    $('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/me/password', { method: 'POST', body: { current: $('#pwCur').value, next: $('#pwNew').value } });
        state.user.mustChangePassword = false;
        toast('Mot de passe changé ✓');
        location.hash = homeHash();
      } catch (err) { $('#pwError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
  }

  // Réduit la photo (max 1200 px, JPEG) avant l'envoi : plus rapide sur réseau mobile, pages plus légères.
  function shrinkImage(file, max = 1200) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // fond blanc pour les PNG transparents
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Photo illisible'))), 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Format de photo non reconnu. Essayez une photo JPG ou PNG.')); };
      img.src = url;
    });
  }

  // Détourage : option mémorisée sur l'appareil (activée par défaut)
  const detourOn = () => { try { return localStorage.getItem('kamwa-detour') !== '0'; } catch { return true; } };
  const detourWait = () => 'Détourage en cours… (quelques secondes ; la toute première fois, le serveur prépare l\'outil : jusqu\'à une minute)';

  // ---------- Finances (administrateur) ----------
  // Les ventes viennent toutes seules des commandes payées ; on saisit ici les dépenses, autres entrées et transferts.
  const today = () => new Date().toISOString().slice(0, 10);
  const PERIODS = [['month', 'Ce mois'], ['prev', 'Mois dernier'], ['quarter', '3 mois'], ['year', 'Cette année'], ['all', 'Tout']];
  function periodRange(key) {
    const d = new Date(); const y = d.getFullYear(); const m = d.getMonth();
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    if (key === 'month') return { from: iso(new Date(y, m, 1)), to: today() };
    if (key === 'prev') return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    if (key === 'quarter') return { from: iso(new Date(y, m - 2, 1)), to: today() };
    if (key === 'year') return { from: `${y}-01-01`, to: today() };
    return { from: '', to: '' };
  }
  const finQuery = () => { const r = periodRange(state.finPeriod || 'month'); return `from=${r.from}&to=${r.to}`; };
  const money = (n) => `<span class="${n < 0 ? 'neg' : ''}">${n < 0 ? '−' : ''}${fcfa(Math.abs(n))}</span>`;
  const finTabs = (cur) => `<div class="tabbar">${[['', 'Vue d\'ensemble'], ['journal', 'Journal'], ['fournisseurs', 'Fournisseurs']].map(([k, l]) => `<a class="tab ${k === cur ? 'on' : ''}" href="#/finances${k ? '/' + k : ''}">${l}</a>`).join('')}</div>`;
  const periodChips = () => `<div class="chips fin-period">${PERIODS.map(([k, l]) => `<button class="chip ${k === (state.finPeriod || 'month') ? 'on' : ''}" data-per="${k}">${l}</button>`).join('')}</div>`;
  const bindPeriod = () => app.querySelectorAll('[data-per]').forEach((b) => b.addEventListener('click', () => { state.finPeriod = b.dataset.per; route(); }));

  async function viewFinances(sub) {
    sub = (sub || '').split('?')[0];
    const parts = location.hash.slice(2).split('?')[0].split('/');
    if (sub === 'nouvelle' || sub === 'e') return viewEntry(sub === 'e' ? decodeURIComponent(parts[2] || '') : null);
    let d;
    try { d = await api('/finance?' + finQuery()); } catch { return; }
    state.finMeta = { methods: d.methods, categories: d.categories };
    const actions = `<a class="btn ghost" href="/api/admin/finance/journal.csv?${finQuery()}">${icon('download-simple-bold')} Exporter</a><a class="btn" href="#/finances/nouvelle">${icon('plus-bold')} Nouvelle écriture</a>`;
    const head = pageHead({ title: 'Finances', desc: 'Ventes, dépenses, marge et caisses de Kamwa. Les ventes s\'ajoutent toutes seules ; saisissez ici les dépenses et les autres mouvements d\'argent.', actions });
    if (sub === 'journal') return viewFinJournal(head);
    if (sub === 'fournisseurs') return viewFinSuppliers(head, d);

    const k = d.kpis;
    const pct = k.revenue ? Math.round((k.grossMargin / k.revenue) * 100) : 0;
    const alerts = [];
    if (d.unknownCostLines) alerts.push(`<div class="alert warn">${icon('warning-duotone')} ${d.unknownCostLines} article(s) vendu(s) sans prix d'achat connu : la marge est surestimée. Renseignez le « Prix d'achat » des produits Kamwa (fiche produit).</div>`);
    if (d.stockNoCost) alerts.push(`<div class="alert warn">${icon('package-duotone')} ${d.stockNoCost} produit(s) Kamwa en stock sans prix d'achat : la valeur du stock est incomplète.</div>`);
    const refunds = d.refundsToDo.length ? `<section class="card wide"><h2>${icon('warning-duotone')} Remboursements à faire</h2>
      <ul class="mini-list">${d.refundsToDo.map((r) => `<li><a href="#/commande/${enc(r.id)}">${esc(r.id)} · ${esc(r.customer || '')}</a><span class="row"><strong>${fcfa(r.total)}</strong><button class="btn small red" data-refund="${esc(r.id)}">Marquer remboursé</button></span></li>`).join('')}</ul>
      <p class="muted">Remboursez d'abord le client (Mobile Money, espèces…), puis cliquez : la sortie d'argent est enregistrée dans la caisse d'origine.</p></section>` : '';
    const totalCash = Object.values(d.balances).reduce((a, b) => a + b, 0);
    const owed = d.suppliers.reduce((a, s) => a + Math.max(0, s.due), 0);

    app.innerHTML = head + finTabs('') + periodChips() + alerts.join('') + `
      <div class="kpis">
        <div class="kpi kc0"><span class="kpi-ico">${icon('currency-circle-dollar-duotone')}</span><span class="kpi-label">Chiffre d'affaires</span><span class="kpi-value">${fcfa(k.revenue)}</span><span class="kpi-hint">${k.orders} commande(s) payée(s)</span></div>
        <div class="kpi kc1"><span class="kpi-ico">${icon('chart-line-up-duotone')}</span><span class="kpi-label">Marge brute</span><span class="kpi-value">${money(k.grossMargin)}</span><span class="kpi-hint">${pct} % des ventes · coût des produits ${fcfa(k.cogs)}</span></div>
        <div class="kpi kc2"><span class="kpi-ico">${icon('receipt-duotone')}</span><span class="kpi-label">Charges</span><span class="kpi-value">${fcfa(k.charges)}</span><span class="kpi-hint">loyer, livraison, salaires, pub…</span></div>
        <div class="kpi kc3 ${k.result < 0 ? 'bad' : ''}"><span class="kpi-ico">${icon('trophy-duotone')}</span><span class="kpi-label">Résultat (bénéfice)</span><span class="kpi-value">${money(k.result)}</span><span class="kpi-hint">marge brute − charges${k.retainedDeposits ? ` + ${fcfa(k.retainedDeposits)} d'acomptes conservés` : ''}</span></div>
      </div>
      <div class="dash-grid">
        <section class="card third"><h2>${icon('wallet-duotone')} Caisses</h2>
          <ul class="mini-list">${Object.entries(d.methods).map(([m, l]) => `<li><span>${esc(l)}</span><strong>${money(d.balances[m])}</strong></li>`).join('')}
          <li class="total-line"><span>Total disponible</span><strong>${money(totalCash)}</strong></li></ul>
          <p class="muted">Argent entré − sorti depuis le début${d.to ? ` jusqu'au ${esc(d.to.split('-').reverse().join('/'))}` : ''}. Saisissez un « Apport / solde de départ » pour partir du bon montant.</p></section>
        <section class="card third"><h2>${icon('chart-line-up-duotone')} Trésorerie de la période</h2>
          <ul class="mini-list"><li><span>Argent entré</span><strong class="pos">${fcfa(k.cashIn)}</strong></li><li><span>Argent sorti</span><strong class="neg">−${fcfa(k.cashOut)}</strong></li><li class="total-line"><span>Différence</span><strong>${money(k.cashFlow)}</strong></li></ul>
          <p class="muted">Inclut les achats de stock, les paiements fournisseurs et les remboursements.</p></section>
        <section class="card third"><h2>${icon('package-duotone')} Stock et fournisseurs</h2>
          <ul class="mini-list"><li><span>Valeur du stock Kamwa</span><strong>${fcfa(k.stockValue)}</strong></li><li><span>À payer aux fournisseurs</span><strong class="${owed ? 'neg' : ''}">${fcfa(owed)}</strong></li><li><span>Livraisons ratées (période)</span><strong class="${k.failedDeliveries ? 'neg' : ''}">${k.failedDeliveries}</strong></li><li><span>Acomptes conservés (colis refusés)</span><strong>${fcfa(k.retainedDeposits)}</strong></li></ul>
          <p class="muted"><a href="#/finances/fournisseurs">Détail par fournisseur ›</a></p></section>
        ${refunds}
        ${d.cashHeld.length ? `<section class="card wide"><h2>${icon('wallet-duotone')} Espèces encaissées à la livraison, pas encore remises</h2>
          <ul class="mini-list">${d.cashHeld.map((h) => `<li><span><strong>${esc(h.name)}</strong><br><span class="muted">${h.orders.length} commande(s) : ${esc(h.orders.slice(0, 4).join(', '))}${h.orders.length > 4 ? '…' : ''}</span></span><span class="row"><strong>${fcfa(h.amount)}</strong><button class="btn small green" data-remit="${esc(h.id)}" data-amount="${h.amount}">Remise reçue</button></span></li>`).join('')}</ul>
          <p class="muted">Quand le livreur vous remet l'argent, cliquez « Remise reçue » : la somme entre dans la caisse espèces.</p></section>` : ''}
        <section class="card wide"><h2>${icon('chart-line-up-duotone')} 12 derniers mois</h2><div class="chart-box"><canvas id="cMonths"></canvas></div></section>
        <section class="card"><h2>${icon('receipt-duotone')} Dépenses par catégorie</h2>${d.byCategory.length ? '<div class="chart-box"><canvas id="cCats"></canvas></div>' : '<p class="nodata">Aucune dépense sur la période</p>'}</section>
        <section class="card"><h2>${icon('list-bullets-duotone')} Comment lire ces chiffres</h2>
          <ul class="help-list">
            <li><b>Chiffre d'affaires</b> : total des commandes payées (hors annulées).</li>
            <li><b>Marge brute</b> : ventes − prix d'achat des produits vendus (prix fournisseur ou prix d'achat Kamwa).</li>
            <li><b>Résultat</b> : marge brute − charges. C'est le bénéfice réel de la période.</li>
            <li><b>Caisses</b> : l'argent disponible dans chaque caisse. Un retrait Mobile Money en espèces = « Transfert entre caisses ».</li>
          </ul></section>
      </div>`;
    bindPeriod();
    app.querySelectorAll('[data-remit]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Confirmez-vous avoir reçu ${fcfa(Number(b.dataset.amount))} en espèces ?`)) return;
      try { await api('/finance/remit/' + enc(b.dataset.remit), { method: 'POST', body: {} }); toast('Espèces reçues ✓'); route(); } catch (err) { toast('❌ ' + err.message); }
    }));
    app.querySelectorAll('[data-refund]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Confirmez-vous avoir remboursé ce client ? La sortie d\'argent sera enregistrée.')) return;
      try { await api('/finance/refunds/' + enc(b.dataset.refund), { method: 'POST', body: {} }); toast('Remboursement enregistré ✓'); route(); } catch (err) { toast('❌ ' + err.message); }
    }));
    makeChart('cMonths', {
      data: {
        labels: d.monthly.map((x) => x.month.slice(5) + '/' + x.month.slice(2, 4)),
        datasets: [
          { type: 'bar', label: 'Ventes', data: d.monthly.map((x) => x.revenue), backgroundColor: 'rgba(157,140,255,.6)', borderRadius: 6, maxBarThickness: 28, order: 2 },
          { type: 'bar', label: 'Coûts et charges', data: d.monthly.map((x) => x.costs), backgroundColor: 'rgba(255,107,79,.55)', borderRadius: 6, maxBarThickness: 28, order: 2 },
          { type: 'line', label: 'Résultat', data: d.monthly.map((x) => x.result), borderColor: PALETTE[0], backgroundColor: PALETTE[0], tension: 0.35, pointRadius: 3, order: 1 },
        ],
      },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label} : ${fcfa(c.raw)}` } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => shortNum(v) } } } },
    });
    if (d.byCategory.length) doughnut('cCats', d.byCategory);
  }

  async function viewFinJournal(head) {
    let rows = [];
    try { rows = await api('/finance/journal?' + finQuery()); } catch { return; }
    const M = state.finMeta?.methods || {};
    const KIND = { sale: ['Vente', 'ok'], expense: ['Dépense', 'danger'], income: ['Entrée', ''], transfer: ['Transfert', 'warn'] };
    app.innerHTML = head + finTabs('journal') + periodChips() + '<div id="tbl"></div>';
    bindPeriod();
    dataTable($('#tbl'), {
      id: 'fin-journal', rows, defaultSort: 'date', placeholder: 'Libellé, catégorie, commande…', empty: 'Aucun mouvement sur cette période.',
      rowHref: (r) => (r.kind === 'sale' ? '#/commande/' + enc(r.id) : '#/finances/e/' + enc(r.id)),
      searchText: (r) => `${r.label} ${r.category} ${r.detail} ${M[r.method] || ''}`,
      columns: [
        { key: 'date', label: 'Date', render: (r) => r.date.split('-').reverse().join('/') },
        { key: 'kind', label: 'Type', render: (r) => `<span class="tag ${KIND[r.kind][1]}">${KIND[r.kind][0]}</span>` },
        { key: 'category', label: 'Catégorie' },
        { key: 'label', label: 'Libellé', render: (r) => `<strong>${esc(r.label)}</strong>${r.receipt ? ` ${icon('image-broken-duotone')}` : ''}${r.detail ? `<br><span class="muted">${esc(r.detail.slice(0, 90))}</span>` : ''}` },
        { key: 'method', label: 'Caisse', sortValue: (r) => M[r.method] || r.method, render: (r) => esc(M[r.method] || r.method) + (r.toMethod ? ` → ${esc(M[r.toMethod])}` : '') },
        { key: 'amount', label: 'Montant', cls: 'num', render: (r) => (r.kind === 'transfer' ? fcfa(r.amount) : `<strong class="${r.amount < 0 ? 'neg' : 'pos'}">${r.amount < 0 ? '−' : '+'}${fcfa(Math.abs(r.amount))}</strong>`) },
      ],
    });
  }

  function viewFinSuppliers(head, d) {
    app.innerHTML = head + finTabs('fournisseurs') + `<p class="muted">Ce que Kamwa doit à chaque fournisseur : ses produits vendus (au prix fournisseur, toutes périodes) moins les paiements enregistrés (« Paiement fournisseur »).</p><div id="tbl"></div>`;
    dataTable($('#tbl'), {
      id: 'fin-suppliers', rows: d.suppliers, defaultSort: 'due', placeholder: 'Fournisseur', empty: 'Aucun produit de fournisseur vendu pour le moment.',
      searchText: (s) => s.name,
      columns: [
        { key: 'name', label: 'Fournisseur', render: (s) => `<strong>${esc(s.name)}</strong>` },
        { key: 'sold', label: 'Vendu (prix fournisseur)', cls: 'num', render: (s) => fcfa(s.sold) },
        { key: 'paid', label: 'Déjà payé', cls: 'num', render: (s) => fcfa(s.paid) },
        { key: 'due', label: 'Reste à payer', cls: 'num', render: (s) => `<strong class="${s.due > 0 ? 'neg' : 'pos'}">${fcfa(s.due)}</strong>` },
        { key: 'act', label: '', sortable: false, render: (s) => (s.due > 0 ? `<div class="cell-actions"><a class="btn small" href="#/finances/nouvelle?fournisseur=${enc(s.id)}&montant=${s.due}">Enregistrer un paiement</a></div>` : '') },
      ],
    });
  }

  async function viewEntry(id) {
    let meta = state.finMeta;
    if (!meta) { try { const d = await api('/finance?from=&to='); meta = state.finMeta = { methods: d.methods, categories: d.categories }; } catch { return; } }
    let e = { type: 'expense', date: today(), method: 'cash', category: '' };
    if (id) { try { e = await api('/finance/entries/' + enc(id)); } catch { return; } }
    const qs = new URLSearchParams(location.hash.split('?')[1] || '');
    if (!id && qs.get('fournisseur')) Object.assign(e, { category: 'supplier', supplierId: qs.get('fournisseur'), amount: Number(qs.get('montant')) || '', method: 'momo' });
    let suppliers = [];
    try { suppliers = (await api('/staff')).staff.filter((u) => u.role === 'supplier'); } catch {}
    const opts = (obj, cur) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
    app.innerHTML = pageHead({ crumb: 'Finances', title: id ? 'Modifier l\'écriture' : 'Nouvelle écriture', desc: 'Une dépense (loyer, livraison, achat de stock…), une entrée d\'argent hors boutique, ou un transfert entre deux caisses.' }) + `
      <form class="panel fin-form" id="entryForm" novalidate>
        <div class="seg" role="radiogroup" aria-label="Type">${[['expense', 'Dépense', 'arrow-up'], ['income', 'Entrée d\'argent', 'arrow-down'], ['transfer', 'Transfert', 'swap']].map(([k, l]) => `<label class="seg-opt ${k}"><input type="radio" name="type" value="${k}" ${e.type === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <div class="grid2">
          <div><label for="fDate">Date</label><input id="fDate" type="date" value="${esc(e.date)}" max="${today()}"></div>
          <div><label for="fAmount">Montant (FCFA)</label><input id="fAmount" type="number" inputmode="numeric" min="1" step="1" value="${esc(e.amount ?? '')}" placeholder="Ex. 25000"></div>
        </div>
        <div id="catWrap"><label for="fCat">Catégorie</label><select id="fCat"></select></div>
        <div id="supWrap" hidden><label for="fSup">Fournisseur payé</label><select id="fSup"><option value="">Choisir…</option>${suppliers.map((u) => `<option value="${esc(u.id)}" ${u.id === e.supplierId ? 'selected' : ''}>${esc(u.company || u.name)}</option>`).join('')}</select></div>
        <label for="fLabel">Libellé</label><input id="fLabel" type="text" maxlength="120" value="${esc(id ? e.label : '')}" placeholder="Ex. Loyer octobre, carburant livreur…">
        <div class="grid2">
          <div><label for="fMethod" id="fMethodLbl">Payé depuis</label><select id="fMethod">${opts(meta.methods, e.method)}</select></div>
          <div id="toWrap" hidden><label for="fTo">Vers</label><select id="fTo">${opts(meta.methods, e.toMethod || 'bank')}</select></div>
        </div>
        <label for="fNote">Note (facultatif)</label><textarea id="fNote" rows="2" maxlength="500">${esc(e.note || '')}</textarea>
        <label>Justificatif (photo du reçu, facultatif)</label>
        <div class="row"><label class="btn ghost" style="margin:0">${icon('camera-bold')} Prendre / choisir une photo<input id="fReceipt" type="file" accept="image/*" capture="environment" hidden></label><span id="rcptHint" class="muted">${e.receipt ? `<a href="${esc(e.receipt)}" target="_blank">Voir le justificatif</a>` : ''}</span></div>
        <div id="fError"></div>
        <div class="row" style="margin-top:18px"><button class="btn">${id ? 'Enregistrer' : 'Ajouter'}</button><a class="ghost" href="#/finances/journal">Annuler</a>${id ? '<button type="button" class="btn red" id="fDelete" style="margin-left:auto">Supprimer</button>' : ''}</div>
      </form>`;
    let receipt = e.receipt || null;
    const type = () => app.querySelector('input[name=type]:checked').value;
    const sync = () => {
      const t = type();
      $('#fCat').innerHTML = meta.categories[t].map((c) => `<option value="${c.key}" ${c.key === e.category ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
      $('#catWrap').hidden = t === 'transfer';
      $('#toWrap').hidden = t !== 'transfer';
      $('#fMethodLbl').textContent = t === 'income' ? 'Arrivé dans' : t === 'transfer' ? 'De' : 'Payé depuis';
      $('#supWrap').hidden = !(t === 'expense' && $('#fCat').value === 'supplier');
    };
    app.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', () => { e.category = ''; sync(); }));
    $('#fCat').addEventListener('change', () => { e.category = $('#fCat').value; sync(); });
    sync();
    $('#fReceipt').addEventListener('change', async (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      $('#rcptHint').textContent = 'Envoi…';
      try {
        const blob = await shrinkImage(file);
        receipt = (await api('/uploads', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } })).url;
        $('#rcptHint').innerHTML = `Justificatif ajouté ✓ <a href="${esc(receipt)}" target="_blank">voir</a>`;
      } catch (err) { $('#rcptHint').textContent = '❌ ' + err.message; }
    });
    $('#entryForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = { type: type(), date: $('#fDate').value, amount: $('#fAmount').value, category: $('#fCat').value, supplierId: $('#fSup').value || null, label: $('#fLabel').value, method: $('#fMethod').value, toMethod: $('#fTo').value, note: $('#fNote').value, receipt };
      try {
        await api(id ? '/finance/entries/' + enc(id) : '/finance/entries', { method: id ? 'PATCH' : 'POST', body });
        toast('Écriture enregistrée ✓');
        location.hash = '#/finances/journal';
      } catch (err) { $('#fError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    $('#fDelete')?.addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement cette écriture ?')) return;
      try { await api('/finance/entries/' + enc(id), { method: 'DELETE' }); toast('Écriture supprimée'); location.hash = '#/finances/journal'; } catch (err) { toast('❌ ' + err.message); }
    });
  }

  // ---------- Routeur ----------
  // ---------- Messagerie : clients (assistant + conseillers) et salon de l'équipe ----------
  const CONV_ST = { bot: ['Assistant', ''], open: ['Conseiller demandé', 'warn'], closed: ['Terminée', 'ok'] };
  const ID_TAG = { verified: ['Identité vérifiée', 'ok'], pending: ['Pièce à vérifier', 'warn'], rejected: ['Pièce refusée', 'danger'], missing: ['Pièce à fournir', 'danger'] };
  const CANNED = ['Bonjour, je regarde votre demande et je reviens vers vous.', 'Votre commande est en préparation, nous vous appelons avant la livraison.', 'Pouvez-vous me donner votre numéro de commande (CMD-…) ?', 'Merci pour votre patience. Bonne journée !'];
  const msgTime = (iso) => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
  const bubble = (m, mine) => `
    <div class="pm ${m.internal ? 'note' : m.from} ${mine ? 'mine' : ''}">
      <span class="who">${m.internal ? `${icon('note-pencil')} Note interne · ${esc(m.staffName || '')}` : m.from === 'customer' ? 'Client' : m.from === 'bot' ? 'Assistant automatique' : esc(m.staffName || 'Kamwa')}</span>
      <div class="pb">${esc(m.text).replace(/\n/g, '<br>')}${(m.links || []).length ? `<div class="muted" style="margin-top:4px">${m.links.map((l) => esc(l.label)).join(' · ')}</div>` : ''}</div>
      <span class="t">${msgTime(m.at)}</span>
    </div>`;
  async function viewMessaging(id) {
    const support = CAN.orders();
    if (!id) id = support ? '' : 'equipe';
    let list = [];
    if (support) { try { list = await api('/chat/conversations'); } catch { return; } }
    const f = state.msgFilter || 'todo';
    const match = (c, k) => k === 'all' || (k === 'todo' ? c.status === 'open' : c.status === k);
    const FILT = [['todo', 'À répondre'], ['bot', 'Avec l\'assistant'], ['closed', 'Terminées'], ['all', 'Toutes']];
    const rows = list.filter((c) => match(c, f));
    app.innerHTML = pageHead({ title: 'Messagerie', desc: support ? "Les questions des clients (bulle « Aide » de la boutique). L'assistant automatique répond d'abord ; quand un client demande un conseiller, la conversation arrive dans « À répondre ». Le salon « Équipe Kamwa » sert à échanger entre vous." : 'Le salon « Équipe Kamwa » pour échanger avec toute l\'équipe.' }) + `
      <div class="msg-layout ${id ? 'has-conv' : ''}">
        <aside class="msg-list">
          <a class="msg-item team ${id === 'equipe' ? 'on' : ''}" href="#/messagerie/equipe">${icon('chats-circle-duotone')}<span><strong>Équipe Kamwa</strong><small>Salon interne de l'équipe</small></span><b class="n" id="teamUnread" hidden></b></a>
          ${support ? `${tabsBar(FILT.map(([k, l]) => [k, l, list.filter((c) => match(c, k)).length]), f, 'mf')}
          ${rows.length ? rows.map((c) => `
            <a class="msg-item ${c.id === id ? 'on' : ''} ${c.unread ? 'unread' : ''}" href="#/messagerie/${enc(c.id)}">
              <span class="av">${esc((c.name || 'V')[0].toUpperCase())}</span>
              <span><strong>${esc(c.name)}${vb(c.idStatus)}</strong><small>${c.lastFrom === 'customer' ? '' : c.lastFrom === 'staff' ? 'Vous : ' : 'Assistant : '}${esc((c.lastText || '').slice(0, 70))}</small></span>
              <span class="side"><em>${c.lastAt ? msgTime(c.lastAt) : ''}</em>${c.unread ? `<b class="n">${c.unread}</b>` : `<i class="tag ${CONV_ST[c.status]?.[1] || ''}">${esc(CONV_ST[c.status]?.[0] || '')}</i>`}</span>
            </a>`).join('') : '<p class="muted" style="padding:14px">Aucune conversation ici.</p>'}` : ''}
        </aside>
        <section class="msg-conv" id="msgConv">${id ? '<p class="muted" style="padding:20px">Chargement…</p>' : `<div class="msg-empty">${icon('chat-circle-dots-duotone')}<p>Choisissez une conversation.</p></div>`}</section>
      </div>`;
    app.querySelectorAll('[data-mf]').forEach((b) => b.addEventListener('click', () => { state.msgFilter = b.dataset.mf; viewMessaging(id); }));
    if (id === 'equipe') await openTeam();
    else if (id) await openConv(id);
    // Nouveaux messages : toutes les 4 s tant que la page est affichée
    state.msgTimer = setInterval(async () => {
      if (document.hidden || !location.hash.startsWith('#/messagerie')) return;
      if (id === 'equipe') return openTeam(true);
      if (id) openConv(id, true);
    }, 4000);
  }
  function replyBox(team) {
    return `<form class="msg-reply" id="msgForm">
      ${team ? '' : `<div class="canned">${CANNED.map((t, i) => `<button type="button" data-canned="${i}">${esc(t.slice(0, 34))}…</button>`).join('')}</div>`}
      <div class="row-reply"><textarea id="msgText" rows="2" maxlength="2000" placeholder="${team ? 'Message à toute l\'équipe…' : 'Votre réponse au client…'}"></textarea>
      <button class="btn">${icon('paper-plane-right-fill')} Envoyer</button></div>
      ${team ? '' : `<label class="check" style="margin:6px 0 0"><input type="checkbox" id="msgInternal"> Note interne (invisible pour le client)</label>`}
    </form>`;
  }
  function bindReply(send) {
    const form = $('#msgForm'), ta = $('#msgText');
    form.querySelectorAll('[data-canned]').forEach((b) => b.addEventListener('click', () => { ta.value = CANNED[b.dataset.canned]; ta.focus(); }));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim(); if (!text) return;
      ta.disabled = true;
      try { await send(text, $('#msgInternal')?.checked); ta.value = ''; if ($('#msgInternal')) $('#msgInternal').checked = false; }
      catch (err) { toast(err.message); }
      ta.disabled = false; ta.focus();
    });
  }
  async function openConv(id, refresh) {
    let c;
    try { c = await api('/chat/conversations/' + enc(id)); } catch (err) { $('#msgConv').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; return; }
    const sig = JSON.stringify([c.messages.length, c.status]);
    if (refresh && sig === state.convSig) return;
    state.convSig = sig;
    if (refresh && $('#msgText')?.value) { $('#msgThread').innerHTML = c.messages.map((m) => bubble(m, m.from === 'staff')).join(''); $('#msgThread').scrollTop = 1e9; return; }
    const st = CONV_ST[c.status] || ['', ''];
    const idt = c.idStatus ? ID_TAG[c.idStatus] : null;
    $('#msgConv').innerHTML = `
      <div class="msg-top">
        <a class="ghost back" href="#/messagerie">${icon('caret-left')}</a>
        <div><strong>${esc(c.name)}</strong>${vb(c.idStatus)} <span class="tag ${st[1]}">${esc(st[0])}</span>${c.assignedTo ? ` <span class="muted">· suivi par ${esc(c.assignedTo)}</span>` : ''}<br>
          <span class="muted">${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a> · <a href="https://wa.me/242${esc(String(c.phone).replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp</a>` : 'Visiteur sans compte'}${idt ? ` · <span class="tag ${idt[1]}">${idt[0]}</span>` : ''}</span>
          ${c.orders.length ? `<div class="msg-orders">${c.orders.map((o) => `<a href="#/commande/${enc(o.id)}">${esc(o.id)} · ${fcfa(o.total)}</a>`).join('')}</div>` : ''}</div>
        ${c.status !== 'closed' ? `<button class="ghost" id="convClose">${icon('check-bold')} Terminer</button>` : ''}
      </div>
      <div class="msg-thread" id="msgThread">${c.messages.map((m) => bubble(m, m.from === 'staff')).join('')}</div>
      ${replyBox(false)}`;
    $('#msgThread').scrollTop = 1e9;
    bindReply(async (text, internal) => { await api('/chat/conversations/' + enc(id) + '/messages', { method: 'POST', body: { text, internal } }); state.convSig = null; await openConv(id, true); });
    $('#convClose')?.addEventListener('click', async () => { await api('/chat/conversations/' + enc(id) + '/close', { method: 'POST' }); toast('Conversation terminée'); viewMessaging(id); });
    loadChatCounts();
  }
  async function openTeam(refresh) {
    let t;
    try { t = await api('/chat/team'); } catch (err) { $('#msgConv').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; return; }
    const sig = JSON.stringify(t.messages.length);
    if (refresh && sig === state.teamSig) return;
    state.teamSig = sig;
    const thread = t.messages.length ? t.messages.map((m) => bubble(m, m.userId === t.me)).join('') : '<p class="muted" style="text-align:center">Pas encore de message. Dites bonjour à l\'équipe !</p>';
    if (refresh && $('#msgThread')) { $('#msgThread').innerHTML = thread; $('#msgThread').scrollTop = 1e9; loadChatCounts(); return; }
    $('#msgConv').innerHTML = `
      <div class="msg-top"><a class="ghost back" href="#/messagerie">${icon('caret-left')}</a><div><strong>Équipe Kamwa</strong><br><span class="muted">Salon interne : visible par toute l'équipe (pas par les fournisseurs ni les clients)</span></div></div>
      <div class="msg-thread" id="msgThread">${thread}</div>
      ${replyBox(true)}`;
    $('#msgThread').scrollTop = 1e9;
    bindReply(async (text) => { await api('/chat/team', { method: 'POST', body: { text } }); state.teamSig = null; await openTeam(true); });
    loadChatCounts();
  }
  // Pastilles du menu + sonnerie quand un client attend un conseiller
  async function loadChatCounts() {
    if (!state.user || CAN.supplier()) return;
    try {
      const n = await api('/chat/unread');
      const total = (n.support || 0) + (n.team || 0);
      for (const el of [$('#chatCount')]) { if (el) { el.hidden = !total; el.textContent = total; } }
      if ($('#teamUnread')) { $('#teamUnread').hidden = !n.team; $('#teamUnread').textContent = n.team; }
      if (state.chatWaiting != null && n.waiting > state.chatWaiting) { ring(); toast('💬 Un client attend une réponse dans la messagerie'); }
      state.chatWaiting = n.waiting;
    } catch {}
  }
  setInterval(() => { if (!document.hidden) loadChatCounts(); }, 15000);

  // ---------- Apparence : sombre / clair / automatique ----------
  function renderProTheme() {
    const m = window.kamwaTheme?.mode() || 'dark';
    $('#proTheme').innerHTML = `<div class="theme-switch" role="group" aria-label="Apparence">${[['dark', 'moon', 'Sombre'], ['light', 'sun', 'Clair'], ['auto', 'circle-half', 'Auto']]
      .map(([k, ic, l]) => `<button type="button" data-theme-set="${k}" class="${m === k ? 'on' : ''}" aria-pressed="${m === k}">${icon(ic)} ${l}</button>`).join('')}</div>`;
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-theme-set]'); if (b) { window.kamwaTheme?.set(b.dataset.themeSet); renderProTheme(); if (state.user && !proBusy()) route({ keep: true }); } });
  renderProTheme();

  // ---------- Agent Tendances (admin) ----------
  const VERDICT = { integrate: ['À intégrer', 'ok'], watch: ['À surveiller', 'warn'], avoid: ['À éviter', 'danger'] };
  const TR_TABS = [['new', 'Nouvelles'], ['kept', 'Gardées'], ['integrated', 'Intégrées'], ['ignored', 'Ignorées']];
  async function viewTrends() {
    let d; try { d = await api('/trends'); } catch { return; }
    const f = state.trFilter || 'new';
    const list = d.proposals.filter((t) => t.status === f);
    const k = d.keys, last = d.runs[0];
    const nowH = new Date(Date.now() + 3600e3).getUTCHours();
    const next = d.settings.hours.find((h) => h > nowH) ?? d.settings.hours[0];
    app.innerHTML = pageHead({ title: 'Tendances', desc: "L'agent repère plusieurs fois par jour les produits qui se vendent le mieux (sources officielles) et ce que vos clients cherchent sans le trouver, puis vous propose ceux à intégrer. Vous décidez.", actions: `<button class="btn" id="trRun">${icon('magic-wand-duotone')} Analyser maintenant</button>` }) + `
      <div class="tr-status">
        <span class="${k.aliexpress ? 'ok' : 'off'}">${icon(k.aliexpress ? 'check-bold' : 'x-bold')} AliExpress ${k.aliexpress ? 'connecté' : 'à connecter'}</span>
        <span class="off">${icon('x-bold')} Amazon : en attente d'accès</span>
        <span class="ok">${icon('check-bold')} Recherches Kamwa</span>
        <span class="${k.ai ? 'ok' : 'off'}">${icon(k.ai ? 'check-bold' : 'x-bold')} Analyse ${k.ai ? 'IA Claude' : 'intégrée (sans IA)'}</span>
        <span class="muted">${d.settings.enabled ? `Prochain passage : ${next} h` : 'Passages automatiques arrêtés'}${last ? ` · dernier : ${date(last.at)} (${last.proposed} proposition(s))` : ''}</span>
      </div>
      ${last?.errors?.length ? `<div class="alert warn">Dernier passage : ${esc(last.errors.join(' · '))}</div>` : ''}
      ${!k.aliexpress ? `<div class="alert warn">Pour recevoir les produits tendance, saisissez vos clés AliExpress dans « Réglages de l'agent » ci-dessous (en attendant, l'agent analyse les recherches de vos clients).</div>` : ''}
      ${tabsBar(TR_TABS.map(([key, l]) => [key, l, d.proposals.filter((t) => t.status === key).length]), f, 'trf')}
      <div class="tr-grid">${list.length ? list.map(trendCard).join('') : `<p class="muted" style="padding:20px">${f === 'new' ? 'Pas de nouvelle proposition pour le moment. Elles arrivent à chaque passage de l\'agent.' : 'Rien ici.'}</p>`}</div>
      <div class="panel" style="margin-top:16px"><h2>${icon('magnifying-glass')} Ce que vos clients cherchent (7 jours)</h2>
        ${d.demand.length ? `<ul class="mini-list">${d.demand.map((x) => `<li><span>« ${esc(x.q)} »</span><span>${x.n} fois · ${x.results ? `${x.results} résultat(s)` : '<strong style="color:var(--accent)">aucun produit</strong>'}</span></li>`).join('')}</ul>` : '<p class="muted">Pas encore de recherche enregistrée.</p>'}
      </div>
      <details class="panel tr-settings"><summary><h2 style="display:inline">${icon('key-bold')} Réglages de l'agent</h2></summary>
        <form id="trKeys" autocomplete="off">
          <h3>AliExpress (programme d'affiliation, gratuit)</h3>
          <p class="muted">1. Créez un compte sur <a href="https://portals.aliexpress.com" target="_blank" rel="noopener">portals.aliexpress.com</a> (récupérez votre « Tracking ID »). 2. Sur <a href="https://openservice.aliexpress.com" target="_blank" rel="noopener">openservice.aliexpress.com</a>, créez une application « Affiliate » : vous obtenez une App Key et une App Secret.</p>
          <div class="grid2">
            <div><label>App Key</label><input name="aliAppKey" type="password" placeholder="${esc(k.aliAppKey || 'à saisir')}"></div>
            <div><label>App Secret</label><input name="aliAppSecret" type="password" placeholder="${esc(k.aliAppSecret || 'à saisir')}"></div>
            <div><label>Tracking ID</label><input name="aliTrackingId" type="password" placeholder="${esc(k.aliTrackingId || 'à saisir')}"></div>
          </div>
          <h3>IA Claude (analyse des produits)</h3>
          <p class="muted">Créez une clé sur <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> (paiement à l'usage : quelques centimes par analyse avec le modèle ${esc(k.model)}).</p>
          <div class="grid2"><div><label>Clé Anthropic</label><input name="anthropicKey" type="password" placeholder="${esc(k.anthropicKey || 'à saisir')}"></div></div>
          <p class="muted">Les clés restent sur le serveur Kamwa : elles ne sont plus jamais affichées en entier.</p>
          <div class="row"><button class="btn">Enregistrer les clés</button><button type="button" class="ghost" id="trTest">Vérifier les clés</button></div>
          <div id="trKeyMsg"></div>
        </form>
        <form id="trConf">
          <h3>Passages et recherche</h3>
          <label class="check"><input type="checkbox" id="trOn" ${d.settings.enabled ? 'checked' : ''}> Passages automatiques</label>
          <label>Heures de passage (heure du Congo)</label>
          <div class="chips">${Array.from({ length: 17 }, (_, i) => i + 6).map((h) => `<label class="chip-check"><input type="checkbox" data-h="${h}" ${d.settings.hours.includes(h) ? 'checked' : ''}> ${h} h</label>`).join('')}</div>
          <label>Produits à surveiller (un par ligne)</label>
          <textarea id="trKw" rows="6">${esc(d.settings.keywords.join('\n'))}</textarea>
          <div class="grid2">
            <div><label>Propositions par passage</label><input id="trPer" type="number" min="1" max="20" value="${d.settings.perRun}"></div>
            <div><label>Prix maximum de l'article (€)</label><input id="trMax" type="number" min="5" max="2000" value="${d.settings.maxPriceEur}"></div>
          </div>
          <button class="btn" style="margin-top:10px">Enregistrer</button>
        </form>
      </details>`;
    app.querySelectorAll('[data-trf]').forEach((b) => b.addEventListener('click', () => { state.trFilter = b.dataset.trf; viewTrends(); }));
    $('#trRun').addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = 'Analyse en cours…';
      try { const r = await api('/trends/run', { method: 'POST' }); toast(`Analyse terminée : ${r.proposed} proposition(s)`); state.trFilter = 'new'; viewTrends(); }
      catch (err) { toast(err.message); e.target.disabled = false; }
    });
    app.querySelector('.tr-grid').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-tr]'); if (!b) return;
      const t = d.proposals.find((x) => x.id === b.dataset.id);
      if (b.dataset.tr === 'integrate') {
        await api('/trends/' + enc(t.id) + '/decision', { method: 'POST', body: { status: 'integrated' } }).catch(() => {});
        // Fiche produit pré-remplie (même mécanisme que le bouton « → Kamwa »)
        const data = t.source === 'kamwa' ? { u: '', n: t.keyword, im: [], p: null, c: null, de: '' }
          : { u: t.url || '', n: t.title, b: '', de: (t.review?.reason || ''), im: [t.image, ...(t.images || [])].filter(Boolean).slice(0, 6), p: t.priceEur, c: 'EUR', co: [], si: [] };
        location.hash = '#/produit/nouveau?kamwa2=' + encodeURIComponent(JSON.stringify(data));
        return;
      }
      await api('/trends/' + enc(t.id) + '/decision', { method: 'POST', body: { status: b.dataset.tr } });
      toast(b.dataset.tr === 'kept' ? 'Gardée dans « Gardées »' : b.dataset.tr === 'ignored' ? 'Ignorée' : 'Remise dans les nouvelles');
      viewTrends();
    });
    $('#trKeys').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {}; for (const i of e.target.querySelectorAll('input')) if (i.value.trim()) body[i.name] = i.value.trim();
      try { await api('/trends/keys', { method: 'PUT', body }); toast('Clés enregistrées ✓'); viewTrends(); } catch (err) { $('#trKeyMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    $('#trTest').addEventListener('click', async () => {
      $('#trKeyMsg').innerHTML = '<p class="muted">Vérification…</p>';
      const r = await api('/trends/test', { method: 'POST' }).catch((err) => ({ err: err.message }));
      $('#trKeyMsg').innerHTML = r.err ? `<div class="alert err">${esc(r.err)}</div>` : `<div class="alert ${r.aliexpress.ok && r.ai.ok ? 'ok' : 'warn'}">AliExpress : ${r.aliexpress.ok ? 'OK ✓' : esc(r.aliexpress.error)}<br>IA Claude : ${r.ai.ok ? 'OK ✓' : esc(r.ai.error)}</div>`;
    });
    $('#trConf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { enabled: $('#trOn').checked, hours: [...app.querySelectorAll('[data-h]:checked')].map((i) => Number(i.dataset.h)), keywords: $('#trKw').value.split('\n'), perRun: Number($('#trPer').value), maxPriceEur: Number($('#trMax').value) };
      try { await api('/trends/settings', { method: 'PUT', body }); toast('Réglages enregistrés ✓'); viewTrends(); } catch (err) { toast(err.message); }
    });
  }
  function trendCard(t) {
    const v = VERDICT[t.review?.verdict] || ['', ''];
    const L = t.landed;
    return `<article class="tr-card">
      ${t.image ? `<img src="${esc(t.image)}" alt="" loading="lazy">` : `<div class="tr-noimg">${icon(t.source === 'kamwa' ? 'magnifying-glass' : 'package')}</div>`}
      <div class="tr-body">
        <div class="row between"><span class="tag">${t.source === 'aliexpress' ? 'AliExpress' : t.source === 'kamwa' ? 'Clients Kamwa' : esc(t.source)}</span><span class="tag ${v[1]}">${v[0]} · ${t.review?.score ?? '—'}/100</span></div>
        <h3>${esc(t.title)}</h3>
        ${L ? `<div class="tr-nums"><span><b>${t.priceEur != null ? String(t.priceEur).replace('.', ',') + ' €' : '—'}</b><small>prix d'achat</small></span><span><b>${fcfa(t.review?.suggestedPriceFcfa || L.priceFcfa)}</b><small>prix Kamwa${t.review?.suggestedPriceFcfa ? ' conseillé' : ' (tout compris)'}</small></span><span><b>${fcfa(L.marginFcfa)}</b><small>marge</small></span>${t.volume ? `<span><b>${Number(t.volume).toLocaleString('fr-FR')}</b><small>ventes récentes</small></span>` : ''}${t.rating ? `<span><b>${t.rating} %</b><small>avis positifs</small></span>` : ''}</div>` : `<p class="muted">${t.searches} recherche(s) cette semaine, aucun produit.</p>`}
        <p class="tr-why">${icon('magic-wand-duotone')} ${esc(t.review?.reason || '')} <span class="muted">(${esc(t.review?.by || '')})</span></p>
        ${(t.review?.risks || []).length ? `<p class="muted">Attention : ${t.review.risks.map(esc).join(' · ')}</p>` : ''}
        <div class="row">
          ${t.status !== 'integrated' ? `<button class="btn small" data-tr="integrate" data-id="${esc(t.id)}">${icon('plus-bold')} ${t.source === 'kamwa' ? 'Créer la fiche' : 'Intégrer'}</button>` : ''}
          ${t.status !== 'kept' ? `<button class="ghost" data-tr="kept" data-id="${esc(t.id)}">Garder</button>` : ''}
          ${t.status !== 'ignored' ? `<button class="ghost" data-tr="ignored" data-id="${esc(t.id)}">Ignorer</button>` : `<button class="ghost" data-tr="new" data-id="${esc(t.id)}">Remettre</button>`}
          ${t.url ? `<a class="ghost" href="${esc(t.url)}" target="_blank" rel="noopener">${icon('arrow-square-out-bold')} Voir</a>` : ''}
        </div>
      </div>
    </article>`;
  }

  // ---------- Rafraîchissement instantané (signal du serveur) ----------
  // Le serveur signale chaque changement qui concerne ce rôle ; la page affichée se redessine tout de suite,
  // à la même position, sauf pendant une saisie (elle se met alors à jour dès que la saisie est terminée).
  const LIVE_TOPICS = {
    tableau: ['orders', 'products', 'customers', 'chat', 'imports', 'finance'], commandes: ['orders'], commande: ['orders', 'documents'], documents: ['documents'], clients: ['customers'],
    france: ['imports', 'orders'], envois: ['imports', 'orders'], agent: ['imports', 'orders'], livraisons: ['orders'], fournisseur: ['orders', 'products'],
    produits: ['products'], agences: ['agencies'], tendances: ['trends'], journal: ['orders', 'products', 'customers', 'staff', 'finance'], finances: ['finance', 'orders'], equipe: ['staff'],
  };
  const NO_LIVE_WITH_ID = ['produit', 'agences', 'equipe', 'finances', 'reglages', 'mot-de-passe'];
  const proBusy = () => {
    const a = document.activeElement;
    if (a && app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !['checkbox', 'radio'].includes(a.type)) return true;
    if ($('#idBox')?.innerHTML || $('#codeBox')?.innerHTML) return true; // fiche de vérification ou code affiché
    if (app.querySelector('form:not(.msg-reply) [data-dirty]')) return true;
    return [...app.querySelectorAll('form:not(.msg-reply) input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), form:not(.msg-reply) textarea')].some((i) => i.value !== i.defaultValue);
  };
  let liveQueue = new Set(); let liveTimer = null; let liveWaiting = false;
  async function applyLive() {
    liveTimer = null;
    const topics = liveQueue; liveQueue = new Set();
    if (topics.has('orders') && CAN.orders()) { try { await loadOrders(); } catch {} }
    if (topics.has('products') && CAN.products()) { try { await loadProducts(); } catch {} }
    if (topics.has('chat') || topics.has('team')) loadChatCounts();
    let [page, id] = (location.hash || homeHash()).slice(2).split('/').map(decodeURIComponent);
    if (page === 'messagerie') { if (topics.has('chat') || topics.has('team')) refreshMessaging(id); return; }
    const want = LIVE_TOPICS[page] || [];
    if (!want.some((t) => topics.has(t))) return;
    if (id && NO_LIVE_WITH_ID.includes(page)) return;
    if (page === 'produit') return;
    if (proBusy()) { liveWaiting = true; want.forEach((t) => topics.has(t) && liveQueue.add(t)); return; }
    route({ keep: true });
  }
  document.addEventListener('focusout', () => { if (liveWaiting) setTimeout(() => { if (!proBusy()) { liveWaiting = false; route({ keep: true }); } }, 300); });
  let proEs = null;
  function connectProEvents() {
    if (proEs || !('EventSource' in window) || !state.user) return;
    proEs = new EventSource('/api/admin/events');
    proEs.addEventListener('change', (e) => {
      let t = {}; try { t = JSON.parse(e.data); } catch {}
      if (!t.topic) return;
      liveQueue.add(t.topic);
      if (!liveTimer) liveTimer = setTimeout(applyLive, 150);
    });
    proEs.onerror = () => { if (proEs.readyState === EventSource.CLOSED) { proEs = null; setTimeout(connectProEvents, 3000); } };
  }
  function refreshMessaging(id) {
    if (id === 'equipe') return openTeam(true);
    if (id) openConv(id, true);
    // liste des conversations à gauche
    api('/chat/conversations').then(() => { if (!$('#msgText')?.value && !id) viewMessaging(id); }).catch(() => {});
  }

  function route(opts = {}) {
    clearInterval(state.msgTimer);
    let [page, id] = (location.hash || homeHash()).slice(2).split('/').map(decodeURIComponent);
    if (id && id.includes('?') && page !== 'finances') id = id.split('?')[0]; // ex. #/produit/nouveau?kamwa=… (bouton « → Kamwa »)
    const keepY = opts.keep ? window.scrollY : 0;
    if (opts.keep) [0, 150, 450].forEach((ms) => setTimeout(() => { if (Math.abs(window.scrollY - keepY) > 2) window.scrollTo(0, keepY); }, ms)); // les pages se chargent en un instant : on garde la position
    else window.scrollTo(0, 0);
    // Pages autorisées selon le rôle ; sinon retour à l'accueil du rôle
    document.body.classList.remove('menu-open');
    charts.splice(0).forEach((c) => c.destroy());
    const allowed = {
      tableau: () => Boolean(state.user),
      commandes: CAN.orders, commande: CAN.orders, produits: CAN.products, produit: CAN.products,
      messagerie: () => Boolean(state.user) && !CAN.supplier(),
      tendances: CAN.admin, documents: CAN.orders,
      fournisseur: CAN.supplier, clients: CAN.admin, agences: CAN.admin, equipe: CAN.admin, journal: CAN.admin, finances: CAN.admin, reglages: CAN.admin, livraisons: CAN.courier, france: CAN.orders, envois: () => CAN.orders() || CAN.agent(), agent: () => CAN.agent() || CAN.admin(), 'mot-de-passe': () => !CAN.admin(),
    };
    if (!allowed[page]?.()) [page, id] = homeHash().slice(2).split('/');
    const tab = page.startsWith('produit') ? 'produits' : page === 'commande' ? 'commandes' : page;
    document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    if (page === 'messagerie') return viewMessaging(id);
    if (page === 'tendances') return viewTrends();
    if (page === 'documents') return viewDocuments();
    if (page === 'clients') return viewCustomers();
    if (page === 'agences') return viewAgencies(id);
    if (page === 'equipe') return viewStaff(id);
    if (page === 'journal') return viewActivity();
    if (page === 'finances') return viewFinances(id);
    if (page === 'livraisons') return viewDeliveries();
    if (page === 'reglages') return viewSettings();
    if (page === 'france') return viewFrance(id);
    if (page === 'envois') return viewShipments();
    if (page === 'agent') return viewAgent();
    if (page === 'fournisseur') return viewSupplierOrders();
    if (page === 'mot-de-passe') return viewPassword();
    if (page === 'commande') return viewOrder(id);
    if (page === 'produits') return viewProducts();
    if (page === 'produit') return viewProduct(id);
    if (page === 'commandes') return viewOrders();
    return viewDashboard();
  }

  async function start() {
    app.innerHTML = '<p class="empty">Chargement…</p>';
    state.user = (await api('/me')).user;
    await Promise.all([CAN.orders() ? loadOrders() : null, CAN.products() ? loadProducts() : null]);
    loadChatCounts();
    connectProEvents();
    // Onglets et boutons selon le rôle
    document.querySelectorAll('[data-roles]').forEach((el) => { el.hidden = !el.dataset.roles.split(' ').includes(state.user.role); });
    const prodLabel = document.querySelector('[data-tab="produits"] .lbl');
    if (prodLabel) prodLabel.textContent = CAN.supplier() ? 'Mes produits' : 'Produits';
    document.body.classList.add('logged');
    $('#whoami').textContent = state.user.name + (state.user.company ? ` · ${state.user.company}` : '');
    $('#top').hidden = false;
    renderSoundBtn();
    if (state.user.mustChangePassword) location.hash = '#/mot-de-passe';
    route();
  }

  window.addEventListener('hashchange', async () => {
    if ($('#top').hidden) return;
    // Données fraîches à chaque changement de page
    try {
      if (location.hash.startsWith('#/produit') && CAN.products()) await loadProducts();
      else if (location.hash.startsWith('#/commande') && CAN.orders()) await loadOrders();
    } catch { return; }
    route();
  });

  (async () => {
    try {
      const me = await api('/me');
      state.demoAccounts = me.demoAccounts || [];
      if (!me.loggedIn) return showLogin(me.passwordSet ? '' : "Le mot de passe n'est pas encore créé. Dans le Terminal : npm run admin:password");
      // Déjà connecté : le son ne pourra démarrer qu'après un clic (règle des navigateurs)
      if (soundWanted()) document.addEventListener('click', () => enableSound(true), { once: true });
      await start();
    } catch {
      app.innerHTML = '<p class="empty">Connexion impossible. Vérifiez votre réseau.</p>';
    }
  })();
})();
