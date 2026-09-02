const path = require('node:path');

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decimal(value) {
  if (value === null || value === undefined) return null;
  const compact = String(value).replace(/\s/g, '').replace(/[^0-9,+.-]/g, '');
  if (!compact || !/\d/.test(compact)) return null;

  const sign = compact.startsWith('-') ? -1 : 1;
  const unsigned = compact.replace(/^[+-]/, '');
  const comma = unsigned.lastIndexOf(',');
  const dot = unsigned.lastIndexOf('.');
  let normalized = unsigned;

  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? ',' : '.';
    const groupingSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = unsigned.split(groupingSeparator).join('');
    if (decimalSeparator === ',') normalized = normalized.replace(',', '.');
  } else {
    const separator = comma >= 0 ? ',' : dot >= 0 ? '.' : '';
    if (separator) {
      const parts = unsigned.split(separator);
      const fraction = parts.pop();
      const integer = parts.join('');
      if (parts.length >= 1 && fraction.length === 3) normalized = `${integer}${fraction}`;
      else normalized = `${integer}.${fraction}`;
    }
  }

  const parsed = sign * Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function amountForLabel(text, label) {
  const lines = cleanText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const matcher = new RegExp(label.source, label.flags.replace('g', ''));
    if (!matcher.test(line)) continue;
    const remainder = line.replace(matcher, ' ').trim();
    const match = remainder.match(/([+-]?\s*(?:[$€]\s*)?\d(?:[\d ,.]*\d)?)(?:\s*(USD|EUR))?/i);
    if (!match) continue;
    const raw = match[1].replace(/\s/g, '');
    const sign = raw.startsWith('-') ? -1 : 1;
    const value = decimal(raw);
    return value === null ? null : sign * Math.abs(value);
  }
  return null;
}

function currencyFrom(text) {
  if (/\bUSD\b|\$\s*\d/i.test(text)) return 'USD';
  if (/\bEUR\b|€\s*\d|\d\s*€/i.test(text)) return 'EUR';
  return null;
}

function invoiceNumber(text, fileName = '') {
  const labelled = String(text || '').match(/\b(?:invoice|facture)(?:\s+(?:number|n(?:o|°)|num[eé]ro))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{2,50})/i);
  const tokens = String(fileName || '').match(/[A-Z0-9]+(?:[-_][A-Z0-9]+)+/gi) || [];
  const fileCandidate = tokens
    .map((token) => token.replace(/_/g, '-').replace(/^(?:railway-)?invoice-/i, ''))
    .find((token) => /\d/.test(token));
  const candidate = String(labelled?.[1] || fileCandidate || '').replace(/_/g, '-').trim();
  if (!candidate || !/\d/.test(candidate) || /^(?:due|payment|invoice|facture)$/i.test(candidate)) return null;
  return candidate;
}

function dateForLabel(text, label) {
  const matcher = new RegExp(label, 'i');
  for (const line of cleanText(text).split(/\n+/)) {
    if (!matcher.test(line)) continue;
    const remainder = line.replace(matcher, ' ').trim();
    const match = remainder.match(/([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4})/i);
    if (match) return match[1].trim();
  }
  return null;
}

function isoMonthFromDate(value) {
  const match = String(value || '').match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  return month ? `${match[3]}-${String(month).padStart(2, '0')}` : null;
}

function servicePeriod(text) {
  const ranges = [...cleanText(text).matchAll(/([A-Za-z]{3,9}\s+\d{1,2})\s*[–—-]\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/g)]
    .map((match) => `${match[1]}–${match[2]}`);
  return ranges[0] || null;
}

function providerFrom(text, fileName) {
  const source = `${text || ''} ${fileName || ''}`;
  if (/\brailway(?: corporation)?\b/i.test(source)) return 'Railway Corporation';
  if (/\bopenai\b/i.test(source)) return 'OpenAI';
  if (/\bgithub\b/i.test(source)) return 'GitHub';
  if (/\bdropbox\b/i.test(source)) return 'Dropbox';
  if (/\bsupabase\b/i.test(source)) return 'Supabase';
  return null;
}

