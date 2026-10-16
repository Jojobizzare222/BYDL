// Lecture automatique de la pièce d'identité (comme LinkedIn / Persona, version gratuite) :
// les passeports (et les cartes d'identité récentes) portent une « zone de lecture automatique » (MRZ, norme
// OACI 9303) : 2 ou 3 lignes en bas, avec des chevrons « <<< ». On la lit (reconnaissance de texte Tesseract,
// licence Apache 2.0, sur le serveur) puis on CONTRÔLE ses chiffres de contrôle : une lecture qui passe les
// contrôles est fiable. Résultat : nom, numéro, dates, nationalité + comparaison avec le compte du client.
// L'admin garde la décision finale (une photo truquée peut porter une MRZ valide).
// Les données de lecture (« eng ») sont téléchargées au premier usage dans data/models/tesseract (hors Git).
const path = require('path');
const fs = require('fs');

const CACHE = process.env.MODEL_DIR ? path.join(process.env.MODEL_DIR, 'tesseract')
  : process.env.VERCEL ? '/tmp/kamwa-models/tesseract' : path.join(__dirname, '..', '..', 'data', 'models', 'tesseract');

// ---------- Contrôles OACI 9303 ----------
const VAL = (c) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
function checkDigit(s) {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += VAL(s[i]) * w[i % 3];
  return String(sum % 10);
}
const ok = (field, digit) => /^[0-9<]$/.test(digit) && checkDigit(field) === (digit === '<' ? '0' : digit);

// Champ mêlant lettres et chiffres (numéro, données facultatives) : si le contrôle échoue, on essaie les confusions
// classiques de lecture (Z/2, O/0, I/1, S/5, B/8, G/6) et on ne garde qu'une version qui PASSE le chiffre de contrôle.
const SWAP = { Z: '2', 2: 'Z', O: '0', 0: 'O', I: '1', 1: 'I', S: '5', 5: 'S', B: '8', 8: 'B', G: '6', 6: 'G', D: '0', Q: '0' };
function repair(field, digit, check = (f) => ok(f, digit)) {
  if (check(field)) return field;
  const pos = [...field].map((c, i) => (SWAP[c] ? i : -1)).filter((i) => i >= 0).slice(0, 10);
  for (let mask = 1; mask < 1 << pos.length; mask++) {
    const arr = [...field];
    pos.forEach((p, k) => { if (mask & (1 << k)) arr[p] = SWAP[arr[p]]; });
    const f = arr.join('');
    if (check(f)) return f;
  }
  return field;
}
// Remplissage « <<<< » parfois lu « LLLL », « KKKK » ou « CCCC » en fin de ligne
const fixFiller = (l) => l.replace(/([<LKC]{4,})$/, (m) => (m.includes('<') ? '<'.repeat(m.length) : m)).replace(/<[LKC](?=<)/g, '<<');

