// Fiches détaillées du catalogue de départ (21/10/2026) : points forts, réparabilité, vidéo d'analyse, prix en France.
// Relancer : node scripts/fiches-detaillees.js  → met à jour data/products.json (les bases existantes sont complétées
// une seule fois au démarrage du serveur : settings « migr:fiches-v1 », src/server.js).
// Sources vérifiées le 21/10/2026 :
//  - réparabilité France : fiches officielles d'Apple (support.apple.com/fr-fr/circular-economy-repairability-indices) ;
//    gamme iPhone 15 : note iFixit relevée à 7/10 en octobre 2024 (Apple ne publie plus d'indice français pour ces modèles) ;
//  - vidéos : vérifiées une par une auprès de YouTube (titre et chaîne exacts) ;
//  - prix : pages de l'Apple Store France encore en vente (relevés automatiques ensuite chaque jour, src/price-watch.js).
// Les points forts reprennent les caractéristiques publiées par Apple (autonomies : chiffres constructeur).
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'products.json');
const DATE = '2026-10-21';

const PDF = (f) => `https://support.apple.com/content/dam/edam/applecare/images/fr_FR/otherassets/compliance/pdf/${f}.pdf`;
const fr = (value, file, note) => ({ kind: 'fr', value, url: PDF(file), note: note || 'Indice officiel déclaré par Apple pour la France' });
const IFIXIT15 = { kind: 'ifixit', value: '7', url: 'https://iphonesoft.fr/2024/10/10/ifixit-augmente-fortement-score-reparabilite-iphone-15', note: 'Note relevée par iFixit en octobre 2024 (de 4 à 7/10) grâce à l\'outil de réparation d\'Apple' };
const yt = (id, title, channel) => ({ url: `https://www.youtube.com/watch?v=${id}`, id, title, channel });
const AS = (code, slug) => `https://www.apple.com/fr/shop/product/${code}/${slug}`;
const apple = (url, priceEur) => [{ store: 'Apple Store', priceEur, url, date: DATE, status: 'ok', auto: true, checkedAt: `${DATE}T15:30:00.000Z`, history: [{ date: DATE, priceEur }] }];

