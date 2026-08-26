const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const documents = require('./server-documents.cjs');
const { applyBrandSignature, assertMailboxMatchesBrand, identityForMailbox } = require('./server-email-branding.cjs');

const router = express.Router();

const MAX_ATTACHMENTS = 8;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_SINGLE_ATTACHMENT_BYTES = documents.MAX_FILE_BYTES || 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'
]);

const MAILBOXES = {
  jsinnovia: {
    label: 'JS-Innov.IA',
    brand: 'js-innov-ia',
    email: process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com',
    smtpUser: process.env.EMAIL_JSINNOVIA_SMTP_USER || process.env.EMAIL_STORE_ADDRESS || process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com',
    password: process.env.EMAIL_PASSWORD_JSINNOVIA || process.env.EMAIL_JSINNOVIA_PASSWORD || process.env.EMAIL_PASSWORD || process.env.EMAIL_PASSWORD_STORE || process.env.EMAIL_STORE_PASSWORD || '',
    host: process.env.SMTP_HOST_JSINNOVIA || 'smtp.ionos.fr',
    port: Number(process.env.SMTP_PORT_JSINNOVIA || 465),
  },
  assurances: {
    label: 'Assurances-Dour.be',
    brand: 'assurances-dour',
    email: process.env.EMAIL_ASSURANCES_ADDRESS || 'info@assurances-dour.be',
    password: process.env.EMAIL_PASSWORD_ASSURANCES || process.env.EMAIL_ASSURANCES_PASSWORD || '',
    host: process.env.SMTP_HOST_ASSURANCES || 'smtp.ionos.fr',
    port: Number(process.env.SMTP_PORT_ASSURANCES || 465),
  },
  store: {
    label: 'JS-Innov.IA',
    brand: 'js-innov-ia',
    email: process.env.EMAIL_STORE_ADDRESS || 'info@jsinnovia.store',
    password: process.env.EMAIL_PASSWORD_STORE || process.env.EMAIL_STORE_PASSWORD || '',
    host: process.env.SMTP_HOST_STORE || 'smtp.ionos.fr',
    port: Number(process.env.SMTP_PORT_STORE || 465),
  },
};

const transports = new Map();

function getMailbox(mailboxKey) {
  const mailbox = MAILBOXES[mailboxKey];
  if (!mailbox) throw new Error('Boîte email non autorisée');
  if (!mailbox.password) throw new Error(`Mot de passe SMTP manquant pour ${mailboxKey}`);
  return mailbox;
}

function getTransport(mailboxKey) {
  if (transports.has(mailboxKey)) return transports.get(mailboxKey);
  const mailbox = getMailbox(mailboxKey);
  const transport = nodemailer.createTransport({
    host: mailbox.host,
    port: mailbox.port,
    secure: mailbox.port === 465,
    auth: { user: mailbox.smtpUser || mailbox.email, pass: mailbox.password },
    tls: { rejectUnauthorized: process.env.SMTP_ALLOW_INVALID_CERT !== 'true' },
  });
  transports.set(mailboxKey, transport);
  return transport;
}

function validEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validateRecipientList(value, field) {
  if (!value) return undefined;
  const list = Array.isArray(value)
    ? value
    : String(value).split(',').map(v => v.trim()).filter(Boolean);
  if (list.length > 20) throw new Error(`${field}: maximum 20 adresses`);
  for (const address of list) {
    if (!validEmail(address)) throw new Error(`${field}: adresse invalide`);
  }
  return list.join(', ');
}

