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

function tenantForRequest(req) {
  return String(req.user?.organisation || 'jsinnovia').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function agentHeaders(tenant) {
  return { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY, 'x-organisation-id': tenant || 'jsinnovia' };
}

async function fetchDocument(type, id, tenant) {
  const table = type === 'facture' ? 'Facture' : 'Devis';
  const response = await fetch(`${AGENT_URL}/data/${table}/${id}`, {
    headers: agentHeaders(tenant),
  });
  if (!response.ok) throw new Error(`Agent API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function updateDocument(type, id, payload, tenant) {
  const table = type === 'facture' ? 'Facture' : 'Devis';
  const response = await fetch(`${AGENT_URL}/data/${table}/${id}`, {
    method: 'PATCH',
    headers: agentHeaders(tenant),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Document update ${response.status}: ${await response.text()}`);
  return response.json();
}

async function fetchClient(clientId, tenant) {
  if (!clientId) {
    const error = new Error('Anomalie : ce document n’est rattaché à aucun client du Cockpit.');
    error.status = 422;
    error.code = 'DOCUMENT_WITHOUT_CLIENT';
    error.details = { missingFields: ['client_id'] };
    throw error;
  }
  const response = await fetch(`${AGENT_URL}/data/Client/${encodeURIComponent(clientId)}`, {
    headers: agentHeaders(tenant),
  });
  if (!response.ok) {
    const error = new Error('Anomalie : le client rattaché à ce document n’existe plus dans le Cockpit.');
    error.status = 422;
    error.code = 'CLIENT_NOT_FOUND';
    error.details = { clientId };
    throw error;
  }
  return response.json();
}

const BILLING_FIELD_LABELS = {
  denomination_legale: 'dénomination légale',
  adresse: 'adresse du siège',
  code_postal: 'code postal',
  ville: 'ville',
  pays: 'pays',
  numero_entreprise: 'numéro d’entreprise',
  numero_tva: 'numéro de TVA',
  email_facturation: 'email de facturation',
  verification: 'validation des informations légales',
};

function clean(value) {
  return String(value || '').trim();
}

function buildBillingProfile(client, doc = {}) {
  return {
    denomination_legale: clean(client.denomination_legale || client.entreprise || doc.client_denomination_legale || doc.client_nom),
    adresse: clean(client.adresse || doc.client_adresse),
    code_postal: clean(client.code_postal || doc.client_code_postal),
    ville: clean(client.ville || doc.client_ville),
    pays: clean(client.pays || doc.client_pays),
    numero_entreprise: clean(client.numero_entreprise || doc.client_numero_entreprise),
    numero_tva: clean(client.numero_tva || doc.client_tva),
    email_facturation: clean(client.email_facturation || client.email || doc.client_email),
    verification: client.facturation_statut === 'verifie' ? 'verifie' : '',
  };
}

function hasCompleteRegisteredAddress(profile) {
  const addressWithoutPostalCode = profile.adresse.replace(profile.code_postal, ' ');
  return /[a-zA-ZÀ-ÿ]/.test(addressWithoutPostalCode) && /\d/.test(addressWithoutPostalCode);
}

function missingBillingFields(profile) {
  return Object.keys(BILLING_FIELD_LABELS).filter((field) => {
    if (field === 'adresse') return !profile.adresse || !hasCompleteRegisteredAddress(profile);
    return !profile[field];
  });
}

async function prepareDocumentForBilling(doc, tenant) {
  const client = await fetchClient(doc.client_id, tenant);
  const profile = buildBillingProfile(client, doc);
  const missingFields = missingBillingFields(profile);
  if (missingFields.length) {
    const error = new Error(
      `Informations légales incomplètes pour ${profile.denomination_legale || doc.client_nom || 'ce client'} : ${missingFields.map((field) => BILLING_FIELD_LABELS[field]).join(', ')}.`
    );
    error.status = 422;
    error.code = 'CLIENT_INFORMATION_INCOMPLETE';
    error.details = {
      clientId: client.id,
      clientEmail: profile.email_facturation || null,
      clientName: profile.denomination_legale || doc.client_nom || null,
      missingFields,
      missingLabels: missingFields.map((field) => BILLING_FIELD_LABELS[field]),
      canRequestByEmail: Boolean(profile.email_facturation),
    };
    throw error;
  }
  return {
    client,
    profile,
    document: {
      ...doc,
      client_nom: profile.denomination_legale,
      client_denomination_legale: profile.denomination_legale,
      client_adresse: profile.adresse,
      client_code_postal: profile.code_postal,
      client_ville: `${profile.code_postal} ${profile.ville}, ${profile.pays}`,
      client_pays: profile.pays,
      client_tva: profile.numero_tva,
      client_numero_entreprise: profile.numero_entreprise,
      client_email: profile.email_facturation,
    },
  };
}

function sendBillingError(res, error) {
  const status = Number(error.status) || 500;
  return res.status(status).json({
    success: false,
    error: error.message,
    code: error.code || 'BILLING_ERROR',
    ...(error.details || {}),
  });
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
  const tenant = tenantForRequest(req);
  const prepared = await prepareDocumentForBilling(doc, tenant);
  Object.assign(doc, prepared.document);

  if (doc.pdf_document_id && doc.pdf_version === 'official-v3-legal' && doc.pdf_conformite_statut === 'conforme') {
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
      source: 'billing-official-v3-legal',
    });
    const generatedHistory = appendEvent(doc, auditEvent(req, 'generation', {
      version: 'official-v3-legal',
      replaced_document_id: doc.pdf_document_id || null,
      document_id: archived.id,
    }));
    await updateDocument(type, doc.id, {
      pdf_document_id: archived.id,
      pdf_dropbox_path: archived.dropbox_path,
      pdf_dropbox_file_id: archived.dropbox_file_id,
      pdf_sha256: crypto.createHash('sha256').update(pdf).digest('hex'),
      pdf_version: 'official-v3-legal',
      pdf_genere_at: now,
      pdf_genere_par: req.user?.email || req.user?.id || 'system',
      pdf_conformite_statut: 'conforme',
      client_denomination_legale: doc.client_denomination_legale,
      client_adresse: doc.client_adresse,
      client_code_postal: doc.client_code_postal,
      client_ville: doc.client_ville,
      client_pays: doc.client_pays,
      client_tva: doc.client_tva,
      client_numero_entreprise: doc.client_numero_entreprise,
      client_email: doc.client_email,
      client_nom: doc.client_nom,
      historique_documents: generatedHistory,
    }, tenant);
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
  const tenant = tenantForRequest(req);
  const doc = await fetchDocument(type, req.params.id, tenant);
  const archived = await getOrCreateArchivedPDF(req, doc, type);
  const downloadedAt = new Date().toISOString();
  try {
    await updateDocument(type, doc.id, {
      date_dernier_telechargement: downloadedAt,
      nombre_telechargements: Number(doc.nombre_telechargements || 0) + 1,
      historique_documents: appendEvent(doc, auditEvent(req, 'telechargement', {
        document_id: archived.documentId,
      })),
    }, tenant);
  } catch (error) {
    console.warn(`[BILLING] PDF téléchargé, suivi non mis à jour: ${error.message}`);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${archived.filename}"`);
  res.setHeader('X-PDF-Source', archived.generated ? 'generated-and-archived' : 'dropbox-archive');
  res.send(archived.pdf);
}

async function sendPDF(req, res, type) {
  const tenant = tenantForRequest(req);
  const doc = await fetchDocument(type, req.params.id, tenant);
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
    }, tenant);
  } catch (error) {
    console.warn(`[BILLING] Email envoyé, suivi non mis à jour: ${error.message}`);
  }
  return res.json({ success: true, messageId: info.messageId, sentTo: to, filename });
}

