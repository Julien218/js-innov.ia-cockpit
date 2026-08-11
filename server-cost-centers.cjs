// ============================================================
// server-cost-centers.cjs — Multi-client Cost Center Billing
// 
// Routes:
//   GET    /api/cost-centers                    — list all
//   POST   /api/cost-centers                    — create
//   GET    /api/cost-centers/:id                — get one
//   PATCH  /api/cost-centers/:id                — update
//   GET    /api/cost-centers/:id/mappings       — list mappings
//   POST   /api/cost-centers/:id/mappings       — add mapping
//   DELETE /api/cost-centers/:id/mappings/:mid — remove mapping
//   POST   /api/cost-centers/:id/import-costs   — import costs from OpenAI/Railway
//   POST   /api/cost-centers/:id/generate-invoice — generate monthly draft
//   GET    /api/cost-centers/:id/invoices       — list invoices
//   GET    /api/cost-centers/invoices/:id       — get invoice detail
//   GET    /api/cost-centers/invoices/:id/pdf    — download PDF
//   GET    /api/cost-centers/invoices/:id/ubl    — download UBL XML
//   POST   /api/cost-centers/invoices/:id/send  — send by email
//   POST   /api/cost-centers/invoices/:id/mark-paid — mark as paid
//   POST   /api/cost-centers/invoices/:id/cancel — cancel invoice
//   POST   /api/cost-centers/invoices/:id/remind — send reminder
//   POST   /api/cost-centers/invoices/:id/resync — resync costs (draft only)
//   POST   /api/cost-centers/run-monthly-billing — run monthly billing for all
// ============================================================

const express = require("express");
const router = express.Router();
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

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
const AGENT_URL = process.env.VITE_AGENT_URL || process.env.JSINNOVIA_AGENT_URL || "https://jsinnovia-agent-production.up.railway.app";
const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || "";

const STORE_EMAIL = process.env.EMAIL_STORE_ADDRESS || "info@jsinnovia.store";
const STORE_PASSWORD = process.env.EMAIL_PASSWORD_STORE || "";
const STORE_SMTP_HOST = "smtp.ionos.fr";
const STORE_SMTP_PORT = 465;

const OPENAI_ADMIN_KEY = process.env.OPENAI_ADMIN_KEY || "";
const RAILWAY_API_TOKEN = process.env.RAILWAY_API_TOKEN || "";
const RAILWAY_COSTS_ENDPOINT = process.env.RAILWAY_COSTS_ENDPOINT || "";
const BILLING_EUR_PER_USD = parseFloat(process.env.BILLING_EUR_PER_USD || "0.92");

// Logo path
const LOGO_PATH = path.join(__dirname, "assets", "logo-phoenix.png");
const HAS_LOGO = fs.existsSync(LOGO_PATH);

// ─── Colors (matches existing billing module) ────────────────────────────────
const C = {
  noir: "#0B0B0F", dark: "#1A1A2E", gold: "#C9952A", gold2: "#D4AF37",
  white: "#FFFFFF", grey: "#666666", lgrey: "#F5F5F5",
  border: "#E8E0D0", text: "#1A1A1A", orange: "#E8943A",
};

// ─── Supabase proxy (through jsinnovia-agent) ────────────────────────────────
async function dbFetch(table, method = "GET", body = null, id = null) {
  const url = id
    ? `${AGENT_URL}/data/${table}/${id}`
    : `${AGENT_URL}/data/${table}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
  };
  if (body && ["POST", "PUT", "PATCH"].includes(method)) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Agent API ${res.status}: ${txt}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function dbQuery(table, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => params.set(k, String(v)));
  const url = `${AGENT_URL}/data/${table}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", "x-agent-key": AGENT_KEY },
  });
  if (!res.ok) throw new Error(`Agent API ${res.status}`);
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function minorToEUR(minor) { return (minor / 100).toFixed(2); }
function eurToMinor(eur) { return Math.round(parseFloat(eur) * 100); }
function usdToEurMinor(usd) { return Math.round(parseFloat(usd) * BILLING_EUR_PER_USD * 100); }
function fmtEUR(minor) { return `${minorToEUR(minor)} €`; }

function generateInvoiceNumber(year, month, seq = 1) {
  const mm = String(month).padStart(2, "0");
  const ss = String(seq).padStart(3, "0");
  return `CC-${year}-${mm}-${ss}`;
}

