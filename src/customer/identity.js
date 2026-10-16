// Pièce d'identité des clients (décision Joseph 16/10/2026) : photo OBLIGATOIRE à l'ouverture du compte
// (passeport, CNI ou NIU), vérifiée par l'administrateur avant que le client puisse commander.
// Données très sensibles :
//  - rangées HORS du dossier public (data/identity), jamais sur GitHub, jamais servies en accès libre :
//    seul l'administrateur connecté peut voir une photo (route protégée, sans cache) ;
//  - photo ré-enregistrée en JPEG (2000 px max) : les informations cachées du fichier (GPS, appareil…) sont supprimées ;
//    une pièce SCANNÉE peut aussi être envoyée en PDF (vrai PDF vérifié, 4 Mo max, gardé tel quel) ;
//  - vitrine de démonstration : la photo envoyée n'est PAS gardée, seulement un aperçu réduit à 24 px puis flouté
//    (cadrage visible, contenu illisible) ; numéro saisi masqué (les comptes de la démo sont publics).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

const ID_DIR = process.env.ID_DIR || (process.env.VERCEL ? '/tmp/kamwa-identity' : path.join(__dirname, '..', '..', 'data', 'identity'));
const ID_TYPES = { passeport: 'Passeport', cni: "Carte nationale d'identité (CNI)", niu: 'NIU' };
const STATUS_LABELS = { missing: 'Pièce à fournir', pending: 'En cours de vérification', verified: 'Vérifiée', rejected: 'Refusée' };
const MAX_BYTES = 8 * 1024 * 1024;

const MAX_PDF = 4.5 * 1024 * 1024;

/** Lit le fichier envoyé par le navigateur : photo (« data:image/jpeg;base64,… ») ou pièce scannée en PDF. */
function decodePhoto(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: "Ajoutez une photo lisible de votre pièce d'identité (photo ou scan : JPEG, PNG ou PDF)" };
  const buf = Buffer.from(m[2], 'base64');
  const pdf = m[1] === 'application/pdf';
  if (buf.length < 2000) return { error: 'Fichier trop petit ou illisible' };
  if (buf.length > (pdf ? MAX_PDF : MAX_BYTES)) return { error: pdf ? 'PDF trop lourd (4 Mo maximum)' : 'Photo trop lourde (8 Mo maximum)' };
  if (pdf && buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { error: "Ce fichier n'est pas un vrai PDF" };
  return { buf, pdf };
}

