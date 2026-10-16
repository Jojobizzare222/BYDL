// Kamwa — bulle « Aide » : assistant automatique + conseillers Kamwa (messagerie interne, aucun outil externe).
// Le visiteur sans compte est reconnu par une clé secrète gardée sur ce téléphone (kamwa-chat), jamais dans l'adresse.
(() => {
  const KEY = 'kamwa-chat';
  const ico = (n) => `<svg class="ico" aria-hidden="true"><use href="/icons.svg?v=11#${n}"></use></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const token = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const saveToken = (t) => { try { if (t) localStorage.setItem(KEY, t); } catch {} };
  async function api(path, opt = {}) {
    const r = await fetch('/api/chat' + path, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Chat-Token': token() }, body: opt.body && JSON.stringify(opt.body), cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Connexion impossible');
    return d;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <button class="chat-fab" id="chatFab" aria-label="Aide : poser une question">${ico('chat-circle-dots-fill')}<span>Aide</span><b class="chat-badge" id="chatBadge" hidden></b></button>
    <section class="chat-panel" id="chatPanel" hidden aria-label="Messagerie Kamwa">
      <header class="chat-head">
        <img src="/brand/symbole-kamwa.svg" alt="" width="34" height="34">
        <div><strong>Aide Kamwa</strong><small id="chatState">Assistant · réponse immédiate</small></div>
        <button class="chat-x" id="chatClose" aria-label="Fermer">${ico('x-bold')}</button>
      </header>
      <div class="chat-body" id="chatBody" aria-live="polite"></div>
      <form class="chat-contact" id="chatContact" hidden>
        <p>Pour qu'un conseiller puisse vous recontacter :</p>
        <input name="name" placeholder="Votre nom" maxlength="80" autocomplete="name">
        <input name="phone" type="tel" inputmode="tel" placeholder="06 123 45 67" autocomplete="tel">
        <button class="btn cta small">Envoyer</button>
      </form>
      <form class="chat-input" id="chatForm">
        <textarea id="chatText" rows="1" maxlength="2000" placeholder="Écrivez votre message…" aria-label="Votre message"></textarea>
        <button aria-label="Envoyer">${ico('paper-plane-right-fill')}</button>
      </form>
    </section>`);
  const fab = document.getElementById('chatFab'), panel = document.getElementById('chatPanel'), body = document.getElementById('chatBody');
  const form = document.getElementById('chatForm'), input = document.getElementById('chatText'), badge = document.getElementById('chatBadge');
  let conv = null; let welcome = null; let open = false; let sending = false; let shownCount = -1;

  const time = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const fmt = (t) => esc(t).replace(/\n/g, '<br>');
  function render() {
    const msgs = conv?.messages?.length ? conv.messages : welcome ? [{ ...welcome, id: 'w', at: new Date().toISOString() }] : [];
    const last = msgs[msgs.length - 1];
    body.innerHTML = msgs.map((m) => `
      <div class="msg ${m.from}">
        ${m.from === 'staff' ? `<span class="who">${esc(m.staffName || 'Kamwa')} · conseiller Kamwa</span>` : m.from === 'bot' ? '<span class="who">Assistant Kamwa</span>' : ''}
        <div class="bubble">${fmt(m.text)}${(m.links || []).length ? `<div class="msg-links">${m.links.map((l) => `<a href="${esc(l.href)}" data-chat-link>${esc(l.label)} ${ico('caret-right')}</a>`).join('')}</div>` : ''}</div>
        <span class="t">${time(m.at)}</span>
      </div>`).join('')
      + (last?.from === 'bot' && last.quick?.length && conv?.status !== 'open' ? `<div class="quick">${last.quick.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : '')
      ;
    document.getElementById('chatState').textContent = conv?.status === 'open' ? 'Un conseiller Kamwa vous répond ici' : conv?.status === 'closed' ? 'Conversation terminée' : 'Assistant · réponse immédiate';
    if (msgs.length !== shownCount) { body.scrollTop = body.scrollHeight; shownCount = msgs.length; }
  }
  function setBadge() {
    const n = conv?.unread || 0;
    badge.hidden = !n || open; badge.textContent = n;
  }
  async function load() {
    try {
      const d = await api('');
      welcome = d.welcome;
      const before = JSON.stringify(conv?.messages?.map((m) => m.id) || []);
      conv = d.conversation;
      if (open) { if (before !== JSON.stringify(conv?.messages?.map((m) => m.id) || [])) render(); if (conv?.unread) api('/read', { body: {} }).catch(() => {}); }
      setBadge();
    } catch {}
  }
  async function send(text) {
    if (sending || !text.trim()) return;
    sending = true;
    // Message affiché tout de suite (puis remplacé par la version du serveur)
    conv = conv || { status: 'bot', messages: [] };
    conv.messages = [...(conv.messages || []), { id: 'tmp', from: 'customer', text, at: new Date().toISOString() }];
    render();
    try {
      const d = await api('/messages', { body: { text } });
      saveToken(d.token);
      conv = d.conversation;
      document.getElementById('chatContact').hidden = !d.needContact;
      render();
    } catch (err) {
      conv.messages = conv.messages.filter((m) => m.id !== 'tmp');
      conv.messages.push({ id: 'err', from: 'bot', text: err.message, at: new Date().toISOString() });
      render();
    } finally { sending = false; }
  }
  function toggle(on) {
    open = on; panel.hidden = !on; fab.classList.toggle('on', on);
    document.body.classList.toggle('chat-open', on);
    if (on) { render(); load(); setTimeout(() => input.focus(), 50); }
    setBadge();
  }
  fab.addEventListener('click', () => toggle(!open));
  document.getElementById('chatClose').addEventListener('click', () => toggle(false));
  form.addEventListener('submit', (e) => { e.preventDefault(); const t = input.value; input.value = ''; input.style.height = ''; send(t); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = Math.min(input.scrollHeight, 110) + 'px'; });
  body.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]');
    if (q) return send(q.dataset.q);
    if (e.target.closest('[data-chat-link]') && matchMedia('(max-width: 700px)').matches) toggle(false);
  });
  document.getElementById('chatContact').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const d = await api('/human', { body: { name: f.name.value, phone: f.phone.value } });
      conv = d.conversation; f.hidden = true; render();
    } catch (err) { alert(err.message); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) toggle(false); });

  // Réponses des conseillers : toutes les 4 s quand la fenêtre est ouverte, toutes les 30 s sinon (pastille)
  load();
  let tick = 0;
  setInterval(() => { tick++; if (document.hidden) return; if (open || (conv && tick % 7 === 0)) load(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  window.kamwaChat = { open: () => toggle(true), refresh: () => load() };
  // Ouvert depuis une notification « réponse d'un conseiller »
  if (/[?&]aide=1/.test(location.search)) { history.replaceState(null, '', location.pathname + location.hash); toggle(true); }
})();
