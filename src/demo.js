// Vitrine de démonstration (Vercel uniquement, config.demo) : comptes et données d'exemple pour tester l'espace pro.
// Ces comptes sont PUBLICS (affichés sur la page de connexion de la démo) et n'existent jamais sur la vraie boutique.
const crypto = require('crypto');
const config = require('./config');
const { settings, staff, products, orders, payments, ledger, agencies, reviews } = require('./store');
const { hashPassword } = require('./admin/auth');

const DEMO_PASSWORD = 'demo-kamwa';
const DEMO_ACCOUNTS = [
  { label: 'Administrateur', login: 'admin', role: 'admin' },
  { label: 'Fournisseur (Mode Congo)', login: 'demo-fournisseur', role: 'supplier', name: 'Grâce Ngoma', company: 'Mode Congo (démo)' },
  { label: 'Employé Catalogue', login: 'demo-catalogue', role: 'catalog', name: 'Clara (démo)' },
  { label: 'Employé Commandes', login: 'demo-commandes', role: 'orders', name: 'Oscar (démo)' },
  { label: 'Livreur', login: 'demo-livreur', role: 'courier', name: 'Junior (démo)' },
];
// Course de démonstration (suivi en direct simulé, src/live.js) : clé connue de tous, n'existe que sur la démo
const DEMO_TRACK_TOKEN = 'demo0000suivi0000kamwa0000course';
const isDemoLogin = (login) => config.demo && DEMO_ACCOUNTS.some((a) => a.login === login);

const id = (prefix, n = 4) => prefix + crypto.randomBytes(n).toString('hex').toUpperCase();

