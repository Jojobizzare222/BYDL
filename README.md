# Kamwa — Boutique en ligne

*Kamwa* (du lingala *kokamwa*, « s'émerveiller »), anciennement Baydel.

Site e-commerce (électronique et mode) pensé pour l'Afrique centrale (Congo-Brazzaville en premier) :
prix en **FCFA**, paiement **Mobile Money** (MTN MoMo et Airtel Money), pages légères pour les réseaux mobiles.

## Démarrer

Il faut [Node.js](https://nodejs.org) version 22.13 ou plus récente.

```bash
cd ~/Desktop/BYDL
npm install
cp .env.example .env
npm start
```

Ouvrez ensuite http://localhost:3000 dans votre navigateur.

## Vitrine de démonstration (Vercel)

Le dépôt peut être déployé sur Vercel comme **site de démonstration** (bandeau visible, paiements simulés, données temporaires remises à zéro régulièrement). Pour accéder à l'espace pro de la démo, créez l'empreinte de votre mot de passe :

```bash
npm run admin:hash
```

puis collez la ligne affichée dans Vercel → Settings → Environment Variables, sous le nom `ADMIN_PASSWORD_HASH`, et redéployez.

## Espace admin

1. Créez votre mot de passe (une seule fois, ou pour le changer) :
   ```bash
   npm run admin:password
   ```
2. Lancez le site (`npm start`) puis ouvrez http://localhost:3000/admin

Vous pouvez y :
- suivre les commandes : *Payée → Expédiée → Livrée* (ou *Annulée*), appeler ou écrire au client sur WhatsApp, corriger son adresse, ajouter une note ;
- ajouter et modifier les produits : photo, prix, prix barré, stock, description, visible ou masqué, mis en avant ;
- être prévenu des nouvelles commandes payées : sonnerie dans l'admin (bouton « Son ») et e-mail (voir `.env.example`).

## Espace client

- **Mon compte** (icône en haut à droite) : le client crée son compte avec son numéro de téléphone ou son e-mail. Kamwa lui attribue un **code à 6 chiffres**, affiché une seule fois.
- Connexion : numéro (ou e-mail) + code. 5 codes faux = compte bloqué 15 minutes.
- **Mes commandes** : historique des achats et **suivi** de chaque commande (passée → payée → expédiée → livrée). Sans compte, on voit les commandes passées depuis ce téléphone.
- Code oublié : dans l'admin, onglet **Clients** → « Nouveau code », à envoyer au client par WhatsApp.

Les données (commandes, produits, photos) sont dans `data/baydel.db` et `data/uploads/`. Elles ne partent **pas** sur GitHub.

Par défaut, le site tourne en **mode simulation** : aucun argent n'est débité, et le paiement
est validé automatiquement après environ 8 secondes. Un numéro qui se termine par `000` simule un refus.

## Comment se passe un paiement

1. Le client remplit son panier, puis indique son nom, sa ville et son numéro Mobile Money.
2. Le serveur crée la commande et **recalcule le total à partir du catalogue** (le prix envoyé par le navigateur n'est jamais pris en compte).
3. Le serveur envoie une demande de paiement à l'opérateur (MTN ou Airtel).
4. Le client reçoit une demande sur son téléphone et la valide avec son code secret.
5. La page vérifie le statut toutes les 4 secondes. L'opérateur peut aussi prévenir le serveur via un callback. Dans les deux cas, le serveur **revérifie le statut directement auprès de l'opérateur**.
6. Une fois le paiement confirmé, la commande passe à « payée » et le stock diminue.

Protections :
- **Pas de double paiement** : une seule demande de paiement en attente par commande. Si le client réessaie ou recharge la page, on reprend la même commande et la même demande. Si l'opérateur tarde, la page continue de vérifier au lieu d'afficher « échec ».
- **Stock réservé** pendant qu'un client paie (10 minutes maximum), pour ne pas vendre deux fois le dernier article.
- **Données clients protégées** : seule la personne qui a passé la commande peut en voir les coordonnées (clé secrète gardée par son navigateur).
- **Opérateur trop lent** : on n'attend pas plus de 15 s, et la demande reste vérifiable ensuite.

L'opérateur est reconnu à partir du préfixe : 06 = MTN, 05/04 = Airtel.

## Les trois moyens de paiement

- **Mobile Money** (MTN MoMo, Airtel Money) : voir ci-dessus.
- **Carte bancaire** : le client est envoyé sur la page sécurisée du prestataire, puis revient sur Kamwa. Kamwa ne voit jamais le numéro de carte. En mode simulation, une page de test (`/paiement-carte/`) permet d'accepter ou de refuser le paiement.
- **Espèces en agence** : le client réserve en ligne (articles bloqués 48 h), vient payer à l'agence et repart avec sa commande. Dans l'admin : « Paiement reçu en agence », puis « Remise au client ». Cette option n'apparaît que s'il existe au moins une agence active (admin → onglet **Agences**).

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
  store.js               base de données SQLite (data/baydel.db)
  catalog.js             liste des rayons et catégories
  notify.js              e-mail à chaque commande payée
  admin/auth.js          connexion à l'espace admin
  routes/                API : produits, commandes, paiements, admin
  payments/
    index.js             choix de l'opérateur (simulation / réel)
    providers/           MTN MoMo, Airtel Money, simulation
  utils/                 numéros de téléphone, montants FCFA, stock disponible
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

## Composants libres utilisés
- **Chart.js 4.4.6** (MIT) — graphiques de l'espace pro (`public/admin/vendor/`).
- **IBM Plex Sans** (SIL Open Font License, © IBM) — police des deux applications (`public/fonts/ibm-plex-sans-*.woff2`, licence `public/fonts/OFL-ibm-plex.txt`).
- **Leaflet** (BSD-2) — cartes (`public/vendor/leaflet/`) ; fonds de carte © contributeurs OpenStreetMap (ODbL).
- **web-push** (MPL-2.0), **tesseract.js** (Apache 2.0), **@vercel/functions** (Apache 2.0).
- **qrcode-generator** (MIT, Kazuhiko Arase) — QR codes des étiquettes de colis ; **jsQR 1.4.0** (Apache 2.0) — lecture des QR au téléphone dans Kamwa Pro (`public/admin/vendor/jsqr/`).
- **Phosphor Icons** (MIT, via Iconify) — icônes (`public/icons.svg`).
- **ISNet « general use »** (DIS, Xuebin Qin et al., Apache 2.0 ; fichier diffusé par le projet rembg, MIT) — détourage automatique des photos ; téléchargé au premier usage dans `data/models/`.
- **onnxruntime-web** (MIT) et **sharp** (Apache 2.0) — exécution du détourage sur le serveur.
