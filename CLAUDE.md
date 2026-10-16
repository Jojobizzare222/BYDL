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
- Paiement : **Mobile Money (MTN MoMo, Airtel Money)**, **carte bancaire** (via la page sécurisée d'un prestataire, SIMULÉE tant qu'aucun prestataire n'est branché) et **espèces en agence** (retrait en agence, décidé le 16/10/2026).
- Style visuel : **« Éclat moderne »** (16/10/2026). Joseph a refusé la version trop proche d'apple.com (« trop flagrant ») : garder une base claire et aérée MAIS une identité Kamwa affirmée et du **marketing produit**. Fond `#FAF9FE` avec **formes géométriques animées** (anneaux, halos, étincelles du logo, carré, triangle, trame de points ; `.bg-shapes` dans index.html, mouvements lents en CSS, coupés si « réduire les animations »). Couleur dosée : **violet nuit `#2D1B69`** (boutons, bandeau défilant, pied de page `#1E1247`, carrousel), **corail `#FF5A3C`** (remises, ventes flash), **mangue `#FFB300`** (badges « Nouveau », pastilles de remise). Accueil : grand **carrousel d'offres** auto (6 s, flèches, points, glisser au doigt ; dégradés violet / corail / mangue / clair, photo inclinée + pastille de remise), rayons en **bulles** colorées, **Ventes flash** avec compte à rebours jusqu'à minuit, **2 bannières** (compte Kamwa, livraison), **carrousels de produits** avec flèches (`railCarousel` dans app.js), « Pourquoi choisir Kamwa ». En-tête : logo, **barre de recherche visible** (loupe sur téléphone), Compte, Panier. Ne PAS revenir à un look copié d'Apple ; ne pas copier non plus Cdiscount. Logo **« L'éclat »** dans `public/brand/`.
- **Police** : celle d'Apple (San Francisco) N'EST PAS autorisée sur un site web (licence réservée aux apps Apple) → pile `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", …` : les iPhone/Mac affichent San Francisco (police du système, rien à télécharger), les autres (Android, Windows) **Inter** (libre, OFL), hébergée dans `public/fonts/inter.woff2`. Même police dans l'espace pro. Icônes **Phosphor via Iconify** (traits fins « regular » pour la boutique) dans `public/icons.svg`, appelées avec `/icons.svg?v=4#nom` (changer le numéro quand on ajoute des icônes) — pas d'émojis dans la boutique.
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
src/admin/auth.js        connexion espace pro : IDENTIFIANT + mot de passe. « admin » = Joseph (mot de passe `npm run admin:password`, ancien formulaire sans identifiant accepté) ; équipe/fournisseurs = collection `staff` (rôles catalog | orders | supplier, mots de passe provisoires à changer). Cookie kamwa_admin (session liée à user_id), blocage 15 min après 5 échecs par IP ou par compte ; compte désactivé = sessions coupées. `requireStaff` + `requireRole(...)` (admin a tous les droits)
src/routes/admin.js      /api/admin : login/logout/me, commandes [admin, orders], produits [admin, catalog, supplier ; fournisseur = SES produits seulement], validation `POST /products/:id/approve` [admin], `/supplier/orders` [supplier : ses lignes, JAMAIS les coordonnées clients], photos [admin, catalog, supplier], clients/agences/équipe (`/staff`)/journal (`/activity`) [admin]. Chaque action sensible est journalisée (collection `activity`). `GET /stats?days=7|30|90` = chiffres du tableau de bord SELON LE RÔLE (fournisseur : ses ventes au prix fournisseur ; catalogue : pas de ventes ; commandes : pas de chiffre d'affaires). Exports CSV Excel (`;` + BOM) : `/export/orders.csv` [orders], `/export/products.csv` [catalog, supplier ; sans prix fournisseur pour catalog], `/export/customers.csv` [admin]
src/customer/auth.js     comptes clients : identifiant = téléphone OU e-mail + code Kamwa à 6 chiffres (100000-999999) ATTRIBUÉ par le site, montré une seule fois ; empreinte scrypt ; cookie kamwa_client (HttpOnly, SameSite=Lax, 30 j) ; blocage 15 min après 5 codes faux par compte / 20 par adresse IP
src/routes/account.js    /api/account : register, login, logout, me, orders (historique), claim (rattache les commandes de l'appareil via leur clé)
scripts/admin-password.js  `npm run admin:password` : créer/changer le mot de passe admin (saisie masquée)
public/admin/            espace pro (http://localhost:3000/admin), THÈME SOMBRE (choix de Joseph) + identité « Éclat moderne » de la boutique (16/10/2026) : formes animées en fond, liseré violet→corail→mangue, boutons en pilule dégradé violet, bandeau d'accueil coloré « Bonjour … » avec raccourcis selon le rôle, indicateurs à pastilles colorées (classes kc0-kc3 : ne pas réutiliser k1/k2, déjà pris par les formes) ; police : la même que la boutique inspiré de l'admin Discourse (décision Joseph 16/10/2026) : barre latérale (menu coulissant sur téléphone), tableau de bord avec graphiques (Chart.js 4.4.6 MIT, hébergé dans public/admin/vendor/), listes en tableaux triables + recherche + onglets + bouton Exporter (cartes sur téléphone), sonnerie des nouvelles commandes. Icônes via `/icons.svg?v=4#nom` (changer le numéro si on ajoute des icônes, sinon le navigateur garde l'ancien fichier)
data/uploads/            photos envoyées depuis l'admin (servies sur /images/uploads/)
src/routes/products.js   GET /api/products?universe=&category=&q=  ·  GET /api/products/:id
src/routes/orders.js     POST /api/orders (total RECALCULÉ côté serveur ; renvoie une clé secrète `token`)  ·  GET /api/orders/:id (en-tête X-Order-Token obligatoire)
src/routes/payments.js   POST /api/payments (body.token obligatoire) · GET /api/payments/:id (polling) · POST /api/payments/callback/:operator
src/payments/http.js     appels opérateurs avec délai maximal (OPERATOR_TIMEOUT_MS, 15 s)
src/utils/stock.js       stock disponible = stock - quantités réservées par les paiements en attente
src/payments/index.js    choix simulation / live ; cardAvailable() (carte proposée en simulation, ou si CARD_PROVIDER est configuré en live)
src/payments/providers/  mtn-momo.js (Collection API, requesttopay) · airtel-money.js (merchant/v1/payments) · simulation.js · cash.js (espèces, expire à l'échéance) · card-simulation.js (page de test /paiement-carte/) · card.js (vrai prestataire À BRANCHER : CinetPay/Moneroo…)
public/paiement-carte/   fausse page de paiement carte (mode simulation uniquement, aucun numéro de carte demandé)
src/utils/phone.js       numéros +242 : 06 = MTN, 05/04 = Airtel
public/index.html, public/css/style.css, public/js/app.js   SPA avec routes hash : #/, #/c/<univers>/<catégorie>, #/p/<id>, #/recherche/<q>, #/promos, #/commande, #/merci/<id>, #/compte, #/compte/creer, #/suivi/<id>, #/credits, #/legal/<mentions|confidentialite|conditions|vente>, #/cookies
public/js/legal.js       textes légaux (mentions légales, confidentialité, conditions d'utilisation, ventes et remboursements) : MODÈLES, passages « À compléter » surlignés (société, RCCM, NIU, hébergeur, contact, délais de retour/remboursement, garantie, TVA) → à remplir par Joseph et faire relire par un juriste avant l'ouverture
public/js/cookies.js     bandeau cookies (« Tout accepter » / « Paramétrer » / « Continuer sans accepter ») + page #/cookies ; choix gardé 6 mois (localStorage `kamwa-consent`). Aujourd'hui SEULS des traceurs indispensables existent (kamwa_client, panier, commande en cours) ; tout futur outil de statistiques/pub doit être chargé UNIQUEMENT si `window.kamwaConsent.has('audience' | 'marketing')`, et être ajouté à la liste de la page cookies
public/images/commons/   photos produits libres (Wikimedia Commons) + CREDITS.md ; champ "image" + "imageCredit" ; repli sur l'icône Phosphor si absente
public/images/products/  anciennes illustrations générées, plus utilisées (à supprimer)
public/brand/            logo Kamwa (logo-kamwa.svg, logo-kamwa-clair.svg, symbole, favicon, icône 512, image de partage)
public/icons.svg         icônes Phosphor (Iconify) en sprite ; public/fonts/inter.woff2 (Inter, police libre)
data/products.json       catalogue de départ (~107 produits : 90 Apple de SIMULATION + composants + mode), importé une seule fois
```
Lancer : `npm install` puis `npm start` → boutique http://localhost:3000 · admin http://localhost:3000/admin (mot de passe : `npm run admin:password`).

**Dépôt GitHub PUBLIC** (Jojobizzare222/BYDL) : ne jamais y mettre de secret ni de donnée client. `.env`, `data/baydel.db*`, `data/uploads/`, anciens orders/payments.json sont exclus par .gitignore. Joseph envoie les sauvegardes avec GitHub Desktop (« Push origin »).

## Paiement — règles à respecter
- `POST /api/payments` prend `method` = `momo` (défaut) | `card` | `cash`. `GET /api/payments/methods` dit ce qui est proposé (espèces seulement s'il existe une agence active, gérée dans l'admin → onglet Agences).
- **Carte** : le client est redirigé vers la page du prestataire (`redirectUrl`) ; JAMAIS de numéro de carte sur le serveur Kamwa. Statut revérifié auprès du prestataire comme pour Mobile Money. Au Congo-Brazzaville, Stripe n'existe pas ; CinetPay / Moneroo à confirmer par Joseph.
- **Espèces en agence** = retrait en agence (« click & collect ») : réservation `PICKUP_HOLD_HOURS` (48 h) qui bloque le stock (`payment.expiresAt`), commande `fulfillment: 'pickup'` + `agency` + `pickupDeadline`, e-mail de réservation à l'admin. L'admin confirme « Paiement reçu en agence » (`POST /api/admin/orders/:id/cash-received`, possible même après expiration), puis « Remise au client » (statut `delivered`, pas d'`shipped`). Une réservation en cours peut être remplacée par un paiement en ligne (elle passe `CANCELLED`).
- Flux : commande créée → demande de paiement à l'opérateur → le client valide avec son code PIN → le navigateur interroge le statut toutes les 4 s → le serveur **revérifie toujours auprès de l'opérateur** (ne jamais faire confiance au navigateur ni au contenu d'un callback) → commande `paid` + décrément du stock.
- `PAYMENT_MODE=simulation` par défaut : validé après ~8 s ; un numéro finissant par `000` simule un refus.
- Mode `live` : MTN sandbox (momodeveloper.mtn.com, devise EUR en sandbox, `mtncongo`/XAF en prod) ; Airtel nécessite un compte marchand Airtel Congo (pas de vrai test possible avant). Joseph n'a qu'un numéro Airtel → vrai test téléphone reporté.
- **Anti double paiement** : une seule demande en attente par commande (les anciennes sont revérifiées avant toute nouvelle ; une demande en attente de moins de `PAYMENT_PENDING_MINUTES`=10 min est reprise, pas doublée). Le navigateur garde la commande en cours (`baydel-checkout` dans localStorage) et la réutilise tant que le panier ne change pas. Après 3 min sans réponse, la page n'affiche PAS « échec » : elle continue de vérifier (jusqu'à 15 min).
- Pas de réponse de l'opérateur (délai dépassé) : la demande est quand même enregistrée en attente pour être revérifiée, jamais perdue.
- Les coordonnées d'une commande ne sont lisibles qu'avec sa clé (`token`, gardée par le navigateur du client dans `kamwa-orders`) OU par le client connecté propriétaire (`customerId`). Jamais la note interne admin ni `paidAfterCancel` côté client.
- **Comptes clients** (décision Joseph 16/10/2026 : gratuit, pas de SMS) : le code seul ne donne JAMAIS accès (il faut identifiant + code). Numéro/e-mail non vérifiés → on ne rattache JAMAIS automatiquement des commandes par numéro ; seulement les commandes passées connecté ou prouvées par leur clé. Code oublié : l'admin génère un nouveau code (onglet Clients) et l'envoie par WhatsApp. Achat sans compte toujours possible.
- Alternative envisageable plus tard : agrégateur (CinetPay, pawaPay…) via un nouveau provider.

## Vitrine de démonstration sur Vercel (16/10/2026)
- Joseph a déployé le dépôt sur **Vercel** : https://bydl.vercel.app (se met à jour à chaque « Push origin »). Vercel = DÉMO UNIQUEMENT, pas la vraie boutique (vraie mise en ligne : VPS, étape 4).
- Sur Vercel (`process.env.VERCEL`) : disque en lecture seule sauf /tmp → base `/tmp/kamwa-demo.db` TEMPORAIRE (repart de `data/products.json` à chaque redémarrage), photos envoyées dans `/tmp/kamwa-uploads`, `config.demo = true` → bandeau « Site de démonstration » + paiements en simulation. `express.static` y est ignoré : les fichiers de `public/` sont servis par Vercel, les photos envoyées par la route `/images/uploads/:name`.
- **Comptes de démonstration PUBLICS** (src/demo.js, uniquement si `config.demo`) : `admin`, `demo-fournisseur`, `demo-catalogue`, `demo-commandes`, mot de passe `demo-kamwa`, affichés en boutons sur la page de connexion de la démo ; créés avec des données d'exemple (produits Mode Congo, un produit à valider, une commande payée) à chaque démarrage de la base temporaire. Ils ne peuvent être ni désactivés, ni réinitialisés, ni changer de mot de passe. N'existent JAMAIS en mode normal (vérifié par test). Le réglage `ADMIN_PASSWORD_HASH` n'a donc plus d'effet sur la démo (le mot de passe démo est en base).
- `data/products.json` (catalogue de départ) est aligné sur la boutique : produits non-Apple `active: false`.
- Le Mac est connecté à Vercel en ligne de commande (projet `bydl`, équipe `admin-30e7`) : redéployer la démo sans GitHub avec `npx --yes vercel@latest deploy --prod --yes --scope admin-30e7`. `.vercelignore` empêche d'envoyer la base, les photos envoyées, les anciennes commandes et `.env`. Le jeton local (`.env.local`) est exclu de Git.

## Espace pro : équipe et fournisseurs (décisions Joseph 16/10/2026)
- Rôles : **admin** (tout), **supplier** (fournisseur : ses produits, son stock, son prix fournisseur, les commandes de ses produits), **catalog** (employé Catalogue : ajout/modif de tous les produits, ne voit pas les prix fournisseur), **orders** (employé Commandes : commandes et statuts).
- **Kamwa livre** : le fournisseur ne voit jamais les coordonnées des clients ; il voit les commandes payées contenant ses produits (ses lignes seulement).
- **Kamwa fixe le prix de vente** : le fournisseur saisit `supplierPrice` ; `price` est fixé par l'admin (marge affichée à l'admin). `supplierPrice`, `supplierId`, `pending`, `createdBy`… ne sortent JAMAIS vers la boutique (`publicProduct` dans routes/products.js).
- **Validation** : tout nouveau produit créé par un fournisseur OU un employé est `pending: true` (invisible, non commandable) jusqu'à « Valider et publier » par l'admin (prix de vente obligatoire). Les produits créés par l'admin sont publiés directement.
- Fournisseur sur un produit déjà publié : seuls `stock` et `supplierPrice` sont modifiables (le reste est ignoré côté serveur).
- **Suppression** (`DELETE /api/admin/products/:id`, 16/10/2026) : l'admin peut supprimer définitivement n'importe quel produit (confirmation), SAUF s'il est dans une commande en cours de paiement (409 : le masquer d'abord). Fournisseur/employé : seulement SA proposition encore en attente (« Retirer ma proposition »). Les commandes passées restent intactes (chaque ligne garde nom et prix). Les photos envoyées qui ne servent plus à aucun produit sont effacées du disque. Journalisé. « Masquer » (décocher Visible) reste la solution réversible.
- Fiche produit : plusieurs photos (`images[]`, la 1re = `image` principale, max 8, bouton appareil photo `capture="environment"` + galerie), `condition` (neuf/reconditionné/occasion), `specs` [{label, value}] (saisie « Libellé : valeur » par ligne).

## État actuel et points d'attention
- Les **prix FCFA des 90 produits Apple sont des estimations** (catalogue de SIMULATION). **Photos (16/10/2026)** : les illustrations générées ont été remplacées par de **vraies photos sous licence libre de Wikimedia Commons** (`public/images/commons/`, 43 photos, crédits dans `CREDITS.md`) : 74 produits ont une photo, 16 gardent l'icône de catégorie (iMac, AirPods 2/3, chargeurs, câbles, coques : pas de photo libre fiable). Chaque produit garde `imageCredit` {author, license, licenseUrl, source} → crédit affiché sur la fiche + page `#/credits` (obligation des licences CC BY / BY-SA). Photos d'illustration : couleur parfois différente. Une photo envoyée depuis l'admin efface le crédit. Les anciennes images générées (`public/images/products/`) ne sont plus utilisées : à supprimer (Joseph). **Photos officielles Apple : interdites sans autorisation** (citer la source ne suffit pas) → avant lancement, photos réelles de Joseph ou du fournisseur.
- Statuts de commande : pending_payment → paid → shipped → delivered, ou cancelled (retour arrière possible : expédiée→payée, livrée→expédiée). Annuler une commande payée remet le stock ; le remboursement Mobile Money se fait à la main. Un paiement validé APRÈS annulation est signalé `paidAfterCancel` (+ e-mail « à rembourser »).
- Sauvegardes : la base et les photos (data/) ne sont PAS sur GitHub → prévoir une sauvegarde à la mise en ligne.
- Pas encore : frais de livraison par zone, alertes WhatsApp/SMS, hébergement en ligne, comptes marchands opérateurs, e-mail SMTP réel (à configurer avec Joseph).

## Plan validé (15/10/2026)
0. ✅ Projet sous Git (branche `main`).
1. ✅ Fiabiliser l'achat : double paiement, données clients protégées, stock réservé pendant le paiement, cache, délais opérateurs.
2. ✅ Gérer la boutique : espace admin (un seul compte, Joseph), commandes + statuts, produits ajoutés/modifiés avec photo, alerte e-mail + sonnerie dans l'admin, base SQLite.
3. Contenu réel : catalogue/photos fournisseur, frais de livraison par ville (le formulaire propose encore Dolisie/Autre), pages légales (modèles en ligne depuis le 16/10/2026 : compléter les « À compléter » + relecture juriste), contact WhatsApp, vérifier « TVA incluse ».
4. Mise en ligne : hébergeur, domaine, HTTPS, limite de requêtes, vrai paiement MTN de petit montant.

**Application : reportée.** Joseph a choisi de rester sur le site web, sans application ni installation, pour l'instant. Si elle revient : application pour les clients (achat), en partant du site (PWA) avant tout passage au Play Store.

## Façon de travailler avec Joseph
- Toujours expliquer en français simple ce qui a été fait et comment le voir (quelle commande, quelle URL, redémarrer `npm start` si `data/` a changé).
- Tester avant de dire que c'est fini ; ne pas casser le parcours d'achat ni la sécurité du paiement.
- Poser une question à la fois quand une décision lui revient (prix, opérateurs, design, choix techniques structurants).
