// Kamwa — espace admin (aucune dépendance). Routes : #/commandes, #/commande/<id>, #/produits, #/produit/<id|nouveau>
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const date = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const ICONS = { 'Téléphones': '📱', 'Tablettes': '📲', 'Ordinateurs': '💻', 'Montres': '⌚', 'Audio': '🎧', 'TV & Maison': '📺', 'Composants': '💾', 'Accessoires': '🔌', 'Homme': '👕', 'Femme': '👚', 'Chaussures': '👟' };

  const state = { user: null, orders: [], labels: {}, transitions: {}, products: [], universes: [], suppliers: [], orderFilter: 'paid', productQuery: '', productFilter: 'all', seenPaid: null };
  // Ce que chaque rôle peut ouvrir (le serveur vérifie aussi, de son côté)
  const CAN = {
    orders: () => ['admin', 'orders'].includes(state.user?.role),
    products: () => ['admin', 'catalog', 'supplier'].includes(state.user?.role),
    supplier: () => state.user?.role === 'supplier',
    admin: () => state.user?.role === 'admin',
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
  const icon = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="/icons.svg?v=3#${name}"></use></svg>`;
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
  if (window.Chart) {
    Chart.defaults.color = '#A69FBF';
    Chart.defaults.borderColor = 'rgba(255,255,255,.08)';
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
  }
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
    const days = state.days || 30;
    app.innerHTML = '<p class="muted">Chargement du tableau de bord…</p>';
    let d;
    try { d = await api('/stats?days=' + days); } catch { return; }
    if (!location.hash.startsWith('#/tableau') && location.hash !== '' && location.hash !== '#/') return; // la personne a changé de page entre-temps
    const who = state.user.role === 'supplier' ? state.user.company || state.user.name : state.user.name;
    const period = d.role === 'catalog' ? '' : `<div class="period">${[7, 30, 90].map((n) => `<button data-days="${n}" class="${n === days ? 'on' : ''}">${n} jours</button>`).join('')}</div>`;
    const todo = [];
    if (d.todo?.toShip) todo.push(`<a href="#/commandes" data-f="paid">${icon('package-duotone')} ${d.todo.toShip} à expédier</a>`);
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

    app.innerHTML = pageHead({ crumb: 'Tableau de bord', title: `Bonjour ${who}`, desc: d.role === 'catalog' ? 'Où en est le catalogue.' : `Activité des ${days} derniers jours.`, actions: period })
      + `<div class="kpis">${d.kpis.map((k) => `<div class="kpi"><span class="kpi-ico">${icon(k.icon)}</span><span class="kpi-label">${esc(k.label)}</span><span class="kpi-value">${k.format === 'fcfa' ? fcfa(k.value) : new Intl.NumberFormat('fr-FR').format(k.value)}</span>${k.hint ? `<span class="kpi-hint">${esc(k.hint)}</span>` : ''}</div>`).join('')}</div>`
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
        <button class="btn dark" style="width:100%;margin-top:16px">Se connecter</button>
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
    // Nouvelle commande payée depuis la dernière vérification ?
    const paidIds = state.orders.filter((o) => o.paidAt).map((o) => o.id);
    if (state.seenPaid) {
      const fresh = state.orders.filter((o) => o.paidAt && !state.seenPaid.has(o.id));
      if (fresh.length) {
        ring();
        toast(`🛒 Nouvelle commande payée : ${fresh[0].customer.name}, ${fcfa(fresh[0].total)}`);
      }
    }
    state.seenPaid = new Set(paidIds);
    const todo = state.orders.filter((o) => o.status === 'paid' || o.paidAfterCancel).length;
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
  const toCollect = (o) => o.status === 'pending_payment' && o.payment?.operator === 'cash' && o.payment.status === 'PENDING' && !(o.payment.expiresAt && Date.now() > Date.parse(o.payment.expiresAt));
  const PAY_LABELS = { mtn: 'MTN MoMo', airtel: 'Airtel Money', card: 'Carte bancaire', cash: 'Espèces en agence' };
  const PAY_STATUS = { PENDING: 'en attente', SUCCESSFUL: 'réussi', FAILED: 'échoué', CANCELLED: 'remplacé' };
  const FILTERS = [
    ['paid', 'À expédier / remettre'],
    ['collect', 'À encaisser en agence'],
    ['shipped', 'Expédiées'],
    ['delivered', 'Livrées'],
    ['cancelled', 'Annulées'],
    ['pending_payment', 'Non payées'],
    ['all', 'Toutes'],
  ];
  const badge = (status) => `<span class="badge st-${status}">${esc(state.labels[status] || status)}</span>`;

  function viewOrders() {
    const f = state.orderFilter;
    const matches = (o, k) => k === 'all' || (k === 'collect' ? toCollect(o) : o.status === k) || (k === 'paid' && o.paidAfterCancel);
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
        { key: 'id', label: 'Commande', render: (o) => `<strong class="mono">${esc(o.id)}</strong>${o.paidAfterCancel ? '<br><span class="tag danger">À rembourser</span>' : ''}${isPickup(o) ? `<br><span class="tag">Retrait ${esc(o.agency?.name || '')}</span>` : ''}` },
        { key: 'client', label: 'Client', sortValue: (o) => norm(o.customer.name), render: (o) => `${esc(o.customer.name)}<br><span class="muted">${esc(o.customer.phone)}</span>` },
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
    shipped: ['Marquer expédiée 🚚', 'btn dark'],
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

      <div class="panel">
        <h2>Client</h2>
        <p style="margin:0 0 4px"><strong>${esc(c.name)}</strong> · ${esc(c.phone)}</p>
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

      <div class="panel">
        <h2>Suivi</h2>
        ${isPickup(o) ? `<p style="margin:0 0 10px"><span class="tag">🏪 Retrait en agence</span> <strong>${esc(o.agency?.name)}</strong> (${esc(o.agency?.city)})${o.status === 'pending_payment' && o.pickupDeadline ? `<br><span class="muted">Réservé jusqu'au ${date(o.pickupDeadline)}${Date.now() > Date.parse(o.pickupDeadline) ? ' — <strong style="color:var(--err)">délai dépassé</strong>' : ''}</span>` : ''}</p>` : ''}
        <div class="row">
          ${isPickup(o) && o.status === 'pending_payment' ? `<button class="btn green" id="cashBtn">💵 Paiement reçu en agence (${fcfa(o.total)})</button>` : ''}
          ${(((isPickup(o) ? state.pickupTransitions : state.transitions) || {})[o.status] || []).map((s) => {
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
  async function viewAgencies(editId) {
    let list = [];
    try { list = await api('/agencies'); } catch { return; }
    const editing = editId === 'nouvelle' ? { active: true } : list.find((a) => a.id === editId);
    if (editing) {
      app.innerHTML = pageHead({ crumb: 'Agences', title: editing.id ? 'Modifier l\'agence' : 'Nouvelle agence' }) + `
      <form class="panel" id="agencyForm" novalidate style="max-width:640px">
        <label for="aName">Nom *</label><input id="aName" type="text" value="${esc(editing.name)}" placeholder="Ex. Kamwa Centre-ville">
        <label for="aCity">Ville *</label><input id="aCity" type="text" value="${esc(editing.city)}" placeholder="Pointe-Noire">
        <label for="aAddress">Adresse / repère</label><input id="aAddress" type="text" value="${esc(editing.address)}" placeholder="Avenue…, face à…">
        <label for="aHours">Horaires</label><input id="aHours" type="text" value="${esc(editing.hours)}" placeholder="Lun-Sam 9h-18h">
        <label for="aPhone">Téléphone</label><input id="aPhone" type="tel" value="${esc(editing.phone)}">
        <label class="check"><input id="aActive" type="checkbox" ${editing.active !== false ? 'checked' : ''}> Active (proposée aux clients)</label>
        <div id="aError"></div>
        <div class="row" style="margin-top:14px"><button class="btn">Enregistrer</button><a class="ghost" href="#/agences">Annuler</a></div>
      </form>`;
      $('#agencyForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = { name: $('#aName').value, city: $('#aCity').value, address: $('#aAddress').value, hours: $('#aHours').value, phone: $('#aPhone').value, active: $('#aActive').checked };
        try {
          await api(editing.id ? '/agencies/' + enc(editing.id) : '/agencies', { method: editing.id ? 'PATCH' : 'POST', body });
          toast('Agence enregistrée ✓');
          location.hash = '#/agences';
        } catch (err) {
          $('#aError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
        }
      });
      return;
    }
    app.innerHTML = pageHead({ title: 'Agences', desc: "Les agences actives permettent au client de choisir « Espèces en agence » : il réserve en ligne, paie en espèces et repart avec sa commande. Sans agence active, cette option n'apparaît pas sur le site.", actions: `<a class="btn" href="#/agences/nouvelle">${icon('plus-bold')} Ajouter</a>` }) + '<div id="tbl"></div>';
    dataTable($('#tbl'), {
      id: 'agencies', rows: list, rowHref: (a) => '#/agences/' + enc(a.id), placeholder: 'Nom, ville ou adresse',
      empty: 'Aucune agence pour le moment. Ajoutez-en une dès que vous en ouvrez une.',
      searchText: (a) => `${a.name} ${a.city} ${a.address}`,
      columns: [
        { key: 'name', label: 'Agence', render: (a) => `<strong>${esc(a.name)}</strong>` },
        { key: 'city', label: 'Ville' },
        { key: 'address', label: 'Adresse', render: (a) => esc(a.address || 'à venir') },
        { key: 'hours', label: 'Horaires', render: (a) => esc(a.hours || '—') },
        { key: 'active', label: 'Statut', sortValue: (a) => a.active !== false, render: (a) => (a.active === false ? '<span class="tag">Inactive</span>' : '<span class="tag ok">Active</span>') },
      ],
    });
  }

  // ---------- Clients ----------
  async function viewCustomers() {
    let list = [];
    try { list = await api('/customers'); } catch { return; }
    app.innerHTML = pageHead({ title: 'Clients', desc: 'Les comptes clients de la boutique. Un client a oublié son code ? « Nouveau code », puis envoyez-le par WhatsApp.', actions: exportBtn('customers') })
      + '<div id="codeBox"></div><div id="tbl"></div>';
    dataTable($('#tbl'), {
      id: 'customers', rows: list, defaultSort: 'createdAt', placeholder: 'Nom, téléphone ou e-mail', empty: 'Aucun compte client pour le moment.',
      searchText: (c) => `${c.name} ${c.phone} ${c.email}`,
      columns: [
        { key: 'name', label: 'Client', sortValue: (c) => norm(c.name), render: (c) => `<strong>${esc(c.name)}</strong>` },
        { key: 'phone', label: 'Téléphone', render: (c) => esc(c.phone || '—') },
        { key: 'email', label: 'E-mail', render: (c) => esc(c.email || '—') },
        { key: 'orders', label: 'Commandes', cls: 'num' },
        { key: 'createdAt', label: 'Inscrit le', render: (c) => date(c.createdAt).split(' ')[0] },
        { key: 'act', label: '', sortable: false, render: (c) => `<div class="cell-actions"><button class="ghost" data-code="${esc(c.id)}">${icon('key-bold')} Nouveau code</button></div>` },
      ],
    });
    $('#tbl').addEventListener('click', (e) => {
      const b = e.target.closest('[data-code]');
      if (!b) return;
      newCode(list.find((x) => x.id === b.dataset.code), $('#codeBox'));
    });
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
    const margin = p.price && p.supplierPrice != null ? p.price - p.supplierPrice : null;
    app.innerHTML = `
      <p><a href="#/produits">‹ ${isSupplier() ? 'Mes produits' : 'Tous les produits'}</a></p>
      <h1>${isNew ? 'Nouveau produit' : esc(p.name)}</h1>
      ${p.pending ? `<div class="alert warn">⏳ En attente de validation : ce produit n'est pas encore visible des clients.${isAdmin() ? ' Vérifiez la fiche, fixez le prix de vente, enregistrez, puis cliquez « Valider et publier ».' : " L'administrateur doit le valider."}</div>` : ''}
      ${isNew && !isAdmin() ? '<div class="alert warn">Le produit sera visible des clients après validation par l\'administrateur.</div>' : ''}
      ${limited ? '<div class="alert warn">Produit publié : vous pouvez modifier le <strong>stock</strong> et <strong>votre prix</strong>. Pour le reste, contactez Kamwa.</div>' : ''}
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
        <p class="muted" id="photoHint">Jusqu'à 8 photos, sur fond clair de préférence. La première est la photo principale. Elles sont allégées automatiquement.</p>`}

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
        <label for="specs">Caractéristiques (une par ligne)</label>
        <textarea id="specs" rows="4" placeholder="Couleur : Noir&#10;Capacité : 128 Go&#10;Taille : M" ${dis}>${esc((p.specs || []).map((x) => `${x.label} : ${x.value}`).join('\n'))}</textarea>

        <h2 style="margin-top:18px">Prix et disponibilité</h2>
        <div class="grid2">
          ${showSale ? `<div><label for="price">Prix de vente (FCFA)${p.pending || isNew ? '' : ' *'}</label><input id="price" type="number" inputmode="numeric" min="1" step="1" value="${esc(p.price ?? '')}"></div>
          <div><label for="oldPrice">Prix barré (facultatif)</label><input id="oldPrice" type="number" inputmode="numeric" min="1" step="1" value="${esc(p.oldPrice ?? '')}"></div>` : ''}
          ${showSupplierPrice ? `<div><label for="supplierPrice">${isSupplier() ? 'Votre prix (FCFA) *' : 'Prix fournisseur (FCFA)'}</label><input id="supplierPrice" type="number" inputmode="numeric" min="0" step="1" value="${esc(p.supplierPrice ?? '')}"></div>` : ''}
          <div><label for="stock">Stock disponible *</label><input id="stock" type="number" inputmode="numeric" min="0" step="1" value="${esc(p.stock)}"></div>
        </div>
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
          </div>`).join('')
        : `<div class="gal-empty">${ICONS[$('#category')?.value] || '🛍️'}<br><span class="muted">Pas encore de photo</span></div>`;
      $('#gallery').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { images.splice(Number(b.dataset.del), 1); renderGallery(); }));
      $('#gallery').querySelectorAll('[data-main]').forEach((b) => b.addEventListener('click', () => { const [x] = images.splice(Number(b.dataset.main), 1); images.unshift(x); renderGallery(); }));
    };
    renderGallery();
    $('#category').addEventListener('change', renderGallery);

    // Envoi des photos (appareil photo ou galerie) : réduites dans le navigateur puis envoyées une par une
    const addFiles = async (files) => {
      const hint = $('#photoHint');
      for (const file of [...files].slice(0, 8 - images.length)) {
        hint.textContent = 'Envoi de la photo…';
        try {
          const blob = await shrinkImage(file);
          const { url } = await api('/uploads', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
          images.push(url);
          renderGallery();
          hint.textContent = `Photo ajoutée (${Math.round(blob.size / 1024)} Ko). Pensez à enregistrer.`;
        } catch (err) {
          hint.textContent = '❌ ' + err.message;
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
        if (isAdmin()) body.supplierId = val('#supplierId');
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
        { key: 'mode', label: 'Mode', sortValue: (o) => o.fulfillment, render: (o) => (o.fulfillment === 'pickup' ? 'Retrait en agence' : 'Livraison') },
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

  // ---------- Routeur ----------
  function route() {
    let [page, id] = (location.hash || homeHash()).slice(2).split('/').map(decodeURIComponent);
    window.scrollTo(0, 0);
    // Pages autorisées selon le rôle ; sinon retour à l'accueil du rôle
    document.body.classList.remove('menu-open');
    charts.splice(0).forEach((c) => c.destroy());
    const allowed = {
      tableau: () => Boolean(state.user),
      commandes: CAN.orders, commande: CAN.orders, produits: CAN.products, produit: CAN.products,
      fournisseur: CAN.supplier, clients: CAN.admin, agences: CAN.admin, equipe: CAN.admin, journal: CAN.admin, 'mot-de-passe': () => !CAN.admin(),
    };
    if (!allowed[page]?.()) [page, id] = homeHash().slice(2).split('/');
    const tab = page.startsWith('produit') ? 'produits' : page === 'commande' ? 'commandes' : page;
    document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    if (page === 'clients') return viewCustomers();
    if (page === 'agences') return viewAgencies(id);
    if (page === 'equipe') return viewStaff(id);
    if (page === 'journal') return viewActivity();
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
