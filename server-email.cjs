/**
 * Email IMAP+SMTP Proxy — JS-Innov.IA Cockpit
 * Route Express multi-mailboxes IONOS (lecture + envoi)
 *
 * Mailboxes supportées :
 *   - jsinnovia   → info@jsinnovia.com       (EMAIL_PASSWORD)
 *   - assurances  → info@assurances-dour.be (EMAIL_PASSWORD_ASSURANCES)
 *   - store       → info@jsinnovia.store    (EMAIL_PASSWORD_STORE)
 *
 * Routes :
 *   GET  /api/emails?mailbox=jsinnovia&limit=30&offset=0
 *   GET  /api/emails/:uid?mailbox=assurances
 *   GET  /api/emails/mailboxes/list
 *   POST /api/emails/send         → { mailbox, to, subject, text, html, cc, replyToUid }
 */
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const express = require('express');
const { applyBrandSignature, identityForMailbox } = require('./server-email-branding.cjs');
const router = express.Router();

// ── Configuration multi-mailboxes ────────────────────────────
const MAILBOXES = {
  jsinnovia: {
    label: 'JS-Innov.IA',
    isAlias: process.env.EMAIL_JSINNOVIA_ALIAS_ONLY !== 'false',
    brand: 'js-innov-ia',
    email: process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com',
    smtpUser: process.env.EMAIL_JSINNOVIA_SMTP_USER || process.env.EMAIL_STORE_ADDRESS || process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com',
    password: process.env.EMAIL_PASSWORD_JSINNOVIA || process.env.EMAIL_JSINNOVIA_PASSWORD || process.env.EMAIL_PASSWORD || process.env.EMAIL_PASSWORD_STORE || process.env.EMAIL_STORE_PASSWORD || '',
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
    email: process.env.EMAIL_STORE_ADDRESS || 'info@jsinnovia.store',
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
  return cfg;  // retourne même si alias (isAlias=true) ou sans password
}

function isAliasMailbox(mailboxKey) {
  const cfg = MAILBOXES[mailboxKey];
  return cfg && cfg.isAlias === true;
}

function requireApiKey(req, res, next) {
  if (req.user) return next();
  const key = req.headers['x-agent-key'] || req.headers['x-api-key'] || req.query.key;
  // Safe auth logging — never log actual key values
  console.log('[EMAIL AUTH]', {
    hasReceivedKey: Boolean(key),
    hasServerKey: Boolean(process.env.AGENT_API_KEY),
    headerUsed: req.headers['x-agent-key'] ? 'x-agent-key' : (req.headers['x-api-key'] ? 'x-api-key' : 'query'),
  });
  if (!key || key !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Transport SMTP (créé à la demande, mis en cache) ─────────
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

// ── Liste des mailboxes disponibles ──────────────────────────
router.get('/mailboxes/list', requireApiKey, (req, res) => {
  const list = Object.entries(MAILBOXES).map(([key, cfg]) => ({
    id: key,
    label: cfg.label,
    email: cfg.email,
    configured: !!cfg.password,
  }));
  res.json({ success: true, mailboxes: list });
});

// ── Fetch emails (liste) ─────────────────────────────────────
function fetchEmails(mailboxKey, { folder = 'INBOX', limit = 30, offset = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (isAliasMailbox(mailboxKey)) {
      return reject(new Error('Cette adresse est un alias de redirection. Utilisez JS-Innov.IA Store ou Assurances Dour.'));
    }
    const cfg = getMailboxConfig(mailboxKey);
    if (!cfg) return reject(new Error(`Mailbox "${mailboxKey}" non configurée ou introuvable`));
    if (!cfg.password) return reject(new Error(`Mot de passe non configuré pour "${mailboxKey}". Vérifiez la variable EMAIL_PASSWORD sur Railway.`));

    const imap = new Imap({
      user: cfg.email,
      password: cfg.password,
      host: cfg.host,
      port: cfg.port,
      tls: true,
      tlsOptions: { servername: cfg.host, rejectUnauthorized: false },
    });
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

          const f = imap.seq.fetch(`${start}:${end}`, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
            struct: true,
          });

          f.on('message', (msg) => {
            const email = { rawHeaders: '', rawBody: '' };
            msg.on('body', (stream, info) => {
              let buf = '';
              stream.on('data', c => buf += c.toString('utf8'));
              stream.once('end', () => {
                if (info.which === 'TEXT') email.rawBody = buf;
                else email.rawHeaders = buf;
              });
            });
            msg.once('attributes', a => {
              email.uid = a.uid;
              email.flags = a.flags || [];
              email.seen = email.flags.includes('\\Seen');
              email.date = a.date;
              email.struct = a.struct;
            });
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
                if (/^date:/i.test(line)) {
                  const d = line.replace(/^date:\s*/i, '').trim();
                  if (d) try { date = new Date(d); } catch(_) {}
                }
              });
              let hasAttachment = false;
              if (e.struct) {
                const checkStruct = (s) => {
                  if (!Array.isArray(s)) return;
                  for (const part of s) {
                    if (part.disposition === 'attachment' ||
                        (part.params && part.params.name)) {
                      hasAttachment = true;
                      break;
                    }
                    if (part.childNodes) checkStruct(part.childNodes);
                  }
                };
                checkStruct(e.struct);
              }
              return {
                uid: e.uid,
                from, subject, to, date,
                seen: e.seen,
                hasAttachment,
                body: e.rawBody ? e.rawBody.substring(0, 200).replace(/\s+/g, ' ').trim() : '',
              };
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

// ── Fetch email par UID ──────────────────────────────────────
function fetchEmailById(mailboxKey, uid, includeAttachments = false, { markSeen = true } = {}) {
  return new Promise((resolve, reject) => {
    if (isAliasMailbox(mailboxKey)) {
      return reject(new Error('Cette adresse est un alias de redirection, pas une boîte IMAP.'));
    }
    const cfg = getMailboxConfig(mailboxKey);
    if (!cfg) return reject(new Error(`Mailbox "${mailboxKey}" non configurée`));
    if (!cfg.password) return reject(new Error(`Mot de passe non configuré pour "${mailboxKey}".`));

    const imap = new Imap({
      user: cfg.email,
      password: cfg.password,
      host: cfg.host,
      port: cfg.port,
      tls: true,
      tlsOptions: { servername: cfg.host, rejectUnauthorized: false },
    });
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); return reject(err); }
        let rawEmail = '';
        const f = imap.fetch(String(uid), { bodies: '', struct: true, markSeen });
        f.on('message', (msg) => {
          msg.on('body', stream => {
            stream.on('data', c => rawEmail += c.toString('utf8'));
          });
          msg.once('attributes', a => {
            if (markSeen) imap.addFlags(a.uid, '\\Seen', () => {});
          });
        });
        f.once('error', e => { imap.end(); reject(e); });
        f.once('end', () => {
          imap.end();
          simpleParser(rawEmail, {})
            .then(p => resolve({
              uid,
              from: p.from?.text || '',
              to: p.to?.text || '',
              cc: p.cc?.text || '',
              subject: p.subject || '(sans objet)',
              date: p.date?.toISOString() || null,
              text: p.text || '',
              html: p.html || null,
              attachments: (p.attachments || []).map(a => ({
                filename: a.filename,
                contentType: a.contentType,
                size: a.size,
                ...(includeAttachments && a.content ? {
                  content_base64: a.content.toString('base64'),
                } : {}),
              })),
              messageId: p.messageId || '',
              inReplyTo: p.inReplyTo || '',
            }))
            .catch(reject);
        });
      });
    });
    imap.once('error', e => reject(e));
    imap.connect();
  });
}

