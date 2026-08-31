const Imap = require('imap');
const { classifyEmail } = require('./server-email-accounting-core.cjs');

function decodeMailHeader(value) {
  // The IMAP parser unfolds RFC 5322 headers and decodes RFC 2047 Q/B words,
  // including adjacent encoded words and their original character sets.
  return (Imap.parseHeader(`Subject: ${String(value || '').replace(/\r?\n(?![ \t])/g, ' ')}\r\n`).subject?.[0] || '').trim();
}

function parseMailHeaders(raw, fallbackDate) {
  const headers = Imap.parseHeader(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || ''));
  const date = new Date(headers.date?.[0] || fallbackDate || '');
  const fallback = new Date(fallbackDate || '');
  return {
    from: (headers.from?.join(', ') || '').trim(),
    to: (headers.to?.join(', ') || '').trim(),
    subject: (headers.subject?.join(' ') || '').trim(),
    date: Number.isFinite(date.getTime()) ? date.toISOString() : Number.isFinite(fallback.getTime()) ? fallback.toISOString() : null,
  };
}

function classifyMailboxEmail(email) {
  // A visible, non-mutating classification of every loaded message, with no
  // age cutoff. Do not use raw MIME bodies or treat this as accounting approval.
  const classified = classifyEmail({ subject: email.subject, from: email.from, attachments: email.attachments });
  let category = 'other';
  if (classified.reason === 'github_operational_notification') category = 'notifications';
  else if (/invoice/.test(classified.category)) category = 'invoices';
  else if (classified.category === 'request_or_quote') category = 'requests';
  else if (/\b(client|sinistre|assurance|contrat|police|immatricul|intermédiaire|intermediaire|assistance|n\/réf)/i.test(email.subject || '')) category = 'client_records';
  else if (email.labels?.includes('CATEGORY_PROMOTIONS')) category = 'promotions';
  else if (email.labels?.includes('CATEGORY_UPDATES') || /\b(notification|alerte|alert|workflow|deployment)\b/i.test(email.subject || '')) category = 'notifications';
  return { category, basis: 'headers', automatic: true, indicative: true };
}

function presentMailboxEmail(email) {
  const decoded = { ...email, from: decodeMailHeader(email.from), to: decodeMailHeader(email.to), subject: decodeMailHeader(email.subject) };
  return { ...decoded, classification: classifyMailboxEmail(decoded) };
}

module.exports = { decodeMailHeader, parseMailHeaders, classifyMailboxEmail, presentMailboxEmail };
