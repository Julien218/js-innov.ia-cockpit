/**
 * Email IMAP+SMTP Proxy — JS-Innov.IA Cockpit
 * Route Express multi-mailboxes IONOS (lecture + envoi)
 *
 * Mailboxes supportées :
 *   - jsinnovia/store → info@jsinnovia.store (EMAIL_PASSWORD_STORE)
 *   - assurances     → info@assurances-dour.be (EMAIL_PASSWORD_ASSURANCES)
 */
const Imap = require('imap');
const { findTrashMailbox } = require('./server-email-trash-core.cjs');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const express = require('express');
const { applyBrandSignature, identityForMailbox } = require('./server-email-branding.cjs');
const router = express.Router();

const STORE_EMAIL = process.env.EMAIL_STORE_ADDRESS || 'info@jsinnovia.store';

// ── Configuration multi-mailboxes ────────────────────────────
const MAILBOXES = {
  jsinnovia: {
    label: 'JS-Innov.IA',
    isAlias: true,
    brand: 'js-innov-ia',
    email: STORE_EMAIL,
    smtpUser: STORE_EMAIL,
    password: process.env.EMAIL_PASSWORD_STORE || process.env.EMAIL_STORE_PASSWORD || process.env.EMAIL_PASSWORD || '',
    host: 'imap.ionos.fr',
    port: 993,
    tls: true,
    smtpHost: 'smtp.ionos.fr',
    smtpPort: 465,
    color: '#D4AF37',
  },
  assurances: {
    label: 'Assurances Dour',
    brand: 'assurances-dour',
    email: process.env.EMAIL_ASSURANCES_ADDRESS || 'info@assurances-dour.be',
    password: process.env.EMAIL_PASSWORD_ASSURANCES || process.env.EMAIL_ASSURANCES_PASSWORD || '',
    host: 'imap.ionos.fr',
    port: 993,
    tls: true,
    smtpHost: 'smtp.ionos.fr',
    smtpPort: 465,
    color: '#06B6D4',
  },
  store: {
    label: 'JS-Innov.IA Store',
    brand: 'js-innov-ia',
    email: STORE_EMAIL,
    smtpUser: STORE_EMAIL,
    password: process.env.EMAIL_PASSWORD_STORE || process.env.EMAIL_STORE_PASSWORD || '',
    host: 'imap.ionos.fr',
    port: 993,
    tls: true,
    smtpHost: 'smtp.ionos.fr',
    smtpPort: 465,
    color: '#7C3AED',
  },
};

function getMailboxConfig(mailbox) {
  const cfg = MAILBOXES[mailbox || 'assurances'];
  if (!cfg) return null;
  return cfg;
}

function isAliasMailbox(mailboxKey) {
  const cfg = MAILBOXES[mailboxKey];
  return cfg && cfg.isAlias === true;
}

function requireApiKey(req, res, next) {
  if (req.user) return next();
  const key = req.headers['x-agent-key'] || req.headers['x-api-key'] || req.query.key;
  console.log('[EMAIL AUTH]', {
    hasReceivedKey: Boolean(key),
    hasServerKey: Boolean(process.env.AGENT_API_KEY),
    headerUsed: req.headers['x-agent-key'] ? 'x-agent-key' : (req.headers['x-api-key'] ? 'x-api-key' : 'query'),
  });
  if (!key || key !== process.env.AGENT_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

const smtpCache = {};
function getSmtpTransport(mailboxKey) {
  const cfg = getMailboxConfig(mailboxKey);
  if (!cfg || !cfg.password) return null;
  if (smtpCache[mailboxKey]) return smtpCache[mailboxKey];
  const transport = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    auth: { user: cfg.smtpUser || cfg.email, pass: cfg.password },
    tls: { rejectUnauthorized: false },
  });
  smtpCache[mailboxKey] = transport;
  return transport;
}

router.get('/mailboxes/list', requireApiKey, (req, res) => {
  const list = Object.entries(MAILBOXES).map(([key, cfg]) => ({ id: key, label: cfg.label, email: cfg.email, configured: !!cfg.password }));
  res.json({ success: true, mailboxes: list });
});

