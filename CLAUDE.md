# Kamwa — contexte projet pour Claude Code

## Le porteur du projet
- Joseph, basé à Pointe-Noire (Congo-Brazzaville). Chef de projet, **pas développeur** : expliquer simplement, en français, donner les commandes exactes à taper, ne pas supposer de connaissances techniques.
- Travaille sur un Mac (Node.js v24 installé). Le projet est dans `~/Desktop/BYDL`.
- Préférence : être efficace, ne pas régénérer ce qui existe déjà, ne modifier que ce qui doit l'être.

## Le projet
**Kamwa** (KAM-WA ; du lingala *kokamwa*, « s'émerveiller » : l'idée de découverte) : boutique en ligne adaptée à l'Afrique centrale, d'abord le Congo-Brazzaville. Anciennement « Baydel » (renommé le 16/10/2026) ; `BYDL` n'est que le nom du dossier, `data/baydel.db` un nom de fichier historique.
- Nom de domaine choisi : **kamwa.cg** (à réserver par Joseph auprès du registre .cg). Vision long terme : marketplace, marque assez forte pour du sponsoring.
- Suivi du projet : page Notion « Projet BYDL — Baydel » (feuille de route + journal), privée chez Joseph.
- Prix en **FCFA (XAF, entiers, pas de centimes)**, interface en français, pensée **mobile d'abord** et connexions lentes.
- Paiement **Mobile Money uniquement : MTN MoMo et Airtel Money**.
- Style visuel inspiré de **Cdiscount** (marchand, dense, bannières promo, prix barrés, badges de remise, « Bonnes affaires du jour »), mais avec une identité propre : vert `#0E3B2E` + orange `#FF7A00`, prix en rouge `#D7261E`. Ne pas copier la marque Cdiscount.
- Catalogue : **Électronique** (Téléphones, Tablettes, Ordinateurs, Montres, Audio, TV & Maison, Composants, Accessoires) et **Mode** (Homme, Femme, Chaussures — t-shirts, pantalons, joggings, chaussures ; surtout homme, un peu femme).
- Livraison annoncée : 24-48 h à Pointe-Noire et Brazzaville.

## Stack et structure
Node.js (≥ 22.13) + Express, front en HTML/CSS/JS vanilla sans framework (léger), base **SQLite intégrée à Node** (`node:sqlite`, fichier `data/baydel.db`), e-mails via nodemailer.
```
src/server.js            serveur + API ; HTML/CSS/JS en no-cache, images en cache 24 h
src/config.js            lit .env (PAYMENT_MODE, clés MTN/Airtel…)
src/store.js             base SQLite (une table par collection : id + document JSON) ; au 1er démarrage importe data/products.json (+ anciens orders/payments.json). Ensuite la BASE fait foi : products.json n'est plus qu'un catalogue de départ
src/catalog.js           liste des univers/catégories (servie au site via /api/config et à l'admin)
src/notify.js            e-mail à chaque commande payée (SMTP dans .env ; sinon affiché dans le Terminal)
src/admin/auth.js        connexion admin : mot de passe (scrypt) en base, cookie de session HttpOnly/SameSite=Strict 7 j, blocage 15 min après 5 échecs
src/routes/admin.js      /api/admin : login/logout/me, commandes (statuts, client, note), produits (création/modif/masquer), envoi de photos, clients (liste, « nouveau code »)
src/customer/auth.js     comptes clients : identifiant = téléphone OU e-mail + code Kamwa à 6 chiffres (100000-999999) ATTRIBUÉ par le site, montré une seule fois ; empreinte scrypt ; cookie kamwa_client (HttpOnly, SameSite=Lax, 30 j) ; blocage 15 min après 5 codes faux par compte / 20 par adresse IP
src/routes/account.js    /api/account : register, login, logout, me, orders (historique), claim (rattache les commandes de l'appareil via leur clé)
scripts/admin-password.js  `npm run admin:password` : créer/changer le mot de passe admin (saisie masquée)
public/admin/            espace admin (http://localhost:3000/admin) : commandes, produits, sonnerie des nouvelles commandes
data/uploads/            photos envoyées depuis l'admin (servies sur /images/uploads/)
src/routes/products.js   GET /api/products?universe=&category=&q=  ·  GET /api/products/:id
src/routes/orders.js     POST /api/orders (total RECALCULÉ côté serveur ; renvoie une clé secrète `token`)  ·  GET /api/orders/:id (en-tête X-Order-Token obligatoire)
src/routes/payments.js   POST /api/payments (body.token obligatoire) · GET /api/payments/:id (polling) · POST /api/payments/callback/:operator
src/payments/http.js     appels opérateurs avec délai maximal (OPERATOR_TIMEOUT_MS, 15 s)
src/utils/stock.js       stock disponible = stock - quantités réservées par les paiements en attente
src/payments/index.js    choix simulation / live
src/payments/providers/  mtn-momo.js (Collection API, requesttopay) · airtel-money.js (merchant/v1/payments) · simulation.js
src/utils/phone.js       numéros +242 : 06 = MTN, 05/04 = Airtel
public/index.html, public/css/style.css, public/js/app.js   SPA avec routes hash : #/, #/c/<univers>/<catégorie>, #/p/<id>, #/recherche/<q>, #/promos, #/commande, #/merci/<id>, #/compte, #/compte/creer, #/suivi/<id>
public/images/products/  images produit (champ "image" ; repli sur emoji si absente)
data/products.json       catalogue de départ (~107 produits : 90 Apple de SIMULATION + composants + mode), importé une seule fois
```
Lancer : `npm install` puis `npm start` → boutique http://localhost:3000 · admin http://localhost:3000/admin (mot de passe : `npm run admin:password`).

