// Kamwa — espace admin (aucune dépendance). Routes : #/commandes, #/commande/<id>, #/produits, #/produit/<id|nouveau>
(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');
  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const date = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const ICONS = { 'Téléphones': '📱', 'Tablettes': '📲', 'Ordinateurs': '💻', 'Montres': '⌚', 'Audio': '🎧', 'TV & Maison': '📺', 'Composants': '💾', 'Accessoires': '🔌', 'Homme': '👕', 'Femme': '👚', 'Chaussures': '👟' };

  const state = { orders: [], labels: {}, transitions: {}, products: [], universes: [], orderFilter: 'paid', productQuery: '', seenPaid: null };

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

  // ---------- Connexion ----------
  function showLogin(message) {
    $('#top').hidden = true;
    app.innerHTML = `
      <form class="panel login" id="loginForm">
        <span class="logo"><img src="/brand/logo-kamwa.svg" alt="Kamwa" width="183" height="44"></span>
        <h1>Espace admin</h1>
        ${message ? `<div class="alert err">${esc(message)}</div>` : ''}
        <label for="password">Mot de passe</label>
        <input id="password" type="password" autocomplete="current-password" required autofocus>
        <button class="btn dark" style="width:100%;margin-top:16px">Se connecter</button>
        <p class="muted">Mot de passe oublié ? Dans le Terminal : <code>npm run admin:password</code></p>
      </form>`;
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        await api('/login', { method: 'POST', body: { password: $('#password').value } });
        enableSound(soundWanted()); // le clic de connexion autorise le son
        await start();
      } catch (err) {
        showLogin(err.message);
      }
    });
  }

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.hash = '';
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
    $('#soundBtn').textContent = soundOn() ? '🔔 Son' : '🔕 Son';
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
    $('#todoCount').hidden = !todo;
    $('#todoCount').textContent = todo;
    document.title = todo ? `(${todo}) Kamwa Admin` : 'Kamwa Admin';
  }

  async function loadProducts() {
    const [list, meta] = await Promise.all([api('/products'), state.universes.length ? null : api('/meta')]);
    state.products = list;
    if (meta) state.universes = meta.universes;
  }

  // Vérifie les nouvelles commandes toutes les 20 s (et rafraîchit la liste si elle est affichée)
  setInterval(async () => {
    if ($('#top').hidden) return;
    try {
      await loadOrders();
      if ((location.hash || '#/commandes').startsWith('#/commandes')) viewOrders();
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
    const count = (k) => state.orders.filter((o) => matches(o, k)).length;
    const list = state.orders.filter((o) => matches(o, f));
    app.innerHTML = `
      <div class="chips">${FILTERS.map(([k, label]) => `<button class="chip ${f === k ? 'on' : ''}" data-filter="${k}">${label} (${count(k)})</button>`).join('')}</div>
      ${f === 'pending_payment' ? '<p class="muted">Commandes commencées mais pas payées (paiement refusé, abandonné, en cours, ou réservation en agence). Rien à expédier.</p>' : ''}
      ${f === 'collect' ? '<p class="muted">Réservations en cours : le client vient payer en espèces à l\'agence. Préparez les articles.</p>' : ''}
      <div class="list">
        ${list.length ? list.map((o) => `
          <a class="item ${o.paidAfterCancel ? 'flag' : ''}" href="#/commande/${enc(o.id)}">
            <strong>${esc(o.customer.name)}</strong>
            <span class="total">${fcfa(o.total)}</span>
            <span class="sub">${esc(o.customer.city || '—')} · ${o.lines.reduce((s, l) => s + l.qty, 0)} article(s) · ${date(o.createdAt)}</span>
            <span>${badge(o.status)} ${isPickup(o) ? `<span class="tag">🏪 Retrait ${esc(o.agency?.name || '')}</span>` : ''}</span>
            ${o.paidAfterCancel ? '<span class="sub" style="color:var(--err);grid-column:1/-1">⚠️ Payée après annulation : à rembourser</span>' : ''}
          </a>`).join('') : '<p class="empty">Aucune commande ici.</p>'}
      </div>`;
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
    app.innerHTML = `
      <div class="row between" style="margin-bottom:10px">
        <h1 style="margin:0">Agences</h1>
        ${editing ? '' : '<a class="btn" href="#/agences/nouvelle">+ Ajouter</a>'}
      </div>
      <p class="muted">Les agences actives permettent au client de choisir « Espèces en agence » : il réserve en ligne, paie en espèces à l'agence et repart avec sa commande. Sans agence active, cette option n'apparaît pas sur le site.</p>
      ${editing ? `
      <form class="panel" id="agencyForm" novalidate>
        <h2>${editing.id ? 'Modifier l\'agence' : 'Nouvelle agence'}</h2>
        <label for="aName">Nom *</label><input id="aName" type="text" value="${esc(editing.name)}" placeholder="Ex. Kamwa Centre-ville">
        <label for="aCity">Ville *</label><input id="aCity" type="text" value="${esc(editing.city)}" placeholder="Pointe-Noire">
        <label for="aAddress">Adresse / repère</label><input id="aAddress" type="text" value="${esc(editing.address)}" placeholder="Avenue…, face à…">
        <label for="aHours">Horaires</label><input id="aHours" type="text" value="${esc(editing.hours)}" placeholder="Lun-Sam 9h-18h">
        <label for="aPhone">Téléphone</label><input id="aPhone" type="tel" value="${esc(editing.phone)}">
        <label class="check"><input id="aActive" type="checkbox" ${editing.active !== false ? 'checked' : ''}> Active (proposée aux clients)</label>
        <div id="aError"></div>
        <div class="row" style="margin-top:14px"><button class="btn">Enregistrer</button><a class="ghost" href="#/agences">Annuler</a></div>
      </form>` : `
      <div class="list">
        ${list.map((a) => `
          <a class="item ${a.active === false ? 'prod off' : ''}" href="#/agences/${enc(a.id)}">
            <span><strong>${esc(a.name)}</strong> — ${esc(a.city)}<br><span class="sub">${esc(a.address || 'adresse à venir')}${a.hours ? ' · ' + esc(a.hours) : ''}</span></span>
            <span class="sub">${a.active === false ? 'inactive' : '✓ active'}</span>
          </a>`).join('') || '<p class="empty">Aucune agence pour le moment. Ajoutez-en une dès que vous en ouvrez une.</p>'}
      </div>`}`;
    $('#agencyForm')?.addEventListener('submit', async (e) => {
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
  }

  // ---------- Clients ----------
  async function viewCustomers() {
    let list = [];
    try { list = await api('/customers'); } catch { return; }
    app.innerHTML = `
      <h1>Clients <small class="muted">(${list.length} compte${list.length > 1 ? 's' : ''})</small></h1>
      <p class="muted">Un client a oublié son code ? Cliquez « Nouveau code » et envoyez-le-lui par WhatsApp.</p>
      <div class="list">
        ${list.map((c) => `
          <div class="item">
            <span><strong>${esc(c.name)}</strong><br><span class="sub">${esc([c.phone, c.email].filter(Boolean).join(' · '))}</span></span>
            <span style="text-align:right"><span class="sub">${c.orders} commande(s)<br>depuis le ${date(c.createdAt).split(' ')[0]}</span></span>
            <span style="grid-column:1/-1"><button class="ghost" data-code="${esc(c.id)}" style="min-height:34px;padding:4px 10px">Nouveau code</button><span data-box="${esc(c.id)}"></span></span>
          </div>`).join('') || '<p class="empty">Aucun compte client pour le moment.</p>'}
      </div>`;
    app.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', () => {
      const c = list.find((x) => x.id === b.dataset.code);
      newCode(c, app.querySelector(`[data-box="${CSS.escape(c.id)}"]`));
    }));
  }

  // ---------- Produits ----------
  const thumb = (p) => (p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="thumb">${ICONS[p.category] || '🛍️'}</span>`);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function viewProducts() {
    const words = norm(state.productQuery).split(/\s+/).filter(Boolean);
    const list = state.products.filter((p) => words.every((w) => norm(`${p.name} ${p.brand} ${p.category}`).includes(w)));
    app.innerHTML = `
      <div class="row between" style="margin-bottom:10px">
        <h1 style="margin:0">Produits <small class="muted">(${state.products.length})</small></h1>
        <a class="btn" href="#/produit/nouveau">+ Ajouter</a>
      </div>
      <input type="search" id="q" placeholder="Rechercher (nom, marque, catégorie)…" value="${esc(state.productQuery)}" style="margin-bottom:10px">
      <div class="list" id="plist">
        ${list.map((p) => `
          <a class="item prod ${p.active === false ? 'off' : ''}" href="#/produit/${enc(p.id)}">
            ${thumb(p)}
            <span><strong>${esc(p.name)}</strong><br><span class="sub">${esc(p.category)}${p.active === false ? ' · masqué' : ''}${p.featured ? ' · ⭐ en avant' : ''}</span></span>
            <span style="text-align:right"><span class="price">${fcfa(p.price)}</span><br><span class="sub" style="${p.stock === 0 ? 'color:var(--err);font-weight:700' : ''}">Stock : ${p.stock}</span></span>
          </a>`).join('') || '<p class="empty">Aucun produit trouvé.</p>'}
      </div>`;
    const q = $('#q');
    q.addEventListener('input', () => {
      state.productQuery = q.value;
      const pos = q.selectionStart;
      viewProducts();
      const nq = $('#q'); nq.focus(); nq.setSelectionRange(pos, pos);
    });
  }

  function viewProduct(id) {
    const isNew = id === 'nouveau';
    const p = isNew ? { stock: 1, active: true } : state.products.find((x) => x.id === id);
    if (!p) { app.innerHTML = '<p class="empty">Produit introuvable. <a href="#/produits">Retour</a></p>'; return; }
    let image = p.image || '';
    app.innerHTML = `
      <p><a href="#/produits">‹ Tous les produits</a></p>
      <h1>${isNew ? 'Nouveau produit' : esc(p.name)}</h1>
      <form class="panel" id="pform" novalidate>
        <div class="photo">
          <div class="preview" id="preview"></div>
          <div>
            <label class="btn dark" style="margin:0" for="file">📷 ${image ? 'Changer la photo' : 'Ajouter une photo'}</label>
            <input id="file" type="file" accept="image/*" hidden>
            <p class="muted" id="photoHint">Photo sur fond clair de préférence. Elle sera allégée automatiquement.</p>
          </div>
        </div>

        <label for="name">Nom du produit *</label>
        <input id="name" type="text" value="${esc(p.name)}" placeholder="Ex. Samsung Galaxy A15 128 Go Noir" required>
        <div class="grid2">
          <div><label for="brand">Marque</label><input id="brand" type="text" value="${esc(p.brand)}"></div>
          <div><label for="category">Catégorie *</label>
            <select id="category">
              ${isNew ? '<option value="">Choisir…</option>' : ''}
              ${state.universes.map((u) => `<optgroup label="${esc(u.name)}">${u.categories.map((c) => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</optgroup>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid2">
          <div><label for="price">Prix (FCFA) *</label><input id="price" type="number" inputmode="numeric" min="1" step="1" value="${esc(p.price)}"></div>
          <div><label for="oldPrice">Prix barré (facultatif)</label><input id="oldPrice" type="number" inputmode="numeric" min="1" step="1" value="${esc(p.oldPrice ?? '')}"></div>
        </div>
        <p class="muted" style="margin:4px 0 0">Prix barré = ancien prix, plus élevé. Il affiche le badge de remise (ex. -10 %).</p>
        <label for="stock">Stock disponible *</label>
        <input id="stock" type="number" inputmode="numeric" min="0" step="1" value="${esc(p.stock)}">
        <label for="description">Description</label>
        <textarea id="description" rows="4" placeholder="Caractéristiques, taille, couleur, état…">${esc(p.description)}</textarea>
        <label class="check"><input id="active" type="checkbox" ${p.active !== false ? 'checked' : ''}> Visible sur la boutique</label>
        <label class="check"><input id="featured" type="checkbox" ${p.featured ? 'checked' : ''}> Mettre en avant sur l'accueil</label>
        <div id="formError"></div>
        <button class="btn" style="width:100%;margin-top:16px;min-height:48px">${isNew ? 'Ajouter le produit' : 'Enregistrer'}</button>
      </form>
      ${isNew ? '' : `<p class="muted">Pour retirer un produit de la boutique, décochez « Visible » : il reste dans l'historique des commandes. <a href="/#/p/${enc(p.id)}" target="_blank">Voir sur la boutique ›</a></p>`}`;

    const renderPreview = () => {
      $('#preview').innerHTML = image ? `<img src="${esc(image)}" alt="">` : (ICONS[$('#category').value] || '🛍️');
    };
    renderPreview();
    $('#category').addEventListener('change', renderPreview);

    $('#file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const hint = $('#photoHint');
      hint.textContent = 'Envoi de la photo…';
      try {
        const blob = await shrinkImage(file);
        const { url } = await api('/uploads', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } });
        image = url;
        renderPreview();
        hint.textContent = `Photo prête (${Math.round(blob.size / 1024)} Ko). Pensez à enregistrer.`;
      } catch (err) {
        hint.textContent = '❌ ' + err.message;
      }
    });

    $('#pform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        name: $('#name').value,
        brand: $('#brand').value,
        category: $('#category').value,
        price: $('#price').value,
        oldPrice: $('#oldPrice').value,
        stock: $('#stock').value,
        description: $('#description').value,
        active: $('#active').checked,
        featured: $('#featured').checked,
        image,
      };
      const btn = e.target.querySelector('button.btn:last-of-type');
      btn.disabled = true;
      try {
        const saved = await api(isNew ? '/products' : '/products/' + enc(p.id), { method: isNew ? 'POST' : 'PATCH', body });
        state.products = isNew ? [...state.products, saved] : state.products.map((x) => (x.id === saved.id ? saved : x));
        toast(isNew ? 'Produit ajouté ✓' : 'Produit enregistré ✓');
        location.hash = '#/produits';
      } catch (err) {
        $('#formError').innerHTML = `<div class="alert err">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
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
    const [page, id] = (location.hash || '#/commandes').slice(2).split('/').map(decodeURIComponent);
    window.scrollTo(0, 0);
    const tab = page.startsWith('produit') ? 'produits' : ['clients', 'agences'].includes(page) ? page : 'commandes';
    document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    if (page === 'clients') return viewCustomers();
    if (page === 'agences') return viewAgencies(id);
    if (page === 'commande') return viewOrder(id);
    if (page === 'produits') return viewProducts();
    if (page === 'produit') return viewProduct(id);
    return viewOrders();
  }

  async function start() {
    app.innerHTML = '<p class="empty">Chargement…</p>';
    await Promise.all([loadOrders(), loadProducts()]);
    $('#top').hidden = false;
    renderSoundBtn();
    route();
  }

  window.addEventListener('hashchange', async () => {
    if ($('#top').hidden) return;
    // Données fraîches à chaque changement de page
    try { await (location.hash.startsWith('#/produit') ? loadProducts() : loadOrders()); } catch { return; }
    route();
  });

  (async () => {
    try {
      const me = await api('/me');
      if (!me.loggedIn) return showLogin(me.passwordSet ? '' : "Le mot de passe n'est pas encore créé. Dans le Terminal : npm run admin:password");
      // Déjà connecté : le son ne pourra démarrer qu'après un clic (règle des navigateurs)
      if (soundWanted()) document.addEventListener('click', () => enableSound(true), { once: true });
      await start();
    } catch {
      app.innerHTML = '<p class="empty">Connexion impossible. Vérifiez votre réseau.</p>';
    }
  })();
})();
