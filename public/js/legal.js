// Kamwa — textes légaux affichés sur le site (#/legal/<page>).
// MODÈLES à faire relire par un juriste avant l'ouverture. Les passages surlignés « À compléter »
// attendent une information de Joseph (société, adresse, hébergeur, délais…).
(() => {
  const T = (what) => `<mark class="todo">[À compléter : ${what}]</mark>`;
  const updated = '16 octobre 2026';
  const CONTACT = `par téléphone ou WhatsApp au ${T('numéro du service client')}, ou par e-mail à ${T('adresse e-mail de contact')}`;

  window.KAMWA_LEGAL = {
    mentions: {
      title: 'Mentions légales',
      updated,
      html: `
        <h2>Éditeur du site</h2>
        <p>Le site Kamwa est édité par ${T('nom de la société ou de l\'entrepreneur')}, ${T('forme juridique (Ets, SARL, SAS…)')}
        au capital de ${T('montant')} FCFA, immatriculée au RCCM de ${T('ville')} sous le numéro ${T('numéro RCCM')},
        NIU ${T('numéro d\'identification unique')}.</p>
        <p>Siège : ${T('adresse complète')}, Pointe-Noire, République du Congo.<br>
        Contact : ${CONTACT}.</p>
        <p>Directeur de la publication : ${T('nom du responsable du site')}.</p>

        <h2>Hébergement</h2>
        <p>Le site est hébergé par ${T('nom, adresse et téléphone de l\'hébergeur')}.</p>

        <h2>Propriété intellectuelle</h2>
        <p>Le nom Kamwa, le logo, les textes et la présentation du site appartiennent à l'éditeur. Toute reproduction sans autorisation écrite est interdite.
        Les marques et noms de produits cités appartiennent à leurs propriétaires respectifs ; Kamwa est un revendeur indépendant.</p>
        <p>Certaines photos de produits sont publiées sous licence libre par leurs auteurs : leurs noms et licences figurent sur la page
        <a href="#/credits">Crédits photos</a> et sous chaque photo concernée.</p>

        <h2>Nous contacter</h2>
        <p>Pour toute question sur le site : ${CONTACT}.</p>`,
    },

    confidentialite: {
      title: 'Politique de confidentialité',
      updated,
      html: `
        <p>Chez Kamwa, nous ne collectons que les informations nécessaires pour traiter vos commandes, et nous ne les vendons jamais.
        Cette page explique quelles données nous utilisons, pourquoi, et comment exercer vos droits, conformément à la loi congolaise
        sur la protection des données à caractère personnel (loi n° 29-2019 du 10 octobre 2019).</p>

        <h2>Qui est responsable de vos données ?</h2>
        <p>${T('nom de la société')}, éditeur du site (voir les <a href="#/legal/mentions">mentions légales</a>). Contact : ${CONTACT}.</p>

        <h2>Les données que nous utilisons</h2>
        <ul>
          <li><strong>Pour une commande</strong> : votre nom, numéro de téléphone, ville et adresse ou repère de livraison, les produits commandés et le montant.</li>
          <li><strong>Pour le paiement Mobile Money</strong> : le numéro MTN ou Airtel qui reçoit la demande de paiement. Vous validez avec votre code secret sur votre téléphone : Kamwa ne le connaît jamais.</li>
          <li><strong>Pour le paiement par carte</strong> : vous payez sur la page sécurisée de notre prestataire de paiement. Kamwa ne reçoit et ne conserve jamais le numéro de votre carte.</li>
          <li><strong>Pour votre compte client</strong> (nécessaire pour commander) : votre numéro de téléphone ou e-mail, votre nom et l'historique de vos commandes. Votre code Kamwa à 6 chiffres est enregistré sous une forme chiffrée qui ne permet pas de le relire.</li>
          <li><strong>Pour vérifier votre identité</strong> : la photo de votre pièce d'identité (passeport, carte nationale d'identité ou NIU), son type et, si vous l'indiquez, son numéro. Elle sert uniquement à lutter contre les fausses commandes et la fraude. Elle n'est jamais publiée, n'est jamais transmise à nos fournisseurs ni aux livreurs, et seule l'équipe de vérification de Kamwa peut la consulter. Les informations cachées du fichier photo (position GPS, appareil) sont supprimées à l'enregistrement.</li>
          <li><strong>Pour la sécurité</strong> : l'adresse IP de connexion, gardée quelques minutes en mémoire pour bloquer les tentatives répétées de connexion.</li>
        </ul>

        <h2>Pourquoi nous les utilisons</h2>
        <ul>
          <li>Traiter, livrer ou préparer pour le retrait en agence votre commande, et vous appeler pour la confirmer (exécution de la vente).</li>
          <li>Encaisser le paiement et, si besoin, vous rembourser.</li>
          <li>Vous permettre de suivre vos commandes et de retrouver votre historique.</li>
          <li>Vérifier votre identité avant votre première commande, pour lutter contre les fausses commandes (intérêt légitime et sécurité des transactions).</li>
          <li>Tenir notre comptabilité (obligation légale).</li>
          <li>Protéger le site contre la fraude et les intrusions (intérêt légitime).</li>
        </ul>
        <p>Nous ne vous envoyons pas de publicité sans votre accord.</p>

        <h2>Qui peut les voir ?</h2>
        <ul>
          <li>Les membres de l'équipe Kamwa qui en ont besoin pour leur travail (préparation, livraison, service client).</li>
          <li>L'opérateur Mobile Money (MTN ou Airtel) ou le prestataire de paiement par carte, pour le paiement.</li>
          <li>Le livreur, pour vous remettre votre colis.</li>
          <li>Notre hébergeur, qui stocke techniquement le site.</li>
        </ul>
        <p>Nos fournisseurs ne reçoivent jamais vos coordonnées : Kamwa s'occupe de la livraison.</p>

        <h2>Combien de temps nous les gardons</h2>
        <ul>
          <li>Commandes et factures : ${T('durée, ex. 10 ans pour les pièces comptables')}.</li>
          <li>Compte client : tant qu'il est actif, puis ${T('durée')} après la dernière connexion ou commande.</li>
          <li>Photo de la pièce d'identité : ${T('durée, ex. tant que le compte est actif ; supprimée à la fermeture du compte')}. Une photo refusée est supprimée dès que vous en envoyez une nouvelle.</li>
          <li>Données de sécurité (tentatives de connexion) : 15 minutes maximum.</li>
        </ul>

        <h2>Sécurité</h2>
        <p>Les codes et mots de passe sont enregistrés sous forme chiffrée. Les échanges avec le site sont chiffrés (HTTPS).
        L'accès à l'espace de gestion est réservé à des personnes identifiées, et chaque action y est enregistrée.</p>

        <h2>Vos droits</h2>
        <p>Vous pouvez demander à consulter, corriger ou supprimer vos données, ou vous opposer à leur utilisation, en nous contactant ${CONTACT}.
        Nous répondons dans un délai d'un mois. Les données liées à une vente peuvent être conservées pour nos obligations comptables.</p>

        <h2>Cookies</h2>
        <p>Le site utilise uniquement des cookies indispensables à son fonctionnement (panier, connexion, commande en cours). Vous pouvez
        consulter la liste complète et faire vos choix sur la page <a href="#/cookies">Gérer les cookies</a>.</p>

        <h2>Modifications</h2>
        <p>Cette politique peut évoluer. La date de dernière mise à jour figure en haut de la page.</p>`,
    },

    conditions: {
      title: "Conditions d'utilisation",
      updated,
      html: `
        <p>Ces conditions s'appliquent à toute personne qui utilise le site Kamwa. En naviguant sur le site, vous les acceptez.</p>

        <h2>1. Accès au site</h2>
        <p>Le site est accessible gratuitement, 24 h/24, sauf interruption pour maintenance ou panne. Kamwa fait de son mieux pour qu'il fonctionne
        correctement mais ne peut pas garantir l'absence totale d'erreur ou d'interruption.</p>

        <h2>2. Compte client</h2>
        <p>La création d'un compte est gratuite. <strong>Un compte est nécessaire pour commander</strong> : à sa création, vous fournissez la photo
        de votre pièce d'identité (passeport, carte nationale d'identité ou NIU). Kamwa la vérifie avant votre première commande ; si elle est refusée
        (photo illisible, nom différent, pièce expirée…), le motif vous est indiqué et vous pouvez en envoyer une nouvelle. Fournir une fausse pièce
        ou la pièce d'une autre personne entraîne la fermeture du compte. Votre compte est protégé par votre identifiant
        (numéro de téléphone ou e-mail) et un code Kamwa à 6 chiffres qui vous est attribué. Gardez ce code secret : toute action faite avec
        votre identifiant et votre code est réputée faite par vous. En cas d'oubli, contactez le service client qui vous en donnera un nouveau
        après vérification.</p>

        <h2>3. Ce qui est interdit</h2>
        <ul>
          <li>Donner de fausses informations ou commander au nom d'une autre personne sans son accord.</li>
          <li>Tenter d'accéder aux comptes d'autres clients ou à l'espace de gestion de Kamwa.</li>
          <li>Perturber le fonctionnement du site (envoi massif de requêtes, logiciels malveillants…).</li>
          <li>Copier le contenu du site pour un usage commercial.</li>
        </ul>
        <p>Kamwa peut suspendre l'accès d'une personne qui ne respecte pas ces règles.</p>

        <h2>4. Informations sur les produits</h2>
        <p>Nous décrivons les produits avec soin. Les photos sont des illustrations : la couleur ou les accessoires peuvent légèrement différer.
        En cas d'erreur manifeste de prix (par exemple un prix anormalement bas), Kamwa vous contactera et pourra annuler la commande avec remboursement complet.</p>

        <h2>5. Propriété intellectuelle</h2>
        <p>Voir les <a href="#/legal/mentions">mentions légales</a>.</p>

        <h2>6. Liens vers d'autres sites</h2>
        <p>Le site peut contenir des liens vers d'autres sites (par exemple la page d'un prestataire de paiement). Kamwa n'est pas responsable de leur contenu.</p>

        <h2>7. Modifications</h2>
        <p>Kamwa peut modifier ces conditions. La version applicable est celle en ligne au moment de votre visite.</p>

        <h2>8. Droit applicable</h2>
        <p>Ces conditions sont soumises au droit de la République du Congo. En cas de désaccord, nous cherchons d'abord une solution amiable ;
        à défaut, les tribunaux compétents de ${T('ville, ex. Pointe-Noire')} seront saisis.</p>`,
    },

    vente: {
      title: 'Ventes et remboursements',
      updated,
      html: `
        <p>Ces conditions générales de vente s'appliquent à toutes les commandes passées sur Kamwa.</p>

        <h2>1. Produits</h2>
        <p>Les produits proposés sont ceux affichés sur le site, dans la limite des stocks disponibles. Leur état est indiqué : neuf, reconditionné ou occasion.</p>

        <h2>2. Prix</h2>
        <p>Les prix sont indiqués en francs CFA (FCFA), ${T('« toutes taxes comprises » si la TVA s\'applique, à vérifier avec un comptable')}.
        Les éventuels frais de livraison sont affichés avant la validation de la commande. Le prix applicable est celui affiché au moment de la commande.</p>

        <h2>3. Commande</h2>
        <p>Connecté à votre compte vérifié, vous choisissez vos produits, indiquez vos coordonnées, le point relais où vous paierez et votre mode de réception
        (retrait au point relais ou livraison). Vous pouvez changer de point relais tant que le colis ne vous a pas été remis. Vos articles sont alors réservés ; la commande est confirmée à votre paiement au point relais. Un conseiller Kamwa peut vous appeler pour confirmer la livraison.</p>

        <h2>4. Paiement</h2>
        <p>Les moyens de paiement proposés sont ceux affichés au moment de la commande. ${T('aujourd\'hui : espèces au point relais uniquement — à confirmer')}.</p>
        <ul>
          <li><strong>Mobile Money (MTN MoMo, Airtel Money)</strong> : vous recevez une demande sur votre téléphone et la validez avec votre code secret.</li>
          <li><strong>Carte bancaire</strong> : vous payez sur la page sécurisée de notre prestataire de paiement.</li>
          <li><strong>Espèces au point relais</strong> : les articles vous sont réservés pendant 48 heures. Vous payez en espèces au point relais choisi sur la carte (agence Kamwa ou commerce partenaire), puis vous repartez avec votre commande ou nous vous la livrons, selon votre choix. Passé ce délai sans paiement, la réservation est annulée.</li>
          <li><strong>Paiement à la réception</strong> : vous payez à la livraison, en espèces ou en Mobile Money, après avoir vérifié votre colis. Pour une première commande, un acompte (montant indiqué au moment de commander) est demandé en Mobile Money pour la confirmer ; il est déduit du total. Il n'est plus demandé aux clients dont les livraisons précédentes se sont bien passées. <strong>Si vous refusez le colis sans motif valable</strong> (produit conforme et en bon état), l'acompte est conservé pour couvrir le déplacement du livreur. Après plusieurs colis refusés, le paiement à la réception n'est plus proposé pour votre numéro.</li>
        </ul>
        <p>Un seul paiement est demandé par commande : si vous réessayez, la demande en cours est reprise, sans double paiement.</p>

        <h2>5. Livraison et retrait</h2>
        <p>Livraison en 24 à 48 heures ouvrées à Pointe-Noire et Brazzaville, à l'adresse ou au repère indiqué. Autres villes : sur demande, délai et frais
        communiqués avant l'envoi. Frais de livraison : ${T('montant par ville')}. Vous pouvez suivre votre commande dans « Mon compte ».</p>
        <p><strong>Code de livraison</strong> : à la commande, vous recevez un code à 4 chiffres (visible dans « Mon compte » et sur la page de suivi). Donnez-le au livreur <strong>seulement quand vous avez votre colis en main</strong> : c'est votre preuve de réception. Ne le communiquez à personne d'autre, même au téléphone.</p>
        <p>À la réception, vérifiez l'état du colis devant le livreur et signalez tout problème (colis abîmé, article manquant) dans les ${T('délai, ex. 48 heures')}.</p>

        <h2 id="retours">6. Retours</h2>
        <p>Vous pouvez retourner un produit dans un délai de ${T('nombre de jours, ex. 7 jours')} après sa réception, s'il est dans son état d'origine,
        complet, avec son emballage et ses accessoires. ${T('qui paie le retour : Kamwa ou le client')}.</p>
        <p>Ne peuvent pas être retournés : ${T('liste, ex. écouteurs déballés pour raison d\'hygiène, produits personnalisés')}.</p>
        <p>Pour demander un retour, contactez-nous ${CONTACT}, avec votre numéro de commande.</p>

        <h2 id="remboursements">7. Remboursements</h2>
        <ul>
          <li><strong>Commande annulée avant l'envoi</strong> : remboursement intégral.</li>
          <li><strong>Retour accepté</strong> : remboursement du prix du produit après vérification de son état, ${T('frais de livraison inclus ou non')}.</li>
          <li><strong>Paiement reçu après l'annulation d'une commande</strong> : remboursement intégral.</li>
        </ul>
        <p>Le remboursement est fait avec le même moyen de paiement : sur votre numéro Mobile Money, sur votre carte via notre prestataire de paiement,
        ou en espèces à l'agence. Délai : ${T('nombre de jours, ex. 7 jours ouvrés')} après acceptation.</p>

        <h2>8. Garantie</h2>
        <p>Les produits neufs bénéficient de la garantie légale contre les défauts cachés et, le cas échéant, de la garantie du fabricant.
        Produits reconditionnés et d'occasion : garantie Kamwa de ${T('durée, ex. 3 mois')}. La garantie ne couvre pas la casse, l'oxydation ou une mauvaise utilisation.</p>

        <h2 id="france">9. Achats en Europe</h2>
        <p>Les produits marqués « Venu d’Europe » sont achetés en Europe pour vous après votre commande, puis expédiés par avion et livrés au Congo.</p>
        <ul>
          <li><strong>Prix</strong> : <strong>tout compris</strong> (article, transport en avion, douane, service Kamwa, livraison) : aucun supplément ne vous sera demandé à l'arrivée.</li>
          <li><strong>Paiement</strong> : la commande se paie en entier avant l'achat (au point relais), car Kamwa achète l'article pour vous. Si votre panier contient aussi des articles de notre stock, toute la commande vous est livrée en une fois.</li>
          <li><strong>Délai</strong> : indicatif, annoncé dans le devis. Vous suivez chaque étape (achat, photos de l'article à sa réception, départ, arrivée).</li>
          <li><strong>Annulation</strong> : possible tant que l'article n'est pas acheté (remboursement intégral). Après l'achat, l'annulation n'est plus possible.</li>
          <li><strong>Retours</strong> : un article non conforme au devis ou abîmé pendant le transport est remplacé ou remboursé. ${T('conditions de retour pour un article conforme qui ne convient pas')}.</li>
          <li><strong>Articles exclus</strong> : produits interdits au transport (dangereux, inflammables, certaines batteries seules…), contrefaçons, produits réglementés. Nous vous le signalons dans le devis.</li>
        </ul>

        <h2>10. Service client</h2>
        <p>Pour toute question ou réclamation : ${CONTACT}. Nous cherchons toujours d'abord une solution amiable. Voir aussi les
        <a href="#/legal/conditions">conditions d'utilisation</a> (droit applicable).</p>`,
    },
  };
})();
