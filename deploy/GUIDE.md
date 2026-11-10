# Mettre la vraie boutique Zado en ligne

La démo (bydl.vercel.app) efface tout à chaque redémarrage : la **vraie** boutique doit tourner sur un serveur à vous
(un « VPS »). Comptez environ **1 heure** la première fois. Tout se fait depuis le **Terminal du Mac**.

---

## 0. Avant de commencer

1. Sur le Mac, ouvrez **GitHub Desktop** et cliquez **« Push origin »** : le serveur récupère la boutique sur GitHub,
   il lui faut la dernière version.
2. Ayez sous la main : une carte bancaire (hébergeur, domaine), l'adresse e-mail de Zado, le numéro MTN et/ou Airtel
   de Zado qui recevra les dépôts.

## 1. Louer le serveur (VPS)

Recommandé : **OVHcloud, offre « VPS-1 »** (centre de données en France, le plus proche du Congo parmi les grands
hébergeurs européens, interface et assistance en français). Environ **5 € TTC par mois** (moins cher avec un
engagement d'un an). Autre choix : Hetzner (Allemagne, prix proche).

À la commande, choisissez :
- **Système : Ubuntu 24.04**
- Localisation : **France** (Gravelines, Roubaix ou Strasbourg)

Vous recevez par e-mail : l'**adresse IP** du serveur (ex. `51.83.12.34`), l'utilisateur (`ubuntu`) et un mot de passe.

## 2. Le nom de domaine

- Le **.cg** est géré au Congo (ACNIC / ARPCE, nic.cg). Chez les revendeurs étrangers il coûte **300 à 800 € par an**.
  Renseignez-vous d'abord **sur place auprès de l'ARPCE** : en tant que Congolais, l'enregistrement peut être beaucoup
  moins cher (voire gratuit pour un premier nom).
- Une fois le domaine acheté, dans sa zone DNS, créez **deux enregistrements de type A** :
  - `@` (zado.cg) → l'adresse IP du serveur
  - `www` → la même adresse IP

  La prise en compte peut prendre de quelques minutes à quelques heures.

## 3. Installer la boutique (une seule commande)

Dans le Terminal du Mac (remplacez l'adresse IP par la vôtre) :

```bash
ssh ubuntu@51.83.12.34
```

Tapez le mot de passe reçu (rien ne s'affiche pendant la saisie, c'est normal). Puis, **sur le serveur** :

```bash
curl -fsSL https://raw.githubusercontent.com/Jojobizzare222/BYDL/main/deploy/installer.sh -o installer.sh
sudo bash installer.sh zado.cg contact@zado.cg
```

(remplacez `zado.cg` par votre domaine et l'e-mail par le vôtre). Le script installe tout : Node.js, la boutique, le
redémarrage automatique, le HTTPS gratuit, le pare-feu, les mises à jour de sécurité et **une sauvegarde chaque nuit**.
Si le domaine ne pointe pas encore vers le serveur, il vous dira quelle commande relancer plus tard pour le HTTPS.

## 4. Les trois réglages obligatoires

**a) Le mot de passe de Zado Pro** (sur le serveur) :

```bash
sudo -u zado bash -c 'cd /srv/zado/app && npm run admin:password'
```

**b) Dans Zado Pro** (https://zado.cg/admin) → Réglages :
- **Société — factures et reçus** : forme juridique, RCCM, NIU, adresse, téléphone (obligatoire sur les factures).
- **Transport, délais et acompte** : le **numéro MTN et/ou Airtel de Zado** qui reçoit les dépôts.
- **Frais de livraison** : vos montants (0 FCFA par défaut = livraison offerte).
- **Catalogue** : vérifiez chaque **prix de vente**, prix fournisseur et poids (ceux de départ sont des estimations).

**c) Le contrôle avant ouverture** (sur le serveur) :

```bash
sudo -u zado bash -c 'cd /srv/zado/app && npm run verifier'
```

Il liste ce qui est **BLOQUANT** (à régler avant d'ouvrir), **À VOIR** et **OK**.

### Paiement à l'ouverture

Tant que vos **comptes marchands MTN MoMo / Airtel Money** ne sont pas ouverts, la boutique ne propose que le
**paiement par dépôt** : le client envoie l'acompte (500 FCFA) puis le reste sur le numéro de Zado, avec le numéro de
commande en référence ; votre équipe clique **« Dépôt reçu »** dans Zado Pro quand l'argent est arrivé. Rien n'est
jamais validé tout seul. Quand vous aurez vos comptes marchands, ajoutez leurs clés dans `.env` (voir plus bas) : la
demande directe sur le téléphone du client s'ajoutera automatiquement.

## 5. Mettre à jour la boutique

Après chaque changement : **« Push origin »** sur le Mac, puis sur le serveur :

```bash
sudo /srv/zado/app/deploy/mettre-a-jour.sh
```

Une sauvegarde est faite avant ; si la nouvelle version ne démarre pas, l'ancienne est remise automatiquement.

## 6. Sauvegardes

- Chaque nuit à 2 h : base, photos, pièces d'identité, clé de chiffrement → `/srv/zado/sauvegardes` (14 jours gardés).
- **Une fois par semaine, rapatriez la dernière sur le Mac** (si le serveur disparaît, c'est votre seule copie) :

```bash
ssh ubuntu@51.83.12.34 'sudo /srv/zado/app/deploy/preparer-telechargement.sh'
```

```bash
scp ubuntu@51.83.12.34:derniere-sauvegarde.tar.gz ~/Documents/zado-sauvegarde.tar.gz
```

  Ces fichiers contiennent des données personnelles de clients (pièces d'identité) : gardez-les dans un dossier
  privé, jamais sur GitHub ni dans un e-mail.

## 7. Modifier les réglages secrets (.env)

E-mail d'alerte, comptes marchands MTN / Airtel, Google / Apple :

```bash
sudo -u zado nano /srv/zado/app/.env
sudo systemctl restart zado
```

(dans nano : modifiez, puis **Ctrl + O**, **Entrée**, **Ctrl + X**).

## En cas de problème

| Je veux… | Commande sur le serveur |
|---|---|
| Voir si la boutique tourne | `systemctl status zado` |
| Voir les derniers messages / erreurs | `sudo journalctl -u zado -n 50` |
| Redémarrer la boutique | `sudo systemctl restart zado` |
| Lancer une sauvegarde tout de suite | `sudo -u zado /srv/zado/app/deploy/sauvegarde.sh` |
