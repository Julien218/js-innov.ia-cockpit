const PDFDocument = require('pdfkit');
const path = require('path');

const A4 = { width: 595.28, height: 841.89 };
const M = 26;
const CONTENT_W = A4.width - M * 2;
const BILLING_ASSETS = path.join(__dirname, 'assets', 'billing');
const LOGO = path.join(BILLING_ASSETS, 'logo-phoenix-officiel.png');
const SIGNATURE = path.join(BILLING_ASSETS, 'signature-julien.png');
const SERVICE_ICONS = ['001', '002', '003', '004', '005']
  .map(id => path.join(BILLING_ASSETS, `service-${id}.png`));

const C = {
  ink: '#091321',
  gold: '#d48700',
  goldLight: '#efb12d',
  text: '#151922',
  muted: '#5b606a',
  line: '#e8c47e',
  soft: '#f7f7f5',
  white: '#ffffff',
};

function money(value) {
  return new Intl.NumberFormat('fr-BE', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function date(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  return parsed.toLocaleDateString('fr-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
}

const ONES = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];

function underHundred(n) {
  if (n < 20) return ONES[n];
  if (n < 70) {
    const t = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'][Math.floor(n / 10)];
    const u = n % 10;
    return t + (u === 1 ? ' et un' : u ? `-${ONES[u]}` : '');
  }
  if (n < 80) return `soixante-${ONES[n - 60]}`;
  const rest = n - 80;
  return `quatre-vingt${rest ? `-${ONES[rest]}` : 's'}`;
}

function underThousand(n) {
  if (n < 100) return underHundred(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const head = h === 1 ? 'cent' : `${ONES[h]} cent${rest ? '' : 's'}`;
  return rest ? `${head} ${underHundred(rest)}` : head;
}

function words(value) {
  const amount = Math.round(Number(value || 0));
  if (!amount) return 'ZÉRO EURO TTC';
  let result;
  if (amount < 1000) result = underThousand(amount);
  else {
    const thousands = Math.floor(amount / 1000);
    const rest = amount % 1000;
    result = `${thousands === 1 ? '' : `${underThousand(thousands)} `}mille${rest ? ` ${underThousand(rest)}` : ''}`;
  }
  return `${result.toUpperCase()} EURO${amount > 1 ? 'S' : ''} TTC`;
}

function text(pdf, value, x, y, options = {}) {
  const { size = 8, color = C.text, font = 'Helvetica', ...rest } = options;
  pdf.font(font).fontSize(size).fillColor(color).text(String(value ?? ''), x, y, { characterSpacing: 0, ...rest });
}

function line(pdf, x1, y1, x2, y2, color = C.line, width = 0.6) {
  pdf.save().strokeColor(color).lineWidth(width).moveTo(x1, y1).lineTo(x2, y2).stroke().restore();
}

function rounded(pdf, x, y, w, h, radius = 4, color = C.line, width = 0.7) {
  pdf.save().roundedRect(x, y, w, h, radius).strokeColor(color).lineWidth(width).stroke().restore();
}

function pinIcon(pdf, x, y) {
  pdf.save().strokeColor(C.gold).lineWidth(1.1).circle(x, y, 5).stroke().circle(x, y, 1.5).stroke();
  pdf.moveTo(x - 3.5, y + 3.5).lineTo(x, y + 8).lineTo(x + 3.5, y + 3.5).stroke().restore();
}

function phoneIcon(pdf, x, y) {
  pdf.save().strokeColor(C.gold).lineWidth(1.1).moveTo(x - 4, y - 5).bezierCurveTo(x - 7, y, x, y + 8, x + 5, y + 4).stroke();
  pdf.rect(x - 5, y - 6, 3, 4).stroke().rect(x + 3, y + 2, 3, 4).stroke().restore();
}

function mailIcon(pdf, x, y) {
  pdf.save().strokeColor(C.gold).lineWidth(1).rect(x - 6, y - 4, 12, 8).stroke();
  pdf.moveTo(x - 6, y - 4).lineTo(x, y + 1).lineTo(x + 6, y - 4).stroke().restore();
}

function globeIcon(pdf, x, y) {
  pdf.save().strokeColor(C.gold).lineWidth(0.9).circle(x, y, 6).stroke();
  pdf.ellipse(x, y, 2.5, 6).stroke().moveTo(x - 6, y).lineTo(x + 6, y).stroke().restore();
}

function docIcon(pdf, x, y) {
  pdf.save().strokeColor(C.gold).lineWidth(1).rect(x - 4, y - 6, 8, 12).stroke();
  pdf.moveTo(x - 2, y - 2).lineTo(x + 2, y - 2).moveTo(x - 2, y + 1).lineTo(x + 2, y + 1).stroke().restore();
}

function bankIcon(pdf, x, y) {
  pdf.save().strokeColor(C.gold).lineWidth(1).moveTo(x - 8, y - 4).lineTo(x, y - 9).lineTo(x + 8, y - 4).closePath().stroke();
  [-5, 0, 5].forEach(dx => pdf.moveTo(x + dx, y - 3).lineTo(x + dx, y + 5));
  pdf.stroke().moveTo(x - 9, y + 6).lineTo(x + 9, y + 6).stroke().restore();
}

function drawHeader(pdf, doc, type) {
  // Subtle geometric background, faithful to the white/grey official template.
  pdf.save().fillColor('#fafafa').rect(0, 0, A4.width, 205).fill();
  pdf.fillColor('#f2f2f1').polygon([0, 0], [112, 0], [0, 96]).fill();
  pdf.fillColor('#f5f5f4').polygon([A4.width - 80, 0], [A4.width, 0], [A4.width, 92]).fill();
  pdf.fillColor(C.goldLight).polygon([A4.width - 47, 0], [A4.width, 0], [A4.width, 48]).fill().restore();

  pdf.image(LOGO, 31, 26, { width: 92, height: 92 });
  text(pdf, 'JS-Innov.', 140, 38, { size: 27, font: 'Times-Bold', color: C.ink, width: 134 });
  text(pdf, 'IA', 267, 38, { size: 27, font: 'Times-Bold', color: C.gold, width: 38 });
  text(pdf, '®', 304, 39, { size: 8, font: 'Helvetica-Bold', color: C.ink });
  text(pdf, 'Julien Pagin', 186, 72, { size: 13, font: 'Helvetica-Oblique', color: C.gold, width: 110, align: 'center' });
  text(pdf, "AUTOMATISATION INTELLIGENTE, AMPLIFIÉE PAR L’HUMAIN", 138, 98, {
    size: 6.6, font: 'Helvetica-Bold', color: C.text, width: 180, align: 'center', characterSpacing: 0.25,
  });
  line(pdf, 205, 112, 257, 112, C.gold, 0.7);

  line(pdf, 374, 27, 374, 181, C.gold, 0.7);
  text(pdf, type === 'facture' ? 'FACTURE' : 'DEVIS', 397, 40, {
    size: 23, font: 'Helvetica-Bold', color: C.ink, width: 160,
  });
  line(pdf, 397, 67, 500, 67, C.gold, 0.7);

  const rows = type === 'facture'
    ? [
      ['N° DE FACTURE', String(doc.numero || '—').toUpperCase(), true],
      ['DATE DE FACTURATION', date(doc.date_emission || doc.created_at)],
      ["DATE D’ÉCHÉANCE", date(doc.date_echeance)],
      ['PÉRIODE', doc.periode || '—'],
    ]
    : [
      ['N° DE DEVIS', String(doc.numero || '—').toUpperCase(), true],
      ['DATE DU DEVIS', date(doc.date_emission || doc.created_at)],
      ["VALABLE JUSQU’AU", date(doc.date_validite)],
      ['RÉFÉRENCE', doc.reference || '—'],
    ];
  rows.forEach(([label, value, hi], i) => {
    const y = 84 + i * 23;
    text(pdf, label, 397, y, { size: 6.7, font: 'Helvetica-Bold', color: C.text, width: 80 });
    text(pdf, value, 480, y, { size: 7.5, font: 'Helvetica-Bold', color: hi ? C.gold : C.text, width: 83, align: 'right' });
  });

  const contactY = 157;
  pinIcon(pdf, 40, contactY + 2);
  text(pdf, 'Pagin Julien\nGrand Rue 52\n7370 Dour, Belgique', 54, contactY - 4, { size: 7.3, lineGap: 2, width: 105 });
  line(pdf, 151, 153, 151, 184, '#e5e5e5', 0.5);
  phoneIcon(pdf, 165, contactY + 1);
  text(pdf, '0494/11.90.90', 178, contactY - 4, { size: 7, width: 88 });
  mailIcon(pdf, 165, contactY + 20);
  text(pdf, 'info@jsinnovia.com', 178, contactY + 15, { size: 6.7, width: 88 });
  line(pdf, 270, 153, 270, 184, '#e5e5e5', 0.5);
  globeIcon(pdf, 284, contactY + 1);
  text(pdf, 'www.jsinnovia.com', 297, contactY - 4, { size: 6.7, width: 74 });
  docIcon(pdf, 284, contactY + 20);
  text(pdf, 'TVA BE 0877.926.214', 297, contactY + 15, { size: 6.2, width: 74 });
}

function drawClientAndTerms(pdf, doc, type) {
  const y = 226;
  text(pdf, type === 'facture' ? 'FACTURÉ À' : 'DEVIS ÉMIS POUR', M, y, { size: 7, font: 'Helvetica-Bold', color: C.text });
  line(pdf, M, y + 13, M + 24, y + 13, C.gold, 1.5);
  text(pdf, doc.client_nom || '—', M, y + 28, { size: 9.2, font: 'Helvetica-Bold', width: 280 });
  text(pdf, doc.client_adresse || '', M, y + 48, { size: 8, width: 260 });
  text(pdf, doc.client_ville || '', M, y + 65, { size: 8, width: 260 });
  if (doc.client_numero_entreprise) {
    text(pdf, `N° ENTREPRISE : ${doc.client_numero_entreprise}`, M, y + 82, { size: 7.6, width: 260 });
  }
  if (doc.client_tva) {
    text(pdf, `N° TVA : ${doc.client_tva}`, M, y + 96, { size: 7.6, width: 260 });
  }

  const bx = 389;
  rounded(pdf, bx, y - 2, 174, 124, 3, C.gold, 0.6);
  const terms = [
    ['RÉFÉRENCE', doc.objet || doc.reference || 'Prestations JS-Innov.IA'],
    ['MODE DE PAIEMENT', doc.mode_paiement || 'Virement bancaire'],
    ['CONDITIONS DE PAIEMENT', doc.conditions_paiement || 'Paiement à 30 jours'],
  ];
  terms.forEach(([label, value], i) => {
    const ty = y + 11 + i * 39;
    docIcon(pdf, bx + 20, ty + 6);
    text(pdf, label, bx + 40, ty, { size: 6.6, font: 'Helvetica-Bold', width: 120 });
    text(pdf, value, bx + 40, ty + 13, { size: 7.6, width: 120, ellipsis: true, height: 18 });
  });
}

function normalizeItems(doc) {
  if (Array.isArray(doc.items) && doc.items.length) return doc.items;
  return [{
    description: doc.objet || 'Prestation JS-Innov.IA',
    periode: doc.periode || '',
    unit_price_ht: doc.montant_ht || 0,
    tva: doc.tva || 21,
    total_ttc: doc.montant_ttc || 0,
  }];
}

function drawTable(pdf, doc) {
  const items = normalizeItems(doc);
  if (items.length > 5) throw new Error('Le modèle officiel A4 accepte au maximum 5 lignes de prestation. Regroupez les lignes avant génération.');

  const x = M;
  const y = 357;
  const widths = [269, 80, 80, 48, 66];
  const xs = [x];
  widths.slice(0, -1).forEach(w => xs.push(xs[xs.length - 1] + w));
  const headerH = 23;
  const availableH = 172;
  const rowH = Math.min(72, Math.max(40, availableH / items.length));
  const tableH = headerH + rowH * items.length;

  pdf.save().roundedRect(x, y, CONTENT_W, headerH, 5).fill(C.ink).restore();
  const headers = ['DESCRIPTION', 'PÉRIODE', 'PRIX UNIT. HT', 'TVA', 'TOTAL TTC'];
  headers.forEach((h, i) => text(pdf, h, xs[i] + 4, y + 8, {
    size: 6.7, font: 'Helvetica-Bold', color: C.goldLight, width: widths[i] - 8, align: i ? 'center' : 'left',
  }));

  items.forEach((item, index) => {
    const ry = y + headerH + index * rowH;
    if (index % 2) pdf.save().fillColor('#fbfbfa').rect(x, ry, CONTENT_W, rowH).fill().restore();
    line(pdf, x, ry + rowH, x + CONTENT_W, ry + rowH, '#e5e5e5', 0.4);
    xs.slice(1).forEach(cx => line(pdf, cx, ry, cx, ry + rowH, '#e5e5e5', 0.4));

    globeIcon(pdf, x + 18, ry + 20);
    text(pdf, item.description || '—', x + 36, ry + 10, {
      size: 7.7, font: 'Helvetica-Bold', width: widths[0] - 44, height: 20, ellipsis: true,
    });
    if (item.url) text(pdf, item.url, x + 36, ry + 29, {
      size: 7.2, font: 'Helvetica-Bold', color: C.gold, width: widths[0] - 44, height: 13, ellipsis: true,
    });
    if (item.note && rowH >= 58) text(pdf, item.note, x + 36, ry + 44, {
      size: 6.8, color: C.muted, width: widths[0] - 44, height: rowH - 47, ellipsis: true,
    });

    const cy = ry + rowH / 2 - 4;
    text(pdf, item.periode || item.period || doc.periode || '', xs[1] + 5, cy, { size: 7.1, width: widths[1] - 10, align: 'center' });
    text(pdf, money(item.unit_price_ht ?? item.total_ht), xs[2] + 5, cy, { size: 7.2, width: widths[2] - 10, align: 'center' });
    text(pdf, `${item.tva ?? doc.tva ?? 21}%`, xs[3] + 4, cy, { size: 7.2, width: widths[3] - 8, align: 'center' });
    text(pdf, money(item.total_ttc), xs[4] + 4, cy, { size: 7.7, font: 'Helvetica-Bold', color: C.gold, width: widths[4] - 8, align: 'right' });
  });
  rounded(pdf, x, y, CONTENT_W, tableH, 5, C.line, 0.7);
  return y + tableH;
}

function drawTotals(pdf, doc, type, tableBottom) {
  const y = tableBottom + 10;
  text(pdf, type === 'facture' ? 'ARRÊTÉ LA PRÉSENTE FACTURE À LA SOMME DE :' : 'ARRÊTÉ LE PRÉSENT DEVIS À LA SOMME DE :', M, y + 34, {
    size: 7, font: 'Helvetica-Bold', width: 290,
  });
  text(pdf, words(doc.montant_ttc), M, y + 50, { size: 9.2, font: 'Helvetica-Bold', color: C.gold, width: 300 });
  line(pdf, M, y + 69, M + 190, y + 69, C.gold, 0.7);

  const bx = 349;
  const bw = 214;
  rounded(pdf, bx, y, bw, 67, 2, C.line, 0.5);
  text(pdf, 'SOUS-TOTAL HT', bx + 13, y + 8, { size: 7, font: 'Helvetica-Bold', width: 110 });
  text(pdf, money(doc.montant_ht), bx + 120, y + 8, { size: 8, font: 'Helvetica-Bold', width: 80, align: 'right' });
  line(pdf, bx, y + 22, bx + bw, y + 22, '#e5e5e5', 0.4);
  text(pdf, `TVA (${doc.tva ?? 21}%)`, bx + 13, y + 29, { size: 7, font: 'Helvetica-Bold', width: 110 });
  const vat = doc.montant_tva ?? (Number(doc.montant_ttc || 0) - Number(doc.montant_ht || 0));
  text(pdf, money(vat), bx + 120, y + 29, { size: 8, font: 'Helvetica-Bold', width: 80, align: 'right' });
  pdf.save().fillColor(C.gold).rect(bx, y + 44, bw, 23).fill().restore();
  text(pdf, 'TOTAL TTC', bx + 13, y + 50, { size: 8.5, font: 'Helvetica-Bold', color: C.white, width: 90 });
  text(pdf, money(doc.montant_ttc), bx + 110, y + 48, { size: 11.5, font: 'Helvetica-Bold', color: C.white, width: 90, align: 'right' });
  return y + 77;
}

function drawBottom(pdf, doc, startY) {
  const y = Math.min(Math.max(startY, 622), 650);
  rounded(pdf, M, y, 197, 66, 2, C.line, 0.6);
  pdf.save().strokeColor(C.gold).lineWidth(1).circle(M + 15, y + 16, 8).stroke().restore();
  text(pdf, 'i', M + 12.5, y + 10.5, { size: 8, font: 'Helvetica-Bold', color: C.gold });
  text(pdf, 'NOTE', M + 28, y + 10, { size: 7, font: 'Helvetica-Bold' });
  text(pdf, 'Nous vous remercions pour votre confiance.\nPour toute question, n’hésitez pas à nous contacter.', M + 28, y + 25, {
    size: 6.6, lineGap: 2, width: 155,
  });

  const bankX = 241;
  bankIcon(pdf, bankX + 10, y + 13);
  text(pdf, 'COORDONNÉES BANCAIRES', bankX + 25, y + 7, { size: 6.8, font: 'Helvetica-Bold', width: 135 });
  text(pdf, 'Bénéficiaire : Pagin Julien (JS-Innov.IA®)\nIBAN BE52 6528 4346 5909\nIBAN BE20 6508 1271 7456\nBIC : JVBABE22', bankX + 25, y + 21, {
    size: 6.2, font: 'Helvetica-Bold', lineGap: 1.5, width: 150,
  });
  text(pdf, `Communication : ${String(doc.numero || '—').toUpperCase()}`, bankX + 25, y + 59, {
    size: 6.2, font: 'Helvetica-Bold', width: 150,
  });
  line(pdf, 423, y, 423, y + 66, C.line, 0.6);

  text(pdf, 'Julien Pagin', 435, y + 2, { size: 7.5, font: 'Helvetica-Bold', width: 128, align: 'center' });
  pdf.image(SIGNATURE, 454, y + 18, { width: 90, height: 33 });
  text(pdf, 'Fondateur – JS-Innov.IA®', 435, y + 53, { size: 6.5, font: 'Helvetica-Bold', width: 128, align: 'center' });

  const legalY = y + 79;
  line(pdf, M, legalY, A4.width - M, legalY, C.line, 0.5);
  text(pdf, "TVA calculée conformément au règlement 967/2012 du Conseil de l’Union européenne.", M, legalY + 8, {
    size: 6.2, width: CONTENT_W, align: 'center',
  });
  text(pdf, 'En cas de retard de paiement, des intérêts de 1% par mois seront appliqués sur le montant dû.', M, legalY + 19, {
    size: 6.2, width: CONTENT_W, align: 'center',
  });

  // Premium brand footer: the original black/gold pictograms retain their
  // contrast on a deep background instead of appearing washed out on white.
  const footerY = 757;
  const footerH = 71;
  line(pdf, 105, footerY - 10, 151, footerY - 10, C.gold, 0.8);
  line(pdf, 444, footerY - 10, 490, footerY - 10, C.gold, 0.8);
  text(pdf, "L’INTELLIGENCE AU SERVICE DE VOS AMBITIONS", 156, footerY - 14, {
    size: 6.4, font: 'Helvetica-Bold', color: C.ink, width: 283, align: 'center', characterSpacing: 1.05,
  });
  pdf.save().roundedRect(M, footerY, CONTENT_W, footerH, 7).fill('#02070e').restore();
  pdf.save().fillColor(C.gold).roundedRect(M, footerY, CONTENT_W, 2.2, 1).fill().restore();

  const labels = [
    'AUTOMATISATION\nINTELLIGENTE', 'IA & INTELLIGENCE\nARTIFICIELLE', 'CRÉATIVITÉ\n& INNOVATION',
    'DÉVELOPPEMENT WEB\n& APPLICATIONS', 'SÉCURITÉ\n& PERFORMANCE',
  ];
  labels.forEach((label, i) => {
    const cx = M + (i + 0.5) * (CONTENT_W / 5);
    pdf.image(SERVICE_ICONS[i], cx - 28, footerY + 5, { fit: [56, 42], align: 'center', valign: 'center' });
    text(pdf, label, cx - 48, footerY + 49, {
      size: 5.5, font: 'Helvetica-Bold', color: C.white, width: 96, align: 'center', lineGap: 1.2,
    });
    if (i < 4) line(pdf, cx + (CONTENT_W / 10), footerY + 11, cx + (CONTENT_W / 10), footerY + 60, '#6b4b1d', 0.45);
  });
}

function drawCancelledStamp(pdf, doc, type) {
  if (type !== 'facture' || String(doc.statut || '').toLowerCase() !== 'annulee') return;

  pdf.save()
    .opacity(0.14)
    .fillColor('#b42318')
    .font('Helvetica-Bold')
    .fontSize(52)
    .rotate(-24, { origin: [A4.width / 2, A4.height / 2] })
    .text('ANNULÉE', 80, 390, { width: A4.width - 160, align: 'center' })
    .restore();

  pdf.save().fillColor('#b42318').roundedRect(397, 68, 166, 15, 2).fill().restore();
  text(pdf, 'DOCUMENT NON ÉMIS', 402, 72, {
    size: 6.8, font: 'Helvetica-Bold', color: C.white, width: 156, align: 'center',
  });
}

function generateInvoicePDF(doc, type = 'facture') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdf = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, bufferPages: true });
    pdf.on('data', chunk => chunks.push(chunk));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      drawHeader(pdf, doc, type);
      drawClientAndTerms(pdf, doc, type);
      const tableBottom = drawTable(pdf, doc);
      const totalsBottom = drawTotals(pdf, doc, type, tableBottom);
      drawBottom(pdf, doc, totalsBottom + 10);
      drawCancelledStamp(pdf, doc, type);
      if (pdf.bufferedPageRange().count !== 1) throw new Error('Le PDF officiel doit tenir sur une seule page A4.');
      pdf.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { generateInvoicePDF, money, words };