// Démo : pas de texte dans les images générées (le serveur de démo n'a pas de polices : le texte s'afficherait en carrés)
const DEMO_MARK = `<pattern id="st" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><rect width="14" height="60" fill="#FF5A3C" opacity=".12"/></pattern>`;
async function specimen() {
  const sharp = require('sharp');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760"><defs>${DEMO_MARK}</defs><rect width="100%" height="100%" rx="40" fill="#EEE9FF"/>
    <rect x="60" y="60" width="300" height="380" rx="20" fill="#D9D2F5"/><rect x="420" y="110" width="640" height="40" rx="10" fill="#C9C0EC"/>
    <rect x="420" y="190" width="520" height="40" rx="10" fill="#C9C0EC"/><rect x="420" y="270" width="580" height="40" rx="10" fill="#C9C0EC"/>
    <rect width="100%" height="100%" fill="url(#st)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}
// Démo : aperçu de la vraie photo réduit à 24 pixels de large puis flouté = cadrage visible, contenu ILLISIBLE
async function demoPreview(buf) {
  const sharp = require('sharp');
  const tiny = await sharp(buf).rotate().resize({ width: 24 }).toBuffer();
  const meta = await sharp(tiny).metadata();
  const W = 1000, H = Math.round((meta.height / meta.width) * W);
  const blurred = await sharp(tiny).resize(W, H, { kernel: 'cubic' }).blur(5).toBuffer();
  const mark = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${DEMO_MARK}</defs><rect width="100%" height="100%" fill="url(#st)"/><rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="18" fill="none" stroke="#FF5A3C" stroke-width="6" stroke-dasharray="24 14"/></svg>`);
  return sharp(blurred).composite([{ input: mark }]).jpeg({ quality: 70 }).toBuffer();
}

/** Pièce scannée en PDF : gardée telle quelle (vérifiée : vrai PDF, taille limitée). Démo : remplacée par le spécimen. */
function storePdf(buf) {
  fs.mkdirSync(ID_DIR, { recursive: true, mode: 0o700 });
  const name = `${crypto.randomBytes(16).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(ID_DIR, name), buf, { mode: 0o600 });
  return name;
}

/** Vérifie que c'est bien une image, la nettoie et l'enregistre. Renvoie le nom du fichier. */
async function storePhoto(buf) {
  const sharp = require('sharp');
  if (buf) {
    let meta;
    try { meta = await sharp(buf).metadata(); } catch { throw new Error("Ce fichier n'est pas une photo lisible"); }
    if (!meta.width || meta.width < 300 || meta.height < 200) throw new Error('Photo trop petite : prenez la pièce en entier, bien nette');
  }
  const jpg = config.demo ? (buf ? await demoPreview(buf) : await specimen())
    : await sharp(buf).rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  fs.mkdirSync(ID_DIR, { recursive: true, mode: 0o700 });
  const name = `${crypto.randomBytes(16).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(ID_DIR, name), jpg, { mode: 0o600 });
  return name;
}

function photoPath(name) {
  return /^[a-f0-9]{32}\.(jpg|pdf)$/.test(String(name || '')) ? path.join(ID_DIR, name) : null;
}
function removePhoto(name) {
  const p = photoPath(name);
  if (p) fs.rm(p, { force: true }, () => {});
}

/** Lit type / numéro / photo envoyés par le client. Renvoie { fields } ou { error }. */
async function readSubmission(body) {
  const type = String(body?.idType || '');
  if (!ID_TYPES[type]) return { error: "Choisissez le type de pièce : passeport, CNI ou NIU" };
  let number = String(body?.idNumber || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (config.demo && number) number = number.slice(0, 2) + '•'.repeat(Math.max(3, number.length - 2)); // démo publique : numéro masqué
  const photo = decodePhoto(body?.idPhoto);
  if (photo.error) return { error: photo.error };
  let file;
  try { file = photo.pdf && !config.demo ? storePdf(photo.buf) : await storePhoto(photo.pdf ? null : photo.buf); } catch (err) { return { error: err.message }; }
  return { buf: photo.buf, pdf: photo.pdf, fields: { idType: type, idNumber: number || null, idPhoto: file, idStatus: 'pending', idAuto: null, idAutoAt: null, idSubmittedAt: new Date().toISOString(), idRejectReason: null, idCheckedAt: null, idCheckedBy: null } };
}

// ---------- Contrôle automatique (lecture de la pièce, voir mrz.js) ----------
// Lancé juste après l'envoi, sans faire attendre le client ; le résultat n'est montré qu'à l'admin.
// Démo : on ne garde que les conclusions (concordances, alertes), jamais les données lues (nom, numéro, dates).
function publicSafe(r) {
  if (!config.demo || !r) return r;
  const { fields, ...rest } = r;
  return rest;
}
async function runCheck(customerId, buf) {
  const { customers } = require('../store');
  const mrz = require('./mrz');
  const c = customers.get(customerId);
  if (!c) return null;
  let r;
  try { r = await mrz.analyzeDocument(buf, c); } catch (err) { r = { read: false, summary: `Lecture automatique impossible (${err.message}) : vérifiez à l'œil.` }; }
  const fresh = customers.get(customerId);
  if (!fresh || fresh.idPhoto !== c.idPhoto) return null; // pièce remplacée entre-temps
  customers.update(customerId, { idAuto: publicSafe(r), idAutoAt: new Date().toISOString() });
  return r;
}
function checkLater(customerId, submission) {
  const { customers } = require('../store');
  if (submission.pdf) {
    customers.update(customerId, { idAuto: { read: false, summary: "Document PDF : lecture automatique non disponible, vérifiez à l'œil." }, idAutoAt: new Date().toISOString() });
    return;
  }
  const job = new Promise((resolve) => setImmediate(() => runCheck(customerId, submission.buf).catch((err) => console.error('[pièce] contrôle automatique :', err.message)).finally(resolve)));
  // Vercel (démo) : garder la fonction en vie jusqu'à la fin de la lecture, sinon elle est figée après la réponse
  if (process.env.VERCEL) { try { require('@vercel/functions').waitUntil(job); } catch {} }
}
/** Relance le contrôle sur la photo enregistrée (bouton de l'admin). */
async function recheck(customer) {
  const file = photoPath(customer.idPhoto);
  if (!file || file.endsWith('.pdf')) return { read: false, summary: "Document PDF : lecture automatique non disponible, vérifiez à l'œil." };
  if (config.demo) return { read: false, summary: "Démo : la vraie photo n'est pas conservée (aperçu flouté seulement), la lecture ne peut pas être relancée. Résultat de la lecture faite à l'envoi ci-dessus, s'il existe." };
  return runCheck(customer.id, fs.readFileSync(file));
}

const idStatus = (c) => (c?.idStatus && STATUS_LABELS[c.idStatus] ? c.idStatus : 'missing');

module.exports = { ID_DIR, ID_TYPES, STATUS_LABELS, readSubmission, photoPath, removePhoto, idStatus, checkLater, recheck };