function fetchEmails(mailboxKey, { folder = 'INBOX', limit = 30, offset = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (isAliasMailbox(mailboxKey)) return reject(new Error('Utilisez la boîte JS-Innov.IA Store.'));
    const cfg = getMailboxConfig(mailboxKey);
    if (!cfg) return reject(new Error(`Mailbox "${mailboxKey}" non configurée ou introuvable`));
    if (!cfg.password) return reject(new Error(`Mot de passe non configuré pour "${mailboxKey}".`));
    const imap = new Imap({ user: cfg.email, password: cfg.password, host: cfg.host, port: cfg.port, tls: true, tlsOptions: { servername: cfg.host, rejectUnauthorized: false } });
    const emails = [];
    imap.once('ready', () => {
      imap.openBox(folder, true, (err, box) => {
        if (err) { imap.end(); return reject(err); }
        const total = box.messages.total;
        if (total === 0) { imap.end(); return resolve({ emails: [], total: 0, unread: 0 }); }
        imap.search(['UNSEEN'], (e2, unseenUids) => {
          const unreadCount = e2 ? 0 : (unseenUids || []).length;
          const start = Math.max(1, total - offset - limit + 1);
          const end = Math.max(1, total - offset);
          const f = imap.seq.fetch(`${start}:${end}`, { bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'], struct: true });
          f.on('message', (msg) => {
            const email = { rawHeaders: '', rawBody: '' };
            msg.on('body', (stream, info) => {
              let buf = '';
              stream.on('data', c => buf += c.toString('utf8'));
              stream.once('end', () => { if (info.which === 'TEXT') email.rawBody = buf; else email.rawHeaders = buf; });
            });
            msg.once('attributes', a => { email.uid = a.uid; email.flags = a.flags || []; email.seen = email.flags.includes('\\Seen'); email.date = a.date; email.struct = a.struct; });
            msg.once('end', () => emails.push(email));
          });
          f.once('error', e => { imap.end(); reject(e); });
          f.once('end', () => {
            imap.end();
            const parsed = emails.map(e => {
              let from = '', subject = '', to = '', date = e.date;
              e.rawHeaders.split(/\r?\n/).forEach(line => {
                if (/^from:/i.test(line)) from = line.replace(/^from:\s*/i, '').trim();
                if (/^subject:/i.test(line)) subject = line.replace(/^subject:\s*/i, '').trim();
                if (/^to:/i.test(line)) to = line.replace(/^to:\s*/i, '').trim();
                if (/^date:/i.test(line)) { const d = line.replace(/^date:\s*/i, '').trim(); if (d) try { date = new Date(d); } catch (_) {} }
              });
              let hasAttachment = false;
              if (e.struct) {
                const checkStruct = (s) => { if (!Array.isArray(s)) return; for (const part of s) { if (part.disposition === 'attachment' || (part.params && part.params.name)) { hasAttachment = true; break; } if (part.childNodes) checkStruct(part.childNodes); } };
                checkStruct(e.struct);
              }
              return { uid: e.uid, from, subject, to, date, seen: e.seen, hasAttachment, body: e.rawBody ? e.rawBody.substring(0, 200).replace(/\s+/g, ' ').trim() : '' };
            }).sort((a, b) => new Date(b.date) - new Date(a.date));
            resolve({ emails: parsed, total, unread: unreadCount });
          });
        });
      });
    });
    imap.once('error', e => reject(e));
    imap.connect();
  });
}

function fetchEmailById(mailboxKey, uid, includeAttachments = false, { markSeen = true } = {}) {
  return new Promise((resolve, reject) => {
    if (isAliasMailbox(mailboxKey)) return reject(new Error('Utilisez la boîte JS-Innov.IA Store.'));
    const cfg = getMailboxConfig(mailboxKey);
    if (!cfg) return reject(new Error(`Mailbox "${mailboxKey}" non configurée`));
    if (!cfg.password) return reject(new Error(`Mot de passe non configuré pour "${mailboxKey}".`));
    const imap = new Imap({ user: cfg.email, password: cfg.password, host: cfg.host, port: cfg.port, tls: true, tlsOptions: { servername: cfg.host, rejectUnauthorized: false } });
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); return reject(err); }
        let rawEmail = '';
        const f = imap.fetch(String(uid), { bodies: '', struct: true, markSeen });
        f.on('message', (msg) => {
          msg.on('body', stream => { stream.on('data', c => rawEmail += c.toString('utf8')); });
          msg.once('attributes', a => { if (markSeen) imap.addFlags(a.uid, '\\Seen', () => {}); });
        });
        f.once('error', e => { imap.end(); reject(e); });
        f.once('end', () => {
          imap.end();
          simpleParser(rawEmail, {}).then(p => resolve({
            uid, from: p.from?.text || '', to: p.to?.text || '', cc: p.cc?.text || '', subject: p.subject || '(sans objet)', date: p.date?.toISOString() || null,
            text: p.text || '', html: p.html || null,
            attachments: (p.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType, size: a.size, ...(includeAttachments && a.content ? { content_base64: a.content.toString('base64') } : {}) })),
            messageId: p.messageId || '', inReplyTo: p.inReplyTo || '', listUnsubscribe: p.headers?.get?.('list-unsubscribe') || null,
          })).catch(reject);
        });
      });
    });
    imap.once('error', e => reject(e));
    imap.connect();
  });
}

