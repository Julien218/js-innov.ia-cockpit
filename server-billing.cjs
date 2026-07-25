/**
 * server-billing.cjs — Template Premium JS-Innov.IA
 * Génération PDF Devis + Facture au design commercial fidèle au modèle fourni.
 *
 * Routes :
 *   POST /api/billing/devis/:id/pdf
 *   POST /api/billing/factures/:id/pdf
 *   POST /api/billing/devis/:id/send
 *   POST /api/billing/factures/:id/send
 */

const express  = require("express");
const router   = express.Router();
const PDFDocument = require("pdfkit");
const nodemailer  = require("nodemailer");
const path = require("path");
const fs   = require("fs");

// ─── Auth ────────────────────────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers["x-agent-key"] || req.headers["x-api-key"];
  if (!key || key !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
router.use(requireApiKey);

// ─── Config ───────────────────────────────────────────────────────────────────
const STORE_EMAIL     = process.env.EMAIL_STORE_ADDRESS   || "info@jsinnovia.store";
const STORE_PASSWORD  = process.env.EMAIL_PASSWORD_STORE  || "";
const STORE_SMTP_HOST = "smtp.ionos.fr";
const STORE_SMTP_PORT = 465;

const AGENT_URL = process.env.VITE_AGENT_URL || process.env.JSINNOVIA_AGENT_URL || "https://jsinnovia-agent-production.up.railway.app";
const AGENT_KEY = process.env.AGENT_API_KEY  || process.env.JSINNOVIA_AGENT_KEY || "";

// ─── Logo path (embedded in Docker image via COPY assets/) ───────────────────
const LOGO_PATH = path.join(__dirname, "assets", "logo-phoenix.png");
const HAS_LOGO  = fs.existsSync(LOGO_PATH);

// ─── Colors & Typography ──────────────────────────────────────────────────────
const C = {
  noir:   "#0B0B0F",   // fond sombre
  dark:   "#1A1A2E",   // en-tête tableau
  gold:   "#C9952A",   // doré/orange premium
  gold2:  "#D4AF37",   // doré clair
  white:  "#FFFFFF",
  grey:   "#666666",
  lgrey:  "#F5F5F5",   // fond rangée alternée
  border: "#E8E0D0",   // bordure légère
  text:   "#1A1A1A",   // texte principal
  orange: "#E8943A",   // numéro orange
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(value) {
  if (value == null || isNaN(value)) return "0,00 €";
  return new Intl.NumberFormat("fr-BE", {
    style: "currency", currency: "EUR",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(value));
}

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("fr-BE", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });
  } catch { return "—"; }
}

function fmtNum(n) {
  // DEV-2026-0001 → DEV-2026-0001 (already uppercased from generateDocumentNumber)
  return (n || "").toUpperCase();
}

/** Convert a number to French words (simplified, integers only) */
function numberToWords(n) {
  const ones  = ["","un","deux","trois","quatre","cinq","six","sept","huit","neuf",
                  "dix","onze","douze","treize","quatorze","quinze","seize","dix-sept","dix-huit","dix-neuf"];
  const tens  = ["","","vingt","trente","quarante","cinquante","soixante","soixante","quatre-vingts","quatre-vingt"];
  const tenss = ["","","vingt","trente","quarante","cinquante","soixante","soixante-dix","quatre-vingts","quatre-vingt"];

  function belowHundred(x) {
    if (x < 20) return ones[x];
    const t = Math.floor(x / 10);
    const u = x % 10;
    if (t === 7 || t === 9) {
      const base = t === 7 ? 60 : 80;
      return (t === 7 ? "soixante" : "quatre-vingts").replace("s","") + "-" + ones[x - base];
    }
    return tens[t] + (u === 1 && t !== 8 ? "-et-un" : u ? "-" + ones[u] : "");
  }

  function belowThousand(x) {
    if (x < 100) return belowHundred(x);
    const h = Math.floor(x / 100);
    const r = x % 100;
    const hStr = (h === 1 ? "cent" : ones[h] + "-cent") + (r === 0 && h > 1 ? "s" : "");
    return r ? hStr + "-" + belowHundred(r) : hStr;
  }

  const integer = Math.round(n);
  if (integer === 0) return "zéro";
  if (integer < 1000) return belowThousand(integer);
  if (integer < 1000000) {
    const k = Math.floor(integer / 1000);
    const r = integer % 1000;
    const kStr = k === 1 ? "mille" : belowThousand(k) + "-mille";
    return r ? kStr + "-" + belowThousand(r) : kStr;
  }
  return integer.toLocaleString("fr-BE");
}

