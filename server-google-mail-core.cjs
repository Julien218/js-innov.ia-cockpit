const crypto = require('crypto');

const PROTECTED_TERMS = [
  'facture', 'invoice', 'receipt', 'recu', 'reçu', 'paiement', 'payment',
  'devis', 'quote', 'commande', 'order confirmation', 'confirmation de commande',
  'abonnement', 'subscription', 'contrat', 'contract', 'remboursement', 'refund',
  'echeance', 'échéance', 'mise en demeure', 'taxe', 'tva', 'vat',
];

function encryptionKey(value) {
  if (!String(value || '').trim()) throw new Error('GOOGLE_MAIL_ENCRYPTION_KEY non configurée');
  return crypto.createHash('sha256').update(String(value)).digest();
}

function encryptToken(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptToken(value, secret) {
  const [version, iv, tag, payload] = String(value || '').split('.');
  if (version !== 'v1' || !iv || !tag || !payload) throw new Error('Jeton Google chiffré invalide');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
}

function encodeState(payload, secret) {
  const body = Buffer.from(JSON.stringify({ ...payload, issued_at: Date.now() })).toString('base64url');
  const signature = crypto.createHmac('sha256', encryptionKey(secret)).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeState(value, secret, maxAgeMs = 10 * 60 * 1000) {
  const [body, signature] = String(value || '').split('.');
  if (!body || !signature) throw new Error('État OAuth manquant');
  const expected = crypto.createHmac('sha256', encryptionKey(secret)).update(body).digest();
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw new Error('État OAuth invalide');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.issued_at || Date.now() - payload.issued_at > maxAgeMs) throw new Error('État OAuth expiré');
  return payload;
}

function decodeBase64Url(value) {
  if (!value) return '';
  return Buffer.from(String(value), 'base64url').toString('utf8');
}

function headerValue(headers, name) {
  return (headers || []).find((entry) => String(entry.name || '').toLowerCase() === String(name).toLowerCase())?.value || '';
}

function flattenParts(part, output = { text: [], html: [], attachments: [] }) {
  if (!part) return output;
  const mimeType = String(part.mimeType || '').toLowerCase();
  const data = part.body?.data;
  if (data && mimeType === 'text/plain') output.text.push(decodeBase64Url(data));
  if (data && mimeType === 'text/html') output.html.push(decodeBase64Url(data));
  if (part.filename) output.attachments.push({
    filename: part.filename,
    mimeType: part.mimeType || 'application/octet-stream',
    size: Number(part.body?.size || 0),
    attachmentId: part.body?.attachmentId || null,
  });
  for (const child of part.parts || []) flattenParts(child, output);
  return output;
}

function gmailMessageToEmail(message) {
  const headers = message?.payload?.headers || [];
  const body = flattenParts(message?.payload);
  const directData = message?.payload?.body?.data;
  if (directData && !body.text.length && !body.html.length) {
    if (String(message.payload.mimeType || '').toLowerCase() === 'text/html') body.html.push(decodeBase64Url(directData));
    else body.text.push(decodeBase64Url(directData));
  }
  const labels = message?.labelIds || [];
  return {
    uid: message.id,
    messageId: message.id,
    threadId: message.threadId,
    from: headerValue(headers, 'From'),
    to: headerValue(headers, 'To'),
    subject: headerValue(headers, 'Subject') || '(sans objet)',
    date: headerValue(headers, 'Date') || (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null),
    seen: !labels.includes('UNREAD'),
    important: labels.includes('IMPORTANT'),
    starred: labels.includes('STARRED'),
    labels,
    preview: message.snippet || '',
    body: message.snippet || '',
    text: body.text.join('\n').trim(),
    html: body.html.join('\n').trim(),
    attachments: body.attachments,
    hasAttachment: body.attachments.length > 0,
  };
}

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function senderAddress(value) {
  return String(value || '').match(/<([^>]+)>/)?.[1]?.toLowerCase() || String(value || '').trim().toLowerCase();
}

function isProtectedSender(from, protectedSenders = []) {
  const address = senderAddress(from);
  return protectedSenders.some((entry) => {
    const rule = String(entry || '').trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith('@')) return address.endsWith(rule);
    return address === rule || address.endsWith(`@${rule}`);
  });
}

function shouldTrashPromotion(message, protectedSenders = []) {
  const email = gmailMessageToEmail(message);
  if (!email.labels.includes('CATEGORY_PROMOTIONS')) return { eligible: false, confidence: 0, reason: 'not_gmail_promotion' };
  if (email.important || email.starred) return { eligible: false, confidence: 1, reason: 'important_or_starred' };
  if (isProtectedSender(email.from, protectedSenders)) return { eligible: false, confidence: 1, reason: 'protected_sender' };
  const haystack = normalized(`${email.subject} ${email.from} ${email.preview}`);
  if (PROTECTED_TERMS.some((term) => haystack.includes(normalized(term)))) return { eligible: false, confidence: 0.95, reason: 'accounting_or_business_signal' };
  return { eligible: true, confidence: 0.98, reason: 'gmail_category_promotions' };
}

module.exports = {
  encryptToken,
  decryptToken,
  encodeState,
  decodeState,
  decodeBase64Url,
  headerValue,
  gmailMessageToEmail,
  shouldTrashPromotion,
  isProtectedSender,
};
