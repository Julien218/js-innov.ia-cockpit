const crypto = require('node:crypto');

const CRM_URL = process.env.SUPABASE_CRM_URL || 'https://gfjpryakxzdzwnazlsfz.supabase.co';
const CRM_KEY = process.env.SUPABASE_CRM_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const AGENT_URL = (process.env.JSINNOVIA_AGENT_URL || process.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app').replace(/\/$/, '');
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

function clean(value, max = 20000) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function arr(value, max = 60) {
  return (Array.isArray(value) ? value : []).map(function(v){ return clean(v, 240); }).filter(Boolean).slice(0, max);
}
function jsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}
function crmHeaders() {
  if (!CRM_KEY) throw new Error('Clé Supabase CRM serveur manquante.');
  return { apikey: CRM_KEY, Authorization: 'Bearer ' + CRM_KEY, 'Content-Type': 'application/json' };
}
async function crm(path, options) {
  const response = await fetch(CRM_URL + '/rest/v1/' + path, Object.assign({}, options || {}, { headers: Object.assign({}, crmHeaders(), (options || {}).headers || {}) }));
  const body = await response.text();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch (_) { data = body; }
  if (!response.ok) throw new Error((data && (data.message || data.error)) || ('Supabase ' + response.status));
  return data;
}
function organisation(req) { return clean((req.user && req.user.organisation) || 'jsinnovia', 120) || 'jsinnovia'; }
async function one(table, id, org) {
  const rows = await crm(table + '?id=eq.' + encodeURIComponent(id) + '&organisation_id=eq.' + encodeURIComponent(org) + '&limit=1');
  return rows && rows[0] || null;
}
async function githubBible(brand) {
  const repo = clean(brand && brand.github_repository, 240);
  const filePath = clean(brand && brand.github_path, 600);
  const ref = clean((brand && brand.github_ref) || 'main', 180) || 'main';
  if (!repo || !filePath || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return { text: '', source: 'stored-profile', repository: repo || null, path: filePath || null, ref: ref, sha: null };
  }
  const endpoint = 'https://api.github.com/repos/' + repo + '/contents/' + filePath.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(ref);
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'jsinnovia-campaigns' };
  if (GITHUB_TOKEN) headers.Authorization = 'Bearer ' + GITHUB_TOKEN;
  const response = await fetch(endpoint, { headers: headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) return { text: '', source: 'github-unavailable', repository: repo, path: filePath, ref: ref, sha: null, warning: 'GitHub HTTP ' + response.status };
  const data = await response.json();
  if (data.type !== 'file' || data.encoding !== 'base64' || !data.content) {
    return { text: '', source: 'github-not-file', repository: repo, path: filePath, ref: ref, sha: data.sha || null, warning: 'La Bible ADN doit pointer vers un fichier texte ou Markdown.' };
  }
  return {
    text: Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8').slice(0, 120000),
    source: 'github', repository: repo, path: filePath, ref: ref, sha: data.sha || null, html_url: data.html_url || null
  };
}
async function loadBrandContext(brand, campaign) {
  const bible = await githubBible(brand);
  return {
    brand: {
      id: brand.id, slug: brand.slug, name: brand.name, site_url: brand.site_url, skill_key: brand.skill_key,
      tone: brand.tone, palette: jsonValue(brand.palette, {}), visual_rules: jsonValue(brand.visual_rules, {}),
      seo_keywords: arr(jsonValue(brand.seo_keywords, [])), hashtags_required: arr(jsonValue(brand.hashtags_required, [])),
      hashtags_recommended: arr(jsonValue(brand.hashtags_recommended, [])), hashtags_forbidden: arr(jsonValue(brand.hashtags_forbidden, [])),
      brand_board_url: brand.brand_board_url || null, image_provider: brand.image_provider || 'base44',
      video_engine: brand.video_engine || 'auto', local_workflow_id: brand.local_workflow_id || '',
      api_provider: brand.api_provider || 'xai', fallback_to_api: brand.fallback_to_api === true
    },
    campaign: campaign ? {
      id: campaign.id, name: campaign.name, objective: campaign.objective, phase: campaign.phase,
      cta: campaign.cta, landing_url: campaign.landing_url, channels: jsonValue(campaign.channels, [])
    } : null,
    bible: bible
  };
}
function brandPrompt(context, brief, kind) {
  const b = context.brand;
  const rules = b.visual_rules || {};
  const required = arr(rules.must || rules.required || []);
  const forbidden = arr(rules.avoid || rules.forbidden || []);
  const parts = [
    'MARQUE : ' + b.name,
    b.site_url ? 'SITE : ' + b.site_url : '',
    b.tone ? 'TON : ' + b.tone : '',
    Object.keys(b.palette || {}).length ? 'PALETTE : ' + JSON.stringify(b.palette) : '',
    required.length ? 'OBLIGATOIRE : ' + required.join(' ; ') : '',
    forbidden.length ? 'INTERDIT : ' + forbidden.join(' ; ') : '',
    context.bible && context.bible.text ? 'BIBLE ADN CANONIQUE (prioritaire) :\n' + context.bible.text : '',
    b.brand_board_url ? 'PLANCHE ADN : ' + b.brand_board_url : '',
    context.campaign ? 'CAMPAGNE : ' + context.campaign.name + ' — objectif : ' + (context.campaign.objective || 'non précisé') + ' — phase : ' + (context.campaign.phase || 'préparation') : '',
    'DEMANDE : ' + clean(brief, 12000),
    kind === 'video'
      ? 'SORTIE VIDÉO : animer l’image validée sans modifier identité, personnages, logos ou proportions. Aucun texte inventé.'
      : 'SORTIE IMAGE : composition premium, mobile-first, aucun faux logo ni texte illisible. Respect strict des références et de la Bible ADN.'
  ];
  return parts.filter(Boolean).join('\n\n').slice(0, 24000);
}
function extractJson(value) {
  const text = String(value || '').trim();
  const fenced = (text.match(/```(?:json)?\s*([\s\S]*?)```/i) || [])[1];
  for (const candidate of [fenced, text]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch (_) {}
    const a = candidate.indexOf('{'), b = candidate.lastIndexOf('}');
    if (a >= 0 && b > a) try { return JSON.parse(candidate.slice(a, b + 1)); } catch (_) {}
  }
  return null;
}
function normalizeDraft(raw, context) {
  const forbidden = new Set(context.brand.hashtags_forbidden.map(function(h){ return h.toLowerCase(); }));
  const required = context.brand.hashtags_required;
  const tags = function(value) {
    return Array.from(new Set(required.concat(arr(value, 30)))).filter(function(tag){ return !forbidden.has(tag.toLowerCase()); }).slice(0, 20);
  };
  const h = raw.hashtags || {};
  return {
    title: clean(raw.title || 'Contenu campagne', 180),
    copy: {
      facebook: clean(raw.facebook || (raw.copy && raw.copy.facebook), 8000),
      instagram: clean(raw.instagram || (raw.copy && raw.copy.instagram), 6000),
      tiktok: {
        hook: clean(raw.tiktok && raw.tiktok.hook, 500),
        caption: clean(raw.tiktok && raw.tiktok.caption, 3000),
        text_screen: clean(raw.tiktok && raw.tiktok.text_screen, 1000)
      },
      stories: arr(raw.stories || (raw.copy && raw.copy.stories), 8)
    },
    seo: {
      primary_keyword: clean(raw.primary_keyword || (raw.seo && raw.seo.primary_keyword), 180),
      secondary_keywords: arr(raw.secondary_keywords || (raw.seo && raw.seo.secondary_keywords), 20),
      alt_text: clean(raw.alt_text || (raw.seo && raw.seo.alt_text), 700),
      filename: clean(raw.filename || (raw.seo && raw.seo.filename), 220)
    },
    hashtags: { facebook: tags(h.facebook), instagram: tags(h.instagram), tiktok: tags(h.tiktok) },
    image_prompt: clean(raw.image_prompt, 24000),
    video_prompt: clean(raw.video_prompt, 24000),
    cta: clean(raw.cta || (context.campaign && context.campaign.cta), 500)
  };
}
async function draftWithElynea(context, brief, platforms) {
  if (!AGENT_KEY) throw new Error('Elynea serveur indisponible : clé Agent manquante.');
  const policy = 'Tu es Elynea, Digital Campaign Manager du Cockpit. Respecte strictement la Bible ADN. Optimise SEO/social search. Conserve les hashtags obligatoires et exclue les interdits. Adapte Facebook, Instagram et TikTok. N invente aucune date, partenaire ou statistique. Retourne uniquement JSON: title, facebook, instagram, tiktok{hook,caption,text_screen}, stories[], primary_keyword, secondary_keywords[], hashtags{facebook[],instagram[],tiktok[]}, alt_text, filename, image_prompt, video_prompt, cta.';
  const safeContext = Object.assign({}, context, { bible: Object.assign({}, context.bible, { text: (context.bible.text || '').slice(0, 50000) }) });
  const message = 'BRIEF : ' + clean(brief, 12000) + '\n\nPLATEFORMES : ' + arr(platforms, 8).join(', ') + '\n\nCONTEXTE : ' + JSON.stringify(safeContext) + '\n\nRéponds uniquement en JSON.';
  const response = await fetch(AGENT_URL + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY, 'x-organisation-id': 'jsinnovia' },
    body: JSON.stringify({ message: message, server_context: policy, assistant_mode: 'internal', session_id: 'campaign-' + crypto.randomUUID(), user_context: { role: 'admin', organisation: 'jsinnovia', module: 'campaigns' } }),
    signal: AbortSignal.timeout(90000)
  });
  const data = await response.json().catch(function(){ return {}; });
  if (!response.ok) throw new Error(data.error || ('Elynea HTTP ' + response.status));
  const parsed = extractJson(data.response || data.reply || data.message);
  if (!parsed) throw new Error('Pack Elynea non exploitable.');
  const result = normalizeDraft(parsed, context);
  if (!result.image_prompt) result.image_prompt = brandPrompt(context, brief, 'image');
  if (!result.video_prompt) result.video_prompt = brandPrompt(context, brief, 'video');
  return result;
}
function normalizeBrand(body, org) {
  return {
    organisation_id: org,
    slug: clean(body.slug, 120).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''),
    name: clean(body.name, 180), site_url: clean(body.site_url, 500) || null, skill_key: clean(body.skill_key, 120) || null,
    github_repository: clean(body.github_repository, 240) || null, github_path: clean(body.github_path, 600) || null,
    github_ref: clean(body.github_ref || 'main', 180) || 'main', brand_board_url: clean(body.brand_board_url, 1000) || null,
    tone: clean(body.tone, 1000) || null, palette: jsonValue(body.palette, {}), visual_rules: jsonValue(body.visual_rules, {}),
    seo_keywords: arr(jsonValue(body.seo_keywords, [])), hashtags_required: arr(jsonValue(body.hashtags_required, [])),
    hashtags_recommended: arr(jsonValue(body.hashtags_recommended, [])), hashtags_forbidden: arr(jsonValue(body.hashtags_forbidden, [])),
    image_provider: clean(body.image_provider || 'base44', 60), video_engine: ['auto','local','api'].includes(body.video_engine) ? body.video_engine : 'auto',
    local_workflow_id: clean(body.local_workflow_id, 180) || null, api_provider: clean(body.api_provider || 'xai', 60),
    fallback_to_api: body.fallback_to_api === true, active: body.active !== false, metadata: jsonValue(body.metadata, {}), updated_at: new Date().toISOString()
  };
}

module.exports = { clean, arr, jsonValue, crm, organisation, one, loadBrandContext, brandPrompt, draftWithElynea, normalizeBrand, normalizeDraft };