function amountInWords(ttc) {
  const int = Math.floor(Number(ttc) || 0);
  const dec = Math.round(((Number(ttc) || 0) - int) * 100);
  let w = numberToWords(int).toUpperCase();
  if (dec > 0) w += " ET " + numberToWords(dec).toUpperCase() + " CENTIMES";
  return w;
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchDocument(type, id) {
  const table = type === "facture" ? "Facture" : "Devis";
  const url = `${AGENT_URL}/data/${table}/${id}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Agent API ${res.status}: ${txt}`);
  }
  return res.json();
}

async function updateDocumentStatus(type, id, statut) {
  const table = type === "facture" ? "Facture" : "Devis";
  const url = `${AGENT_URL}/data/${table}/${id}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
    body: JSON.stringify({ statut }),
  });
  if (!res.ok) throw new Error(`Status update ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF GENERATOR — Premium Template JS-Innov.IA
// ─────────────────────────────────────────────────────────────────────────────
function generatePDF(doc, type = "devis") {
  return new Promise((resolve, reject) => {
    try {
      const buffers = [];
      const pdf = new PDFDocument({
        size: "A4",
        margin: 0,
        info: {
          Title: type === "facture" ? `Facture ${doc.numero || ""}` : `Devis ${doc.numero || ""}`,
          Author: "JS-Innov.IA",
          Creator: "JS-Innov.IA Cockpit",
        },
      });

      pdf.on("data", chunk => buffers.push(chunk));
      pdf.on("end",  ()    => resolve(Buffer.concat(buffers)));
      pdf.on("error", reject);

      // ── Page dimensions ────────────────────────────────────────
      const W = 595.28;   // A4 width pt
      const H = 841.89;   // A4 height pt
      const ML = 36;       // margin left
      const MR = 36;       // margin right
      const CW = W - ML - MR; // content width

      // ══════════════════════════════════════════════════════════
      // 1. HEADER ZONE  (white, y=0..155)
      // ══════════════════════════════════════════════════════════
      pdf.rect(0, 0, W, 155).fill(C.white);

      // ── Logo phénix ──────────────────────────────────────────
      if (HAS_LOGO) {
        pdf.image(LOGO_PATH, ML, 10, { height: 90, fit: [90, 90] });
      } else {
        // Fallback: cercle doré
        pdf.circle(ML + 38, 55, 38).fill(C.gold);
        pdf.fontSize(9).fillColor(C.white).font("Helvetica-Bold")
           .text("JS", ML + 22, 48)
           .text("IA",  ML + 42, 48);
      }

      // ── Marque texte ─────────────────────────────────────────
      const logoRight = ML + (HAS_LOGO ? 100 : 85);

      pdf.fontSize(26).fillColor(C.noir).font("Helvetica-Bold")
         .text("JS-Innov.", logoRight, 16, { continued: true })
         .fillColor(C.gold)
         .text("IA®");

      // Sous-titre script (simulated avec font standard)
      pdf.fontSize(11).fillColor(C.gold).font("Helvetica-Oblique")
         .text("Julien Pagin", logoRight, 46);

      pdf.moveTo(logoRight, 63).lineTo(logoRight + 200, 63)
         .strokeColor(C.gold).lineWidth(0.8).stroke();

      pdf.fontSize(7.5).fillColor(C.grey).font("Helvetica")
         .text("AUTOMATISATION INTELLIGENTE, AMPLIFIÉE PAR L'HUMAIN", logoRight, 68, {
           width: 200, characterSpacing: 0.5,
         });

      // ── Séparateur vertical doré ─────────────────────────────
      const sepX = W / 2 + 10;
      pdf.moveTo(sepX, 12).lineTo(sepX, 140)
         .strokeColor(C.gold).lineWidth(1.5).stroke();

      // ── Bloc DEVIS / FACTURE (droite) ─────────────────────────
      const docType = type === "facture" ? "FACTURE" : "DEVIS";
      const isFacture = type === "facture";

      pdf.fontSize(34).fillColor(C.noir).font("Helvetica-Bold")
         .text(docType, sepX + 15, 12, { width: W - sepX - 20, align: "left" });

      // Méta-données doc
      const metaX1 = sepX + 15;
      const metaX2 = W - MR - 5;
      let metaY = 54;
      const metaLine = 18;

      function metaRow(label, value, highlight = false) {
        pdf.fontSize(7.5).fillColor(C.grey).font("Helvetica")
           .text(label, metaX1, metaY, { width: 90 });
        pdf.fontSize(8.5).fillColor(highlight ? C.orange : C.noir).font("Helvetica-Bold")
           .text(value || "—", metaX1 + 95, metaY, { width: metaX2 - metaX1 - 95, align: "right" });
        metaY += metaLine;
      }

      const numLabel  = isFacture ? "N° DE FACTURE" : "N° DE DEVIS";
      const dateLabel = isFacture ? "DATE DE FACTURATION" : "DATE DU DEVIS";
      const limLabel  = isFacture ? "DATE D'ÉCHÉANCE" : "VALABLE JUSQU'AU";
      const limValue  = isFacture ? fmtDate(doc.date_echeance) : fmtDate(doc.date_validite);

      metaRow(numLabel, fmtNum(doc.numero), true);
      metaRow(dateLabel, fmtDate(doc.date_emission || doc.created_at));
      metaRow(limLabel, limValue);

      if (isFacture && doc.periode) {
        metaRow("PÉRIODE", doc.periode);
      } else if (!isFacture && doc.reference) {
        metaRow("RÉFÉRENCE", doc.reference);
      }

      // ══════════════════════════════════════════════════════════
      // 2. BANDE CONTACT ÉMETTEUR  (gris très léger, y=155..230)
      // ══════════════════════════════════════════════════════════
      pdf.rect(0, 155, W, 72).fill(C.lgrey);
      pdf.rect(0, 155, W, 0.5).fill(C.border);
      pdf.rect(0, 226, W, 0.5).fill(C.border);

      const cY = 165;  // baseline contacts

      // Col 1: adresse
      const addr1X = ML;
      pdf.fontSize(7.5).fillColor(C.grey).font("Helvetica");

      // Icône pin (cercle simple)
      pdf.circle(addr1X + 5, cY + 5, 5).fill(C.gold);
      pdf.fontSize(6).fillColor(C.white).font("Helvetica-Bold")
         .text("◉", addr1X + 2, cY + 2);

      pdf.fontSize(8).fillColor(C.noir).font("Helvetica-Bold")
         .text("Pagin Julien", addr1X + 14, cY);
      pdf.fontSize(7.5).fillColor(C.grey).font("Helvetica")
         .text("Grand Rue 52", addr1X + 14, cY + 11)
         .text("7370 Dour, Belgique", addr1X + 14, cY + 22);

      // Col 2: téléphone + email
      const col2X = 165;
      pdf.circle(col2X + 5, cY + 5, 5).fill(C.gold);
      pdf.fontSize(8).fillColor(C.noir).font("Helvetica-Bold")
         .text("0494/11.90.90", col2X + 14, cY);
      pdf.circle(col2X + 5, cY + 18, 5).fill(C.gold);
      pdf.fontSize(7.5).fillColor(C.grey).font("Helvetica")
         .text("info@jsinnovia.com", col2X + 14, cY + 13);

      // Col 3: web + TVA
      const col3X = 310;
      pdf.circle(col3X + 5, cY + 5, 5).fill(C.gold);
      pdf.fontSize(8).fillColor(C.noir).font("Helvetica-Bold")
         .text("www.jsinnovia.com", col3X + 14, cY);
      pdf.circle(col3X + 5, cY + 18, 5).fill(C.gold);
      pdf.fontSize(7.5).fillColor(C.grey).font("Helvetica")
         .text("TVA BE 0877.926.214", col3X + 14, cY + 13);

      // ══════════════════════════════════════════════════════════
      // 3. BLOC CLIENT + CONDITIONS  (y=236..390)
      // ══════════════════════════════════════════════════════════
      let blockY = 236;

      // ── 3a. Bloc Client (gauche) ──────────────────────────────
      const clientLabel = isFacture ? "FACTURÉ À" : "DEVIS ÉMIS POUR";
      pdf.fontSize(7.5).fillColor(C.gold).font("Helvetica-Bold")
         .text(clientLabel, ML, blockY, { characterSpacing: 0.8 });

      blockY += 14;
      pdf.moveTo(ML, blockY).lineTo(ML + 210, blockY)
         .strokeColor(C.gold).lineWidth(0.5).stroke();
      blockY += 8;

      pdf.fontSize(11).fillColor(C.noir).font("Helvetica-Bold")
         .text(doc.client_nom || "—", ML, blockY, { width: 220 });
      blockY += 16;

      if (doc.client_adresse) {
        pdf.fontSize(8.5).fillColor(C.grey).font("Helvetica")
           .text(doc.client_adresse, ML, blockY, { width: 220 });
        blockY += 12;
      }
      if (doc.client_ville) {
        pdf.fontSize(8.5).fillColor(C.grey).font("Helvetica")
           .text(doc.client_ville, ML, blockY, { width: 220 });
        blockY += 12;
      }
      if (doc.client_tva) {
        pdf.fontSize(8.5).fillColor(C.grey).font("Helvetica")
           .text(`N° TVA : ${doc.client_tva}`, ML, blockY, { width: 220 });
        blockY += 12;
      }
      if (doc.client_email) {
        pdf.fontSize(8.5).fillColor(C.grey).font("Helvetica")
           .text(doc.client_email, ML, blockY, { width: 220 });
        blockY += 12;
      }

      // ── 3b. Bloc Conditions (droite) ──────────────────────────
      const condX  = W / 2 + 20;
      const condW  = W - condX - MR;
      let condY    = 236;
      const boxH   = 42;
      const boxGap = 6;

      function condBox(title, value) {
        // fond blanc + bordure légère
        pdf.rect(condX, condY, condW, boxH).strokeColor(C.border).lineWidth(0.5).stroke();
        // icône cercle
        pdf.circle(condX + 16, condY + 16, 10).fill(C.lgrey);
        pdf.fontSize(12).fillColor(C.gold).font("Helvetica-Bold")
           .text("◎", condX + 10, condY + 10);
        // texte
        pdf.fontSize(7).fillColor(C.grey).font("Helvetica-Bold")
           .text(title, condX + 32, condY + 8, { width: condW - 40, characterSpacing: 0.5 });
        pdf.fontSize(8.5).fillColor(C.noir).font("Helvetica")
           .text(value || "—", condX + 32, condY + 19, { width: condW - 40 });
        condY += boxH + boxGap;
      }

      const objLabel  = isFacture ? "RÉFÉRENCE" : "OBJECTIF";
      const objValue  = doc.objet || doc.reference || "Prestations JS-Innov.IA";

      condBox(objLabel, objValue);
      condBox("MODE DE PAIEMENT", doc.mode_paiement || "Virement bancaire");
      condBox("CONDITIONS DE PAIEMENT", doc.conditions_paiement || "Paiement à 30 jours");

      // ══════════════════════════════════════════════════════════
      // 4. TABLEAU PRESTATIONS
      // ══════════════════════════════════════════════════════════
      const tableTopY  = Math.max(blockY, condY) + 16;
      const tableW     = CW;
      const tableX     = ML;

      // Widths des colonnes
      const colDesc    = tableW * 0.36;
      const colPeriode = tableW * 0.18;
      const colPrix    = tableW * 0.16;
      const colTVA     = tableW * 0.10;
      const colTTC     = tableW * 0.20;
      const rowH       = 14;

      // En-tête
      pdf.rect(tableX, tableTopY, tableW, rowH + 4).fill(C.dark);

      const headers  = ["DESCRIPTION", "PÉRIODE", "PRIX UNIT. HT", "TVA", "TOTAL TTC"];
      const colXs    = [
        tableX,
        tableX + colDesc,
        tableX + colDesc + colPeriode,
        tableX + colDesc + colPeriode + colPrix,
        tableX + colDesc + colPeriode + colPrix + colTVA,
      ];
      const colWs = [colDesc, colPeriode, colPrix, colTVA, colTTC];

      headers.forEach((h, i) => {
        pdf.fontSize(7).fillColor(C.gold).font("Helvetica-Bold")
           .text(h, colXs[i] + 4, tableTopY + 5, {
             width: colWs[i] - 8,
             align: i === 0 ? "left" : "center",
             characterSpacing: 0.5,
           });
      });

      // ── Lignes items ───────────────────────────────────────────
      const items = Array.isArray(doc.items) && doc.items.length > 0
        ? doc.items
        : [{
            description:    doc.objet || "Prestation JS-Innov.IA",
            periode:        doc.periode || "",
            unit_price_ht:  doc.montant_ht || 0,
            tva:            doc.tva || 21,
            total_ttc:      doc.montant_ttc || 0,
          }];

      let rowY = tableTopY + rowH + 4;

      items.forEach((item, idx) => {
        // Calculer hauteur ligne (multi-ligne description)
        const descLines = pdf.heightOfString(item.description || "—", {
          width: colDesc - 32, // espace pour icône
          fontSize: 8.5,
        });
        const subText  = item.url || "";
        const subLines = subText
          ? pdf.heightOfString(subText, { width: colDesc - 32, fontSize: 7.5 })
          : 0;
        const noteText = item.note || "";
        const noteLines= noteText
          ? pdf.heightOfString(noteText, { width: colDesc - 32, fontSize: 7.5 })
          : 0;
        const lH = Math.max(40, descLines + subLines + noteLines + 18);

        // Fond alternance
        if (idx % 2 === 0) {
          pdf.rect(tableX, rowY, tableW, lH).fill(C.white);
        } else {
          pdf.rect(tableX, rowY, tableW, lH).fill(C.lgrey);
        }

        // Bordure séparatrice
        pdf.moveTo(tableX, rowY).lineTo(tableX + tableW, rowY)
           .strokeColor(C.border).lineWidth(0.3).stroke();

        // ── Icône service (cercle doré) ──
        const iconX = tableX + 8;
        const iconY = rowY + lH / 2 - 8;
        pdf.circle(iconX + 8, iconY + 8, 8).fill(C.lgrey);
        pdf.circle(iconX + 8, iconY + 8, 5).strokeColor(C.gold).lineWidth(1).stroke();

        // ── Contenu description ──
        const descX = tableX + 30;
        const descY = rowY + 8;

        pdf.fontSize(8.5).fillColor(C.noir).font("Helvetica-Bold")
           .text(item.description || "—", descX, descY, { width: colDesc - 36 });

        let subY = descY + descLines + 2;
        if (subText) {
          pdf.fontSize(7.5).fillColor(C.gold).font("Helvetica")
             .text(subText, descX, subY, { width: colDesc - 36 });
          subY += subLines + 2;
        }
        if (noteText) {
          pdf.fontSize(7.5).fillColor(C.grey).font("Helvetica")
             .text(noteText, descX, subY, { width: colDesc - 36 });
        }

        // ── Période ──
        const periodeStr = item.periode || item.period || "";
        pdf.fontSize(8).fillColor(C.grey).font("Helvetica")
           .text(periodeStr, colXs[1] + 4, rowY + lH / 2 - 8, {
             width: colPeriode - 8, align: "center",
           });

        // ── Prix HT ──
        const prixHT = fmt(item.unit_price_ht || item.total_ht || 0);
        pdf.fontSize(8).fillColor(C.noir).font("Helvetica")
           .text(prixHT, colXs[2] + 4, rowY + lH / 2 - 8, {
             width: colPrix - 8, align: "center",
           });

        // ── TVA % ──
        pdf.fontSize(8).fillColor(C.noir).font("Helvetica")
           .text(`${item.tva || 21}%`, colXs[3] + 4, rowY + lH / 2 - 8, {
             width: colTVA - 8, align: "center",
           });

        // ── Total TTC ──
        const ttcVal = fmt(item.total_ttc || 0);
        pdf.fontSize(8.5).fillColor(C.gold).font("Helvetica-Bold")
           .text(ttcVal, colXs[4] + 4, rowY + lH / 2 - 8, {
             width: colTTC - 8, align: "center",
           });

        rowY += lH;
      });

      // Bordure bas tableau
      pdf.rect(tableX, tableTopY, tableW, rowY - tableTopY)
         .strokeColor(C.border).lineWidth(0.5).stroke();

      // ══════════════════════════════════════════════════════════
      // 5. MONTANT EN LETTRES + TOTAUX
      // ══════════════════════════════════════════════════════════
      const totY    = rowY + 16;
      const halfW   = CW / 2;
      const totBlkX = tableX + halfW + 10;
      const totBlkW = halfW - 10;

      // ── Montant en lettres (gauche) ──
      const arrLbl = type === "facture"
        ? "ARRÊTÉ LA PRÉSENTE FACTURE À LA SOMME DE :"
        : "ARRÊTÉ LE PRÉSENT DEVIS À LA SOMME DE :";

      pdf.fontSize(8).fillColor(C.gold).font("Helvetica-Bold")
         .text(arrLbl, tableX, totY, { width: halfW - 20 });

      const words = amountInWords(doc.montant_ttc || 0) + " EUROS TTC";
      pdf.fontSize(11).fillColor(C.noir).font("Helvetica-Bold")
         .text(words, tableX, totY + 14, { width: halfW - 20 });

      // ── Sous-total HT ──
      const totLineH = 18;
      let tY = totY;

      pdf.fontSize(8).fillColor(C.grey).font("Helvetica")
         .text("SOUS-TOTAL HT", totBlkX, tY, { width: totBlkW * 0.6 });
      pdf.fontSize(8.5).fillColor(C.noir).font("Helvetica-Bold")
         .text(fmt(doc.montant_ht || 0), totBlkX, tY, { width: totBlkW, align: "right" });
      tY += totLineH;

      // ── TVA ──
      const tvaPct = doc.tva || 21;
      pdf.fontSize(8).fillColor(C.grey).font("Helvetica")
         .text(`TVA (${tvaPct}%)`, totBlkX, tY, { width: totBlkW * 0.6 });
      const tvaMontant = doc.montant_tva
        || (doc.montant_ht && doc.tva ? Math.round(Number(doc.montant_ht) * Number(doc.tva) / 100 * 100) / 100 : 0);
      pdf.fontSize(8.5).fillColor(C.noir).font("Helvetica-Bold")
         .text(fmt(tvaMontant), totBlkX, tY, { width: totBlkW, align: "right" });
      tY += totLineH;

      // ── Total TTC (fond doré) ──
      pdf.rect(totBlkX - 4, tY - 2, totBlkW + 8, totLineH + 4).fill(C.gold);
      pdf.fontSize(9).fillColor(C.white).font("Helvetica-Bold")
         .text("TOTAL TTC", totBlkX, tY + 3, { width: totBlkW * 0.55 });
      pdf.fontSize(11).fillColor(C.white).font("Helvetica-Bold")
         .text(fmt(doc.montant_ttc || 0), totBlkX, tY + 2, { width: totBlkW, align: "right" });
      tY += totLineH + 8;

      // ══════════════════════════════════════════════════════════
      // 6. SECTION BASSE : Note | Coordonnées bancaires | Signature
      // ══════════════════════════════════════════════════════════
      const sectY  = tY + 16;
      const colW3  = CW / 3;

      // ── Note (col 1) ──────────────────────────────────────────
      const noteTitle = "NOTE";
      const noteBody  = type === "facture"
        ? "Nous vous remercions pour votre confiance. Pour toute question, n'hésitez pas à nous contacter."
        : "Ce devis est valable jusqu'à la date indiquée ci-dessus. Pour toute question, n'hésitez pas à nous contacter.";

      pdf.rect(tableX, sectY, colW3 - 8, 60).strokeColor(C.border).lineWidth(0.5).stroke();
      // Icône info
      pdf.circle(tableX + 12, sectY + 14, 9).strokeColor(C.gold).lineWidth(1).stroke();
      pdf.fontSize(9).fillColor(C.gold).font("Helvetica-Bold").text("i", tableX + 9, sectY + 9);
      pdf.fontSize(7.5).fillColor(C.grey).font("Helvetica-Bold")
         .text(noteTitle, tableX + 26, sectY + 8, { width: colW3 - 40 });
      pdf.fontSize(7.5).fillColor(C.grey).font("Helvetica")
         .text(noteBody, tableX + 26, sectY + 19, { width: colW3 - 40 });

      // ── Coordonnées bancaires (col 2) ─────────────────────────
      const bankX = tableX + colW3 + 4;
      pdf.circle(bankX + 12, sectY + 14, 9).fill(C.dark);
      pdf.fontSize(7).fillColor(C.gold).font("Helvetica-Bold").text("⬛", bankX + 7, sectY + 9);

      pdf.fontSize(7.5).fillColor(C.noir).font("Helvetica-Bold")
         .text("COORDONNÉES BANCAIRES", bankX + 26, sectY + 8, { width: colW3 - 30 });
      pdf.fontSize(7).fillColor(C.grey).font("Helvetica")
         .text("Bénéficiaire : Pagin Julien (JS-Innov.IA®)", bankX + 26, sectY + 20, { width: colW3 - 30 })
         .text("IBAN BE52 6528 4346 5909",                  bankX + 26, sectY + 30, { width: colW3 - 30 })
         .text("IBAN BE20 6508 1271 7456",                  bankX + 26, sectY + 40, { width: colW3 - 30 })
         .text("BIC : JVBABE22",                            bankX + 26, sectY + 50, { width: colW3 - 30 });
      pdf.fontSize(7).fillColor(C.noir).font("Helvetica-Bold")
         .text(`Communication : ${fmtNum(doc.numero) || "—"}`, bankX + 26, sectY + 60, { width: colW3 - 30 });

      // ── Signature (col 3) ─────────────────────────────────────
      const sigX = tableX + colW3 * 2 + 8;
      const sigW = colW3 - 8;

      pdf.fontSize(8.5).fillColor(C.noir).font("Helvetica-Bold")
         .text("Julien Pagin", sigX, sectY + 2, { width: sigW, align: "center" });

      // Signature cursive simulée (lignes ondulées)
      pdf.fontSize(20).fillColor(C.dark).font("Helvetica-Oblique")
         .text("Julien Pagin", sigX, sectY + 14, { width: sigW, align: "center" });

      pdf.moveTo(sigX + 10, sectY + 46).lineTo(sigX + sigW - 10, sectY + 46)
         .strokeColor(C.border).lineWidth(0.5).stroke();

      pdf.fontSize(7.5).fillColor(C.grey).font("Helvetica")
         .text("Fondateur – JS-Innov.IA®", sigX, sectY + 50, { width: sigW, align: "center" });

      // ══════════════════════════════════════════════════════════
      // 7. FOOTER MENTIONS LÉGALES
      // ══════════════════════════════════════════════════════════
      const footerTopY = H - 110;

      pdf.rect(0, footerTopY, W, 0.4).fill(C.border);

      pdf.fontSize(7).fillColor(C.grey).font("Helvetica")
         .text(
           "TVA calculée conformément au règlement 967/2012 du Conseil de l'Union européenne.",
           ML, footerTopY + 8, { width: CW, align: "center" }
         )
         .text(
           "En cas de retard de paiement, des intérêts de 1% par mois seront appliqués sur le montant dû.",
           ML, footerTopY + 18, { width: CW, align: "center" }
         );

      // ── Pictogrammes services ─────────────────────────────────
      const icons = [
        { label: "AUTOMATISATION\nINTELLIGENTE" },
        { label: "IA & INTELLIGENCE\nARTIFICIELLE" },
        { label: "CRÉATIVITÉ\n& INNOVATION" },
        { label: "DÉVELOPPEMENT WEB\n& APPLICATIONS" },
        { label: "SÉCURITÉ\n& PERFORMANCE" },
      ];

      const iconZoneY = footerTopY + 32;
      const iconStep  = CW / icons.length;

      icons.forEach((ic, i) => {
        const cx = ML + iconStep * i + iconStep / 2;
        // Cercle doré
        pdf.circle(cx, iconZoneY + 16, 18).fill(C.white).strokeColor(C.gold).lineWidth(1).stroke();
        // Initiales
        const initials = ic.label.split("\n")[0].slice(0, 2).toUpperCase();
        pdf.fontSize(8).fillColor(C.gold).font("Helvetica-Bold")
           .text(initials, cx - 8, iconZoneY + 10, { width: 16, align: "center" });
        // Label
        pdf.fontSize(5.5).fillColor(C.grey).font("Helvetica-Bold")
           .text(ic.label, cx - 28, iconZoneY + 36, { width: 56, align: "center", characterSpacing: 0.3 });
      });

      // Ligne décorative dorée
      const lineY = iconZoneY + 62;
      pdf.moveTo(ML + 30, lineY).lineTo(W - MR - 30, lineY)
         .strokeColor(C.gold).lineWidth(0.8).stroke();

      // Slogan
      pdf.fontSize(8.5).fillColor(C.dark).font("Helvetica-Bold")
         .text("L'INTELLIGENCE AU SERVICE DE VOS AMBITIONS", ML, lineY + 6, {
           width: CW, align: "center", characterSpacing: 1,
         });

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── SMTP ─────────────────────────────────────────────────────────────────────
let smtpTransport = null;
function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;
  if (!STORE_PASSWORD) return null;
  smtpTransport = nodemailer.createTransport({
    host: STORE_SMTP_HOST, port: STORE_SMTP_PORT,
    secure: true,
    auth: { user: STORE_EMAIL, pass: STORE_PASSWORD },
    tls: { rejectUnauthorized: false },
  });
  return smtpTransport;
}

// ─── ROUTES PDF ───────────────────────────────────────────────────────────────
router.post("/devis/:id/pdf", async (req, res) => {
  try {
    const doc = await fetchDocument("devis", req.params.id);
    const buf = await generatePDF(doc, "devis");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fmtNum(doc.numero) || "devis"}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error("[BILLING] PDF devis error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/factures/:id/pdf", async (req, res) => {
  try {
    const doc = await fetchDocument("facture", req.params.id);
    const buf = await generatePDF(doc, "facture");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fmtNum(doc.numero) || "facture"}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error("[BILLING] PDF facture error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROUTES ENVOI EMAIL ───────────────────────────────────────────────────────
router.post("/devis/:id/send", async (req, res) => {
  try {
    const doc = await fetchDocument("devis", req.params.id);
    const to  = req.body?.to || doc.client_email;
    if (!to) return res.status(400).json({ success: false, error: "Email client manquant." });

    const buf      = await generatePDF(doc, "devis");
    const filename = `${fmtNum(doc.numero) || "devis"}.pdf`;
    const transport = getSmtpTransport();
    if (!transport) return res.status(500).json({ success: false, error: "SMTP non configuré." });

    const ttcStr = fmt(doc.montant_ttc);
    const customMsg = req.body?.message || "";
    const text = `Bonjour ${doc.client_nom || ""},\n\nVeuillez trouver votre devis JS-Innov.IA en pièce jointe.\n\nMontant total TTC : ${ttcStr}\n${customMsg ? "\n" + customMsg + "\n" : ""}Bien cordialement,\nJulien Pagin — JS-Innov.IA®`;
    const html = `<p>Bonjour ${doc.client_nom || ""},</p><p>Veuillez trouver votre devis JS-Innov.IA en pièce jointe.</p><p><strong>Montant total TTC : ${ttcStr}</strong></p>${customMsg ? "<p>" + customMsg.replace(/\n/g,"<br>") + "</p>" : ""}<p>Bien cordialement,<br><strong>Julien Pagin — JS-Innov.IA®</strong></p>`;

    const info = await transport.sendMail({
      from: `"JS-Innov.IA" <${STORE_EMAIL}>`,
      to, subject: `Votre devis JS-Innov.IA — ${fmtNum(doc.numero) || ""}`,
      text, html,
      attachments: [{ filename, content: buf, contentType: "application/pdf" }],
    });

    try { await updateDocumentStatus("devis", req.params.id, "envoye"); } catch {}

    res.json({ success: true, messageId: info.messageId, sentTo: to, filename });
  } catch (err) {
    console.error("[BILLING] Send devis error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/factures/:id/send", async (req, res) => {
  try {
    const doc = await fetchDocument("facture", req.params.id);
    const to  = req.body?.to || doc.client_email;
    if (!to) return res.status(400).json({ success: false, error: "Email client manquant." });

    const buf      = await generatePDF(doc, "facture");
    const filename = `${fmtNum(doc.numero) || "facture"}.pdf`;
    const transport = getSmtpTransport();
    if (!transport) return res.status(500).json({ success: false, error: "SMTP non configuré." });

    const ttcStr = fmt(doc.montant_ttc);
    const customMsg = req.body?.message || "";
    const text = `Bonjour ${doc.client_nom || ""},\n\nVeuillez trouver votre facture JS-Innov.IA en pièce jointe.\n\nMontant total TTC : ${ttcStr}\n${customMsg ? "\n" + customMsg + "\n" : ""}Bien cordialement,\nJulien Pagin — JS-Innov.IA®`;
    const html = `<p>Bonjour ${doc.client_nom || ""},</p><p>Veuillez trouver votre facture JS-Innov.IA en pièce jointe.</p><p><strong>Montant total TTC : ${ttcStr}</strong></p>${customMsg ? "<p>" + customMsg.replace(/\n/g,"<br>") + "</p>" : ""}<p>Bien cordialement,<br><strong>Julien Pagin — JS-Innov.IA®</strong></p>`;

    const info = await transport.sendMail({
      from: `"JS-Innov.IA" <${STORE_EMAIL}>`,
      to, subject: `Votre facture JS-Innov.IA — ${fmtNum(doc.numero) || ""}`,
      text, html,
      attachments: [{ filename, content: buf, contentType: "application/pdf" }],
    });

    try { await updateDocumentStatus("facture", req.params.id, "envoyee"); } catch {}

    res.json({ success: true, messageId: info.messageId, sentTo: to, filename });
  } catch (err) {
    console.error("[BILLING] Send facture error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
