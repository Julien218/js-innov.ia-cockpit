const Imap = require('imap');
const { simpleParser } = require('mailparser');

const MAILBOX = {
  email: process.env.EMAIL_ASSURANCES_ADDRESS || 'info@assurances-dour.be',
  password: process.env.EMAIL_PASSWORD_ASSURANCES || '',
  host: process.env.EMAIL_ASSURANCES_IMAP_HOST || 'imap.ionos.fr',
  port: Number(process.env.EMAIL_ASSURANCES_IMAP_PORT || 993),
};

function createImap() {
  if (!MAILBOX.password) {
    throw new Error('EMAIL_PASSWORD_ASSURANCES non configuré');
  }
  return new Imap({
    user: MAILBOX.email,
    password: MAILBOX.password,
    host: MAILBOX.host,
    port: MAILBOX.port,
    tls: true,
    tlsOptions: { servername: MAILBOX.host, rejectUnauthorized: true },
  });
}

function fetchInsuranceEmails({ limit = 25, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 50));
  const safeOffset = Math.max(0, Number(offset) || 0);

  return new Promise((resolve, reject) => {
    let imap;
    try { imap = createImap(); } catch (error) { reject(error); return; }
    const rows = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (error, box) => {
        if (error) { imap.end(); reject(error); return; }
        const total = box.messages.total;
        if (!total || safeOffset >= total) {
          imap.end();
          resolve({ emails: [], total });
          return;
        }

        const end = Math.max(1, total - safeOffset);
        const start = Math.max(1, end - safeLimit + 1);
        const fetcher = imap.seq.fetch(`${start}:${end}`, {
          bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO)'],
          struct: true,
          markSeen: false,
        });

        fetcher.on('message', (message) => {
          const row = { rawHeaders: '' };
          message.on('body', (stream) => {
            stream.on('data', (chunk) => { row.rawHeaders += chunk.toString('utf8'); });
          });
          message.once('attributes', (attrs) => {
            row.uid = attrs.uid;
            row.date = attrs.date;
            row.seen = (attrs.flags || []).includes('\\Seen');
          });
          message.once('end', () => rows.push(row));
        });

        fetcher.once('error', (fetchError) => { imap.end(); reject(fetchError); });
        fetcher.once('end', () => {
          imap.end();
          const emails = rows.map((row) => {
            const headers = {};
            row.rawHeaders.split(/\r?\n/).forEach((line) => {
              const match = line.match(/^([^:]+):\s*(.*)$/);
              if (match) headers[match[1].toLowerCase()] = match[2].trim();
            });
            return {
              uid: row.uid,
              from: headers.from || '',
              to: headers.to || '',
              cc: headers.cc || '',
              subject: headers.subject || '(sans objet)',
              date: row.date instanceof Date ? row.date.toISOString() : row.date || null,
              messageId: headers['message-id'] || '',
              inReplyTo: headers['in-reply-to'] || '',
              seen: row.seen,
            };
          }).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
          resolve({ emails, total });
        });
      });
    });

    imap.once('error', reject);
    imap.connect();
  });
}

function fetchInsuranceEmail(uid) {
  const safeUid = Number(uid);
  if (!Number.isInteger(safeUid) || safeUid <= 0) {
    return Promise.reject(new Error('UID email invalide'));
  }

  return new Promise((resolve, reject) => {
    let imap;
    try { imap = createImap(); } catch (error) { reject(error); return; }
    let rawEmail = '';

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (error) => {
        if (error) { imap.end(); reject(error); return; }
        const fetcher = imap.fetch(String(safeUid), { bodies: '', struct: true, markSeen: false });
        fetcher.on('message', (message) => {
          message.on('body', (stream) => {
            stream.on('data', (chunk) => { rawEmail += chunk.toString('utf8'); });
          });
        });
        fetcher.once('error', (fetchError) => { imap.end(); reject(fetchError); });
        fetcher.once('end', () => {
          imap.end();
          simpleParser(rawEmail, {})
            .then((parsed) => resolve({
              uid: safeUid,
              from: parsed.from?.text || '',
              to: parsed.to?.text || '',
              cc: parsed.cc?.text || '',
              subject: parsed.subject || '(sans objet)',
              date: parsed.date?.toISOString() || null,
              text: parsed.text || '',
              messageId: parsed.messageId || '',
              inReplyTo: parsed.inReplyTo || '',
              attachments: (parsed.attachments || []).map((attachment) => ({
                filename: attachment.filename || 'pièce jointe',
                contentType: attachment.contentType || '',
                size: attachment.size || 0,
              })),
            }))
            .catch(reject);
        });
      });
    });

    imap.once('error', reject);
    imap.connect();
  });
}

module.exports = { fetchInsuranceEmails, fetchInsuranceEmail };