function hashData(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function getPreviousMonth(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

// ─── OpenAI Cost Import ───────────────────────────────────────────────────────
async function importOpenAICharges(mapping, periodYear, periodMonth) {
  if (!OPENAI_ADMIN_KEY) {
    return { lines: [], totalUsd: 0, error: "OPENAI_ADMIN_KEY not configured" };
  }

  // Calculate date range for the period (previous month)
  const startDate = new Date(Date.UTC(periodYear, periodMonth - 1, 1));
  const endDate = new Date(Date.UTC(periodYear, periodMonth, 1));
  const startTs = Math.floor(startDate.getTime() / 1000);
  const endTs = Math.floor(endDate.getTime() / 1000);

  const projectId = mapping.external_id;
  const url = `https://api.openai.com/v1/organization/costs?start_time=${startTs}&end_time=${endTs}&limit=365&project_id=${projectId}`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${OPENAI_ADMIN_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const txt = await res.text();
    return { lines: [], totalUsd: 0, error: `OpenAI API ${res.status}: ${txt}` };
  }

  const data = await res.json();
  const costLines = [];
  let totalUsd = 0;

  for (const item of (data.data || [])) {
    const model = item.name || item.model || "unknown";
    const costUsd = parseFloat(item.cost || item.amount || 0);
    if (costUsd <= 0) continue;

    totalUsd += costUsd;
    costLines.push({
      line_type: "llm_api",
      description: `OpenAI API — ${model}`,
      quantity: 1,
      unit_price_minor: usdToEurMinor(costUsd),
      total_minor: usdToEurMinor(costUsd),
      external_ref: `openai:${projectId}:${model}`,
      metadata: { source: "openai", model, cost_usd: costUsd, project_id: projectId },
    });
  }

  return { lines: costLines, totalUsd, totalEurMinor: usdToEurMinor(totalUsd) };
}

// ─── Railway Cost Import ─────────────────────────────────────────────────────
async function importRailwayCharges(mapping, periodYear, periodMonth) {
  if (!RAILWAY_API_TOKEN) {
    return { lines: [], totalUsd: 0, error: "RAILWAY_API_TOKEN not configured" };
  }

  const projectId = mapping.external_id;

  // Try RAILWAY_COSTS_ENDPOINT if configured
  if (RAILWAY_COSTS_ENDPOINT) {
    const url = `${RAILWAY_COSTS_ENDPOINT}?project_id=${projectId}&year=${periodYear}&month=${periodMonth}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${RAILWAY_API_TOKEN}` },
    });
    if (!res.ok) {
      return { lines: [], totalUsd: 0, error: `Railway API ${res.status}` };
    }
    const data = await res.json();
    const costLines = [];
    let totalUsd = 0;
    for (const item of (data.costs || data.data || [])) {
      const costUsd = parseFloat(item.cost || item.amount || 0);
      if (costUsd <= 0) continue;
      totalUsd += costUsd;
      costLines.push({
        line_type: "railway",
        description: `Railway — ${item.service || item.name || "Infrastructure"}`,
        quantity: 1,
        unit_price_minor: usdToEurMinor(costUsd),
        total_minor: usdToEurMinor(costUsd),
        external_ref: `railway:${projectId}:${item.service || item.name || ""}`,
        metadata: { source: "railway", cost_usd: costUsd, project_id: projectId },
      });
    }
    return { lines: costLines, totalUsd, totalEurMinor: usdToEurMinor(totalUsd) };
  }

  // Fallback: Railway GraphQL API (usage metrics)
  // Note: Railway doesn't expose a direct cost endpoint via GraphQL.
  // This is a placeholder that returns a descriptive line.
  return {
    lines: [{
      line_type: "railway",
      description: `Railway — ${mapping.external_label || projectId} (manual entry required)`,
      quantity: 1,
      unit_price_minor: 0,
      total_minor: 0,
      external_ref: `railway:${projectId}`,
      metadata: { source: "railway", project_id: projectId, manual: true },
    }],
    totalUsd: 0,
    totalEurMinor: 0,
    error: "RAILWAY_COSTS_ENDPOINT not configured — manual entry required",
  };
}

// ─── Totals calculation ───────────────────────────────────────────────────────
function calculateTotals(lines) {
  const subtotalMinor = lines.reduce((sum, l) => sum + (l.total_minor || 0), 0);
  const taxRate = 21; // 21% TVA Belgium
  const taxAmountMinor = Math.round(subtotalMinor * taxRate / 100);
  const totalMinor = subtotalMinor + taxAmountMinor;
  return { subtotalMinor, taxRate, taxAmountMinor, totalMinor };
}

