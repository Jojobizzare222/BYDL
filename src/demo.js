// Vitrine de démonstration (Vercel uniquement, config.demo) : comptes et données d'exemple pour tester l'espace pro.
// Ces comptes sont PUBLICS (affichés sur la page de connexion de la démo) et n'existent jamais sur la vraie boutique.
const crypto = require('crypto');
const config = require('./config');
const { settings, staff, products, orders, payments, ledger, imports } = require('./store');
const { hashPassword } = require('./admin/auth');

const DEMO_PASSWORD = 'demo-kamwa';
const DEMO_ACCOUNTS = [
  { label: 'Administrateur', login: 'admin', role: 'admin' },
  { label: 'Fournisseur (Mode Congo)', login: 'demo-fournisseur', role: 'supplier', name: 'Grâce Ngoma', company: 'Mode Congo (démo)' },
  { label: 'Employé Catalogue', login: 'demo-catalogue', role: 'catalog', name: 'Clara (démo)' },
  { label: 'Employé Commandes', login: 'demo-commandes', role: 'orders', name: 'Oscar (démo)' },
  { label: 'Livreur', login: 'demo-livreur', role: 'courier', name: 'Junior (démo)' },
  { label: 'Agent France', login: 'demo-agent', role: 'agent', name: 'Agent Paris (démo)' },
];
const isDemoLogin = (login) => config.demo && DEMO_ACCOUNTS.some((a) => a.login === login);

const id = (prefix, n = 4) => prefix + crypto.randomBytes(n).toString('hex').toUpperCase();

function seed() {
  if (!config.demo || settings.get('demo_seeded')) return;
  const now = new Date().toISOString();

  // Administrateur de la démo (mot de passe public, base temporaire)
  settings.set('admin_password', hashPassword(DEMO_PASSWORD));

  // Comptes équipe et fournisseur
  const users = {};
  for (const a of DEMO_ACCOUNTS.filter((x) => x.role !== 'admin')) {
    users[a.role] = staff.insert({
      id: 'U-DEMO-' + a.role.toUpperCase(), name: a.name, login: a.login, role: a.role, company: a.company || null, phone: null,
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
    customer: { name: 'Client Démo', phone: '060000000', city: 'Brazzaville', address: 'Quartier fictif' },
    status: 'paid', createdAt: now, paidAt: now, paymentId, history: [{ status: 'paid', at: now }], fulfillment: 'delivery', deliveryCode: '1357',
  });

  // Une commande « à la réception » (acompte payé) confiée au livreur de démo : code client 2468, reste 12 500 à encaisser
  orders.insert({
    id: 'CMD-DEMO-0002', accessToken: crypto.randomBytes(16).toString('hex'), customerId: null,
    lines: [{ productId: chemise.id, name: chemise.name, unitPrice: chemise.price, qty: 1, total: chemise.price }],
    subtotal: chemise.price, deliveryFee: 0, total: chemise.price, currency: 'XAF',
    customer: { name: 'Mireille (démo)', phone: '069999999', city: 'Pointe-Noire', address: 'Quartier Loandjili, près du marché (fictif)' },
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

  // Achat en France : une demande à chiffrer et une commande payée à acheter
  imports.insert({
    id: 'FR-DEMO-0001', accessToken: 'demo-fr-0001-' + crypto.randomBytes(8).toString('hex'), customerId: null,
    items: [{ url: 'https://www.decathlon.fr/', title: 'Chaussures de running (exemple)', options: 'Pointure 43, noir', qty: 1, priceEur: 59.99 }],
    note: 'Exemple de démonstration', customer: { name: 'Paul (démo)', phone: '068888888', city: 'Brazzaville', address: 'Bacongo (fictif)' },
    status: 'requested', createdAt: now, history: [{ status: 'requested', at: now }],
  });
  imports.insert({
    id: 'FR-DEMO-0002', accessToken: 'demo-fr-0002-' + crypto.randomBytes(8).toString('hex'), customerId: null,
    items: [{ url: 'https://www.fnac.com/', title: 'Liseuse électronique (exemple)', options: 'Noire', qty: 1, priceEur: 129 }],
    note: '', customer: { name: 'Clarisse (démo)', phone: '067777777', city: 'Pointe-Noire', address: 'Mpita (fictif)' },
    status: 'accepted', orderId: 'CMD-DEMO-0003', createdAt: now, history: [{ status: 'requested', at: now }, { status: 'quoted', at: now }, { status: 'accepted', at: now }],
    quote: { items: [{ title: 'Liseuse électronique (exemple)', priceEur: 129, shippingEur: 0, qty: 1 }], weightKg: 0.6, total: 131000, delay: '10 à 21 jours', breakdown: { goods: 84618, freight: 5400, customs: 16924, cost: 106942, commission: 24058, total: 131000 }, validUntil: now, by: 'Administrateur', at: now },
  });
  orders.insert({
    id: 'CMD-DEMO-0003', accessToken: crypto.randomBytes(16).toString('hex'), customerId: null,
    lines: [{ productId: null, name: 'Liseuse électronique (exemple) (achat en France)', unitPrice: 131000, qty: 1, total: 131000, unitCost: 106942, supplierId: null }],
    subtotal: 131000, deliveryFee: 0, total: 131000, currency: 'XAF',
    customer: { name: 'Clarisse (démo)', phone: '067777777', city: 'Pointe-Noire', address: 'Mpita (fictif)' },
    status: 'paid', createdAt: now, paidAt: now, paymentId: 'PAY-DEMO-0003', history: [{ status: 'paid', at: now }], fulfillment: 'delivery', deliveryCode: '8642',
    import: { requestId: 'FR-DEMO-0002', stage: 'to_buy', delay: '10 à 21 jours', items: [{ title: 'Liseuse électronique (exemple)', priceEur: 129, shippingEur: 0, qty: 1, url: 'https://www.fnac.com/', options: 'Noire' }] },
  });
  payments.insert({ id: 'PAY-DEMO-0003', orderId: 'CMD-DEMO-0003', operator: 'mtn', phone: '067777777', purpose: 'full', amount: 131000, currency: 'XAF', status: 'SUCCESSFUL', providerRef: 'DEMO', reason: null, createdAt: now });

  settings.set('demo_seeded', now);
  console.log('[démo] comptes et données d\'exemple créés');
}

// Ce que la page de connexion de la démo affiche (rien en dehors de la démo)
const publicAccounts = () => (config.demo ? DEMO_ACCOUNTS.map(({ label, login }) => ({ label, login, password: DEMO_PASSWORD })) : []);

module.exports = { seed, isDemoLogin, publicAccounts };
