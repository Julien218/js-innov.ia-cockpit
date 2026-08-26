const BRAND_ALIASES = Object.freeze({
  assurances: 'assurances-dour',
  'assurances-dour.be': 'assurances-dour',
  jsinnovia: 'js-innov-ia',
  cockpit: 'js-innov-ia',
  villeconnect: 'js-innov-ia',
  'immo-connect': 'js-innov-ia',
  'resto-connect': 'js-innov-ia',
  store: 'js-innov-ia',
  'jsinnovia.store': 'js-innov-ia',
  'jsinnovia.com': 'js-innov-ia',
});

const BRAND_IDENTITIES = Object.freeze({
  'js-innov-ia': {
    slug: 'js-innov-ia',
    name: 'JS-Innov.IA',
    mailbox: 'jsinnovia',
    address: () => process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com',
    replyTo: () => process.env.EMAIL_JSINNOVIA_REPLY_TO || process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com',
    textSignature: () => [
      'Julien Pagin',
      'JS-Innov.IA',
      'www.jsinnovia.com',
      process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com',
      'Dour, Belgique',
    ].join('\n'),
    htmlSignature: () => `<table role="presentation" data-jsinnovia-signature="js-innov-ia" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:collapse;font-family:Arial,sans-serif;color:#0f172a"><tr><td style="padding-left:14px;border-left:3px solid #d4af37"><strong style="font-size:17px;color:#111827">Julien Pagin</strong><br><span style="font-weight:700;color:#8b5cf6">JS-Innov.IA</span><br><a href="https://www.jsinnovia.com" style="color:#0a2a60;text-decoration:none">www.jsinnovia.com</a><br><a href="mailto:${process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com'}" style="font-size:12px;color:#52627d;text-decoration:none">${process.env.EMAIL_JSINNOVIA_ADDRESS || 'info@jsinnovia.com'}</a><span style="font-size:12px;color:#52627d"> · Dour, Belgique</span></td></tr></table>`,
  },
  'assurances-dour': {
    slug: 'assurances-dour',
    name: 'Assurances-Dour.be',
    mailbox: 'assurances',
    address: () => process.env.EMAIL_ASSURANCES_ADDRESS || 'info@assurances-dour.be',
    replyTo: () => process.env.EMAIL_ASSURANCES_REPLY_TO || process.env.EMAIL_ASSURANCES_ADDRESS || 'info@assurances-dour.be',
    textSignature: () => [
      'Assurances-Dour.be',
      "Agent d'assurances P&V",
      'Grand-Place 9, 7370 Dour',
      '0494 11 90 90',
      process.env.EMAIL_ASSURANCES_ADDRESS || 'info@assurances-dour.be',
      'https://assurances-dour.be',
    ].join('\n'),
    htmlSignature: () => `<table role="presentation" data-jsinnovia-signature="assurances-dour" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:collapse;font-family:Arial,sans-serif;color:#16324f"><tr><td style="padding-left:14px;border-left:3px solid #1f5a8a"><strong style="font-size:17px;color:#1f5a8a">Assurances-Dour.be</strong><br><span style="font-size:12px;color:#334155">Agent d'assurances P&amp;V</span><br><span style="font-size:12px;color:#334155">Grand-Place 9 · 7370 Dour · 0494 11 90 90</span><br><a href="mailto:${process.env.EMAIL_ASSURANCES_ADDRESS || 'info@assurances-dour.be'}" style="font-size:12px;color:#1f5a8a;text-decoration:none">${process.env.EMAIL_ASSURANCES_ADDRESS || 'info@assurances-dour.be'}</a><span style="font-size:12px;color:#64748b"> · </span><a href="https://assurances-dour.be" style="font-size:12px;color:#1f5a8a;text-decoration:none">assurances-dour.be</a></td></tr></table>`,
  },
});

function normalizeBrand(value) {
  const normalized = String(value || 'js-innov-ia').trim().toLowerCase();
  return BRAND_ALIASES[normalized] || normalized;
}

function identityForBrand(value) {
  const slug = normalizeBrand(value);
  const identity = BRAND_IDENTITIES[slug];
  if (!identity) throw new Error(`Identité email inconnue : ${value}`);
  return {
    slug: identity.slug,
    name: identity.name,
    mailbox: identity.mailbox,
    address: identity.address(),
    replyTo: identity.replyTo(),
    from: `"${identity.name}" <${identity.address()}>`,
    textSignature: identity.textSignature(),
    htmlSignature: identity.htmlSignature(),
  };
}

function identityForMailbox(mailbox) {
  return identityForBrand(mailbox === 'assurances' ? 'assurances-dour' : 'js-innov-ia');
}

function signatureAlreadyPresent(value) {
  return /data-jsinnovia-signature=|(?:^|\n)--\s*\n(?:Julien Pagin|Assurances-Dour\.be)/i.test(String(value || ''));
}

function applyBrandSignature({ text, html, brand, signatureHtml, signatureText } = {}) {
  const identity = identityForBrand(brand);
  const signedText = text && !signatureAlreadyPresent(text)
    ? `${String(text).trimEnd()}\n\n--\n${signatureText || identity.textSignature}`
    : text;
  const signedHtml = html && !signatureAlreadyPresent(html)
    ? `${String(html).trim()}${signatureHtml || identity.htmlSignature}`
    : html;
  return { text: signedText, html: signedHtml, identity };
}

function assertMailboxMatchesBrand(mailbox, brand) {
  const expected = identityForBrand(brand);
  const actual = identityForMailbox(mailbox);
  if (expected.slug !== actual.slug) {
    throw new Error(`Identité refusée : la boîte ${mailbox} ne correspond pas à la marque ${expected.slug}`);
  }
  return expected;
}

module.exports = {
  BRAND_IDENTITIES,
  applyBrandSignature,
  assertMailboxMatchesBrand,
  identityForBrand,
  identityForMailbox,
  normalizeBrand,
  signatureAlreadyPresent,
};
