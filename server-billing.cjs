/**
 * Routes de facturation JS-Innov.IA.
 * Le rendu PDF est exclusivement délégué au modèle officiel unique.
 */
const express = require('express');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { generateInvoicePDF, money } = require('./server-billing-template.cjs');
const { storeBuffer, getDocumentBufferForUser } = require('./server-documents.cjs');

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

async function updateDocument(type, id, payload) {
  const table = type === 'facture' ? 'Facture' : 'Devis';
  const response = await fetch(`${AGENT_URL}/data/${table}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Document update ${response.status}: ${await response.text()}`);
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

function auditEvent(req, type, extra = {}) {
  return {
    type,
    date: new Date().toISOString(),
    utilisateur: req.user?.email || req.user?.id || 'system',
    ...extra,
  };
}

function appendEvent(doc, event) {
  const history = Array.isArray(doc.historique_documents) ? doc.historique_documents : [];
  return [...history, event].slice(-200);
}

const archiveLocks = new Map();
async function getOrCreateArchivedPDF(req, doc, type) {
  if (doc.pdf_document_id) {
    const stored = await getDocumentBufferForUser(req.user, doc.pdf_document_id);
    return {
      pdf: stored.buffer,
      filename: stored.record.filename || filenameFor(doc, type),
      documentId: doc.pdf_document_id,
      generated: false,
    };
  }

  const lockKey = `${type}:${doc.id}`;
  if (archiveLocks.has(lockKey)) return archiveLocks.get(lockKey);

  const task = (async () => {
    const pdf = await generateInvoicePDF(doc, type);
    const filename = filenameFor(doc, type);
    const now = new Date().toISOString();
    const archived = await storeBuffer({
      user: req.user,
      organisation: req.user?.organisation || 'jsinnovia',
      brand: 'jsinnovia',
      clientId: doc.client_id || doc.client_nom || '_general',
      category: type === 'facture' ? 'factures' : 'devis',
      filename,
      mimeType: 'application/pdf',
      buffer: pdf,
      source: 'billing-official-v2',
    });
    const generatedHistory = appendEvent(doc, auditEvent(req, 'generation', {
      version: 'official-v2',
      document_id: archived.id,
    }));
    await updateDocument(type, doc.id, {
      pdf_document_id: archived.id,
      pdf_dropbox_path: archived.dropbox_path,
      pdf_dropbox_file_id: archived.dropbox_file_id,
      pdf_sha256: crypto.createHash('sha256').update(pdf).digest('hex'),
      pdf_version: 'official-v2',
      pdf_genere_at: now,
      pdf_genere_par: req.user?.email || req.user?.id || 'system',
      historique_documents: generatedHistory,
    });
    Object.assign(doc, {
      pdf_document_id: archived.id,
      pdf_genere_at: now,
      historique_documents: generatedHistory,
    });
    return { pdf, filename, documentId: archived.id, generated: true };
  })().finally(() => archiveLocks.delete(lockKey));

  archiveLocks.set(lockKey, task);
  return task;
}

async function servePDF(req, res, type) {
  const doc = await fetchDocument(type, req.params.id);
  const archived = await getOrCreateArchivedPDF(req, doc, type);
  const downloadedAt = new Date().toISOString();
  try {
    await updateDocument(type, doc.id, {
      date_dernier_telechargement: downloadedAt,
      nombre_telechargements: Number(doc.nombre_telechargements || 0) + 1,
      historique_documents: appendEvent(doc, auditEvent(req, 'telechargement', {
        document_id: archived.documentId,
      })),
    });
  } catch (error) {
    console.warn(`[BILLING] PDF téléchargé, suivi non mis à jour: ${error.message}`);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${archived.filename}"`);
  res.setHeader('X-PDF-Source', archived.generated ? 'generated-and-archived' : 'dropbox-archive');
  res.send(archived.pdf);
}

async function sendPDF(req, res, type) {
  const doc = await fetchDocument(type, req.params.id);
  const to = req.body?.to || doc.client_email;
  if (!to) return res.status(400).json({ success: false, error: 'Email client manquant.' });

  const transport = getSmtpTransport();
  if (!transport) return res.status(500).json({ success: false, error: 'SMTP non configuré.' });

  const archived = await getOrCreateArchivedPDF(req, doc, type);
  const { pdf, filename } = archived;
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

  const sentAt = new Date().toISOString();
  try {
    await updateDocument(type, req.params.id, {
      statut: type === 'facture' ? 'envoyee' : 'envoye',
      date_premier_envoi: doc.date_premier_envoi || sentAt,
      date_dernier_envoi: sentAt,
      nombre_envois: Number(doc.nombre_envois || 0) + 1,
      dernier_destinataire: to,
      dernier_message_id: info.messageId,
      historique_documents: appendEvent(doc, auditEvent(req, 'envoi', {
        destinataire: to,
        message_id: info.messageId,
        document_id: archived.documentId,
      })),
    });
  } catch (error) {
    console.warn(`[BILLING] Email envoyé, suivi non mis à jour: ${error.message}`);
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