**Dépôt GitHub PUBLIC** (Jojobizzare222/BYDL) : ne jamais y mettre de secret ni de donnée client. `.env`, `data/baydel.db*`, `data/uploads/`, anciens orders/payments.json sont exclus par .gitignore. Joseph envoie les sauvegardes avec GitHub Desktop (« Push origin »).

## Paiement — règles à respecter
- Flux : commande créée → demande de paiement à l'opérateur → le client valide avec son code PIN → le navigateur interroge le statut toutes les 4 s → le serveur **revérifie toujours auprès de l'opérateur** (ne jamais faire confiance au navigateur ni au contenu d'un callback) → commande `paid` + décrément du stock.
- `PAYMENT_MODE=simulation` par défaut : validé après ~8 s ; un numéro finissant par `000` simule un refus.
- Mode `live` : MTN sandbox (momodeveloper.mtn.com, devise EUR en sandbox, `mtncongo`/XAF en prod) ; Airtel nécessite un compte marchand Airtel Congo (pas de vrai test possible avant). Joseph n'a qu'un numéro Airtel → vrai test téléphone reporté.
- **Anti double paiement** : une seule demande en attente par commande (les anciennes sont revérifiées avant toute nouvelle ; une demande en attente de moins de `PAYMENT_PENDING_MINUTES`=10 min est reprise, pas doublée). Le navigateur garde la commande en cours (`baydel-checkout` dans localStorage) et la réutilise tant que le panier ne change pas. Après 3 min sans réponse, la page n'affiche PAS « échec » : elle continue de vérifier (jusqu'à 15 min).
- Pas de réponse de l'opérateur (délai dépassé) : la demande est quand même enregistrée en attente pour être revérifiée, jamais perdue.
- Les coordonnées d'une commande ne sont lisibles qu'avec sa clé (`token`, gardée par le navigateur du client dans `kamwa-orders`) OU par le client connecté propriétaire (`customerId`). Jamais la note interne admin ni `paidAfterCancel` côté client.
- **Comptes clients** (décision Joseph 16/10/2026 : gratuit, pas de SMS) : le code seul ne donne JAMAIS accès (il faut identifiant + code). Numéro/e-mail non vérifiés → on ne rattache JAMAIS automatiquement des commandes par numéro ; seulement les commandes passées connecté ou prouvées par leur clé. Code oublié : l'admin génère un nouveau code (onglet Clients) et l'envoie par WhatsApp. Achat sans compte toujours possible.
- Alternative envisageable plus tard : agrégateur (CinetPay, pawaPay…) via un nouveau provider.

## État actuel et points d'attention
- Les 90 produits Apple et leurs **70 images sont une simulation** : illustrations génériques générées (pas de photos officielles Apple, pas de logo Apple — droits d'image). Les **prix FCFA sont des estimations**, pas des prix marché. À remplacer par le vrai catalogue / photos fournisseur.
- Statuts de commande : pending_payment → paid → shipped → delivered, ou cancelled (retour arrière possible : expédiée→payée, livrée→expédiée). Annuler une commande payée remet le stock ; le remboursement Mobile Money se fait à la main. Un paiement validé APRÈS annulation est signalé `paidAfterCancel` (+ e-mail « à rembourser »).
- Sauvegardes : la base et les photos (data/) ne sont PAS sur GitHub → prévoir une sauvegarde à la mise en ligne.
- Pas encore : frais de livraison par zone, alertes WhatsApp/SMS, hébergement en ligne, comptes marchands opérateurs, e-mail SMTP réel (à configurer avec Joseph).

## Plan validé (15/10/2026)
0. ✅ Projet sous Git (branche `main`).
1. ✅ Fiabiliser l'achat : double paiement, données clients protégées, stock réservé pendant le paiement, cache, délais opérateurs.
2. ✅ Gérer la boutique : espace admin (un seul compte, Joseph), commandes + statuts, produits ajoutés/modifiés avec photo, alerte e-mail + sonnerie dans l'admin, base SQLite.
3. Contenu réel : catalogue/photos fournisseur, frais de livraison par ville (le formulaire propose encore Dolisie/Autre), pages légales (CGV, confidentialité), contact WhatsApp, vérifier « TVA incluse ».
4. Mise en ligne : hébergeur, domaine, HTTPS, limite de requêtes, vrai paiement MTN de petit montant.

**Application : reportée.** Joseph a choisi de rester sur le site web, sans application ni installation, pour l'instant. Si elle revient : application pour les clients (achat), en partant du site (PWA) avant tout passage au Play Store.

## Façon de travailler avec Joseph
- Toujours expliquer en français simple ce qui a été fait et comment le voir (quelle commande, quelle URL, redémarrer `npm start` si `data/` a changé).
- Tester avant de dire que c'est fini ; ne pas casser le parcours d'achat ni la sécurité du paiement.
- Poser une question à la fois quand une décision lui revient (prix, opérateurs, design, choix techniques structurants).