// [motif du nom, fiche]
const FAMILIES = [
  [/^Apple iPhone 15 Pro Max/, {
    highlights: ['Cadre en titane, plus léger que l\'acier', 'Puce A17 Pro : jeux de qualité console et Apple Intelligence', 'Téléobjectif 5x et appareil photo principal 48 Mpx', 'Écran 6,7 pouces ProMotion 120 Hz, toujours activé', 'Bouton Action personnalisable', 'Port USB-C rapide (USB 3, jusqu\'à 10 Gb/s)', 'Jusqu\'à 29 h de lecture vidéo (donnée Apple)'],
    repair: IFIXIT15, video: yt('F4Faktx9ZPk', 'Test de l\'iPhone 15 Pro MAX - Le plus titanesque des smartphones', 'Les Numériques') }],
  [/^Apple iPhone 15 Pro/, {
    highlights: ['Cadre en titane, plus léger que l\'acier', 'Puce A17 Pro : jeux de qualité console et Apple Intelligence', 'Téléobjectif 3x et appareil photo principal 48 Mpx', 'Écran 6,1 pouces ProMotion 120 Hz, toujours activé', 'Bouton Action personnalisable', 'Port USB-C rapide (USB 3, jusqu\'à 10 Gb/s)', 'Jusqu\'à 23 h de lecture vidéo (donnée Apple)'],
    repair: IFIXIT15, video: yt('QetI5H0C-dQ', 'Test iPhone 15 Pro un mois après : que vaut-il VRAIMENT ?', 'Presse-citron') }],
  [/^Apple iPhone 15 Plus/, {
    highlights: ['Grand écran 6,7 pouces avec Dynamic Island', 'Très grande autonomie : jusqu\'à 26 h de lecture vidéo (donnée Apple)', 'Appareil photo principal 48 Mpx, zoom 2x de qualité optique', 'Puce A16 Bionic', 'Port USB-C', 'Résistant à l\'eau et à la poussière (IP68)'],
    repair: IFIXIT15, video: yt('Vh5-51hwLMk', 'iPhone 15 Plus - Un VRAI BON PLAN ?', 'Monsieur GRrr') }],
  [/^Apple iPhone 15 /, {
    highlights: ['Dynamic Island et écran 6,1 pouces très lumineux (jusqu\'à 2 000 nits en extérieur)', 'Appareil photo principal 48 Mpx, zoom 2x de qualité optique', 'Puce A16 Bionic', 'Port USB-C : le même câble que les Mac et iPad récents', 'Dos en verre teinté dans la masse, cadre en aluminium', 'Résistant à l\'eau et à la poussière (IP68)', 'Jusqu\'à 20 h de lecture vidéo (donnée Apple)'],
    repair: IFIXIT15, video: yt('qaUFa3ZY2fo', 'Test iPhone 15 : ceci n\'est pas une révolution', 'Les Numériques') }],
  [/^Apple iPhone 14/, {
    highlights: ['Écran OLED 6,1 pouces Super Retina XDR', 'Puce A15 Bionic à 5 cœurs graphiques', 'Appareil photo 12 Mpx amélioré en basse lumière, mode Action pour des vidéos stables', 'Détection des accidents', 'Résistant à l\'eau et à la poussière (IP68)', 'Jusqu\'à 20 h de lecture vidéo (donnée Apple)'],
    repair: fr('6.9', '220824-indice-de-reparabilite-a2882'), video: yt('Y9NTI-6S14Y', 'iPhone 14 et iPhone 14 Plus : LE TEST COMPLET', 'Mac4Ever') }],
  [/^Apple iPhone 13/, {
    highlights: ['Écran OLED 6,1 pouces Super Retina XDR', 'Puce A15 Bionic : encore très rapide', 'Double appareil photo 12 Mpx avec mode Cinématique', 'Face avant Ceramic Shield', 'Résistant à l\'eau et à la poussière (IP68)', 'Jusqu\'à 19 h de lecture vidéo (donnée Apple)'],
    repair: fr('6.4', '220221-indice-de-reparabilite-a2633'), video: yt('HETEwXESyx8', 'Test iPhone 13 : notre verdict sur toute la gamme', 'Les Numériques') }],
  [/^Apple iPhone SE/, {
    highlights: ['Le plus compact et le plus abordable des iPhone', 'Puce A15 Bionic, la même que l\'iPhone 13', '5G', 'Bouton principal avec Touch ID', 'Résistant aux éclaboussures et à la poussière (IP67)'],
    repair: fr('6.4', '220221-indice-de-reparabilite-a2783'), video: yt('Gh3CptvXLbM', 'TEST iPhone SE (3eme génération) : Un bon achat ?', 'STEVEN') }],
  [/iPad 10,9/, {
    highlights: ['Écran Liquid Retina 10,9 pouces', 'Puce A14 Bionic', 'Port USB-C', 'Caméra avant 12 Mpx placée sur le côté long : idéale en visio', 'Touch ID dans le bouton du haut', 'Jusqu\'à 10 h d\'autonomie (donnée Apple)'],
    video: yt('kXizU509CvU', 'Test iPad 10 (2022) : Pour qui et pour quoi ?', 'TheiMika') }],
  [/iPad Air 11" M2/, {
    highlights: ['Puce M2 : la puissance d\'un ordinateur', 'Écran Liquid Retina 11 pouces', 'Compatible Apple Pencil Pro et Magic Keyboard', 'Caméra avant sur le côté long, pour la visio', 'Touch ID, Wi-Fi 6E', 'Compatible Apple Intelligence'],
    video: yt('nfrk4U5Xncw', 'Test iPad Air M2 - Il n\'a d\'Air que son nom', 'TheiCollection') }],
  [/iPad Pro/, {
    highlights: ['Écran Ultra Retina XDR OLED « tandem » : contraste et luminosité exceptionnels', 'Puce M4', 'Extrêmement fin : 5,3 mm (11 pouces) et 5,1 mm (13 pouces)', 'Face ID et port Thunderbolt / USB 4', 'Compatible Apple Pencil Pro et Magic Keyboard', 'Compatible Apple Intelligence'],
    video: yt('22ePTW2p3jo', 'Test iPad Pro 13 pouces (M4 2024) : votre prochain ordinateur ?', 'TheiMika') }],
  [/iPad mini/, {
    highlights: ['Format 8,3 pouces qui tient dans une main', 'Puce A17 Pro', 'Compatible Apple Pencil Pro', 'Compatible Apple Intelligence', 'Port USB-C et Touch ID'] }],
  [/MacBook Air 13" M2/, {
    highlights: ['Fin (11,3 mm) et léger (1,24 kg)', 'Puce M2, sans ventilateur : totalement silencieux', 'Écran Liquid Retina 13,6 pouces', 'Recharge MagSafe + 2 ports Thunderbolt', 'Jusqu\'à 18 h d\'autonomie (donnée Apple)', 'Caméra 1080p, quatre haut-parleurs'],
    repair: fr('6.6', '220830-indice-de-reparabilite-a2681'), video: yt('6VCd3Wg1FLw', 'ATTENTION avant de craquer ! Test du MacBook Air M2 (& nos conseils)', 'Frandroid') }],
  [/MacBook Air 15" M3/, {
    highlights: ['Grand écran Liquid Retina 15,3 pouces dans un portable fin', 'Puce M3, sans ventilateur : totalement silencieux', '16 Go de mémoire : prêt pour Apple Intelligence', 'Six haut-parleurs', 'Deux écrans externes possibles (écran du Mac fermé)', 'Jusqu\'à 18 h d\'autonomie (donnée Apple)'],
    video: yt('OVLx2GQtgcM', 'Macbook Air M3 - Que VAUT-IL ? Mon TEST complet !', 'Nowa') }],
  [/MacBook Air 13" M3/, {
    highlights: ['Puce M3, sans ventilateur : totalement silencieux', '16 Go de mémoire : prêt pour Apple Intelligence', 'Écran Liquid Retina 13,6 pouces', 'Deux écrans externes possibles (écran du Mac fermé)', 'Wi-Fi 6E, recharge MagSafe', 'Jusqu\'à 18 h d\'autonomie (donnée Apple)'],
    video: yt('xIZnyp6uJkA', 'Macbook Air M3 (13 pouces) : test et présentation du dernier né d\'Apple', 'JVTECH') }],
  [/MacBook Pro 1[46]" M3 Max/, {
    highlights: ['Puce M3 Max : pour la vidéo 8K, la 3D et les gros calculs', 'Écran Liquid Retina XDR (jusqu\'à 1 600 nits en HDR)', 'Ports HDMI, carte SD, MagSafe et Thunderbolt 4', 'Six haut-parleurs et micros de qualité studio', 'Ventilation active pour les longs travaux'],
    video: yt('XAyXUO9hqmY', 'Test du MacBook Pro 14 M3 Max, le meilleur pc portable d\'Apple.', 'Les Numériques') }],
  [/MacBook Pro 1[46]" M3 Pro/, {
    highlights: ['Puce M3 Pro et 18 Go de mémoire : montage vidéo, photo, développement', 'Écran Liquid Retina XDR (jusqu\'à 1 600 nits en HDR)', 'Ports HDMI, carte SD, MagSafe et Thunderbolt 4', 'Six haut-parleurs et micros de qualité studio', 'Très grande autonomie (jusqu\'à 18 h en 14 pouces, 22 h en 16 pouces, données Apple)'],
    video: yt('J8ySxDwAVBU', 'Macbook Pro M3 Pro - Un monstre de puissance ! Mon TEST complet', 'Nowa') }],
  [/MacBook Pro 14" M3 /, {
    highlights: ['Puce M3 avec ventilateur : performances qui tiennent dans la durée', 'Écran Liquid Retina XDR 14,2 pouces (jusqu\'à 1 600 nits en HDR)', 'Ports HDMI, carte SD et MagSafe', 'Six haut-parleurs', 'Jusqu\'à 22 h d\'autonomie (donnée Apple)'],
    video: yt('oUfGdd1mG1A', 'Macbook Pro M3 - très surpris', 'bazze tv') }],
  [/iMac 24"/, {
    highlights: ['Écran Retina 4,5K de 24 pouces', 'Tout-en-un de 11,5 mm d\'épaisseur', 'Puce M3', 'Caméra 1080p, trois micros et six haut-parleurs', 'Clavier et souris assortis fournis'],
    video: yt('tJUsZoamcB0', 'Test iMac M3 - Basique, Simple et Efficace !', 'TheiCollection') }],
  [/Mac mini M2 Pro/, {
    highlights: ['Puce M2 Pro dans un boîtier de 19,7 cm de côté', 'Quatre ports Thunderbolt 4, HDMI, Ethernet', 'Plusieurs écrans externes', 'Silencieux au quotidien'],
    video: yt('3GHMElRvkHM', 'Test Mac mini M2 Pro - Juste parfait !', 'TheiCollection') }],
  [/Mac mini M2 /, {
    highlights: ['Le Mac le plus abordable', 'Puce M2 dans un boîtier de 19,7 cm de côté', 'Ports Thunderbolt 4, HDMI, USB-A et Ethernet', 'Wi-Fi 6E, silencieux au quotidien', 'Se branche sur votre écran, clavier et souris'],
    video: yt('CvjxwuHcxPU', 'TEST du MAC MINI M2, que vaut réellement le moins cher de tous les Mac ?', 'FRED') }],
  [/Mac Studio/, {
    highlights: ['Puissance de station de travail dans un boîtier compact', 'Nombreux ports : Thunderbolt 4, HDMI, lecteur SD, Ethernet 10 Gb', 'Plusieurs écrans externes', 'Refroidissement efficace et silencieux'] }],
  [/Watch SE/, {
    highlights: ['L\'Apple Watch la plus abordable', 'Suivi de l\'activité, du sport et du sommeil', 'Détection des chutes et des accidents', 'Étanche jusqu\'à 50 m', 'Notifications et appels depuis le poignet (avec un iPhone)'],
    video: yt('Vpa3_mCoTvY', 'Test Apple Watch SE 2 - Toujours excellente !', 'TheiCollection') }],
  [/Watch Series 9/, {
    highlights: ['Puce S9 et geste « Toucher deux fois »', 'Écran très lumineux (jusqu\'à 2 000 nits)', 'Applications ECG et oxygène sanguin', 'Détection des chutes et des accidents', 'Étanche jusqu\'à 50 m'],
    video: yt('GCLi0JjqwVA', 'Apple Watch Series 9 : EXCELLENTE mais pas pour tout le monde', 'GeekEtc') }],
  [/Watch Ultra 2/, {
    highlights: ['Boîtier en titane de 49 mm, verre saphir', 'Écran le plus lumineux d\'Apple (jusqu\'à 3 000 nits)', 'Jusqu\'à 36 h d\'autonomie, 72 h en mode économie (données Apple)', 'GPS double fréquence très précis', 'Étanche 100 m, plongée loisir jusqu\'à 40 m', 'Bouton Action et sirène de 86 dB'],
    video: yt('FhDMaOpoJKE', 'Test Apple Watch Ultra 2 - Mieux, et moins chère !', 'TheiCollection') }],
  [/AirPods Pro/, {
    highlights: ['Réduction active du bruit jusqu\'à 2 fois plus efficace que la 1re génération', 'Mode Transparence adaptative', 'Audio spatial personnalisé', 'Boîtier USB-C avec haut-parleur pour le retrouver (Localiser)', 'Résistants à la poussière, à la sueur et à l\'eau (IP54)', 'Jusqu\'à 6 h d\'écoute, 30 h avec le boîtier (données Apple)'],
    video: yt('1LS7u848qAo', 'AirPods Pro 2 : LE TEST COMPLET', 'Mac4Ever') }],
  [/AirPods Max/, {
    highlights: ['Casque à réduction active du bruit', 'Audio spatial avec suivi des mouvements de la tête', 'Coussinets en mousse à mémoire de forme, arceau en maille', 'Digital Crown pour le volume', 'Jusqu\'à 20 h d\'autonomie (donnée Apple)'],
    video: yt('kVZwXIOs80g', 'Test AirPods Max - Une exception', 'TheiCollection') }],
  [/AirPods \(3/, {
    highlights: ['Audio spatial avec suivi des mouvements de la tête', 'Égaliseur adaptatif', 'Résistants à la sueur et à l\'eau (IPX4)', 'Jusqu\'à 6 h d\'écoute, 30 h avec le boîtier (données Apple)'],
    video: yt('8qBFaCNRXLY', 'AirPods 3 : Les PIRES et MEILLEURS Écouteurs d\'Apple !', 'Frandroid') }],
  [/AirPods \(2/, {
    highlights: ['Les AirPods les plus abordables', 'Connexion instantanée à l\'iPhone', 'Jusqu\'à 5 h d\'écoute, plus de 24 h avec le boîtier (données Apple)', '« Dis Siri » sans les mains'] }],
  [/Apple TV 4K/, {
    highlights: ['Films et séries en 4K HDR (Dolby Vision, HDR10+)', 'Son Dolby Atmos', 'Puce A15 Bionic : menus et jeux fluides', 'Télécommande Siri Remote rechargeable en USB-C'],
    video: yt('wHI4EmG5QLM', 'Test Apple TV 4K (2022) - Est-ce vraiment encore utile ?', 'TheiCollection') }],
  [/HomePod mini/, {
    highlights: ['Son à 360° dans une petite enceinte', 'Siri pour la musique, les minuteurs et la maison', 'Capteur de température et d\'humidité', 'Fonction Interphone entre les pièces'] }],
  [/HomePod/, {
    highlights: ['Son haute fidélité qui s\'adapte à la pièce', 'Audio spatial et Dolby Atmos', 'Capteur de température et d\'humidité', 'Deux HomePod peuvent former une paire stéréo'],
    video: yt('jfbqTgH07Bc', 'Apple HomePod 2 : la meilleure enceinte pour la musique ? (TEST et COMPARAISONS)', 'Numerama') }],
  [/Adaptateur secteur USB-C 20 W/, { highlights: ['Charge rapide de l\'iPhone (environ 50 % en 30 min, donnée Apple)', 'Compact et léger', 'Port USB-C universel'], priceRefs: apple(AS('md3j4zm', 'a/adaptateur-secteur-usb%E2%80%91c-20-w'), 19) }],
  [/Adaptateur secteur double USB-C 35 W/, { highlights: ['Charge deux appareils en même temps', '35 W au total : iPhone, iPad ou MacBook Air', 'Format compact'], priceRefs: apple(AS('mw2k3zm', 'a/adaptateur-secteur-double-port-usb-c-35-w'), 65) }],
  [/Chargeur MagSafe/, { highlights: ['Recharge sans fil magnétique : le chargeur se place tout seul', 'Compatible avec les coques MagSafe', 'Fonctionne aussi avec les AirPods à boîtier compatible'], priceRefs: apple(AS('mgd74zm', 'a/chargeur-magsafe-1-m'), 49) }],
  [/Câble USB-C 1 m/, { highlights: ['Câble tressé solide', 'Charge et transfert de données', 'Pour iPhone 15, iPad, Mac et accessoires USB-C'], priceRefs: apple(AS('mw493zm', 'a/c%C3%A2ble-de-charge-usb%E2%80%91c-60-w-1-m'), 19) }],
  [/Câble USB-C 240 W/, { highlights: ['Jusqu\'à 240 W : recharge même un MacBook Pro 16 pouces', 'Câble tressé de 2 m', 'Charge et transfert de données'], priceRefs: apple(AS('myqt3zm', 'a/c%C3%A2ble-de-charge-usb%E2%80%91c-240-w-2-m'), 35) }],
  [/Câble USB-C vers Lightning/, { highlights: ['Charge rapide des iPhone à port Lightning (avec un adaptateur USB-C)', 'Synchronisation avec un Mac ou un PC'], priceRefs: apple(AS('muq93zm', 'a/c%C3%A2ble-usb-c-vers-lightning-1-m'), 19) }],
  [/Coque en silicone iPhone 15 Bleu/, { highlights: ['Aimants MagSafe intégrés', 'Silicone doux au toucher, intérieur en microfibre', 'Conçue par Apple pour l\'iPhone 15'], priceRefs: apple(AS('mxpf3zm', 'a/coque-en-silicone-avec-magsafe-pour-iphone-15-bleu-orage'), 55) }],
  [/Coque en silicone iPhone 15 Rose/, { highlights: ['Aimants MagSafe intégrés', 'Silicone doux au toucher, intérieur en microfibre', 'Conçue par Apple pour l\'iPhone 15'], priceRefs: apple(AS('mxph3zm', 'a/coque-en-silicone-avec-magsafe-pour-iphone-15-rose-p%C3%A2le'), 55) }],
  [/Coque en silicone iPhone 15 Noir/, { highlights: ['Aimants MagSafe intégrés', 'Silicone doux au toucher, intérieur en microfibre', 'Conçue par Apple pour l\'iPhone 15'], priceRefs: apple(AS('mxpd3zm', 'a/coque-en-silicone-avec-magsafe-pour-iphone-15-noir'), 55) }],
  [/Coque transparente/, { highlights: ['Laisse voir la couleur de l\'iPhone', 'Aimants MagSafe intégrés', 'Conçue par Apple pour l\'iPhone 15 Pro'] }],
  [/Magic Keyboard pavé numérique/, { highlights: ['Clavier français AZERTY complet avec pavé numérique', 'Batterie rechargeable : environ un mois d\'utilisation', 'Se connecte tout seul au Mac'] }],
  [/Magic Keyboard AZERTY/, { highlights: ['Clavier français AZERTY, frappe silencieuse et précise', 'Batterie rechargeable : environ un mois d\'utilisation', 'Se connecte tout seul au Mac'], priceRefs: apple(AS('mxcl3f', 'a/magic-keyboard-usb-c-fran%C3%A7ais'), 119) }],
  [/Magic Mouse Blanc/, { highlights: ['Surface Multi-Touch : faire défiler et balayer du doigt', 'Batterie rechargeable', 'Se connecte tout seul au Mac'], priceRefs: apple(AS('mxk53z', 'a/magic-mouse-usb%E2%80%91c-surface-multi%E2%80%91touch-blanc'), 85) }],
  [/Magic Mouse Noir/, { highlights: ['Surface Multi-Touch : faire défiler et balayer du doigt', 'Batterie rechargeable', 'Se connecte tout seul au Mac'], priceRefs: apple(AS('mxk63z', 'a/magic-mouse-usb%E2%80%91c-surface-multi-touch-noir'), 119) }],
  [/Magic Trackpad/, { highlights: ['Grande surface en verre avec Force Touch', 'Tous les gestes Multi-Touch du Mac', 'Batterie rechargeable'], priceRefs: apple(AS('mxk93z', 'a/magic-trackpad-usb%E2%80%91c-surface-multi%E2%80%91touch-blanc'), 139) }],
  [/Pencil \(2/, { highlights: ['Se fixe et se recharge par aimant sur le côté de l\'iPad', 'Double toucher pour changer d\'outil', 'Sensible à la pression et à l\'inclinaison', 'Vérifiez la compatibilité avec votre iPad'] }],
  [/Pencil \(USB-C\)/, { highlights: ['Précision au pixel pour écrire et dessiner', 'Se fixe par aimant sur le côté de l\'iPad', 'Recharge par câble USB-C', 'Vérifiez la compatibilité avec votre iPad'] }],
  [/AirTag \(lot de 4\)/, { highlights: ['Quatre AirTag pour clés, sac, valise…', 'Localisation avec l\'app Localiser (réseau des appareils Apple à proximité)', 'Pile bouton remplaçable (environ un an)', 'Résistant à l\'eau et à la poussière (IP67)'], priceRefs: apple('https://www.apple.com/fr/shop/buy-airtag/airtag/pack-de-4', 119) }],
  [/AirTag/, { highlights: ['Retrouvez vos clés ou votre sac avec l\'app Localiser', 'Repose sur le réseau des appareils Apple à proximité', 'Pile bouton remplaçable (environ un an)', 'Résistant à l\'eau et à la poussière (IP67)'], priceRefs: apple('https://www.apple.com/fr/shop/buy-airtag/airtag', 35) }],
  [/Barrette RAM DDR4 8 Go/, { highlights: ['Plus de mémoire : plus d\'applications ouvertes sans ralentir', 'Format portable (SO-DIMM)', 'Vérifiez la compatibilité avec votre ordinateur avant l\'achat'] }],
  [/Barrette RAM DDR4 16 Go/, { highlights: ['Plus de mémoire : plus d\'applications ouvertes sans ralentir', 'Format ordinateur de bureau (DIMM)', 'Vérifiez la compatibilité avec votre ordinateur avant l\'achat'] }],
  [/Disque SSD/, { highlights: ['Démarrage et ouverture des logiciels bien plus rapides qu\'un disque dur', 'Format 2,5 pouces SATA, le plus répandu', 'Silencieux, résiste mieux aux chocs'] }],
  [/Clé USB/, { highlights: ['64 Go pour transporter photos et documents', 'Se branche sur tous les ordinateurs à port USB', 'Petite et légère'] }],
];

if (require.main === module) {
  const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  let n = 0;
  for (const p of list) {
    const fam = FAMILIES.find(([re]) => re.test(p.name));
    if (!fam) continue;
    const f = JSON.parse(JSON.stringify(fam[1]));
    Object.assign(p, f);
    n++;
  }
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
  console.log(`${n} produits complétés sur ${list.length}`);
}
module.exports = { FAMILIES };