function lineItems(text) {
  const source = cleanText(text);
  const known = [
    ['agent_usage', /^Agent Usage$/i],
    ['disk', /^Disk\b/i],
    ['network', /^(?:VM )?Network(?: Egress)?$/i],
    ['vcpu', /^(?:VM )?vCPU\b/i],
    ['memory', /^(?:VM )?Memory\b/i],
    ['object_storage', /^Object Storage\b/i],
    ['plan', /^Pro plan$/i],
  ];
  const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const definition = known.find(([, matcher]) => matcher.test(lines[index]));
    if (!definition) continue;
    const window = lines.slice(index, Math.min(lines.length, index + 5));
    let amount = null;
    for (const candidate of window) {
      const matches = [...candidate.matchAll(/(?:[$€]\s*)(\d+(?:[.,]\d{2})?)/g)];
      if (matches.length) amount = decimal(matches[matches.length - 1][1]);
    }
    items.push({ code: definition[0], label: lines[index], amount });
  }
  return items;
}

function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

function decodePdfBase64(value, maxBytes = 15 * 1024 * 1024) {
  const source = String(value || '').replace(/^data:application\/pdf;base64,/i, '').replace(/\s/g, '');
  if (!source || !/^[A-Za-z0-9+/]*={0,2}$/.test(source)) throw new Error('PDF encodé invalide');
  const buffer = Buffer.from(source, 'base64');
  if (!buffer.length) throw new Error('PDF vide');
  if (buffer.length > maxBytes) throw new Error(`PDF trop volumineux : maximum ${Math.floor(maxBytes / 1024 / 1024)} Mo`);
  if (!isPdfBuffer(buffer)) throw new Error('Le contenu reçu n’est pas un PDF valide');
  return buffer;
}

function safePdfFilename(value) {
  const base = path.basename(String(value || 'facture.pdf')).replace(/[\r\n<>:"|?*\u0000-\u001f]/g, '-').trim().slice(0, 180);
  return base.toLowerCase().endsWith('.pdf') ? base : `${base || 'facture'}.pdf`;
}

function parseSupplierInvoiceText(text, fileName = '') {
  const normalized = cleanText(text);
  const issueDate = dateForLabel(normalized, '(?:date of issue|date d[’\']émission)');
  const dueDate = dateForLabel(normalized, '(?:date due|date d[’\']échéance)');
  const total = amountForLabel(normalized, /^total\b/i);
  const appliedBalance = amountForLabel(normalized, /^(?:applied balance|solde appliqu[eé]|avoir appliqu[eé])\b/i);
  const amountDue = amountForLabel(normalized, /^(?:amount due|montant (?:restant )?[àa] payer)\b/i);
  const currency = currencyFrom(normalized);
  const number = invoiceNumber(normalized, fileName);
  const provider = providerFrom(normalized, fileName);
  const invoiceLike = Boolean(number || provider || /\b(invoice|facture|amount due|montant [àa] payer)\b/i.test(normalized));
  return {
    is_invoice: invoiceLike,
    provider,
    invoice_number: number,
    issue_date: issueDate,
    due_date: dueDate,
    service_period: servicePeriod(normalized),
    period: isoMonthFromDate(issueDate),
    currency,
    total_amount: total,
    applied_balance: appliedBalance,
    amount_due: amountDue,
    cost_basis_amount: total,
    payment_basis_amount: amountDue,
    line_items: lineItems(normalized),
    allocation_status: 'requires_review',
    requires_human_validation: true,
    warning: invoiceLike
      ? 'Le total fournisseur représente le coût encouru. Le montant dû peut être réduit par un crédit et ne doit pas servir seul à la refacturation.'
      : null,
  };
}

module.exports = {
  amountForLabel,
  decodePdfBase64,
  currencyFrom,
  invoiceNumber,
  isPdfBuffer,
  parseSupplierInvoiceText,
  safePdfFilename,
};
