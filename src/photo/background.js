// Détourage automatique des photos produits : retire l'arrière-plan et pose le produit, centré, sur un fond blanc.
// Tout se passe sur le serveur Kamwa (aucun service extérieur, aucun coût par photo) :
//  - modèle ISNet « general use » (DIS, licence Apache 2.0, fichier diffusé par le projet rembg) ;
//  - exécuté avec onnxruntime-web (WebAssembly, licence MIT) et préparé avec sharp (Apache 2.0) ;
//  - le modèle (~170 Mo) n'est pas dans GitHub : il est téléchargé au premier usage, puis son empreinte SHA-256
//    est vérifiée (un fichier abîmé ou modifié est refusé).
// Une seule photo est traitée à la fois pour ne pas saturer la mémoire du serveur.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MODEL = {
  file: 'isnet-general-use.onnx',
  url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
  sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
  size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1],
};
const MODEL_DIR = process.env.MODEL_DIR || (process.env.VERCEL ? '/tmp/kamwa-models' : path.join(__dirname, '..', '..', 'data', 'models'));
const MODEL_PATH = path.join(MODEL_DIR, MODEL.file);
const MAX_SIDE = 1600; // taille maximale de la photo traitée (et de la photo finale)
// Fichiers WebAssembly du moteur, désignés explicitement : sans cela, l'hébergeur (Vercel) ne les embarque pas
const ORT_DIST = path.join(__dirname, '..', '..', 'node_modules', 'onnxruntime-web', 'dist');
const ORT_MJS = path.join(__dirname, '..', '..', 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.mjs');
const ORT_WASM = path.join(__dirname, '..', '..', 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.wasm');

let sharp = null;
let ort = null;
let sessionPromise = null;
let downloading = false;
let queue = Promise.resolve();

function libs() {
  if (!sharp) sharp = require('sharp');
  if (!ort) {
    ort = require('onnxruntime-web');
    ort.env.wasm.numThreads = Math.max(1, Math.min(4, (os.availableParallelism?.() || os.cpus().length) - 0));
    ort.env.logLevel = 'error';
    if (fs.existsSync(ORT_MJS) && fs.existsSync(ORT_WASM)) {
      const { pathToFileURL } = require('url');
      ort.env.wasm.wasmPaths = { mjs: pathToFileURL(ORT_MJS).href, wasm: pathToFileURL(ORT_WASM).href };
    } else {
      console.warn('[détourage] moteur WebAssembly introuvable dans', ORT_DIST);
    }
  }
}

const sha256File = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

async function ensureModel() {
  if (fs.existsSync(MODEL_PATH)) return MODEL_PATH;
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  downloading = true;
  const tmp = MODEL_PATH + '.part';
  try {
    const res = await fetch(MODEL.url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`téléchargement du modèle impossible (${res.status})`);
    const out = fs.createWriteStream(tmp);
    for await (const chunk of res.body) if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    if ((await sha256File(tmp)) !== MODEL.sha256) throw new Error('modèle de détourage refusé : empreinte incorrecte');
    fs.renameSync(tmp, MODEL_PATH);
    return MODEL_PATH;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  } finally {
    downloading = false;
  }
}

function session() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      libs();
      await ensureModel();
      return ort.InferenceSession.create(MODEL_PATH, { executionProviders: ['wasm'] });
    })().catch((err) => { sessionPromise = null; throw err; });
  }
  return sessionPromise;
}

// Masque de 0 à 255 (255 = produit) à la taille de la photo
async function maskFor(rgb, width, height) {
  const S = MODEL.size;
  const small = await sharp(rgb, { raw: { width, height, channels: 3 } }).resize(S, S, { fit: 'fill' }).raw().toBuffer();
  const n = S * S;
  const data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[c * n + i] = (small[i * 3 + c] / 255 - MODEL.mean[c]) / MODEL.std[c];
  const s = await session();
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, S, S]) });
  const v = out[s.outputNames[0]].data;
  let mn = Infinity; let mx = -Infinity;
  for (let i = 0; i < n; i++) { if (v[i] < mn) mn = v[i]; if (v[i] > mx) mx = v[i]; }
  const range = mx - mn || 1;
  const m = Buffer.alloc(n);
  for (let i = 0; i < n; i++) m[i] = Math.round(((v[i] - mn) / range) * 255);
  const { data: alpha } = await sharp(m, { raw: { width: S, height: S, channels: 1 } })
    .resize(width, height, { fit: 'fill' }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  return alpha;
}

/**
 * Retire l'arrière-plan d'une photo (Buffer JPG/PNG/WebP) et renvoie une photo JPEG carrée :
 * produit centré sur fond blanc avec une marge. { buffer, found } — found = false si aucun produit n'a été détecté.
 */
async function removeBackground(input) {
  const job = queue.then(() => run(input));
  queue = job.catch(() => {});
  return job;
}

async function run(input) {
  libs();
  const { data: rgb, info } = await sharp(input).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const alpha = await maskFor(rgb, width, height);

  // Fond blanc + cadrage sur le produit (zone où le masque est franc)
  const out = Buffer.alloc(width * height * 3);
  let x0 = width; let y0 = height; let x1 = -1; let y1 = -1;
  for (let p = 0, i = 0; p < alpha.length; p++, i += 3) {
    const a = alpha[p] / 255;
    out[i] = Math.round(rgb[i] * a + 255 * (1 - a));
    out[i + 1] = Math.round(rgb[i + 1] * a + 255 * (1 - a));
    out[i + 2] = Math.round(rgb[i + 2] * a + 255 * (1 - a));
    if (alpha[p] > 128) { const x = p % width; const y = (p / width) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const found = x1 > x0 && y1 > y0 && (x1 - x0) * (y1 - y0) > width * height * 0.01;
  let img = sharp(out, { raw: { width, height, channels: 3 } });
  if (found) {
    const w = x1 - x0 + 1; const h = y1 - y0 + 1;
    const side = Math.round(Math.max(w, h) * 1.16); // 8 % de marge de chaque côté
    const cropped = await img.extract({ left: x0, top: y0, width: w, height: h }).png().toBuffer();
    img = sharp({ create: { width: side, height: side, channels: 3, background: '#ffffff' } })
      .composite([{ input: cropped, left: Math.round((side - w) / 2), top: Math.round((side - h) / 2) }]);
    const square = await img.png().toBuffer();
    img = sharp(square).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true });
  }
  const buffer = await img.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return { buffer, found };
}

const status = () => ({ ready: fs.existsSync(MODEL_PATH), downloading, modelSizeMb: 170 });

module.exports = { removeBackground, status, MODEL };