// ── Envoyer un email (SMTP) ──────────────────────────────────
async function sendEmail(mailboxKey, { to, subject, text, html, cc, bcc, replyTo, replyToMessageId, attachments }) {
  const cfg = getMailboxConfig(mailboxKey);
  if (!cfg) throw new Error(`Mailbox "${mailboxKey}" non configurée`);
  if (!cfg.password) throw new Error(`Mot de passe SMTP non configuré pour "${mailboxKey}". Vérifiez la variable EMAIL_PASSWORD sur Railway.`);
  if (!to) throw new Error('Destinataire (to) requis');

  const transport = getSmtpTransport(mailboxKey);
  if (!transport) throw new Error(`Transport SMTP non disponible pour "${mailboxKey}".`);
  const signed = applyBrandSignature({ text, html, brand: cfg.brand });
  const identity = identityForMailbox(mailboxKey);

  // ── Pièces jointes (format base64) ──
  const parsedAttachments = [];
  if (attachments && Array.isArray(attachments)) {
    for (const a of attachments) {
      if (a.filename && a.content_base64) {
        parsedAttachments.push({
          filename: a.filename,
          content: Buffer.from(a.content_base64, 'base64'),
          contentType: a.content_type || a.contentType || 'application/octet-stream',
        });
      }
    }
  }

  const mailOptions = {
    from: `"${identity.name}" <${cfg.email}>`,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    replyTo: replyTo || identity.replyTo,
    subject: subject || '(sans objet)',
    text: signed.text || '',
    html: signed.html || undefined,
    inReplyTo: replyToMessageId || undefined,
    headers: replyToMessageId ? { 'References': replyToMessageId } : undefined,
    attachments: parsedAttachments.length > 0 ? parsedAttachments : undefined,
  };

  const info = await transport.sendMail(mailOptions);
  return { messageId: info.messageId, response: info.response, envelope: info.envelope };
}

