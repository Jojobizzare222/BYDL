# Faire connaître Zado à Google — guide pas à pas pour Joseph

Le site est maintenant préparé pour Google (17/11/2026). Pour que Google le trouve vite, il reste 4 démarches que
**seul vous** pouvez faire, parce qu'elles passent par vos comptes. Comptez environ 30 minutes en tout.

## Ce qui a été fait sur le site

- **Une vraie page par rayon**, lisible par Google : `zado-congo.com/rayon/telephones`, `/rayon/jeux-video-et-consoles`,
  `/rayon/chaussures`… avec un titre du type « iPhone et smartphones à Pointe-Noire », la liste des articles et leurs prix
  tout compris, et les questions fréquentes (livraison, paiement).
- **Une page par marque** (Apple, Samsung, Sony, Nike…) et par sélection (reconditionné, petits prix, idées cadeaux,
  précommandes).
- **Chaque article a sa propre adresse avec son nom**, par exemple `zado-congo.com/p/gv021/grand-theft-auto-vi`.
  Google y lit le prix en FCFA, l'état (neuf ou reconditionné), la livraison au Congo et les retours sous 7 jours.
- **L'accueil est mieux présenté** : « Zado — Boutique en ligne à Pointe-Noire : iPhone, PS5, TV, mode », avec une fiche
  d'entreprise (boutique en ligne, Pointe-Noire, Congo).
- **Le plan du site** (`zado-congo.com/sitemap.xml`) liste toutes ces pages, avec les photos des articles.
- **Une seule adresse** : `www.zado-congo.com` renvoie maintenant vers `zado-congo.com`, sinon Google voit le site en double.

Les visiteurs humains qui arrivent depuis Google sont envoyés directement dans la boutique, sur le bon rayon ou le bon
article.

## Les 4 démarches à faire

### 1. Google Search Console : la plus importante

C'est l'outil gratuit de Google pour lui présenter le site et suivre les recherches qui y mènent.

1. Allez sur **search.google.com/search-console** et connectez-vous avec le compte Google de Zado.
2. Cliquez sur **Ajouter une propriété**, puis choisissez **Domaine** et tapez `zado-congo.com`.
3. Google affiche une ligne qui commence par `google-site-verification=…`. **Copiez-la.**
4. Dans votre espace **OVH** → Noms de domaine → `zado-congo.com` → **Zone DNS** → **Ajouter une entrée** → type **TXT**.
   Laissez le sous-domaine vide, collez la ligne copiée, puis validez.
5. Revenez sur Search Console et cliquez sur **Valider**. Si ça ne marche pas tout de suite, réessayez 1 heure plus tard.
6. Une fois validé, ouvrez le menu **Sitemaps**, tapez `sitemap.xml` et cliquez sur **Envoyer**.

*Autre méthode, sans toucher à OVH* : choisissez « Préfixe d'URL », puis « Balise HTML ». Envoyez-moi le code et je le
règle sur le serveur.

### 2. Bing (et donc aussi Yahoo et DuckDuckGo)

1. Allez sur **bing.com/webmasters** et connectez-vous.
2. Choisissez **Importer depuis Google Search Console** : tout est repris en un clic, plan du site compris.

### 3. Fiche Google (Google Business Profile) : apparaître sur Google Maps

1. Allez sur **business.google.com** et créez la fiche **Zado**.
2. Catégorie : « Boutique en ligne » ou « Magasin d'électronique ».
3. Zone desservie : Pointe-Noire. Si vous n'avez pas encore de boutique physique, vous pouvez masquer l'adresse.
4. Ajoutez le site `https://zado-congo.com`, un numéro WhatsApp, le logo et quelques photos.
5. Google vous enverra un code de vérification : suivez ses instructions.

C'est ce qui fait apparaître Zado quand quelqu'un cherche « boutique téléphone Pointe-Noire » sur Google ou sur Maps.

### 4. Faire parler de Zado (liens)

Google fait davantage confiance à un site dont on parle ailleurs. Mettez le lien `https://zado-congo.com` :
- sur la page Facebook, le compte Instagram et le profil TikTok de Zado ;
- dans le statut et le catalogue WhatsApp Business ;
- dans les annuaires d'entreprises du Congo et les groupes de petites annonces de Pointe-Noire ;
- dans les articles ou interviews, si un média local parle de vous.

## Ce qu'il faut savoir

- **Patience** : Google met en général **2 à 8 semaines** pour bien classer un nouveau site. Search Console vous montrera
  les recherches qui vous amènent des visiteurs.
- **Les photos comptent** : un article avec une vraie photo apparaît aussi dans Google Images. Les ~800 articles encore
  sans photo sont moins bien mis en avant.
- **Les avis clients comptent** : dès que les clients laisseront des avis, les étoiles pourront apparaître sous vos
  articles dans Google.
