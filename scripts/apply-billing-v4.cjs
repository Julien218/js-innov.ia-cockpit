const fs = require('fs');

function patchBilling() {
  const path = 'server-billing.cjs';
  let s = fs.readFileSync(path, 'utf8');
  const anchor = "const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';\n";
  const insert = `const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';
const BILLING_PDF_VERSION = 'official-v4-dynamic';
const COMMERCIAL_HIGHLIGHT_URL = process.env.JSINNOVIA_COMMERCIAL_HIGHLIGHT_URL || 'https://www.jsinnovia.com/commercial-highlight.json';
let commercialHighlightCache = { expiresAt: 0, value: null };

async function fetchCommercialHighlight() {
  const now = Date.now();
  if (commercialHighlightCache.expiresAt > now) return commercialHighlightCache.value;
  try {
    const response = await fetch(COMMERCIAL_HIGHLIGHT_URL, { signal: AbortSignal.timeout(2500), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(\`highlight \${response.status}\`);
    const payload = await response.json();
    const highlights = Array.isArray(payload.highlights) ? payload.highlights : [];
    const active = highlights.filter((item) => item && item.active === true && (!item.publishedAt || Date.parse(item.publishedAt) <= now)).sort((a,b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))[0] || null;
    const value = active ? {
      id: String(active.id || '').slice(0,80), eyebrow: String(active.eyebrow || 'NOUVEAUTÉ JS-Innov.IA').slice(0,80),
      title: String(active.title || '').slice(0,100), description: String(active.description || '').slice(0,240),
      cta: String(active.cta || 'Découvrir').slice(0,60), url: /^https:\\/\\//i.test(String(active.url || '')) ? String(active.url).slice(0,240) : '', publishedAt: active.publishedAt || null,
    } : null;
    commercialHighlightCache = { expiresAt: now + 600000, value };
    return value;
  } catch (error) {
    console.warn(\`[BILLING] Nouveauté commerciale indisponible: \${error.message}\`);
    commercialHighlightCache = { expiresAt: now + 60000, value: null };
    return null;
  }
}
`;
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
  let s = fs.readFileSync(path, 'utf8');
  if (s.includes('const promo=doc.commercial_highlight;')) return;
  const old = `  const footerY=770;
  line(pdf,105,footerY,165,footerY,C.gold2,.65);
  line(pdf,430,footerY,490,footerY,C.gold2,.65);
  text(pdf,"L’INTELLIGENCE AU SERVICE DE VOS AMBITIONS",170,footerY-5,{size:6.4,font:'Helvetica',color:C.ink,width:255,align:'center',characterSpacing:1.15});
  text(pdf,'www.jsinnovia.com  •  info@jsinnovia.store',M,footerY+24,{size:6.2,color:C.muted,width:W,align:'center'});
`;
  const next = `  const footerY=754;
  const promo=doc.commercial_highlight;
  if(promo && promo.title){
    pdf.save().fillColor('#FBF7EF').roundedRect(M,footerY,W,49,4).fill().restore();
    box(pdf,M,footerY,W,49,4,C.line,.55);
    text(pdf,promo.eyebrow||'NOUVEAUTÉ JS-Innov.IA',M+12,footerY+7,{size:5.8,font:'Helvetica-Bold',color:C.gold2,width:120});
    text(pdf,promo.title,M+12,footerY+18,{size:8.2,font:'Helvetica-Bold',color:C.ink,width:185,height:12,ellipsis:true});
    text(pdf,promo.description||'',M+205,footerY+9,{size:6.1,color:C.text,width:235,height:28,ellipsis:true,lineGap:1.2});
    text(pdf,promo.cta||'Découvrir',M+449,footerY+12,{size:6.2,font:'Helvetica-Bold',color:C.gold2,width:82,align:'right'});
    if(promo.url) text(pdf,promo.url.replace(/^https?:\\/\\//,'').replace(/\\/$/,''),M+410,footerY+27,{size:5.5,color:C.muted,width:121,align:'right',height:10,ellipsis:true});
  } else {
    line(pdf,105,footerY+18,165,footerY+18,C.gold2,.65); line(pdf,430,footerY+18,490,footerY+18,C.gold2,.65);
    text(pdf,"L’INTELLIGENCE AU SERVICE DE VOS AMBITIONS",170,footerY+13,{size:6.4,font:'Helvetica',color:C.ink,width:255,align:'center',characterSpacing:1.15});
  }
  text(pdf,'www.jsinnovia.com  •  info@jsinnovia.store',M,815,{size:6.2,color:C.muted,width:W,align:'center'});
`;
  if (!s.includes(old)) throw new Error('footer anchor missing');
  fs.writeFileSync(path, s.replace(old, next));
}

patchBilling();
patchTemplate();
console.log('Billing v4 dynamic patch applied.');
