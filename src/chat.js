// Messagerie Kamwa (décision Joseph 16/10/2026 : « pas besoin d'outils externes ») :
//  - côté boutique, une bulle « Aide » : un ASSISTANT AUTOMATIQUE répond tout de suite aux questions courantes
//    (mots-clés, aucune IA payante, aucune donnée envoyée ailleurs) ; le client peut demander un CONSEILLER ;
//  - côté Kamwa Pro, une « Messagerie » : les conversations des clients (admin + employés Commandes) et un salon
//    interne « Équipe Kamwa » (toute l'équipe, sauf les fournisseurs, qui sont externes).
// Les messages sont rangés dans la conversation (collection `conversations`, 500 derniers messages gardés).
const crypto = require('crypto');
const { conversations, agencies, orders, settings } = require('./store');
const { salesSettings } = require('./sales');
const { importSettings } = require('./imports');

const MAX_MESSAGES = 500;
const TEAM_ID = 'TEAM';
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newId = (p) => `${p}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function addMessage(conv, msg) {
  const m = { id: newId('M'), at: new Date().toISOString(), ...msg, text: String(msg.text || '').slice(0, 2000) };
  const messages = [...(conv.messages || []), m].slice(-MAX_MESSAGES);
  const patch = { messages, lastAt: m.at, lastText: m.text.slice(0, 140), lastFrom: m.from };
  if (m.from === 'customer') patch.unreadStaff = (conv.unreadStaff || 0) + 1;
  if (m.from === 'staff' || m.from === 'bot') patch.unreadCustomer = (conv.unreadCustomer || 0) + (m.from === 'staff' ? 1 : 0);
  return { conv: conversations.update(conv.id, patch), message: m };
}

// ---------- Assistant automatique ----------
const MENU = ['Livraison', 'Paiement', 'Points relais', 'Ma commande', 'Mon compte', 'Retours', 'Parler à un conseiller'];
const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR').replace(/ /g, ' ')} FCFA`;
const STATUS = { pending_payment: 'en attente de paiement', paid: 'payée, en préparation', confirmed: 'confirmée', shipped: 'en cours de livraison', delivered: 'livrée', cancelled: 'annulée' };

function agencyList() {
  const list = agencies.all().filter((a) => a.active !== false);
  return list.length ? list.map((a) => `• ${a.name} (${a.city})${a.address ? ' — ' + a.address : ''}${a.hours ? ' — ' + a.hours : ''}${a.phone ? ' — ' + a.phone : ''}`).join('\n') : 'Nos points relais ouvrent bientôt.';
}
const INTENTS = [
  { key: 'human', words: ['conseiller', 'humain', 'parler a', 'quelqu un', 'agent', 'personne', 'appeler', 'service client', 'reclamation', 'plainte'] },
  { key: 'hello', words: ['bonjour', 'bonsoir', 'salut', 'mbote', 'hello', 'coucou', 'bjr'] },
  { key: 'thanks', words: ['merci', 'super', 'parfait', 'ok merci', 'top'] },
  { key: 'order', words: ['ma commande', 'suivi', 'suivre', 'colis', 'ou est ma', 'ou en est', 'statut', 'pas recu', 'pas encore recu', 'numero de commande', 'cmd-'] },
  { key: 'identity', words: ['piece', 'identite', 'passeport', 'cni', 'niu', 'verification', 'verifie', 'valide', 'refuse'] },
  { key: 'account', words: ['compte', 'inscri', 'creer', 'code', 'oublie', 'connexion', 'connecter', 'mot de passe'] },
  { key: 'payment', words: ['paiement', 'payer', 'paye', 'momo', 'mobile money', 'airtel', 'mtn', 'carte', 'especes', 'cash', 'argent', 'acompte'] },
  { key: 'agency', words: ['agence', 'relais', 'point relais', 'adresse', 'horaire', 'ouvert', 'ou etes', 'magasin', 'boutique physique', 'retrait'] },
  { key: 'delivery', words: ['livraison', 'livrer', 'delai', 'quand', 'combien de temps', 'expedi', 'domicile', 'livreur', 'brazzaville', 'pointe-noire', 'pointe noire', 'dolisie'] },
  { key: 'europe', words: ['europe', 'france', 'importer', 'commander de', 'venu d', 'avion', 'douane'] },
  { key: 'returns', words: ['retour', 'rembours', 'echange', 'garantie', 'defectueux', 'casse', 'abime', 'annuler'] },
  { key: 'price', words: ['prix', 'promo', 'reduction', 'remise', 'moins cher', 'solde', 'tarif', 'frais'] },
];
const QUICK = { 'livraison': 'delivery', 'paiement': 'payment', 'nos agences': 'agency', 'points relais': 'agency', 'ma commande': 'order', 'mon compte': 'account', 'retours': 'returns', 'parler a un conseiller': 'human' };

