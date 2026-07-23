/**
 * Email IMAP Proxy — JS-Innov.IA Cockpit
 * Route Express multi-mailboxes IMAP IONOS
 *
 * Mailboxes supportées :
 *   - jsinnovia   → info@jsinnovia.com       (EMAIL_PASSWORD)
 *   - assurances  → julien.pagin@assurancesdour.be (EMAIL_PASSWORD_ASSURANCES)
 *
 * Routes :
 *   GET /api/emails?mailbox=jsinnovia&limit=30&offset=0
 *   GET /api/emails/:uid?mailbox=assurances
 *   GET /api/emails/mailboxes/list  → liste des mailboxes disponibles
 */
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const express = require('express');
const router = express.Router();

// ── Configuration multi-mailboxes ────────────────────────────
const MAILBOXES = {
  jsinnovia: {
    label: 'JS-Innov.IA',
    email: 'info@jsinnovia.com',
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
    email: 'julien.pagin@assurancesdour.be',
    password: process.env.EMAIL_PASSWORD_ASSURANCES || '',
    host: 'imap.ionos.fr',
    port: 993,
    tls: true,
    smtpHost: 'smtp.ionos.fr',
    smtpPort: 465,
    color: '#06B6D4',
  },
};

function getMailboxConfig(mailbox) {
  const cfg = MAILBOXES[mailbox || 'jsinnovia'];
  if (!cfg) return null;
  if (!cfg.password) return null;
  return cfg;
}

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (!key || key !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
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
    const cfg = getMailboxConfig(mailboxKey);
    if (!cfg) return reject(new Error(`Mailbox "${mailboxKey}" non configurée ou introuvable`));

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
              // Détecter pièces jointes via struct
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
function fetchEmailById(mailboxKey, uid) {
  return new Promise((resolve, reject) => {
    const cfg = getMailboxConfig(mailboxKey);
    if (!cfg) return reject(new Error(`Mailbox "${mailboxKey}" non configurée`));

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
            }))
            .catch(reject);
        });
      });
    });
    imap.once('error', e => reject(e));
    imap.connect();
  });
}

// ── Routes ──────────────────────────────────────────────────
router.get('/', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'jsinnovia';
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const offset = parseInt(req.query.offset) || 0;
    const result = await fetchEmails(mailbox, { limit, offset });
    res.json({ success: true, mailbox, ...result });
  } catch (err) {
    console.error('[IMAP] Liste:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:uid', requireApiKey, async (req, res) => {
  try {
    const mailbox = req.query.mailbox || 'jsinnovia';
    const uid = parseInt(req.params.uid);
    if (!uid) return res.status(400).json({ error: 'UID invalide' });
    const email = await fetchEmailById(mailbox, uid);
    res.json({ success: true, mailbox, email });
  } catch (err) {
    console.error('[IMAP] Lecture:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