router.post('/clients/:id/request-information', async (req, res) => {
  try {
    const tenant = tenantForRequest(req);
    const client = await fetchClient(req.params.id, tenant);
    const profile = buildBillingProfile(client);
    const missingFields = missingBillingFields(profile);
    if (!missingFields.length) {
      return res.status(409).json({ success: false, error: 'Les informations de facturation sont déjà complètes et vérifiées.' });
    }
    if (!profile.email_facturation) {
      return res.status(422).json({
        success: false,
        code: 'CLIENT_EMAIL_MISSING',
        error: 'Aucun email fiable n’est enregistré pour demander les informations manquantes.',
        clientId: client.id,
      });
    }
    const transport = getSmtpTransport();
    if (!transport) return res.status(500).json({ success: false, error: 'SMTP non configuré.' });

    const missingLabels = missingFields.map((field) => BILLING_FIELD_LABELS[field]);
    const recipientName = clean(client.prenom || client.nom || client.entreprise);
    const greeting = recipientName ? `Bonjour ${recipientName},` : 'Bonjour,';
    const requestedList = missingLabels.map((label) => `- ${label}`).join('\n');
    const text = [
      greeting,
      '',
      'Afin d’établir vos devis et factures avec des informations exactes et conformes, pourriez-vous nous confirmer les éléments suivants :',
      requestedList,
      '',
      'Merci de répondre directement à cet email avec les informations officielles de votre entreprise ou association.',
      '',
      'Bien cordialement,',
      'Julien Pagin — JS-Innov.IA®',
    ].join('\n');
    const htmlList = missingLabels.map((label) => `<li>${label}</li>`).join('');
    const info = await transport.sendMail({
      from: `"JS-Innov.IA" <${STORE_EMAIL}>`,
      to: profile.email_facturation,
      subject: 'Confirmation de vos informations légales de facturation',
      text,
      html: `<p>${greeting}</p><p>Afin d’établir vos devis et factures avec des informations exactes et conformes, pourriez-vous nous confirmer les éléments suivants :</p><ul>${htmlList}</ul><p>Merci de répondre directement à cet email avec les informations officielles de votre entreprise ou association.</p><p>Bien cordialement,<br><strong>Julien Pagin — JS-Innov.IA®</strong></p>`,
    });

    const now = new Date().toISOString();
    const response = await fetch(`${AGENT_URL}/data/Client/${encodeURIComponent(client.id)}`, {
      method: 'PATCH',
      headers: agentHeaders(tenant),
      body: JSON.stringify({
        facturation_statut: 'informations_demandees',
        facturation_demande_at: now,
        facturation_demande_message_id: info.messageId,
        facturation_source: 'email-client',
      }),
    });
    if (!response.ok) console.warn('[BILLING] Demande envoyée mais suivi client non mis à jour');

    return res.json({
      success: true,
      sentTo: profile.email_facturation,
      messageId: info.messageId,
      missingFields,
      missingLabels,
    });
  } catch (error) {
    console.error('[BILLING] Request client information error:', error.message);
    return sendBillingError(res, error);
  }
});

for (const type of ['devis', 'facture']) {
  const route = type === 'facture' ? 'factures' : 'devis';
  router.post(`/${route}/:id/pdf`, async (req, res) => {
    try { await servePDF(req, res, type); }
    catch (error) {
      console.error(`[BILLING] PDF ${type} error:`, error.message);
      sendBillingError(res, error);
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
