/**
 * Routes de facturation JS-Innov.IA.
 * Le rendu PDF est exclusivement délégué au modèle officiel unique.
 */
const express = require('express');
const nodemailer = require('nodemailer');
const { generateInvoicePDF, money } = require('./server-billing-template.cjs');

const router = express.Router();

function requireApiKey(req, res, next) {
  if (req.user) return next();
  const key = req.headers['x-agent-key'] || req.headers['x-api-key'];
  if (!key || key !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

router.use(requireApiKey);

const STORE_EMAIL = process.env.EMAIL_STORE_ADDRESS || 'info@jsinnovia.store';
const STORE_PASSWORD = process.env.EMAIL_PASSWORD_STORE || '';
const AGENT_URL = process.env.VITE_AGENT_URL
  || process.env.JSINNOVIA_AGENT_URL
  || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';

async function fetchDocument(type, id) {
  const table = type === 'facture' ? 'Facture' : 'Devis';
  const response = await fetch(`${AGENT_URL}/data/${table}/${id}`, {
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY },
  });
  if (!response.ok) throw new Error(`Agent API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function updateDocumentStatus(type, id, statut) {
  const table = type === 'facture' ? 'Facture' : 'Devis';
  const response = await fetch(`${AGENT_URL}/data/${table}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY },
    body: JSON.stringify({ statut }),
  });
  if (!response.ok) throw new Error(`Status update ${response.status}`);
  return response.json();
}

let smtpTransport;
function getSmtpTransport() {
  if (smtpTransport) return smtpTransport;
  if (!STORE_PASSWORD) return null;
  smtpTransport = nodemailer.createTransport({
    host: 'smtp.ionos.fr',
    port: 465,
    secure: true,
    auth: { user: STORE_EMAIL, pass: STORE_PASSWORD },
    tls: { rejectUnauthorized: false },
  });
  return smtpTransport;
}

function filenameFor(doc, type) {
  return `${String(doc.numero || type).toUpperCase()}.pdf`;
}

async function servePDF(req, res, type) {
  const doc = await fetchDocument(type, req.params.id);
  const pdf = await generateInvoicePDF(doc, type);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameFor(doc, type)}"`);
  res.send(pdf);
}

async function sendPDF(req, res, type) {
  const doc = await fetchDocument(type, req.params.id);
  const to = req.body?.to || doc.client_email;
  if (!to) return res.status(400).json({ success: false, error: 'Email client manquant.' });

  const transport = getSmtpTransport();
  if (!transport) return res.status(500).json({ success: false, error: 'SMTP non configuré.' });

  const pdf = await generateInvoicePDF(doc, type);
  const filename = filenameFor(doc, type);
  const label = type === 'facture' ? 'facture' : 'devis';
  const customMessage = req.body?.message || '';
  const greeting = `Bonjour ${doc.client_nom || ''},`;
  const body = `Veuillez trouver votre ${label} JS-Innov.IA en pièce jointe.`;
  const total = `Montant total TTC : ${money(doc.montant_ttc)}`;
  const closing = 'Bien cordialement,\nJulien Pagin — JS-Innov.IA®';

  const info = await transport.sendMail({
    from: `"JS-Innov.IA" <${STORE_EMAIL}>`,
    to,
    subject: `Votre ${label} JS-Innov.IA — ${String(doc.numero || '').toUpperCase()}`,
    text: [greeting, '', body, '', total, customMessage, '', closing].filter(Boolean).join('\n'),
    html: `<p>${greeting}</p><p>${body}</p><p><strong>${total}</strong></p>${
      customMessage ? `<p>${customMessage.replace(/\n/g, '<br>')}</p>` : ''
    }<p>Bien cordialement,<br><strong>Julien Pagin — JS-Innov.IA®</strong></p>`,
    attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
  });

  try {
    await updateDocumentStatus(type, req.params.id, type === 'facture' ? 'envoyee' : 'envoye');
  } catch (error) {
    console.warn(`[BILLING] PDF envoyé, statut non mis à jour: ${error.message}`);
  }
  return res.json({ success: true, messageId: info.messageId, sentTo: to, filename });
}

for (const type of ['devis', 'facture']) {
  const route = type === 'facture' ? 'factures' : 'devis';
  router.post(`/${route}/:id/pdf`, async (req, res) => {
    try { await servePDF(req, res, type); }
    catch (error) {
      console.error(`[BILLING] PDF ${type} error:`, error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  router.post(`/${route}/:id/send`, async (req, res) => {
    try { await sendPDF(req, res, type); }
    catch (error) {
      console.error(`[BILLING] Send ${type} error:`, error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = router;