// ── Routes ──────────────────────────────────────────────────
router.get('/', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'assurances';
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const offset = parseInt(req.query.offset) || 0;
    const result = await fetchEmails(mailbox, { limit, offset });
    res.json({ success: true, mailbox, ...result });
  } catch (err) {
    console.error('[IMAP] Liste:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/emails/official ──────────────────────────────
// Envoi d'emails officiels exclusivement sous l'identité JS-Innov.IA.
// Authentification stricte: x-agent-key header uniquement (jamais query string)
// Idempotence via header Idempotency-Key (OBLIGATOIRE pour cette route)
// Rate limit dédié: 10 req/min par empreinte de clé d'API
//
// ⚠️ Idempotence locale non durable — remplacement par stockage DB/Redis
//    obligatoire avant production multi-instance.
const crypto = require('crypto');

// In-memory idempotency store (Map with 1h TTL)
const _idempotencyStore = new Map();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;

// In-memory rate limit: 10 requests per minute per key hash
const _officialRateLimit = new Map();
const OFFICIAL_RATE_LIMIT_MAX = 10;
const OFFICIAL_RATE_LIMIT_WINDOW_MS = 60 * 1000;

// Limites du payload
const OFFICIAL_MAX_RECIPIENTS = 20;
const OFFICIAL_MAX_SUBJECT_LEN = 200;
const OFFICIAL_MAX_BODY_BYTES = 500_000;
const OFFICIAL_MAX_METADATA_FIELDS = 5;
const OFFICIAL_MAX_METADATA_VALUE_LEN = 500;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Comparaison constante de hashes SHA-256 (longueur identique garantie).
 */
function safeCompareHashes(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Validation d'adresse email.
 */
function isValidEmail(addr) {
  if (typeof addr !== 'string') return false;
  const match = addr.match(/<([^>]+)>/) || [null, addr.trim()];
  const email = match[1];
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/**
 * Authentification stricte pour la route official.
 * - Header x-agent-key uniquement (jamais query string)
 * - Comparaison de hashes SHA-256 avec timingSafeEqual
 * - 503 si EMAIL_PROXY_KEY serveur absente
 * - 401 si clé cliente absente ou incorrecte
 * - Ne logge jamais la clé
 */
function requireOfficialApiKey(req, res, next) {
  if (req.query.key || req.query['x-agent-key']) {
    return res.status(401).json({ error: 'Unauthorized — key must not be in query string' });
  }

  const providedKey = req.headers['x-agent-key'];
  const serverKey = process.env.EMAIL_PROXY_KEY;

  if (!serverKey) {
    return res.status(503).json({ error: 'Server not configured — EMAIL_PROXY_KEY missing' });
  }

  if (!providedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!safeCompareHashes(providedKey, serverKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

/**
 * Empreinte SHA-256 du payload normalisé.
 */
function calculatePayloadFingerprint(body) {
  const relevant = {
    to: body.to,
    subject: body.subject,
    text: body.text,
    html: body.html,
    cc: body.cc,
    bcc: body.bcc,
    replyTo: body.replyTo,
  };
  return crypto.createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

/**
 * Vérifier et réserver une clé d'idempotence.
 * - replay: même clé, même fingerprint → retourner la réponse cachée
 * - reject: conflit (fingerprint différent ou pending) → 409
 * - proceed: nouveau → réserver comme "pending" AVANT l'envoi
 */
function checkAndReserveIdempotency(key, fingerprint) {
  const now = Date.now();
  for (const [k, v] of _idempotencyStore) {
    if (now - v.timestamp > IDEMPOTENCY_TTL_MS) _idempotencyStore.delete(k);
  }

  const existing = _idempotencyStore.get(key);
  if (existing) {
    if (existing.status === 'pending') {
      return { action: 'reject', status: 409, message: 'Concurrent request with same Idempotency-Key' };
    }
    if (existing.fingerprint !== fingerprint) {
      return { action: 'reject', status: 409, message: 'Idempotency-Key already used with different payload' };
    }
    return { action: 'replay', response: existing.response };
  }

  // Réserver AVANT l'envoi pour empêcher les doubles appels concurrents
  _idempotencyStore.set(key, { status: 'pending', fingerprint, timestamp: now });
  return { action: 'proceed' };
}

function completeIdempotency(key, response) {
  const entry = _idempotencyStore.get(key);
  if (entry) {
    entry.status = 'completed';
    entry.response = response;
    entry.timestamp = Date.now();
  }
}

function failIdempotency(key) {
  _idempotencyStore.delete(key);
}

/**
 * Rate limit: 10 req/min par empreinte SHA-256 de la clé.
 */
function checkOfficialRateLimit(providedKey) {
  const keyHash = crypto.createHash('sha256').update(String(providedKey)).digest('hex');
  const now = Date.now();
  for (const [k, v] of _officialRateLimit) {
    if (now - v.windowStart > OFFICIAL_RATE_LIMIT_WINDOW_MS) _officialRateLimit.delete(k);
  }
  let entry = _officialRateLimit.get(keyHash);
  if (!entry || now - entry.windowStart > OFFICIAL_RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    _officialRateLimit.set(keyHash, entry);
  }
  entry.count++;
  return entry.count <= OFFICIAL_RATE_LIMIT_MAX;
}

/**
 * Valider et limiter le champ metadata.
 */
function validateMetadata(metadata) {
  if (metadata === undefined || metadata === null) return null;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { error: 'metadata must be an object' };
  }
  const keys = Object.keys(metadata);
  if (keys.length > OFFICIAL_MAX_METADATA_FIELDS) {
    return { error: `metadata must not exceed ${OFFICIAL_MAX_METADATA_FIELDS} fields` };
  }
  for (const k of keys) {
    if (typeof metadata[k] !== 'string' || metadata[k].length > OFFICIAL_MAX_METADATA_VALUE_LEN) {
      return { error: `metadata.${k} must be a string of max ${OFFICIAL_MAX_METADATA_VALUE_LEN} characters` };
    }
  }
  return null;
}

router.post('/official', requireOfficialApiKey, async (req, res) => {
  // ── 0. Valider req.body avant tout accès ──
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body must be a non-null JSON object' });
  }

  // ── 1. Idempotency-Key obligatoire ──
  const idemKey = req.headers['idempotency-key'];
  if (!idemKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required for this route' });
  }
  if (!IDEMPOTENCY_KEY_REGEX.test(idemKey)) {
    return res.status(400).json({ error: 'Idempotency-Key must be 8-128 alphanumeric characters, hyphens, or underscores' });
  }

  // ── 2. Rejeter from et mailbox du client (par présence, pas par valeur) ──
  if (Object.prototype.hasOwnProperty.call(req.body, 'from') ||
      Object.prototype.hasOwnProperty.call(req.body, 'mailbox')) {
    return res.status(400).json({
      error: 'Fields "from" and "mailbox" are not accepted — sender is fixed to JS-Innov.IA'
    });
  }

  // ── 3. Valider le payload ──
  const { to, subject, text, html, cc, bcc, replyTo, metadata } = req.body;

  // to requis, au moins une adresse
  if (!to) {
    return res.status(400).json({ error: 'Field "to" is required (string or array of emails)' });
  }
  const toList = Array.isArray(to) ? to : [to];
  if (toList.length === 0) {
    return res.status(400).json({ error: 'Field "to" must contain at least one address' });
  }

  // subject requis, string, trim non vide
  if (!subject || typeof subject !== 'string') {
    return res.status(400).json({ error: 'Field "subject" is required and must be a string' });
  }
  if (subject.trim().length === 0) {
    return res.status(400).json({ error: 'Field "subject" must not be empty' });
  }
  if (Buffer.byteLength(subject, 'utf8') > OFFICIAL_MAX_SUBJECT_LEN) {
    return res.status(400).json({ error: `Subject exceeds ${OFFICIAL_MAX_SUBJECT_LEN} bytes` });
  }

  // text et html doivent être des strings
  if (text !== undefined && typeof text !== 'string') {
    return res.status(400).json({ error: 'Field "text" must be a string' });
  }
  if (html !== undefined && typeof html !== 'string') {
    return res.status(400).json({ error: 'Field "html" must be a string' });
  }

  // Au moins text ou html requis, trim non vide
  const textTrimmed = text ? text.trim() : '';
  const htmlTrimmed = html ? html.trim() : '';
  if (!textTrimmed && !htmlTrimmed) {
    return res.status(400).json({ error: 'At least "text" or "html" is required (non-empty)' });
  }

  // Taille du contenu (Buffer.byteLength)
  if (text && Buffer.byteLength(text, 'utf8') > OFFICIAL_MAX_BODY_BYTES) {
    return res.status(400).json({ error: 'Text body exceeds size limit' });
  }
  if (html && Buffer.byteLength(html, 'utf8') > OFFICIAL_MAX_BODY_BYTES) {
    return res.status(400).json({ error: 'HTML body exceeds size limit' });
  }

  // Valider replyTo si fourni
  if (replyTo !== undefined) {
    if (typeof replyTo !== 'string' || !isValidEmail(replyTo)) {
      return res.status(400).json({ error: 'Field "replyTo" must be a valid email address' });
    }
  }

  // Valider metadata
  const metadataError = validateMetadata(metadata);
  if (metadataError) {
    return res.status(400).json({ error: metadataError.error });
  }

  // Normaliser cc et bcc
  const ccList = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
  const bccList = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [];

  // Valider les formats d'adresses
  for (const addr of toList) {
    if (!isValidEmail(addr)) return res.status(400).json({ error: `Invalid "to" address` });
  }
  for (const addr of ccList) {
    if (!isValidEmail(addr)) return res.status(400).json({ error: `Invalid "cc" address` });
  }
  for (const addr of bccList) {
    if (!isValidEmail(addr)) return res.status(400).json({ error: `Invalid "bcc" address` });
  }

  // Limiter le nombre total de destinataires
  const totalRecipients = toList.length + ccList.length + bccList.length;
  if (totalRecipients > OFFICIAL_MAX_RECIPIENTS) {
    return res.status(400).json({ error: `Too many recipients: ${totalRecipients} (max ${OFFICIAL_MAX_RECIPIENTS})` });
  }

  // ── 4. Idempotence: vérifier et réserver ──
  const fingerprint = calculatePayloadFingerprint(req.body);
  const idemResult = checkAndReserveIdempotency(idemKey, fingerprint);

  if (idemResult.action === 'replay') {
    return res.status(200).json(idemResult.response);
  }
  if (idemResult.action === 'reject') {
    return res.status(idemResult.status).json({ error: idemResult.message });
  }

  // ── 5. Rate limit (uniquement pour les nouveaux envois) ──
  if (!checkOfficialRateLimit(req.headers['x-agent-key'])) {
    failIdempotency(idemKey);
    return res.status(429).json({ error: 'Rate limit exceeded — maximum 10 requests per minute' });
  }

  // ── 6. Envoyer via sendEmail() existant — identité fixée à JS-Innov.IA ──
  try {
    const info = await sendEmail('jsinnovia', {
      to: toList.join(', '),
      subject,
      text: text || undefined,
      html: html || undefined,
      cc: ccList.length > 0 ? ccList.join(', ') : undefined,
      bcc: bccList.length > 0 ? bccList.join(', ') : undefined,
      replyTo: replyTo || undefined,
    });

    const response = {
      success: true,
      messageId: info.messageId,
      status: 'sent',
    };

    completeIdempotency(idemKey, response);

    // Log minimal — pas de secret, pas de corps, metadata validée
    console.log('[OFFICIAL EMAIL]', {
      recipients: totalRecipients,
      subjectBytes: Buffer.byteLength(subject, 'utf8'),
      hasText: !!textTrimmed,
      hasHtml: !!htmlTrimmed,
      hasReplyTo: !!replyTo,
      metadataSource: metadata && typeof metadata.source === 'string' ? metadata.source : undefined,
      messageId: info.messageId,
    });

    return res.status(200).json(response);
  } catch (err) {
    // Erreur SMTP → 502, pas 500 générique
    failIdempotency(idemKey);
    console.error('[OFFICIAL EMAIL SMTP ERROR]', {
      message: err.message,
      code: err.code,
    });
    return res.status(502).json({
      success: false,
      error: 'SMTP delivery failed',
      messageId: null,
      status: 'failed',
    });
  }
});

router.get('/:uid', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'assurances';
    const uid = parseInt(req.params.uid);
    if (!uid) return res.status(400).json({ error: 'UID invalide' });
    const email = await fetchEmailById(mailbox, uid);
    res.json({ success: true, mailbox, email });
  } catch (err) {
    console.error('[IMAP] Lecture:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/emails/send
router.post('/send', requireApiKey, async (req, res) => {
  try {
    const { mailbox, to, subject, text, html, cc, bcc, replyToUid, attachments } = req.body;
    const mailboxKey = mailbox || 'jsinnovia';

    // Si replyToUid est fourni, récupérer le messageId original pour le threading
    let replyToMessageId = null;
    if (replyToUid) {
      try {
        const original = await fetchEmailById(mailboxKey, parseInt(replyToUid));
        replyToMessageId = original.messageId || null;
      } catch (_) { /* non bloquant */ }
    }

    const info = await sendEmail(mailboxKey, { to, subject, text, html, cc, bcc, replyToMessageId, attachments });
    res.json({ success: true, ...info });
  } catch (err) {
    console.error('[SMTP] Envoi:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── Emails envoyés (dossier Sent) ────────────────────────────
async function fetchSentEmails(mailboxKey, limit = 30) {
  return new Promise((resolve, reject) => {
    if (isAliasMailbox(mailboxKey)) {
      return reject(new Error('Cette adresse est un alias de redirection.'));
    }
    const cfg = getMailboxConfig(mailboxKey);
    if (!cfg || !cfg.password) return reject(new Error(`Mailbox "${mailboxKey}" non configurée`));

    const imap = new Imap({
      user: cfg.email, password: cfg.password,
      host: cfg.host, port: cfg.port,
      tls: true, tlsOptions: { servername: cfg.host, rejectUnauthorized: false },
    });

    imap.once('ready', () => {
      // Lister les dossiers pour trouver le bon dossier envoyé
      imap.getBoxes((err, boxes) => {
        if (err) { imap.end(); return reject(err); }

        // Noms possibles pour le dossier envoyé
        const sentCandidates = ['Sent', 'Sent Items', '\u00C9l\u00E9ments envoy\u00E9s', 'INBOX.Sent', 'INBOX.Sent Items', 'Envoy\u00E9s'];
        const boxNames = Object.keys(boxes);
        let sentFolder = null;

        // Chercher le dossier envoyé parmi les candidats
        for (const candidate of sentCandidates) {
          if (boxNames.includes(candidate)) { sentFolder = candidate; break; }
        }
        // Fallback: chercher un dossier contenant "sent" ou "envoy"
        if (!sentFolder) {
          sentFolder = boxNames.find(n => /sent|envoy/i.test(n)) || null;
        }

        if (!sentFolder) {
          imap.end();
          return resolve({ emails: [], total: 0, sentFolder: null, message: 'Aucun dossier envoy\u00E9 trouv\u00E9.' });
        }

        imap.openBox(sentFolder, true, (err2, box) => {
          if (err2) { imap.end(); return reject(err2); }
          const total = box.messages.total;
          if (total === 0) { imap.end(); return resolve({ emails: [], total: 0, sentFolder }); }

          const start = Math.max(1, total - limit + 1);
          const end = total;
          const emails = [];

          const f = imap.seq.fetch(`${start}:${end}`, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
            struct: true,
          });

          f.on('message', (msg) => {
            const email = { rawHeaders: '', rawBody: '' };
            msg.on('body', (stream, info) => {
              let buf = '';
              stream.on('data', c => buf += c.toString('utf8'));
              stream.once('end', () => {
                if (info.which === 'TEXT') email.rawBody = buf;
                else email.rawHeaders = buf;
              });
            });
            msg.once('attributes', a => {
              email.uid = a.uid;
              email.flags = a.flags || [];
              email.seen = true;
              email.date = a.date;
            });
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
                if (/^date:/i.test(line)) {
                  const d = line.replace(/^date:\s*/i, '').trim();
                  if (d) try { date = new Date(d); } catch(_) {}
                }
              });
              const preview = e.rawBody ? e.rawBody.substring(0, 200).replace(/\r?\n/g, ' ').trim() : '';
              return { uid: e.uid, from, to, subject: subject || '(sans objet)', date: date instanceof Date ? date.toISOString() : date, preview, seen: true };
            });
            resolve({ emails: parsed.reverse(), total, sentFolder });
          });
        });
      });
    });

    imap.once('error', e => reject(e));
    imap.once('end', () => {});
    imap.connect();
  });
}


// ── Supprimer un email (déplacer vers Trash) ─────────────────
router.delete('/:uid', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'assurances';
    const uid = parseInt(req.params.uid);
    if (isAliasMailbox(mailbox)) return res.status(400).json({ success: false, error: 'Boîte alias, opération non disponible.' });
    const cfg = getMailboxConfig(mailbox);
    if (!cfg || !cfg.password) return res.status(400).json({ success: false, error: `Mailbox "${mailbox}" non configurée.` });

    await new Promise((resolve, reject) => {
      const imap = new Imap({ user: cfg.email, password: cfg.password, host: cfg.host, port: cfg.port, tls: true, tlsOptions: { servername: cfg.host, rejectUnauthorized: false } });
      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) { imap.end(); return reject(err); }
          // Marquer comme supprimé + expurger
          imap.addFlags(uid, ['\Deleted'], (e2) => {
            if (e2) { imap.end(); return reject(e2); }
            imap.expunge((e3) => { imap.end(); e3 ? reject(e3) : resolve(); });
          });
        });
      });
      imap.once('error', reject);
      imap.connect();
    });
    res.json({ success: true, message: 'Email supprimé.' });
  } catch (err) {
    console.error('[IMAP] Delete:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Archiver un email (marquer comme lu + flag \Flagged) ─────
router.post('/:uid/archive', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'assurances';
    const uid = parseInt(req.params.uid);
    if (isAliasMailbox(mailbox)) return res.status(400).json({ success: false, error: 'Boîte alias, opération non disponible.' });
    const cfg = getMailboxConfig(mailbox);
    if (!cfg || !cfg.password) return res.status(400).json({ success: false, error: `Mailbox "${mailbox}" non configurée.` });

    await new Promise((resolve, reject) => {
      const imap = new Imap({ user: cfg.email, password: cfg.password, host: cfg.host, port: cfg.port, tls: true, tlsOptions: { servername: cfg.host, rejectUnauthorized: false } });
      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) { imap.end(); return reject(err); }
          // Marquer comme lu + archivé (\Seen + \Flagged)
          imap.addFlags(uid, ['\Seen', '\Flagged'], (e2) => { imap.end(); e2 ? reject(e2) : resolve(); });
        });
      });
      imap.once('error', reject);
      imap.connect();
    });
    res.json({ success: true, message: 'Email archivé.' });
  } catch (err) {
    console.error('[IMAP] Archive:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Marquer comme lu ──────────────────────────────────────────
router.post('/:uid/mark-read', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'assurances';
    const uid = parseInt(req.params.uid);
    if (isAliasMailbox(mailbox)) return res.status(400).json({ success: false, error: 'Boîte alias.' });
    const cfg = getMailboxConfig(mailbox);
    if (!cfg || !cfg.password) return res.status(400).json({ success: false, error: `Mailbox "${mailbox}" non configurée.` });

    await new Promise((resolve, reject) => {
      const imap = new Imap({ user: cfg.email, password: cfg.password, host: cfg.host, port: cfg.port, tls: true, tlsOptions: { servername: cfg.host, rejectUnauthorized: false } });
      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) { imap.end(); return reject(err); }
          imap.addFlags(uid, ['\Seen'], (e2) => { imap.end(); e2 ? reject(e2) : resolve(); });
        });
      });
      imap.once('error', reject);
      imap.connect();
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Route emails envoyés ─────────────────────────────────────
router.get('/sent', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'assurances';
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const result = await fetchSentEmails(mailbox, limit);
    res.json({ success: true, mailbox, ...result });
  } catch (err) {
    console.error('[IMAP] Sent:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Route mailboxes list (avec infos alias) ─────────────────
router.get('/mailboxes/list', requireApiKey, (req, res) => {
  const list = Object.entries(MAILBOXES).map(([id, cfg]) => ({
    id,
    label: cfg.label,
    email: cfg.email,
    color: cfg.color || '#888',
    isAlias: cfg.isAlias || false,
  }));
  res.json({ success: true, mailboxes: list });
});


// GET /api/emails/:uid/attachments/:index — télécharger une pièce jointe
router.get('/:uid/attachments/:index', requireApiKey, async (req, res) => {
  try {
    const uid = parseInt(req.params.uid);
    const idx = parseInt(req.params.index);
    const mailbox = req.query.mailbox || 'assurances';
    
    const { fetchEmailById } = require('./server-email.cjs');
    const email = await fetchEmailById(mailbox, uid, true);
    
    if (!email.attachments || idx >= email.attachments.length) {
      return res.status(404).json({ success: false, error: 'Pièce jointe non trouvée' });
    }
    
    const att = email.attachments[idx];
    const buffer = Buffer.from(att.content_base64 || att.content || att.data || '', 'base64');
    
    res.setHeader('Content-Type', att.contentType || att.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${att.filename || 'download'}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[IMAP] Download attachment:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/emails/forward — transférer un email
router.post('/forward', requireApiKey, async (req, res) => {
  try {
    const { mailbox, uid, to, subject, text } = req.body;
    const mailboxKey = mailbox || 'assurances';
    
    // Récupérer l'email original
    const { fetchEmailById } = require('./server-email.cjs');
    const original = await fetchEmailById(mailboxKey, parseInt(uid), true);
    
    const fwdSubject = subject || (original.subject?.startsWith('Fwd:') ? original.subject : `Fwd: ${original.subject || ''}`);
    const fwdText = `\n\n---------- Message transféré ----------\nDe: ${original.from}\nDate: ${original.date}\nObjet: ${original.subject}\n\n${cleanTextBody(original.text || original.body || '')}\n\n----------------------------------------\n\n${text || ''}`;
    
    const info = await sendEmail(mailboxKey, { to, subject: fwdSubject, text: fwdText });
    res.json({ success: true, ...info });
  } catch (err) {
    console.error('[SMTP] Forward:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


module.exports = router;
module.exports.fetchEmailById = fetchEmailById;
module.exports.fetchEmails = fetchEmails;
module.exports.getMailboxConfig = getMailboxConfig;
module.exports.isAliasMailbox = isAliasMailbox;
module.exports.sendEmail = sendEmail;