function seed() {
  if (!config.demo || settings.get('demo_seeded')) return;
  const now = new Date().toISOString();

  // Administrateur de la démo (mot de passe public, base temporaire)
  settings.set('admin_password', hashPassword(DEMO_PASSWORD));

  // Agences d'exemple : le paiement en espèces en agence est le seul moyen proposé par défaut
  agencies.insert({ id: 'AG-DEMO-PNR', name: 'Agence Kamwa Centre-ville (démo)', city: 'Pointe-Noire', address: 'Avenue Charles de Gaulle (exemple)', hours: 'Lun-Sam 8 h - 18 h', phone: '06 000 00 01', kind: 'agency', lat: -4.7792, lng: 11.8638, active: true, createdAt: now });
  agencies.insert({ id: 'AG-DEMO-TIE', name: 'Relais Tié-Tié — Boutique Mavoungou (démo)', city: 'Pointe-Noire', address: 'Marché de Tié-Tié (exemple)', hours: 'Lun-Dim 7 h - 20 h', phone: '06 000 00 03', kind: 'partner', lat: -4.7905, lng: 11.8843, active: true, createdAt: now });
  agencies.insert({ id: 'AG-DEMO-LOA', name: 'Relais Loandjili — Pharmacie partenaire (démo)', city: 'Pointe-Noire', address: 'Rond-point Loandjili (exemple)', hours: 'Lun-Sam 8 h - 19 h', phone: '06 000 00 04', kind: 'partner', lat: -4.7569, lng: 11.8857, active: true, createdAt: now });

  // Comptes équipe et fournisseur
  const users = {};
  for (const a of DEMO_ACCOUNTS.filter((x) => x.role !== 'admin')) {
    users[a.role] = staff.insert({
      id: 'U-DEMO-' + a.role.toUpperCase(), name: a.name, login: a.login, role: a.role, company: a.company || null, phone: null,
      ...(a.role === 'courier' ? { vehicle: 'Moto Haojue rouge · PN 2468 AB' } : {}),
      active: true, mustChangePassword: false, passwordHash: hashPassword(DEMO_PASSWORD), createdAt: now,
    });
  }
  const sup = users.supplier.id;

  // Produits du fournisseur : un publié, un en attente de validation
  const chemise = products.insert({
    id: 'pdemo1', name: 'Chemise wax homme', brand: 'Mode Congo', universe: 'Mode', category: 'Homme', condition: 'neuf',
    price: 14500, oldPrice: 17000, supplierPrice: 8500, stock: 9, active: true, supplierId: sup, images: [],
    description: 'Chemise en wax 100 % coton, coupe ajustée. Produit de démonstration.',
    specs: [{ label: 'Tailles', value: 'M, L, XL' }, { label: 'Matière', value: 'coton' }],
    createdAt: now, createdBy: sup,
  });
  products.insert({
    id: 'pdemo2', name: 'Jogging wax homme', brand: 'Mode Congo', universe: 'Mode', category: 'Homme', condition: 'neuf',
    price: null, supplierPrice: 7000, stock: 20, active: true, pending: true, supplierId: sup, images: [],
    description: 'Jogging coton avec bandes en wax. Produit de démonstration en attente de validation.',
    specs: [{ label: 'Tailles', value: 'S à XXL' }], createdAt: now, createdBy: sup,
  });

  // Une commande payée contenant le produit du fournisseur et un produit Kamwa
  const iphone = products.get('a002');
  const lines = [{ productId: chemise.id, name: chemise.name, unitPrice: chemise.price, qty: 3, total: chemise.price * 3 }];
  if (iphone) lines.push({ productId: iphone.id, name: iphone.name, unitPrice: iphone.price, qty: 1, total: iphone.price });
  const total = lines.reduce((s, l) => s + l.total, 0);
  const orderId = 'CMD-DEMO-0001';
  const paymentId = 'PAY-DEMO-0001';
  orders.insert({
    id: orderId, accessToken: crypto.randomBytes(16).toString('hex'), customerId: null, lines, subtotal: total, deliveryFee: 0, total, currency: 'XAF',
    customer: { name: 'Client Démo', phone: '060000000', city: 'Pointe-Noire', address: 'Quartier Mpita (fictif)' },
    status: 'paid', createdAt: now, paidAt: now, paymentId, history: [{ status: 'paid', at: now }], fulfillment: 'delivery', deliveryCode: '1357',
  });

  // Une commande « à la réception » (acompte payé) confiée au livreur de démo : code client 2468, reste 12 500 à encaisser
  orders.insert({
    id: 'CMD-DEMO-0002', accessToken: DEMO_TRACK_TOKEN, customerId: null, // clé fixe et publique : « Voir une course en direct » sur la démo
    lines: [{ productId: chemise.id, name: chemise.name, unitPrice: chemise.price, qty: 1, total: chemise.price }],
    subtotal: chemise.price, deliveryFee: 0, total: chemise.price, currency: 'XAF',
    customer: { name: 'Mireille (démo)', phone: '069999999', city: 'Pointe-Noire', address: 'Quartier Loandjili, près du marché (fictif)', location: require('./live').DEMO_DEST },
    status: 'shipped', paymentPlan: 'cod', deposit: 2000, balance: chemise.price - 2000, depositPaidAt: now, depositPaymentId: 'PAY-DEMO-0002',
    confirmedAt: now, callConfirmedAt: now, callConfirmedBy: 'Oscar (démo)', courierId: users.courier.id, assignedAt: now, deliveryCode: '2468',
    createdAt: now, history: [{ status: 'confirmed', at: now }, { status: 'shipped', at: now }], fulfillment: 'delivery',
  });
  payments.insert({ id: 'PAY-DEMO-0002', orderId: 'CMD-DEMO-0002', operator: 'mtn', phone: '069999999', purpose: 'deposit', amount: 2000, currency: 'XAF', status: 'SUCCESSFUL', providerRef: 'DEMO', reason: null, createdAt: now });
  payments.insert({ id: paymentId, orderId, operator: 'mtn', phone: '060000000', amount: total, currency: 'XAF', status: 'SUCCESSFUL', providerRef: 'DEMO', reason: null, createdAt: now });

  // Volet Finances : prix d'achat du produit Kamwa vendu + quelques écritures d'exemple
  if (iphone) products.update(iphone.id, { costPrice: Math.round(iphone.price * 0.86) });
  const d = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  let seq = 0;
  const entry = (n, type, category, amount, method, label, extra = {}) => ledger.insert({ id: `FIN-DEMO-${String(++seq).padStart(2, '0')}`, type, category, amount, method, date: d(n), label, note: 'Exemple de démonstration', toMethod: null, supplierId: null, receipt: null, createdBy: 'admin', createdAt: now, ...extra });
  entry(20, 'income', 'capital', 1500000, 'bank', 'Apport de départ');
  entry(18, 'expense', 'rent', 150000, 'bank', 'Loyer agence Pointe-Noire');
  entry(12, 'expense', 'marketing', 35000, 'momo', 'Publicité Facebook');
  entry(9, 'expense', 'delivery', 12000, 'cash', 'Carburant livreur');
  entry(6, 'transfer', 'transfer', 200000, 'bank', 'Retrait pour la caisse', { toMethod: 'cash' });
  entry(3, 'expense', 'supplier', 15000, 'momo', 'Acompte Mode Congo', { supplierId: sup });

  // Avis clients d'exemple (identifiants fixes : identiques dans chaque copie du serveur)
  const rv = (id, productId, rating, name, text, n) => products.get(productId) && reviews.insert({ id, productId, customerId: 'C-DEMO', orderId: 'CMD-DEMO-0000', rating, text, name, hidden: false, createdAt: new Date(Date.now() - n * 864e5).toISOString(), demo: true });
  rv('AV-DEMO-01', 'a020', 5, 'Grâce M.', 'Reçu en 24 h à Pointe-Noire, téléphone neuf et bien emballé. Le livreur a appelé avant de passer.', 6);
  rv('AV-DEMO-02', 'a020', 4, 'Junior K.', 'Bon rapport qualité-prix. Retrait au point relais très simple.', 3);
  rv('AV-DEMO-03', 'a018', 5, 'Prisca N.', 'Conforme à la description. Je recommande Kamwa.', 2);

  settings.set('demo_seeded', now);
  console.log('[démo] comptes et données d\'exemple créés');
}

// Ce que la page de connexion de la démo affiche (rien en dehors de la démo)
const publicAccounts = () => (config.demo ? DEMO_ACCOUNTS.map(({ label, login }) => ({ label, login, password: DEMO_PASSWORD })) : []);

module.exports = { seed, isDemoLogin, publicAccounts, DEMO_TRACK_TOKEN };
