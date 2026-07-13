/**
 * Email IMAP Proxy — JS-Innov.IA Cockpit
 * Route Express pour lire les emails IMAP de info@jsinnovia.com
 */
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const express = require('express');
const router = express.Router();

const IMAP_CONFIG = {
  user: 'info@jsinnovia.com',
  password: process.env.EMAIL_PASSWORD || '',
  host: 'imap.ionos.fr',
  port: 993,
  tls: true,
  tlsOptions: { servername: 'imap.ionos.fr', rejectUnauthorized: false },
};

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (!key || key !== process.env.AGENT_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function fetchEmails({ folder = 'INBOX', limit = 30, offset = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(IMAP_CONFIG);
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
              let body = e.rawBody
                .replace(/Content-Type:.*?(\r?\n)+/gi, '')
                .replace(/Content-Transfer-Encoding:.*?\r?\n/gi, '')
                .replace(/--[^\r\n]+(\r?\n)?/g, '')
                .replace(/=\r?\n/g, '')
                .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
                .replace(/<[^>]+>/g, ' ')
                .trim();
              if (body.length > 300) body = body.substring(0, 300) + '…';

              return {
                uid: e.uid,
                from,
                to,
                subject: subject || '(sans objet)',
                date: date ? new Date(date).toISOString() : null,
                seen: e.seen,
                body,
                hasAttachment: !!(e.struct && JSON.stringify(e.struct).includes('application')),
              };
            });
            parsed.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
            resolve({ emails: parsed, total, unread: unreadCount });
          });
        });
      });
    });

    imap.once('error', e => reject(e));
    imap.connect();
  });
}

function fetchEmailById(uid) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(IMAP_CONFIG);
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

router.get('/', requireApiKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const offset = parseInt(req.query.offset) || 0;
    const result = await fetchEmails({ limit, offset });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[IMAP] Liste:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:uid', requireApiKey, async (req, res) => {
  try {
    const uid = parseInt(req.params.uid);
    if (!uid) return res.status(400).json({ error: 'UID invalide' });
    const email = await fetchEmailById(uid);
    res.json({ success: true, email });
  } catch (err) {
    console.error('[IMAP] Lecture:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
