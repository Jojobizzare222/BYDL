// Zado Pro — « Base de données » façon Excel (demande Joseph 10/11/2026 : « toutes les données côté admin, aux airs
// d'Excel, sois créatif »). Une feuille par collection (onglets colorés en bas), lettres de colonnes et numéros de lignes,
// barre de formule, sélection de cellules au clavier et à la souris, Somme / Moyenne / Min / Max dans la barre d'état,
// tri et filtres par colonne, colonnes masquables et redimensionnables, tableau croisé (« Regrouper par »), barres de
// données sur les montants, copier-coller avec Excel (Ctrl+C / Ctrl+V), annulation (Ctrl+Z), export .xlsx et CSV.
// Seule la feuille « Produits » se modifie (double-clic, Entrée ou en tapant) : chaque modification passe par la fiche
// produit côté serveur (mêmes contrôles, journal, mouvements de stock). Réservé à l'administrateur.
(() => {
  const ROW_H = 30, BUFFER = 14;
  const S = { sheet: null, sheets: [], data: null, ui: {} }; // ui[sheet] = { sort, dir, filters, hidden, widths, group, q, bars }
  const undo = [];
  let pro, host, sel = { r: 0, c: 0, r2: 0, c2: 0 }, view = [], cols = [], editing = null, busy = false;

  const LS = 'zado-tableur';
  const loadUi = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
  const saveUi = () => { try { localStorage.setItem(LS, JSON.stringify({ sheet: S.sheet, ui: S.ui })); } catch {} };
  const ui = () => (S.ui[S.sheet] ||= { sort: null, dir: 1, filters: {}, hidden: [], widths: {}, group: '', q: '', bars: true });
  const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const nf = new Intl.NumberFormat('fr-FR');
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const isNum = (c) => ['money', 'num', 'pct', 'stars'].includes(c.t);

  // Couleur stable pour les étiquettes (statuts, rayons…) : même mot = même couleur
  const TAG_COLORS = ['#1E56C2', '#16A34A', '#CA8A04', '#DC2626', '#7C3AED', '#0D9488', '#EA580C', '#DB2777', '#475569', '#0284C7'];
  const TAG_FIXED = { 'Payée': '#16A34A', 'Livrée': '#0D9488', 'Annulée': '#DC2626', 'Non payée': '#CA8A04', 'En livraison': '#1E56C2', 'Confirmée': '#7C3AED', 'Réussi': '#16A34A', 'Échoué': '#DC2626', 'En attente': '#CA8A04', 'Vérifiée': '#16A34A', 'À vérifier': '#CA8A04', 'Refusée': '#DC2626', 'À fournir': '#64748B', 'Dépense': '#DC2626', 'Entrée': '#16A34A' };
  const tagColor = (v) => TAG_FIXED[v] || TAG_COLORS[[...String(v)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % TAG_COLORS.length];

  function fmt(c, v, raw = false) {
    if (v == null || v === '') return raw ? '' : '';
    if (c.t === 'money') return raw ? String(v) : nf.format(v);
    if (c.t === 'pct') return raw ? String(Math.round(v * 1000) / 10) : `${(Math.round(v * 1000) / 10).toString().replace('.', ',')} %`;
    if (c.t === 'num') return raw ? String(v).replace('.', ',') : nf.format(v);
    if (c.t === 'bool') return v ? 'oui' : 'non';
    return String(v);
  }
  function cellHtml(c, v, row) {
    const e = pro.esc;
    if (v == null || v === '') return '';
    switch (c.t) {
      case 'money': return `<span class="n">${nf.format(v)}</span>`;
      case 'pct': { const p = Math.round(v * 1000) / 10; return `<span class="n pct ${p < 8 ? 'low' : p >= 20 ? 'high' : ''}">${String(p).replace('.', ',')} %</span>`; }
      case 'num': return `<span class="n ${c.k === 'stock' && v === 0 ? 'neg' : ''}">${nf.format(v)}</span>`;
      case 'stars': return `<span class="stars" title="${v}/5">${'★'.repeat(Math.round(v))}<i>${'★'.repeat(5 - Math.round(v))}</i></span>`;
      case 'bool': return v ? `<span class="yes">${pro.icon('check-bold')}</span>` : '<span class="no">—</span>';
      case 'tag': return `<span class="xt" style="--t:${tagColor(v)}">${e(v)}</span>`;
      case 'link': return `<a href="${e(v)}" target="_blank" rel="noopener noreferrer" title="${e(v)}">${pro.icon('arrow-square-out-bold')} ${e(new URL(v).hostname.replace(/^www\./, ''))}</a>`;
      case 'id': return row._href ? `<a class="xid" href="${e(row._href)}">${e(v)}</a>` : `<b class="xid">${e(v)}</b>`;
      default: return e(v);
    }
  }

  // ---------- Données ----------
  async function loadSheet(key) {
    S.sheet = key; saveUi();
    host.querySelector('.xl-grid').innerHTML = '<p class="xl-loading">Chargement de la feuille…</p>';
    try { S.data = await pro.api('/tableur/sheet/' + encodeURIComponent(key)); } catch (e) { pro.toast('❌ ' + e.message); return; }
    sel = { r: 0, c: 0, r2: 0, c2: 0 };
    drawAll();
  }

  function compute() {
    const u = ui(), d = S.data;
    cols = d.cols.filter((c) => !u.hidden.includes(c.k));
    let rows = d.rows;
    const q = norm(u.q).trim();
    if (q) rows = rows.filter((r) => cols.some((c) => norm(fmt(c, r[c.k])).includes(q)));
    for (const [k, f] of Object.entries(u.filters)) {
      const c = d.cols.find((x) => x.k === k); if (!c) continue;
      if (f.values) { const set = new Set(f.values); rows = rows.filter((r) => set.has(fmt(c, r[k]) || '(vide)')); }
      if (f.min != null && f.min !== '') rows = rows.filter((r) => r[k] != null && r[k] >= Number(f.min) / (c.t === 'pct' ? 100 : 1));
      if (f.max != null && f.max !== '') rows = rows.filter((r) => r[k] != null && r[k] <= Number(f.max) / (c.t === 'pct' ? 100 : 1));
      if (f.text) { const t = norm(f.text); rows = rows.filter((r) => norm(fmt(c, r[k])).includes(t)); }
    }
    if (u.sort) {
      const c = d.cols.find((x) => x.k === u.sort);
      if (c) {
        const coll = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
        rows = [...rows].sort((a, b) => {
          const x = a[c.k], y = b[c.k];
          if (x == null || x === '') return 1; if (y == null || y === '') return -1;
          return (typeof x === 'number' && typeof y === 'number' ? x - y : coll.compare(String(x), String(y))) * u.dir;
        });
      }
    }
    view = rows;
    // échelle des barres de données (montants)
    S.max = {};
    for (const c of cols) if (c.t === 'money') S.max[c.k] = Math.max(1, ...rows.map((r) => Math.abs(r[c.k] || 0)));
  }

  // ---------- Dessin ----------
  function drawAll() {
    compute();
    drawTabs(); drawRibbon();
    const u = ui();
    const grid = host.querySelector('.xl-grid');
    if (u.group) return drawPivot(grid);
    const w = (c) => u.widths[c.k] || c.w || 110;
    grid.innerHTML = `<table class="xl-t" style="width:${46 + cols.reduce((s, c) => s + w(c), 0)}px">
      <colgroup><col style="width:46px">${cols.map((c) => `<col style="width:${w(c)}px">`).join('')}</colgroup>
      <thead>
        <tr class="xl-letters"><th class="xl-corner" title="Tout sélectionner"></th>${cols.map((c, i) => `<th data-ci="${i}" class="${i < 2 ? 'fz fz' + i : ''}">${colName(i)}</th>`).join('')}</tr>
        <tr class="xl-heads"><th class="xl-corner2">#</th>${cols.map((c, i) => {
          const f = u.filters[c.k], on = f && (f.values || f.min || f.max || f.text);
          return `<th data-ci="${i}" class="${i < 2 ? 'fz fz' + i : ''} ${isNum(c) ? 'r' : ''} ${S.data.editable && c.e ? 'ed' : ''}" title="${pro.esc(c.l)}${S.data.editable && c.e ? ' (modifiable)' : ''}">
            <span class="hl" data-sort="${c.k}">${pro.esc(c.l)}${u.sort === c.k ? `<b class="so">${u.dir > 0 ? '▲' : '▼'}</b>` : ''}</span>
            <button class="xf ${on ? 'on' : ''}" data-filter="${c.k}" aria-label="Filtrer ${pro.esc(c.l)}">${pro.icon('caret-down-bold')}</button>
            <span class="rz" data-rz="${c.k}"></span></th>`;
        }).join('')}</tr>
      </thead><tbody></tbody></table>${view.length ? '' : '<p class="xl-empty">Aucune ligne (vérifiez la recherche et les filtres).</p>'}`;
    // colonnes figées : décalage de la 2e colonne
    grid.style.setProperty('--fz1', (46 + w(cols[0] || {})) + 'px');
    drawRows();
    drawStatus();
  }

  function drawRows() {
    const grid = host.querySelector('.xl-grid'), tb = grid.querySelector('tbody');
    if (!tb) return;
    const top = Math.max(0, Math.floor(grid.scrollTop / ROW_H) - BUFFER);
    const n = Math.ceil(grid.clientHeight / ROW_H) + BUFFER * 2;
    const end = Math.min(view.length, top + n);
    const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2);
    const u = ui();
    let h = top ? `<tr class="sp" style="height:${top * ROW_H}px"><td colspan="${cols.length + 1}"></td></tr>` : '';
    for (let r = top; r < end; r++) {
      const row = view[r], inR = r >= r0 && r <= r1;
      h += `<tr data-r="${r}" class="${inR ? 'rs' : ''}"><th class="rn" title="Ouvrir la fiche (double-clic)">${r + 1}</th>${cols.map((c, ci) => {
        const v = row[c.k], s = inR && ci >= c0 && ci <= c1;
        const bar = u.bars && c.t === 'money' && typeof v === 'number' && v > 0 ? ` style="--bar:${Math.round((v / S.max[c.k]) * 100)}%"` : '';
        return `<td data-c="${ci}" class="${s ? 'sel' : ''} ${r === sel.r && ci === sel.c ? 'cur' : ''} ${ci < 2 ? 'fz fz' + ci : ''} ${isNum(c) ? 'r' : ''} ${bar ? 'bar' : ''} ${c.t === 'money' && v < 0 ? 'neg' : ''}"${bar}>${cellHtml(c, v, row)}</td>`;
      }).join('')}</tr>`;
    }
    const rest = view.length - end;
    if (rest > 0) h += `<tr class="sp" style="height:${rest * ROW_H}px"><td colspan="${cols.length + 1}"></td></tr>`;
    tb.innerHTML = h;
    drawFormula();
  }

  function drawTabs() {
    const t = host.querySelector('.xl-tabs');
    t.innerHTML = S.sheets.map((s) => `<button class="xl-tab ${s.key === S.sheet ? 'on' : ''}" data-sheet="${s.key}" style="--c:${s.color}">${pro.esc(s.label)} <small>${nf.format(s.count)}</small></button>`).join('');
    t.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function drawRibbon() {
    const u = ui(), d = S.data;
    const groupable = d.cols.filter((c) => ['tag', 'bool', 'text', 'date', 'datetime'].includes(c.t));
    const nFilters = Object.values(u.filters).filter((f) => f.values || f.min || f.max || f.text).length;
    const q = host.querySelector('#xlQ');
    q.placeholder = `Rechercher dans « ${d.label} »`;
    if (document.activeElement !== q) q.value = u.q || '';
    host.querySelector('.xl-rib').innerHTML = `
      <label class="xl-grp">${pro.icon('squares-four')}<select id="xlGroup" aria-label="Regrouper par"><option value="">Regrouper par…</option>${groupable.map((c) => `<option value="${c.k}" ${u.group === c.k ? 'selected' : ''}>${pro.esc(c.l)}</option>`).join('')}</select></label>
      <div class="xl-menu"><button class="btn sm" id="xlCols">${pro.icon('list-bullets-duotone')} Colonnes <small>${cols.length}/${d.cols.length}</small></button></div>
      <button class="btn sm ${u.bars ? 'on' : ''}" id="xlBars" title="Barres de données sur les montants">${pro.icon('chart-line-up-duotone')} Barres</button>
      ${nFilters || u.q || u.sort ? `<button class="btn sm" id="xlReset">${pro.icon('x-bold')} Effacer ${nFilters ? `${nFilters} filtre${nFilters > 1 ? 's' : ''}` : 'tri / recherche'}</button>` : ''}
      <span class="xl-count"><b>${nf.format(view.length)}</b> ligne${view.length > 1 ? 's' : ''}${view.length !== d.rows.length ? ` sur ${nf.format(d.rows.length)}` : ''}</span>
      <span class="xl-sp"></span>
      ${d.editable ? `<button class="btn sm" id="xlUndo" ${undo.length ? '' : 'disabled'} title="Annuler la dernière modification (Ctrl+Z)">${pro.icon('arrow-counter-clockwise')} Annuler</button>` : ''}
      <a class="btn sm" href="/api/admin/tableur/csv/${d.key}" title="Cette feuille en CSV">${pro.icon('download-simple-bold')} CSV</a>
      <a class="btn sm xl-xlsx" href="/api/admin/tableur/zado.xlsx" title="Toutes les feuilles dans un classeur Excel">${pro.icon('export')} Excel (.xlsx)</a>`;
  }

  function drawFormula() {
    const ref = host.querySelector('.xl-ref'), fx = host.querySelector('.xl-fx');
    const c = cols[sel.c], row = view[sel.r];
    if (!c || !row) { ref.textContent = ''; fx.value = ''; fx.readOnly = true; return; }
    const multi = sel.r !== sel.r2 || sel.c !== sel.c2;
    ref.textContent = multi ? `${colName(Math.min(sel.c, sel.c2))}${Math.min(sel.r, sel.r2) + 1}:${colName(Math.max(sel.c, sel.c2))}${Math.max(sel.r, sel.r2) + 1}` : `${colName(sel.c)}${sel.r + 1}`;
    if (document.activeElement !== fx) fx.value = fmt(c, row[c.k], true);
    const can = S.data.editable && c.e && !multi;
    fx.readOnly = !can; fx.classList.toggle('can', Boolean(can));
    host.querySelector('.xl-fxlbl').textContent = can ? 'ƒx' : 'ƒx';
    host.querySelector('.xl-fbar').title = can ? 'Modifiez ici puis Entrée' : 'Lecture seule';
  }

  function drawStatus() {
    const st = host.querySelector('.xl-stat');
    const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2);
    let n = 0, nums = [];
    for (let r = r0; r <= r1 && r < view.length; r++) for (let c = c0; c <= c1 && c < cols.length; c++) {
      const v = view[r][cols[c].k]; if (v != null && v !== '') n++;
      if (typeof v === 'number' && isNum(cols[c])) nums.push(v);
    }
    const money = cols.slice(c0, c1 + 1).every((c) => c.t === 'money');
    const f = (v) => (money ? nf.format(Math.round(v)) + ' FCFA' : nf.format(Math.round(v * 100) / 100));
    st.innerHTML = nums.length > 1 || (nums.length && (r1 > r0 || c1 > c0))
      ? `<span>Nb : <b>${n}</b></span><span>Somme : <b>${f(nums.reduce((a, b) => a + b, 0))}</b></span><span>Moyenne : <b>${f(nums.reduce((a, b) => a + b, 0) / nums.length)}</b></span><span>Min : <b>${f(Math.min(...nums))}</b></span><span>Max : <b>${f(Math.max(...nums))}</b></span>`
      : n > 1 ? `<span>Nb : <b>${n}</b></span>` : '';
  }

  // Tableau croisé : nombre de lignes et totaux des montants par valeur de la colonne choisie
  function drawPivot(grid) {
    const u = ui(), c = S.data.cols.find((x) => x.k === u.group);
    const money = S.data.pivot ? S.data.pivot.map((k) => S.data.cols.find((x) => x.k === k)).filter(Boolean) : S.data.cols.filter((x) => x.t === 'money').slice(0, 4);
    const groups = new Map();
    for (const r of view) {
      let key = fmt(c, r[c.k]) || '(vide)';
      if (/^date/.test(c.t) && key !== '(vide)') key = key.slice(0, 7); // dates regroupées par mois
      const g = groups.get(key) || { n: 0, sums: money.map(() => 0) };
      g.n++; money.forEach((m, i) => { g.sums[i] += Number(r[m.k]) || 0; }); groups.set(key, g);
    }
    const list = [...groups.entries()].sort((a, b) => (/^date/.test(c.t) ? (a[0] < b[0] ? 1 : -1) : b[1].n - a[1].n));
    const maxN = Math.max(1, ...list.map(([, g]) => g.n));
    grid.innerHTML = `<div class="xl-pivot">
      <p class="muted">${pro.icon('squares-four')} Tableau croisé : <b>${pro.esc(S.data.label)}</b> regroupées par <b>${pro.esc(c.l)}</b>${/^date/.test(c.t) ? ' (par mois)' : ''}. Cliquez sur une ligne pour voir le détail.</p>
      <table class="xl-pt"><thead><tr><th>${pro.esc(c.l)}</th><th class="r">Lignes</th><th></th>${money[0] ? `<th class="r">${pro.esc(money[0].l)} (moyenne)</th>` : ''}${money.map((m) => `<th class="r">${pro.esc(m.l)} (total)</th>`).join('')}</tr></thead>
      <tbody>${list.map(([k, g]) => `<tr data-gv="${pro.esc(k)}"><td>${c.t === 'tag' && k !== '(vide)' ? `<span class="xt" style="--t:${tagColor(k)}">${pro.esc(k)}</span>` : pro.esc(k)}</td><td class="r"><b>${nf.format(g.n)}</b></td><td class="pbar"><i style="width:${Math.round((g.n / maxN) * 100)}%"></i></td>${money[0] ? `<td class="r">${nf.format(Math.round(g.sums[0] / g.n))}</td>` : ''}${g.sums.map((s) => `<td class="r">${nf.format(s)}</td>`).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><th>Total</th><th class="r">${nf.format(view.length)}</th><th></th>${money[0] ? `<th class="r">${nf.format(Math.round(list.reduce((s, [, g]) => s + g.sums[0], 0) / Math.max(1, view.length)))}</th>` : ''}${money.map((m, i) => `<th class="r">${nf.format(list.reduce((s, [, g]) => s + g.sums[i], 0))}</th>`).join('')}</tr></tfoot></table></div>`;
    host.querySelector('.xl-stat').innerHTML = '';
    host.querySelector('.xl-ref').textContent = ''; host.querySelector('.xl-fx').value = '';
  }

  // ---------- Sélection et déplacements ----------
  function setSel(r, c, extend = false) {
    r = Math.max(0, Math.min(view.length - 1, r)); c = Math.max(0, Math.min(cols.length - 1, c));
    if (extend) { sel.r2 = r; sel.c2 = c; } else sel = { r, c, r2: r, c2: c };
    if (extend) { /* la cellule active reste l'ancre */ } else { sel.r = r; sel.c = c; }
    ensureVisible(extend ? r : sel.r, extend ? c : sel.c);
    paintSel(); drawStatus();
  }
  // Surbrillance de la sélection sans redessiner les lignes (le double-clic doit trouver la même cellule)
  function paintSel() {
    const tb = host.querySelector('.xl-t tbody'); if (!tb) return;
    const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2);
    tb.querySelectorAll('td.sel, td.cur').forEach((td) => td.classList.remove('sel', 'cur'));
    tb.querySelectorAll('tr.rs').forEach((tr) => tr.classList.remove('rs'));
    for (const tr of tb.querySelectorAll('tr[data-r]')) {
      const r = Number(tr.dataset.r); if (r < r0 || r > r1) continue;
      tr.classList.add('rs');
      for (const td of tr.querySelectorAll('td[data-c]')) { const c = Number(td.dataset.c); if (c >= c0 && c <= c1) td.classList.add('sel'); if (r === sel.r && c === sel.c) td.classList.add('cur'); }
    }
    drawFormula();
  }
  function ensureVisible(r, c) {
    const grid = host.querySelector('.xl-grid');
    const y = r * ROW_H, top = grid.scrollTop, h = grid.clientHeight - ROW_H * 2 - 4;
    if (y < top) grid.scrollTop = y; else if (y > top + h) grid.scrollTop = y - h;
    const td = grid.querySelector(`tr[data-r="${r}"] td[data-c="${c}"]`);
    if (td && c > 1) { const L = td.offsetLeft, R = L + td.offsetWidth, fz = parseInt(grid.style.getPropertyValue('--fz1')) || 0; if (L < grid.scrollLeft + fz + 1) grid.scrollLeft = L - fz - 1; else if (R > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = R - grid.clientWidth + 2; }
  }

  // ---------- Modification (feuille Produits) ----------
  function parseVal(c, s) {
    s = String(s ?? '').trim();
    if (c.e === 'bool') return /^(1|oui|o|yes|true|vrai|x|✓)$/i.test(s);
    if (c.e === 'money') { if (!s) return null; const n = Number(s.replace(/[\s  ]|fcfa/gi, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n) : NaN; }
    if (c.e === 'num') { if (!s) return null; const n = Number(s.replace(/[\s  ]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; }
    return s;
  }
  async function save(row, c, value, { record = true, quiet = false } = {}) {
    if (Number.isNaN(value)) { pro.toast('❌ Nombre invalide'); return false; }
    const old = row[c.k];
    if ((old ?? null) === (value ?? null)) return true;
    try {
      const p = await pro.api('/products/' + encodeURIComponent(row.id), { method: 'PATCH', body: { [c.k]: c.k === 'stock' && value == null ? '' : value } });
      // valeurs à jour (et colonnes calculées)
      for (const k of ['name', 'brand', 'category', 'price', 'oldPrice', 'sourcePrice', 'costPrice', 'stock', 'weightKg', 'provenance', 'sourceSupplier']) if (k in row) row[k] = p[k] ?? null;
      row.active = p.active !== false; row.featured = Boolean(p.featured);
      const cost = row.costPrice ?? row.sourcePrice;
      row.margin = row.price && cost != null ? row.price - cost : null; row.marginPct = row.price && cost != null ? (row.price - cost) / row.price : null;
      if (c.k === 'weightKg') { const fr = S.freight; if (fr) { const kg = fr.perArticle === false ? (row.weightKg || 0) : Math.max(fr.minKg ?? 1, row.weightKg || 0); row.transport = Math.round(kg * fr.eurPerKg * 655.957); } }
      row.delivered = row.price ? row.price + (row.transport || 0) : null;
      if (record) { undo.push({ id: row.id, k: c.k, old }); if (undo.length > 100) undo.shift(); }
      if (!quiet) flash(`Enregistré : ${c.l} de ${row.id}`);
      return true;
    } catch (e) { pro.toast('❌ ' + e.message); return false; }
  }
  function flash(msg) { const m = host.querySelector('.xl-msg'); m.innerHTML = `${pro.icon('check-circle-duotone')} ${pro.esc(msg)}`; m.classList.add('ok'); clearTimeout(flash.t); flash.t = setTimeout(() => { m.classList.remove('ok'); m.textContent = 'Prêt'; }, 2600); }

  function startEdit(initial) {
    const c = cols[sel.c], row = view[sel.r];
    if (!S.data.editable || !c?.e || !row) { if (c && row && S.data.editable === false) flash('Lecture seule : modifiez depuis l\'écran dédié'); return; }
    if (c.e === 'bool') { commitEdit(row, c, !row[c.k]); return; }
    const td = host.querySelector(`tr[data-r="${sel.r}"] td[data-c="${sel.c}"]`);
    if (!td) return;
    editing = { row, c };
    const v = initial != null ? initial : fmt(c, row[c.k], true);
    td.classList.add('editing');
    td.innerHTML = c.e === 'select'
      ? `<select class="xl-in">${c.opts.map((o) => `<option ${o === row[c.k] ? 'selected' : ''}>${pro.esc(o)}</option>`).join('')}</select>`
      : `<input class="xl-in ${isNum(c) ? 'r' : ''}" value="${pro.esc(v)}" ${c.e === 'money' || c.e === 'num' ? 'inputmode="decimal"' : ''}>`;
    const inp = td.querySelector('.xl-in'); inp.focus();
    if (inp.setSelectionRange && initial == null) inp.select();
    const done = (commit, move) => {
      if (!editing) return; const val = inp.value; editing = null;
      if (commit) commitEdit(row, c, c.e === 'select' ? val : parseVal(c, val), move); else { drawRows(); host.querySelector('.xl-grid').focus(); }
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); done(true, 'down'); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } else if (e.key === 'Tab') { e.preventDefault(); done(true, e.shiftKey ? 'left' : 'right'); }
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => done(true));
    if (c.e === 'select') inp.addEventListener('change', () => done(true));
  }
  async function commitEdit(row, c, value, move) {
    host.querySelector('.xl-msg').textContent = 'Enregistrement…';
    await save(row, c, value);
    drawRows(); drawStatus(); drawRibbon();
    host.querySelector('.xl-grid').focus({ preventScroll: true });
    if (move === 'down') setSel(sel.r + 1, sel.c); else if (move === 'right') setSel(sel.r, sel.c + 1); else if (move === 'left') setSel(sel.r, sel.c - 1);
  }
  async function doUndo() {
    const u = undo.pop(); if (!u) return;
    const row = S.data.rows.find((r) => r.id === u.id), c = S.data.cols.find((x) => x.k === u.k);
    if (!row || !c) return;
    if (await save(row, c, u.old, { record: false, quiet: true })) flash(`Annulé : ${c.l} de ${row.id}`);
    drawRows(); drawStatus(); drawRibbon();
  }

  // Copier (vers Excel) et coller (depuis Excel) : texte séparé par des tabulations
  function copySel() {
    const r0 = Math.min(sel.r, sel.r2), r1 = Math.max(sel.r, sel.r2), c0 = Math.min(sel.c, sel.c2), c1 = Math.max(sel.c, sel.c2);
    const lines = [];
    if (r1 > r0 || c1 > c0) lines.push(cols.slice(c0, c1 + 1).map((c) => c.l).join('\t'));
    for (let r = r0; r <= r1; r++) lines.push(cols.slice(c0, c1 + 1).map((c) => fmt(c, view[r][c.k], true)).join('\t'));
    const txt = lines.join('\n');
    (navigator.clipboard?.writeText(txt) || Promise.reject()).then(() => flash(`${r1 - r0 + 1} ligne(s) copiée(s) : collez-les dans Excel`), () => pro.toast('❌ Copie impossible sur cet appareil'));
  }
  async function pasteText(txt) {
    if (!S.data.editable) return flash('Lecture seule : seule la feuille Produits se modifie');
    const grid = txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const jobs = [];
    grid.forEach((line, i) => line.forEach((val, j) => { const row = view[sel.r + i], c = cols[sel.c + j]; if (row && c?.e) jobs.push({ row, c, value: c.e === 'select' ? val.trim() : parseVal(c, val) }); }));
    const bad = jobs.filter((j) => Number.isNaN(j.value) || (j.c.e === 'select' && !j.c.opts.includes(j.value)));
    if (!jobs.length) return flash('Rien à coller ici (colonnes non modifiables)');
    if (bad.length) return pro.toast(`❌ ${bad.length} valeur(s) invalide(s) : rien n'a été modifié`);
    if (jobs.length > 1 && !confirm(`Modifier ${jobs.length} cellule(s) de la feuille Produits ?`)) return;
    busy = true; let ok = 0;
    for (const [i, j] of jobs.entries()) { host.querySelector('.xl-msg').textContent = `Enregistrement ${i + 1}/${jobs.length}…`; if (await save(j.row, j.c, j.value, { quiet: true })) ok++; }
    busy = false; flash(`${ok} cellule(s) modifiée(s)`); drawRows(); drawStatus(); drawRibbon();
  }

  // ---------- Menus : filtre d'une colonne, choix des colonnes ----------
  function closePop() { document.querySelectorAll('.xl-pop').forEach((x) => x.remove()); }
  // Menu flottant au-dessus de la page (jamais coupé par le cadre du tableur), tenu dans l'écran
  function placePop(pop, anchor, alignRight) {
    document.body.appendChild(pop); S.popAt = Date.now();
    const b = anchor.getBoundingClientRect(), w = pop.offsetWidth;
    const left = alignRight ? b.right - w : b.left;
    pop.style.left = Math.max(8, Math.min(left, innerWidth - w - 8)) + 'px';
    const below = innerHeight - b.bottom - 12, above = b.top - 12;
    if (below >= 260 || below >= above) { pop.style.top = (b.bottom + 4) + 'px'; pop.style.maxHeight = below + 'px'; }
    else { pop.style.maxHeight = above + 'px'; pop.style.top = Math.max(8, b.top - 4 - Math.min(pop.offsetHeight, above)) + 'px'; }
  }
  function openFilter(k, anchor) {
    closePop();
    const c = S.data.cols.find((x) => x.k === k), u = ui(), f = u.filters[k] || {};
    const pop = document.createElement('div'); pop.className = 'xl-pop';
    const vals = new Map();
    for (const r of S.data.rows) { const v = fmt(c, r[k]) || '(vide)'; vals.set(v, (vals.get(v) || 0) + 1); }
    const list = [...vals.entries()].sort((a, b) => (isNum(c) ? 0 : b[1] - a[1]) || String(a[0]).localeCompare(String(b[0]), 'fr', { numeric: true }));
    const checked = f.values ? new Set(f.values) : null;
    pop.innerHTML = `<div class="xp-h"><b>${pro.esc(c.l)}</b><button class="xp-x" aria-label="Fermer">${pro.icon('x-bold')}</button></div>
      <div class="xp-sort"><button data-dir="1">${isNum(c) ? 'Du plus petit au plus grand' : 'De A à Z'}</button><button data-dir="-1">${isNum(c) ? 'Du plus grand au plus petit' : 'De Z à A'}</button></div>
      ${isNum(c) ? `<div class="xp-range"><label>Min <input id="xpMin" inputmode="decimal" value="${f.min ?? ''}"></label><label>Max <input id="xpMax" inputmode="decimal" value="${f.max ?? ''}"></label></div>` : `<input class="xp-text" id="xpText" placeholder="Contient…" value="${pro.esc(f.text || '')}">`}
      ${list.length <= 300 && !(isNum(c) && list.length > 40) ? `<div class="xp-all"><label><input type="checkbox" id="xpAll" ${checked ? '' : 'checked'}> (Tout sélectionner)</label></div>
      <div class="xp-list">${list.map(([v, n]) => `<label><input type="checkbox" value="${pro.esc(v)}" ${!checked || checked.has(v) ? 'checked' : ''}> <span>${pro.esc(v)}</span><small>${n}</small></label>`).join('')}</div>` : ''}
      <div class="xp-f"><button class="btn sm" id="xpClear">Effacer</button><button class="btn sm primary" id="xpOk">Appliquer</button></div>`;
    placePop(pop, anchor, true);
    pop.querySelector('.xp-x').onclick = closePop;
    pop.querySelectorAll('.xp-sort button').forEach((bt) => bt.onclick = () => { u.sort = k; u.dir = Number(bt.dataset.dir); saveUi(); closePop(); drawAll(); });
    const all = pop.querySelector('#xpAll');
    all?.addEventListener('change', () => pop.querySelectorAll('.xp-list input').forEach((i) => { i.checked = all.checked; }));
    pop.querySelector('#xpClear').onclick = () => { delete u.filters[k]; saveUi(); closePop(); drawAll(); };
    pop.querySelector('#xpOk').onclick = () => {
      const nf2 = {};
      const boxes = [...pop.querySelectorAll('.xp-list input')];
      if (boxes.length && boxes.some((i) => !i.checked)) nf2.values = boxes.filter((i) => i.checked).map((i) => i.value);
      if (isNum(c)) { const mi = pop.querySelector('#xpMin').value.replace(',', '.').replace(/\s/g, ''), ma = pop.querySelector('#xpMax').value.replace(',', '.').replace(/\s/g, ''); if (mi) nf2.min = mi; if (ma) nf2.max = ma; }
      else { const t = pop.querySelector('#xpText').value.trim(); if (t) nf2.text = t; }
      if (Object.keys(nf2).length) u.filters[k] = nf2; else delete u.filters[k];
      saveUi(); closePop(); sel = { r: 0, c: 0, r2: 0, c2: 0 }; drawAll();
    };
  }
  function openCols(anchor) {
    closePop();
    const u = ui(), pop = document.createElement('div'); pop.className = 'xl-pop';
    pop.innerHTML = `<div class="xp-h"><b>Colonnes affichées</b><button class="xp-x" aria-label="Fermer">${pro.icon('x-bold')}</button></div>
      <div class="xp-list tall">${S.data.cols.map((c, i) => `<label><input type="checkbox" value="${c.k}" ${u.hidden.includes(c.k) ? '' : 'checked'} ${i === 0 ? 'disabled' : ''}> <span>${pro.esc(c.l)}</span>${S.data.editable && c.e ? '<small>modifiable</small>' : ''}</label>`).join('')}</div>
      <div class="xp-f"><button class="btn sm" id="xpShowAll">Tout afficher</button><button class="btn sm" id="xpWidths">Largeurs d'origine</button></div>`;
    placePop(pop, anchor, false);
    pop.querySelector('.xp-x').onclick = closePop;
    pop.querySelectorAll('.xp-list input').forEach((i) => i.onchange = () => { u.hidden = [...pop.querySelectorAll('.xp-list input:not(:checked)')].map((x) => x.value); saveUi(); drawAll(); });
    pop.querySelector('#xpShowAll').onclick = () => { u.hidden = []; saveUi(); closePop(); drawAll(); };
    pop.querySelector('#xpWidths').onclick = () => { u.widths = {}; saveUi(); closePop(); drawAll(); };
  }

  // ---------- Événements ----------
  function bind() {
    const grid = host.querySelector('.xl-grid'), fx = host.querySelector('.xl-fx');
    let raf = 0;
    grid.addEventListener('scroll', () => { if (ui().group) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (!editing) drawRows(); }); });
    let dragging = false;
    grid.addEventListener('mousedown', (e) => {
      const rz = e.target.closest('.rz');
      if (rz) { // redimensionner une colonne
        e.preventDefault(); const k = rz.dataset.rz, th = rz.closest('th'), x0 = e.clientX, w0 = th.offsetWidth;
        const mv = (ev) => { ui().widths[k] = Math.max(50, Math.min(700, w0 + ev.clientX - x0)); const ci = Number(th.dataset.ci); grid.querySelectorAll('col')[ci + 1].style.width = ui().widths[k] + 'px'; };
        const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); saveUi(); drawAll(); };
        addEventListener('mousemove', mv); addEventListener('mouseup', up); return;
      }
      const td = e.target.closest('td[data-c]'); if (!td || e.target.closest('a, .xl-in')) return;
      const r = Number(td.parentElement.dataset.r), c = Number(td.dataset.c);
      setSel(r, c, e.shiftKey); dragging = true; grid.focus({ preventScroll: true });
    });
    grid.addEventListener('mouseover', (e) => { if (!dragging) return; const td = e.target.closest('td[data-c]'); if (td) setSel(Number(td.parentElement.dataset.r), Number(td.dataset.c), true); });
    if (!bind.once) addEventListener('mouseup', () => { bind.dragging = false; });
    grid.addEventListener('mouseup', () => { dragging = false; });
    grid.addEventListener('dblclick', (e) => {
      const rn = e.target.closest('th.rn'); if (rn) { const row = view[Number(rn.parentElement.dataset.r)]; if (row?._href) location.hash = row._href; return; }
      if (e.target.closest('td[data-c]')) startEdit();
    });
    grid.addEventListener('click', (e) => {
      const hl = e.target.closest('[data-sort]'); const u = ui();
      if (hl) { if (u.sort === hl.dataset.sort) { if (u.dir === -1) { u.sort = null; u.dir = 1; } else u.dir = -1; } else { u.sort = hl.dataset.sort; u.dir = 1; } saveUi(); drawAll(); return; }
      const fb = e.target.closest('[data-filter]'); if (fb) { openFilter(fb.dataset.filter, fb); return; }
      const letter = e.target.closest('.xl-letters th[data-ci]'); if (letter && view.length) { const c = Number(letter.dataset.ci); sel = { r: 0, c, r2: view.length - 1, c2: c }; paintSel(); drawStatus(); return; }
      if (e.target.closest('.xl-corner') && view.length) { sel = { r: 0, c: 0, r2: view.length - 1, c2: cols.length - 1 }; paintSel(); drawStatus(); return; }
      const rn = e.target.closest('th.rn'); if (rn) { const r = Number(rn.parentElement.dataset.r); sel = { r, c: 0, r2: r, c2: cols.length - 1 }; paintSel(); drawStatus(); return; }
      const gv = e.target.closest('[data-gv]'); if (gv) { const c = S.data.cols.find((x) => x.k === u.group); if (!/^date/.test(c.t)) u.filters[u.group] = { values: [gv.dataset.gv] }; else u.filters[u.group] = { text: gv.dataset.gv }; u.group = ''; saveUi(); drawAll(); }
    });
    grid.addEventListener('keydown', (e) => {
      if (editing || ui().group) return;
      const mod = e.metaKey || e.ctrlKey;
      const page = Math.max(1, Math.floor(grid.clientHeight / ROW_H) - 3);
      const k = e.key, ext = e.shiftKey;
      const cur = ext ? { r: sel.r2, c: sel.c2 } : { r: sel.r, c: sel.c };
      const mv = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1], PageDown: [page, 0], PageUp: [-page, 0] }[k];
      if (mv) { e.preventDefault(); const jump = mod ? { ArrowDown: [view.length, 0], ArrowUp: [-view.length, 0], ArrowRight: [0, cols.length], ArrowLeft: [0, -cols.length] }[k] || mv : mv; setSel(cur.r + jump[0], cur.c + jump[1], ext); return; }
      if (k === 'Home') { e.preventDefault(); setSel(mod ? 0 : cur.r, 0, ext); return; }
      if (k === 'End') { e.preventDefault(); setSel(mod ? view.length - 1 : cur.r, cols.length - 1, ext); return; }
      if (k === 'Tab') { e.preventDefault(); setSel(sel.r, sel.c + (ext ? -1 : 1)); return; }
      if (mod && k.toLowerCase() === 'c') { e.preventDefault(); copySel(); return; }
      if (mod && k.toLowerCase() === 'a') { e.preventDefault(); sel = { r: 0, c: 0, r2: view.length - 1, c2: cols.length - 1 }; paintSel(); drawStatus(); return; }
      if (mod && k.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
      if (mod && k.toLowerCase() === 'f') { e.preventDefault(); host.querySelector('#xlQ')?.focus(); return; }
      if (k === 'Enter' || k === 'F2') { e.preventDefault(); if (k === 'Enter' && !(S.data.editable && cols[sel.c]?.e)) { const row = view[sel.r]; if (row?._href && mod) location.hash = row._href; else setSel(sel.r + 1, sel.c); return; } startEdit(); return; }
      if (k === ' ' && cols[sel.c]?.e === 'bool') { e.preventDefault(); startEdit(); return; }
      if ((k === 'Delete' || k === 'Backspace') && S.data.editable && cols[sel.c]?.e && cols[sel.c].e !== 'bool' && cols[sel.c].e !== 'select') { e.preventDefault(); const c = cols[sel.c]; if (c.k === 'name') return; commitEdit(view[sel.r], c, c.e === 'text' ? '' : null); return; }
      if (k.length === 1 && !mod && S.data.editable && cols[sel.c]?.e && !['bool', 'select'].includes(cols[sel.c].e)) { e.preventDefault(); startEdit(k); }
    });
    grid.addEventListener('paste', (e) => { if (editing) return; e.preventDefault(); pasteText(e.clipboardData.getData('text/plain')); });
    // barre de formule
    fx.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const c = cols[sel.c], row = view[sel.r]; if (!fx.readOnly && c && row) commitEdit(row, c, c.e === 'select' ? fx.value : parseVal(c, fx.value), 'down'); }
      if (e.key === 'Escape') { fx.value = fmt(cols[sel.c], view[sel.r]?.[cols[sel.c]?.k], true); grid.focus(); }
    });
    // ruban
    host.querySelector('.xl-ribbon').addEventListener('input', (e) => { if (e.target.id === 'xlQ') { clearTimeout(bind.t); bind.t = setTimeout(() => { ui().q = e.target.value; saveUi(); sel = { r: 0, c: 0, r2: 0, c2: 0 }; host.querySelector('.xl-grid').scrollTop = 0; drawAll(); }, 220); } });
    host.querySelector('.xl-ribbon').addEventListener('change', (e) => { if (e.target.id === 'xlGroup') { ui().group = e.target.value; saveUi(); drawAll(); } });
    host.querySelector('.xl-ribbon').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'xlCols') openCols(b);
      if (b.id === 'xlBars') { ui().bars = !ui().bars; saveUi(); drawAll(); }
      if (b.id === 'xlReset') { const u = ui(); u.filters = {}; u.q = ''; u.sort = null; saveUi(); drawAll(); }
      if (b.id === 'xlUndo') doUndo();
    });
    host.querySelector('.xl-tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-sheet]'); if (t && t.dataset.sheet !== S.sheet) { closePop(); loadSheet(t.dataset.sheet); } });
    if (!bind.once) document.addEventListener('mousedown', (e) => { if (!e.target.closest('.xl-pop, [data-filter], #xlCols')) closePop(); });
    bind.once = true;
  }

  // ---------- Entrée ----------
  window.kamwaTableur = async function (app, helpers) {
    pro = helpers;
    const saved = loadUi(); S.ui = saved.ui || {};
    app.innerHTML = pro.pageHead({ crumb: 'Gestion', title: 'Base de données', desc: 'Toutes les données de Zado, comme dans Excel : une feuille par sujet (onglets en bas). Cliquez sur une cellule, glissez pour sélectionner (somme et moyenne en bas à droite), triez et filtrez avec les en-têtes. <b>Feuille Produits</b> : double-clic ou tapez pour modifier, collez une colonne depuis Excel, Ctrl+Z pour annuler.' }) + `
      <div class="xl">
        <div class="xl-ribbon"><label class="xl-search">${pro.icon('magnifying-glass-bold')}<input type="search" id="xlQ" autocomplete="off"></label><div class="xl-rib"></div></div>
        <div class="xl-fbar"><span class="xl-ref"></span><span class="xl-fxlbl">ƒx</span><input class="xl-fx" readonly aria-label="Contenu de la cellule"></div>
        <div class="xl-grid" tabindex="0"><p class="xl-loading">Chargement…</p></div>
        <div class="xl-foot"><div class="xl-tabs"></div><div class="xl-bar"><span class="xl-msg">Prêt</span><span class="xl-stat"></span></div></div>
      </div>
      <p class="muted xl-help">${pro.icon('info')} Raccourcis : flèches pour se déplacer (Maj pour sélectionner), Ctrl/Cmd+C copier, Ctrl/Cmd+V coller (Produits), Ctrl/Cmd+Z annuler, Ctrl/Cmd+F rechercher, double-clic sur un numéro de ligne pour ouvrir la fiche. Codes clients, mots de passe et pièces d'identité ne sont jamais dans le tableur.</p>`;
    host = app;
    try {
      const [list, cfg] = await Promise.all([pro.api('/tableur'), fetch('/api/config').then((r) => r.json()).catch(() => ({}))]);
      S.sheets = list.sheets; S.freight = cfg.freight || null;
    } catch (e) { return; }
    bind();
    const start = S.sheets.some((s) => s.key === saved.sheet) ? saved.sheet : 'produits';
    await loadSheet(start);
    host.querySelector('.xl-grid').focus({ preventScroll: true });
  };
  window.kamwaTableurBusy = () => Boolean(editing || busy || document.querySelector('.xl-pop'));
  addEventListener('hashchange', closePop);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.xl-pop')) { closePop(); host?.querySelector('.xl-grid')?.focus({ preventScroll: true }); } });
  addEventListener('scroll', (e) => { if (Date.now() - (S.popAt || 0) < 400) return; if (!(e.target.nodeType === 1 && e.target.closest('.xl-pop'))) closePop(); }, true);
})();
