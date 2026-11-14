// Bon de commande en PDF, joint à l'e-mail envoyé au client (décision Joseph 14/11/2026).
// Même contenu que la page /api/documents/<id> (billing.js) : société, client, livraison, articles, totaux, coût logistique
// estimatif, comment payer. pdfkit (MIT) + Plus Jakarta Sans en graisses fixes (src/pdf-fonts, licence OFL : la police
// variable du site ne passe pas dans pdfkit). Logo Zado converti en PNG par sharp (déjà utilisé pour les photos).
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const FONTS = path.join(__dirname, 'pdf-fonts');
const NAVY = '#10264A', INK = '#0E1424', MUTED = '#5F6B80', LINE = '#DDE3EC', SOFT = '#F3F5F9', MANGO = '#FFB300', CREAM = '#FFF8E6', GREEN = '#0E8A66';
const fcfa = (n) => `${Math.round(n || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;
const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Brazzaville', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
// La police (sous-ensemble latin) n'a ni flèches ni coches : remplacées
const clean = (s) => String(s ?? '').replace(/→/g, '-').replace(/[✓✔]/g, '').replace(/[  ]/g, ' ');

let LOGO = null;
async function logoPng() {
  if (LOGO !== null) return LOGO;
  try {
    const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'logo-zado.svg'));
    LOGO = await require('sharp')(svg, { density: 300 }).resize({ height: 120 }).png().toBuffer();
  } catch { LOGO = false; }
  return LOGO;
}

/** PDF (Buffer) d'un document « bon de commande » (type order de billing.js). */
async function orderPdf(d) {
  const billing = require('./billing');
  const st = billing.orderState(d);
  const c = d.company || billing.company();
  const logo = await logoPng();
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Bon de commande ${d.number}`, Author: c.name || 'Zado' } });
  doc.registerFont('R', path.join(FONTS, 'plus-jakarta-sans-latin-400-normal.woff'));
  doc.registerFont('S', path.join(FONTS, 'plus-jakarta-sans-latin-600-normal.woff'));
  doc.registerFont('B', path.join(FONTS, 'plus-jakarta-sans-latin-700-normal.woff'));
  const chunks = [];
  doc.on('data', (b) => chunks.push(b));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const L = 40, R = 555, W = R - L;

  // Liseré de marque
  doc.rect(0, 0, 298, 5).fill(NAVY); doc.rect(298, 0, 150, 5).fill('#FF5A3C'); doc.rect(448, 0, 147, 5).fill(MANGO);

  // En-tête : logo + société / titre + numéro
  let y = 34;
  if (logo) doc.image(logo, L, y, { height: 30 }); else doc.font('B').fontSize(22).fillColor(NAVY).text('zado', L, y);
  const co = [c.name ? `${c.name}${c.legalForm ? ` - ${c.legalForm}` : ''}` : 'Zado',
    [c.address, c.city, c.country].filter(Boolean).join(', '),
    [c.rccm && `RCCM : ${c.rccm}`, c.niu && `NIU : ${c.niu}`].filter(Boolean).join(' · '),
    [c.phone && `Tél. : ${c.phone}`, c.email, c.website].filter(Boolean).join(' · ')].filter(Boolean);
  doc.font('R').fontSize(8.5).fillColor(MUTED);
  let cy = y + 38; for (const line of co) { doc.text(clean(line), L, cy, { width: 260 }); cy = doc.y + 1; }
  doc.font('B').fontSize(20).fillColor(NAVY).text('BON DE COMMANDE', 300, y, { width: R - 300, align: 'right' });
  doc.font('B').fontSize(11).fillColor(INK).text(`N° ${d.number}`, 300, y + 28, { width: R - 300, align: 'right' });
  doc.font('R').fontSize(9).fillColor(MUTED).text(`Émis le ${dateFr(d.issuedAt)} · Commande ${d.orderId}`, 300, y + 44, { width: R - 300, align: 'right' });
  const stamp = st.cancelled ? ['Annulée', '#FFE6DF', '#C62E1F'] : st.paid ? ['Payée · confirmée', '#E1F5EC', GREEN] : ['En attente de paiement', '#FFF1CC', '#8A5A00'];
  doc.font('B').fontSize(8.5); const sw = doc.widthOfString(stamp[0]) + 18;
  doc.roundedRect(R - sw, y + 60, sw, 17, 8.5).fill(stamp[1]); doc.fillColor(stamp[2]).text(stamp[0], R - sw, y + 64.5, { width: sw, align: 'center' });

  // Client / livraison
  y = Math.max(cy, y + 86) + 14;
  const boxW = (W - 12) / 2;
  const box = (x, title, lines) => {
    doc.roundedRect(x, y, boxW, 74, 8).fill(SOFT);
    doc.font('S').fontSize(7.5).fillColor(MUTED).text(title.toUpperCase(), x + 12, y + 10, { characterSpacing: 0.6 });
    let ly = y + 24;
    lines.forEach(([t, bold], i) => { doc.font(bold ? 'B' : 'R').fontSize(9.5).fillColor(INK).text(clean(t), x + 12, ly, { width: boxW - 24, ellipsis: true, height: 12 }); ly += 12.5; if (i > 3) return; });
  };
  box(L, 'Client', [[d.customer.name, true], [d.customer.phone], d.email ? [d.email] : null].filter(Boolean));
  box(L + boxW + 12, d.fulfillment === 'pickup' ? 'Retrait' : 'Livraison à domicile',
    [[d.customer.address || '-'], [d.customer.city || 'Pointe-Noire'], d.gift?.name ? [`Cadeau pour : ${d.gift.name}`] : null].filter(Boolean));
  y += 90;

  // Articles
  const cols = [L, L + 300, L + 345, L + 430]; // désignation, qté, prix unitaire, total
  doc.roundedRect(L, y, W, 22, 6).fill(NAVY);
  doc.font('S').fontSize(8).fillColor('#FFFFFF');
  doc.text('DÉSIGNATION', cols[0] + 10, y + 7); doc.text('QTÉ', cols[1], y + 7, { width: 35, align: 'right' });
  doc.text('PRIX UNITAIRE', cols[2], y + 7, { width: 80, align: 'right' }); doc.text('TOTAL', cols[3], y + 7, { width: R - cols[3] - 10, align: 'right' });
  y += 28;
  for (const l of d.lines) {
    const name = clean(l.name) + (l.variant ? `\n${clean(l.variant)}` : '');
    doc.font('R').fontSize(9.5);
    const h = Math.max(16, doc.heightOfString(name, { width: 285 }) + 4);
    if (y + h > 760) { doc.addPage(); y = 50; }
    doc.fillColor(INK).text(name, cols[0] + 10, y, { width: 285 });
    doc.text(String(l.qty), cols[1], y, { width: 35, align: 'right' });
    doc.text(fcfa(l.unitPrice), cols[2], y, { width: 80, align: 'right' });
    doc.font('S').text(fcfa(l.total), cols[3], y, { width: R - cols[3] - 10, align: 'right' });
    y += h + 4; doc.moveTo(L, y - 3).lineTo(R, y - 3).lineWidth(0.6).strokeColor(LINE).stroke();
  }

  // Totaux
  y += 6;
  const tot = [];
  if (d.deliveryFee || d.transportFee || d.discount) tot.push(['Articles', fcfa(d.subtotal)]);
  if (d.discount) tot.push([`Remise (code ${d.discount.code})`, `- ${fcfa(d.discount.amount)}`]);
  if (d.transportFee) tot.push(['Transport France - Pointe-Noire*', fcfa(d.transportFee)]);
  if (d.deliveryFee) tot.push(['Livraison', fcfa(d.deliveryFee)]);
  const TX = L + 270;
  for (const [k, v] of tot) { doc.font('R').fontSize(9.5).fillColor(INK).text(k, TX, y, { width: 170 }); doc.text(v, TX + 170, y, { width: R - TX - 170 - 10, align: 'right' }); y += 15; }
  doc.moveTo(TX, y + 2).lineTo(R, y + 2).lineWidth(1.5).strokeColor(NAVY).stroke(); y += 8;
  doc.font('B').fontSize(13).fillColor(NAVY).text('Total', TX, y); doc.text(fcfa(d.total), TX + 120, y, { width: R - TX - 120 - 10, align: 'right' });
  y += 24;
  if (d.transportFee) { doc.font('R').fontSize(8).fillColor(MUTED).text('* Coût logistique estimatif : selon le rapport poids / volume du colis, il peut être ajusté.', L, y, { width: W }); y = doc.y + 10; }

  // Comment payer
  if (y > 640) { doc.addPage(); y = 50; }
  const payLines = [];
  if (st.cancelled) payLines.push(['B', 'Commande annulée'], ['R', clean(st.o?.cancelReason || 'Cette commande a été annulée.')]);
  else if (st.paid) payLines.push(['B', 'Paiement reçu : commande confirmée'], ['R', 'Merci ! Votre commande est en cours de traitement. Suivez chaque étape sur le site (Mon compte > Mes commandes).']);
  else {
    payLines.push(['B', 'Comment payer votre commande'], ['S', `Montant à envoyer : ${fcfa(st.due)}`]);
    if (st.all.length) {
      payLines.push(['R', `Faites un dépôt Mobile Money au numéro de ${st.holder} :`]);
      for (const [op, n] of st.all) payLines.push(['B', `${require('./mobile-pay').spaced(n)} - ${op === 'mtn' ? 'MTN Mobile Money' : 'Airtel Money'}`]);
    } else payLines.push(['R', `Le paiement se fait par dépôt Mobile Money (MTN ou Airtel) sur le numéro officiel de ${st.holder}. Ce numéro vous sera communiqué très prochainement sur le site (rubrique « Aide »)${d.email ? ', par e-mail' : ''} et par WhatsApp.`]);
    payLines.push(['R', `1. Indiquez la référence ${d.orderId} avec votre dépôt.`],
      ['R', `2. Dès réception, vous recevez la confirmation de commande sur le site${d.email ? ', par e-mail' : ''} et par WhatsApp.`],
      ['R', '3. Nous lançons alors le traitement : achat en France, vol vers Pointe-Noire, puis livraison.'],
      ['S', `Ne payez jamais à un autre numéro que celui indiqué par ${st.holder}.`]);
  }
  let ph = 24; for (const [f, t] of payLines) { doc.font(f).fontSize(f === 'B' && payLines[0][1] === t ? 12 : 9.5); ph += doc.heightOfString(t, { width: W - 32 }) + 4; }
  const ok = st.paid && !st.cancelled;
  doc.roundedRect(L, y, W, ph, 10).lineWidth(1.6).fillAndStroke(ok ? '#E1F5EC' : CREAM, ok ? GREEN : MANGO);
  let py = y + 12;
  payLines.forEach(([f, t], i) => { doc.font(f).fontSize(i === 0 ? 12 : 9.5).fillColor(i === 0 ? NAVY : INK).text(t, L + 16, py, { width: W - 32 }); py = doc.y + 4; });
  y += ph + 14;

  doc.font('R').fontSize(8).fillColor(MUTED).text("Ce bon de commande récapitule votre achat ; ce n'est pas une facture. La facture vous est remise après le paiement.", L, y, { width: W });
  doc.font('R').fontSize(7.5).fillColor(MUTED).text(clean(`${c.footer || ''}${c.footer ? ' · ' : ''}${c.name || 'Zado'} · ${d.number}`), L, 790, { width: W, align: 'center', lineBreak: false });
  doc.end();
  return done;
}

module.exports = { orderPdf };
