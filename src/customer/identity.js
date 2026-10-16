// Pièce d'identité des clients (décision Joseph 16/10/2026) : photo OBLIGATOIRE à l'ouverture du compte
// (passeport, CNI ou NIU), vérifiée par l'administrateur avant que le client puisse commander.
// Données très sensibles :
//  - rangées HORS du dossier public (data/identity), jamais sur GitHub, jamais servies en accès libre :
//    seul l'administrateur connecté peut voir une photo (route protégée, sans cache) ;
//  - photo ré-enregistrée en JPEG (2000 px max) : les informations cachées du fichier (GPS, appareil…) sont supprimées ;
//    une pièce SCANNÉE peut aussi être envoyée en PDF (vrai PDF vérifié, 4 Mo max, gardé tel quel) ;
//  - vitrine de démonstration : la photo envoyée n'est PAS gardée, elle est remplacée par une image « SPÉCIMEN »
//    (les comptes de la démo sont publics, n'importe qui pourrait la voir).
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

async function specimen() {
  const sharp = require('sharp');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760"><rect width="100%" height="100%" rx="40" fill="#EEE9FF"/>
    <rect x="60" y="60" width="300" height="380" rx="20" fill="#D9D2F5"/><rect x="420" y="110" width="640" height="40" rx="10" fill="#C9C0EC"/>
    <rect x="420" y="190" width="520" height="40" rx="10" fill="#C9C0EC"/><rect x="420" y="270" width="580" height="40" rx="10" fill="#C9C0EC"/>
    <text x="600" y="600" font-family="Arial" font-size="110" font-weight="700" fill="#FF5A3C" text-anchor="middle" transform="rotate(-8 600 600)">SPÉCIMEN</text>
    <text x="600" y="700" font-family="Arial" font-size="34" fill="#2D1B69" text-anchor="middle">Démo Kamwa : la vraie photo n'est pas conservée</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
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
  const jpg = config.demo ? await specimen()
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
  const number = String(body?.idNumber || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const photo = decodePhoto(body?.idPhoto);
  if (photo.error) return { error: photo.error };
  let file;
  try { file = photo.pdf && !config.demo ? storePdf(photo.buf) : await storePhoto(photo.pdf ? null : photo.buf); } catch (err) { return { error: err.message }; }
  return { fields: { idType: type, idNumber: number || null, idPhoto: file, idStatus: 'pending', idSubmittedAt: new Date().toISOString(), idRejectReason: null, idCheckedAt: null, idCheckedBy: null } };
}

const idStatus = (c) => (c?.idStatus && STATUS_LABELS[c.idStatus] ? c.idStatus : 'missing');

module.exports = { ID_DIR, ID_TYPES, STATUS_LABELS, readSubmission, photoPath, removePhoto, idStatus };
