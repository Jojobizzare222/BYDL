// Vitrine de démonstration (Vercel uniquement, config.demo) : comptes et données d'exemple pour tester l'espace pro.
// Ces comptes sont PUBLICS (affichés sur la page de connexion de la démo) et n'existent jamais sur la vraie boutique.
const crypto = require('crypto');
const config = require('./config');
const { settings, staff, products, orders, payments } = require('./store');
const { hashPassword } = require('./admin/auth');

const DEMO_PASSWORD = 'demo-kamwa';
const DEMO_ACCOUNTS = [
  { label: 'Administrateur', login: 'admin', role: 'admin' },
  { label: 'Fournisseur (Mode Congo)', login: 'demo-fournisseur', role: 'supplier', name: 'Grâce Ngoma', company: 'Mode Congo (démo)' },
  { label: 'Employé Catalogue', login: 'demo-catalogue', role: 'catalog', name: 'Clara (démo)' },
  { label: 'Employé Commandes', login: 'demo-commandes', role: 'orders', name: 'Oscar (démo)' },
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
      id: id('U-'), name: a.name, login: a.login, role: a.role, company: a.company || null, phone: null,
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
  const orderId = id('CMD-DEMO-', 3);
  const paymentId = 'PAY-' + crypto.randomUUID();
  orders.insert({
    id: orderId, accessToken: crypto.randomBytes(16).toString('hex'), customerId: null, lines, subtotal: total, deliveryFee: 0, total, currency: 'XAF',
    customer: { name: 'Client Démo', phone: '060000000', city: 'Brazzaville', address: 'Quartier fictif' },
    status: 'paid', createdAt: now, paidAt: now, paymentId, history: [{ status: 'paid', at: now }], fulfillment: 'delivery',
  });
  payments.insert({ id: paymentId, orderId, operator: 'mtn', phone: '060000000', amount: total, currency: 'XAF', status: 'SUCCESSFUL', providerRef: 'DEMO', reason: null, createdAt: now });

  settings.set('demo_seeded', now);
  console.log('[démo] comptes et données d\'exemple créés');
}

// Ce que la page de connexion de la démo affiche (rien en dehors de la démo)
const publicAccounts = () => (config.demo ? DEMO_ACCOUNTS.map(({ label, login }) => ({ label, login, password: DEMO_PASSWORD })) : []);

module.exports = { seed, isDemoLogin, publicAccounts };