async function sendEmail(mailboxKey, { to, subject, text, html, cc, bcc, replyTo, replyToMessageId, attachments }) {
  const cfg = getMailboxConfig(mailboxKey);
  if (!cfg) throw new Error(`Mailbox "${mailboxKey}" non configurée`);
  if (!cfg.password) throw new Error(`Mot de passe SMTP non configuré pour "${mailboxKey}".`);
  if (!to) throw new Error('Destinataire (to) requis');
  const transport = getSmtpTransport(mailboxKey);
  if (!transport) throw new Error(`Transport SMTP non disponible pour "${mailboxKey}".`);
  const signed = applyBrandSignature({ text, html, brand: cfg.brand });
  const identity = identityForMailbox(mailboxKey);
  const parsedAttachments = [];
  if (attachments && Array.isArray(attachments)) {
    for (const a of attachments) if (a.filename && a.content_base64) parsedAttachments.push({ filename: a.filename, content: Buffer.from(a.content_base64, 'base64'), contentType: a.content_type || a.contentType || 'application/octet-stream' });
  }
  const mailOptions = {
    from: `"${identity.name}" <${cfg.smtpUser || cfg.email}>`,
    to, cc: cc || undefined, bcc: bcc || undefined,
    replyTo: replyTo || identity.replyTo,
    subject: subject || '(sans objet)', text: signed.text || '', html: signed.html || undefined,
    inReplyTo: replyToMessageId || undefined,
    headers: replyToMessageId ? { 'References': replyToMessageId } : undefined,
    attachments: parsedAttachments.length > 0 ? parsedAttachments : undefined,
  };
  const info = await transport.sendMail(mailOptions);
  return { messageId: info.messageId, response: info.response, envelope: info.envelope };
}

// The remaining routes and security helpers are loaded from the stable implementation.
// This file intentionally keeps the same public exports used by the Cockpit.
const crypto = require('crypto');
const _idempotencyStore = new Map();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;
const _officialRateLimit = new Map();
const OFFICIAL_RATE_LIMIT_MAX = 10;
const OFFICIAL_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const OFFICIAL_MAX_RECIPIENTS = 20;
const OFFICIAL_MAX_SUBJECT_LEN = 200;
const OFFICIAL_MAX_BODY_BYTES = 500_000;
const OFFICIAL_MAX_METADATA_FIELDS = 5;
const OFFICIAL_MAX_METADATA_VALUE_LEN = 500;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{8,128}$/;
function safeCompareHashes(a, b) { const hashA = crypto.createHash('sha256').update(String(a)).digest(); const hashB = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(hashA, hashB); }
function isValidEmail(addr) { if (typeof addr !== 'string') return false; const match = addr.match(/<([^>]+)>/) || [null, addr.trim()]; const email = match[1]; return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254; }
function requireOfficialApiKey(req, res, next) { if (req.query.key || req.query['x-agent-key']) return res.status(401).json({ error: 'Unauthorized — key must not be in query string' }); const providedKey = req.headers['x-agent-key']; const serverKey = process.env.EMAIL_PROXY_KEY; if (!serverKey) return res.status(503).json({ error: 'Server not configured — EMAIL_PROXY_KEY missing' }); if (!providedKey || !safeCompareHashes(providedKey, serverKey)) return res.status(401).json({ error: 'Unauthorized' }); next(); }
function calculatePayloadFingerprint(body) { const relevant = { to: body.to, subject: body.subject, text: body.text, html: body.html, cc: body.cc, bcc: body.bcc, replyTo: body.replyTo }; return crypto.createHash('sha256').update(JSON.stringify(relevant)).digest('hex'); }
function checkAndReserveIdempotency(key, fingerprint) { const now = Date.now(); for (const [k, v] of _idempotencyStore) if (now - v.timestamp > IDEMPOTENCY_TTL_MS) _idempotencyStore.delete(k); const existing = _idempotencyStore.get(key); if (existing) { if (existing.status === 'pending') return { action: 'reject', status: 409, message: 'Concurrent request with same Idempotency-Key' }; if (existing.fingerprint !== fingerprint) return { action: 'reject', status: 409, message: 'Idempotency-Key already used with different payload' }; return { action: 'replay', response: existing.response }; } _idempotencyStore.set(key, { status: 'pending', fingerprint, timestamp: now }); return { action: 'proceed' }; }
function completeIdempotency(key, response) { const entry = _idempotencyStore.get(key); if (entry) { entry.status = 'completed'; entry.response = response; entry.timestamp = Date.now(); } }
function failIdempotency(key) { _idempotencyStore.delete(key); }
function checkOfficialRate