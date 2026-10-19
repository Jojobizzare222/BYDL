// Zado — espace admin (aucune dépendance). Routes : #/commandes, #/commande/<id>, #/produits, #/produit/<id|nouveau>
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
  const ICONS = { 'Téléphones': 'device-mobile-duotone', 'Tablettes': 'device-tablet-duotone', 'Ordinateurs': 'laptop-duotone', 'Montres': 'watch-duotone', 'Audio': 'headphones-duotone', 'TV & Maison': 'television-duotone', 'Jeux vidéo & consoles': 'game-controller-duotone', 'Composants': 'cpu-duotone', 'Accessoires': 'plug-duotone', 'Homme': 't-shirt-duotone', 'Femme': 'dress-duotone', 'Chaussures': 'sneaker-duotone' };
  const catIcon = (cat) => icon(ICONS[cat] || 'shopping-bag-duotone');

  const state = { user: null, orders: [], labels: {}, transitions: {}, products: [], universes: [], suppliers: [], orderFilter: 'paid', productQuery: '', productFilter: 'all', seenPaid: null };
  // Ce que chaque rôle peut ouvrir (le serveur vérifie aussi, de son côté)
  const CAN = {
    orders: () => ['admin', 'orders'].includes(state.user?.role),
    products: () => ['admin', 'catalog', 'supplier'].includes(state.user?.role),
    supplier: () => state.user?.role === 'supplier',
    admin: () => state.user?.role === 'admin',
    courier: () => state.user?.role === 'courier',
    desk: () => ['admin', 'orders', 'catalog'].includes(state.user?.role), // échanges avec les fournisseurs
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
    const err = /^❌ /.test(msg); // erreurs : icône + couleur au lieu d'un émoji
    t.classList.toggle('err', err);
    t.innerHTML = err ? `${icon('warning-duotone')} ${esc(msg.slice(2))}` : esc(msg);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  // Rangées d'onglets / pastilles qui défilent : fondu à droite tant qu'il reste quelque chose à voir (audit 17/10/2026)
  const SCROLLERS = '.tabbar, .pills, .chips';
  const markScroll = (el) => el.classList.toggle('scroll-more', el.scrollWidth > el.clientWidth + 4 && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  const markScrollers = () => document.querySelectorAll(SCROLLERS).forEach(markScroll);
  document.addEventListener('scroll', (e) => { if (e.target.matches?.(SCROLLERS)) markScroll(e.target); }, true);
  addEventListener('resize', markScrollers);
  new MutationObserver(() => requestAnimationFrame(markScrollers)).observe(document.getElementById('app'), { childList: true });
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
  const PALETTE = ['#FFB300', '#2D66D6', '#FF6B4F', '#2BC48A', '#14B8A6', '#94A3B8'] // mangue, bleu Zado Pro, corail, vert, bleu-vert, ardoise;
  // Couleurs des graphiques selon l'apparence (recalculées à chaque affichage du tableau de bord)
  function chartTheme() {
    if (!window.Chart) return;
    const lightTheme = document.documentElement.getAttribute('data-theme') === 'light';
    Chart.defaults.color = lightTheme ? '#657185' : '#9FABBF';
    Chart.defaults.borderColor = lightTheme ? 'rgba(21,31,48,.08)' : 'rgba(255,255,255,.08)';
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
  // Chart.js (200 Ko) n'est chargé qu'au premier graphique affiché (tableau de bord, finances) : ouverture plus rapide de Zado Pro
  let chartLib = null;
  const loadChart = () => chartLib || (chartLib = new Promise((resolve, reject) => {
    const sc = document.createElement('script'); sc.src = '/admin/vendor/chart.umd.min.js';
    sc.onload = () => { chartTheme(); resolve(); }; sc.onerror = () => { chartLib = null; reject(new Error('Graphiques indisponibles')); };
    document.head.appendChild(sc);
  }));
  function makeChart(id, config) {
    const draw = () => {
      const el = document.getElementById(id);
      if (el && window.Chart) charts.push(new Chart(el, { ...config, options: { responsive: true, maintainAspectRatio: false, ...config.options } }));
    };
    if (window.Chart) draw(); else loadChart().then(draw).catch(() => {});
  }
  const doughnut = (id, list) => makeChart(id, {
    type: 'doughnut',
    data: { labels: list.map((x) => x.label), datasets: [{ data: list.map((x) => x.value), backgroundColor: PALETTE, borderColor: '#1D232D', borderWidth: 3 }] },
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
    // Liste « À faire » unique, même formulation partout : nombre + action (audit 17/10/2026)
    const T = d.todo || {};
    const todo = [
      [T.refunds, 'danger', 'warning-duotone', 'commande(s) à rembourser', '#/commandes', 'paid'],
      [T.toCall, 'warn', 'phone-bold', 'client(s) à appeler avant la livraison', '#/commandes', 'call'],
      [T.toCollect, 'warn', 'storefront-duotone', 'paiement(s) à encaisser au point relais', '#/commandes', 'collect'],
      [T.toPlan, '', 'truck-duotone', 'livraison(s) à planifier', '#/calendrier'],
      [T.todayDeliveries, '', 'clock-bold', 'livraison(s) prévue(s) aujourd\'hui', '#/calendrier'],
      [T.toShip, '', 'package-duotone', 'commande(s) à préparer et à remettre', '#/commandes', 'paid'],
      [T.messages, 'warn', 'chat-circle-dots-duotone', 'client(s) attendent une réponse', '#/messagerie'],
      [T.supplierReady, '', 'storefront', 'commande(s) : articles prêts chez un fournisseur, à récupérer', '#/commandes', 'paid'],
      [T.supplierMessages, 'warn', 'chats-circle-duotone', 'fournisseur(s) vous ont écrit', '#/messagerie'],
      [T.idToCheck, 'warn', 'identification-card', 'pièce(s) d\'identité à vérifier', '#/clients'],
      [d.pendingProducts, 'warn', 'clock-countdown-duotone', 'produit(s) à valider', '#/produits', null, 'pending'],
    ].filter((x) => x[0]).map(([n, cls, ico, label, href, f, pf]) => `<a class="todo-row ${cls}" href="${href}"${f ? ` data-f="${f}"` : ''}${pf ? ` data-pf="${pf}"` : ''}><span class="todo-ico">${icon(ico)}</span><b>${n}</b><span>${label}</span>${icon('caret-right', 'todo-go')}</a>`);

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
    if (CAN.products()) quick.push(`<a class="btn" href="#/produit/nouveau">${icon('plus-bold')} Ajouter un produit</a>`);
    if (CAN.admin() || state.user?.role === 'catalog') quick.push(`<a class="ghost" href="#/achats">${icon('clipboard-text')} Achats fournisseurs</a>`);
    if (CAN.supplier()) quick.push(`<a class="ghost" href="#/bons-de-commande">${icon('clipboard-text')} Bons de commande</a>`);
    if (CAN.orders()) quick.push(`<a class="ghost" href="#/commandes">${icon('receipt-duotone')} Commandes</a>`);
    if (CAN.orders()) quick.push(`<a class="ghost" href="#/colis">${icon('package')} Colis</a>`);
    if (CAN.supplier()) quick.push(`<a class="ghost" href="#/fournisseur">${icon('receipt-duotone')} Mes commandes</a>`);
    if (CAN.courier()) quick.push(`<a class="btn" href="#/livraisons">${icon('truck-duotone')} Mes livraisons</a>`);
    if (CAN.courier()) quick.push(`<a class="ghost" href="#/scanner">${icon('camera-bold')} Scanner un colis</a>`);
    const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    app.innerHTML = `
      <section class="dash-top">
        <div>
          <p class="hero-date">${esc(today.charAt(0).toUpperCase() + today.slice(1))}</p>
          <h1>Bonjour ${esc(who)}</h1>
          <p class="muted">${d.role === 'catalog' ? 'Voici où en est le catalogue.' : `Voici l'activité des ${days} derniers jours.`}</p>
        </div>
        ${period || ''}
      </section>
      <div class="quick">${quick.join('')}</div>`
      + `<div class="kpis">${d.kpis.map((k, i) => `<div class="kpi kc${i % 4}"><span class="kpi-ico">${icon(k.icon)}</span><span class="kpi-label">${esc(k.label)}</span><span class="kpi-value">${k.format === 'fcfa' ? fcfa(k.value) : new Intl.NumberFormat('fr-FR').format(k.value)}</span>${k.hint ? `<span class="kpi-hint">${esc(k.hint)}</span>` : ''}</div>`).join('')}</div>`
      + (d.todo || d.pendingProducts ? `<section class="todo-list"><h2>${icon('list-bullets-duotone')} À faire</h2>${todo.length ? todo.join('') : `<p class="muted">${icon('check-circle-duotone')} Rien en attente. Tout est à jour.</p>`}</section>` : '')
      + `<div class="dash-grid">${cards.join('')}</div>`;

    app.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { state.days = Number(b.dataset.days); route(); }));
    app.querySelectorAll('.todo-list [data-f]').forEach((a) => a.addEventListener('click', () => { state.orderFilter = a.dataset.f; }));
    app.querySelectorAll('.todo-list [data-pf]').forEach((a) => a.addEventListener('click', () => { state.productFilter = a.dataset.pf; }));

    if (d.series) {
      const money = (lbl) => /FCFA/.test(lbl);
      makeChart('cMain', {
        data: {
          labels: d.labels.map(dayLabel),
          datasets: d.series.map((x, i) => ({
            type: x.type, label: x.label, data: x.data, yAxisID: x.axis === 'y2' ? 'y2' : 'y', order: x.type === 'line' ? 0 : 1,
            backgroundColor: x.type === 'bar' ? 'rgba(45,102,214,.55)' : 'rgba(255,179,0,.15)', borderColor: x.type === 'bar' ? 'transparent' : PALETTE[0],
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
        <span class="logo"><img src="/brand/logo-zado-clair.svg?v=6" alt="Zado" width="141" height="44"></span>
        <h1>Espace Zado</h1>
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
    document.title = 'Zado Pro';
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
        toast(`Nouvelle commande payée : ${fresh[0].customer.name}, ${fcfa(fresh[0].total)}`);
      }
    }
    state.seenPaid = new Set(paidIds);
    const todo = state.orders.filter((o) => ['paid', 'confirmed'].includes(o.status) || o.paidAfterCancel).length;
    for (const el of [$('#todoCount'), $('#todoCountMobile')]) { el.hidden = !todo; el.textContent = todo; }
    document.title = todo ? `(${todo}) Zado Pro` : 'Zado Pro';
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
  const toCall = (o) => !isPickup(o) && ['paid', 'confirmed'].includes(o.status) && !o.callConfirmedAt;
  const PAY_LABELS = { mtn: 'MTN MoMo', airtel: 'Airtel Money', card: 'Carte bancaire', cash: 'Espèces en agence' };
  const PAY_STATUS = { PENDING: 'en attente', SUCCESSFUL: 'réussi', FAILED: 'échoué', CANCELLED: 'remplacé' };
  const FILTERS = [
    ['paid', 'À livrer / remettre'],
    ['call', 'À appeler'],
    ['collect', 'À encaisser en agence'],
    ['shipped', 'En livraison'],
    ['delivered', 'Livrées'],
    ['cancelled', 'Annulées'],
    ['pending_payment', 'Non payées'],
    ['all', 'Toutes'],
  ];
  const badge = (status) => `<span class="badge st-${status}">${esc(state.labels[status] || status)}</span>`;

  function viewOrders() {
    const f = state.orderFilter;
    const matches = (o, k) => k === 'all' || (k === 'collect' ? toCollect(o) : k === 'call' ? toCall(o) : o.status === k) || (k === 'paid' && (o.paidAfterCancel || o.status === 'confirmed'));
    const list = state.orders.filter((o) => matches(o, f));
    const qty = (o) => o.lines.reduce((s, l) => s + l.qty, 0);
    app.innerHTML = pageHead({ title: 'Commandes', desc: 'Suivez chaque commande, du paiement à la livraison. Cliquez sur une ligne pour la gérer.', actions: exportBtn('orders') })
      + tabsBar(FILTERS.map(([k, label]) => [k, label, state.orders.filter((o) => matches(o, k)).length]), f, 'filter')
      + (f === 'pending_payment' ? '<p class="muted">Commandes commencées mais pas payées (paiement refusé, abandonné, en cours, ou réservation en agence). Rien à expédier.</p>' : '')
      + (f === 'call' ? '<p class="muted">Commandes payées à livrer : appelez le client pour confirmer l\'adresse et le créneau avant de les confier à un livreur.</p>' : '')
      + (f === 'collect' ? '<p class="muted">Réservations en cours : le client vient payer en espèces à l\'agence. Préparez les articles.</p>' : '')
      + '<div id="tbl"></div>';
    dataTable($('#tbl'), {
      id: 'orders', rows: list, defaultSort: 'createdAt', rowHref: (o) => '#/commande/' + enc(o.id),
      placeholder: 'N° de commande, client, téléphone ou ville', empty: 'Aucune commande ici.',
      searchText: (o) => `${o.id} ${o.customer.name} ${o.customer.phone} ${o.customer.city}`,
      columns: [
        { key: 'id', label: 'Commande', render: (o) => `<strong class="mono">${esc(o.id)}</strong>${o.paidAfterCancel ? '<br><span class="tag danger">À rembourser</span>' : ''}${isPickup(o) ? `<br><span class="tag">Retrait ${esc(o.agency?.name || '')}</span>` : o.agency ? `<br><span class="tag">Payé à ${esc(o.agency.name || 'l\'agence')} · livré</span>` : ''}${o.paymentPlan === 'cod' ? `<br><span class="tag warn">À la réception</span>` : ''}${!isPickup(o) && ['paid', 'confirmed'].includes(o.status) && !o.callConfirmedAt ? ' <span class="tag danger">À appeler</span>' : ''}${o.courierName && o.status === 'shipped' ? `<br><span class="muted">${icon('truck-duotone')} ${esc(o.courierName)}</span>` : ''}` },
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
    shipped: ['Revenir à « en livraison »', 'ghost'],
    confirmed: ['Revenir à « à livrer »', 'ghost'],
    delivered: ['Marquer livrée ✓', 'btn green'],
    handed: ['Remise au client ✓', 'btn green'],
    paid: ['Revenir à « Payée »', 'ghost'],
    cancelled: ['Annuler la commande', 'ghost'],
  };

  // Prochaine étape d'une commande, en une phrase (audit 17/10/2026) : [texte, détail, élément à atteindre, style]
  function nextStep(o) {
    const late = o.pickupDeadline && Date.now() > Date.parse(o.pickupDeadline);
    if (o.paidAfterCancel) return ['Rembourser le client', 'Il a payé alors que la commande était annulée : remboursez-le puis notez-le.', '#note', 'danger'];
    if (o.status === 'cancelled') return ['Commande annulée', o.cancelReason || 'Rien à faire.', null, 'done'];
    if (o.status === 'delivered') return [isPickup(o) ? 'Commande remise au client' : 'Commande livrée', 'Terminé. La facture et le reçu sont dans « Documents ».', null, 'done'];
    if (o.status === 'pending_payment') {
      if (paysAtAgency(o)) return late
        ? ['Délai de paiement dépassé', `Appelez ${o.customer.name} : s'il vient encore, encaissez ; sinon annulez la commande.`, '#cashBtn', 'warn']
        : [`Encaisser ${fcfa(o.total)} en espèces à ${o.agency?.name || 'l\'agence'}`, `Quand ${o.customer.name} paie, cliquez « Paiement reçu en agence ».${isPickup(o) ? ' Préparez déjà les articles.' : ''}`, '#cashBtn', ''];
      return ['En attente du paiement du client', 'Rien à faire pour l\'instant. Sans paiement, la commande s\'annule toute seule.', null, 'wait'];
    }
    if (o.status === 'shipped') return [`En livraison${o.courierName ? ' avec ' + o.courierName : ''}`, 'Le livreur valide la remise avec le code du client. En cas de problème : « Livraison ratée ».', null, 'wait'];
    const waitingSupplier = [...new Set((o.lines || []).map((l) => l.supplierId).filter(Boolean))].some((sid) => !o.supplierReady?.[sid]);
    if (waitingSupplier && ['paid', 'confirmed'].includes(o.status)) return ['Attendre le fournisseur', 'Il prépare ses articles et cliquera « Prêt à récupérer » ; vous serez prévenu dans la Messagerie.', null, 'wait'];
    if (isPickup(o)) return ['Remettre les articles au client', `Au point relais ${o.agency?.name || ''}, contre son code de retrait à 4 chiffres.`, '[data-status="delivered"]', ''];
    if (!o.callConfirmedAt) return ['Appeler le client', `Confirmez l'adresse et le créneau avec ${o.customer.name} (${o.customer.phone}).`, '#callOk', ''];
    if (!o.planned) return ['Planifier la livraison', 'Choisissez la date et le créneau.', '#planBox', ''];
    return ['Confier le colis à un livreur', `Livraison prévue le ${frDate(o.planned.date)}. Choisissez le livreur puis « Confier au livreur ».`, '#courierSel', ''];
  }
  const nextStepBox = (o) => {
    const [t, d, target, cls] = nextStep(o);
    return `<div class="next-step ${cls}"><span class="ns-ico">${icon(cls === 'done' ? 'check-circle-duotone' : cls === 'wait' ? 'clock-bold' : cls === 'danger' ? 'warning-duotone' : 'arrow-right-bold')}</span><div><small>${cls === 'done' ? 'État' : 'Prochaine étape'}</small><strong>${esc(t)}</strong><span>${esc(d)}</span></div>${target ? `<button class="btn small" data-goto='${esc(target)}'>Y aller</button>` : ''}</div>`;
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
      ${nextStepBox(o)}

      <div class="panel">
        <h2>Articles</h2>
        <div class="lines">
          ${o.lines.map((l) => `<div><span>${l.qty} × ${esc(l.name)}</span><span>${fcfa(l.total)}</span></div>`).join('')}
          ${o.deliveryFee ? `<div><span>Livraison${o.customer.zone ? ` (${esc(o.customer.zone)})` : ''}</span><span>${fcfa(o.deliveryFee)}</span></div>` : ''}
          <div><span>Total</span><span>${fcfa(o.total)}</span></div>
        </div>
        ${Object.values(o.supplierReady || {}).map((r) => `<p class="supplier-ready">${icon('storefront')} <span><strong>${esc(r.by)}</strong> : articles prêts à récupérer depuis le ${date(r.at)}${r.note ? `<br><span class="muted">${esc(r.note)}</span>` : ''}</span></p>`).join('')}
      </div>
      ${CAN.orders() ? parcelsPanel(o) : ''}
      ${CAN.orders() ? docsPanel(o) : ''}

      <div class="panel">
        <h2>Client</h2>
        <p style="margin:0 0 4px"><strong>${esc(c.name)}</strong>${vb(o.account?.idStatus)} · ${esc(c.phone)}</p>
        <p class="muted" style="margin:0 0 10px">${esc(c.city || '—')} · ${esc(c.address || 'pas d\'adresse')}</p>
        <div class="row">
          <a class="btn dark" href="tel:+${intl}">${icon('phone-bold')} Appeler</a>
          <a class="btn green" href="https://wa.me/${intl}" target="_blank" rel="noopener">WhatsApp</a>
          <button class="ghost" id="editCustomer">Modifier</button>
        </div>
        ${o.account ? `<p class="muted" style="margin:10px 0 0">${icon('user-circle')} Compte client ${esc(o.account.id)}${o.account.email ? ' · ' + esc(o.account.email) : ''} <button class="ghost" id="newCodeBtn" style="min-height:32px;padding:4px 10px">Nouveau code</button></p><div id="newCodeBox"></div>` : '<p class="muted" style="margin:10px 0 0">Commande passée sans compte client.</p>'}
        <form id="customerForm" hidden>
          <label for="cName">Nom</label><input id="cName" type="text" value="${esc(c.name)}">
          <label for="cPhone">Téléphone</label><input id="cPhone" type="tel" value="${esc(c.phone)}">
          <label for="cCity">Ville</label><input id="cCity" type="text" value="${esc(c.city)}">
          <label for="cAddress">Quartier / adresse / repère</label><textarea id="cAddress" rows="2">${esc(c.address)}</textarea>
          <button class="btn" style="margin-top:12px">Enregistrer</button>
        </form>
      </div>

      ${deliveryPanel(o)}

      <div class="panel">
        <h2>Suivi</h2>
        ${!isPickup(o) && o.agency ? `<p style="margin:0 0 10px"><span class="tag">${icon('storefront')} Paiement en agence puis livraison</span> <strong>${esc(o.agency.name)}</strong> (${esc(o.agency.city)})${o.status === 'pending_payment' && o.pickupDeadline ? `<br><span class="muted">À payer avant le ${date(o.pickupDeadline)}${Date.now() > Date.parse(o.pickupDeadline) ? ' — <strong style="color:var(--err)">délai dépassé</strong>' : ''}</span>` : ''}</p>` : ''}
        ${isPickup(o) ? `<p style="margin:0 0 10px"><span class="tag">${icon('storefront')} Retrait en agence</span> <strong>${esc(o.agency?.name)}</strong> (${esc(o.agency?.city)})${o.status === 'pending_payment' && o.pickupDeadline ? `<br><span class="muted">Réservé jusqu'au ${date(o.pickupDeadline)}${Date.now() > Date.parse(o.pickupDeadline) ? ' — <strong style="color:var(--err)">délai dépassé</strong>' : ''}</span>` : ''}</p>` : ''}
        <div class="row">
          ${paysAtAgency(o) ? `<button class="btn green" id="cashBtn">${icon('money-duotone')} Paiement reçu en agence (${fcfa(o.total)})</button>` : ''}
          ${(o.transitions || []).filter((s) => !(s === 'shipped' && o.status !== 'delivered')).map((s) => { // mise en livraison : « Confier au livreur » (bloc Livraison)
            const [label, cls] = ACTIONS[isPickup(o) && s === 'delivered' ? 'handed' : s];
            return `<button class="${cls}" data-status="${s}">${label}</button>`;
          }).join('') || '<span class="muted">Aucune action possible ici.</span>'}
        </div>
        <div id="handoverBox" hidden>
          <form class="deliver-form" id="handoverForm" style="max-width:360px">
            <label for="hCode">Code de retrait donné par le client</label><input id="hCode" class="code-input-pro" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="off">
            ${CAN.admin() ? '<label class="check"><input type="checkbox" id="hForce"> Remettre sans code (client vérifié autrement)</label>' : ''}
            <div class="row"><button class="btn green">${icon('check-bold')} Valider la remise</button><button type="button" class="ghost" id="hCancel">Annuler</button></div>
          </form>
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
      if (s === 'delivered' && isPickup(o)) { $('#handoverBox').hidden = false; $('#hCode').focus(); return; } // code du client obligatoire
      if (s === 'cancelled') {
        const msg = o.status === 'pending_payment'
          ? 'Annuler cette commande non payée ?'
          : 'Annuler cette commande ?\n\nLes articles reviendront en stock.\nLe client a payé : pensez à le rembourser via Mobile Money.';
        if (!confirm(msg)) return;
      }
      save({ status: s }, `Commande : ${state.labels[s]}`);
    }));
    app.querySelector('[data-goto]')?.addEventListener('click', (e) => {
      const el = app.querySelector(e.currentTarget.dataset.goto);
      if (!el) return;
      el.closest('details')?.setAttribute('open', '');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
      if (el.matches('select, input, textarea')) el.focus({ preventScroll: true });
    });
    $('#hCancel')?.addEventListener('click', () => { $('#handoverBox').hidden = true; });
    $('#handoverForm')?.addEventListener('submit', (e) => { e.preventDefault(); save({ status: 'delivered', code: $('#hCode').value.trim(), force: Boolean($('#hForce')?.checked) }, 'Commande remise au client ✓'); });
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
          <label>Date de livraison${o.planned ? ` — <span class="tag ok">prévue le ${frDate(o.planned.date)}, ${esc(SLOT_SHORT[o.planned.slot] || '').toLowerCase()}</span>` : ' <span class="tag warn">à planifier</span>'}</label>
          <div id="planBox">${planForm(o, [], { withCourier: false })}</div>
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
      bindPlanForms($('#planBox'), () => route({ keep: true }));
      $('#assignBtn').addEventListener('click', () => {
        const id = $('#courierSel').value;
        if (!id) return toast('Choisissez un livreur (Équipe → Ajouter → Livreur)');
        if (!o.callConfirmedAt && !confirm("Le client n'a pas encore été joint par téléphone. Envoyer quand même le livreur ?")) return;
        post('/assign', { courierId: id }, 'Commande confiée au livreur');
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
  // Position envoyée toutes les 5 s (15 s à l'arrêt), seulement quand il a une livraison en cours ; écran gardé allumé
  // (sinon le téléphone met la page en pause). Reprend tout seul à la réouverture de Zado Pro.
  const share = { watch: null, last: 0, lastSent: null, lock: null, error: '' };
  // Partage automatique dès qu'il a une livraison en cours, sauf s'il l'a arrêté lui-même (comme l'application chauffeur de Grab)
  const shareWanted = () => { try { return localStorage.getItem('kamwa-share-pos') !== '0'; } catch { return true; } };
  async function keepAwake() { try { share.lock = await navigator.wakeLock?.request('screen'); } catch {} }
  function startSharing() {
    if (share.watch !== null || !navigator.geolocation) return;
    try { localStorage.setItem('kamwa-share-pos', '1'); } catch {}
    keepAwake();
    share.watch = navigator.geolocation.watchPosition(async (p) => {
      // Toutes les 5 s quand il roule, toutes les 15 s à l'arrêt : le client le voit avancer sans vider la batterie ni le forfait
      const moved = share.pos ? kamwaMap.distanceKm(share.pos, { lat: p.coords.latitude, lng: p.coords.longitude }) > 0.008 : true;
      if (Date.now() - share.last < (moved ? 5000 : 15000)) return;
      share.last = Date.now(); share.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
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
        <span class="muted">${on ? (share.error ? esc(share.error) : share.lastSent ? `Position partagée à ${share.lastSent.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. Gardez Zado Pro ouvert pendant la tournée.` : 'Recherche de votre position…') : 'Vos clients vous voient arriver sur leur carte. Seulement pendant vos livraisons en cours.'}</span></div>
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
        ${x.planned ? `<p class="plan-when ${x.planned.date < today() ? 'late' : x.planned.date === today() ? 'now' : ''}">${icon('clock-bold')} ${x.planned.date === today() ? "Aujourd'hui" : frDate(x.planned.date)} · ${esc(x.planned.label)}</p>` : ''}
        <h3>${esc(x.customer.name)}</h3>
        <p class="deliv-addr">${icon('map-pin-duotone')} ${esc(x.customer.city || '')} · ${esc(x.customer.address || '')}${x.customer.location
          ? `<br><a href="${kamwaMap.directions(x.customer.location)}" target="_blank" rel="noopener">${icon('arrow-square-out-bold')} Itinéraire jusqu'au point placé par le client</a>`
          : x.customer.address ? `<br><a href="https://www.google.com/maps/search/?api=1&query=${enc(`${x.customer.address}, ${x.customer.city || ''}, Congo`)}" target="_blank" rel="noopener">${icon('arrow-square-out-bold')} Chercher l'adresse sur la carte</a> <span class="muted">(adresse écrite : à confirmer en appelant)</span>` : ''}</p>
        <p class="muted">${x.lines.map((l) => `${l.qty} × ${esc(l.name)}`).join('<br>')}</p>
        ${x.attempts ? `<p class="muted">${x.attempts} tentative(s) déjà ratée(s)</p>` : ''}
        <div class="row">
          <a class="btn dark" href="tel:${esc(x.customer.phone)}">${icon('phone-bold')} Appeler</a>
          <a class="btn green" href="https://wa.me/${esc(intl)}" target="_blank" rel="noopener">WhatsApp</a>
        </div>
        <div class="row" style="margin-top:10px">
          <a class="btn dark" href="#/scanner" data-expect="${esc(x.id)}">${icon('camera-bold')} Scanner le colis</a>
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
    const sm = d.summary || {};
    const daySummary = `<div class="day-sum">
        <div><b>${sm.toDo || 0}</b><span>à livrer aujourd'hui</span></div>
        <div class="ok"><b>${sm.delivered || 0}</b><span>livrée(s)</span></div>
        <div class="${sm.failed ? 'ko' : ''}"><b>${sm.failed || 0}</b><span>ratée(s)</span></div>
        <div><b>${fcfa((sm.cash || 0) + (sm.momo || 0))}</b><span>encaissé aujourd'hui${sm.momo ? ` · dont ${fcfa(sm.momo)} Mobile Money` : ''}</span></div>
      </div>${sm.later ? `<p class="muted" style="margin:-4px 0 12px">${sm.later} autre(s) livraison(s) prévue(s) les jours suivants.</p>` : ''}`;
    app.innerHTML = pageHead({ title: 'Mes livraisons', desc: 'Appelez le client avant de partir. Remettez le colis, puis demandez-lui son code de livraison à 4 chiffres : sans ce code, la livraison ne peut pas être validée.' })
      + daySummary
      + (d.cashHeld ? `<div class="alert warn">${icon('wallet-duotone')} Vous avez <strong>${fcfa(d.cashHeld)}</strong> en espèces à remettre à Zado.</div>` : '')
      + (d.current.length ? '<div id="sharePanel"></div>' : '')
      + (d.current.length ? `<div class="deliv-list">${d.current.map(card).join('')}</div>` : '<div class="panel empty">Aucune livraison en cours. Les commandes qu\'on vous confie apparaissent ici.</div>')
      + (d.done.length ? `<h2 style="margin-top:24px">Dernières livraisons</h2><ul class="mini-list">${d.done.map((x) => `<li><span>${esc(x.id)} · ${esc(x.customer.name)}<br><span class="muted">${date(x.deliveredAt)}</span></span><span>${x.collected ? `${fcfa(x.collected.amount)} ${x.collected.method === 'cash' ? 'espèces' : 'Mobile Money'}` : '<span class="tag ok">payée</span>'}</span></li>`).join('')}</ul>` : '');
    renderShare();
    app.querySelectorAll('[data-expect]').forEach((b) => b.addEventListener('click', () => { state.scanExpect = b.dataset.expect; state.scanMode = 'deliver'; }));
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

  // ---------- Mode maintenance : bandeau de rappel pour toute l'équipe ----------
  function renderMaintBar(on) {
    const bar = $('#maintBar'); if (!bar) return;
    bar.hidden = !on;
    bar.innerHTML = on ? `${icon('warning-duotone')} <span><b>Boutique en maintenance</b> : les clients voient le message de maintenance et ne peuvent pas commander.</span>${CAN.admin() ? '<a href="#/reglages">Rouvrir la boutique</a>' : ''}` : '';
  }

  // ---------- Réglages du paiement à la réception (admin) ----------
  async function viewSettings() {
    let c, sl, co, fe, mt;
    try { [c, sl, co, fe, mt] = await Promise.all([api('/settings/cod'), api('/settings/sales'), api('/documents/company'), api('/settings/fees'), api('/settings/maintenance')]); } catch { return; }
    const localDT = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
    const zonesText = (zones) => zones.map((z) => `${z.name} : ${z.fee}`).join('\n');
    const cityRow = (ct = { city: '', fee: 0, zones: [] }) => `<div class="fee-city">
        <div><label>Ville</label><input type="text" data-fc="city" value="${esc(ct.city)}" placeholder="Pointe-Noire" maxlength="40"></div>
        <div><label>Tarif (FCFA)</label><input type="number" data-fc="fee" min="0" step="100" value="${ct.fee}"></div>
        <div class="fee-zones"><label>Quartiers à tarif différent <span class="muted">(un par ligne : « Quartier : montant »)</span></label><textarea data-fc="zones" rows="2" placeholder="Exemple : Ngoyo : 2000">${esc(zonesText(ct.zones))}</textarea></div>
        <button type="button" class="ghost fee-del" title="Retirer cette ville">${icon('trash-bold')} <span>Retirer</span></button>
      </div>`;
    const cp = co.company;
    const coField = (k, label, ph = '', wide = false) => `<div${wide ? ' style="grid-column:1/-1"' : ''}><label for="co_${k}">${label}${co.missing.includes(k) ? ' <span class="tag warn">à compléter</span>' : ''}</label><input id="co_${k}" type="text" data-co="${k}" value="${esc(cp[k] || '')}" placeholder="${esc(ph)}"></div>`;
    const PAY = [['cash', 'Espèces en agence (retrait ou livraison)'], ['momo', 'Mobile Money (MTN, Airtel)'], ['card', 'Carte bancaire (prestataire à brancher)'], ['cod', 'Paiement à la réception']];
    app.innerHTML = pageHead({ crumb: 'Gestion', title: 'Réglages', desc: 'Maintenance, règles de vente, frais de livraison, société (factures et reçus) et paiement à la réception.' }) + `
      <form class="panel maint-panel ${mt.enabled ? 'on' : ''}" id="maintForm" style="max-width:760px">
        <h2>${icon('warning-duotone')} Mode maintenance de la boutique ${mt.enabled ? '<span class="tag danger">ACTIVÉ</span>' : '<span class="tag ok">Boutique ouverte</span>'}</h2>
        <p class="muted" style="margin-top:0">Pendant une mise à jour ou un inventaire : les clients voient ce message à l'ouverture de la boutique et ne peuvent plus commander, payer ni créer de compte. Ils peuvent encore suivre leurs commandes et écrire à l'Aide. Zado Pro reste ouvert.${mt.enabled && mt.since ? `<br>Activé le ${date(mt.since)}${mt.by ? ' par ' + esc(mt.by) : ''}.` : ''}</p>
        ${mt.demo ? '<div class="alert info">Démo publique : la boutique ne peut pas être fermée ici. Le bouton « Aperçu » montre l\'écran que verront les clients.</div>' : ''}
        <label for="mtMsg">Message affiché aux clients</label>
        <textarea id="mtMsg" rows="3" maxlength="300">${esc(mt.message)}</textarea>
        <label for="mtUntil">Retour prévu (facultatif)</label>
        <input type="datetime-local" id="mtUntil" value="${esc(localDT(mt.until))}" style="max-width:260px">
        <div id="mtMsgBox"></div>
        <div class="row" style="margin-top:14px">
          ${mt.enabled ? `<button type="button" class="btn green" id="mtOff">${icon('check-bold')} Rouvrir la boutique</button><button class="ghost">Mettre à jour le message</button>`
            : `<button type="button" class="btn red" id="mtOn" ${mt.demo ? 'disabled' : ''}>${icon('warning-duotone')} Mettre la boutique en maintenance</button><button class="ghost">Enregistrer le message</button>`}
          <a class="ghost" id="mtPreview" href="/?apercu=maintenance" target="_blank" rel="noopener">${icon('arrow-square-out-bold')} Aperçu</a>
        </div>
      </form>
      <form class="panel" id="salesForm" style="max-width:640px">
        <h2>${icon('identification-card')} Règles de vente</h2>
        <label class="check"><input type="checkbox" id="slAccount" ${sl.accountRequired ? 'checked' : ''}> Compte avec pièce d'identité <b>vérifiée</b> obligatoire pour commander</label>
        <p class="muted" style="margin:14px 0 4px">Moyens de paiement proposés aux clients :</p>
        ${PAY.map(([k, l]) => `<label class="check"><input type="checkbox" data-pay="${k}" ${sl.methods[k] ? 'checked' : ''}> ${esc(l)}</label>`).join('')}
        <p class="muted">Les espèces ne sont proposées que s'il existe au moins une agence active (onglet Agences).</p>
        <div id="slMsg"></div>
        <button class="btn" style="margin-top:14px">Enregistrer</button>
      </form>
      <form class="panel" id="feesForm" style="max-width:760px">
        <h2>${icon('truck-duotone')} Frais de livraison</h2>
        <p class="muted" style="margin-top:0">Ajoutés au total quand le client choisit la livraison à domicile. Le retrait au point relais reste gratuit. Montant calculé par le serveur au moment du paiement.</p>
        <div id="feeCities">${fe.cities.map(cityRow).join('')}</div>
        <button type="button" class="ghost" id="feeAdd">${icon('plus-bold')} Ajouter une ville</button>
        <div class="grid2" style="margin-top:14px">
          <div><label class="check"><input type="checkbox" id="feOther" ${fe.other.allowed ? 'checked' : ''}> Livrer aussi les autres villes</label><input type="number" id="feOtherFee" min="0" step="100" value="${fe.other.fee}" aria-label="Tarif autres villes"></div>
          <div><label for="feFree">Livraison offerte à partir de (FCFA, 0 = jamais)</label><input type="number" id="feFree" min="0" step="1000" value="${fe.freeFrom}"></div>
        </div>
        <div id="feMsg"></div>
        <button class="btn" style="margin-top:14px">Enregistrer</button>
      </form>
      <form class="panel" id="companyForm" style="max-width:640px">
        <h2>${icon('receipt')} Société — factures et reçus</h2>
        <p class="muted" style="margin-top:0">Ces informations apparaissent en haut de chaque facture, reçu et avoir. Un document déjà émis garde celles du jour de son émission.</p>
        <div class="grid2">
          ${coField('name', 'Nom commercial', 'Zado')}${coField('legalForm', 'Forme juridique', 'SARL, SAS, Entreprise individuelle…')}
          ${coField('capital', 'Capital (facultatif)', '1 000 000 FCFA')}${coField('rccm', 'RCCM', 'CG-PNR-01-2026-B12-00000')}
          ${coField('niu', 'NIU', 'M2026…')}${coField('phone', 'Téléphone', '06 000 00 00')}
          ${coField('address', 'Adresse', 'N°, avenue, quartier', true)}
          ${coField('city', 'Ville', 'Pointe-Noire')}${coField('country', 'Pays', 'République du Congo')}
          ${coField('email', 'E-mail', 'contact@zado.cg')}${coField('website', 'Site', 'zado.cg')}
        </div>
        <label class="check" style="margin-top:12px"><input type="checkbox" id="coVat" ${cp.vatEnabled ? 'checked' : ''}> Zado facture la TVA (détail HT / TVA / TTC sur les factures)</label>
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
      </form>`;
    const mtBody = (extra = {}) => ({ message: $('#mtMsg').value, until: $('#mtUntil').value ? new Date($('#mtUntil').value).toISOString() : null, ...extra });
    const mtSave = async (extra, okMsg) => {
      try { const v = await api('/settings/maintenance', { method: 'PUT', body: mtBody(extra) }); toast(okMsg); renderMaintBar(v.enabled); route({ keep: true }); }
      catch (err) { $('#mtMsgBox').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    };
    $('#maintForm').addEventListener('submit', (e) => { e.preventDefault(); mtSave({}, 'Message enregistré'); });
    $('#mtOn')?.addEventListener('click', () => { if (confirm('Mettre la boutique en maintenance ?\n\nLes clients verront votre message et ne pourront plus commander jusqu\'à la réouverture.')) mtSave({ enabled: true }, 'Boutique en maintenance'); });
    $('#mtOff')?.addEventListener('click', () => mtSave({ enabled: false }, 'Boutique rouverte ✓'));
    $('#mtPreview').addEventListener('click', (e) => { e.currentTarget.href = '/?apercu=maintenance&msg=' + enc($('#mtMsg').value.slice(0, 300)) + ($('#mtUntil').value ? '&until=' + enc(new Date($('#mtUntil').value).toISOString()) : ''); });
    $('#feeAdd').addEventListener('click', () => { $('#feeCities').insertAdjacentHTML('beforeend', cityRow()); $('#feeCities').lastElementChild.querySelector('input').focus(); });
    $('#feeCities').addEventListener('click', (e) => { if (e.target.closest('.fee-del')) e.target.closest('.fee-city').remove(); });
    $('#feesForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const cities = [...app.querySelectorAll('.fee-city')].map((r) => ({
        city: r.querySelector('[data-fc=city]').value, fee: Number(r.querySelector('[data-fc=fee]').value || 0),
        zones: r.querySelector('[data-fc=zones]').value.split('\n').map((l) => l.split(':')).filter((x) => x[0].trim()).map(([n, f]) => ({ name: n.trim(), fee: Number(String(f || '').replace(/\D/g, '') || 0) })),
      }));
      try {
        await api('/settings/fees', { method: 'PUT', body: { cities, other: { allowed: $('#feOther').checked, fee: Number($('#feOtherFee').value || 0) }, freeFrom: Number($('#feFree').value || 0) } });
        toast('Frais de livraison enregistrés ✓'); $('#feMsg').innerHTML = '';
      } catch (err) { $('#feMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
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
      const msg = `Bonjour ${account.name}, voici votre nouveau code Zado : ${code}. Connectez-vous avec ${who} et ce code.`;
      box.innerHTML = `
        <div class="alert ok">Nouveau code : <strong style="font-size:1.3rem;letter-spacing:.15em">${code.slice(0, 3)} ${code.slice(3)}</strong><br>
        Transmettez-le au client. Il ne sera plus affiché.</div>
        ${account.phone ? `<a class="btn green" target="_blank" rel="noopener" href="https://wa.me/242${esc(account.phone)}?text=${enc(msg)}">Envoyer par WhatsApp</a>` : ''}`;
    } catch (err) {
      toast('❌ ' + err.message);
    }
  }

  // ---------- Agences ----------
  // Points relais : agences Zado et commerces partenaires, placés sur la carte. Le client y paie en espèces et y retire
  // son colis (ou se fait livrer après paiement). Toute modification est visible tout de suite sur la boutique.
  const KIND = { agency: 'Agence Zado', partner: 'Point relais partenaire' };
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
    app.innerHTML = pageHead({ title: 'Points relais', desc: "Agences Zado et commerces partenaires. Le client choisit son point relais sur une carte au moment de commander : il y paie en espèces, puis retire son colis sur place ou se fait livrer. Placez chaque point sur la carte pour qu'il apparaisse au bon endroit.", actions: `<a class="btn" href="#/agences/nouvelle">${icon('plus-bold')} Ajouter un point relais</a>` })
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

  // ---------- Achats : bons de commande fournisseurs, réceptions, stock ----------
  const PO_TAG = { draft: '', sent: 'info', confirmed: 'info', partial: 'warn', received: 'ok', cancelled: 'danger' };
  const poTag = (bc) => `<span class="tag ${PO_TAG[bc.status] || ''}">${esc(bc.statusLabel || bc.status)}</span>`;
  const poWa = (bc) => {
    if (!bc.supplier.phone) return '';
    const msg = `Bonjour, voici notre bon de commande ${bc.number} (${fcfa(bc.total)}) : ${bc.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}.${bc.expectedAt ? ` Livraison souhaitée le ${bc.expectedAt.split('-').reverse().join('/')}.` : ''} Merci de confirmer. — Zado`;
    return `https://wa.me/${String(bc.supplier.phone).replace(/\D/g, '').replace(/^0/, '242')}?text=${enc(msg)}`;
  };
  let poMeta = null;
  async function loadPoMeta() { const r = await api('/purchases'); poMeta = { suppliers: r.suppliers, products: r.products, statuses: r.statuses }; return r; }

  async function viewPurchases() {
    let r;
    try { r = await loadPoMeta(); } catch { return; }
    const list = r.purchases;
    const admin = r.canEdit; // prix d'achat : administrateur seulement
    const f = state.poFilter || 'open';
    const TABS = admin ? [['open', 'En cours'], ['draft', 'Brouillons'], ['toReceive', 'À recevoir'], ['received', 'Reçus'], ['unpaid', 'À payer'], ['all', 'Tous']]
      : [['toReceive', 'À recevoir'], ['received', 'Reçus'], ['all', 'Tous']];
    const match = (b, k) => k === 'all' || (k === 'open' && ['sent', 'confirmed', 'partial'].includes(b.status)) || (k === 'toReceive' && ['sent', 'confirmed', 'partial'].includes(b.status)) || (k === 'unpaid' && b.due > 0 && b.status !== 'cancelled') || b.status === k;
    const due = list.filter((b) => b.due > 0 && b.status !== 'cancelled').reduce((n, b) => n + b.due, 0);
    const late = list.filter((b) => b.late);
    app.innerHTML = pageHead({
      title: 'Achats', desc: admin ? "Commandez vos articles aux fournisseurs avec un <strong>bon de commande</strong> (PDF ou WhatsApp). À la livraison, notez les quantités reçues : le <strong>stock monte tout seul</strong> et le coût d'achat du produit est mis à jour. La facture du fournisseur, saisie sur le bon, apparaît dans Finances → Fournisseurs jusqu'à son paiement." : "Les livraisons attendues des fournisseurs. Quand les articles arrivent, ouvrez le bon et notez les quantités reçues : le stock monte tout seul.",
      actions: admin ? `<a class="btn green" href="#/achat/nouveau">${icon('plus-bold')} Nouveau bon</a>` : '',
    })
      + (admin ? `<div class="kpis">
          <div class="kpi kc0"><span class="kpi-ico">${icon('clipboard-text')}</span><span class="kpi-label">Bons en cours</span><span class="kpi-value">${list.filter((b) => match(b, 'open')).length}</span><span class="kpi-hint">${fcfa(list.filter((b) => match(b, 'open')).reduce((n, b) => n + b.total - b.receivedTotal, 0))} attendus</span></div>
          <div class="kpi kc1"><span class="kpi-ico">${icon('package')}</span><span class="kpi-label">Reçus ce mois</span><span class="kpi-value">${fcfa(list.filter((b) => b.receivedAt && b.receivedAt.slice(0, 7) === today().slice(0, 7)).reduce((n, b) => n + b.receivedTotal, 0))}</span></div>
          <div class="kpi kc2"><span class="kpi-ico">${icon('wallet-duotone')}</span><span class="kpi-label">Reste à payer</span><span class="kpi-value">${fcfa(due)}</span><span class="kpi-hint">${list.filter((b) => match(b, 'unpaid')).length} bon(s)</span></div>
        </div>` : '')
      + (late.length ? `<div class="alert warn">${icon('clock-countdown-duotone')} ${late.length} bon(s) en retard de livraison : ${late.map((b) => `<a href="#/achat/${enc(b.id)}">${esc(b.number)}</a> (${esc(b.supplier.name)}, prévu le ${esc(b.expectedAt.split('-').reverse().join('/'))})`).join(', ')}</div>` : '')
      + tabsBar(TABS.map(([k, l]) => [k, l, list.filter((b) => match(b, k)).length]), f, 'pof') + '<div id="tbl"></div>';
    app.querySelectorAll('[data-pof]').forEach((b) => b.addEventListener('click', () => { state.poFilter = b.dataset.pof; viewPurchases(); }));
    dataTable($('#tbl'), {
      id: 'purchases', rows: list.filter((b) => match(b, f)), defaultSort: 'createdAt', placeholder: 'Numéro, fournisseur, article', empty: admin ? 'Aucun bon de commande ici. Cliquez sur « Nouveau bon ».' : 'Aucune livraison attendue.',
      searchText: (b) => `${b.number} ${b.supplier.name} ${b.lines.map((l) => l.name).join(' ')}`,
      columns: [
        { key: 'number', label: 'Bon', render: (b) => `<a href="#/achat/${enc(b.id)}"><strong class="mono">${esc(b.number)}</strong></a><br>${poTag(b)}${b.late ? ' <span class="tag danger">en retard</span>' : ''}` },
        { key: 'createdAt', label: 'Date', render: (b) => date(b.createdAt).split(' ')[0] + (b.expectedAt ? `<br><span class="muted">prévu ${esc(b.expectedAt.split('-').reverse().join('/'))}</span>` : '') },
        { key: 'supplier', label: 'Fournisseur', sortValue: (b) => norm(b.supplier.name), render: (b) => `${esc(b.supplier.name)}${b.supplier.supplierId ? '<br><span class="muted">compte Zado Pro</span>' : ''}` },
        { key: 'lines', label: 'Articles', sortable: false, render: (b) => b.lines.slice(0, 3).map((l) => `${l.qty} × ${esc(l.name)}`).join('<br>') + (b.lines.length > 3 ? `<br><span class="muted">+ ${b.lines.length - 3} autre(s)</span>` : '') },
        { key: 'receivedQty', label: 'Reçu', cls: 'num', render: (b) => `${b.receivedQty}/${b.qty}` },
        ...(admin ? [{ key: 'total', label: 'Total', cls: 'num', render: (b) => `<strong>${fcfa(b.total)}</strong>${b.due > 0 && b.status !== 'cancelled' ? `<br><span class="tag warn">à payer ${fcfa(b.due)}</span>` : ''}` }] : []),
        { key: 'act', label: '', sortable: false, render: (b) => `<div class="cell-actions"><a class="ghost" href="#/achat/${enc(b.id)}">${admin ? 'Ouvrir' : 'Recevoir'}</a></div>` },
      ],
    });
  }

  // Lignes d'un bon (création) : recherche produit, quantité, prix d'achat
  function poLinesEditor(host, lines, products) {
    const draw = () => {
      host.innerHTML = `<div class="po-search"><input type="search" id="poQ" placeholder="Chercher un article du catalogue (nom ou référence)…" autocomplete="off"><div class="po-hits" id="poHits" hidden></div></div>
        ${lines.length ? `<table class="po-lines"><thead><tr><th>Article</th><th class="num">Quantité</th><th class="num">Prix d'achat unitaire</th><th class="num">Total</th><th></th></tr></thead><tbody>
          ${lines.map((l, i) => `<tr><td><strong>${esc(l.name)}</strong><br><span class="muted">stock actuel : ${l.stock ?? '—'}${l.supplierId ? ' · dépôt-vente' : ''}</span></td>
            <td class="num"><input type="number" min="1" step="1" value="${l.qty}" data-po-qty="${i}" inputmode="numeric"></td>
            <td class="num"><input type="number" min="0" step="1" value="${l.unitPrice}" data-po-price="${i}" inputmode="numeric"></td>
            <td class="num"><strong>${fcfa(l.qty * l.unitPrice)}</strong></td><td><button type="button" class="ghost" data-po-del="${i}" title="Retirer">${icon('x-bold')}</button></td></tr>`).join('')}
          <tr class="po-total"><td colspan="3">Total du bon</td><td class="num"><strong>${fcfa(lines.reduce((n, l) => n + l.qty * l.unitPrice, 0))}</strong></td><td></td></tr></tbody></table>` : '<p class="muted">Aucun article pour le moment : cherchez-en un ci-dessus.</p>'}`;
      const q = host.querySelector('#poQ'), hits = host.querySelector('#poHits');
      q.addEventListener('input', () => {
        const w = norm(q.value).trim();
        if (!w) { hits.hidden = true; return; }
        const found = products.filter((p) => !lines.some((l) => l.productId === p.id) && norm(`${p.name} ${p.id}`).includes(w)).slice(0, 8);
        hits.innerHTML = found.map((p) => `<button type="button" data-po-add="${esc(p.id)}">${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}<span>${esc(p.name)}<small>stock ${p.stock ?? '—'} · dernier achat ${p.lastPurchasePrice != null ? fcfa(p.lastPurchasePrice) : p.costPrice != null ? fcfa(p.costPrice) : p.supplierPrice != null ? fcfa(p.supplierPrice) : '—'}</small></span></button>`).join('') || '<p class="muted" style="padding:8px 12px;margin:0">Aucun article trouvé.</p>';
        hits.hidden = false;
      });
      hits.addEventListener('click', (e) => {
        const b = e.target.closest('[data-po-add]'); if (!b) return;
        const p = products.find((x) => x.id === b.dataset.poAdd);
        lines.push({ productId: p.id, name: p.name, qty: 1, unitPrice: p.lastPurchasePrice ?? p.costPrice ?? p.supplierPrice ?? 0, stock: p.stock, supplierId: p.supplierId });
        draw(); host.querySelector(`[data-po-qty="${lines.length - 1}"]`)?.focus();
      });
      host.querySelectorAll('[data-po-qty]').forEach((i) => i.addEventListener('change', () => { lines[i.dataset.poQty].qty = Math.max(1, parseInt(i.value, 10) || 1); draw(); }));
      host.querySelectorAll('[data-po-price]').forEach((i) => i.addEventListener('change', () => { lines[i.dataset.poPrice].unitPrice = Math.max(0, parseInt(i.value, 10) || 0); draw(); }));
      host.querySelectorAll('[data-po-del]').forEach((b) => b.addEventListener('click', () => { lines.splice(Number(b.dataset.poDel), 1); draw(); }));
    };
    draw();
  }

  async function viewPurchaseNew() {
    try { if (!poMeta) await loadPoMeta(); } catch { return; }
    const lines = [];
    app.innerHTML = pageHead({ crumb: 'Achats', title: 'Nouveau bon de commande', desc: 'Choisissez le fournisseur, ajoutez les articles et leur prix d\'achat. Le bon reste en brouillon tant que vous ne l\'envoyez pas.' }) + `
      <form class="panel" id="poForm" novalidate>
        <h2>${icon('users-three-duotone')} Fournisseur</h2>
        <label for="poSup">Compte fournisseur Zado Pro</label>
        <select id="poSup"><option value="">Autre fournisseur (saisie libre)</option>${poMeta.suppliers.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select>
        <div class="grid2" id="poExt">
          <div><label for="poName">Nom du fournisseur</label><input id="poName" type="text" maxlength="100" placeholder="Ex. Grossiste Dubaï, Marché Total…"></div>
          <div><label for="poPhone">Téléphone / WhatsApp</label><input id="poPhone" type="tel" maxlength="30" placeholder="06 000 00 00"></div>
          <div style="grid-column:1/-1"><label for="poContact">Personne à contacter (facultatif)</label><input id="poContact" type="text" maxlength="100"></div>
        </div>
        <h2 style="margin-top:18px">${icon('package')} Articles</h2>
        <div id="poLines"></div>
        <div class="grid2" style="margin-top:14px">
          <div><label for="poDate">Livraison souhaitée</label><input id="poDate" type="date" min="${today()}"></div>
          <div><label for="poRef">Référence chez le fournisseur (facultatif)</label><input id="poRef" type="text" maxlength="60"></div>
        </div>
        <label for="poNote">Note pour le fournisseur (facultatif)</label><textarea id="poNote" rows="2" maxlength="1000" placeholder="Conditions, couleurs, emballage…"></textarea>
        <div id="poErr"></div>
        <div class="row" style="margin-top:16px;gap:8px"><button class="btn">${icon('check-bold')} Enregistrer le brouillon</button><a class="ghost" href="#/achats">Annuler</a></div>
      </form>`;
    poLinesEditor($('#poLines'), lines, poMeta.products);
    const syncSup = () => { $('#poExt').hidden = Boolean($('#poSup').value); };
    $('#poSup').addEventListener('change', syncSup); syncSup();
    $('#poForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const supplier = $('#poSup').value ? { supplierId: $('#poSup').value } : { name: $('#poName').value, phone: $('#poPhone').value, contact: $('#poContact').value };
      try {
        const bc = await api('/purchases', { method: 'POST', body: { supplier, lines: lines.map(({ productId, qty, unitPrice }) => ({ productId, qty, unitPrice })), expectedAt: $('#poDate').value, reference: $('#poRef').value, note: $('#poNote').value } });
        toast(`${bc.number} enregistré ✓`); location.hash = '#/achat/' + enc(bc.id);
      } catch (err) { $('#poErr').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
  }

  async function viewPurchase(id) {
    let bc;
    try { if (!poMeta) await loadPoMeta(); bc = await api('/purchases/' + enc(id)); } catch (err) { app.innerHTML = `<p><a href="#/achats">‹ Achats</a></p><div class="alert err">${esc(err.message)}</div>`; return; }
    const admin = !bc.pricesHidden; // l'employé Catalogue : quantités et réception seulement
    const open = ['sent', 'confirmed', 'partial'].includes(bc.status) || (admin && bc.status === 'draft');
    const left = (l) => l.qty - (l.received || 0);
    const wa = admin ? poWa(bc) : '';
    app.innerHTML = `<p><a href="#/achats">‹ Achats</a></p>
      <div class="row between" style="flex-wrap:wrap;gap:8px"><h1 class="mono" style="margin:0">${esc(bc.number)}</h1><span class="row" style="gap:6px">${poTag(bc)}${bc.late ? '<span class="tag danger">en retard</span>' : ''}</span></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin:10px 0 14px">
        ${admin ? `<a class="btn ghost" target="_blank" rel="noopener" href="/api/admin/purchases/${enc(bc.id)}/print">${icon('download-simple-bold')} Bon en PDF</a>` : ''}
        ${wa ? `<a class="btn green" target="_blank" rel="noopener" href="${wa}">${icon('chat-circle')} Envoyer par WhatsApp</a>` : ''}
        ${admin && bc.status === 'draft' ? `<button class="btn" data-po-st="sent">${icon('paper-plane-right-fill')} Marquer envoyé</button>` : ''}
        ${admin && ['draft', 'sent'].includes(bc.status) ? `<button class="btn ghost" data-po-st="confirmed">${icon('check-bold')} Confirmé par le fournisseur</button>` : ''}
        ${admin && ['draft', 'sent', 'confirmed'].includes(bc.status) ? `<button class="ghost" data-po-st="cancelled" style="margin-left:auto">${icon('x-bold')} Annuler le bon</button>` : ''}
      </div>
      <div id="poMsg"></div>
      <div class="grid2 po-grid">
        <div class="panel"><h2>${icon('users-three-duotone')} Fournisseur</h2>
          <p style="margin:0"><strong>${esc(bc.supplier.name)}</strong>${bc.supplier.supplierId ? ' <span class="tag">compte Zado Pro</span>' : ''}${bc.supplier.contact && bc.supplier.contact !== bc.supplier.name ? `<br>${esc(bc.supplier.contact)}` : ''}${bc.supplier.phone ? `<br><a href="tel:${esc(bc.supplier.phone)}">${esc(bc.supplier.phone)}</a>` : ''}${bc.reference ? `<br><span class="muted">Réf. fournisseur : ${esc(bc.reference)}</span>` : ''}</p>
          ${bc.confirmedAt ? `<p class="muted" style="margin:8px 0 0">Confirmé le ${date(bc.confirmedAt)}${bc.confirmedBy ? ` par ${esc(bc.confirmedBy)}` : ''}</p>` : ''}
        </div>
        <form class="panel" id="poInfo"><h2>${icon('clock-bold')} Livraison</h2>
          <label for="poDate">Date prévue</label><input id="poDate" type="date" value="${esc(bc.expectedAt || '')}" ${!admin || ['received', 'cancelled'].includes(bc.status) ? 'disabled' : ''}>
          <label for="poNote">Note</label><textarea id="poNote" rows="2" maxlength="1000" ${!admin || ['received', 'cancelled'].includes(bc.status) ? 'disabled' : ''}>${esc(bc.note || '')}</textarea>
          ${!admin || ['received', 'cancelled'].includes(bc.status) ? '' : '<button class="ghost" style="margin-top:8px">Enregistrer</button>'}
        </form>
      </div>
      <div class="panel"><h2>${icon('package')} Articles ${open ? '<span class="muted" style="font-weight:400;font-size:.9rem">— notez ce qui arrive, même en plusieurs fois</span>' : ''}</h2>
        <form id="poReceive"><table class="po-lines"><thead><tr><th>Article</th><th class="num">Commandé</th>${admin ? '<th class="num">Prix unitaire</th>' : ''}<th class="num">Reçu</th>${open ? '<th class="num">Reçu aujourd\'hui</th>' : ''}</tr></thead><tbody>
          ${bc.lines.map((l) => `<tr><td><strong>${esc(l.name)}</strong>${admin && bc.consigned && poMeta.products.find((p) => p.id === l.productId)?.supplierId ? '<br><span class="muted">dépôt-vente : réglé à la vente</span>' : ''}</td><td class="num">${l.qty}</td>${admin ? `<td class="num">${fcfa(l.unitPrice)}</td>` : ''}<td class="num">${l.received || 0}${(l.received || 0) >= l.qty ? ' ✓' : ''}</td>
            ${open ? `<td class="num">${left(l) > 0 ? `<input type="number" min="0" max="${left(l)}" step="1" placeholder="0" data-rcv="${esc(l.productId)}" inputmode="numeric" style="width:90px;margin:0">` : '<span class="muted">complet</span>'}</td>` : ''}</tr>`).join('')}
          ${admin ? `<tr class="po-total"><td colspan="${open ? 4 : 3}">Total du bon · reçu ${fcfa(bc.receivedTotal)}</td><td class="num"><strong>${fcfa(bc.total)}</strong></td></tr>` : ''}</tbody></table>
          ${open ? `<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><input type="text" id="rcvNote" placeholder="Note de réception (facultatif)" maxlength="300" style="flex:1;min-width:200px;margin:0"><button class="btn green" type="button" id="rcvAll">${icon('check-bold')} Tout reçu</button><button class="btn" type="submit">${icon('package')} Enregistrer la réception</button></div><p class="muted" style="margin:8px 0 0">À chaque réception, le stock des articles augmente${admin ? " et le coût d'achat est recalculé (coût moyen)" : ''}.</p>` : ''}
        </form></div>
      ${admin && bc.status !== 'cancelled' ? `<div class="grid2 po-grid">
        <form class="panel" id="poInvoice"><h2>${icon('receipt')} Facture du fournisseur</h2>
          ${bc.invoice ? `<p style="margin:0 0 10px"><strong>${esc(bc.invoice.number || 'Sans numéro')}</strong> · ${fcfa(bc.invoice.amount)} · du ${esc(bc.invoice.date.split('-').reverse().join('/'))}${bc.invoice.dueAt ? ` · à payer avant le ${esc(bc.invoice.dueAt.split('-').reverse().join('/'))}` : ''}</p>` : '<p class="muted" style="margin:0 0 10px">Pas encore de facture : la dette est la valeur des articles reçus.</p>'}
          ${CAN.admin() ? `<div class="grid2"><div><label for="invNum">N° de facture</label><input id="invNum" type="text" maxlength="60" value="${esc(bc.invoice?.number || '')}"></div><div><label for="invAmt">Montant (FCFA)</label><input id="invAmt" type="number" min="0" step="1" value="${bc.invoice?.amount ?? (bc.receivedTotal || bc.total)}" inputmode="numeric"></div>
            <div><label for="invDate">Date</label><input id="invDate" type="date" value="${esc(bc.invoice?.date || today())}"></div><div><label for="invDue">Échéance</label><input id="invDue" type="date" value="${esc(bc.invoice?.dueAt || '')}"></div></div>
            <div class="row" style="gap:8px;margin-top:8px"><button class="ghost">Enregistrer la facture</button>${bc.invoice ? '<button type="button" class="ghost" id="invRemove">Retirer</button>' : ''}</div>` : ''}
        </form>
        <div class="panel"><h2>${icon('wallet-duotone')} Paiement</h2>
          <div class="lines"><div><span>Dû pour ce bon</span><span>${fcfa(bc.owed)}</span></div><div><span>Déjà payé</span><span>${fcfa(bc.paid)}</span></div><div><span><strong>Reste à payer</strong></span><span><strong class="${bc.due > 0 ? 'neg' : 'pos'}">${fcfa(bc.due)}</strong></span></div></div>
          ${CAN.admin() ? `<a class="btn ${bc.due > 0 ? '' : 'ghost'}" href="#/finances/nouvelle?achat=${enc(bc.id)}&montant=${bc.due}" style="margin-top:10px">${icon('money-duotone')} Enregistrer un paiement</a>` : '<p class="muted" style="margin:8px 0 0">Les paiements se font dans Finances (administrateur).</p>'}
        </div></div>` : ''}
      <div class="panel"><h2>${icon('list-bullets-duotone')} Historique</h2>
        ${bc.receipts?.length ? `<h3 style="margin:0 0 6px">Réceptions</h3><ul class="mini-list">${bc.receipts.map((r) => `<li><span>${r.lines.map((l) => `${l.qty} × ${esc(l.name)}`).join(', ')}${r.note ? `<br><span class="muted">${esc(r.note)}</span>` : ''}</span><span class="muted">${date(r.at)}${r.byName ? ` · ${esc(r.byName)}` : ''}</span></li>`).join('')}</ul>` : ''}
        <ol class="pcl-hist" style="margin-top:12px">${[...(bc.history || [])].reverse().map((h) => `<li><b>${esc(h.event)}</b>${h.note ? ` — ${esc(h.note)}` : ''}<br><span class="muted">${date(h.at)}${h.byName ? ` · ${esc(h.byName)}` : ''}</span></li>`).join('')}</ol>
      </div>`;
    const show = (err) => { $('#poMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; window.scrollTo(0, 0); };
    app.querySelectorAll('[data-po-st]').forEach((b) => b.addEventListener('click', async () => {
      const st = b.dataset.poSt;
      let note = '';
      if (st === 'cancelled') { note = prompt('Annuler ce bon de commande ? Indiquez la raison :'); if (note === null) return; }
      try { await api(`/purchases/${enc(bc.id)}/status`, { method: 'POST', body: { status: st, note } }); toast('Bon mis à jour ✓'); viewPurchase(bc.id); } catch (err) { show(err); }
    }));
    $('#poInfo').addEventListener('submit', async (e) => { e.preventDefault(); try { await api(`/purchases/${enc(bc.id)}`, { method: 'PATCH', body: { expectedAt: $('#poDate').value, note: $('#poNote').value } }); toast('Enregistré ✓'); viewPurchase(bc.id); } catch (err) { show(err); } });
    $('#rcvAll')?.addEventListener('click', () => { app.querySelectorAll('[data-rcv]').forEach((i) => { i.value = i.max; }); });
    $('#poReceive').addEventListener('submit', async (e) => {
      e.preventDefault();
      const lines = [...app.querySelectorAll('[data-rcv]')].map((i) => ({ productId: i.dataset.rcv, qty: parseInt(i.value, 10) || 0 })).filter((l) => l.qty > 0);
      if (!lines.length) { show(new Error('Indiquez les quantités reçues (ou « Tout reçu »).')); return; }
      try { const r = await api(`/purchases/${enc(bc.id)}/receive`, { method: 'POST', body: { lines, note: $('#rcvNote').value } }); toast(`Réception enregistrée : stock mis à jour ✓ (${r.statusLabel})`); viewPurchase(bc.id); } catch (err) { show(err); }
    });
    $('#poInvoice')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/purchases/${enc(bc.id)}/invoice`, { method: 'PUT', body: { number: $('#invNum').value, amount: $('#invAmt').value, date: $('#invDate').value, dueAt: $('#invDue').value } }); toast('Facture enregistrée ✓'); viewPurchase(bc.id); } catch (err) { show(err); }
    });
    $('#invRemove')?.addEventListener('click', async () => { try { await api(`/purchases/${enc(bc.id)}/invoice`, { method: 'PUT', body: { remove: true } }); viewPurchase(bc.id); } catch (err) { show(err); } });
  }

  // Espace fournisseur : les bons de commande que Zado lui adresse
  async function viewSupplierPurchases() {
    let r;
    try { r = await api('/purchases/mine'); } catch { return; }
    const list = r.purchases;
    app.innerHTML = pageHead({ title: 'Bons de commande', desc: 'Les commandes que Zado vous passe. Confirmez chaque bon avec votre date de livraison, puis livrez à Zado : la réception est enregistrée par l\'équipe.' })
      + (list.some((b) => b.status === 'sent') ? `<div class="todo">${icon('clipboard-text')} ${list.filter((b) => b.status === 'sent').length} bon(s) à confirmer</div>` : '')
      + `<div id="tbl"></div><div id="poConfirm"></div>`;
    dataTable($('#tbl'), {
      id: 'supplier-purchases', rows: list, defaultSort: 'createdAt', placeholder: 'Numéro ou article', empty: 'Aucun bon de commande pour le moment.',
      searchText: (b) => `${b.number} ${b.lines.map((l) => l.name).join(' ')}`,
      columns: [
        { key: 'number', label: 'Bon', render: (b) => `<strong class="mono">${esc(b.number)}</strong><br>${poTag(b)}` },
        { key: 'createdAt', label: 'Date', render: (b) => date(b.sentAt || b.createdAt).split(' ')[0] + (b.expectedAt ? `<br><span class="muted">livraison ${esc(b.expectedAt.split('-').reverse().join('/'))}</span>` : '') },
        { key: 'lines', label: 'Articles', sortable: false, render: (b) => b.lines.map((l) => `${l.qty} × ${esc(l.name)}${(l.received || 0) ? ` <span class="muted">(reçu ${l.received})</span>` : ''}`).join('<br>') },
        { key: 'total', label: 'Montant', cls: 'num', render: (b) => `<strong>${fcfa(b.total)}</strong>` },
        { key: 'act', label: '', sortable: false, render: (b) => `<div class="cell-actions">${b.status === 'sent' ? `<button class="btn small" data-po-ok="${esc(b.id)}">${icon('check-bold')} Confirmer</button>` : ''}${b.note ? `<button class="ghost" data-po-note="${esc(b.id)}">Note</button>` : ''}</div>` },
      ],
    });
    $('#tbl').addEventListener('click', async (e) => {
      const n = e.target.closest('[data-po-note]');
      if (n) { alert(list.find((b) => b.id === n.dataset.poNote).note); return; }
      const b = e.target.closest('[data-po-ok]'); if (!b) return;
      const bc = list.find((x) => x.id === b.dataset.poOk);
      $('#poConfirm').innerHTML = `<form class="panel" id="poOkForm" style="max-width:520px"><h2>Confirmer ${esc(bc.number)}</h2>
        <label for="okDate">Date de livraison à Zado</label><input id="okDate" type="date" value="${esc(bc.expectedAt || '')}" min="${today()}">
        <label for="okNote">Message (facultatif)</label><input id="okNote" type="text" maxlength="300" placeholder="Ex. livraison vendredi matin">
        <div id="okErr"></div><div class="row" style="gap:8px;margin-top:10px"><button class="btn green">${icon('check-bold')} Je confirme ce bon</button><button type="button" class="ghost" id="okCancel">Annuler</button></div></form>`;
      $('#poConfirm').scrollIntoView({ behavior: 'smooth' });
      $('#okCancel').addEventListener('click', () => { $('#poConfirm').innerHTML = ''; });
      $('#poOkForm').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try { await api(`/purchases/mine/${enc(bc.id)}/confirm`, { method: 'POST', body: { expectedAt: $('#okDate').value, note: $('#okNote').value } }); toast('Bon confirmé ✓ Merci !'); viewSupplierPurchases(); }
        catch (err) { $('#okErr').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
      });
    });
  }

  // ---------- Stock : vue d'ensemble, mouvements, inventaire ----------
  async function viewStock(sub) {
    const tab = ['mouvements', 'inventaire'].includes(sub) ? sub : '';
    const tabs = `<div class="tabbar">${[['', 'État du stock'], ['mouvements', 'Mouvements'], ['inventaire', 'Inventaire']].map(([k, l]) => `<a class="tab ${k === tab ? 'on' : ''}" href="#/stock${k ? '/' + k : ''}">${l}</a>`).join('')}</div>`;
    const head = pageHead({ title: 'Stock', desc: 'Ce que Zado a en rayon, ce qui est en commande chez les fournisseurs, et chaque entrée ou sortie (réception, vente, annulation, correction, inventaire).', actions: CAN.admin() ? `<a class="btn" href="#/achat/nouveau">${icon('plus-bold')} Commander au fournisseur</a>` : '' });
    if (tab === 'mouvements') {
      let r; try { r = await api('/stock/moves'); } catch { return; }
      app.innerHTML = head + tabs + '<div id="tbl"></div>';
      dataTable($('#tbl'), {
        id: 'stock-moves', rows: r.moves, defaultSort: 'at', placeholder: 'Article, référence, raison', empty: 'Aucun mouvement pour le moment.',
        searchText: (m) => `${m.name} ${m.ref || ''} ${m.label} ${m.byName}`,
        columns: [
          { key: 'at', label: 'Date', render: (m) => date(m.at) },
          { key: 'name', label: 'Article', sortValue: (m) => norm(m.name), render: (m) => `<a href="#/produit/${enc(m.productId)}">${esc(m.name)}</a>` },
          { key: 'label', label: 'Raison', render: (m) => `${esc(m.label)}${m.ref ? `<br><span class="muted">${/^CMD-/.test(m.ref) && CAN.orders() ? `<a href="#/commande/${enc(m.ref)}">${esc(m.ref)}</a>` : /^BC-/.test(m.ref) ? `<a href="#/achats">${esc(m.ref)}</a>` : esc(m.ref)}</span>` : ''}${m.note ? `<br><span class="muted">${esc(m.note)}</span>` : ''}` },
          { key: 'qty', label: 'Quantité', cls: 'num', render: (m) => `<strong class="${m.qty < 0 ? 'neg' : 'pos'}">${m.qty > 0 ? '+' : ''}${m.qty}</strong>` },
          { key: 'after', label: 'Stock après', cls: 'num', render: (m) => `${m.before} → <strong>${m.after}</strong>` },
          { key: 'byName', label: 'Par', render: (m) => esc(m.byName || '') },
        ],
      });
      return;
    }
    let r; try { r = await api('/stock/overview'); } catch { return; }
    if (tab === 'inventaire') {
      const rows = r.products.filter((p) => p.active).sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
      app.innerHTML = head + tabs + `<form class="panel" id="invForm"><p class="muted" style="margin-top:0">Comptez vos articles et tapez la quantité réelle. Seuls les écarts sont enregistrés (mouvement « Inventaire »). Laissez vide pour ne pas toucher.</p>
        <div class="table-tools"><label class="search">${icon('magnifying-glass-bold')}<input type="search" id="invQ" placeholder="Filtrer les articles"></label><span class="muted" id="invCount"></span></div>
        <div class="table-wrap"><table class="dt"><thead><tr><th>Article</th><th class="num">Stock noté</th><th class="num">Compté</th><th class="num">Écart</th></tr></thead><tbody id="invBody">
          ${rows.map((p) => `<tr data-inv-row data-name="${esc(norm(p.name))}"><td>${esc(p.name)}<br><span class="muted">${esc(p.category || '')}</span></td><td class="num">${p.stock ?? '—'}</td><td class="num"><input type="number" min="0" step="1" data-inv="${esc(p.id)}" data-before="${p.stock ?? 0}" inputmode="numeric" style="width:90px;margin:0"></td><td class="num" data-inv-diff></td></tr>`).join('')}</tbody></table></div>
        <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><input type="text" id="invNote" placeholder="Note (ex. inventaire du 17/10)" maxlength="200" style="flex:1;min-width:200px;margin:0"><button class="btn">${icon('check-bold')} Enregistrer l'inventaire</button></div><div id="invMsg"></div></form>`;
      const upd = () => { let n = 0; app.querySelectorAll('[data-inv]').forEach((i) => { const d = i.value === '' ? null : (parseInt(i.value, 10) || 0) - Number(i.dataset.before); const c = i.closest('tr').querySelector('[data-inv-diff]'); c.innerHTML = d === null ? '' : `<strong class="${d < 0 ? 'neg' : d > 0 ? 'pos' : ''}">${d > 0 ? '+' : ''}${d}</strong>`; if (d !== null) n++; }); $('#invCount').textContent = n ? `${n} article(s) compté(s)` : ''; };
      app.querySelectorAll('[data-inv]').forEach((i) => i.addEventListener('input', upd));
      $('#invQ').addEventListener('input', () => { const w = norm($('#invQ').value); app.querySelectorAll('[data-inv-row]').forEach((tr) => { tr.hidden = Boolean(w) && !tr.dataset.name.includes(w); }); });
      $('#invForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const items = [...app.querySelectorAll('[data-inv]')].filter((i) => i.value !== '').map((i) => ({ productId: i.dataset.inv, counted: parseInt(i.value, 10) || 0 }));
        if (!items.length) { $('#invMsg').innerHTML = '<div class="alert err">Tapez au moins une quantité comptée.</div>'; return; }
        if (!confirm(`Enregistrer l'inventaire de ${items.length} article(s) ? Le stock sera remplacé par les quantités comptées.`)) return;
        try { const res = await api('/stock/count', { method: 'POST', body: { items, note: $('#invNote').value } }); toast(`Inventaire enregistré : ${res.changed.length} écart(s) ✓`); location.hash = '#/stock/mouvements'; }
        catch (err) { $('#invMsg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
      });
      return;
    }
    app.innerHTML = head + tabs + `<div class="kpis">
        ${r.pricesHidden ? '' : `<div class="kpi kc0"><span class="kpi-ico">${icon('package')}</span><span class="kpi-label">Valeur du stock</span><span class="kpi-value">${fcfa(r.totalValue)}</span><span class="kpi-hint">au coût d'achat${r.noCost ? ` · ${r.noCost} produit(s) sans coût` : ''}</span></div>`}
        <div class="kpi kc1"><span class="kpi-ico">${icon('warning-duotone')}</span><span class="kpi-label">Stock bas (≤ 3)</span><span class="kpi-value">${r.low}</span><span class="kpi-hint">${r.products.filter((p) => p.active && p.stock === 0).length} en rupture</span></div>
        <div class="kpi kc2"><span class="kpi-ico">${icon('clipboard-text')}</span><span class="kpi-label">En commande</span><span class="kpi-value">${r.products.reduce((n, p) => n + p.onOrder, 0)}</span><span class="kpi-hint">articles attendus des fournisseurs</span></div>
      </div><div id="tbl"></div>`;
    dataTable($('#tbl'), {
      id: 'stock-overview', rows: r.products, defaultSort: 'stock', placeholder: 'Article ou catégorie', empty: 'Aucun produit.',
      searchText: (p) => `${p.name} ${p.category}`,
      columns: [
        { key: 'name', label: 'Article', sortValue: (p) => norm(p.name), render: (p) => `<a href="#/produit/${enc(p.id)}">${esc(p.name)}</a>${p.active ? '' : ' <span class="tag">masqué</span>'}<br><span class="muted">${esc(p.category || '')}${p.supplierId ? ' · dépôt-vente' : ''}</span>` },
        { key: 'stock', label: 'Stock', cls: 'num', sortValue: (p) => (p.stock == null ? -1e9 : -p.stock), render: (p) => p.stock == null ? '<span class="muted">non suivi</span>' : `<strong class="${p.stock === 0 ? 'neg' : p.stock <= 3 ? 'warn-text' : ''}">${p.stock}</strong>` },
        { key: 'onOrder', label: 'En commande', cls: 'num', render: (p) => (p.onOrder ? `+${p.onOrder}` : '') },
        ...(r.pricesHidden ? [] : [
          { key: 'cost', label: 'Coût unitaire', cls: 'num', render: (p) => (p.cost != null ? fcfa(p.cost) : '<span class="tag warn">à renseigner</span>') },
          { key: 'value', label: 'Valeur', cls: 'num', render: (p) => fcfa(p.value) },
        ]),
        { key: 'act', label: '', sortable: false, render: (p) => `<div class="cell-actions"><a class="ghost" href="#/stock/mouvements">Mouvements</a></div>` },
      ],
    });
  }

  // ---------- Calendrier de livraison : mois en un coup d'œil, livraisons du jour, commandes à planifier ----------
  const SLOT_SHORT = { morning: 'Matin', afternoon: 'Après-midi', evening: 'Soir' };
  const frDate = (ymd) => ymd ? ymd.split('-').reverse().join('/') : '';
  const addDays = (ymd, n) => { const x = new Date(ymd + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const planForm = (o, couriers, { withCourier = true, compact = false } = {}) => `<form class="plan-form ${compact ? 'compact' : ''}" data-plan="${esc(o.id)}">
      <input type="date" name="date" value="${esc(o.planned?.date || '')}" min="${today()}" required>
      <select name="slot">${Object.entries(SLOT_SHORT).map(([k, l]) => `<option value="${k}" ${o.planned?.slot === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${withCourier ? `<select name="courierId"><option value="">${o.courierName ? 'Livreur : ' + esc(o.courierName) : 'Livreur (plus tard)'}</option>${couriers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>` : ''}
      <button class="btn small">${icon('clock-bold')} ${o.planned ? 'Déplacer' : 'Planifier'}</button>${o.planned ? `<button type="button" class="ghost small" data-unplan="${esc(o.id)}" title="Retirer la planification">${icon('x-bold')}</button>` : ''}
      <span class="plan-msg"></span></form>`;
  function bindPlanForms(host, after) {
    host.querySelectorAll('[data-plan]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { date: f.date.value, slot: f.slot.value, courierId: f.courierId?.value || undefined };
      try { await api(`/orders/${enc(f.dataset.plan)}/plan`, { method: 'POST', body }); toast('Livraison planifiée ✓ Le client est prévenu.'); await loadOrders(); after(); }
      catch (err) { f.querySelector('.plan-msg').textContent = err.message; }
    }));
    host.querySelectorAll('[data-unplan]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/orders/${enc(b.dataset.unplan)}/plan`, { method: 'DELETE' }); toast('Planification retirée'); await loadOrders(); after(); } catch (err) { alert(err.message); }
    }));
  }
  async function viewCalendar(sub) {
    const monthKey = /^\d{4}-\d{2}$/.test(sub) ? sub : (state.calMonth || today().slice(0, 7));
    state.calMonth = monthKey;
    const [y, m] = monthKey.split('-').map(Number);
    const first = `${monthKey}-01`;
    const daysIn = new Date(y, m, 0).getDate();
    const last = `${monthKey}-${String(daysIn).padStart(2, '0')}`;
    let d;
    try { d = await api(`/calendar?from=${first}&to=${last}`); } catch { return; }
    const byDay = {};
    const push = (day, it) => { (byDay[day] = byDay[day] || []).push(it); };
    d.planned.forEach((o) => push(o.date, { kind: 'order', ...o }));
    d.purchases.forEach((b) => push(b.date, { kind: 'purchase', ...b }));
    const sel = state.calDay && state.calDay.startsWith(monthKey) ? state.calDay : (d.today.startsWith(monthKey) ? d.today : first);
    state.calDay = sel;
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`, next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    const monthName = new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const startDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // lundi = 0
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push('<div class="cal-cell off"></div>');
    for (let day = 1; day <= daysIn; day++) {
      const key = `${monthKey}-${String(day).padStart(2, '0')}`;
      const items = byDay[key] || [];
      const orders = items.filter((x) => x.kind === 'order');
      const late = orders.some((x) => x.late);
      cells.push(`<button type="button" class="cal-cell ${key === d.today ? 'today' : ''} ${key === sel ? 'sel' : ''} ${key < d.today ? 'past' : ''}" data-day="${key}">
        <span class="cal-n">${day}</span>
        ${orders.length ? `<span class="cal-count ${late ? 'late' : ''}">${orders.length} livr.</span>` : ''}
        <span class="cal-dots">${['morning', 'afternoon', 'evening'].map((sl) => orders.filter((x) => x.slot === sl).length ? `<i class="sl-${sl}" title="${SLOT_SHORT[sl]}"></i>` : '').join('')}${items.some((x) => x.kind === 'purchase') ? '<i class="sl-purchase" title="Arrivée fournisseur"></i>' : ''}</span>
      </button>`);
    }
    const dayItems = (byDay[sel] || []);
    const dayOrders = dayItems.filter((x) => x.kind === 'order');
    const slotBlock = (sl) => {
      const list = dayOrders.filter((x) => x.slot === sl);
      if (!list.length) return '';
      return `<div class="cal-slot"><h3><i class="sl-${sl}"></i> ${d.slots[sl]} <span class="muted">· ${list.length}</span></h3>
        ${list.map((o) => `<div class="cal-item ${o.status === 'delivered' ? 'done' : ''}">
          <div><a href="#/commande/${enc(o.id)}"><strong class="mono">${esc(o.id)}</strong></a> ${badge(o.status)}${o.late ? ' <span class="tag danger">en retard</span>' : ''}<br>
            <strong>${esc(o.customer.name)}</strong>${o.customer.phone ? ` · <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a>` : ''}<br>
            <span class="muted">${esc(o.customer.city)}${o.customer.address ? ' · ' + esc(o.customer.address) : ''} · ${o.items} article(s)${o.toCollect ? ` · <b>à encaisser ${fcfa(o.toCollect)}</b>` : ''}</span><br>
            <span class="muted">${o.courierName ? `${icon('truck-duotone')} ${esc(o.courierName)}` : '<span class="tag warn">livreur à choisir</span>'}${!o.callConfirmed && o.status !== 'delivered' ? ' <span class="tag danger">à appeler</span>' : ''}</span></div>
          ${CAN.orders() && o.status !== 'delivered' ? planForm({ id: o.id, planned: { date: o.date, slot: o.slot }, courierName: o.courierName }, d.couriers, { compact: true }) : ''}
        </div>`).join('')}</div>`;
    };
    const others = dayItems.filter((x) => x.kind !== 'order');
    app.innerHTML = pageHead({
      title: 'Calendrier de livraison',
      desc: CAN.courier() ? 'Vos livraisons, jour par jour et par créneau.' : "Planifiez chaque livraison (jour + créneau : matin, après-midi, soir) : le client reçoit une notification, le livreur voit l'ordre de sa tournée. Les arrivées des fournisseurs (bons de commande) apparaissent aussi.",
      actions: `<div class="row" style="gap:6px"><a class="ghost" href="#/calendrier/${prev}">${icon('caret-left')}</a><strong style="min-width:150px;text-align:center;text-transform:capitalize">${esc(monthName)}</strong><a class="ghost" href="#/calendrier/${next}">${icon('caret-right')}</a><a class="btn ghost" href="#/calendrier/${d.today.slice(0, 7)}" data-today>Aujourd'hui</a></div>`,
    })
      + (d.overdue.length && CAN.orders() ? `<div class="alert warn">${icon('clock-countdown-duotone')} ${d.overdue.length} livraison(s) planifiée(s) à une date passée et pas encore livrée(s) : ${d.overdue.slice(0, 5).map((o) => `<a href="#/commande/${enc(o.id)}">${esc(o.id)}</a> (${frDate(o.date)})`).join(', ')}. Déplacez-les.</div>` : '')
      + `<div class="cal-layout">
        <div class="panel cal-month"><div class="cal-head">${['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((x) => `<span>${x}</span>`).join('')}</div><div class="cal-grid">${cells.join('')}</div>
          <p class="cal-legend"><i class="sl-morning"></i> matin <i class="sl-afternoon"></i> après-midi <i class="sl-evening"></i> soir${CAN.admin() ? ' <i class="sl-purchase"></i> arrivée fournisseur' : ''}</p></div>
        <div class="panel cal-day" id="calDay"><h2>${icon('clock-bold')} ${new Date(sel + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}${sel === d.today ? ' <span class="tag ok">aujourd\'hui</span>' : ''}</h2>
          ${dayOrders.length ? ['morning', 'afternoon', 'evening'].map(slotBlock).join('') : '<p class="muted">Aucune livraison ce jour-là.</p>'}
          ${others.length ? `<h3 style="margin-top:14px">Autres arrivées</h3><ul class="mini-list">${others.map((x) => x.kind === 'purchase' ? `<li><span><i class="sl-purchase"></i> Fournisseur : <a href="#/achat/${enc(x.id)}">${esc(x.number)}</a> — ${esc(x.supplier)}</span></li>` : '').join('')}</ul>` : ''}
        </div></div>`
      + (CAN.orders() ? `<div class="panel"><h2>${icon('package')} À planifier <span class="muted" style="font-weight:400">· ${d.unplanned.length} commande(s) payée(s) sans date de livraison</span></h2>
          ${d.unplanned.length ? `<div class="cal-unplanned">${d.unplanned.map((o) => `<div class="cal-item"><div><a href="#/commande/${enc(o.id)}"><strong class="mono">${esc(o.id)}</strong></a> ${badge(o.status)}<br><strong>${esc(o.customer.name)}</strong> · ${esc(o.customer.city)} · ${o.items} article(s)<br><span class="muted">payée le ${date(o.paidAt).split(' ')[0]}${o.courierName ? ` · ${esc(o.courierName)}` : ''}${!o.callConfirmed ? ' · <span class="tag danger">à appeler</span>' : ''}</span></div>${planForm(o, d.couriers, { compact: true })}</div>`).join('')}</div>` : '<p class="muted" style="margin:0">Tout est planifié.</p>'}</div>` : '');
    app.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => { state.calDay = b.dataset.day; viewCalendar(monthKey); $('#calDay')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }));
    app.querySelector('[data-today]')?.addEventListener('click', () => { state.calDay = d.today; });
    bindPlanForms(app, () => viewCalendar(monthKey));
    // Date par défaut des formulaires « à planifier » : le jour sélectionné (s'il n'est pas passé), sinon demain
    app.querySelectorAll('.cal-unplanned input[type=date]').forEach((i) => { if (!i.value) i.value = sel >= d.today ? sel : addDays(d.today, 1); });
  }

  // ---------- Colis : étiquettes avec QR code, scan au téléphone, étapes ----------
  const PCL_STAGES = { preparing: 'À préparer', ready: 'Prêt (emballé)', with_courier: 'Chez le livreur', at_relay: 'Au point relais', delivered: 'Remis au client', returned: 'Retour en stock' };
  const PCL_TAG = { preparing: 'warn', ready: '', with_courier: 'info', at_relay: 'info', delivered: 'ok', returned: 'danger' };
  const pclTag = (st) => `<span class="tag ${PCL_TAG[st] || ''}">${esc(PCL_STAGES[st] || st)}</span>`;
  const PCL_ACTIONS = {
    prepare: ['Préparé (emballé)', 'check-bold'], to_courier: ['Remis au livreur', 'truck'], take: ['Je prends le colis', 'truck'],
    at_relay: ['Arrivé au point relais', 'storefront'], handover: ['Remis au client', 'hand-coins-duotone'], back: ["Revenu à l'entrepôt", 'arrow-counter-clockwise'],
  };
  const labelsUrl = (q) => `/api/admin/parcels/labels?${q}`;
  const pclNumber = (text) => (String(text || '').match(/KM-\d{6}-\d{3,}/i) || [String(text || '').trim()])[0].toUpperCase();
  const since = (iso) => { const h = (Date.now() - Date.parse(iso)) / 3600000; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} j`; };
  const pclDest = (p) => p.order ? (p.order.fulfillment === 'pickup'
    ? `${icon('storefront')} ${esc(p.order.relay?.name || 'Point relais')}<br><span class="muted">${esc(p.order.customer.name)}</span>`
    : `${icon('house')} ${esc(p.order.customer.city || 'Livraison')}<br><span class="muted">${esc(p.order.customer.name)}</span>`) : '—';
  let pclMeta = { couriers: [], relays: [] };
  async function loadPclMeta() { try { const r = await api('/parcels'); pclMeta = { couriers: r.couriers, relays: r.relays }; return r; } catch { return null; } }

  async function viewParcels() {
    const r = await loadPclMeta();
    if (!r) return;
    const list = r.parcels;
    const f = state.pclFilter || (CAN.courier() ? 'all' : 'preparing');
    const TABS = [['preparing', 'À préparer'], ['ready', 'Prêts'], ['with_courier', 'Chez le livreur'], ['at_relay', 'Au point relais'], ['done', 'Terminés (7 j)'], ['all', 'Tous']];
    const match = (p, k) => k === 'all' || p.stage === k || (k === 'done' && ['delivered', 'returned'].includes(p.stage));
    const shown = list.filter((p) => match(p, f));
    const late = list.filter((p) => p.stale);
    app.innerHTML = pageHead({
      title: 'Colis',
      desc: CAN.courier() ? 'Les colis de vos livraisons. Scannez le QR code de l\'étiquette quand vous prenez un colis.' : "Un colis est créé automatiquement pour chaque commande payée. Imprimez l'étiquette (QR code), collez-la, puis <strong>scannez</strong> à chaque étape : préparé, remis au livreur, arrivé au point relais, remis au client (avec son code). Le client est prévenu quand son colis l'attend au point relais.",
      actions: `<a class="btn" href="#/scanner">${icon('camera-bold')} Scanner</a>${CAN.orders() && shown.some((p) => p.stage === 'preparing' || p.stage === 'ready') ? `<a class="btn ghost" target="_blank" rel="noopener" href="${labelsUrl('ids=' + shown.filter((p) => ['preparing', 'ready'].includes(p.stage)).map((p) => enc(p.id)).join(','))}">${icon('download-simple-bold')} Étiquettes de cet onglet</a>` : ''}`,
    })
      + (late.length ? `<div class="alert warn">${icon('clock-countdown-duotone')} ${late.length} colis attend${late.length > 1 ? 'ent' : ''} depuis trop longtemps à la même étape : ${late.slice(0, 6).map((p) => `<a href="#/colis/${enc(p.number)}">${esc(p.number)}</a> (${esc(PCL_STAGES[p.stage]).toLowerCase()} depuis ${p.stale} h)`).join(', ')}${late.length > 6 ? '…' : ''}</div>` : '')
      + tabsBar(TABS.map(([k, l]) => [k, l, list.filter((p) => match(p, k)).length]), f, 'pf')
      + '<div id="tbl"></div>';
    app.querySelectorAll('[data-pf]').forEach((b) => b.addEventListener('click', () => { state.pclFilter = b.dataset.pf; viewParcels(); }));
    dataTable($('#tbl'), {
      id: 'parcels', rows: shown, defaultSort: 'stageAt', placeholder: 'Numéro, commande, client', empty: 'Aucun colis ici.',
      searchText: (p) => `${p.number} ${p.orderId} ${p.order?.customer.name} ${p.order?.customer.phone} ${p.order?.relay?.name || ''}`,
      columns: [
        { key: 'number', label: 'Colis', render: (p) => `<a href="#/colis/${enc(p.number)}"><strong class="mono">${esc(p.number)}</strong></a><br><span class="muted">${p.index}/${p.count}</span>${p.stale ? ` <span class="tag danger">${p.stale} h</span>` : ''}` },
        { key: 'stageAt', label: 'Étape', render: (p) => `${pclTag(p.stage)}<br><span class="muted">depuis ${since(p.stageAt)}${p.place?.type === 'courier' ? ` · ${esc(p.place.name)}` : ''}</span>` },
        { key: 'dest', label: 'Destination', sortable: false, render: pclDest },
        { key: 'orderId', label: 'Commande', render: (p) => (CAN.orders() ? `<a href="#/commande/${enc(p.orderId)}">${esc(p.orderId)}</a>` : esc(p.orderId)) + (p.order?.toCollect ? `<br><span class="tag warn">à encaisser ${fcfa(p.order.toCollect)}</span>` : '') },
        { key: 'act', label: '', sortable: false, render: (p) => `<div class="cell-actions"><a class="ghost" href="#/colis/${enc(p.number)}">Ouvrir</a>${CAN.orders() ? `<a class="ghost" target="_blank" rel="noopener" href="${labelsUrl('ids=' + enc(p.id))}">${icon('download-simple-bold')} Étiquette</a>` : ''}</div>` },
      ],
    });
  }

  // Formulaire d'une action (choix du livreur, du point relais, code du client)
  function pclActionForm(p, a) {
    const [label, ic] = PCL_ACTIONS[a];
    if (a === 'to_courier') return `<div class="pcl-act"><select data-pcl-courier>${pclMeta.couriers.map((c) => `<option value="${esc(c.id)}" ${c.id === p.order?.courierId ? 'selected' : ''}>${esc(c.name)}</option>`).join('') || '<option value="">Aucun livreur actif</option>'}</select><button class="btn" data-pcl-do="to_courier">${icon(ic)} ${label}</button></div>`;
    if (a === 'at_relay') return `<div class="pcl-act"><select data-pcl-relay>${pclMeta.relays.map((r) => `<option value="${esc(r.id)}" ${r.id === p.order?.relay?.id ? 'selected' : ''}>${esc(r.name)}${r.id === p.order?.relay?.id ? ' (choisi par le client)' : ''}</option>`).join('')}</select><button class="btn" data-pcl-do="at_relay">${icon(ic)} ${label}</button></div>`;
    if (a === 'handover') return `<div class="pcl-act"><input type="text" inputmode="numeric" maxlength="4" placeholder="Code du client (4 chiffres)" data-pcl-code autocomplete="off"><button class="btn green" data-pcl-do="handover">${icon(ic)} ${label}</button></div>`;
    return `<div class="pcl-act"><button class="btn ${a === 'back' ? 'ghost' : ''}" data-pcl-do="${a}">${icon(ic)} ${label}</button></div>`;
  }
  async function doParcelAction(p, a, host) {
    const body = { action: a };
    if (a === 'to_courier') body.courierId = host.querySelector('[data-pcl-courier]')?.value;
    if (a === 'at_relay') body.agencyId = host.querySelector('[data-pcl-relay]')?.value;
    if (a === 'handover') body.code = host.querySelector('[data-pcl-code]')?.value;
    return api(`/parcels/${enc(p.id)}/action`, { method: 'POST', body });
  }
  function pclCard(p, { compact = false } = {}) {
    const o = p.order;
    return `<div class="pcl-card">
      <div class="pcl-top"><div><span class="muted">Colis ${p.index}/${p.count}</span><h2 class="mono">${esc(p.number)}</h2></div>${pclTag(p.stage)}</div>
      ${o ? `<div class="pcl-dest ${o.fulfillment}">
        <strong>${o.fulfillment === 'pickup' ? `${icon('storefront')} Retrait : ${esc(o.relay?.name || 'Point relais')}` : `${icon('house')} Livraison à domicile`}</strong>
        <span>${esc(o.customer.name)} · ${esc(o.customer.phone)}${o.customer.address ? ` · ${esc(o.customer.address)}` : ''}${o.customer.city ? ` · ${esc(o.customer.city)}` : ''}</span>
        <span class="muted">Commande ${CAN.orders() ? `<a href="#/commande/${enc(p.orderId)}">${esc(p.orderId)}</a>` : esc(p.orderId)} · ${o.items} article(s)${o.courierName ? ` · livreur : ${esc(o.courierName)}` : ''}</span>
        ${o.toCollect ? `<span class="tag warn">À encaisser à la remise : ${fcfa(o.toCollect)}</span>` : ''}
        ${p.relay && o.relay && p.relay.id !== o.relay.id ? `<span class="tag danger">Déposé à ${esc(p.relay.name)} au lieu de ${esc(o.relay.name)}</span>` : ''}
      </div>` : ''}
      ${p.actions.length ? `<div class="pcl-acts">${p.actions.map((a) => pclActionForm(p, a)).join('')}</div>` : `<p class="muted" style="margin:8px 0 0">${p.stage === 'with_courier' && CAN.courier() ? 'Remise au client : depuis « Mes livraisons » (code du client).' : p.stage === 'with_courier' ? 'Remise au client : par le livreur (« Mes livraisons ») ou depuis la commande, avec le code du client.' : 'Aucune action à faire.'}</p>`}
      <div class="pcl-msg"></div>
      ${compact ? '' : `<h3>Historique</h3><ol class="pcl-hist">${[...(p.history || [])].reverse().map((h) => `<li><b>${esc(PCL_STAGES[h.stage] || h.stage)}</b>${h.place ? ` — ${esc(h.place)}` : ''}<br><span class="muted">${date(h.at)} · ${esc(h.byName || '')}${h.note ? ` · ${esc(h.note)}` : ''}</span></li>`).join('')}</ol>`}
    </div>`;
  }
  function bindPclCard(host, p, after) {
    host.querySelectorAll('[data-pcl-do]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const np = await doParcelAction(p, b.dataset.pclDo, host); toast(`${np.number} : ${PCL_STAGES[np.stage]} ✓`); after(np); }
      catch (err) { host.querySelector('.pcl-msg').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; b.disabled = false; }
    }));
  }
  async function viewParcel(number) {
    let p;
    if (!pclMeta.couriers.length && !pclMeta.relays.length && CAN.orders()) await loadPclMeta();
    try { p = await api('/parcels/lookup?code=' + enc(number)); }
    catch (err) { app.innerHTML = `<p><a href="#/colis">‹ Tous les colis</a></p><div class="alert err">${esc(err.message)}</div>`; return; }
    app.innerHTML = `<p><a href="#/colis">‹ Tous les colis</a></p>
      <div class="row between" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><span></span><span class="row" style="gap:8px">
        <a class="btn ghost" href="#/scanner">${icon('camera-bold')} Scanner</a>
        ${CAN.orders() ? `<a class="btn ghost" target="_blank" rel="noopener" href="${labelsUrl('ids=' + enc(p.id))}">${icon('download-simple-bold')} Étiquette</a>` : ''}</span></div>
      <div class="panel" id="pclHost">${pclCard(p)}</div>`;
    bindPclCard($('#pclHost'), p, () => route({ keep: true }));
  }

  // Bloc « Colis » de la fiche commande
  function parcelsPanel(o) {
    const list = o.parcels || [];
    const ready = ['paid', 'confirmed', 'shipped'].includes(o.status);
    if (!list.length && !ready) return '';
    return `<div class="panel">
      <h2>${icon('package')} Colis</h2>
      ${list.length ? `<ul class="doc-list">${list.map((p) => `<li><span><a href="#/colis/${enc(p.number)}"><strong class="mono">${esc(p.number)}</strong></a> ${pclTag(p.stage)}<br><span class="muted">Colis ${p.index}/${list.length} · ${esc(p.place?.name || '')} · depuis ${since(p.stageAt)}</span></span>
        <div class="cell-actions"><a class="ghost" href="#/colis/${enc(p.number)}">Ouvrir</a></div></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Aucun colis pour le moment.</p>'}
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
        ${list.length ? `<a class="btn" target="_blank" rel="noopener" href="${labelsUrl('order=' + enc(o.id))}">${icon('download-simple-bold')} Imprimer ${list.length > 1 ? 'les étiquettes' : "l'étiquette"}</a>` : ''}
        ${ready ? `<button class="ghost" data-pcl-add="${esc(o.id)}">${icon('plus-bold')} ${list.length ? 'Ajouter un colis (plusieurs cartons)' : 'Créer le colis'}</button>` : ''}
      </div></div>`;
  }
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pcl-add]');
    if (!b) return;
    b.disabled = true;
    try { await api(`/parcels/order/${enc(b.dataset.pclAdd)}`, { method: 'POST', body: {} }); await loadOrders(); route({ keep: true }); }
    catch (err) { alert(err.message); b.disabled = false; }
  });

  // ---------- Scanner : caméra du téléphone, codes-barres (CODE 128) et QR codes ----------
  // Lecteur intégré au téléphone (BarcodeDetector, Android) ; sinon ZXing (iPhone…, chargé à la demande depuis
  // public/admin/vendor/zxing/) ; en dernier recours jsQR (QR seulement). Une douchette (lecteur Bluetooth / USB)
  // tape le numéro dans le champ de saisie : elle marche aussi.
  let scan = null;
  function stopScanner() {
    if (!scan) return;
    scan.stop = true;
    scan.stream?.getTracks().forEach((t) => t.stop());
    scan = null;
  }
  const loadZXing = () => window.ZXing ? Promise.resolve() : new Promise((ok, ko) => { const s = document.createElement('script'); s.src = '/admin/vendor/zxing/zxing.min.js'; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  const loadJsQR = () => window.jsQR ? Promise.resolve() : new Promise((ok, ko) => { const s = document.createElement('script'); s.src = '/admin/vendor/jsqr/jsQR.js'; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  function beep(good) {
    try { navigator.vibrate?.(good ? 70 : [60, 60, 60]); } catch {}
    try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(); const g = ac.createGain(); o.frequency.value = good ? 1046 : 220; g.gain.value = .08; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (good ? .12 : .3)); setTimeout(() => ac.close(), 500); } catch {}
  }
  // Livreur : colis scanné chez le client → bon colis vérifié, autres colis de la commande, encaissement, code du client
  function showHandover(out, p) {
    const o = p.order || {}; const c = o.customer || {};
    state.scanned = state.scanned || {}; (state.scanned[p.orderId] = state.scanned[p.orderId] || new Set()).add(p.number);
    const seen = state.scanned[p.orderId];
    const sib = p.siblings || [{ number: p.number, index: 1 }];
    const missing = sib.filter((x) => !seen.has(x.number) && x.stage !== 'delivered');
    if (o.status !== 'shipped') { out.innerHTML = `<div class="alert err"><strong>${esc(p.number)}</strong> : cette commande n'est pas en livraison (${esc(state.labels?.[o.status] || o.status || '')}).</div>`; return; }
    out.innerHTML = `<div class="panel scan-card handover">
      <div class="row between"><span class="tag ok">${icon('check-bold')} Bon colis</span><span class="mono">${esc(p.number)} · ${p.index}/${p.count}</span></div>
      <h3 style="margin:8px 0 2px">${esc(c.name)}</h3><p class="muted" style="margin:0">${esc(c.address || '')} ${c.city ? '· ' + esc(c.city) : ''}</p>
      ${sib.length > 1 ? `<ul class="hand-list">${sib.map((x) => `<li class="${seen.has(x.number) ? 'ok' : ''}">${icon(seen.has(x.number) ? 'check-bold' : 'package')} <span class="mono">${esc(x.number)}</span> ${seen.has(x.number) ? 'scanné' : '<b>à scanner</b>'}</li>`).join('')}</ul>` : ''}
      <form class="deliver-form" id="handForm">
        ${o.toCollect ? `<p><strong>À encaisser : ${fcfa(o.toCollect)}</strong></p><div class="row"><label class="check"><input type="radio" name="collect" value="cash" checked> Espèces</label><label class="check"><input type="radio" name="collect" value="momo"> Mobile Money du client</label></div><input type="tel" name="phone" placeholder="Autre numéro Mobile Money (facultatif)">` : '<p class="muted">Déjà payée : rien à encaisser.</p>'}
        <label>Code de livraison donné par le client</label>
        <input class="code-input-pro" name="code" inputmode="numeric" maxlength="4" placeholder="• • • •" autocomplete="off">
        <div class="msg"></div>
        <button class="btn green">${icon('check-bold')} Valider la remise</button>
      </form></div>`;
    const form = out.querySelector('#handForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (missing.length && !confirm(`Il manque ${missing.length} colis de cette commande (${missing.map((x) => x.number).join(', ')}).\n\nRemettre quand même ?`)) return;
      const f = new FormData(form); const msg = form.querySelector('.msg');
      try {
        const res = await api('/courier/deliveries/' + enc(p.orderId) + '/deliver', { method: 'POST', body: { code: f.get('code'), collect: f.get('collect') || undefined, phone: f.get('phone') || undefined } });
        const done = () => { beep(true); delete state.scanned[p.orderId]; state.scanExpect = null; out.innerHTML = `<div class="alert ok">${icon('check-bold')} Commande ${esc(p.orderId)} remise à ${esc(c.name.split(' ')[0])}. Merci !</div><a class="btn" href="#/livraisons" style="margin-top:8px">Mes livraisons</a>`; };
        if (res.pending) return waitBalance(res, '/courier/payments/', msg, done);
        done();
      } catch (err) { beep(false); msg.innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
    });
    form.querySelector('[name=code]').focus({ preventScroll: true });
  }

  async function viewScanner() {
    if (CAN.orders() && !pclMeta.couriers.length && !pclMeta.relays.length) await loadPclMeta();
    const MODES = CAN.courier() ? [['deliver', 'Remettre au client'], ['take', 'Je prends le colis'], ['look', 'Consulter']]
      : [['look', 'Consulter'], ['prepare', 'Préparé'], ['to_courier', 'Remis au livreur'], ['at_relay', 'Au point relais']];
    const mode = MODES.some(([k]) => k === state.scanMode) ? state.scanMode : MODES[0][0];
    state.scanMode = mode;
    const expect = mode === 'deliver' && state.scanExpect ? state.scanExpect : null;
    app.innerHTML = pageHead({ crumb: 'Colis', title: 'Scanner', desc: CAN.courier()
      ? "Visez le code-barres (ou le QR code) de l'étiquette. « Remettre au client » : vérifie que c'est le bon colis, puis vous validez avec le code du client. « Je prends le colis » : à l'entrepôt, scannez chaque colis que vous emportez."
      : "Visez le code-barres (ou le QR code) de l'étiquette. En mode « Consulter », le colis s'ouvre ; dans les autres modes, l'étape est enregistrée à chaque scan (pratique pour une pile de colis)." })
      + `<div class="scan-modes">${MODES.map(([k, l]) => `<button class="tab ${k === mode ? 'on' : ''}" data-smode="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="scan-opts">
        ${mode === 'to_courier' ? `<label>Livreur <select id="scanCourier">${pclMeta.couriers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('') || '<option value="">Aucun livreur actif</option>'}</select></label>` : ''}
        ${mode === 'at_relay' ? `<label>Point relais <select id="scanRelay"><option value="">Celui choisi par le client</option>${pclMeta.relays.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label>` : ''}
      </div>
      ${expect ? `<div class="alert info scan-expect">${icon('package')} Scannez le colis de la commande <strong class="mono">${esc(expect)}</strong> <button type="button" class="linkish" id="scanAny">Scanner un autre colis</button></div>` : ''}
      <div class="scan-cam"><video id="scanVideo" playsinline muted></video><div class="scan-frame bar"></div><p class="scan-hint" id="scanHint">Ouverture de la caméra…</p></div>
      <form class="scan-manual" id="scanManual"><input type="text" id="scanInput" placeholder="Ou tapez le numéro (KM-…) · douchette : scannez ici" autocomplete="off" autocapitalize="characters" enterkeyhint="go"><button class="btn">OK</button></form>
      <div id="scanResult"></div>
      <ul class="scan-log" id="scanLog"></ul>`;
    app.querySelectorAll('[data-smode]').forEach((b) => b.addEventListener('click', () => { state.scanMode = b.dataset.smode; stopScanner(); viewScanner(); }));
    $('#scanAny')?.addEventListener('click', () => { state.scanExpect = null; stopScanner(); viewScanner(); });
    if (matchMedia('(pointer: fine)').matches) $('#scanInput').focus(); // ordinateur + douchette : prêt à lire
    const handle = async (raw) => {
      const number = pclNumber(raw);
      const out = $('#scanResult');
      if (!out) return;
      const m = state.scanMode && MODES.some(([k]) => k === state.scanMode) ? state.scanMode : 'look';
      try {
        if (m === 'deliver') {
          const p = await api('/parcels/lookup?code=' + enc(number));
          if (expect && p.orderId !== expect) { beep(false); out.innerHTML = `<div class="alert err">${icon('warning-duotone')} <strong>Mauvais colis.</strong> ${esc(p.number)} est pour ${esc((p.order?.customer.name || '').split(' ')[0] || 'une autre commande')} (${esc(p.orderId)}), pas pour la commande ${esc(expect)}.</div>`; return; }
          beep(true);
          showHandover(out, p);
        } else if (m === 'look') {
          const p = await api('/parcels/lookup?code=' + enc(number));
          beep(true);
          out.innerHTML = `<div class="panel scan-card">${pclCard(p, { compact: true })}<a class="btn ghost" href="#/colis/${enc(p.number)}" style="margin-top:8px">Ouvrir la fiche</a></div>`;
          bindPclCard(out, p, (np) => { out.innerHTML = `<div class="alert ok">${esc(np.number)} : ${esc(PCL_STAGES[np.stage])} ✓</div>`; });
        } else {
          const body = { action: m, courierId: $('#scanCourier')?.value, agencyId: $('#scanRelay')?.value || undefined };
          const p = await api(`/parcels/${enc(number)}/action`, { method: 'POST', body });
          beep(true);
          out.innerHTML = `<div class="alert ok">${icon('check-bold')} <strong>${esc(p.number)}</strong> : ${esc(PCL_STAGES[p.stage])}${p.order ? ` — ${esc(p.order.customer.name)}` : ''}</div>`;
          $('#scanLog')?.insertAdjacentHTML('afterbegin', `<li><span class="mono">${esc(p.number)}</span> ${pclTag(p.stage)} <span class="muted">${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span></li>`);
        }
      } catch (err) {
        beep(false);
        out.innerHTML = `<div class="alert err"><strong>${esc(number)}</strong> : ${esc(err.message)}</div>`;
      }
    };
    $('#scanManual').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#scanInput').value; if (v.trim()) { handle(v); $('#scanInput').value = ''; } });
    // Caméra arrière ; analyse ~4 images par seconde
    stopScanner();
    const me = scan = { stop: false, last: '', lastAt: 0 };
    const video = $('#scanVideo');
    try {
      me.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    } catch {
      $('#scanHint').textContent = "Caméra indisponible (autorisez-la dans le navigateur) : tapez le numéro ci-dessous, ou scannez avec l'appareil photo du téléphone (le QR ouvre la fiche du colis).";
      return;
    }
    if (me.stop) { me.stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = me.stream; await video.play().catch(() => {});
    $('#scanHint').textContent = 'Visez le code-barres ou le QR code du colis';
    let detector = null, zx = null;
    try {
      if ('BarcodeDetector' in window) {
        const f = await BarcodeDetector.getSupportedFormats();
        if (f.includes('code_128')) detector = new BarcodeDetector({ formats: ['code_128', 'qr_code'].filter((x) => f.includes(x)) });
      }
    } catch {}
    if (!detector) {
      try {
        await loadZXing();
        zx = new ZXing.MultiFormatReader();
        zx.setHints(new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.QR_CODE]]]));
      } catch {
        try { await loadJsQR(); $('#scanHint').textContent = 'Visez le QR code du colis (lecteur de code-barres indisponible)'; } catch { $('#scanHint').textContent = 'Lecteur indisponible : tapez le numéro.'; return; }
      }
    }
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (me.stop || scan !== me) return;
      if (video.readyState >= 2) {
        let text = null;
        try {
          if (detector) { const r = await detector.detect(video); text = r[0]?.rawValue || null; }
          else if (zx) {
            const w = Math.min(960, video.videoWidth), h = Math.round(video.videoHeight * (w / video.videoWidth));
            canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
            try { text = zx.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)))).getText(); } catch { text = null; } finally { zx.reset(); }
          } else {
            const w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * (w / video.videoWidth));
            canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
            const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            text = r?.data || null;
          }
        } catch {}
        if (text && /KM-\d{6}-\d{3,}/i.test(text) && !(text === me.last && Date.now() - me.lastAt < 3000)) { me.last = text; me.lastAt = Date.now(); await handle(text); }
      }
      setTimeout(tick, 250);
    };
    tick();
  }

  // ---------- Factures, reçus, avoirs (créés automatiquement, jamais modifiés ni supprimés) ----------
  const DOC_TAG = { invoice: ['Facture', 'ok'], receipt: ['Reçu', 'info'], credit: ['Avoir', 'danger'] };
  const docPrint = (d, ticket) => `/api/admin/documents/${enc(d.id)}/print${ticket ? '?format=ticket' : ''}`;
  const docWa = (d) => {
    if (!d.customer?.phone) return '';
    const first = (d.customer.name || '').split(' ')[0];
    const what = d.type === 'receipt' ? `votre reçu de paiement n° ${d.number} (${fcfa(d.amount)})` : d.type === 'credit' ? `votre avoir n° ${d.number}` : `votre facture n° ${d.number} (${fcfa(d.amount)})`;
    const msg = `Bonjour ${first}, merci pour votre achat sur Zado ! Voici ${what} pour la commande ${d.orderId} : ${location.origin}${d.link}`;
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
  const thumb = (p) => (p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="thumb">${catIcon(p.category)}</span>`);
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
      { key: 'name', label: 'Produit', sortValue: (p) => norm(p.name), render: (p) => `<div class="cell-prod">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="ph">${catIcon(p.category)}</span>`}<span><strong>${esc(p.name)}</strong>${p.featured ? ' <span class="tag">⭐</span>' : ''}<br><span class="muted">${esc(p.brand || '')}</span></span></div>` },
      { key: 'category', label: 'Catégorie' },
    ];
    if (!isSupplier()) columns.push({ key: 'supplierName', label: 'Fournisseur', render: (p) => esc(p.supplierName || 'Zado') });
    if (!isSupplier()) columns.push({ key: 'price', label: 'Prix de vente', cls: 'num', render: (p) => (p.price ? fcfa(p.price) : '<span class="muted">à fixer</span>') });
    if (role() !== 'catalog') columns.push({ key: 'supplierPrice', label: isSupplier() ? 'Votre prix' : 'Prix fournisseur', cls: 'num', render: (p) => (p.supplierPrice != null ? fcfa(p.supplierPrice) : '—') });
    columns.push({ key: 'stock', label: 'Stock', cls: 'num', render: (p) => (p.stock === 0 ? `<strong style="color:var(--err)">0</strong>` : p.stock) });
    columns.push({ key: 'status', label: 'Statut', sortValue: (p) => (p.pending ? 0 : p.active === false ? 1 : 2), render: statusTag });
    app.innerHTML = pageHead({
      title: isSupplier() ? 'Mes produits' : 'Produits',
      desc: isSupplier() ? 'Vos produits sur Zado : stock et prix. Les nouveaux produits sont publiés après validation.' : 'Le catalogue de la boutique. Cliquez sur un produit pour le modifier.',
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
      ${limited ? '<div class="alert warn">Produit publié : vous pouvez modifier le <strong>stock</strong> et <strong>votre prix</strong>. Pour le reste, contactez Zado.</div>' : ''}
      <form class="panel" id="pform" novalidate>
        <h2>Photos</h2>
        <div class="gallery" id="gallery"></div>
        ${limited ? '' : `
        <div class="row" style="margin-top:8px">
          <label class="btn dark" style="margin:0" for="camera">${icon('camera-bold')} Prendre une photo</label>
          <label class="ghost" style="margin:0" for="files">${icon('image-square')} Choisir des photos</label>
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
        <label for="specs">Caractéristiques (une par ligne)</label>
        <textarea id="specs" rows="4" placeholder="Couleur : Noir&#10;Capacité : 128 Go&#10;Taille : M" ${dis}>${esc((p.specs || []).map((x) => `${x.label} : ${x.value}`).join('\n'))}</textarea>

        <h2 style="margin-top:18px">Prix et disponibilité</h2>
        <div class="grid2">
          ${showSale ? `<div><label for="price">Prix de vente (FCFA)${p.pending || isNew ? '' : ' *'}</label><input id="price" type="number" inputmode="numeric" min="1" step="1" value="${esc(p.price ?? '')}"></div>
          <div><label for="oldPrice">Prix barré (facultatif)</label><input id="oldPrice" type="number" inputmode="numeric" min="1" step="1" value="${esc(p.oldPrice ?? '')}"></div>` : ''}
          ${showSupplierPrice ? `<div><label for="supplierPrice">${isSupplier() ? 'Votre prix (FCFA) *' : 'Prix fournisseur (FCFA)'}</label><input id="supplierPrice" type="number" inputmode="numeric" min="0" step="1" value="${esc(p.supplierPrice ?? '')}"></div>` : ''}
          ${isAdmin() ? `<div><label for="costPrice">Prix d'achat Zado (FCFA)</label><input id="costPrice" type="number" inputmode="numeric" min="0" step="1" value="${esc(p.costPrice ?? '')}" placeholder="pour le stock Zado"></div>` : ''}
          <div><label for="stock">Stock disponible *</label><input id="stock" type="number" inputmode="numeric" min="0" step="1" value="${esc(p.stock)}"></div>
        </div>
        ${isAdmin() ? '<p class="muted">Prix d\'achat : ce que Zado a payé ce produit (stock propre à Zado). Il sert au calcul de la marge dans Finances et reste invisible pour les clients et l\'équipe.</p>' : ''}
        ${isAdmin() && margin != null ? `<p class="muted">Marge actuelle : <strong>${fcfa(margin)}</strong> par article.</p>` : ''}
        ${isSupplier() ? '<p class="muted">Zado fixe le prix de vente aux clients. Mettez le stock à 0 si le produit n\'est plus disponible.</p>' : ''}
        ${isAdmin() ? `<label for="supplierId">Fournisseur</label>
          <select id="supplierId"><option value="">Aucun (stock Zado)</option>${[
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
        : `<div class="gal-empty">${catIcon($('#category')?.value)}<br><span class="muted">Pas encore de photo</span></div>`;
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
        } catch (err) { $('#photoHint').textContent = 'Erreur : ' + err.message; renderGallery(); }
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
              hint.textContent = 'Attention : ' + err.message;
              res = await api('/uploads', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
            }
          } else {
            res = await api('/uploads', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
          }
          images.push(res.url);
          renderGallery();
          hint.textContent = res.found === false ? 'Photo ajoutée, mais aucun produit net détecté : vérifiez le résultat.' : res.found ? 'Photo détourée et ajoutée ✓ Pensez à enregistrer.' : `Photo ajoutée (${Math.round(blob.size / 1024)} Ko). Pensez à enregistrer.`;
        } catch (err) {
          hint.textContent = 'Erreur : ' + err.message;
        }
      }
    };
    $('#camera')?.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

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
    const active = (o) => ['paid', 'confirmed'].includes(o.status);
    const toPrepare = data.orders.filter((o) => active(o) && !o.ready);
    app.innerHTML = pageHead({ title: 'Mes commandes', desc: "Zado s'occupe de la livraison. Préparez les articles des commandes payées, puis cliquez « Prêt à récupérer » : Zado est prévenu et vient les chercher." })
      + `<div class="todo"><a href="#/fournisseur">${icon('package-duotone')} À préparer : ${toPrepare.reduce((n, o) => n + qty(o), 0)} article(s)</a><a href="#/messagerie">${icon('chats-circle-duotone')} Écrire à Zado</a></div><div id="tbl"></div>`;
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
        { key: 'ready', label: 'Préparation', sortValue: (o) => (active(o) ? (o.ready ? 1 : 0) : 2), render: (o) => !active(o) ? '<span class="muted">—</span>'
          : o.ready ? `<span class="cell-stack"><span class="tag ok">${icon('check-bold')} Prêt le ${date(o.ready.at)}</span>${o.ready.note ? `<br><span class="muted">${esc(o.ready.note)}</span>` : ''}<br><button class="linkish" data-unready="${esc(o.id)}">Annuler</button></span>`
          : `<button class="btn small" data-ready="${esc(o.id)}">${icon('check-bold')} Prêt à récupérer</button>` },
      ],
    });
    const mark = async (id, ready) => {
      let note = '';
      if (ready) { note = prompt('Où et quand Zado peut-il récupérer les articles ? (facultatif)\nEx. au magasin, à partir de 14 h', ''); if (note === null) return; }
      try { await api('/supplier/orders/' + enc(id) + '/ready', { method: 'POST', body: { ready, note } }); toast(ready ? 'Zado est prévenu : articles prêts ✓' : 'Signal annulé'); viewSupplierOrders(); }
      catch (err) { toast('❌ ' + err.message); }
    };
    $('#tbl').addEventListener('click', (e) => { // #tbl est recréé à chaque affichage : un seul écouteur
      const r = e.target.closest('[data-ready], [data-unready]'); if (!r) return;
      e.preventDefault(); e.stopPropagation();
      mark(r.dataset.ready || r.dataset.unready, Boolean(r.dataset.ready));
    });
  }

  // ---------- Avis clients : lecture et modération (admin, catalogue) ----------
  async function viewReviews() {
    let list;
    try { list = await api('/reviews'); } catch { return; }
    const f = state.reviewFilter || 'all';
    const match = (r, k) => k === 'all' || (k === 'low' ? r.rating <= 2 && !r.hidden : k === 'hidden' ? r.hidden : !r.hidden);
    const starsTxt = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
    app.innerHTML = pageHead({ crumb: 'Catalogue', title: 'Avis clients', desc: "Seuls les clients qui ont reçu le produit peuvent donner un avis : ils sont publiés tout de suite. Masquez un avis injurieux ou hors sujet (il reste ici, vous pouvez le réafficher). Répondez aux avis négatifs en appelant le client." })
      + tabsBar([['all', 'Tous'], ['shown', 'Publiés'], ['low', '1-2 étoiles'], ['hidden', 'Masqués']].map(([k, l]) => [k, l, list.filter((r) => match(r, k)).length]), f, 'rf')
      + '<div id="tbl"></div>';
    dataTable($('#tbl'), {
      id: 'reviews', rows: list.filter((r) => match(r, f)), defaultSort: 'date', placeholder: 'Produit, client ou mot du commentaire', empty: 'Aucun avis ici.',
      searchText: (r) => `${r.productName} ${r.name} ${r.text}`,
      columns: [
        { key: 'product', label: 'Produit', sortValue: (r) => norm(r.productName), render: (r) => `<span class="cell-stack"><a href="#/produit/${enc(r.productId)}">${esc(r.productName)}</a><br><span class="muted mono">${esc(r.orderId || '')}</span></span>` },
        { key: 'rating', label: 'Note', cls: 'num', render: (r) => `<span class="rv-stars r${r.rating}" title="${r.rating} sur 5">${starsTxt(r.rating)}</span>` },
        { key: 'text', label: 'Avis', sortable: false, render: (r) => `<span class="cell-stack"><strong>${esc(r.name)}</strong><br>${r.text ? esc(r.text) : '<span class="muted">(sans commentaire)</span>'}</span>` },
        { key: 'date', label: 'Date', sortValue: (r) => r.createdAt, render: (r) => date(r.createdAt) },
        { key: 'state', label: 'État', sortValue: (r) => (r.hidden ? 1 : 0), render: (r) => `<span class="cell-stack">${r.hidden ? `<span class="tag warn">Masqué</span><br><span class="muted">par ${esc(r.hiddenBy || '')}</span><br><button class="linkish" data-rv="${esc(r.id)}" data-h="0">Réafficher</button>` : `<span class="tag ok">Publié</span><br><button class="linkish" data-rv="${esc(r.id)}" data-h="1">Masquer</button>`}</span>` },
      ],
    });
    app.querySelectorAll('[data-rf]').forEach((b) => b.addEventListener('click', () => { state.reviewFilter = b.dataset.rf; viewReviews(); }));
    $('#tbl').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-rv]'); if (!b) return;
      const hidden = b.dataset.h === '1';
      if (hidden && !confirm("Masquer cet avis ? Il ne sera plus visible sur la boutique (vous pourrez le réafficher).")) return;
      try { await api('/reviews/' + enc(b.dataset.rv), { method: 'PATCH', body: { hidden } }); toast(hidden ? 'Avis masqué' : 'Avis réaffiché'); viewReviews(); } catch (err) { toast('❌ ' + err.message); }
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
          </select>
          <div id="companyField"><label for="sCompany">Entreprise du fournisseur *</label><input id="sCompany" type="text" placeholder="Ex. Tech Import Pointe-Noire"></div>
          <label for="sName">Nom de la personne *</label><input id="sName" type="text">
          <label for="sLogin">Identifiant de connexion *</label><input id="sLogin" type="text" autocapitalize="off" placeholder="Ex. paul.mabiala">
          <label for="sPhone">Téléphone</label><input id="sPhone" type="tel">
          <div id="vehicleField" hidden><label for="sVehicle">Véhicule (montré au client pendant la course)</label><input id="sVehicle" type="text" maxlength="60" placeholder="Ex. Moto Haojue rouge · PN 1234 AB"></div>
          <div id="sError"></div>
          <button class="btn" style="width:100%;margin-top:14px">Créer le compte</button>
        </form>`;
      const syncRole = () => { $('#companyField').hidden = $('#sRole').value !== 'supplier'; $('#vehicleField').hidden = $('#sRole').value !== 'courier'; };
      $('#sRole').addEventListener('change', syncRole); syncRole();
      $('#staffForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const res = await api('/staff', { method: 'POST', body: { role: $('#sRole').value, company: $('#sCompany').value, name: $('#sName').value, login: $('#sLogin').value, phone: $('#sPhone').value, vehicle: $('#sVehicle').value } });
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
        { key: 'name', label: 'Nom', sortValue: (u) => norm(u.name), render: (u) => `<span class="cell-stack"><strong>${esc(u.name)}</strong>${u.company ? `<br><span class="muted">${esc(u.company)}</span>` : ''}${u.role === 'courier' ? `<br><span class="muted">${esc(u.vehicle || 'Véhicule non renseigné')}</span>` : ''}</span>` },
        { key: 'role', label: 'Rôle', sortValue: (u) => roleLabel(u.role), render: (u) => esc(roleLabel(u.role)) },
        { key: 'login', label: 'Identifiant', render: (u) => `<code>${esc(u.login)}</code>` },
        { key: 'products', label: 'Produits', cls: 'num', render: (u) => (u.role === 'supplier' ? u.products : '—') },
        { key: 'active', label: 'Statut', sortValue: (u) => u.active !== false, render: (u) => (u.active === false ? '<span class="tag danger">Désactivé</span>' : '<span class="tag ok">Actif</span>') },
        { key: 'act', label: '', sortable: false, render: (u) => `<div class="cell-actions"><button class="ghost" data-toggle="${esc(u.id)}" data-active="${u.active !== false}">${u.active === false ? 'Réactiver' : 'Désactiver'}</button><button class="ghost" data-reset="${esc(u.id)}">${icon('key-bold')} Mot de passe</button>${u.role === 'courier' ? `<button class="ghost" data-vehicle="${esc(u.id)}">${icon('truck-duotone')} Véhicule</button>` : ''}</div>` },
      ],
    });
    $('#tbl').addEventListener('click', async (e) => {
      const t = e.target.closest('[data-toggle]');
      const r = e.target.closest('[data-reset]');
      const v = e.target.closest('[data-vehicle]');
      if (v) {
        const u = data.staff.find((x) => x.id === v.dataset.vehicle);
        const val = prompt('Véhicule du livreur (montré au client pendant la course) :\nType, couleur et plaque, ex. Moto Haojue rouge · PN 1234 AB', u?.vehicle || '');
        if (val === null) return;
        try { await api('/staff/' + enc(u.id), { method: 'PATCH', body: { vehicle: val } }); toast('Véhicule enregistré'); viewStaff(); } catch (err) { toast('❌ ' + err.message); }
        return;
      }
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
    const msg = `Bonjour ${user.name}, voici vos accès à l'espace Zado : ${location.origin}/admin — identifiant : ${user.login} — mot de passe provisoire : ${password} (à changer à la première connexion).`;
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
    const head = pageHead({ title: 'Finances', desc: 'Ventes, dépenses, marge et caisses de Zado. Les ventes s\'ajoutent toutes seules ; saisissez ici les dépenses et les autres mouvements d\'argent.', actions });
    if (sub === 'journal') return viewFinJournal(head);
    if (sub === 'fournisseurs') return viewFinSuppliers(head, d);

    const k = d.kpis;
    const pct = k.revenue ? Math.round((k.grossMargin / k.revenue) * 100) : 0;
    const alerts = [];
    if (d.unknownCostLines) alerts.push(`<div class="alert warn">${icon('warning-duotone')} ${d.unknownCostLines} article(s) vendu(s) sans prix d'achat connu : la marge est surestimée. Renseignez le « Prix d'achat » des produits Zado (fiche produit).</div>`);
    if (d.stockNoCost) alerts.push(`<div class="alert warn">${icon('package-duotone')} ${d.stockNoCost} produit(s) Zado en stock sans prix d'achat : la valeur du stock est incomplète.</div>`);
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
          <ul class="mini-list"><li><span>Valeur du stock Zado</span><strong>${fcfa(k.stockValue)}</strong></li><li><span>À payer aux fournisseurs</span><strong class="${owed ? 'neg' : ''}">${fcfa(owed)}</strong></li><li><span>Livraisons ratées (période)</span><strong class="${k.failedDeliveries ? 'neg' : ''}">${k.failedDeliveries}</strong></li><li><span>Acomptes conservés (colis refusés)</span><strong>${fcfa(k.retainedDeposits)}</strong></li></ul>
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
            <li><b>Marge brute</b> : ventes − prix d'achat des produits vendus (prix fournisseur ou prix d'achat Zado).</li>
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
          { type: 'bar', label: 'Ventes', data: d.monthly.map((x) => x.revenue), backgroundColor: 'rgba(140,182,255,.6)', borderRadius: 6, maxBarThickness: 28, order: 2 },
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
    const pd = d.purchaseDebts || [];
    app.innerHTML = head + finTabs('fournisseurs') + `<h2 style="margin:0 0 4px">Achats (bons de commande)</h2><p class="muted" style="margin-top:0">Articles reçus ou facturés par bon de commande, moins les paiements « Achat de marchandises » rattachés au bon.</p><div id="tblPo"></div>
      <h2 style="margin:22px 0 4px">Dépôt-vente</h2><p class="muted" style="margin-top:0">Ce que Zado doit à chaque fournisseur partenaire : ses produits vendus (au prix fournisseur, toutes périodes) moins les paiements enregistrés (« Paiement fournisseur »).</p><div id="tbl"></div>`;
    dataTable($('#tblPo'), {
      id: 'fin-purchases', rows: pd, defaultSort: 'due', placeholder: 'Fournisseur', empty: 'Aucun achat par bon de commande pour le moment.',
      searchText: (s) => s.name,
      columns: [
        { key: 'name', label: 'Fournisseur', render: (s) => `<strong>${esc(s.name)}</strong><br><span class="muted">${s.purchases.map((b) => `<a href="#/achat/${enc(b.id)}">${esc(b.number)}</a>`).join(', ')}</span>` },
        { key: 'owed', label: 'Dû (reçu / facturé)', cls: 'num', render: (s) => fcfa(s.owed) },
        { key: 'paid', label: 'Déjà payé', cls: 'num', render: (s) => fcfa(s.paid) },
        { key: 'due', label: 'Reste à payer', cls: 'num', render: (s) => `<strong class="${s.due > 0 ? 'neg' : 'pos'}">${fcfa(s.due)}</strong>` },
        { key: 'act', label: '', sortable: false, render: (s) => { const b = s.purchases.find((x) => x.due > 0); return b ? `<div class="cell-actions"><a class="btn small" href="#/finances/nouvelle?achat=${enc(b.id)}&montant=${b.due}">Payer ${esc(b.number)}</a></div>` : ''; } },
      ],
    });
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
    if (!id && qs.get('achat')) Object.assign(e, { category: 'stock', purchaseId: qs.get('achat'), amount: Number(qs.get('montant')) || '', method: 'bank' });
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
        ${e.purchaseId ? `<div class="alert ok" style="margin:8px 0">${icon('clipboard-text')} Paiement rattaché au bon de commande (il sera déduit de la dette de ce bon).</div>` : ''}
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
      } catch (err) { $('#rcptHint').textContent = 'Erreur : ' + err.message; }
    });
    $('#entryForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = { type: type(), date: $('#fDate').value, amount: $('#fAmount').value, category: $('#fCat').value, supplierId: $('#fSup').value || null, purchaseId: e.purchaseId || null, label: $('#fLabel').value, method: $('#fMethod').value, toMethod: $('#fTo').value, note: $('#fNote').value, receipt };
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
      <span class="who">${m.internal ? `${icon('note-pencil')} Note interne · ${esc(m.staffName || '')}` : m.from === 'customer' ? 'Client' : m.from === 'bot' ? 'Assistant automatique' : m.from === 'supplier' ? `${esc(m.staffName || 'Fournisseur')}${m.auto ? ' · automatique' : ''}` : esc(m.staffName || 'Zado')}</span>
      <div class="pb">${esc(m.text).replace(/\n/g, '<br>')}${(m.links || []).length ? `<div class="muted" style="margin-top:4px">${m.links.map((l) => esc(l.label)).join(' · ')}</div>` : ''}</div>
      <span class="t">${msgTime(m.at)}</span>
    </div>`;
  async function viewMessaging(id) {
    if (CAN.supplier()) return viewSupplierChat();
    const support = CAN.orders();
    if (!id) id = support ? '' : 'equipe';
    let list = [], sups = [];
    if (support) { try { list = await api('/chat/conversations'); } catch { return; } }
    if (CAN.desk()) { try { sups = await api('/chat/suppliers'); } catch {} }
    const f = state.msgFilter || 'todo';
    const match = (c, k) => k === 'all' || (k === 'todo' ? c.status === 'open' : c.status === k);
    const FILT = [['todo', 'À répondre'], ['bot', 'Avec l\'assistant'], ['closed', 'Terminées'], ['all', 'Toutes']];
    const rows = list.filter((c) => match(c, f));
    app.innerHTML = pageHead({ title: 'Messagerie', desc: support ? "Les questions des clients (bulle « Aide » de la boutique). L'assistant automatique répond d'abord ; quand un client demande un conseiller, la conversation arrive dans « À répondre ». Le salon « Équipe Zado » sert à échanger entre vous." : 'Le salon « Équipe Zado » pour échanger avec toute l\'équipe.' }) + `
      <div class="msg-layout ${id ? 'has-conv' : ''}">
        <aside class="msg-list">
          <a class="msg-item team ${id === 'equipe' ? 'on' : ''}" href="#/messagerie/equipe">${icon('chats-circle-duotone')}<span><strong>Équipe Zado</strong><small>Salon interne de l'équipe</small></span><b class="n" id="teamUnread" hidden></b></a>
          ${support ? `${tabsBar(FILT.map(([k, l]) => [k, l, list.filter((c) => match(c, k)).length]), f, 'mf')}
          ${rows.length ? rows.map((c) => `
            <a class="msg-item ${c.id === id ? 'on' : ''} ${c.unread ? 'unread' : ''}" href="#/messagerie/${enc(c.id)}">
              <span class="av">${esc((c.name || 'V')[0].toUpperCase())}</span>
              <span><strong>${esc(c.name)}${vb(c.idStatus)}</strong><small>${c.lastFrom === 'customer' ? '' : c.lastFrom === 'staff' ? 'Vous : ' : 'Assistant : '}${esc((c.lastText || '').slice(0, 70))}</small></span>
              <span class="side"><em>${c.lastAt ? msgTime(c.lastAt) : ''}</em>${c.unread ? `<b class="n">${c.unread}</b>` : `<i class="tag ${CONV_ST[c.status]?.[1] || ''}">${esc(CONV_ST[c.status]?.[0] || '')}</i>`}</span>
            </a>`).join('') : '<p class="muted" style="padding:14px">Aucune conversation ici.</p>'}` : ''}
          ${sups.length ? `<p class="msg-sep">${icon('storefront')} Fournisseurs</p>${sups.map((f) => `
            <a class="msg-item ${id === 'f-' + f.supplierId ? 'on' : ''} ${f.unread ? 'unread' : ''}" href="#/messagerie/f-${enc(f.supplierId)}">
              <span class="av sup">${esc((f.name || 'F')[0].toUpperCase())}</span>
              <span><strong>${esc(f.name)}</strong><small>${f.lastText ? (f.lastFrom === 'staff' ? 'Zado : ' : '') + esc(f.lastText.slice(0, 70)) : 'Pas encore de message'}</small></span>
              <span class="side"><em>${f.lastAt ? msgTime(f.lastAt) : ''}</em>${f.unread ? `<b class="n">${f.unread}</b>` : ''}</span>
            </a>`).join('')}` : ''}
        </aside>
        <section class="msg-conv" id="msgConv">${id ? '<p class="muted" style="padding:20px">Chargement…</p>' : `<div class="msg-empty">${icon('chat-circle-dots-duotone')}<p>Choisissez une conversation.</p></div>`}</section>
      </div>`;
    app.querySelectorAll('[data-mf]').forEach((b) => b.addEventListener('click', () => { state.msgFilter = b.dataset.mf; viewMessaging(id); }));
    if (id === 'equipe') await openTeam();
    else if (id?.startsWith('f-')) await openSupplierThread(id.slice(2));
    else if (id) await openConv(id);
    // Nouveaux messages : toutes les 4 s tant que la page est affichée
    state.msgTimer = setInterval(async () => {
      if (document.hidden || !location.hash.startsWith('#/messagerie')) return;
      if (id === 'equipe') return openTeam(true);
      if (id?.startsWith('f-')) return openSupplierThread(id.slice(2), true);
      if (id) openConv(id, true);
    }, 4000);
  }
  // Fil « Fournisseur ↔ Zado » vu par l'équipe (admin, commandes, catalogue)
  async function openSupplierThread(sid, refresh) {
    let t;
    try { t = await api('/chat/suppliers/' + enc(sid)); } catch (err) { $('#msgConv').innerHTML = `<div class="alert err">${esc(err.message)}</div>`; return; }
    const sig = JSON.stringify(t.messages.length);
    if (refresh && sig === state.supSig) return;
    state.supSig = sig;
    const thread = t.messages.length ? t.messages.map((m) => bubble(m, m.from === 'staff' && m.userId === t.me)).join('') : '<p class="muted" style="text-align:center">Pas encore de message avec ce fournisseur.</p>';
    if (refresh && $('#msgThread')) { $('#msgThread').innerHTML = thread; $('#msgThread').scrollTop = 1e9; loadChatCounts(); return; }
    $('#msgConv').innerHTML = `
      <div class="msg-top"><a class="ghost back" href="#/messagerie">${icon('caret-left')}</a><div><strong>${esc(t.name)}</strong> <span class="tag">Fournisseur</span><br><span class="muted">${esc(t.contact || '')}${t.phone ? ` · <a href="tel:${esc(t.phone)}">${esc(t.phone)}</a> · <a href="https://wa.me/242${esc(String(t.phone).replace(/\D/g, '').replace(/^242/, ''))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</span></div></div>
      <div class="msg-thread" id="msgThread">${thread}</div>
      ${replyBox('supplier')}`;
    $('#msgThread').scrollTop = 1e9;
    bindReply(async (text) => { await api('/chat/suppliers/' + enc(sid) + '/messages', { method: 'POST', body: { text } }); state.supSig = null; await openSupplierThread(sid, true); });
    loadChatCounts();
  }
  // Le fournisseur : son fil avec Zado (il ne voit ni les clients ni le salon de l'équipe)
  async function viewSupplierChat(refresh) {
    let t;
    try { t = await api('/chat/kamwa'); } catch { return; }
    const sig = JSON.stringify(t.messages.length);
    if (refresh && sig === state.supSig) return;
    state.supSig = sig;
    const thread = t.messages.length ? t.messages.map((m) => bubble(m, m.from === 'supplier')).join('') : '<p class="muted" style="text-align:center">Écrivez à Zado : une question sur une commande, un produit, un rendez-vous de récupération…</p>';
    if (refresh && $('#msgThread')) { $('#msgThread').innerHTML = thread; $('#msgThread').scrollTop = 1e9; loadChatCounts(); return; }
    app.innerHTML = pageHead({ title: 'Messagerie', desc: 'Votre fil avec l\'équipe Zado. Quand vous cliquez « Prêt à récupérer » sur une commande, Zado est prévenu ici automatiquement.' }) + `
      <div class="msg-layout has-conv solo"><section class="msg-conv" id="msgConv">
        <div class="msg-top"><div><strong>Zado</strong><br><span class="muted">Administration, commandes et catalogue</span></div></div>
        <div class="msg-thread" id="msgThread">${thread}</div>
        ${replyBox('supplier')}
      </section></div>`;
    $('#msgThread').scrollTop = 1e9;
    bindReply(async (text) => { await api('/chat/kamwa', { method: 'POST', body: { text } }); state.supSig = null; await viewSupplierChat(true); });
    loadChatCounts();
    state.msgTimer = setInterval(() => { if (!document.hidden && location.hash.startsWith('#/messagerie')) viewSupplierChat(true); }, 4000);
  }
  function replyBox(team) {
    return `<form class="msg-reply" id="msgForm">
      ${team ? '' : `<div class="canned">${CANNED.map((t, i) => `<button type="button" data-canned="${i}">${esc(t.slice(0, 34))}…</button>`).join('')}</div>`}
      <div class="row-reply"><textarea id="msgText" rows="2" maxlength="2000" placeholder="${team === 'supplier' ? 'Votre message…' : team ? 'Message à toute l\'équipe…' : 'Votre réponse au client…'}"></textarea>
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
      <div class="msg-top"><a class="ghost back" href="#/messagerie">${icon('caret-left')}</a><div><strong>Équipe Zado</strong><br><span class="muted">Salon interne : visible par toute l'équipe (pas par les fournisseurs ni les clients)</span></div></div>
      <div class="msg-thread" id="msgThread">${thread}</div>
      ${replyBox(true)}`;
    $('#msgThread').scrollTop = 1e9;
    bindReply(async (text) => { await api('/chat/team', { method: 'POST', body: { text } }); state.teamSig = null; await openTeam(true); });
    loadChatCounts();
  }
  // Pastilles du menu + sonnerie quand un client attend un conseiller
  async function loadChatCounts() {
    if (!state.user) return;
    try {
      const n = await api('/chat/unread');
      const total = (n.support || 0) + (n.team || 0) + (n.suppliers || 0) + (n.kamwa || 0);
      for (const el of [$('#chatCount')]) { if (el) { el.hidden = !total; el.textContent = total; } }
      if ($('#teamUnread')) { $('#teamUnread').hidden = !n.team; $('#teamUnread').textContent = n.team; }
      if (state.chatWaiting != null && n.waiting > state.chatWaiting) { ring(); toast('Un client attend une réponse dans la messagerie'); }
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
  // Bouton Apparence de la barre du haut : clair → sombre → auto
  $('#themeTop')?.addEventListener('click', () => {
    const m = window.kamwaTheme?.mode() || 'light';
    window.kamwaTheme?.set(m === 'light' ? 'dark' : m === 'dark' ? 'auto' : 'light');
    renderProTheme(); renderTopbar(); if (state.user && !proBusy()) route({ keep: true });
  });

  // ---------- Rail des modules + onglets du module (structure ERP : menu à gauche, pages du module en haut) ----------
  const MODULE_ICONS = { 'Ventes': 'receipt-duotone', 'Catalogue': 'package-duotone', 'Livraison': 'truck-duotone', 'Gestion': 'wallet-duotone', 'Équipe': 'users-three-duotone' };
  const ROLE_LABELS = { admin: 'Administrateur', catalog: 'Catalogue', orders: 'Commandes', supplier: 'Fournisseur', courier: 'Livreur' };
  const linkInfo = (a) => {
    const c = a.cloneNode(true); c.querySelectorAll('.count').forEach((x) => x.remove());
    const use = a.querySelector('use'); const cnt = a.querySelector('.count');
    return { tab: a.dataset.tab, href: a.getAttribute('href'), label: c.textContent.replace(/\s+/g, ' ').trim(), icon: use ? use.getAttribute('href').split('#')[1] : 'squares-four', on: a.classList.contains('on'), count: cnt && !cnt.hidden ? cnt.textContent : '' };
  };
  function navModel() {
    const groups = []; let cur = null;
    for (const el of $('.side-nav').children) {
      if (el.hidden) continue;
      if (el.classList.contains('side-title')) { cur = { title: el.textContent.trim(), icon: MODULE_ICONS[el.textContent.trim()] || 'squares-four', links: [] }; groups.push(cur); }
      else if (el.matches('a[data-tab]')) { const l = linkInfo(el); if (cur) cur.links.push(l); else groups.push({ title: l.label, icon: l.icon, links: [l], single: true }); }
    }
    return groups.filter((g) => g.links.length);
  }
  function renderRail() {
    if (!state.user) return;
    const groups = navModel();
    const active = groups.find((g) => g.links.some((l) => l.on)) || null;
    $('#rail').innerHTML = `<a class="rail-logo" href="#/tableau" title="Zado Pro"><img src="/brand/symbole-zado.svg?v=6" alt="Zado" width="34" height="34"></a>
      ${groups.map((g) => { const n = g.links.reduce((s, l) => s + (parseInt(l.count, 10) || 0), 0); return `<a class="rail-item ${g === active ? 'on' : ''}" href="${esc(g.links[0].href)}" title="${esc(g.title)}">${icon(g.icon)}<span>${esc(g.title)}</span>${n ? `<i class="n">${n}</i>` : ''}</a>`; }).join('')}
      <div class="rail-foot">
        <a class="rail-item" href="/" target="_blank" rel="noopener" title="Voir la boutique">${icon('arrow-square-out-bold')}<span>Boutique</span></a>
        <button class="rail-item" type="button" id="railLogout" title="Quitter">${icon('sign-out-bold')}<span>Quitter</span></button>
      </div>`;
    $('#railLogout').addEventListener('click', () => $('#logoutBtn').click());
    const links = active && !active.single ? active.links : [];
    $('#pills').innerHTML = links.length > 1 ? links.map((l) => `<a class="pill ${l.on ? 'on' : ''}" href="${esc(l.href)}">${esc(l.label)}${l.count ? ` <i class="n">${esc(l.count)}</i>` : ''}</a>`).join('') : '';
    const page = (active ? active.links.find((l) => l.on) : null);
    $('#topTitle').textContent = active ? (active.single ? active.title : `${active.title}${page ? ' › ' + page.label : ''}`) : 'Zado Pro';
    $('#rail').hidden = false; $('#topbar').hidden = false;
  }
  function renderTopbar() {
    if (!state.user) return;
    const u = state.user;
    $('#userAv').textContent = (u.name || 'K').trim().charAt(0).toUpperCase();
    $('#userName').textContent = u.name;
    $('#userRole').textContent = u.company || ROLE_LABELS[u.role] || u.role;
    const m = window.kamwaTheme?.mode() || 'light';
    $('#themeTopIco').setAttribute('href', `/icons.svg?v=12#${m === 'dark' ? 'moon' : m === 'auto' ? 'circle-half' : 'sun'}`);
    $('#themeTop').title = `Apparence : ${m === 'dark' ? 'sombre' : m === 'auto' ? 'automatique' : 'claire'} (cliquer pour changer)`;
    const todo = $('#todoCount'); const chat = $('#chatCount');
    const n = (todo && !todo.hidden ? parseInt(todo.textContent, 10) || 0 : 0) + (chat && !chat.hidden ? parseInt(chat.textContent, 10) || 0 : 0);
    $('#bellTop').hidden = !n; $('#bellCount').textContent = n;
    $('#bellTop').href = todo && !todo.hidden ? '#/commandes' : '#/messagerie';
    $('#userChip').href = CAN.admin() ? '#/reglages' : '#/mot-de-passe';
  }
  // Le rail suit le menu (pastilles, rôle, page active) sans y toucher à la main
  new MutationObserver(() => { if (state.user) { renderRail(); renderTopbar(); } }).observe($('.side-nav'), { subtree: true, attributes: true, childList: true, characterData: true });
  // Recherche globale : numéro de commande / colis / bon / document, téléphone, sinon produits
  $('#gsearch').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#gsearchInput').value.trim(); if (!q) return;
    const go = (tableId, hash) => { tableState[tableId] = { ...(tableState[tableId] || { sort: null, dir: -1 }), q }; location.hash = hash; if (location.hash === hash) route(); };
    if (/^CMD-/i.test(q) && CAN.orders()) location.hash = '#/commande/' + enc(q.toUpperCase());
    else if (/^KM-/i.test(q) && (CAN.orders() || CAN.courier())) location.hash = '#/colis/' + enc(q.toUpperCase());
    else if (/^(BC|PO)-/i.test(q) && (CAN.admin() || state.user.role === 'catalog')) go('purchases', '#/achats');
    else if (/^(FA|RC|AV)-/i.test(q) && CAN.orders()) go('documents', '#/documents');
    else if (/^\+?\d[\d ]{6,}$/.test(q) && CAN.admin()) go('customers', '#/clients');
    else if (/^\+?\d[\d ]{6,}$/.test(q) && CAN.orders()) go('orders', '#/commandes');
    else if (CAN.products()) go('products', '#/produits');
    else if (CAN.orders()) go('orders', '#/commandes');
    $('#gsearchInput').value = '';
  });

  // ---------- Rafraîchissement instantané (signal du serveur) ----------
  // Le serveur signale chaque changement qui concerne ce rôle ; la page affichée se redessine tout de suite,
  // à la même position, sauf pendant une saisie (elle se met alors à jour dès que la saisie est terminée).
  const LIVE_TOPICS = {
    tableau: ['orders', 'products', 'customers', 'chat', 'finance'], commandes: ['orders'], commande: ['orders', 'documents', 'parcels'], documents: ['documents'], colis: ['parcels', 'orders'], calendrier: ['orders', 'purchases'], achats: ['purchases'], achat: ['purchases'], stock: ['stock', 'products', 'purchases'], 'bons-de-commande': ['purchases'], clients: ['customers'],
    livraisons: ['orders'], fournisseur: ['orders', 'products'], avis: ['reviews'],
    produits: ['products'], agences: ['agencies'], journal: ['orders', 'products', 'customers', 'staff', 'finance'], finances: ['finance', 'orders'], equipe: ['staff'],
  };
  const NO_LIVE_WITH_ID = ['produit', 'achat', 'calendrier', 'agences', 'equipe', 'finances', 'reglages', 'mot-de-passe'];
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
      if (t.topic === 'maintenance') { api('/me').then((me) => renderMaintBar(me.maintenance)).catch(() => {}); if (/^#\/reglages/.test(location.hash) && !proBusy()) route({ keep: true }); return; }
      liveQueue.add(t.topic);
      if (!liveTimer) liveTimer = setTimeout(applyLive, 150);
    });
    proEs.onerror = () => { if (proEs.readyState === EventSource.CLOSED) { proEs = null; setTimeout(connectProEvents, 3000); } };
  }
  function refreshMessaging(id) {
    if (CAN.supplier()) return viewSupplierChat(true);
    if (id === 'equipe') return openTeam(true);
    if (id?.startsWith('f-')) return openSupplierThread(id.slice(2), true);
    if (id) openConv(id, true);
    // liste des conversations à gauche
    if (!id && !$('#msgText')?.value) viewMessaging(id);
  }

  function route(opts = {}) {
    clearInterval(state.msgTimer);
    if (!/^#\/scanner/.test(location.hash)) stopScanner(); // caméra coupée en quittant le scanner
    let [page, id] = (location.hash || homeHash()).slice(2).split('/').map(decodeURIComponent);
    if (id && id.includes('?') && page !== 'finances') id = id.split('?')[0];
    const keepY = opts.keep ? window.scrollY : 0;
    if (opts.keep) [0, 150, 450].forEach((ms) => setTimeout(() => { if (Math.abs(window.scrollY - keepY) > 2) window.scrollTo(0, keepY); }, ms)); // les pages se chargent en un instant : on garde la position
    else window.scrollTo(0, 0);
    // Pages autorisées selon le rôle ; sinon retour à l'accueil du rôle
    document.body.classList.remove('menu-open');
    charts.splice(0).forEach((c) => c.destroy());
    const allowed = {
      tableau: () => Boolean(state.user),
      commandes: CAN.orders, commande: CAN.orders, produits: CAN.products, produit: CAN.products,
      messagerie: () => Boolean(state.user),
      calendrier: () => CAN.orders() || CAN.courier(), achats: () => CAN.admin() || state.user?.role === 'catalog', achat: () => CAN.admin() || state.user?.role === 'catalog', stock: () => CAN.admin() || state.user?.role === 'catalog', avis: () => CAN.admin() || state.user?.role === 'catalog', 'bons-de-commande': CAN.supplier, documents: CAN.orders, colis: () => CAN.orders() || CAN.courier(), scanner: () => CAN.orders() || CAN.courier(),
      fournisseur: CAN.supplier, clients: CAN.admin, agences: CAN.admin, equipe: CAN.admin, journal: CAN.admin, finances: CAN.admin, reglages: CAN.admin, livraisons: CAN.courier, 'mot-de-passe': () => !CAN.admin(),
    };
    if (!allowed[page]?.()) [page, id] = homeHash().slice(2).split('/');
    const tab = page.startsWith('produit') ? 'produits' : page === 'commande' ? 'commandes' : page === 'achat' ? 'achats' : page;
    document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    if (state.user) renderRail();
    if (page === 'messagerie') return viewMessaging(id);
    if (page === 'documents') return viewDocuments();
    if (page === 'achats') return viewPurchases();
    if (page === 'achat') return id === 'nouveau' ? (CAN.admin() ? viewPurchaseNew() : (location.hash = '#/achats')) : viewPurchase(id);
    if (page === 'stock') return viewStock(id);
    if (page === 'avis') return viewReviews();
    if (page === 'bons-de-commande') return viewSupplierPurchases();
    if (page === 'colis') return id ? viewParcel(id) : viewParcels();
    if (page === 'calendrier') return viewCalendar(id);
    if (page === 'scanner') return viewScanner();
    if (page === 'clients') return viewCustomers();
    if (page === 'agences') return viewAgencies(id);
    if (page === 'equipe') return viewStaff(id);
    if (page === 'journal') return viewActivity();
    if (page === 'finances') return viewFinances(id);
    if (page === 'livraisons') return viewDeliveries();
    if (page === 'reglages') return viewSettings();
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
    const me = await api('/me');
    state.user = me.user;
    renderMaintBar(me.maintenance);
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
    renderTopbar(); renderRail();
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
