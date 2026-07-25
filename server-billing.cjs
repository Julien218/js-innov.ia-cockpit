/**
 * server-billing.cjs — Génération PDF + envoi email des devis et factures
 *
 * Routes:
 *   POST /api/billing/devis/:id/pdf   → génère PDF devis
 *   POST /api/billing/factures/:id/pdf → génère PDF facture
 *   POST /api/billing/devis/:id/send   → envoie devis par email avec PDF
 *   POST /api/billing/factures/:id/send → envoie facture par email avec PDF
 *
 * PDF généré avec PDFKit (server-side) → buffer → envoi via nodemailer
 * Email envoyé depuis info@jsinnovia.store (EMAIL_STORE_ADDRESS)
 */
const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

// ── Auth middleware ──────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers["x-agent-key"] || req.headers["x-api-key"];
  if (!key || key !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

router.use(requireApiKey);

// ── Config email store ──────────────────────────────────────
const STORE_EMAIL = process.env.EMAIL_STORE_ADDRESS || "info@jsinnovia.store";
const STORE_PASSWORD = process.env.EMAIL_PASSWORD_STORE || "";
const STORE_SMTP_HOST = "smtp.ionos.fr";
const STORE_SMTP_PORT = 465;

// ── Agent backend URL (pour récupérer les données du document) ──
const AGENT_URL = process.env.VITE_AGENT_URL || "https://jsinnovia-agent-production.up.railway.app";
const AGENT_KEY = process.env.AGENT_API_KEY || "";

// ── Fetch document from jsinnovia-agent ─────────────────────
async function fetchDocument(type, id) {
  const table = type === "facture" ? "Facture" : "Devis";
  const url = `${AGENT_URL}/data/${table}/${id}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "x-agent-key": AGENT_KEY,
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Agent API error ${res.status}: ${txt}`);
  }
  return await res.json();
}

// ── Update document status via jsinnovia-agent ──────────────
async function updateDocumentStatus(type, id, statut) {
  const table = type === "facture" ? "Facture" : "Devis";
  const url = `${AGENT_URL}/data/${table}/${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-agent-key": AGENT_KEY,
    },
    body: JSON.stringify({ statut }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Agent API update error ${res.status}: ${txt}`);
  }
  return await res.json();
}

