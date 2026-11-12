// « Pour aller avec » (demande Joseph 12/11/2026 : « renforce le nombre d'articles » par commande).
// Algorithme sans serveur ni IA, calculé dans le navigateur (aussi utilisé par les tests Node) : pour un article
// regardé ou les articles du panier, il propose les COMPLÉMENTS utiles (manette et jeux pour une console, coque et
// chargeur pour un téléphone, carte mémoire et trépied pour un appareil photo…).
//
// Note de chaque article candidat (en stock, pas déjà dans le panier) :
//   1) complément (jusqu'à 1) : le TYPE de l'article (déduit du nom : manette, jeu, coque, souris…) figure dans la
//      liste des compléments du type de l'article de départ ; le 1er de la liste vaut 1, le suivant un peu moins ;
//   2) achetés ensemble (jusqu'à 0,8) : nombre de commandes où les deux articles ont été achetés ensemble
//      (/api/products/pairs : chiffres seulement, à partir de 2 commandes) ; prend le relais dès qu'il y a des ventes ;
//   3) petit plus (0,15) : un complément moins cher que l'article de départ passe mieux ;
//   4) avis clients (0,1) ;
//   garde-fous : plateforme incompatible écartée (jeu Switch pour une PS5, coque iPhone pour un Samsung…), un seul
//   article par type et par modèle (couleurs regroupées), jamais un article épuisé ou déjà dans le panier.
// Honnête par construction : aucune fausse rareté, aucun faux compte à rebours, rien d'ajouté au panier sans un clic.
(function (root) {
  const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Type d'un article d'après son nom. L'ORDRE compte : les accessoires d'abord (« support téléphone voiture » est un
  // support, pas un téléphone ; « jeu PS5 » est un jeu, pas une console ; « chargeur pour Joy-Con » est un chargeur).
  const TYPES = [
    ['coque', /\bcoques?\b|verre trempe|protege-ecran/],
    ['support-voiture', /support.*(voiture|pare-brise)|voiture.*support/],
    ['support', /\bsupport\b|playstand/],
    ['batterie', /batterie externe|power ?bank/],
    ['chargeur', /chargeur|\brecharge\b|station de charge|induction|adaptateur secteur|hub usb|station hub/],
    ['cable', /^cables?\b|\bcables? (usb|lightning|hdmi|jack|audio|de charge)/],
    ['carte-sd', /carte (micro ?)?sd|micro ?sd/],
    ['cle-usb', /\bcle usb\b|\bcles usb\b/],
    ['trepied', /trepied|perche a selfie|ring light|stabilisateur/],
    ['sacoche', /sacoche|housse|\bsac\b|etui de transport/],
    ['jeu', /\bjeu (ps[45]|playstation|nintendo|switch|xbox|pc)\b|- jeu\b|• jeu\b/],
    ['manette', /manette|joy-?con|volant|joystick/],
    ['casque-gamer', /casque.*(gaming|gamer)|(gaming|gamer).*casque|casque.*(ps[45]|xbox)/],
    ['casque', /\bcasque\b/],
    ['tapis', /tapis de souris/],
    ['souris', /\bsouris\b/],
    ['clavier', /\bclavier\b/],
    ['ecouteurs', /ecouteurs|earpods|airpods|intra-auriculaires/],
    ['enceinte', /enceinte|barre de son/],
    ['webcam', /webcam/],
    ['micro', /\bmicro\b(?! sd)|microphone|karaoke/],
    ['traceur', /traceur|airtag|smarttag/],
    ['montre', /montre|bracelet connecte|\bband \d/],
    ['console', /\bconsole\b|playstation 5|ps5 (slim|pro|digital)|xbox series|switch (oled|lite|2)\b/],
    ['telephone', /\biphone\b|smartphone|galaxy [asz]\d|telephone portable/],
    ['tablette', /\bipad\b|tablette/],
    ['ordinateur', /macbook|ordinateur|pc portable|laptop|chromebook/],
    ['appareil-photo', /appareil photo|camera|camescope/],
    ['radio', /\bradio\b|reveil/],
  ];
  const typeOf = (p) => { const n = plain(p.name); return TYPES.find(([, re]) => re.test(n))?.[0] || null; };

  // Compléments de chaque type, du plus utile au moins utile
  const COMPLEMENTS = {
    console: ['jeu', 'manette', 'casque-gamer', 'chargeur', 'sacoche'],
    jeu: ['jeu', 'manette', 'casque-gamer'],
    manette: ['jeu', 'chargeur', 'casque-gamer'],
    'casque-gamer': ['manette', 'souris', 'jeu', 'clavier'],
    souris: ['clavier', 'tapis', 'cle-usb', 'webcam'],
    clavier: ['souris', 'tapis', 'webcam'],
    tapis: ['souris', 'clavier'],
    telephone: ['coque', 'chargeur', 'ecouteurs', 'batterie', 'support-voiture', 'cable'],
    tablette: ['coque', 'chargeur', 'clavier', 'ecouteurs'],
    ordinateur: ['souris', 'clavier', 'cle-usb', 'webcam', 'sacoche', 'casque'],
    montre: ['chargeur', 'ecouteurs', 'batterie'],
    ecouteurs: ['batterie', 'chargeur', 'cable', 'enceinte'],
    casque: ['batterie', 'enceinte', 'cable'],
    enceinte: ['batterie', 'micro', 'carte-sd', 'cable'],
    micro: ['enceinte', 'trepied'],
    'appareil-photo': ['carte-sd', 'trepied', 'batterie', 'sacoche'],
    trepied: ['carte-sd', 'micro', 'batterie'],
    webcam: ['trepied', 'micro', 'casque'],
    batterie: ['cable', 'chargeur', 'ecouteurs'],
    chargeur: ['cable', 'batterie'],
    cable: ['chargeur', 'batterie'],
    coque: ['chargeur', 'ecouteurs', 'batterie', 'support-voiture'],
    'support-voiture': ['chargeur', 'cable', 'batterie'],
    'carte-sd': ['cle-usb', 'trepied'],
    'cle-usb': ['carte-sd', 'souris'],
    traceur: ['batterie', 'coque'],
    radio: ['batterie', 'enceinte'],
  };
  // Plateformes : un article « PS5 » ne va pas avec une Switch. « multiplateforme » = compatible avec tout.
  const CONSOLES = ['ps5', 'ps4', 'xbox', 'switch'];
  const PLATFORMS = [['ps5', /\bps5\b|playstation 5|dualsense/], ['ps4', /\bps4\b|playstation 4|dualshock/], ['xbox', /xbox/],
    ['switch', /switch|joy-?con|nintendo/], ['pc', /\bpc\b/],
    ['apple', /iphone|ipad|macbook|lightning|magsafe|airpods|earpods|apple/], ['samsung', /samsung|galaxy/]];
  const platformsOf = (p) => { const n = plain(p.name); return /multiplateforme|multi-plateforme|universel/.test(n) ? [] : PLATFORMS.filter(([, re]) => re.test(n)).map(([k]) => k); };
  const isGaming = (p) => platformsOf(p).some((x) => CONSOLES.includes(x));
  // Un article réservé à une plateforme (manette PS5, coque iPhone) n'est proposé qu'avec un article de la même plateforme ;
  // « PC » seul (souris, manette PC) ne gêne que face à une console
  function compatible(a, b) {
    const pa = platformsOf(a), pb = platformsOf(b);
    if (!pb.length || pa.some((x) => pb.includes(x))) return true;
    return pb.every((x) => x === 'pc') && !isGaming(a);
  }
  // Article lié à une console (sacoche Switch, support PS5…) sans liste à lui : on propose ce qui va avec la console
  const GAMING = ['jeu', 'manette', 'casque-gamer', 'chargeur'];
  const complementsOf = (p) => COMPLEMENTS[typeOf(p)] || (isGaming(p) ? GAMING : []);

  const available = (p) => p.stock == null || p.stock > 0;

  /** Note d'un candidat par rapport à UN article de départ (0 = sans rapport). */
  function score(anchor, c, pairs = {}) {
    if (c.id === anchor.id) return 0;
    const together = pairs[anchor.id]?.[c.id] || 0;
    const co = together >= 2 ? Math.min(1, together / 6) * 0.8 : 0; // ce que les clients achètent vraiment ensemble passe avant les règles
    let rule = 0;
    if (compatible(anchor, c)) {
      const t = typeOf(c), i = complementsOf(anchor).indexOf(t);
      // chargeur pour un article de console : seulement un chargeur de manette (pas un chargeur de téléphone)
      if (i >= 0 && !(t === 'chargeur' && isGaming(anchor) && !isGaming(c))) rule = 1 - i * 0.12;
    }
    if (!rule && !co) return 0;
    const cheaper = c.price <= anchor.price ? 0.15 : c.price <= anchor.price * 1.5 ? 0.07 : 0;
    const stars = c.rating?.count ? ((c.rating.avg - 3) / 2) * 0.1 : 0;
    return rule + co + cheaper + stars;
  }

  /**
   * Compléments pour une liste d'articles de départ (la fiche regardée, ou le panier).
   * opts : { exclude: Set d'ids (déjà dans le panier), pairs, limit (4), familyKey (regroupe les couleurs) }.
   */
  function suggest(anchors, catalog, opts = {}) {
    const { exclude = new Set(), pairs = {}, limit = 4, familyKey = () => null } = opts;
    const anchorIds = new Set(anchors.map((a) => a.id));
    const anchorFam = new Set(anchors.map(familyKey).filter(Boolean));
    const scored = [];
    for (const c of catalog) {
      if (!available(c) || anchorIds.has(c.id) || exclude.has(c.id) || (familyKey(c) && anchorFam.has(familyKey(c)))) continue;
      let best = 0;
      for (const a of anchors) best = Math.max(best, score(a, c, pairs));
      if (best > 0) scored.push({ p: c, s: best, type: typeOf(c) || c.id });
    }
    scored.sort((a, b) => b.s - a.s || a.p.price - b.p.price);
    // Variété : un article par type d'abord (pas 4 jeux), puis on complète ; un seul par modèle
    const out = [], fams = new Set(), types = new Set();
    for (const pass of [1, 2]) {
      for (const x of scored) {
        if (out.length >= limit) break;
        const f = familyKey(x.p);
        if (out.includes(x.p) || (f && fams.has(f)) || (pass === 1 && types.has(x.type))) continue;
        out.push(x.p); types.add(x.type); if (f) fams.add(f);
      }
    }
    return out;
  }

  const api = { suggest, score, typeOf, complementsOf, platformsOf, compatible, TYPES, COMPLEMENTS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.kamwaBasket = api;
})(typeof window !== 'undefined' ? window : globalThis);
