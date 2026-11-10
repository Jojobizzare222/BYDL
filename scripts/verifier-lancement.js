// Contrôle « prêt à ouvrir ? » de la vraie boutique (décision Joseph 10/11/2026 : ouverture avant Noël).
// Sur le serveur :  sudo -u zado bash -c 'cd /srv/zado/app && npm run verifier'
// N'écrit rien : lit les réglages (.env) et la base, puis liste ce qui est prêt (OK), à surveiller (À VOIR) ou bloquant (BLOQUANT).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { settings, products, agencies, customers } = require('../src/store');
const auth = require('../src/admin/auth');
const billing = require('../src/billing');
const fees = require('../src/fees');
const mobilePay = require('../src/mobile-pay');
const { salesSettings } = require('../src/sales');
const { pullAvailable, cardAvailable } = require('../src/payments');

const rows = [];
const ok = (t) => rows.push(['OK', t]);
const warn = (t) => rows.push(['À VOIR', t]);
const block = (t) => rows.push(['BLOQUANT', t]);
const check = (cond, good, bad, level = block) => (cond ? ok(good) : level(bad));

// --- Serveur et sécurité ---
check(!config.demo, 'Mode boutique réelle (pas la démo)', 'Le site tourne en mode DÉMO (données temporaires) : retirez DEMO_MODE / ne pas utiliser Vercel pour la vraie boutique');
check(/^https:\/\//.test(config.publicUrl) && !/localhost/.test(config.publicUrl), `Adresse publique : ${config.publicUrl}`, `PUBLIC_URL doit être l'adresse https de la boutique (actuellement ${config.publicUrl})`);
check(process.env.TRUST_PROXY === '1', 'Derrière nginx : vraies adresses IP des clients (TRUST_PROXY=1)', 'TRUST_PROXY=1 manquant dans .env (limites anti-abus faussées derrière nginx)', warn);
check(auth.isPasswordSet(), 'Mot de passe de Zado Pro créé', 'Pas de mot de passe administrateur : npm run admin:password');
const keyFile = path.join(path.dirname(require('../src/store').DB_FILE), 'code.key');
check(/^[0-9a-f]{64}$/i.test(process.env.CUSTOMER_CODE_KEY || '') || fs.existsSync(keyFile), 'Clé de chiffrement des codes clients en place', 'Clé de chiffrement des codes clients absente (CUSTOMER_CODE_KEY)', warn);

// --- Paiement ---
if (config.paymentMode !== 'live') block('PAYMENT_MODE n\'est pas « live » : les paiements seraient SIMULÉS (commandes validées sans argent reçu)');
else ok('Paiements réels (PAYMENT_MODE=live)');
const m = mobilePay.mobileSettings();
const sales = salesSettings();
const push = Boolean(m.numbers.mtn || m.numbers.airtel);
check(pullAvailable() || push, `Mobile Money : ${[pullAvailable() && 'demande sur le téléphone', push && `dépôt au ${[m.numbers.mtn && 'MTN ' + mobilePay.spaced(m.numbers.mtn), m.numbers.airtel && 'Airtel ' + mobilePay.spaced(m.numbers.airtel)].filter(Boolean).join(' / ')}`].filter(Boolean).join(' + ')}`,
  'Aucun moyen de payer : saisissez le numéro MTN et/ou Airtel de Zado (Zado Pro → Réglages → Transport, délais et acompte), ou les clés du compte marchand dans .env');
if (!pullAvailable() && config.paymentMode === 'live') warn('Compte marchand MTN / Airtel pas encore branché : seul le « dépôt » est proposé (l\'équipe clique « Dépôt reçu »)');
if (!sales.methods.mobile) warn('Le paiement Mobile Money est désactivé dans Zado Pro → Réglages → Règles de vente');
if (sales.methods.card && !cardAvailable()) warn('La carte bancaire est cochée mais aucun prestataire n\'est branché : elle ne sera pas proposée');
const relays = agencies.all().filter((a) => a.active !== false).length;
if (sales.methods.cash && !relays) warn('Espèces au point relais cochées mais aucun point relais actif : non proposées (normal pour l\'instant)');

// --- Société, documents, textes légaux ---
const missing = billing.missingCompany();
check(!missing.length, 'Société renseignée sur les factures', `Factures : informations de la société manquantes (${missing.join(', ')}) → Zado Pro → Réglages → Société`);
try {
  const legal = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'legal.js'), 'utf8');
  const todo = (legal.match(/\$\{T\(/g) || []).length;
  check(!todo, 'Textes légaux complets', `Textes légaux : ${todo} passage(s) « À compléter » (mentions légales, conditions de vente…) : à remplir et faire relire`, warn);
} catch {}

// --- Livraison, e-mails ---
const f = fees.feeSettings();
check(f.cities.some((c) => c.fee > 0 || c.zones?.some((z) => z.fee > 0)), 'Frais de livraison fixés', 'Frais de livraison à 0 FCFA partout (Zado Pro → Réglages → Frais de livraison) : livraison offerte, est-ce voulu ?', warn);
check(Boolean(config.smtp.host && config.smtp.user && config.smtp.to), `Alertes e-mail vers ${config.smtp.to}`, 'E-mail non configuré (SMTP_… dans .env) : pas d\'alerte e-mail à chaque commande (la sonnerie de Zado Pro marche quand même)', warn);

// --- Catalogue ---
const live = products.all().filter((p) => p.active !== false && !p.pending);
const noPhoto = live.filter((p) => !p.image).length;
const noStock = live.filter((p) => p.stock === 0).length;
check(live.length > 0, `${live.length} produit(s) en vente`, 'Aucun produit en vente');
if (noPhoto) warn(`${noPhoto} produit(s) sans photo (icône affichée) : envoyez vos photos depuis Zado Pro`);
if (noStock) warn(`${noStock} produit(s) épuisé(s)`);
warn('Les prix du catalogue de départ sont des ESTIMATIONS : vérifiez chaque prix de vente, prix fournisseur et poids avant d\'ouvrir');

// --- Divers ---
if (!process.env.GOOGLE_CLIENT_ID) warn('« Continuer avec Google » pas encore configuré (GOOGLE_CLIENT_ID) : bouton « bientôt »');
if (!process.env.APPLE_SERVICE_ID) warn('« Continuer avec Apple » pas encore configuré (APPLE_SERVICE_ID) : bouton « bientôt »');
const maint = (() => { try { return JSON.parse(settings.get('maintenance') || '{}'); } catch { return {}; } })();
if (maint.enabled) warn('La boutique est en MAINTENANCE (Zado Pro → Réglages → Rouvrir)');
ok(`${customers.all().length} compte(s) client`);

// --- Résultat ---
const icon = { OK: '✅', 'À VOIR': '⚠️ ', BLOQUANT: '❌' };
console.log('\nZado : contrôle avant l\'ouverture\n');
for (const level of ['BLOQUANT', 'À VOIR', 'OK']) for (const [l, t] of rows) if (l === level) console.log(`${icon[l]} ${l.padEnd(8)} ${t}`);
const blocking = rows.filter(([l]) => l === 'BLOQUANT').length;
console.log(blocking ? `\n${blocking} point(s) BLOQUANT(S) : à régler avant d'ouvrir.\n` : '\nAucun point bloquant : la boutique peut ouvrir.\n');
process.exit(blocking ? 1 : 0);