function decodeAttachment(item) {
  if (!item || typeof item !== 'object') throw new Error('Pièce jointe invalide');
  const filename = path.basename(String(item.filename || '')).slice(0, 180);
  const ext = path.extname(filename).toLowerCase();
  if (!filename || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Type de pièce jointe non autorisé (${ext || 'sans extension'})`);
  }
  const raw = String(item.base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!raw) throw new Error(`Contenu manquant pour ${filename}`);
  const content = Buffer.from(raw, 'base64');
  if (!content.length) throw new Error(`Fichier vide : ${filename}`);
  if (content.length > MAX_SINGLE_ATTACHMENT_BYTES) {
    throw new Error(`${filename} dépasse la limite de 10 Mo`);
  }
  return {
    filename,
    content,
    contentType: String(item.contentType || 'application/octet-stream').slice(0, 160),
  };
}

async function prepareAttachments(req) {
  const localItems = Array.isArray(req.body.attachments) ? req.body.attachments : [];
  const documentIds = Array.isArray(req.body.documentIds) ? req.body.documentIds : [];
  if (localItems.length + documentIds.length > MAX_ATTACHMENTS) {
    throw new Error(`Maximum ${MAX_ATTACHMENTS} pièces jointes par email`);
  }

  const prepared = [];
  const archivedDocuments = [];
  let totalBytes = 0;

  for (const item of localItems) {
    const decoded = decodeAttachment(item);
    totalBytes += decoded.content.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Pièces jointes trop volumineuses (20 Mo maximum au total)');

    if (req.body.archiveAttachments === true) {
      const record = await documents.storeBuffer({
        user: req.user,
        organisation: req.body.organisation,
        brand: req.body.brand || (req.body.mailbox === 'assurances' ? 'assurances-dour' : 'js-innov-ia'),
        clientId: req.body.clientId,
        category: req.body.category || 'emails',
        filename: decoded.filename,
        mimeType: decoded.contentType,
        buffer: decoded.content,
        source: 'email-outgoing-attachment',
        emailMessageId: req.body.replyToMessageId || null,
      });
      if (record) archivedDocuments.push({ id: record.id, filename: record.filename });
    }

    prepared.push(decoded);
  }

  for (const id of documentIds) {
    const { record, buffer } = await documents.getDocumentBufferForUser(req.user, id);
    totalBytes += buffer.length;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Pièces jointes trop volumineuses (20 Mo maximum au total)');
    prepared.push({
      filename: record.filename,
      content: buffer,
      contentType: record.mime_type || 'application/octet-stream',
    });
  }

  return { prepared, archivedDocuments, totalBytes };
}

router.get('/status', (req, res) => {
  res.json({
    success: true,
    mailboxes: Object.entries(MAILBOXES).map(([id, cfg]) => ({ id, email: cfg.email, configured: Boolean(cfg.password) })),
    maxAttachments: MAX_ATTACHMENTS,
    maxTotalAttachmentBytes: MAX_TOTAL_ATTACHMENT_BYTES,
    dropboxConfigured: documents.isDropboxConfigured(),
  });
});

router.post('/send', async (req, res) => {
  try {
    const body = req.body || {};
    const mailboxKey = body.mailbox || 'jsinnovia';
    const mailbox = getMailbox(mailboxKey);
    const brand = body.brand || mailbox.brand;
    assertMailboxMatchesBrand(mailboxKey, brand);

    const to = validateRecipientList(body.to, 'to');
    const cc = validateRecipientList(body.cc, 'cc');
    const bcc = validateRecipientList(body.bcc, 'bcc');
    if (!to) return res.status(400).json({ success: false, error: 'Destinataire requis' });

    const subject = String(body.subject || '').trim();
    const text = typeof body.text === 'string' ? body.text : '';
    const html = typeof body.html === 'string' ? body.html : undefined;
    if (!subject || subject.length > 240) return res.status(400).json({ success: false, error: 'Objet requis (240 caractères maximum)' });
    if (!text.trim() && !(html || '').trim()) return res.status(400).json({ success: false, error: 'Message requis' });

    const { prepared, archivedDocuments, totalBytes } = await prepareAttachments(req);
    const transport = getTransport(mailboxKey);
    const signed = applyBrandSignature({ text, html, brand });
    const identity = identityForMailbox(mailboxKey);
    const replyToMessageId = body.replyToMessageId ? String(body.replyToMessageId).slice(0, 500) : undefined;

    const info = await transport.sendMail({
      from: `"${identity.name}" <${mailbox.email}>`,
      replyTo: identity.replyTo,
      to,
      cc,
      bcc,
      subject,
      text: signed.text || undefined,
      html: signed.html,
      attachments: prepared.length ? prepared : undefined,
      inReplyTo: replyToMessageId,
      references: replyToMessageId,
    });

    console.log('[EMAIL COMPOSE]', {
      mailbox: mailboxKey,
      recipientCount: String(to).split(',').length,
      attachmentCount: prepared.length,
      attachmentBytes: totalBytes,
      archivedCount: archivedDocuments.length,
      messageId: info.messageId,
      actor: req.user?.email || req.user?.id,
    });

    res.json({
      success: true,
      messageId: info.messageId,
      status: 'sent',
      attachmentCount: prepared.length,
      archivedDocuments,
    });
  } catch (error) {
    console.error('[EMAIL COMPOSE ERROR]', { message: error.message, actor: req.user?.email || req.user?.id });
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
