// Anciennes alertes e-mail (commande payée, réservation, pièce d'identité, conseiller demandé, point relais changé).
// Depuis le 12/11/2026, TOUTES les alertes de l'équipe passent par src/alerts.js, qui les reconnaît directement dans les
// changements de la base (src/events.js) : historique dans Zado Pro → Notifications, e-mails regroupés, résumé du matin.
// Ces fonctions restent pour ne rien casser chez leurs appelants, mais n'envoient plus rien (sinon : e-mails en double).
const noop = async () => {};
module.exports = { notifyPaidOrder: noop, notifyReservation: noop, notifyIdentity: noop, notifyChat: noop, notifyRelayChange: noop };
