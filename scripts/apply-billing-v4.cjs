const fs = require('fs');

function patchBilling() {
  const path = 'server-billing.cjs';
  let s = fs.readFileSync(path, 'utf8');
  const anchor = "const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';\n";
  const insert = [
    "const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';",
    "const BILLING_PDF_VERSION = 'official-v4-dynamic';",
    "const COMMERCIAL_HIGHLIGHT_URL = process.env.JSINNOVIA_COMMERCIAL_HIGHLIGHT_URL || 'https://www.jsinnovia.com/commercial-highlight.json';",
    "let commercialHighlightCache = { expiresAt: 0, value: null };",
    '',
    'async function fetchCommercialHighlight() {',
    '  const now = Date.now();',
    '  if (commercialHighlightCache.expiresAt > now) return commercialHighlightCache.value;',
    '  try {',
    "    const response = await fetch(COMMERCIAL_HIGHLIGHT_URL, { signal: AbortSignal.timeout(2500), headers: { Accept: 'application/json' } });",
    "    if (!response.ok) throw new Error('highlight ' + response.status);",
    '    const payload = await response.json();',
    '    const highlights = Array.isArray(payload.highlights) ? payload.highlights : [];',
    '    const active = highlights.filter((item) => item && item.active === true && (!item.publishedAt || Date.parse(item.publishedAt) <= now)).sort((a,b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))[0] || null;',
    '    const value = active ? {',
    "      id: String(active.id || '').slice(0,80), eyebrow: String(active.eyebrow || 'NOUVEAUTÉ JS-Innov.IA').slice(0,80),",
    "      title: String(active.title || '').slice(0,100), description: String(active.description || '').slice(0,240),",
    "      cta: String(active.cta || 'Découvrir').slice(0,60), url: /^https:\\/\\//i.test(String(active.url || '')) ? String(active.url).slice(0,240) : '', publishedAt: active.publishedAt || null,",
    '    } : null;',
    '    commercialHighlightCache = { expiresAt: now + 600000, value };',
    '    return value;',
    '  } catch (error) {',
    "    console.warn('[BILLING] Nouveauté commerciale indisponible: ' + error.message);",
    '    commercialHighlightCache = { expiresAt: now + 60000, value: null };',
    '    return null;',
    '  }',
    '}',
    '',
  ].join('\n');

  if (!s.includes('BILLING_PDF_VERSION')) {
    if (!s.includes(anchor)) throw new Error('AGENT_KEY anchor missing');
    s = s.replace(anchor, insert);
  }

  s = s.replace("doc.pdf_version === 'official-v3-legal'", 'doc.pdf_version === BILLING_PDF_VERSION');
  const target = 'const task = (async () => {\n    const pdf = await generateInvoicePDF(doc, type);';
  if (!s.includes('doc.commercial_highlight = await fetchCommercialHighlight();')) {
    if (!s.includes(target)) throw new Error('generation anchor missing');
    s = s.replace(target, 'const task = (async () => {\n    doc.commercial_highlight = await fetchCommercialHighlight();\n    const pdf = await generateInvoicePDF(doc, type);');
  }
  s = s.replace("source: 'billing-official-v3-legal'", 'source: `billing-${BILLING_PDF_VERSION}`');
  s = s.replace("version: 'official-v3-legal'", 'version: BILLING_PDF_VERSION');
  s = s.replace("pdf_version: 'official-v3-legal'", 'pdf_version: BILLING_PDF_VERSION');
  fs.writeFileSync(path, s);
}

function patchTemplate() {
  const path = 'server-billing-template.cjs';
  const s = fs.readFileSync(path, 'utf8');

  // Le modèle actuel intègre déjà nativement le flux commercial dynamique.
  if (s.includes('resolveCommercialHighlight') && s.includes('drawLaunchFooter') && s.includes('commercial_highlight')) return;

  throw new Error('Le gabarit PDF ne contient pas le support dynamique attendu.');
}

patchBilling();
patchTemplate();
console.log('Billing v4 dynamic patch applied.');
