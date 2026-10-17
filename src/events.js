// Rafraîchissement instantané (décision Joseph 16/10/2026 : « pas de latence dans les retours ») :
// chaque modification dans la base (commande, produit, client, message…) est signalée tout de suite aux écrans
// ouverts (boutique et Kamwa Pro) par un flux « Server-Sent Events » (/api/events et /api/admin/events).
// Le signal ne contient AUCUNE donnée : seulement « tel sujet a changé » ; l'écran recharge lui-même ce qu'il a le
// droit de voir. Chaque écran ne reçoit que les signaux qui le concernent (son compte, ses commandes, son rôle).
// Sans connexion au flux (réseau, démo Vercel), les vérifications régulières continuent de fonctionner.
const { EventEmitter } = require('events');
const store = require('./store');

const bus = new EventEmitter();
bus.setMaxListeners(1000);

const WATCHED = ['orders', 'products', 'customers', 'conversations', 'agencies', 'imports', 'shipments', 'ledger', 'staff', 'payments', 'trends', 'documents', 'parcels'];
function watchStore() {
  for (const name of WATCHED) {
    const col = store[name];
    if (!col || col._eventsWatched) continue;
    for (const fn of ['insert', 'update', 'remove']) {
      const orig = col[fn].bind(col);
      col[fn] = (...args) => {
        const before = fn === 'insert' ? null : col.get(args[0]);
        const out = orig(...args);
        const doc = fn === 'insert' ? args[0] : fn === 'update' ? out : before;
        if (doc) setImmediate(() => bus.emit('change', { col: name, doc, before }));
        return out;
      };
    }
    col._eventsWatched = true;
  }
}

/** Ouvre un flux d'événements. filter(change) renvoie le sujet à envoyer (ou null). */
function stream(req, res, filter) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  res.flushHeaders?.();
  const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
  send('hello', { at: Date.now() });
  const pending = new Map(); let timer = null;
  const onChange = (c) => {
    let topic = null;
    try { topic = filter(c); } catch {}
    if (!topic) return;
    pending.set(JSON.stringify(topic), topic);
    // regroupe les rafales (plusieurs modifications en même temps) en un seul signal
    if (!timer) timer = setTimeout(() => { timer = null; for (const t of pending.values()) send('change', t); pending.clear(); }, 120);
  };
  bus.on('change', onChange);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  // Vercel (démo) : une fonction ne peut pas rester ouverte indéfiniment → le navigateur se reconnecte tout seul
  const life = process.env.VERCEL ? setTimeout(() => res.end(), 50000) : null;
  req.on('close', () => { bus.off('change', onChange); clearInterval(ping); clearTimeout(timer); clearTimeout(life); });
}

module.exports = { bus, watchStore, stream };
