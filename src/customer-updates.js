// E-mails de SUIVI envoyés au client à chaque étape de sa commande, avec la prochaine étape et sa date prévue
// (demande Joseph 14/11/2026 : « des mails d'update doivent être envoyés à chaque étape avec des prévisions vers la prochaine »).
// Écoute les changements de la base (events.bus, comme src/alerts.js) et reconnaît :
//   confirmée / payée → achat en France → dans l'avion → arrivée à Pointe-Noire (ou déjà sur place)
//   → livraison planifiée (ou déplacée) → en route → livrée ; colis au point relais ; annulée.
// Dates prévues : logistics.etaOf (arrivée entre paiement + min et + max jours, livraison sous X h après l'arrivée).
// Seulement si le client a un e-mail et si l'envoi est réglé (src/mailer.js). JAMAIS de code de livraison / de retrait.
// Le site (« Aide ») et les notifications du téléphone continuent de prévenir le client en parallèle.
const fm = (n) => `${Math.round(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const day = (iso) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Brazzaville' });
const ymd = (s) => day(`${s}T12:00:00Z`); // date « AAAA-MM-JJ » de la planification
const first = (o) => String(o.customer?.name || '').split(' ')[0] || 'cher client';
const track = (o) => `/#/suivi/${o.id}`;
const isPickup = (o) => o.fulfillment === 'pickup';

/** Frise du parcours (étapes faites / en cours / à venir) pour l'e-mail. */
function stepsOf(o) {
  const L = o.logistics || {};
  const paid = ['paid', 'shipped', 'delivered'].includes(o.status) || Boolean(o.paidAt);
  const local = Boolean(L.localAt);
  const list = [
    ['Paiement reçu, commande confirmée', paid || o.status === 'confirmed'],
    ...(local ? [] : [['Achetée en France', Boolean(L.boughtAt)], ["Dans l'avion vers Pointe-Noire", Boolean(L.flyingAt)]]),
    ['Arrivée à Pointe-Noire', Boolean(L.arrivedAt || L.localAt)],
    [isPickup(o) ? 'Prête au point relais' : 'En livraison', o.status === 'shipped' || o.status === 'delivered' || Boolean(o.readyAtRelayAt)],
    [isPickup(o) ? 'Retirée' : 'Livrée', o.status === 'delivered'],
  ];
  const nowIdx = list.findIndex(([, done]) => !done);
  return list.map(([label, done], i) => ({ label, done, now: i === nowIdx }));
}

