// Carte bancaire RÉELLE : à brancher sur le prestataire choisi (CinetPay, Moneroo…), sur le modèle de mtn-momo.js :
//   requestPayment() -> crée la transaction chez le prestataire et renvoie { providerRef, redirectUrl } (sa page sécurisée)
//   getStatus()      -> interroge le prestataire (ne jamais se fier au retour du navigateur ni au callback seul)
// Les numéros de carte ne passent JAMAIS par le serveur Zado.
module.exports = {
  name: 'card',
  label: 'Carte bancaire',
  async requestPayment() {
    throw new Error('Paiement par carte non configuré : aucun prestataire branché (CARD_PROVIDER)');
  },
  async getStatus() {
    throw new Error('Paiement par carte non configuré');
  },
};
