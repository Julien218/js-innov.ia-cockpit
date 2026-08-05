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
const { timingSafeEqual } = require('node:crypto');
const router = express.Router();

// ── Configuration multi-mailboxes ────────────────────────────
const MAILBOXES = {
  jsinnovia: {
    label: 'JS-Innov.IA',
    isAlias: true,
    email: process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com',
    password: process.env.EMAIL_PASSWORD || '',
    host: 'imap.ionos.fr',
    port: 993,
    tls: true,
    smtpHost: 'smtp.ionos.fr',
    smtpPort: 465,
    color: '#D4AF37',
  },
  assurances: {
    label: 'Assurances Dour',
    email: process.env.EMAIL_ASSURANCES_ADDRESS || 'info@assurances-dour.be',
    password: process.env.EMAIL_PASSWORD_ASSURANCES || '',
    host: 'imap.ionos.fr',
    port: 993,
    tls: true,
    smtpHost: 'smtp.ionos.fr',
    smtpPort: 465,
    color: '#06B6D4',
  },
  store: {
    label: 'JS-Innov.IA Store',
    email: process.env.EMAIL_STORE_ADDRESS || 'info@jsinnovia.store',
    password: process.env.EMAIL_PASSWORD_STORE || '',
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

function secureStringEqual(expected, received) {
  if (!expected || !received) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received));
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireApiKey(req, res, next) {
  const key = req.headers['x-agent-key'] || req.headers['x-api-key'];
  console.log('[EMAIL AUTH]', {
    hasReceivedKey: Boolean(key),
    hasServerKey: Boolean(process.env.AGENT_API_KEY),
    headerUsed: req.headers['x-agent-key'] ? 'x-agent-key' : (req.headers['x-api-key'] ? 'x-api-key' : 'none'),
  });
  if (!secureStringEqual(process.env.AGENT_API_KEY, key)) {
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
    auth: { user: cfg.email, pass: cfg.password },
    tls: { rejectUnauthorized: true, servername: cfg.smtpHost },
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
    color: cfg.color || '#888',
    configured: !!cfg.password,
    isAlias: cfg.isAlias || false,
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
    if (!cfg.password) return reject(new Error(`Mot de passe non configuré pour "${mailboxKey}".`));

    const imap = new Imap({
      user: cfg.email,
      password: cfg.password,
      host: cfg.host,
      port: cfg.port,
      tls: true,
      tlsOptions: { servername: cfg.host, rejectUnauthorized: true },
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
                  if (d) try { date = new Date(d); } catch (_) {}
                }
              });
              let hasAttachment = false;
              if (e.struct) {
                const checkStruct = (s) => {
                  if (!Array.isArray(s)) return;
                  for (const part of s) {
                    if (part.disposition === 'attachment'
                        || (part.params && part.params.name)) {
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
function fetchEmailById(mailboxKey, uid) {
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
      tlsOptions: { servername: cfg.host, rejectUnauthorized: true },
    });
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); return reject(err); }
        let rawEmail = '';
        const f = imap.fetch(String(uid), { bodies: '', struct: true });
        f.on('message', (msg) => {
          msg.on('body', stream => {
            stream.on('data', c => rawEmail += c.toString('utf8'));
          });
          msg.once('attributes', a => {
            imap.addFlags(a.uid, '\\Seen', () => {});
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
async function sendEmail(mailboxKey, { to, subject, text, html, cc, bcc, replyToMessageId }) {
  if (isAliasMailbox(mailboxKey)) {
    throw new Error('Cette adresse est un alias, impossible d\'envoyer directement depuis cette boîte. Utilisez JS-Innov.IA Store ou Assurances Dour.');
  }
  const cfg = getMailboxConfig(mailboxKey);
  if (!cfg) throw new Error(`Mailbox "${mailboxKey}" non configurée`);
  if (!cfg.password) throw new Error(`Mot de passe SMTP non configuré pour "${mailboxKey}".`);
  if (!to) throw new Error('Destinataire (to) requis');

  const transport = getSmtpTransport(mailboxKey);
  if (!transport) throw new Error(`Transport SMTP non disponible pour "${mailboxKey}".`);

  const mailOptions = {
    from: `"${cfg.label}" <${cfg.email}>`,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject: subject || '(sans objet)',
    text: text || '',
    html: html || undefined,
    inReplyTo: replyToMessageId || undefined,
    headers: replyToMessageId ? { References: replyToMessageId } : undefined,
  };

  const info = await transport.sendMail(mailOptions);
  return { messageId: info.messageId, response: info.response, envelope: info.envelope };
}

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
      tls: true, tlsOptions: { servername: cfg.host, rejectUnauthorized: true },
    });

    imap.once('ready', () => {
      imap.getBoxes((err, boxes) => {
        if (err) { imap.end(); return reject(err); }

        const sentCandidates = ['Sent', 'Sent Items', 'Éléments envoyés', 'INBOX.Sent', 'INBOX.Sent Items', 'Envoyés'];
        const boxNames = Object.keys(boxes);
        let sentFolder = null;

        for (const candidate of sentCandidates) {
          if (boxNames.includes(candidate)) { sentFolder = candidate; break; }
        }
        if (!sentFolder) {
          sentFolder = boxNames.find(n => /sent|envoy/i.test(n)) || null;
        }

        if (!sentFolder) {
          imap.end();
          return resolve({ emails: [], total: 0, sentFolder: null, message: 'Aucun dossier envoyé trouvé.' });
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
                  if (d) try { date = new Date(d); } catch (_) {}
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

router.post('/send', requireApiKey, async (req, res) => {
  try {
    const { mailbox, to, subject, text, html, cc, bcc, replyToUid } = req.body;
    const mailboxKey = mailbox || 'jsinnovia';

    let replyToMessageId = null;
    if (replyToUid) {
      try {
        const original = await fetchEmailById(mailboxKey, parseInt(replyToUid));
        replyToMessageId = original.messageId || null;
      } catch (_) { /* non bloquant */ }
    }

    const info = await sendEmail(mailboxKey, { to, subject, text, html, cc, bcc, replyToMessageId });
    res.json({ success: true, ...info });
  } catch (err) {
    console.error('[SMTP] Envoi:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Supprimer un email ───────────────────────────────────────
router.delete('/:uid', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'assurances';
    const uid = parseInt(req.params.uid);
    if (!uid) return res.status(400).json({ success: false, error: 'UID invalide.' });
    if (isAliasMailbox(mailbox)) return res.status(400).json({ success: false, error: 'Boîte alias, opération non disponible.' });
    const cfg = getMailboxConfig(mailbox);
    if (!cfg || !cfg.password) return res.status(400).json({ success: false, error: `Mailbox "${mailbox}" non configurée.` });

    await new Promise((resolve, reject) => {
      const imap = new Imap({ user: cfg.email, password: cfg.password, host: cfg.host, port: cfg.port, tls: true, tlsOptions: { servername: cfg.host, rejectUnauthorized: true } });
      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) { imap.end(); return reject(err); }
          imap.addFlags(uid, ['\\Deleted'], (e2) => {
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

// ── Archiver un email ────────────────────────────────────────
router.post('/:uid/archive', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'assurances';
    const uid = parseInt(req.params.uid);
    if (!uid) return res.status(400).json({ success: false, error: 'UID invalide.' });
    if (isAliasMailbox(mailbox)) return res.status(400).json({ success: false, error: 'Boîte alias, opération non disponible.' });
    const cfg = getMailboxConfig(mailbox);
    if (!cfg || !cfg.password) return res.status(400).json({ success: false, error: `Mailbox "${mailbox}" non configurée.` });

    await new Promise((resolve, reject) => {
      const imap = new Imap({ user: cfg.email, password: cfg.password, host: cfg.host, port: cfg.port, tls: true, tlsOptions: { servername: cfg.host, rejectUnauthorized: true } });
      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) { imap.end(); return reject(err); }
          imap.addFlags(uid, ['\\Seen', '\\Flagged'], (e2) => { imap.end(); e2 ? reject(e2) : resolve(); });
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

// ── Marquer comme lu ─────────────────────────────────────────
router.post('/:uid/mark-read', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'assurances';
    const uid = parseInt(req.params.uid);
    if (!uid) return res.status(400).json({ success: false, error: 'UID invalide.' });
    if (isAliasMailbox(mailbox)) return res.status(400).json({ success: false, error: 'Boîte alias.' });
    const cfg = getMailboxConfig(mailbox);
    if (!cfg || !cfg.password) return res.status(400).json({ success: false, error: `Mailbox "${mailbox}" non configurée.` });

    await new Promise((resolve, reject) => {
      const imap = new Imap({ user: cfg.email, password: cfg.password, host: cfg.host, port: cfg.port, tls: true, tlsOptions: { servername: cfg.host, rejectUnauthorized: true } });
      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) { imap.end(); return reject(err); }
          imap.addFlags(uid, ['\\Seen'], (e2) => { imap.end(); e2 ? reject(e2) : resolve(); });
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

module.exports = router;