function detect(text) {
  const t = ` ${norm(text).replace(/[^a-z0-9- ]/g, ' ')} `;
  if (QUICK[t.trim()]) return QUICK[t.trim()];
  let best = null; let score = 0;
  for (const it of INTENTS) {
    const n = it.words.filter((w) => t.includes(w)).length;
    if (n > score) { best = it.key; score = n; }
  }
  return best;
}

/** Réponse de l'assistant. customer = compte connecté (ou null). Renvoie { text, quick?, links?, handoff? }. */
function botAnswer(text, { customer, conv }) {
  const intent = detect(text);
  const sales = salesSettings();
  const cashOnly = sales.methods.cash && !sales.methods.momo && !sales.methods.card && !sales.methods.cod;
  switch (intent) {
    case 'hello': return { text: `Mbote${customer ? ' ' + customer.name.split(' ')[0] : ''} ! Je suis l'assistant Kamwa. Que puis-je faire pour vous ?`, quick: MENU };
    case 'thanks': return { text: 'Avec plaisir ! Autre chose ?', quick: MENU };
    case 'human': return { handoff: true, text: '' };
    case 'delivery': return { text: `Livraison en 24 à 48 h à Pointe-Noire et Brazzaville (autres villes : sur demande).\nVous pouvez aussi retirer votre commande dans une de nos agences.\nArticles venus d'Europe : ${importSettings().delay || '10 jours maximum'}.\nÀ la livraison, donnez votre code de livraison au livreur seulement quand vous avez le colis en main.`, quick: ['Paiement', 'Points relais', 'Ma commande', 'Parler à un conseiller'] };
    case 'payment': return { text: cashOnly
      ? `Le paiement se fait en espèces dans nos points relais (à choisir sur la carte au moment de commander). Vous réservez en ligne (articles gardés ${Number(process.env.PICKUP_HOLD_HOURS || 48)} h), vous payez au point relais, puis vous repartez avec votre commande ou nous vous la livrons.\n\nNos points relais :\n${agencyList()}`
      : `Moyens de paiement proposés : ${Object.entries(sales.methods).filter(([, v]) => v).map(([k]) => ({ cash: 'espèces en agence', momo: 'Mobile Money (MTN, Airtel)', card: 'carte bancaire', cod: 'paiement à la réception' })[k]).join(', ')}.`,
      quick: ['Points relais', 'Livraison', 'Parler à un conseiller'] };
    case 'agency': return { text: `Nos points relais :\n${agencyList()}`, quick: ['Paiement', 'Livraison', 'Parler à un conseiller'] };
    case 'account': return { text: `Pour commander, il faut un compte Kamwa vérifié : créez-le avec votre numéro (ou e-mail) et la photo de votre pièce d'identité (passeport, CNI ou NIU). Kamwa la vérifie, en général sous 24 h.\nVous vous connectez ensuite avec votre numéro + votre code Kamwa à 6 chiffres.\nCode oublié ? Demandez un conseiller : il vous en donnera un nouveau.`,
      links: customer ? [{ label: 'Mon compte', href: '#/compte' }] : [{ label: 'Créer mon compte', href: '#/compte/creer' }, { label: 'Me connecter', href: '#/compte' }], quick: ['Parler à un conseiller', 'Paiement'] };
    case 'identity': {
      if (!customer) return { text: "Kamwa vérifie la pièce d'identité de chaque client (passeport, CNI ou NIU) avant sa première commande, pour lutter contre les fausses commandes. Connectez-vous pour voir où en est la vôtre.", links: [{ label: 'Me connecter', href: '#/compte' }], quick: ['Mon compte', 'Parler à un conseiller'] };
      const st = customer.idStatus || 'missing';
      const msg = { verified: 'Votre pièce est vérifiée : vous pouvez commander.', pending: "Votre pièce est en cours de vérification (en général sous 24 h). Vous serez prévenu sur votre compte dès qu'elle sera validée.",
        rejected: `Votre pièce a été refusée${customer.idRejectReason ? ' : ' + customer.idRejectReason : ''}. Envoyez une nouvelle photo depuis votre compte.`, missing: "Vous n'avez pas encore envoyé votre pièce d'identité : ajoutez-la depuis votre compte." }[st];
      return { text: msg, links: [{ label: 'Mon compte', href: '#/compte' }], quick: ['Parler à un conseiller'] };
    }
    case 'order': {
      if (!customer) return { text: 'Connectez-vous pour que je retrouve vos commandes, ou ouvrez « Mon compte » sur le téléphone qui a passé la commande.', links: [{ label: 'Mon compte', href: '#/compte' }], quick: ['Parler à un conseiller'] };
      const mine = orders.all().filter((o) => o.customerId === customer.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 3);
      if (!mine.length) return { text: "Vous n'avez pas encore de commande. Je peux vous aider à choisir ?", quick: ['Livraison', 'Paiement'] };
      return { text: `Vos dernières commandes :\n${mine.map((o) => `• ${o.id} — ${fcfa(o.total)} — ${o.agency && o.status === 'pending_payment' ? 'réservée, à payer en agence' : STATUS[o.status] || o.status}`).join('\n')}`,
        links: mine.map((o) => ({ label: `Suivre ${o.id}`, href: `#/suivi/${o.id}` })), quick: ['Parler à un conseiller', 'Livraison'] };
    }
    case 'europe': return { text: `Nous achetons pour vous des produits en Europe : prix tout compris en FCFA (article, avion, douane), payé au point relais avant l'achat, disponible en ${importSettings().delay || '10 jours maximum'}. Vous suivez chaque étape dans votre compte.`, links: [{ label: 'Achat en Europe', href: '#/europe' }], quick: ['Paiement', 'Parler à un conseiller'] };
    case 'returns': return { text: "Un article abîmé ou non conforme ? Signalez-le au livreur ou à l'agence à la remise, puis contactez-nous : il est échangé ou remboursé. Les conditions complètes sont dans « Ventes et remboursements ».", links: [{ label: 'Ventes et remboursements', href: '#/legal/vente' }], quick: ['Parler à un conseiller'] };
    case 'price': return { text: 'Nos meilleures offres du moment sont dans « Bonnes affaires » et les ventes flash de la page d\'accueil. Les prix sont en FCFA, sans frais cachés.', links: [{ label: 'Bonnes affaires', href: '#/promos' }], quick: MENU.slice(0, 4) };
    default: {
      const misses = (conv?.botMisses || 0) + 1;
      conversations.update(conv.id, { botMisses: misses });
      return misses >= 2
        ? { text: "Je ne suis qu'un assistant et je n'ai pas compris. Voulez-vous parler à un conseiller Kamwa ?", quick: ['Parler à un conseiller', ...MENU.slice(0, 3)] }
        : { text: "Je n'ai pas bien compris. Choisissez un sujet ou reformulez votre question :", quick: MENU };
    }
  }
}

const WELCOME = { from: 'bot', text: "Mbote ! Je suis l'assistant Kamwa. Posez votre question ou choisissez un sujet. Un conseiller peut aussi prendre le relais.", quick: MENU };

// ---------- Salon de l'équipe ----------
function teamConversation() {
  return conversations.get(TEAM_ID) || conversations.insert({ id: TEAM_ID, kind: 'team', title: 'Équipe Kamwa', messages: [], reads: {}, createdAt: new Date().toISOString() });
}

module.exports = { addMessage, botAnswer, WELCOME, MENU, TEAM_ID, teamConversation, sha256, newId };