/** Contenu de l'e-mail pour un évènement (null = rien à envoyer). */
function content(kind, o) {
  const eta = require('./logistics').etaOf(o);
  const delivery = require('./delivery');
  const slot = o.planned ? `${ymd(o.planned.date)}, ${String(delivery.SLOTS[o.planned.slot] || '').toLowerCase()}` : null;
  const arrival = eta.from && eta.to ? `entre le ${day(eta.from)} et le ${day(eta.to)}` : null;
  const items = o.lines.map((l) => `• ${l.qty} × ${l.name}`);
  switch (kind) {
    case 'confirmed': // paiement reçu (en une fois), ou acompte reçu (paiement en deux temps)
      if (o.paymentPlan === 'mobile' && o.status === 'confirmed' && o.balance > 0) return {
        subject: `Commande ${o.id} confirmée : acompte reçu`, title: `Merci ${first(o)}, votre acompte est bien reçu`,
        lines: [`Votre commande ${o.id} est confirmée : acompte de ${fm(o.deposit)} reçu.`, ...items],
        next: { title: `Régler le reste : ${fm(o.balance)}`, text: 'Dès réception, nous achetons votre article en France.' } };
      if (o.paymentPlan === 'cod') return {
        subject: `Commande ${o.id} confirmée`, title: `Merci ${first(o)}, votre commande est confirmée`, lines: [...items, `Total : ${fm(o.total)}, à payer à la livraison.`],
        next: { title: 'Préparation et livraison', text: 'Nous vous appelons pour convenir du jour de livraison.' } };
      return {
        subject: `Commande ${o.id} confirmée`, title: `Merci ${first(o)}, votre paiement est bien reçu`,
        lines: [`Votre commande ${o.id} est confirmée.`, ...items, `Total payé : ${fm(o.total)}`],
        next: { title: 'Achat de votre article en France', text: `Nous achetons votre article chez notre fournisseur en France${arrival ? `, pour une arrivée à Pointe-Noire prévue ${arrival}` : ''}. Vous recevez un e-mail à chaque étape.` } };
    case 'paid-rest': return {
      subject: `Commande ${o.id} : paiement complet reçu`, title: `Paiement complet reçu, merci ${first(o)} !`,
      lines: [`Le reste de votre commande ${o.id} est bien reçu : ${fm(o.total)} au total.`],
      next: { title: 'Achat de votre article en France', text: arrival ? `Arrivée à Pointe-Noire prévue ${arrival}.` : 'Vous recevez un e-mail à chaque étape.' } };
    case 'bought': return {
      subject: `Commande ${o.id} : article acheté en France`, title: 'Votre article est acheté !',
      lines: [`Bonne nouvelle ${first(o)} : votre commande ${o.id} a été achetée chez notre fournisseur en France.`],
      next: { title: "Départ en avion vers Pointe-Noire", text: eta.to ? `Arrivée à Pointe-Noire prévue au plus tard le ${day(eta.to)}.` : 'Prochain vol vers Pointe-Noire.' } };
    case 'flying': return {
      subject: `Commande ${o.id} : dans l'avion vers Pointe-Noire`, title: "Votre colis est dans l'avion",
      lines: [`Votre commande ${o.id} a quitté la France et vole vers Pointe-Noire.`],
      next: { title: 'Arrivée à Pointe-Noire', text: eta.to ? `Prévue au plus tard le ${day(eta.to)}, puis ${isPickup(o) ? 'retrait au point relais' : `livraison sous ${eta.deliveryHours} h`}.` : `Puis ${isPickup(o) ? 'retrait au point relais' : `livraison sous ${eta.deliveryHours} h`}.` } };
    case 'arrived': return {
      subject: `Commande ${o.id} : arrivée à Pointe-Noire`, title: o.logistics?.localAt ? 'Votre commande est prête à Pointe-Noire' : 'Votre colis est arrivé à Pointe-Noire !',
      lines: [`Votre commande ${o.id} est à Pointe-Noire.`],
      next: isPickup(o) ? { title: 'Retrait au point relais', text: 'Nous vous prévenons dès que votre colis vous attend.' }
        : { title: 'Livraison à domicile', text: `${eta.deliverBy ? `Avant le ${day(eta.deliverBy)} (sous ${eta.deliveryHours} h). ` : ''}Nous vous appelons pour convenir du créneau.` } };
    case 'planned': case 'moved': return {
      subject: `Commande ${o.id} : livraison ${kind === 'moved' ? 'déplacée' : 'planifiée'} le ${ymd(o.planned.date)}`, title: kind === 'moved' ? 'Votre livraison est déplacée' : 'Votre livraison est planifiée',
      lines: [`Votre commande ${o.id} sera livrée le ${slot}.`, `Adresse : ${[o.customer?.address, o.customer?.city].filter(Boolean).join(', ') || 'celle de votre commande'}.`],
      next: { title: `Livraison le ${slot}`, text: 'Le livreur vous appelle avant de passer. Gardez votre code de livraison (sur la page de suivi) : donnez-le seulement quand vous avez le colis en main.' } };
    case 'shipped': return {
      subject: `Commande ${o.id} : en route vers chez vous`, title: 'Votre commande est en route !',
      lines: [`Le livreur Zado a pris en charge votre commande ${o.id}.`],
      next: { title: slot ? `Livraison le ${slot}` : "Livraison aujourd'hui", text: 'Suivez le livreur en direct sur la page de suivi. Donnez votre code de livraison seulement quand vous avez le colis en main.' } };
    case 'relay': return {
      subject: `Commande ${o.id} : votre colis vous attend`, title: 'Votre colis vous attend au point relais',
      lines: [`Votre commande ${o.id} est au point relais ${o.agency?.name || ''}.`.replace(' .', '.')],
      next: { title: 'Retrait', text: 'Venez avec votre code de retrait (sur la page de suivi).' } };
    case 'delivered': return {
      subject: `Commande ${o.id} ${isPickup(o) ? 'retirée' : 'livrée'}`, title: `Merci ${first(o)} !`,
      lines: [`Votre commande ${o.id} est ${isPickup(o) ? 'retirée' : 'livrée'}. Merci pour votre confiance !`, 'Votre facture est disponible sur la page de suivi de la commande.'],
      next: { title: 'Votre avis compte', text: 'Notez votre article sur Zado : cela aide les autres clients.' } };
    case 'cancelled': return {
      subject: `Commande ${o.id} annulée`, title: 'Votre commande est annulée',
      lines: [`Votre commande ${o.id} a été annulée${o.cancelReason ? ` : ${o.cancelReason}` : '.'}`,
        ...(o.paidAt && !o.depositRetained ? ['Si vous avez déjà payé, Zado vous rembourse : un conseiller vous contacte.'] : [])],
      next: null, noSteps: true };
    default: return null;
  }
}