// ─── UBL/EN16931 XML Generation ──────────────────────────────────────────────
function generateUblXml(invoice, costCenter, lines) {
  const invoiceDate = new Date(invoice.created_at).toISOString().split("T")[0];
  const dueDate = invoice.due_date || invoiceDate;
  const currency = invoice.currency || "EUR";
  
  // Supplier: JS-Innov.IA
  // Customer: from cost center
  const supplierName = "JS-Innov.IA";
  const supplierVat = "BE0877926214";
  const supplierAddress = "Dour, Belgique";

  let lineXml = "";
  let lineNum = 1;
  for (const line of lines) {
    const lineAmount = (line.total_minor / 100).toFixed(2);
    const unitPrice = (line.unit_price_minor / 100).toFixed(2);
    const taxAmount = (line.total_minor * 0.21 / 100).toFixed(2);
    lineXml += `
    <cac:InvoiceLine>
      <cbc:ID>${lineNum}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="C62">${line.quantity}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="${currency}">${lineAmount}</cbc:LineExtensionAmount>
      <cac:Item>
        <cbc:Description>${escapeXml(line.description)}</cbc:Description>
        <cbc:Name>${escapeXml(line.description)}</cbc:Name>
      </cac:Item>
      <cac:Price>
        <cbc:PriceAmount currencyID="${currency}">${unitPrice}</cbc:PriceAmount>
      </cac:Price>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${currency}">${taxAmount}</cbc:TaxAmount>
        <cac:TaxSubtotal>
          <cbc:TaxableAmount currencyID="${currency}">${lineAmount}</cbc:TaxableAmount>
          <cbc:TaxAmount currencyID="${currency}">${taxAmount}</cbc:TaxAmount>
          <cac:TaxCategory>
            <cbc:ID>S</cbc:ID>
            <cbc:Percent>21</cbc:Percent>
            <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
          </cac:TaxCategory>
        </cac:TaxSubtotal>
      </cac:TaxTotal>
    </cac:InvoiceLine>`;
    lineNum++;
  }

  const subtotal = (invoice.subtotal_minor / 100).toFixed(2);
  const taxAmount = (invoice.tax_amount_minor / 100).toFixed(2);
  const total = (invoice.total_minor / 100).toFixed(2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>
  <cbc:ID>${invoice.invoice_number}</cbc:ID>
  <cbc:IssueDate>${invoiceDate}</cbc:IssueDate>
  <cbc:DueDate>${dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${escapeXml(supplierName)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:CityName>Dour</cbc:CityName>
        <cbc:CountryCode>BE</cbc:CountryCode>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>BE${supplierVat}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${escapeXml(costCenter.client_name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:CityName>Dour</cbc:CityName>
        <cbc:CountryCode>BE</cbc:CountryCode>
      </cac:PostalAddress>
      ${costCenter.client_vat_number ? `<cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(costCenter.client_vat_number)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : ""}
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${taxAmount}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${subtotal}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${taxAmount}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>21</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${subtotal}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${subtotal}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${total}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${total}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineXml}
</Invoice>`;
}

function escapeXml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// ─── PDF Generation (simplified, follows existing billing patterns) ─────────
function generateInvoicePdf(invoice, costCenter, lines) {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const pdf = new PDFDocument({ size: "A4", margin: 40 });
    pdf.on("data", (chunk) => buffers.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(buffers)));
    pdf.on("error", reject);

    const W = pdf.page.width;
    const ML = 40;
    const MR = W - 40;

    // Header
    pdf.rect(0, 0, W, 100).fill(C.noir);
    if (HAS_LOGO) {
      try { pdf.image(LOGO_PATH, ML, 15, { height: 70, fit: [70, 70] }); } catch {}
    } else {
      pdf.circle(ML + 28, 40, 28).fill(C.gold);
    }
    pdf.fillColor(C.gold).fontSize(22).font("Helvetica-Bold").text("JS-Innov.IA", ML + 80, 28);
    pdf.fillColor(C.white).fontSize(10).font("Helvetica").text("Intelligence artificielle amplifiée par l'humain", ML + 80, 55);
    
    // Invoice title
    pdf.fillColor(C.white).fontSize(14).font("Helvetica-Bold").text("FACTURE", MR - 120, 30, { width: 120, align: "right" });
    pdf.fillColor(C.gold).fontSize(10).font("Helvetica").text(invoice.invoice_number, MR - 120, 50, { width: 120, align: "right" });
    pdf.fillColor(C.white).fontSize(8).text(`Période: ${String(invoice.period_month).padStart(2, "0")}/${invoice.period_year}`, MR - 120, 65, { width: 120, align: "right" });

    // Client info
    pdf.fillColor(C.text).fontSize(11).font("Helvetica-Bold").text(costCenter.client_name, ML, 120);
    pdf.fontSize(9).font("Helvetica").fillColor(C.grey);
    if (costCenter.client_address) pdf.text(costCenter.client_address, ML, 138);
    if (costCenter.client_email) pdf.text(costCenter.client_email, ML, 152);

    // Status badge
    pdf.fontSize(9).fillColor(C.gold).font("Helvetica-Bold").text(`Statut: ${invoice.status.toUpperCase()}`, MR - 150, 120, { width: 150, align: "right" });

    // Table header
    let y = 180;
    pdf.rect(ML, y, MR - ML, 24).fill(C.dark);
    pdf.fillColor(C.white).fontSize(9).font("Helvetica-Bold");
    pdf.text("Description", ML + 8, y + 7, { width: 280 });
    pdf.text("Qté", ML + 300, y + 7, { width: 40, align: "center" });
    pdf.text("Prix unit.", ML + 350, y + 7, { width: 70, align: "right" });
    pdf.text("Total HTVA", MR - 70, y + 7, { width: 70, align: "right" });
    y += 24;

    // Lines
    pdf.font("Helvetica").fontSize(8);
    for (const line of lines) {
      if (y > 650) { pdf.addPage(); y = 40; }
      const bg = (y / 24) % 2 === 0 ? C.lgrey : C.white;
      pdf.rect(ML, y, MR - ML, 22).fill(bg).fillColor(C.text);
      pdf.text(line.description, ML + 8, y + 6, { width: 280 });
      pdf.text(String(line.quantity), ML + 300, y + 6, { width: 40, align: "center" });
      pdf.text(fmtEUR(line.unit_price_minor), ML + 350, y + 6, { width: 70, align: "right" });
      pdf.text(fmtEUR(line.total_minor), MR - 70, y + 6, { width: 70, align: "right" });
      y += 22;
    }

    // Totals
    y += 10;
    pdf.fillColor(C.text).fontSize(9).font("Helvetica");
    pdf.text("Sous-total HTVA:", MR - 200, y, { width: 130, align: "right" });
    pdf.text(fmtEUR(invoice.subtotal_minor), MR - 70, y, { width: 70, align: "right" });
    y += 18;
    pdf.text(`TVA (${invoice.tax_rate}%):`, MR - 200, y, { width: 130, align: "right" });
    pdf.text(fmtEUR(invoice.tax_amount_minor), MR - 70, y, { width: 70, align: "right" });
    y += 22;
    pdf.rect(MR - 210, y - 4, 210, 26).fill(C.gold).fillColor(C.white);
    pdf.fontSize(11).font("Helvetica-Bold").text("Total TTC:", MR - 200, y + 2, { width: 130, align: "right" });
    pdf.text(fmtEUR(invoice.total_minor), MR - 70, y + 2, { width: 70, align: "right" });

    // Footer
    pdf.fillColor(C.grey).fontSize(7).font("Helvetica");
    pdf.text("JS-Innov.IA® — BCE 0877.926.214 — Dour, Belgique", ML, 780, { width: MR - ML, align: "center" });
    pdf.text("When Vision meets Intelligence.", ML, 790, { width: MR - ML, align: "center" });

    pdf.end();
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

// ============================================================
// ROUTES — Cost Centers CRUD
// ============================================================

router.get("/", async (req, res) => {
  try {
    const centers = await dbQuery("client_cost_centers", { is_active: "true" });
    res.json(centers || []);
  } catch (err) {
    console.error("[CC] List error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { product_code, client_name, client_email, client_address, client_vat_number, monthly_fee_minor, currency } = req.body;
    if (!product_code || !client_name) {
      return res.status(400).json({ error: "product_code et client_name requis" });
    }
    const center = await dbFetch("client_cost_centers", "POST", {
      product_code, client_name, client_email, client_address, client_vat_number,
      monthly_fee_minor: monthly_fee_minor || 0,
      currency: currency || "EUR",
      is_active: true,
    });
    res.status(201).json(center);
  } catch (err) {
    console.error("[CC] Create error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const center = await dbFetch("client_cost_centers", "GET", null, req.params.id);
    if (!center) return res.status(404).json({ error: "Cost center non trouvé" });
    const mappings = await dbQuery("client_external_mappings", { cost_center_id: req.params.id });
    center.mappings = mappings || [];
    res.json(center);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const allowed = ["client_name", "client_email", "client_address", "client_vat_number", "monthly_fee_minor", "currency", "is_active", "metadata"];
    const update = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];
    const center = await dbFetch("client_cost_centers", "PATCH", update, req.params.id);
    res.json(center);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTES — External Mappings
// ============================================================

router.get("/:id/mappings", async (req, res) => {
  try {
    const mappings = await dbQuery("client_external_mappings", { cost_center_id: req.params.id });
    res.json(mappings || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/mappings", async (req, res) => {
  try {
    const { service_type, external_id, external_label } = req.body;
    if (!service_type || !external_id) {
      return res.status(400).json({ error: "service_type et external_id requis" });
    }

    // Verify the external_id doesn't already belong to another cost center
    const existing = await dbQuery("client_external_mappings", { service_type, external_id, is_active: "true" });
    if (existing && existing.length > 0 && existing[0].cost_center_id !== req.params.id) {
      return res.status(409).json({ error: `Cet external_id appartient déjà au cost center: ${existing[0].cost_center_id}` });
    }

    const mapping = await dbFetch("client_external_mappings", "POST", {
      cost_center_id: req.params.id,
      service_type, external_id, external_label,
      is_active: true,
    });
    res.status(201).json(mapping);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id/mappings/:mid", async (req, res) => {
  try {
    await dbFetch("client_external_mappings", "DELETE", null, req.params.mid);
    res.json({ success: true, id: req.params.mid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTES — Cost Import
// ============================================================

router.post("/:id/import-costs", async (req, res) => {
  try {
    const { period_year, period_month } = req.body;
    if (!period_year || !period_month) {
      return res.status(400).json({ error: "period_year et period_month requis" });
    }

    const center = await dbFetch("client_cost_centers", "GET", null, req.params.id);
    if (!center) return res.status(404).json({ error: "Cost center non trouvé" });

    const mappings = await dbQuery("client_external_mappings", { cost_center_id: req.params.id, is_active: "true" });
    const allLines = [];
    const importLogs = [];

    for (const mapping of (mappings || [])) {
      const importHash = hashData({ mapping_id: mapping.id, period_year, period_month });
      
      // Check idempotency — skip if already imported
      const existingImports = await dbQuery("client_cost_imports", {
        cost_center_id: req.params.id, service_type: mapping.service_type,
        period_year, period_month, import_hash: importHash,
      });
      if (existingImports && existingImports.length > 0) {
        importLogs.push({ mapping: mapping.external_label || mapping.external_id, skipped: true, reason: "already_imported" });
        continue;
      }

      let result;
      if (mapping.service_type === "openai_project") {
        result = await importOpenAICharges(mapping, period_year, period_month);
      } else if (mapping.service_type === "railway_project") {
        result = await importRailwayCharges(mapping, period_year, period_month);
      } else {
        continue;
      }

      if (result.lines.length > 0) {
        allLines.push(...result.lines);
      }

      // Log import
      await dbFetch("client_cost_imports", "POST", {
        cost_center_id: req.params.id,
        service_type: mapping.service_type,
        period_year, period_month,
        import_hash: importHash,
        total_cost_minor: result.totalEurMinor || 0,
        line_count: result.lines.length,
      });

      importLogs.push({
        mapping: mapping.external_label || mapping.external_id,
        lines: result.lines.length,
        total_usd: result.totalUsd,
        error: result.error || null,
      });
    }

    res.json({
      cost_center: center.product_code,
      period: `${period_year}-${String(period_month).padStart(2, "0")}`,
      total_lines: allLines.length,
      lines: allLines,
      imports: importLogs,
    });
  } catch (err) {
    console.error("[CC] Import costs error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTES — Invoice Generation
// ============================================================

router.post("/:id/generate-invoice", async (req, res) => {
  try {
    const { period_year, period_month } = req.body;
    if (!period_year || !period_month) {
      return res.status(400).json({ error: "period_year et period_month requis" });
    }

    const center = await dbFetch("client_cost_centers", "GET", null, req.params.id);
    if (!center) return res.status(404).json({ error: "Cost center non trouvé" });
    if (!center.is_active) return res.status(400).json({ error: "Cost center inactif" });

    // Check for existing invoice for this period (non-cancelled)
    const existing = await dbQuery("client_invoices", {
      cost_center_id: req.params.id, period_year, period_month,
    });
    if (existing && existing.length > 0 && existing[0].status !== "cancelled") {
      return res.status(409).json({ error: "Une facture existe déjà pour cette période", invoice: existing[0] });
    }

    // Import costs first
    const mappings = await dbQuery("client_external_mappings", { cost_center_id: req.params.id, is_active: "true" });
    const costLines = [];
    for (const mapping of (mappings || [])) {
      let result;
      if (mapping.service_type === "openai_project") {
        result = await importOpenAICharges(mapping, period_year, period_month);
      } else if (mapping.service_type === "railway_project") {
        result = await importRailwayCharges(mapping, period_year, period_month);
      } else {
        continue;
      }
      costLines.push(...result.lines);
    }

    // Build invoice lines: forfait + cost lines
    const invoiceLines = [];
    let sortOrder = 0;

    // 1. Monthly forfait (always first, excludes domain)
    if (center.monthly_fee_minor > 0) {
      invoiceLines.push({
        line_type: "forfait",
        description: `Forfait mensuel — ${center.product_code}`,
        quantity: 1,
        unit_price_minor: center.monthly_fee_minor,
        total_minor: center.monthly_fee_minor,
        sort_order: sortOrder++,
      });
    }

    // 2. Cost lines (Railway + LLM/API)
    for (const line of costLines) {
      // CRITICAL: Never include domain costs in monthly invoices
      if (line.line_type === "domain" || /domaine/i.test(line.description)) continue;
      invoiceLines.push({ ...line, sort_order: sortOrder++ });
    }

    // Calculate totals
    const totals = calculateTotals(invoiceLines);

    // Generate invoice number
    const invoiceNumber = generateInvoiceNumber(period_year, period_month);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    // Create invoice (DRAFT status)
    const invoice = await dbFetch("client_invoices", "POST", {
      cost_center_id: req.params.id,
      invoice_number: invoiceNumber,
      period_year, period_month,
      status: "draft",
      subtotal_minor: totals.subtotalMinor,
      tax_rate: totals.taxRate,
      tax_amount_minor: totals.taxAmountMinor,
      total_minor: totals.totalMinor,
      currency: center.currency || "EUR",
      due_date: dueDate.toISOString().split("T")[0],
    });

    // Create invoice lines
    const createdLines = [];
    for (const line of invoiceLines) {
      const created = await dbFetch("client_invoice_lines", "POST", {
        ...line,
        invoice_id: invoice.id,
      });
      createdLines.push(created);
    }

    // Log creation in history
    console.log(`[CC] Invoice ${invoiceNumber} created (draft) for ${center.product_code} — ${fmtEUR(totals.totalMinor)} TTC`);

    res.status(201).json({
      invoice,
      lines: createdLines,
      totals: {
        subtotal: fmtEUR(totals.subtotalMinor),
        tax: fmtEUR(totals.taxAmountMinor),
        total: fmtEUR(totals.totalMinor),
      },
    });
  } catch (err) {
    console.error("[CC] Generate invoice error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTES — Invoice Management
// ============================================================

router.get("/:id/invoices", async (req, res) => {
  try {
    const invoices = await dbQuery("client_invoices", { cost_center_id: req.params.id });
    res.json(invoices || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Invoice detail (with lines)
router.get("/invoices/:id", async (req, res) => {
  try {
    const invoice = await dbFetch("client_invoices", "GET", null, req.params.id);
    if (!invoice) return res.status(404).json({ error: "Facture non trouvée" });
    const lines = await dbQuery("client_invoice_lines", { invoice_id: req.params.id });
    invoice.lines = lines || [];
    const center = await dbFetch("client_cost_centers", "GET", null, invoice.cost_center_id);
    invoice.cost_center = center;
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download PDF
router.get("/invoices/:id/pdf", async (req, res) => {
  try {
    const invoice = await dbFetch("client_invoices", "GET", null, req.params.id);
    if (!invoice) return res.status(404).json({ error: "Facture non trouvée" });
    const center = await dbFetch("client_cost_centers", "GET", null, invoice.cost_center_id);
    const lines = await dbQuery("client_invoice_lines", { invoice_id: req.params.id });
    const buf = await generateInvoicePdf(invoice, center, lines || []);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoice_number}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error("[CC] PDF error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Download UBL XML
router.get("/invoices/:id/ubl", async (req, res) => {
  try {
    const invoice = await dbFetch("client_invoices", "GET", null, req.params.id);
    if (!invoice) return res.status(404).json({ error: "Facture non trouvée" });
    const center = await dbFetch("client_cost_centers", "GET", null, invoice.cost_center_id);
    const lines = await dbQuery("client_invoice_lines", { invoice_id: req.params.id });
    const xml = generateUblXml(invoice, center, lines || []);
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoice_number}.xml"`);
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send invoice by email
router.post("/invoices/:id/send", async (req, res) => {
  try {
    const invoice = await dbFetch("client_invoices", "GET", null, req.params.id);
    if (!invoice) return res.status(404).json({ error: "Facture non trouvée" });
    if (invoice.status === "cancelled") return res.status(400).json({ error: "Facture annulée" });

    const center = await dbFetch("client_cost_centers", "GET", null, invoice.cost_center_id);
    const to = req.body?.to || center?.client_email;
    if (!to) return res.status(400).json({ error: "Email client manquant" });

    const lines = await dbQuery("client_invoice_lines", { invoice_id: req.params.id });
    const buf = await generateInvoicePdf(invoice, center, lines || []);
    const transport = getSmtpTransport();
    if (!transport) return res.status(500).json({ error: "SMTP non configuré" });

    const totalStr = fmtEUR(invoice.total_minor);
    const text = `Bonjour ${center?.client_name || ""},\n\nVeuillez trouver votre facture JS-Innov.IA en pièce jointe.\n\nFacture: ${invoice.invoice_number}\nMontant total TTC: ${totalStr}\n\nBien cordialement,\nJulien Pagin — JS-Innov.IA®`;
    const html = `<p>Bonjour ${center?.client_name || ""},</p><p>Veuillez trouver votre facture JS-Innov.IA en pièce jointe.</p><p><strong>Facture: ${invoice.invoice_number}</strong><br><strong>Montant total TTC: ${totalStr}</strong></p><p>Bien cordialement,<br><strong>Julien Pagin — JS-Innov.IA®</strong></p>`;

    const info = await transport.sendMail({
      from: `"JS-Innov.IA" <${STORE_EMAIL}>`,
      to, subject: `Facture JS-Innov.IA — ${invoice.invoice_number}`,
      text, html,
      attachments: [{ filename: `${invoice.invoice_number}.pdf`, content: buf, contentType: "application/pdf" }],
    });

    // Update status: draft → sent
    await dbFetch("client_invoices", "PATCH", {
      status: "sent",
      sent_at: new Date().toISOString(),
    }, req.params.id);

    res.json({ success: true, messageId: info.messageId, sentTo: to, status: "sent" });
  } catch (err) {
    console.error("[CC] Send invoice error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Mark as paid
router.post("/invoices/:id/mark-paid", async (req, res) => {
  try {
    const invoice = await dbFetch("client_invoices", "GET", null, req.params.id);
    if (!invoice) return res.status(404).json({ error: "Facture non trouvée" });
    if (!["sent", "overdue"].includes(invoice.status)) {
      return res.status(400).json({ error: `Impossible de marquer payée une facture "${invoice.status}"` });
    }

    const updated = await dbFetch("client_invoices", "PATCH", {
      status: "paid",
      paid_at: new Date().toISOString(),
    }, req.params.id);

    res.json({ success: true, invoice: updated, status: "paid" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel invoice
router.post("/invoices/:id/cancel", async (req, res) => {
  try {
    const invoice = await dbFetch("client_invoices", "GET", null, req.params.id);
    if (!invoice) return res.status(404).json({ error: "Facture non trouvée" });
    if (invoice.status === "paid") {
      return res.status(400).json({ error: "Impossible d'annuler une facture payée" });
    }

    const updated = await dbFetch("client_invoices", "PATCH", {
      status: "cancelled",
    }, req.params.id);

    res.json({ success: true, invoice: updated, status: "cancelled" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send reminder
router.post("/invoices/:id/remind", async (req, res) => {
  try {
    const invoice = await dbFetch("client_invoices", "GET", null, req.params.id);
    if (!invoice) return res.status(404).json({ error: "Facture non trouvée" });
    if (invoice.status === "paid") {
      return res.status(400).json({ error: "Facture déjà payée — aucun rappel nécessaire" });
    }
    if (invoice.status === "cancelled") {
      return res.status(400).json({ error: "Facture annulée — aucun rappel" });
    }

    const center = await dbFetch("client_cost_centers", "GET", null, invoice.cost_center_id);
    const to = req.body?.to || center?.client_email;
    if (!to) return res.status(400).json({ error: "Email client manquant" });

    // Check existing reminders
    const existingReminders = await dbQuery("client_invoice_reminders", { invoice_id: req.params.id });
    const reminderCount = (existingReminders || []).length;
    const reminderType = reminderCount === 0 ? "first" : reminderCount === 1 ? "second" : "final";

    const transport = getSmtpTransport();
    if (!transport) return res.status(500).json({ error: "SMTP non configuré" });

    const totalStr = fmtEUR(invoice.total_minor);
    const text = `Bonjour ${center?.client_name || ""},\n\nCeci est un rappel (${reminderType}) pour la facture ${invoice.invoice_number}.\n\nMontant à régler: ${totalStr} TTC\n\nMerci de procéder au paiement dans les meilleurs délais.\n\nBien cordialement,\nJulien Pagin — JS-Innov.IA®`;
    const html = `<p>Bonjour ${center?.client_name || ""},</p><p>Ceci est un rappel (${reminderType}) pour la facture <strong>${invoice.invoice_number}</strong>.</p><p><strong>Montant à régler: ${totalStr} TTC</strong></p><p>Merci de procéder au paiement dans les meilleurs délais.</p><p>Bien cordialement,<br><strong>Julien Pagin — JS-Innov.IA®</strong></p>`;

    const info = await transport.sendMail({
      from: `"JS-Innov.IA" <${STORE_EMAIL}>`,
      to, subject: `Rappel — Facture ${invoice.invoice_number} — JS-Innov.IA`,
      text, html,
    });

    // Log reminder
    await dbFetch("client_invoice_reminders", "POST", {
      invoice_id: req.params.id,
      reminder_type: reminderType,
      email_sent: true,
    });

    // Update status to overdue if not already
    if (invoice.status === "sent") {
      await dbFetch("client_invoices", "PATCH", { status: "overdue" }, req.params.id);
    }

    res.json({ success: true, messageId: info.messageId, reminder_type: reminderType, sentTo: to });
  } catch (err) {
    console.error("[CC] Reminder error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Resync costs (draft only — never modify sent/paid invoices)
router.post("/invoices/:id/resync", async (req, res) => {
  try {
    const invoice = await dbFetch("client_invoices", "GET", null, req.params.id);
    if (!invoice) return res.status(404).json({ error: "Facture non trouvée" });
    
    // CRITICAL: Only resync draft invoices
    if (invoice.status !== "draft") {
      return res.status(400).json({ error: `Resync impossible: facture "${invoice.status}" — seul le statut "draft" peut être resynchronisé` });
    }

    const center = await dbFetch("client_cost_centers", "GET", null, invoice.cost_center_id);
    const mappings = await dbQuery("client_external_mappings", { cost_center_id: invoice.cost_center_id, is_active: "true" });

    // Re-import costs for the period
    const costLines = [];
    for (const mapping of (mappings || [])) {
      let result;
      if (mapping.service_type === "openai_project") {
        result = await importOpenAICharges(mapping, invoice.period_year, invoice.period_month);
      } else if (mapping.service_type === "railway_project") {
        result = await importRailwayCharges(mapping, invoice.period_year, invoice.period_month);
      } else {
        continue;
      }
      costLines.push(...result.lines);
    }

    // Build new lines: forfait + cost lines
    const invoiceLines = [];
    let sortOrder = 0;
    if (center.monthly_fee_minor > 0) {
      invoiceLines.push({
        line_type: "forfait",
        description: `Forfait mensuel — ${center.product_code}`,
        quantity: 1,
        unit_price_minor: center.monthly_fee_minor,
        total_minor: center.monthly_fee_minor,
        sort_order: sortOrder++,
      });
    }
    for (const line of costLines) {
      if (line.line_type === "domain" || /domaine/i.test(line.description)) continue;
      invoiceLines.push({ ...line, sort_order: sortOrder++ });
    }

    // Recalculate totals
    const totals = calculateTotals(invoiceLines);

    // Delete old lines
    const oldLines = await dbQuery("client_invoice_lines", { invoice_id: req.params.id });
    for (const old of (oldLines || [])) {
      await dbFetch("client_invoice_lines", "DELETE", null, old.id);
    }

    // Create new lines
    const createdLines = [];
    for (const line of invoiceLines) {
      const created = await dbFetch("client_invoice_lines", "POST", {
        ...line, invoice_id: req.params.id,
      });
      createdLines.push(created);
    }

    // Update invoice totals
    const updated = await dbFetch("client_invoices", "PATCH", {
      subtotal_minor: totals.subtotalMinor,
      tax_amount_minor: totals.taxAmountMinor,
      total_minor: totals.totalMinor,
    }, req.params.id);

    res.json({
      success: true,
      invoice: updated,
      lines: createdLines,
      totals: {
        subtotal: fmtEUR(totals.subtotalMinor),
        tax: fmtEUR(totals.taxAmountMinor),
        total: fmtEUR(totals.totalMinor),
      },
    });
  } catch (err) {
    console.error("[CC] Resync error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ROUTES — Monthly Billing Runner
// ============================================================

router.post("/run-monthly-billing", async (req, res) => {
  try {
    const now = new Date();
    const prevMonth = getPreviousMonth(now.getFullYear(), now.getMonth() + 1);
    
    const centers = await dbQuery("client_cost_centers", { is_active: "true" });
    const results = [];

    for (const center of (centers || [])) {
      // Check if invoice already exists for this period
      const existing = await dbQuery("client_invoices", {
        cost_center_id: center.id, period_year: prevMonth.year, period_month: prevMonth.month,
      });
      if (existing && existing.length > 0 && existing[0].status !== "cancelled") {
        results.push({ product_code: center.product_code, skipped: true, reason: "already_exists" });
        continue;
      }

      // Generate invoice (always as draft)
      try {
        const mappings = await dbQuery("client_external_mappings", { cost_center_id: center.id, is_active: "true" });
        const costLines = [];
        for (const mapping of (mappings || [])) {
          let result;
          if (mapping.service_type === "openai_project") {
            result = await importOpenAICharges(mapping, prevMonth.year, prevMonth.month);
          } else if (mapping.service_type === "railway_project") {
            result = await importRailwayCharges(mapping, prevMonth.year, prevMonth.month);
          } else {
            continue;
          }
          costLines.push(...result.lines);
        }

        const invoiceLines = [];
        let sortOrder = 0;
        if (center.monthly_fee_minor > 0) {
          invoiceLines.push({
            line_type: "forfait",
            description: `Forfait mensuel — ${center.product_code}`,
            quantity: 1, unit_price_minor: center.monthly_fee_minor,
            total_minor: center.monthly_fee_minor, sort_order: sortOrder++,
          });
        }
        for (const line of costLines) {
          if (line.line_type === "domain" || /domaine/i.test(line.description)) continue;
          invoiceLines.push({ ...line, sort_order: sortOrder++ });
        }

        const totals = calculateTotals(invoiceLines);
        const invoiceNumber = generateInvoiceNumber(prevMonth.year, prevMonth.month);
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30);

        const invoice = await dbFetch("client_invoices", "POST", {
          cost_center_id: center.id,
          invoice_number: invoiceNumber,
          period_year: prevMonth.year, period_month: prevMonth.month,
          status: "draft",
          subtotal_minor: totals.subtotalMinor,
          tax_rate: totals.taxRate,
          tax_amount_minor: totals.taxAmountMinor,
          total_minor: totals.totalMinor,
          currency: center.currency || "EUR",
          due_date: dueDate.toISOString().split("T")[0],
        });

        for (const line of invoiceLines) {
          await dbFetch("client_invoice_lines", "POST", { ...line, invoice_id: invoice.id });
        }

        results.push({
          product_code: center.product_code,
          invoice_number: invoiceNumber,
          total_ttc: fmtEUR(totals.totalMinor),
          status: "draft",
          line_count: invoiceLines.length,
        });
      } catch (err) {
        results.push({ product_code: center.product_code, error: err.message });
      }
    }

    res.json({ period: `${prevMonth.year}-${String(prevMonth.month).padStart(2, "0")}`, results });
  } catch (err) {
    console.error("[CC] Monthly billing error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Auto-reminder checker (can be called by cron/scheduler)
// ============================================================

async function checkAndSendReminders() {
  try {
    const overdueInvoices = await dbQuery("client_invoices", { status: "overdue" });
    const results = [];

    for (const invoice of (overdueInvoices || [])) {
      const reminders = await dbQuery("client_invoice_reminders", { invoice_id: invoice.id });
      const count = (reminders || []).length;
      if (count >= 3) continue; // Max 3 reminders

      const center = await dbFetch("client_cost_centers", "GET", null, invoice.cost_center_id);
      if (!center?.client_email) continue;

      const reminderType = count === 0 ? "first" : count === 1 ? "second" : "final";
      const transport = getSmtpTransport();
      if (!transport) continue;

      const totalStr = fmtEUR(invoice.total_minor);
      const text = `Bonjour ${center.client_name},\n\nRappel (${reminderType}) — Facture ${invoice.invoice_number}\nMontant: ${totalStr} TTC\n\nJulien Pagin — JS-Innov.IA®`;

      await transport.sendMail({
        from: `"JS-Innov.IA" <${STORE_EMAIL}>`,
        to: center.client_email,
        subject: `Rappel — Facture ${invoice.invoice_number}`,
        text,
      });

      await dbFetch("client_invoice_reminders", "POST", {
        invoice_id: invoice.id, reminder_type: reminderType, email_sent: true,
      });

      results.push({ invoice: invoice.invoice_number, reminder_type: reminderType });
    }

    return results;
  } catch (err) {
    console.error("[CC] Auto-reminder error:", err.message);
    return [];
  }
}

// Export for testing and external use
module.exports = router;
module.exports.checkAndSendReminders = checkAndSendReminders;
module.exports.calculateTotals = calculateTotals;
module.exports.generateInvoiceNumber = generateInvoiceNumber;
module.exports.generateUblXml = generateUblXml;
module.exports.importOpenAICharges = importOpenAICharges;
module.exports.importRailwayCharges = importRailwayCharges;
module.exports.hashData = hashData;
module.exports.getPreviousMonth = getPreviousMonth;
module.exports.minorToEUR = minorToEUR;
module.exports.eurToMinor = eurToMinor;
module.exports.usdToEurMinor = usdToEurMinor;
module.exports.escapeXml = escapeXml;
