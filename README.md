# Baydel — Boutique en ligne

Site e-commerce (électronique et mode) pensé pour l'Afrique centrale (Congo-Brazzaville en premier) :
prix en **FCFA**, paiement **Mobile Money** (MTN MoMo et Airtel Money), pages légères pour les réseaux mobiles.

## Démarrer

Il faut [Node.js](https://nodejs.org) version 18 ou plus récente.

```bash
cd ~/Desktop/BYDL
npm install
cp .env.example .env
npm start
```

Ouvrez ensuite http://localhost:3000 dans votre navigateur.

Par défaut, le site tourne en **mode simulation** : aucun argent n'est débité, et le paiement
est validé automatiquement après environ 8 secondes. Un numéro qui se termine par `000` simule un refus.

## Comment se passe un paiement

1. Le client remplit son panier, puis indique son nom, sa ville et son numéro Mobile Money.
2. Le serveur crée la commande et **recalcule le total à partir du catalogue** (le prix envoyé par le navigateur n'est jamais pris en compte).
3. Le serveur envoie une demande de paiement à l'opérateur (MTN ou Airtel).
4. Le client reçoit une demande sur son téléphone et la valide avec son code secret.
5. La page vérifie le statut toutes les 4 secondes. L'opérateur peut aussi prévenir le serveur via un callback. Dans les deux cas, le serveur **revérifie le statut directement auprès de l'opérateur**.
6. Une fois le paiement confirmé, la commande passe à « payée » et le stock diminue.

L'opérateur est reconnu à partir du préfixe : 06 = MTN, 05/04 = Airtel.

## Passer aux vrais paiements

1. **MTN MoMo** : créez un compte sur https://momodeveloper.mtn.com, abonnez-vous au produit *Collection*,
   puis renseignez `MTN_SUBSCRIPTION_KEY`, `MTN_API_USER` et `MTN_API_KEY`.
   En production, demandez un compte marchand à MTN Congo et utilisez `MTN_TARGET_ENV=mtncongo`,
   `MTN_BASE_URL=https://proxy.momoapi.mtn.com` et `MTN_CURRENCY=XAF`.
2. **Airtel Money** : créez une application sur https://developers.airtel.africa (produit *Collection*),
   puis renseignez `AIRTEL_CLIENT_ID` et `AIRTEL_CLIENT_SECRET`.
   En production, utilisez `AIRTEL_BASE_URL=https://openapi.airtel.africa`.
3. Passez `PAYMENT_MODE=live` dans `.env`.
4. Mettez le site en ligne avec une adresse publique en HTTPS (`PUBLIC_URL`) pour recevoir les callbacks.

Une autre solution consiste à passer par un **agrégateur** (CinetPay, pawaPay, Flutterwave…). On n'a alors qu'un
seul contrat et une seule intégration pour plusieurs opérateurs et plusieurs pays. Il suffit d'ajouter un fichier
dans `src/payments/providers/`.

## Organisation des fichiers

```
src/
  server.js              serveur web + API
  config.js              lecture du fichier .env
  store.js               stockage (fichiers JSON pour l'instant)
  routes/                API : produits, commandes, paiements
  payments/
    index.js             choix de l'opérateur (simulation / réel)
    providers/           MTN MoMo, Airtel Money, simulation
  utils/                 numéros de téléphone, montants FCFA
public/                  le site (HTML, CSS, JavaScript sans framework)
public/images/products/  images des produits (PNG/JPG, champ "image" de chaque produit)
data/products.json       catalogue électronique + mode (produits d'exemple à remplacer)
```

## Prochaines étapes

- Remplacer les produits d'exemple par le vrai catalogue, avec photos
- Espace d'administration (produits, commandes, livraisons)
- Frais de livraison par ville ou par quartier
- Notification au client par SMS ou WhatsApp après le paiement
- Base de données (PostgreSQL) et hébergement