/** Évènement reconnu entre l'état avant et après une modification de commande (le plus avancé seulement). */
function detect(before, o) {
  if (!before) return null; // commande créée : le bon de commande part avec le choix du paiement (routes/payments.js)
  const b = before;
  if (o.status !== b.status) {
    if (o.status === 'cancelled') return 'cancelled';
    if (o.status === 'delivered') return 'delivered';
    if (o.status === 'shipped' && !isPickup(o)) return 'shipped';
    if (b.status === 'pending_payment' && (o.status === 'confirmed' || o.status === 'paid')) return 'confirmed';
    if (b.status === 'confirmed' && o.status === 'paid') return o.paymentPlan === 'mobile' && !(o.deposit >= o.total) ? 'paid-rest' : null;
  }
  const LB = b.logistics || {}, LA = o.logistics || {};
  if ((LA.arrivedAt && !LB.arrivedAt) || (LA.localAt && !LB.localAt)) return 'arrived';
  if (LA.flyingAt && !LB.flyingAt) return 'flying';
  if (LA.boughtAt && !LB.boughtAt) return 'bought';
  if (o.planned && (!b.planned || b.planned.date !== o.planned.date || b.planned.slot !== o.planned.slot)) return b.planned ? 'moved' : 'planned';
  if (o.readyAtRelayAt && !b.readyAtRelayAt) return 'relay';
  return null;
}

let sentLog = []; // diagnostic et tests
async function onChange({ col, doc, before }) {
  if (col !== 'orders' || !doc?.lines) return;
  const kind = detect(before, doc);
  if (!kind) return;
  const c = content(kind, doc);
  if (!c) return;
  const r = await require('./customer-mail').toCustomer(doc, {
    subject: c.subject, title: c.title, lines: c.lines, next: c.next, steps: c.noSteps ? null : stepsOf(doc),
    button: { label: 'Suivre ma commande', url: track(doc) },
  });
  sentLog = [{ at: new Date().toISOString(), order: doc.id, kind, ...r }, ...sentLog].slice(0, 50);
}

let started = false;
function start() {
  if (started) return; started = true;
  require('./events').bus.on('change', (e) => { onChange(e).catch((err) => console.error('[e-mails de suivi]', err.message)); });
}

module.exports = { start, detect, content, stepsOf, sentLog: () => sentLog };