// ── Format currency ─────────────────────────────────────────
function formatCurrency(value) {
  if (value == null || isNaN(value)) return "0,00 €";
  return new Intl.NumberFormat("fr-BE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

// ── Format date ─────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("fr-BE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

// ── Generate PDF ────────────────────────────────────────────
function generatePDF(doc, type = "devis") {
  return new Promise((resolve, reject) => {
    try {
      const buffers = [];
      const pdf = new PDFDocument({ size: "A4", margin: 50 });

      pdf.on("data", (chunk) => buffers.push(chunk));
      pdf.on("end", () => resolve(Buffer.concat(buffers)));
      pdf.on("error", reject);

      // ── En-tête ──────────────────────────────────────
      // Logo zone (texte stylé car pas d'image en mémoire)
      pdf
        .fontSize(22)
        .fillColor("#D4AF37")
        .font("Helvetica-Bold")
        .text("JS-Innov.IA", 50, 50);

      pdf
        .fontSize(9)
        .fillColor("#666666")
        .font("Helvetica")
        .text("When Vision meets Intelligence.", 50, 76)
        .text("info@jsinnovia.store", 50, 88);

      // Type de document (devis ou facture)
      const docTypeLabel = type === "facture" ? "FACTURE" : "DEVIS";
      pdf
        .fontSize(20)
        .fillColor("#0B0B0F")
        .font("Helvetica-Bold")
        .text(docTypeLabel, 400, 50, { align: "right" });

      pdf
        .fontSize(10)
        .fillColor("#666666")
        .font("Helvetica")
        .text(`N° ${doc.numero || "—"}`, 400, 76, { align: "right" })
        .text(`Date: ${formatDate(doc.date_emission || doc.created_date)}`, 400, 90, { align: "right" });

      if (type === "devis" && doc.date_validite) {
        pdf.text(`Valide jusqu'au: ${formatDate(doc.date_validite)}`, 400, 104, { align: "right" });
      }
      if (type === "facture" && doc.date_echeance) {
        pdf.text(`Échéance: ${formatDate(doc.date_echeance)}`, 400, 104, { align: "right" });
      }

      // Ligne de séparation
      pdf
        .moveTo(50, 125)
        .lineTo(545, 125)
        .strokeColor("#D4AF37")
        .lineWidth(1)
        .stroke();

      // ── Client ──────────────────────────────────────
      pdf
        .fontSize(9)
        .fillColor("#999999")
        .font("Helvetica-Bold")
        .text("CLIENT", 50, 145);

      pdf
        .fontSize(11)
        .fillColor("#0B0B0F")
        .font("Helvetica")
        .text(doc.client_nom || "—", 50, 162);

      if (doc.client_email) {
        pdf
          .fontSize(9)
          .fillColor("#666666")
          .text(doc.client_email, 50, 178);
      }

      // ── Objet / Description ─────────────────────────
      const startY = doc.client_email ? 200 : 185;
      if (doc.objet) {
        pdf
          .fontSize(9)
          .fillColor("#999999")
          .font("Helvetica-Bold")
          .text("OBJET", 50, startY);
        pdf
          .fontSize(10)
          .fillColor("#333333")
          .font("Helvetica")
          .text(doc.objet, 50, startY + 15, { width: 495 });
      }

      // ── Items multi-lignes ou mode simple ───────────
      const itemsY = doc.objet ? startY + 45 : startY + 10;

      if (Array.isArray(doc.items) && doc.items.length > 0) {
        // En-tête tableau
        pdf
          .fontSize(9)
          .fillColor("#999999")
          .font("Helvetica-Bold")
          .text("Description", 50, itemsY)
          .text("Qté", 320, itemsY)
          .text("Prix HT", 370, itemsY)
          .text("TVA", 430, itemsY)
          .text("Total TTC", 470, itemsY);

        pdf
          .moveTo(50, itemsY + 15)
          .lineTo(545, itemsY + 15)
          .strokeColor("#E5E5E5")
          .lineWidth(0.5)
          .stroke();

        let lineY = itemsY + 25;
        for (const item of doc.items) {
          pdf
            .fontSize(9)
            .fillColor("#333333")
            .font("Helvetica")
            .text(item.description || "", 50, lineY, { width: 260 })
            .text(String(item.quantity || 1), 320, lineY)
            .text(formatCurrency(item.unit_price_ht), 370, lineY)
            .text(`${item.tva || 21}%`, 430, lineY)
            .text(formatCurrency(item.total_ttc), 470, lineY);
          lineY += 20;
        }

        // Totaux
        lineY += 10;
        pdf
          .moveTo(350, lineY)
          .lineTo(545, lineY)
          .strokeColor("#E5E5E5")
          .lineWidth(0.5)
          .stroke();

        lineY += 10;
        pdf
          .fontSize(10)
          .fillColor("#333333")
          .font("Helvetica")
          .text("Total HT", 350, lineY)
          .text(formatCurrency(doc.montant_ht), 470, lineY, { align: "right" });

        lineY += 15;
        pdf
          .text("TVA", 350, lineY)
          .text(formatCurrency(doc.montant_tva), 470, lineY, { align: "right" });

        lineY += 15;
        pdf
          .moveTo(350, lineY - 5)
          .lineTo(545, lineY - 5)
          .strokeColor("#D4AF37")
          .lineWidth(0.5)
          .stroke();

        pdf
          .fontSize(12)
          .fillColor("#0B0B0F")
          .font("Helvetica-Bold")
          .text("Total TTC", 350, lineY)
          .text(formatCurrency(doc.montant_ttc), 470, lineY, { align: "right" });
      } else {
        // Mode simple : un seul montant
        pdf
          .fontSize(9)
          .fillColor("#999999")
          .font("Helvetica-Bold")
          .text("DÉTAIL", 50, itemsY);

        pdf
          .fontSize(10)
          .fillColor("#333333")
          .font("Helvetica")
          .text(doc.objet || "Prestation JS-Innov.IA", 50, itemsY + 15, { width: 495 });

        const totalY = itemsY + 50;
        pdf
          .moveTo(350, totalY)
          .lineTo(545, totalY)
          .strokeColor("#E5E5E5")
          .lineWidth(0.5)
          .stroke();

        pdf
          .fontSize(10)
          .fillColor("#333333")
          .font("Helvetica")
          .text("Montant HT", 350, totalY + 10)
          .text(formatCurrency(doc.montant_ht), 470, totalY + 10, { align: "right" });

        pdf
          .text("TVA", 350, totalY + 25)
          .text(`${doc.tva || 21}% — ${formatCurrency(doc.montant_tva)}`, 470, totalY + 25, { align: "right" });

        pdf
          .moveTo(350, totalY + 40)
          .lineTo(545, totalY + 40)
          .strokeColor("#D4AF37")
          .lineWidth(0.5)
          .stroke();

        pdf
          .fontSize(12)
          .fillColor("#0B0B0F")
          .font("Helvetica-Bold")
          .text("Total TTC", 350, totalY + 45)
          .text(formatCurrency(doc.montant_ttc), 470, totalY + 45, { align: "right" });
      }

      // ── Notes ──────────────────────────────────────
      let notesY = 620;
      if (doc.notes) {
        pdf
          .fontSize(9)
          .fillColor("#999999")
          .font("Helvetica-Bold")
          .text("NOTES", 50, notesY);
        pdf
          .fontSize(9)
          .fillColor("#666666")
          .font("Helvetica")
          .text(doc.notes, 50, notesY + 15, { width: 495 });
        notesY += 40;
      }

      // ── Mentions de paiement (factures uniquement) ──
      if (type === "facture") {
        pdf
          .fontSize(9)
          .fillColor("#999999")
          .font("Helvetica-Bold")
          .text("PAIEMENT", 50, notesY);
        pdf
          .fontSize(9)
          .fillColor("#666666")
          .font("Helvetica")
          .text(
            "Virement bancaire — JS-Innov.IA — BCE 0877.926.214",
            50,
            notesY + 15
          )
          .text("Merci de régler sous 30 jours. TVA incluse.", 50, notesY + 28);
      }

      // ── Pied de page ────────────────────────────────
      pdf
        .fontSize(8)
        .fillColor("#AAAAAA")
        .font("Helvetica")
        .text(
          "JS-Innov.IA — Intelligence artificielle amplifiée par l'humain.",
          50,
          780,
          { align: "center", width: 495 }
        )
        .text("info@jsinnovia.store — www.jsinnovia.com", 50, 792, {
          align: "center",
          width: 495,
        });

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── SMTP transport (store) ─────────────────────────────────
let smtpTransport = null;
function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;
  if (!STORE_PASSWORD) return null;
  smtpTransport = nodemailer.createTransport({
    host: STORE_SMTP_HOST,
    port: STORE_SMTP_PORT,
    secure: STORE_SMTP_PORT === 465,
    auth: { user: STORE_EMAIL, pass: STORE_PASSWORD },
    tls: { rejectUnauthorized: false },
  });
  return smtpTransport;
}

// ── Routes: PDF generation ──────────────────────────────────

// POST /api/billing/devis/:id/pdf
router.post("/devis/:id/pdf", async (req, res) => {
  try {
    const doc = await fetchDocument("devis", req.params.id);
    const pdfBuffer = await generatePDF(doc, "devis");
    const filename = `${doc.numero || "devis"}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[BILLING] PDF devis error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/billing/factures/:id/pdf
router.post("/factures/:id/pdf", async (req, res) => {
  try {
    const doc = await fetchDocument("facture", req.params.id);
    const pdfBuffer = await generatePDF(doc, "facture");
    const filename = `${doc.numero || "facture"}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("[BILLING] PDF facture error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Routes: Send by email ───────────────────────────────────

// POST /api/billing/devis/:id/send
router.post("/devis/:id/send", async (req, res) => {
  try {
    const doc = await fetchDocument("devis", req.params.id);

    // Destinataire: payload > client_email
    const to = req.body?.to || doc.client_email;
    if (!to) {
      return res.status(400).json({ success: false, error: "Email client manquant." });
    }

    // Générer le PDF
    const pdfBuffer = await generatePDF(doc, "devis");
    const filename = `${doc.numero || "devis"}.pdf`;

    // Transport SMTP
    const transport = getSmtpTransport();
    if (!transport) {
      return res.status(500).json({ success: false, error: "SMTP non configuré (EMAIL_PASSWORD_STORE manquant)." });
    }

    const customMessage = req.body?.message || "";
    const textBody = `Bonjour ${doc.client_nom || ""},\n\nVeuillez trouver votre devis JS-Innov.IA en pièce jointe.\n\nMontant total TTC : ${formatCurrency(doc.montant_ttc)}\n${customMessage ? "\n" + customMessage + "\n" : ""}Bien cordialement,\nJS-Innov.IA`;
    const htmlBody = `<p>Bonjour ${doc.client_nom || ""},</p><p>Veuillez trouver votre devis JS-Innov.IA en pièce jointe.</p><p><strong>Montant total TTC : ${formatCurrency(doc.montant_ttc)}</strong></p>${customMessage ? "<p>" + customMessage.replace(/\n/g, "<br>") + "</p>" : ""}<p>Bien cordialement,<br>JS-Innov.IA</p>`;

    const info = await transport.sendMail({
      from: `"JS-Innov.IA" <${STORE_EMAIL}>`,
      to,
      subject: `Votre devis JS-Innov.IA — ${doc.numero || ""}`,
      text: textBody,
      html: htmlBody,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    // Mettre à jour le statut
    try {
      await updateDocumentStatus("devis", req.params.id, "envoye");
    } catch (e) {
      console.warn("[BILLING] Statut update failed:", e.message);
    }

    res.json({
      success: true,
      messageId: info.messageId,
      sentTo: to,
      filename,
    });
  } catch (err) {
    console.error("[BILLING] Send devis error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/billing/factures/:id/send
router.post("/factures/:id/send", async (req, res) => {
  try {
    const doc = await fetchDocument("facture", req.params.id);

    const to = req.body?.to || doc.client_email;
    if (!to) {
      return res.status(400).json({ success: false, error: "Email client manquant." });
    }

    const pdfBuffer = await generatePDF(doc, "facture");
    const filename = `${doc.numero || "facture"}.pdf`;

    const transport = getSmtpTransport();
    if (!transport) {
      return res.status(500).json({ success: false, error: "SMTP non configuré (EMAIL_PASSWORD_STORE manquant)." });
    }

    const customMessage = req.body?.message || "";
    const textBody = `Bonjour ${doc.client_nom || ""},\n\nVeuillez trouver votre facture JS-Innov.IA en pièce jointe.\n\nMontant total TTC : ${formatCurrency(doc.montant_ttc)}\n${customMessage ? "\n" + customMessage + "\n" : ""}Bien cordialement,\nJS-Innov.IA`;
    const htmlBody = `<p>Bonjour ${doc.client_nom || ""},</p><p>Veuillez trouver votre facture JS-Innov.IA en pièce jointe.</p><p><strong>Montant total TTC : ${formatCurrency(doc.montant_ttc)}</strong></p>${customMessage ? "<p>" + customMessage.replace(/\n/g, "<br>") + "</p>" : ""}<p>Bien cordialement,<br>JS-Innov.IA</p>`;

    const info = await transport.sendMail({
      from: `"JS-Innov.IA" <${STORE_EMAIL}>`,
      to,
      subject: `Votre facture JS-Innov.IA — ${doc.numero || ""}`,
      text: textBody,
      html: htmlBody,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    // Mettre à jour le statut
    try {
      await updateDocumentStatus("facture", req.params.id, "envoyee");
    } catch (e) {
      console.warn("[BILLING] Statut update failed:", e.message);
    }

    res.json({
      success: true,
      messageId: info.messageId,
      sentTo: to,
      filename,
    });
  } catch (err) {
    console.error("[BILLING] Send facture error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
