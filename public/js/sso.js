// Connexion sans code (décision Joseph 22/10/2026) : clés d'accès (empreinte, Face ID…), Google, Apple.
// Le navigateur ne fait que recueillir la preuve (clé d'accès signée, jeton Google / Apple) : c'est le serveur qui vérifie
// tout (src/customer/sso.js). Les scripts de Google et d'Apple ne sont chargés QUE si le client clique sur leur bouton.
(() => {
  const ico = (n) => `<svg class="ico" aria-hidden="true"><use href="/icons.svg?v=16#${n}"></use></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  async function api(path, body, method = 'POST') {
    const r = await fetch('/api/account' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Connexion impossible');
    return d;
  }

  // ---------- Clés d'accès (WebAuthn) ----------
  const b2u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const u2b = (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '==='.slice((t.length + 3) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer; };
  const passkeysOk = () => Boolean(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
  const toCreate = (o) => (PublicKeyCredential.parseCreationOptionsFromJSON ? PublicKeyCredential.parseCreationOptionsFromJSON(o)
    : { ...o, challenge: u2b(o.challenge), user: { ...o.user, id: u2b(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: u2b(c.id) })) });
  const toGet = (o) => (PublicKeyCredential.parseRequestOptionsFromJSON ? PublicKeyCredential.parseRequestOptionsFromJSON(o)
    : { ...o, challenge: u2b(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: u2b(c.id) })) });
  function credJSON(c) {
    if (c.toJSON) try { return c.toJSON(); } catch {}
    const r = c.response, out = { id: c.id, rawId: b2u(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults?.() || {}, authenticatorAttachment: c.authenticatorAttachment || undefined, response: { clientDataJSON: b2u(r.clientDataJSON) } };
    if (r.attestationObject) Object.assign(out.response, { attestationObject: b2u(r.attestationObject), transports: r.getTransports?.() || [] });
    if (r.authenticatorData) Object.assign(out.response, { authenticatorData: b2u(r.authenticatorData), signature: b2u(r.signature), userHandle: r.userHandle ? b2u(r.userHandle) : undefined });
    return out;
  }
  const niceError = (err) => (err?.name === 'NotAllowedError' ? new Error('Opération annulée ou délai dépassé.') : err?.name === 'InvalidStateError' ? new Error('Cette clé d\'accès est déjà enregistrée sur ce téléphone.') : err);
  async function passkeyLogin(deviceOrders) {
    const { options, token } = await api('/passkey/login-options', {});
    let cred; try { cred = await navigator.credentials.get({ publicKey: toGet(options) }); } catch (err) { throw niceError(err); }
    return api('/passkey/login', { response: credJSON(cred), token, deviceOrders });
  }
  async function passkeyRegister(label) {
    const { options, token } = await api('/passkey/register-options', {});
    let cred; try { cred = await navigator.credentials.create({ publicKey: toCreate(options) }); } catch (err) { throw niceError(err); }
    return api('/passkey/register', { response: credJSON(cred), token, label });
  }
  const deviceLabel = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Téléphone Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Ordinateur Windows' : 'Cet appareil'; };

  // ---------- Google / Apple : scripts chargés à la demande ----------
  const loadScript = (src) => new Promise((ok, ko) => { if ([...document.scripts].some((s) => s.src === src)) return ok(); const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = () => ko(new Error('Connexion impossible : vérifiez votre réseau')); document.head.appendChild(s); });
  function googleToken(cfg) {
    return new Promise((resolve, reject) => {
      loadScript('https://accounts.google.com/gsi/client').then(() => {
        const g = window.google?.accounts?.id; if (!g) return reject(new Error('Google indisponible'));
        g.initialize({ client_id: cfg.clientId, callback: (r) => (r.credential ? resolve(r.credential) : reject(new Error('Connexion Google annulée'))), ux_mode: 'popup', use_fedcm_for_prompt: true });
        // Fenêtre de choix du compte ; si le navigateur la bloque, on affiche le bouton officiel de Google
        g.prompt((n) => {
          if (n.isNotDisplayed?.() || n.isSkippedMoment?.()) {
            const host = document.getElementById('googleBtnHost');
            if (host) { host.hidden = false; g.renderButton(host, { theme: 'outline', size: 'large', text: 'continue_with', locale: 'fr', width: Math.min(360, host.clientWidth || 320) }); }
            else reject(new Error('Fenêtre Google bloquée : autorisez les fenêtres pour Zado'));
          }
        });
      }).catch(reject);
    });
  }
  async function appleToken(cfg) {
    await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/fr_FR/appleid.auth.js');
    window.AppleID.auth.init({ clientId: cfg.clientId, scope: 'name email', redirectURI: cfg.redirectURI, usePopup: true });
    try {
      const r = await window.AppleID.auth.signIn();
      return r.authorization.id_token;
    } catch (err) { throw new Error(err?.error === 'popup_closed_by_user' ? 'Connexion Apple annulée' : 'Connexion Apple impossible'); }
  }
  async function providerLogin(provider, cfg, { link = false, deviceOrders } = {}) {
    const credential = provider === 'google' ? await googleToken(cfg) : await appleToken(cfg);
    return api('/oauth/' + provider, { credential, link, deviceOrders });
  }

  // ---------- Boutons (connexion / création de compte) ----------
  const G_LOGO = '<svg class="sso-logo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  const A_LOGO = '<svg class="sso-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.4-.8 1.5 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.8-1.1-2.8-4.1zM13.9 5c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"/></svg>';
  /** Bloc de boutons. mode : 'login' | 'signup'. auth = config.auth du serveur. */
  function buttonsHtml(auth = {}, mode = 'login') {
    const verb = mode === 'signup' ? 'Créer mon compte avec' : 'Continuer avec';
    const soon = (on) => (on ? '' : ' disabled title="Bientôt disponible"');
    return `<div class="sso">
      ${mode === 'login' && passkeysOk() ? `<button type="button" class="btn sso-btn sso-key" data-sso="passkey">${ico('fingerprint')} Se connecter avec une clé d'accès</button>` : ''}
      <button type="button" class="btn sso-btn sso-google" data-sso="google"${soon(auth.google)}>${G_LOGO} ${verb} Google${auth.google ? '' : ' <small>bientôt</small>'}</button>
      <div id="googleBtnHost" class="sso-gbtn" hidden></div>
      <button type="button" class="btn sso-btn sso-apple" data-sso="apple"${soon(auth.apple)}>${A_LOGO} ${verb} Apple${auth.apple ? '' : ' <small>bientôt</small>'}</button>
      <div class="sso-msg" role="alert"></div>
      <p class="sso-or"><span>ou avec votre numéro / e-mail et votre code Zado</span></p>
    </div>`;
  }
  /** Branche les boutons. onDone(res) : connecté ; onSignup(res) : aucun compte lié → création pré-remplie. */
  function bindButtons(root, auth, { deviceOrders, onDone, onSignup }) {
    const msg = root.querySelector('.sso-msg');
    root.querySelectorAll('[data-sso]').forEach((b) => b.addEventListener('click', async () => {
      const kind = b.dataset.sso; msg.innerHTML = ''; b.disabled = true;
      try {
        const res = kind === 'passkey' ? await passkeyLogin(deviceOrders()) : await providerLogin(kind, auth[kind], { deviceOrders: deviceOrders() });
        if (res.signup) onSignup(res); else onDone(res);
      } catch (err) { msg.innerHTML = `<div class="alert err">${esc(err.message)}</div>`; }
      finally { b.disabled = kind !== 'passkey' && !auth[kind]; }
    }));
  }

  // ---------- Réglages : mes clés d'accès, comptes liés ----------
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  function settingsHtml(c, auth = {}) {
    const keys = c.passkeys || [], linked = c.linked || {};
    const prov = (p, name, logo) => `<div class="pref-row"><span><b>${logo} ${name}</b><small>${linked[p] ? `Lié${linked[p].email ? ' : ' + esc(linked[p].email) : ''} · vous pouvez vous connecter avec ${name}` : auth[p] ? `Connectez-vous en un geste avec votre compte ${name}` : 'Bientôt disponible'}</small></span>
      ${linked[p] ? `<button type="button" class="btn ghost small" data-unlink="${p}">Délier</button>` : `<button type="button" class="btn ghost small" data-link="${p}" ${auth[p] ? '' : 'disabled'}>Lier</button>`}</div>`;
    return `<div class="panel prefs" id="ssoPanel"><h2>${ico('fingerprint')} Connexion rapide</h2>
      <div class="pref-row"><span><b>Clés d'accès</b><small>Connectez-vous avec l'empreinte, Face ID ou le code de votre téléphone, sans taper votre code Zado.${passkeysOk() ? '' : ' Ce navigateur ne les accepte pas.'}</small></span>
        <button type="button" class="btn ghost small" id="pkAdd" ${passkeysOk() ? '' : 'disabled'}>${ico('plus-bold')} Ajouter</button></div>
      ${keys.length ? `<ul class="pk-list">${keys.map((k) => `<li><span>${ico('fingerprint')} <b>${esc(k.label)}</b><small>Ajoutée le ${day(k.createdAt)}${k.lastUsedAt ? ` · utilisée le ${day(k.lastUsedAt)}` : ''}${k.synced ? ' · synchronisée' : ''}</small></span><button type="button" class="linkish" data-pkdel="${esc(k.id)}">Retirer</button></li>`).join('')}</ul>` : ''}
      ${prov('google', 'Google', G_LOGO)}${prov('apple', 'Apple', A_LOGO)}
      <div class="sso-msg" id="ssoMsg" role="status"></div></div>`;
  }
  function bindSettings(root, auth, onChange) {
    const msg = root.querySelector('#ssoMsg');
    const say = (t, ok) => { msg.innerHTML = `<div class="alert ${ok ? 'ok' : 'err'}">${esc(t)}</div>`; };
    root.querySelector('#pkAdd')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { const r = await passkeyRegister(deviceLabel()); onChange(r.customer, 'Clé d\'accès ajoutée : à la prochaine connexion, touchez « Se connecter avec une clé d\'accès ».'); }
      catch (err) { say(err.message); e.target.disabled = false; }
    });
    root.querySelectorAll('[data-pkdel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Retirer cette clé d\'accès ? Vous pourrez toujours vous connecter avec votre code Zado.')) return;
      try { const r = await api('/passkeys/' + encodeURIComponent(b.dataset.pkdel), null, 'DELETE'); onChange(r.customer, 'Clé d\'accès retirée.'); } catch (err) { say(err.message); }
    }));
    root.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await providerLogin(b.dataset.link, auth[b.dataset.link], { link: true }); onChange(r.customer, 'Compte lié.'); } catch (err) { say(err.message); }
    }));
    root.querySelectorAll('[data-unlink]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await api('/oauth/' + b.dataset.unlink, null, 'DELETE'); onChange(r.customer, 'Compte délié.'); } catch (err) { say(err.message); }
    }));
  }

  window.kamwaSso = { passkeysOk, buttonsHtml, bindButtons, settingsHtml, bindSettings };
})();