// Confusions fréquentes de la lecture : lettres dans les zones de chiffres et inversement
const toDigits = (s) => s.replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/B/g, '8').replace(/G/g, '6');
const toLetters = (s) => s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B');
const names = (s) => {
  const [sur, given = ''] = s.split('<<');
  const clean = (x) => toLetters(x).replace(/<+/g, ' ').trim();
  return { surname: clean(sur), givenNames: clean(given) };
};
function date(yymmdd, future) {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const now = new Date().getFullYear() % 100;
  const century = future ? 2000 : yy > now ? 1900 : 2000;
  return `${century + yy}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

function parseTD3(l1, l2) { // passeport : 2 lignes de 44
  const num = repair(l2.slice(0, 9), toDigits(l2[9])), birth = toDigits(l2.slice(13, 19)), exp = toDigits(l2.slice(21, 27));
  const head = num + toDigits(l2[9]) + birth + toDigits(l2[19]) + exp + toDigits(l2[27]);
  const opt = repair(l2.slice(28, 43), null, (f) => ok(head + f, toDigits(l2[43])));
  l2 = num + l2.slice(9, 28) + opt + l2.slice(43);
  const comp = l2.slice(0, 10) + birth + toDigits(l2[19]) + exp + toDigits(l2[27]) + l2.slice(28, 43);
  const checks = { number: ok(num, toDigits(l2[9])), birth: ok(birth, toDigits(l2[19])), expiry: ok(exp, toDigits(l2[27])), composite: ok(comp, toDigits(l2[43])) };
  return { format: 'TD3', documentCode: l1.slice(0, 2).replace(/<+$/, ''), issuer: toLetters(l1.slice(2, 5)), ...names(l1.slice(5)),
    documentNumber: num.replace(/<+$/, ''), nationality: toLetters(l2.slice(10, 13)), birthDate: date(birth), sex: l2[20], expiryDate: date(exp, true), checks };
}
function parseTD1(l1, l2, l3) { // carte d'identité : 3 lignes de 30
  const num = repair(l1.slice(5, 14), toDigits(l1[14])), birth = toDigits(l2.slice(0, 6)), exp = toDigits(l2.slice(8, 14));
  l1 = l1.slice(0, 5) + num + l1.slice(14);
  const tail = birth + toDigits(l2[6]) + exp + toDigits(l2[14]);
  const opt1 = repair(l1.slice(15, 30), null, (f) => ok(l1.slice(5, 15) + f + tail + l2.slice(18, 29), toDigits(l2[29])));
  l1 = l1.slice(0, 15) + opt1;
  const comp = l1.slice(5, 30) + birth + toDigits(l2[6]) + exp + toDigits(l2[14]) + l2.slice(18, 29);
  const checks = { number: ok(num, toDigits(l1[14])), birth: ok(birth, toDigits(l2[6])), expiry: ok(exp, toDigits(l2[14])), composite: ok(comp, toDigits(l2[29])) };
  return { format: 'TD1', documentCode: l1.slice(0, 2).replace(/<+$/, ''), issuer: toLetters(l1.slice(2, 5)), ...names(l3),
    documentNumber: num.replace(/<+$/, ''), nationality: toLetters(l2.slice(15, 18)), birthDate: date(birth), sex: l2[7], expiryDate: date(exp, true), checks };
}
function parseTD2(l1, l2) { // 2 lignes de 36
  const num = repair(l2.slice(0, 9), toDigits(l2[9])); l2 = num + l2.slice(9);
  const birth = toDigits(l2.slice(13, 19)), exp = toDigits(l2.slice(21, 27));
  const comp = l2.slice(0, 10) + birth + toDigits(l2[19]) + exp + toDigits(l2[27]) + l2.slice(28, 35);
  const checks = { number: ok(num, toDigits(l2[9])), birth: ok(birth, toDigits(l2[19])), expiry: ok(exp, toDigits(l2[27])), composite: ok(comp, toDigits(l2[35])) };
  return { format: 'TD2', documentCode: l1.slice(0, 2).replace(/<+$/, ''), issuer: toLetters(l1.slice(2, 5)), ...names(l1.slice(5)),
    documentNumber: num.replace(/<+$/, ''), nationality: toLetters(l2.slice(10, 13)), birthDate: date(birth), sex: l2[20], expiryDate: date(exp, true), checks };
}

/** Cherche une MRZ dans le texte lu. Renvoie la meilleure lecture (le plus de contrôles réussis) ou null. */
function parseMrz(text) {
  const lines = String(text || '').toUpperCase().split(/\n/)
    .map((l) => fixFiller(l.replace(/[«‹(\[{]/g, '<').replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '')))
    .filter((l) => l.length >= 25 && (l.includes('<') || /\d{6}/.test(l)));
  const fit = (l, n) => (l.length >= n ? l.slice(0, n) : l.padEnd(n, '<'));
  const cands = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i], b = lines[i + 1], c = lines[i + 2];
    if (b && a.length >= 40 && b.length >= 40) cands.push(parseTD3(fit(a, 44), fit(b, 44)));
    if (b && a.length >= 33 && a.length < 42 && b.length >= 33) cands.push(parseTD2(fit(a, 36), fit(b, 36)));
    if (b && c && a.length >= 27 && b.length >= 27 && c.length >= 20 && a.length < 34) cands.push(parseTD1(fit(a, 30), fit(b, 30), fit(c, 30)));
  }
  const score = (r) => Object.values(r.checks).filter(Boolean).length;
  return cands.sort((x, y) => score(y) - score(x))[0] || null;
}

// ---------- Lecture de l'image ----------
let workerP = null;
function worker() {
  if (!workerP) {
    workerP = (async () => {
      const { createWorker } = require('tesseract.js');
      fs.mkdirSync(CACHE, { recursive: true });
      const w = await createWorker('eng', 1, { cachePath: CACHE, logger: () => {} });
      await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6', preserve_interword_spaces: '0' });
      return w;
    })().catch((err) => { workerP = null; throw err; });
  }
  return workerP;
}
let queue = Promise.resolve(); // une lecture à la fois (mémoire du serveur)

/** Lit la MRZ d'une photo (Buffer JPEG/PNG). Essaie le bas de l'image puis l'image entière, à l'endroit et retournée. */
async function readMrz(buf) {
  const run = async () => {
    const sharp = require('sharp');
    const w = await worker();
    const base = sharp(buf).rotate().grayscale().normalize();
    const meta = await base.clone().toBuffer({ resolveWithObject: true }).then((r) => r.info);
    const W = 1800;
    const variants = [];
    for (const flip of [0, 180]) {
      const img = sharp(await base.clone().rotate(flip).resize({ width: W, withoutEnlargement: false }).toBuffer());
      const h = Math.round((meta.height / meta.width) * W);
      variants.push(img.clone().extract({ left: 0, top: Math.round(h * 0.55), width: W, height: h - Math.round(h * 0.55) }));
      variants.push(img.clone());
    }
    let best = null;
    for (const v of variants) {
      const png = await v.sharpen().png().toBuffer();
      const { data } = await w.recognize(png);
      const r = parseMrz(data.text);
      if (r && (!best || Object.values(r.checks).filter(Boolean).length > Object.values(best.checks).filter(Boolean).length)) best = r;
      if (best && Object.values(best.checks).every(Boolean)) break;
    }
    return best;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ---------- Pièces SANS zone MRZ (NIU, certaines CNI) : lecture du texte imprimé ----------
let textWorkerP = null;
function textWorker() {
  if (!textWorkerP) {
    textWorkerP = (async () => {
      const { createWorker } = require('tesseract.js');
      fs.mkdirSync(CACHE, { recursive: true });
      return createWorker('fra', 1, { cachePath: CACHE, logger: () => {} });
    })().catch((err) => { textWorkerP = null; throw err; });
  }
  return textWorkerP;
}
async function readText(buf) {
  const run = async () => {
    const sharp = require('sharp');
    const w = await textWorker();
    const png = await sharp(buf).rotate().grayscale().normalize().resize({ width: 2000, withoutEnlargement: false }).sharpen().png().toBuffer();
    const { data } = await w.recognize(png);
    return data.text || '';
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
const flat = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
// Indices recherchés dans le texte : pays, type de pièce, nom du client, numéro saisi, date d'expiration
const KINDS = {
  passeport: [/PASSEPORT/, /PASSPORT/],
  cni: [/CARTE NATIONALE/, /CARTE D.?IDENTITE/, /NATIONAL IDENTITY/, /IDENTITY CARD/],
  niu: [/\bNIU\b/, /IDENTIFI\w* UNIQUE/, /IMPOTS/, /CONTRIBUABLE/, /FISCAL/, /DGID|DGI\b/],
};
function textReport(text, customer) {
  const T = flat(text);
  const words = new Set(T.replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/));
  const accountNames = norm(customer.name);
  const matched = accountNames.filter((n) => words.has(n)).length;
  const nameMatch = accountNames.length ? (matched === accountNames.length ? 'yes' : matched > 0 ? 'partial' : 'no') : 'no';
  const congo = /CONGO/.test(T);
  const kinds = Object.keys(KINDS).filter((k) => KINDS[k].some((re) => re.test(T)));
  const typeOk = kinds.length ? kinds.includes(customer.idType) : null;
  const num = String(customer.idNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const numberFound = num.length >= 4 ? T.replace(/[^A-Z0-9]/g, '').includes(num) : null;
  // Dates jj/mm/aaaa ; la date d'expiration est celle qui suit « expire / validité / valable » (sinon : la plus lointaine)
  const dates = [...T.matchAll(/(\d{2})[./ -](\d{2})[./ -]((?:19|20)\d{2})/g)].map((m) => ({ iso: `${m[3]}-${m[2]}-${m[1]}`, at: m.index }));
  const kw = T.search(/EXPIR|VALIDIT|VALABLE|FIN DE VALIDITE/);
  const near = kw >= 0 ? dates.find((d) => d.at > kw && d.at - kw < 80) : null;
  const expiryDate = near ? near.iso : null;
  const expired = expiryDate ? expiryDate < new Date().toISOString().slice(0, 10) : null;
  const readable = T.replace(/[^A-Z]/g, '').length > 40;
  const flags = [];
  if (!readable) flags.push('Texte presque illisible : photo floue, trop sombre ou trop petite');
  if (readable && nameMatch === 'no') flags.push('Le nom du compte n\'apparaît pas sur la pièce');
  if (nameMatch === 'partial') flags.push('Nom en partie retrouvé seulement');
  if (typeOk === false) flags.push(`La pièce ressemble à : ${kinds.map((k) => ({ passeport: 'passeport', cni: 'CNI', niu: 'NIU' })[k]).join(', ')} (le client a choisi un autre type)`);
  if (numberFound === false) flags.push('Le numéro saisi par le client n\'apparaît pas sur la pièce');
  if (expired) flags.push('Pièce expirée');
  if (readable && !congo) flags.push('« Congo » introuvable sur la pièce');
  return {
    read: readable, method: 'text', nameMatch, typeOk, numberFound, congo, kinds, expired, flags,
    fields: { expiryDate },
    summary: !readable ? flags[0] : flags.length ? flags.join(' · ') : 'Lecture du texte : nom, type de pièce et numéro retrouvés.',
  };
}

/** Contrôle complet d'une photo : zone MRZ d'abord (passeport, CNI récente), sinon lecture du texte (NIU, CNI sans MRZ). */
async function analyzeDocument(buf, customer) {
  const mrz = customer.idType === 'niu' ? null : await readMrz(buf).catch(() => null);
  const good = mrz && Object.values(mrz.checks).filter(Boolean).length >= 2;
  if (good) return { ...report(mrz, customer), method: 'mrz' };
  const text = await readText(buf).catch(() => '');
  return textReport(text, customer);
}

// ---------- Comparaison avec le compte ----------
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((x) => x.length > 1);
const TYPE_CODES = { passeport: ['P'], cni: ['I', 'ID', 'IR', 'A', 'C'], niu: [] };

/** Rapport de contrôle à montrer à l'admin. */
function report(mrz, customer) {
  if (!mrz) return { read: false, summary: customer.idType === 'niu' ? 'Pas de zone de lecture automatique (normal pour un NIU) : vérifiez à l\'œil.' : 'Zone de lecture automatique introuvable ou illisible : vérifiez à l\'œil.' };
  const allChecks = Object.values(mrz.checks).every(Boolean);
  const mrzNames = new Set([...norm(mrz.surname), ...norm(mrz.givenNames)]);
  const accountNames = norm(customer.name);
  const matched = accountNames.filter((n) => mrzNames.has(n)).length;
  const nameMatch = accountNames.length ? (matched === accountNames.length ? 'yes' : matched > 0 ? 'partial' : 'no') : 'no';
  const expired = mrz.expiryDate ? mrz.expiryDate < new Date().toISOString().slice(0, 10) : null;
  const typeOk = !TYPE_CODES[customer.idType]?.length || TYPE_CODES[customer.idType].some((c) => mrz.documentCode.startsWith(c));
  const age = mrz.birthDate ? Math.floor((Date.now() - Date.parse(mrz.birthDate)) / (365.25 * 864e5)) : null;
  const flags = [];
  if (!allChecks) flags.push('Chiffres de contrôle incorrects : lecture douteuse ou document falsifié');
  if (nameMatch === 'no') flags.push('Le nom ne correspond pas au compte');
  if (nameMatch === 'partial') flags.push('Nom en partie différent du compte');
  if (expired) flags.push('Pièce expirée');
  if (!typeOk) flags.push('Le type de document ne correspond pas au choix du client');
  if (age !== null && age < 18) flags.push('Client mineur');
  return {
    read: true, allChecks, nameMatch, expired, typeOk, age, flags,
    fields: { format: mrz.format, documentCode: mrz.documentCode, issuer: mrz.issuer, surname: mrz.surname, givenNames: mrz.givenNames,
      documentNumber: mrz.documentNumber, nationality: mrz.nationality, birthDate: mrz.birthDate, sex: mrz.sex, expiryDate: mrz.expiryDate },
    checks: mrz.checks,
    summary: allChecks && !flags.length ? 'Lecture automatique réussie : tout concorde.' : flags.join(' · '),
  };
}

module.exports = { readMrz, parseMrz, report, checkDigit, analyzeDocument, textReport };
