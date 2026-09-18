const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isExplicitEmailSendRequest(message) {
  const text = normalize(message);
  if (!text) return false;
  if (/\b(?:ne|n')\s*(?:envoie|envoyer|expedie|expedier)\b/.test(text)
    || /\bsans\s+(?:envoyer|expedier)\b/.test(text)) return false;
  return /\b(?:envoie|envoyer|envoyez|expedie|expedier|expediez|send)\b/.test(text)
    || /\b(?:fais|faites)\s+partir\b/.test(text);
}

function normalizeEmailMailbox(value, aliasOnly = process.env.EMAIL_JSINNOVIA_ALIAS_ONLY) {
  const raw = normalize(value).replace(/[^a-z0-9-]/g, '');
  const legacy = {
    julien: 'store',
    contact: 'jsinnovia',
    js: 'jsinnovia',
    jsinnovia: 'jsinnovia',
    'js-innovia': 'jsinnovia',
    store: 'store',
    boutique: 'store',
    assurances: 'assurances',
    assurance: 'assurances',
  };
  let mailbox = legacy[raw] || (['jsinnovia', 'assurances', 'store'].includes(raw) ? raw : 'store');
  if (mailbox === 'jsinnovia' && String(aliasOnly || '').toLowerCase() !== 'false') mailbox = 'store';
  return mailbox;
}

function cleanMarkdownLine(value) {
  return String(value || '')
    .replace(/^\s*[-–—]{3,}\s*$/, '')
    .replace(/\*\*/g, '')
    .trim();
}

function extractEmail(value) {
  const candidates = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
  return candidates.find((candidate) => EMAIL_RE.test(candidate)) || null;
}

function parseDraftEmail(content) {
  const source = String(content || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return null;

  const lines = source.split('\n');
  let to = null;
  let subject = null;
  let subjectLine = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const clean = cleanMarkdownLine(lines[index]);
    if (!to && /^(?:à|a|destinataire|to)\s*:/i.test(clean)) {
      to = extractEmail(clean);
    }
    if (!subject && /^(?:objet|subject)\s*:/i.test(clean)) {
      subject = clean.replace(/^(?:objet|subject)\s*:\s*/i, '').trim();
      subjectLine = index;
    }
  }

  if (!to) {
    const labelled = source.match(/(?:\*\*)?(?:À|A|Destinataire|To)\s*:\s*(?:\*\*)?\s*<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i);
    to = labelled?.[1] || null;
  }
  if (!subject) {
    const flat = source.replace(/\s+/g, ' ');
    const match = flat.match(/(?:\*\*)?(?:Objet|Subject)\s*:\s*(?:\*\*)?\s*(.+?)(?=(?:\s{2,}|\s)(?:Bonjour|Bonsoir|Salut|Hello|Coucou)\b|(?:\s{2,}|\s)---|$)/i);
    subject = match?.[1]?.replace(/\*\*/g, '').trim() || null;
  }

  if (!to || !subject) return null;

  let body = '';
  if (subjectLine >= 0) {
    body = lines.slice(subjectLine + 1)
      .map(cleanMarkdownLine)
      .filter((line) => line !== '')
      .join('\n')
      .trim();
  }

  if (!body) {
    const flat = source.replace(/\s+/g, ' ');
    const marker = flat.match(/(?:\*\*)?(?:Objet|Subject)\s*:\s*(?:\*\*)?\s*.+?(?=(?:Bonjour|Bonsoir|Salut|Hello|Coucou)\b)/i);
    if (marker && marker.index !== undefined) body = flat.slice(marker.index + marker[0].length).trim();
  }

  body = body
    .replace(/^[-–—]{3,}\s*/g, '')
    .replace(/\s*[-–—]{3,}\s*(?:Souhaites?-tu|Voulez-vous|Veux-tu|Dois-je|Est-ce que je)[\s\S]*$/i, '')
    .replace(/\n?(?:Souhaites?-tu|Voulez-vous|Veux-tu|Dois-je|Est-ce que je)[^\n]*$/i, '')
    .trim();

  if (!body) return null;
  return { to, subject: subject.slice(0, 240), text: body.slice(0, 10000) };
}

function latestDraftEmail(messages) {
  const list = Array.isArray(messages) ? messages.slice(-8) : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (String(item?.role || '').toLowerCase() !== 'assistant') continue;
    const parsed = parseDraftEmail(item?.content || item?.message || item?.text || '');
    if (parsed) return parsed;
  }
  return null;
}

module.exports = {
  isExplicitEmailSendRequest,
  normalizeEmailMailbox,
  parseDraftEmail,
  latestDraftEmail,
};
