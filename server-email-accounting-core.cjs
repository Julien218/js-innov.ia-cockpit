const path = require('path');

const INVOICE_TERMS = /\b(facture|invoice|rechnung|receipt|reçu|abonnement|subscription|échéance|payment due|amount due|montant ttc)\b/i;
const REQUEST_TERMS = /\b(devis|quote|offre|demande|request|renseignement|information|rendez-vous|proposition)\b/i;
const GITHUB_NOTIFICATION_SENDER = /(?:notifications|noreply)@github\.com/i;
const GITHUB_BILLING_SUBJECT = /\b(invoice|facture|receipt|reçu|billing|payment due|paiement)\b/i;
const SAFE_ACCOUNTING_EXTENSIONS = new Set(['.pdf', '.xml', '.csv', '.xlsx', '.xls', '.png', '.jpg', '.jpeg', '.webp']);

function clean(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function senderDomain(from) {
  return (String(from || '').match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1] || '').toLowerCase();
}

function providerFromEmail(email) {
  const from = clean(email?.from, 200);
  const name = from.replace(/<[^>]+>/g, '').replace(/["']/g, '').trim();
  return clean(name || senderDomain(from) || 'Fournisseur non identifié', 100);
}

function normalizeNumber(raw) {
  const value = String(raw || '').replace(/\u00a0/g, ' ').trim();
  if (!value) return null;
  const compact = value.replace(/\s/g, '');
  const comma = compact.lastIndexOf(',');
  const dot = compact.lastIndexOf('.');
  let normalized = compact;
  if (comma > dot) normalized = compact.replace(/\./g, '').replace(',', '.');
  else if (dot > comma) normalized = compact.replace(/,/g, '');
  else normalized = compact.replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseMoneyAmount(text) {
  const source = String(text || '').replace(/\u00a0/g, ' ');
  const patterns = [
    /(?:total(?:\s+ttc)?|montant(?:\s+(?:restant\s+)?[àa]\s+payer)?|amount due|balance due)[^\d$€]{0,24}(?:([$€])\s*)?(\d{1,3}(?:[ ,.']\d{3})*(?:[,.]\d{2})|\d+[,.]\d{2})(?:\s*(USD|EUR))?/i,
    /(?:([$€])\s*)(\d{1,3}(?:[ ,.']\d{3})*(?:[,.]\d{2})|\d+[,.]\d{2})(?:\s*(USD|EUR))?/i,
    /(\d{1,3}(?:[ ,.']\d{3})*(?:[,.]\d{2})|\d+[,.]\d{2})\s*(USD|EUR|€)/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    let symbol;
    let raw;
    let explicit;
    if (pattern === patterns[2]) {
      raw = match[1];
      explicit = match[2];
    } else {
      symbol = match[1];
      raw = match[2];
      explicit = match[3];
    }
    const amount = normalizeNumber(raw);
    if (!amount) continue;
    const currency = explicit === '€' ? 'EUR' : String(explicit || (symbol === '$' ? 'USD' : symbol === '€' ? 'EUR' : '')).toUpperCase() || null;
    return { amount_minor: Math.round(amount * 100), currency };
  }
  return { amount_minor: null, currency: null };
}

function parseEuroAmount(text) {
  const parsed = parseMoneyAmount(text);
  return parsed.currency === 'EUR' ? parsed.amount_minor : null;
}

function invoiceNumber(text) {
  const source = String(text || '');
  const patterns = [
    /(?:facture|invoice|reçu|receipt)\s+(?:n[°o]|number|numéro)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,50})/i,
    /(?:invoice|facture)\s*[:#-]\s*([A-Z0-9][A-Z0-9._/-]{2,50})/i,
  ];
  for (const pattern of patterns) {
    const candidate = clean(source.match(pattern)?.[1], 60);
    if (!candidate || !/\d/.test(candidate)) continue;
    if (/^(?:due|payment|invoice|facture|total)$/i.test(candidate)) continue;
    return candidate;
  }
  return null;
}

function isOperationalGitHubNotification(email) {
  return GITHUB_NOTIFICATION_SENDER.test(String(email?.from || email?.sender || ''))
    && !GITHUB_BILLING_SUBJECT.test(String(email?.subject || ''));
}

function classifyEmail(email) {
  if (isOperationalGitHubNotification(email)) {
    return { category: 'other', confidence: 0.99, needsReview: false, reason: 'github_operational_notification' };
  }
  const attachments = Array.isArray(email?.attachments) ? email.attachments : [];
  const names = attachments.map((item) => item.filename || '').join(' ');
  const haystack = `${email?.subject || ''} ${email?.text || email?.body || ''} ${names}`;
  const invoiceSignal = INVOICE_TERMS.test(haystack);
  const accountingAttachment = attachments.some((item) => SAFE_ACCOUNTING_EXTENSIONS.has(path.extname(item.filename || '').toLowerCase()));
  if (invoiceSignal) {
    return { category: /abonnement|subscription/i.test(haystack) ? 'subscription_invoice' : 'invoice', confidence: accountingAttachment ? 0.96 : 0.82, needsReview: true };
  }
  if (REQUEST_TERMS.test(haystack)) return { category: 'request_or_quote', confidence: 0.78, needsReview: true };
  return { category: 'other', confidence: 0.55, needsReview: false };
}

function extractAccountingMetadata(email) {
  const text = `${email?.subject || ''}\n${email?.text || email?.body || ''}`;
  const amount = parseMoneyAmount(text);
  const fallbackCurrency = /\bUSD\b|\$\s*\d/i.test(text) ? 'USD' : /(?:€|\bEUR\b)/i.test(text) ? 'EUR' : null;
  return {
    provider: providerFromEmail(email),
    invoice_number: invoiceNumber(text),
    amount_minor: amount.amount_minor,
    currency: amount.currency || fallbackCurrency,
  };
}

function shouldArchiveAttachment(attachment) {
  return SAFE_ACCOUNTING_EXTENSIONS.has(path.extname(attachment?.filename || '').toLowerCase()) && Number(attachment?.size || 0) <= 25 * 1024 * 1024;
}

function sourceTypeForProvider(provider) {
  const value = String(provider || '').toLowerCase();
  if (value.includes('railway')) return 'railway';
  if (value.includes('github')) return 'github';
  if (value.includes('supabase')) return 'supabase';
  if (value.includes('dropbox')) return 'dropbox';
  if (value.includes('twilio')) return 'twilio';
  if (/openai|xai|grok|anthropic|claude|sora|runway/.test(value)) return 'llm_api';
  return 'other';
}

function buildDailyDigest(date, items) {
  const counts = items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    if (item.status === 'awaiting_review') acc.awaiting_review += 1;
    if (item.document_id) acc.archived += 1;
    if (item.status === 'failed') acc.failed += 1;
    if (item.metadata?.cleanup?.action === 'moved_to_trash') acc.moved_to_trash += 1;
    return acc;
  }, { awaiting_review: 0, archived: 0, failed: 0, moved_to_trash: 0 });
  const important = items.filter((item) => item.category !== 'other').slice(0, 20);
  const lines = important.map((item) => `- [${item.mailbox}] ${clean(item.subject, 120)} — ${clean(item.sender, 80)} (${item.category}${item.document_id ? ', archivé Dropbox' : ''})`);
  const text = [
    `Compte rendu NOVA des e-mails — ${date}`,
    '',
    `${items.length} nouveau(x) e-mail(s) analysé(s).`,
    `${counts.awaiting_review} élément(s) nécessitent votre validation humaine.`,
    `${counts.archived} pièce(s) comptable(s) archivée(s) dans Dropbox.`,
    `${counts.moved_to_trash} publicité(s) déplacée(s) vers une corbeille récupérable.`,
    `${counts.failed} erreur(s) technique(s).`,
    '',
    important.length ? 'Éléments importants :' : 'Aucun élément important détecté.',
    ...lines,
    '',
    'Aucun e-mail n’a été supprimé définitivement. Aucun coût n’a été marqué vérifié sans validation humaine.',
  ].join('\n');
  return { counts, text, subject: `NOVA — Compte rendu e-mails du ${date}` };
}

module.exports = {
  classifyEmail,
  extractAccountingMetadata,
  shouldArchiveAttachment,
  sourceTypeForProvider,
  buildDailyDigest,
  parseEuroAmount,
  parseMoneyAmount,
  invoiceNumber,
  isOperationalGitHubNotification,
};
