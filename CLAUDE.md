# Baydel — contexte projet pour Claude Code

## Le porteur du projet
- Joseph, basé à Pointe-Noire (Congo-Brazzaville). Chef de projet, **pas développeur** : expliquer simplement, en français, donner les commandes exactes à taper, ne pas supposer de connaissances techniques.
- Travaille sur un Mac (Node.js v24 installé). Le projet est dans `~/Desktop/BYDL`.
- Préférence : être efficace, ne pas régénérer ce qui existe déjà, ne modifier que ce qui doit l'être.

## Le projet
**Baydel** (B-A-Y-D-E-L ; `BYDL` n'est que le nom du dossier) : boutique en ligne adaptée à l'Afrique centrale, d'abord le Congo-Brazzaville.
- Prix en **FCFA (XAF, entiers, pas de centimes)**, interface en français, pensée **mobile d'abord** et connexions lentes.
- Paiement **Mobile Money uniquement : MTN MoMo et Airtel Money**.
- Style visuel inspiré de **Cdiscount** (marchand, dense, bannières promo, prix barrés, badges de remise, « Bonnes affaires du jour »), mais avec une identité propre : vert `#0E3B2E` + orange `#FF7A00`, prix en rouge `#D7261E`. Ne pas copier la marque Cdiscount.
- Catalogue : **Électronique** (Téléphones, Tablettes, Ordinateurs, Montres, Audio, TV & Maison, Composants, Accessoires) et **Mode** (Homme, Femme, Chaussures — t-shirts, pantalons, joggings, chaussures ; surtout homme, un peu femme).
- Livraison annoncée : 24-48 h à Pointe-Noire et Brazzaville.

## Stack et structure
Node.js + Express, front en HTML/CSS/JS vanilla sans framework (léger), stockage en fichiers JSON.
```
src/server.js            serveur + API ; HTML/CSS/JS en no-cache, images en cache 24 h
src/config.js            lit .env (PAYMENT_MODE, clés MTN/Airtel…)
src/store.js             collections JSON chargées EN MÉMOIRE au démarrage → redémarrer après modif de data/
src/routes/products.js   GET /api/products?universe=&category=&q=  ·  GET /api/products/:id
src/routes/orders.js     POST /api/orders (total RECALCULÉ côté serveur)  ·  GET /api/orders/:id
src/routes/payments.js   POST /api/payments · GET /api/payments/:id (polling) · POST /api/payments/callback/:operator
src/payments/index.js    choix simulation / live
src/payments/providers/  mtn-momo.js (Collection API, requesttopay) · airtel-money.js (merchant/v1/payments) · simulation.js
src/utils/phone.js       numéros +242 : 06 = MTN, 05/04 = Airtel
public/index.html, public/css/style.css, public/js/app.js   SPA avec routes hash : #/, #/c/<univers>/<catégorie>, #/p/<id>, #/recherche/<q>, #/promos, #/commande, #/merci/<id>
public/images/products/  images produit (champ "image" ; repli sur emoji si absente)
data/products.json       ~107 produits (90 Apple de SIMULATION + composants + mode)
```
Lancer : `npm install` puis `npm start` → http://localhost:3000.

## Paiement — règles à respecter
- Flux : commande créée → demande de paiement à l'opérateur → le client valide avec son code PIN → le navigateur interroge le statut toutes les 4 s → le serveur **revérifie toujours auprès de l'opérateur** (ne jamais faire confiance au navigateur ni au contenu d'un callback) → commande `paid` + décrément du stock.
- `PAYMENT_MODE=simulation` par défaut : validé après ~8 s ; un numéro finissant par `000` simule un refus.
- Mode `live` : MTN sandbox (momodeveloper.mtn.com, devise EUR en sandbox, `mtncongo`/XAF en prod) ; Airtel nécessite un compte marchand Airtel Congo (pas de vrai test possible avant). Joseph n'a qu'un numéro Airtel → vrai test téléphone reporté.
- Alternative envisageable plus tard : agrégateur (CinetPay, pawaPay…) via un nouveau provider.

## État actuel et points d'attention
- Les 90 produits Apple et leurs **70 images sont une simulation** : illustrations génériques générées (pas de photos officielles Apple, pas de logo Apple — droits d'image). Les **prix FCFA sont des estimations**, pas des prix marché. À remplacer par le vrai catalogue / photos fournisseur.
- Pas encore : espace admin, base de données réelle, frais de livraison par zone, notifications SMS/WhatsApp, hébergement en ligne, comptes marchands opérateurs.

## Prochaine grande étape : une application
Joseph veut créer une **application** pour Baydel. Avant de coder, clarifier avec lui : application client mobile (Android d'abord ? iOS ?) ou appli de gestion (commandes/stock) ; technologie (PWA à partir du site existant, React Native/Expo, ou autre) ; elle devra réutiliser l'API existante (`/api/...`). Proposer un plan court et le faire valider avant de construire.

## Façon de travailler avec Joseph
- Toujours expliquer en français simple ce qui a été fait et comment le voir (quelle commande, quelle URL, redémarrer `npm start` si `data/` a changé).
- Tester avant de dire que c'est fini ; ne pas casser le parcours d'achat ni la sécurité du paiement.
- Poser une question à la fois quand une décision lui revient (prix, opérateurs, design, choix techniques structurants).
