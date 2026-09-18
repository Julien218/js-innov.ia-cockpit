const express = require('express');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const net = require('node:net');
const {
  ensureFolderTree,
  uploadFile,
} = require('./server-dropbox-helper.cjs');

const router = express.Router();
const publicRouter = express.Router();

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const DROPBOX_SOCIAL_ROOT = String(process.env.DROPBOX_SOCIAL_ROOT || '/Cockpit/SocialCommand').replace(/\/$/, '');
const SOCIAL_PUBLISH_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.SOCIAL_PUBLISH_ENABLED || 'false'));
const SOCIAL_BACKUP_SECRET = String(process.env.SOCIAL_BACKUP_ENCRYPTION_KEY || '');
const SOCIAL_TRACKING_KEY = String(process.env.SOCIAL_TRACKING_KEY || '');
const SOCIAL_SCHEDULER_INTERVAL_MS = Math.max(60_000, Number(process.env.SOCIAL_SCHEDULER_INTERVAL_MS || 60_000));
const SOCIAL_BACKUP_INTERVAL_MS = Math.max(60 * 60_000, Number(process.env.SOCIAL_BACKUP_INTERVAL_MS || 24 * 60 * 60_000));
const ALLOWED_PLATFORMS = new Set(['facebook', 'instagram', 'tiktok']);
const ALLOWED_AUTONOMY = new Set(['assisted', 'semi_auto', 'autopilot']);
const ALLOWED_POST_STATUS = new Set(['draft','generating','ready','awaiting_review','approved','scheduled','publishing','published','retrying','failed','rejected','cancelled','expired']);

const schedulerState = {
  publisher: { running: false, last_started_at: null, last_finished_at: null, last_error: null, last_result: null },
  backup: { running: false, last_started_at: null, last_finished_at: null, last_error: null, last_result: null },
};

function requireConfiguration() {
  if (!SUPABASE_KEY) {
    const error = new Error('Supabase service role non configuré pour Social Command.');
    error.status = 503;
    throw error;
  }
}

function asText(value, fallback = null, max = 20_000) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text ? text.slice(0, max) : fallback;
}

function asJson(value, fallback) {
  if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'brand';
}

function actor(req) {
  return String(req.user?.id || req.user?.email || 'cockpit').slice(0, 240);
}

function tenantId(req) {
  return slugify(req.user?.organisation || 'jsinnovia').replace(/-/g, '_');
}

function safeId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,180}$/.test(id) ? id : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function cleanChannels(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => String(item || '').toLowerCase()).filter((item) => ALLOWED_PLATFORMS.has(item)))];
}

async function supabaseRequest(table, { method = 'GET', query = '', body, prefer } = {}) {
  requireConfiguration();
  const endpoint = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}${query ? `?${query}` : ''}`;
  const response = await fetch(endpoint, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const message = typeof data === 'object' && data ? data.message || data.error || data.details : data;
    const error = new Error(`Social Command DB ${response.status}${message ? ` : ${String(message).slice(0, 300)}` : ''}`);
    error.status = response.status >= 500 ? 502 : response.status;
    throw error;
  }
  return data;
}

async function listTenantRows(table, tenant, { order = 'created_at.desc', limit = 250, filters = {} } = {}) {
  const query = new URLSearchParams({ select: '*', tenant_id: `eq.${tenant}`, order, limit: String(limit) });
  for (const [field, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(field, `eq.${String(value)}`);
  }
  const rows = await supabaseRequest(table, { query: query.toString() });
  return Array.isArray(rows) ? rows : [];
}

async function findTenantRow(table, tenant, id) {
  if (!isUuid(id)) return null;
  const query = new URLSearchParams({ select: '*', tenant_id: `eq.${tenant}`, id: `eq.${id}`, limit: '1' });
  const rows = await supabaseRequest(table, { query: query.toString() });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function insertRow(table, payload) {
  const rows = await supabaseRequest(table, { method: 'POST', body: payload, prefer: 'return=representation' });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function patchTenantRow(table, tenant, id, payload) {
  const query = new URLSearchParams({ tenant_id: `eq.${tenant}`, id: `eq.${id}` });
  const rows = await supabaseRequest(table, { method: 'PATCH', query: query.toString(), body: payload, prefer: 'return=representation' });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

function sendError(res, error) {
  console.error('[social-command]', error?.message || error);
  return res.status(error?.status || 502).json({ error: error?.message || 'Erreur Social Command.' });
}

function publicWebUrl(input) {
  let parsed;
  try { parsed = new URL(String(input || '')); } catch { return null; }
  if (!['https:', 'http:'].includes(parsed.protocol)) return null;
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) return null;
  if (net.isIP(hostname)) {
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && (parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31))) return null;
  }
  parsed.hash = '';
  return parsed;
}

function absoluteUrl(base, candidate) {
  if (!candidate) return null;
  try { return new URL(candidate, base).toString(); } catch { return null; }
}

function unique(values, limit = 24) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function extractMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractLink(html, relPattern) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  for (const tag of links) {
    const rel = tag.match(/rel=["']([^"']+)["']/i)?.[1] || '';
    if (!relPattern.test(rel)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) return href;
  }
  return null;
}

function extractVisualManifest(html, sourceUrl, headers = {}) {
  const cssVariables = {};
  for (const match of html.matchAll(/(--[a-z0-9_-]+)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^;]+\)|hsla?\([^;]+\))/gi)) {
    if (Object.keys(cssVariables).length >= 40) break;
    cssVariables[match[1]] = match[2].trim();
  }
  const colorCounts = new Map();
  for (const match of html.matchAll(/#[0-9a-f]{6}\b/gi)) {
    const color = match[0].toLowerCase();
    colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
  }
  const colors = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color).slice(0, 16);
  const fontFamilies = unique([...html.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map((m) => m[1].replace(/["']/g, '').trim()), 12);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || null;
  const themeColor = extractMeta(html, 'theme-color');
  const socialImage = extractMeta(html, 'og:image');
  const favicon = extractLink(html, /(?:^|\s)(?:icon|shortcut icon)(?:\s|$)/i);
  const manifest = {
    schema_version: 1,
    source: 'site-html',
    canonical_url: sourceUrl,
    source_title: title,
    theme_color: themeColor,
    colors: unique([themeColor, ...colors], 18),
    css_variables: cssVariables,
    font_families: fontFamilies,
    favicon: absoluteUrl(sourceUrl, favicon),
    social_image: absoluteUrl(sourceUrl, socialImage),
    visual_rules: {
      source_of_truth: 'dedicated_site',
      instruction: 'Toute création Social Command doit respecter cette identité et les assets validés de la marque.',
    },
    source_etag: headers.etag || null,
    source_last_modified: headers.lastModified || null,
    synced_at: new Date().toISOString(),
  };
  return manifest;
}

async function fetchBrandManifest(canonicalUrl) {
  const parsed = publicWebUrl(canonicalUrl);
  if (!parsed) {
    const error = new Error('URL de site dédiée invalide ou non publique.');
    error.status = 400;
    throw error;
  }
  const origin = parsed.origin;
  const candidates = [
    `${origin}/.well-known/jsinnovia-brand.json`,
    `${origin}/brand-manifest.json`,
  ];
  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'JS-InnovIA-SocialCommand/1.0' }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) continue;
      const contentType = String(response.headers.get('content-type') || '');
      if (!contentType.includes('json')) continue;
      const json = await response.json();
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        return {
          ...json,
          schema_version: Number(json.schema_version || 1),
          source: 'site-brand-manifest',
          canonical_url: canonicalUrl,
          synced_at: new Date().toISOString(),
        };
      }
    } catch { /* fallback HTML */ }
  }

  const response = await fetch(parsed.toString(), {
    headers: { 'User-Agent': 'JS-InnovIA-SocialCommand/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = new Error(`Site dédié inaccessible (HTTP ${response.status}).`);
    error.status = 502;
    throw error;
  }
  const html = (await response.text()).slice(0, 1_000_000);
  return extractVisualManifest(html, parsed.toString(), {
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  });
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function mirrorJson(path, value) {
  try {
    const folder = path.split('/').slice(0, -1).join('/') || '/';
    const ensured = await ensureFolderTree(folder);
    if (ensured?.error) return { ok: false, error: ensured.error };
    const uploaded = await uploadFile(path, Buffer.from(JSON.stringify(value, null, 2), 'utf8'));
    if (uploaded?.error) return { ok: false, error: uploaded.error };
    return { ok: true, path: uploaded.path || path };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function brandPayload(body = {}, req, partial = false) {
  const output = {};
  if (!partial || Object.hasOwn(body, 'name')) output.name = asText(body.name, null, 180);
  if (!partial || Object.hasOwn(body, 'project_id')) output.project_id = asText(body.project_id, null, 180);
  if (!partial || Object.hasOwn(body, 'client_id')) output.client_id = asText(body.client_id, null, 180);
  if (!partial || Object.hasOwn(body, 'canonical_url')) {
    const parsed = publicWebUrl(body.canonical_url);
    if (!parsed) {
      const error = new Error('Le site dédié doit être une URL HTTP(S) publique.');
      error.status = 400;
      throw error;
    }
    output.canonical_url = parsed.toString();
  }
  if (!partial) {
    if (!output.name || !output.canonical_url) {
      const error = new Error('Nom et site dédié sont obligatoires.');
      error.status = 400;
      throw error;
    }
    output.tenant_id = tenantId(req);
    output.slug = slugify(output.name);
    output.created_by = actor(req);
  }
  output.updated_at = new Date().toISOString();
  return output;
}

function campaignPayload(body = {}, req, partial = false) {
  const output = {};
  const textFields = ['project_id','client_id','name','objective','audience','landing_url','brief','status'];
  for (const field of textFields) if (!partial || Object.hasOwn(body, field)) output[field] = asText(body[field], null, field === 'brief' ? 40_000 : 4000);
  if (!partial || Object.hasOwn(body, 'brand_id')) output.brand_id = isUuid(body.brand_id) ? body.brand_id : null;
  if (!partial || Object.hasOwn(body, 'channels')) output.channels = cleanChannels(body.channels);
  if (!partial || Object.hasOwn(body, 'autonomy_mode')) output.autonomy_mode = ALLOWED_AUTONOMY.has(body.autonomy_mode) ? body.autonomy_mode : 'assisted';
  if (!partial || Object.hasOwn(body, 'start_at')) output.start_at = body.start_at || null;
  if (!partial || Object.hasOwn(body, 'end_at')) output.end_at = body.end_at || null;
  if (!partial || Object.hasOwn(body, 'metadata')) output.metadata = asJson(body.metadata, {});
  if (!partial) {
    if (!output.name || !output.brand_id) {
      const error = new Error('Nom de campagne et marque sont obligatoires.');
      error.status = 400;
      throw error;
    }
    output.tenant_id = tenantId(req);
    output.status = output.status || 'draft';
    output.created_by = actor(req);
  }
  output.updated_at = new Date().toISOString();
  return output;
}

function trackingUrl(targetUrl, { platform, campaignId, postId }) {
  if (!targetUrl) return null;
  try {
    const url = new URL(targetUrl);
    url.searchParams.set('utm_source', platform);
    url.searchParams.set('utm_medium', 'social');
    url.searchParams.set('utm_campaign', campaignId);
    url.searchParams.set('jsi_campaign_id', campaignId);
    url.searchParams.set('jsi_post_id', postId);
    return url.toString();
  } catch { return targetUrl; }
}

function postPayload(body = {}, req, partial = false) {
  const output = {};
  if (!partial || Object.hasOwn(body, 'brand_id')) output.brand_id = isUuid(body.brand_id) ? body.brand_id : null;
  if (!partial || Object.hasOwn(body, 'campaign_id')) output.campaign_id = isUuid(body.campaign_id) ? body.campaign_id : null;
  if (!partial || Object.hasOwn(body, 'account_id')) output.account_id = isUuid(body.account_id) ? body.account_id : null;
  if (!partial || Object.hasOwn(body, 'platform')) output.platform = ALLOWED_PLATFORMS.has(body.platform) ? body.platform : null;
  const textFields = ['project_id','client_id','title','caption','cta_text','target_url','ai_reason','provider_status'];
  for (const field of textFields) if (!partial || Object.hasOwn(body, field)) output[field] = asText(body[field], null, field === 'caption' || field === 'ai_reason' ? 20_000 : 4000);
  if (!partial || Object.hasOwn(body, 'hashtags')) output.hashtags = Array.isArray(body.hashtags) ? body.hashtags.map((v) => asText(v, null, 120)).filter(Boolean).slice(0, 40) : [];
  if (!partial || Object.hasOwn(body, 'asset_ids')) output.asset_ids = Array.isArray(body.asset_ids) ? body.asset_ids.filter(isUuid).slice(0, 20) : [];
  if (!partial || Object.hasOwn(body, 'utm')) output.utm = asJson(body.utm, {});
  if (!partial || Object.hasOwn(body, 'metadata')) output.metadata = asJson(body.metadata, {});
  if (!partial || Object.hasOwn(body, 'status')) output.status = ALLOWED_POST_STATUS.has(body.status) ? body.status : 'draft';
  if (!partial) {
    if (!output.brand_id || !output.campaign_id || !output.platform) {
      const error = new Error('Marque, campagne et plateforme sont obligatoires.');
      error.status = 400;
      throw error;
    }
    output.tenant_id = tenantId(req);
    output.created_by = actor(req);
    output.status = output.status || 'draft';
    output.idempotency_key = asText(body.idempotency_key, null, 240) || `social:${output.campaign_id}:${output.platform}:${crypto.randomUUID()}`;
  }
  output.updated_at = new Date().toISOString();
  return output;
}

async function snapshotCampaign(tenant, campaign) {
  const brand = await findTenantRow('social_brands', tenant, campaign.brand_id);
  const posts = await listTenantRows('social_posts', tenant, { filters: { campaign_id: campaign.id }, order: 'created_at.asc', limit: 1000 });
  const payload = { schema_version: 1, exported_at: new Date().toISOString(), brand, campaign, posts };
  const path = `${DROPBOX_SOCIAL_ROOT}/Campaigns/${slugify(brand?.name || 'brand')}/${slugify(campaign.name)}/campaign.json`;
  const mirrored = await mirrorJson(path, payload);
  return mirrored.ok ? mirrored.path : null;
}

router.get('/status', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const brands = await listTenantRows('social_brands', tenant, { limit: 1 });
    return res.json({
      ok: true,
      tenant_id: tenant,
      database_ready: true,
      brands_detected: brands.length,
      publish_enabled: SOCIAL_PUBLISH_ENABLED,
      dropbox_configured: Boolean(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN),
      encrypted_backup_configured: Boolean(SOCIAL_BACKUP_SECRET),
      providers: {
        meta: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
        tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
      },
      scheduler: schedulerState,
    });
  } catch (error) { return sendError(res, error); }
});

router.get('/overview', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const [brands, campaigns, posts, accounts, conversions] = await Promise.all([
      listTenantRows('social_brands', tenant),
      listTenantRows('social_campaigns', tenant),
      listTenantRows('social_posts', tenant),
      listTenantRows('social_accounts', tenant),
      listTenantRows('social_conversions', tenant, { limit: 1000 }),
    ]);
    const byPlatform = {};
    for (const platform of ALLOWED_PLATFORMS) {
      const platformPosts = posts.filter((post) => post.platform === platform);
      byPlatform[platform] = {
        total: platformPosts.length,
        scheduled: platformPosts.filter((post) => post.status === 'scheduled').length,
        published: platformPosts.filter((post) => post.status === 'published').length,
        failed: platformPosts.filter((post) => post.status === 'failed').length,
        conversions: conversions.filter((row) => row.source === platform).length,
      };
    }
    return res.json({
      brands: brands.length,
      campaigns: campaigns.length,
      active_campaigns: campaigns.filter((row) => row.status === 'active').length,
      posts: posts.length,
      awaiting_review: posts.filter((row) => ['ready','awaiting_review'].includes(row.status)).length,
      scheduled: posts.filter((row) => row.status === 'scheduled').length,
      published: posts.filter((row) => row.status === 'published').length,
      conversions: conversions.length,
      connected_accounts: accounts.filter((row) => row.connection_status === 'connected').length,
      by_platform: byPlatform,
    });
  } catch (error) { return sendError(res, error); }
});

router.get('/brands', async (req, res) => {
  try { return res.json(await listTenantRows('social_brands', tenantId(req), { order: 'updated_at.desc' })); }
  catch (error) { return sendError(res, error); }
});

router.post('/brands', async (req, res) => {
  try {
    const row = await insertRow('social_brands', brandPayload(req.body, req));
    return res.status(201).json(row);
  } catch (error) { return sendError(res, error); }
});

router.patch('/brands/:id', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const existing = await findTenantRow('social_brands', tenant, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Marque introuvable.' });
    const row = await patchTenantRow('social_brands', tenant, existing.id, brandPayload(req.body, req, true));
    return res.json(row);
  } catch (error) { return sendError(res, error); }
});

router.post('/brands/:id/sync', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const brand = await findTenantRow('social_brands', tenant, req.params.id);
    if (!brand) return res.status(404).json({ error: 'Marque introuvable.' });
    const manifest = await fetchBrandManifest(brand.canonical_url);
    const hash = fingerprint(manifest);
    const version = hash === brand.source_fingerprint ? Number(brand.manifest_version || 1) : Number(brand.manifest_version || 1) + 1;
    const dropboxPath = `${DROPBOX_SOCIAL_ROOT}/Brands/${slugify(brand.name)}/brand-manifest.v${version}.json`;
    const mirror = await mirrorJson(dropboxPath, manifest);
    const updated = await patchTenantRow('social_brands', tenant, brand.id, {
      manifest,
      manifest_version: version,
      source_fingerprint: hash,
      last_synced_at: new Date().toISOString(),
      dropbox_path: mirror.ok ? mirror.path : brand.dropbox_path,
      updated_at: new Date().toISOString(),
    });
    return res.json({ brand: updated, dropbox: mirror, changed: hash !== brand.source_fingerprint });
  } catch (error) { return sendError(res, error); }
});

router.get('/campaigns', async (req, res) => {
  try { return res.json(await listTenantRows('social_campaigns', tenantId(req), { order: 'updated_at.desc' })); }
  catch (error) { return sendError(res, error); }
});

router.post('/campaigns', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const payload = campaignPayload(req.body, req);
    const brand = await findTenantRow('social_brands', tenant, payload.brand_id);
    if (!brand) return res.status(400).json({ error: 'La marque sélectionnée n’appartient pas à ce tenant.' });
    const row = await insertRow('social_campaigns', payload);
    const dropboxPath = await snapshotCampaign(tenant, row);
    if (dropboxPath) await patchTenantRow('social_campaigns', tenant, row.id, { dropbox_path: dropboxPath });
    return res.status(201).json({ ...row, dropbox_path: dropboxPath || row.dropbox_path });
  } catch (error) { return sendError(res, error); }
});

router.patch('/campaigns/:id', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const existing = await findTenantRow('social_campaigns', tenant, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Campagne introuvable.' });
    const row = await patchTenantRow('social_campaigns', tenant, existing.id, campaignPayload(req.body, req, true));
    void snapshotCampaign(tenant, row).catch((error) => console.warn('[social-command] Dropbox campaign mirror:', error.message));
    return res.json(row);
  } catch (error) { return sendError(res, error); }
});

router.get('/posts', async (req, res) => {
  try {
    const filters = {};
    if (req.query.campaign_id && isUuid(req.query.campaign_id)) filters.campaign_id = req.query.campaign_id;
    if (req.query.platform && ALLOWED_PLATFORMS.has(req.query.platform)) filters.platform = req.query.platform;
    return res.json(await listTenantRows('social_posts', tenantId(req), { order: 'created_at.desc', limit: 500, filters }));
  } catch (error) { return sendError(res, error); }
});

router.post('/posts', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const payload = postPayload(req.body, req);
    const [brand, campaign] = await Promise.all([
      findTenantRow('social_brands', tenant, payload.brand_id),
      findTenantRow('social_campaigns', tenant, payload.campaign_id),
    ]);
    if (!brand || !campaign || campaign.brand_id !== brand.id) return res.status(400).json({ error: 'Marque ou campagne incohérente.' });
    const id = crypto.randomUUID();
    payload.id = id;
    payload.target_url = payload.target_url || campaign.landing_url || null;
    payload.tracking_url = trackingUrl(payload.target_url, { platform: payload.platform, campaignId: campaign.id, postId: id });
    const row = await insertRow('social_posts', payload);
    void snapshotCampaign(tenant, campaign).catch(() => null);
    return res.status(201).json(row);
  } catch (error) { return sendError(res, error); }
});

router.patch('/posts/:id', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const existing = await findTenantRow('social_posts', tenant, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Publication introuvable.' });
    const row = await patchTenantRow('social_posts', tenant, existing.id, postPayload(req.body, req, true));
    return res.json(row);
  } catch (error) { return sendError(res, error); }
});

router.post('/posts/:id/approve', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const post = await findTenantRow('social_posts', tenant, req.params.id);
    if (!post) return res.status(404).json({ error: 'Publication introuvable.' });
    if (['published','cancelled'].includes(post.status)) return res.status(409).json({ error: 'Publication déjà finalisée.' });
    const row = await patchTenantRow('social_posts', tenant, post.id, {
      status: 'approved',
      approval: { approved: true, approved_by: actor(req), approved_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
    return res.json(row);
  } catch (error) { return sendError(res, error); }
});

router.post('/posts/:id/schedule', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const post = await findTenantRow('social_posts', tenant, req.params.id);
    if (!post) return res.status(404).json({ error: 'Publication introuvable.' });
    if (post.status !== 'approved') return res.status(409).json({ error: 'Validation humaine requise avant programmation.' });
    const scheduledAt = new Date(req.body?.scheduled_at || '');
    if (!Number.isFinite(scheduledAt.getTime())) return res.status(400).json({ error: 'Date de programmation invalide.' });
    const row = await patchTenantRow('social_posts', tenant, post.id, { status: 'scheduled', scheduled_at: scheduledAt.toISOString(), updated_at: new Date().toISOString() });
    return res.json(row);
  } catch (error) { return sendError(res, error); }
});

router.post('/posts/:id/cancel', async (req, res) => {
  try {
    const tenant = tenantId(req);
    const post = await findTenantRow('social_posts', tenant, req.params.id);
    if (!post) return res.status(404).json({ error: 'Publication introuvable.' });
    if (post.status === 'published') return res.status(409).json({ error: 'Une publication déjà publiée doit être retirée via le provider.' });
    return res.json(await patchTenantRow('social_posts', tenant, post.id, { status: 'cancelled', updated_at: new Date().toISOString() }));
  } catch (error) { return sendError(res, error); }
});

router.get('/accounts', async (req, res) => {
  try { return res.json(await listTenantRows('social_accounts', tenantId(req), { order: 'updated_at.desc' })); }
  catch (error) { return sendError(res, error); }
});

router.post('/accounts', async (req, res) => {
  try {
    const provider = String(req.body?.provider || '').toLowerCase();
    if (!ALLOWED_PLATFORMS.has(provider)) return res.status(400).json({ error: 'Provider non supporté.' });
    const tenant = tenantId(req);
    const brandId = isUuid(req.body?.brand_id) ? req.body.brand_id : null;
    if (!brandId || !(await findTenantRow('social_brands', tenant, brandId))) return res.status(400).json({ error: 'Marque invalide.' });
    const row = await insertRow('social_accounts', {
      tenant_id: tenant,
      brand_id: brandId,
      provider,
      provider_account_id: asText(req.body?.provider_account_id, null, 500),
      display_name: asText(req.body?.display_name, null, 240),
      username: asText(req.body?.username, null, 240),
      connection_status: 'pending',
      scopes: [],
      metadata: {},
      created_by: actor(req),
    });
    return res.status(201).json(row);
  } catch (error) { return sendError(res, error); }
});

router.post('/backup/run', async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Super Admin requis.' });
    return res.json(await runEncryptedBackup());
  } catch (error) { return sendError(res, error); }
});

publicRouter.post('/conversion', async (req, res) => {
  if (!SOCIAL_TRACKING_KEY || req.headers['x-social-tracking-key'] !== SOCIAL_TRACKING_KEY) return res.status(401).json({ error: 'Tracking key invalide.' });
  try {
    const tenant = slugify(req.body?.tenant_id || 'jsinnovia').replace(/-/g, '_');
    const campaignId = isUuid(req.body?.campaign_id) ? req.body.campaign_id : null;
    const postId = isUuid(req.body?.post_id) ? req.body.post_id : null;
    const source = ALLOWED_PLATFORMS.has(req.body?.source) ? req.body.source : asText(req.body?.source, null, 80);
    const row = await insertRow('social_conversions', {
      tenant_id: tenant,
      campaign_id: campaignId,
      post_id: postId,
      conversion_type: asText(req.body?.conversion_type, 'form_submit', 120),
      external_id: asText(req.body?.external_id, null, 240),
      source,
      utm: asJson(req.body?.utm, {}),
      metadata: asJson(req.body?.metadata, {}),
      occurred_at: req.body?.occurred_at || new Date().toISOString(),
    });
    return res.status(201).json({ ok: true, id: row?.id || null });
  } catch (error) { return sendError(res, error); }
});

async function dueScheduledPosts() {
  requireConfiguration();
  const query = new URLSearchParams({
    select: '*',
    status: 'eq.scheduled',
    scheduled_at: `lte.${new Date().toISOString()}`,
    order: 'scheduled_at.asc',
    limit: '100',
  });
  const rows = await supabaseRequest('social_posts', { query: query.toString() });
  return Array.isArray(rows) ? rows : [];
}

async function ensurePublishJob(post) {
  const key = `publish:${post.id}:${post.updated_at || post.scheduled_at || 'v1'}`;
  const query = new URLSearchParams({ select: '*', tenant_id: `eq.${post.tenant_id}`, idempotency_key: `eq.${key}`, limit: '1' });
  const existing = await supabaseRequest('social_publish_jobs', { query: query.toString() });
  if (Array.isArray(existing) && existing[0]) return existing[0];
  return insertRow('social_publish_jobs', {
    tenant_id: post.tenant_id,
    post_id: post.id,
    provider: post.platform,
    status: 'awaiting_provider',
    idempotency_key: key,
    attempt: 0,
    next_attempt_at: null,
    request_payload: { post_id: post.id, platform: post.platform },
    response_payload: { reason: 'oauth_provider_connector_not_enabled_yet' },
  });
}

async function runPublisherCycle() {
  if (schedulerState.publisher.running) return { skipped: true, reason: 'already_running' };
  schedulerState.publisher.running = true;
  schedulerState.publisher.last_started_at = new Date().toISOString();
  schedulerState.publisher.last_error = null;
  try {
    if (!SOCIAL_PUBLISH_ENABLED) {
      const result = { skipped: true, reason: 'SOCIAL_PUBLISH_ENABLED=false' };
      schedulerState.publisher.last_result = result;
      return result;
    }
    const posts = await dueScheduledPosts();
    const jobs = [];
    for (const post of posts) jobs.push(await ensurePublishJob(post));
    const result = { examined: posts.length, queued: jobs.length, provider_execution: 'locked_until_oauth_connectors_ready' };
    schedulerState.publisher.last_result = result;
    return result;
  } catch (error) {
    schedulerState.publisher.last_error = error.message;
    throw error;
  } finally {
    schedulerState.publisher.running = false;
    schedulerState.publisher.last_finished_at = new Date().toISOString();
  }
}

function encryptBackup(buffer) {
  if (!SOCIAL_BACKUP_SECRET) throw new Error('SOCIAL_BACKUP_ENCRYPTION_KEY non configurée.');
  const key = crypto.createHash('sha256').update(SOCIAL_BACKUP_SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('JSI1'), iv, tag, encrypted]);
}

async function allRows(table) {
  const rows = await supabaseRequest(table, { query: new URLSearchParams({ select: '*', limit: '10000' }).toString() });
  return Array.isArray(rows) ? rows : [];
}

async function runEncryptedBackup() {
  if (schedulerState.backup.running) return { skipped: true, reason: 'already_running' };
  schedulerState.backup.running = true;
  schedulerState.backup.last_started_at = new Date().toISOString();
  schedulerState.backup.last_error = null;
  try {
    if (!SOCIAL_BACKUP_SECRET) {
      const result = { skipped: true, reason: 'SOCIAL_BACKUP_ENCRYPTION_KEY_missing' };
      schedulerState.backup.last_result = result;
      return result;
    }
    const tables = ['social_brands','social_accounts','social_campaigns','social_assets','social_posts','social_publish_jobs','social_post_metrics','social_conversions','social_ai_decisions','social_webhook_events'];
    const data = {};
    for (const table of tables) data[table] = await allRows(table);
    const exportedAt = new Date();
    const payload = Buffer.from(JSON.stringify({ schema_version: 1, exported_at: exportedAt.toISOString(), data }), 'utf8');
    const compressed = zlib.gzipSync(payload, { level: 9 });
    const encrypted = encryptBackup(compressed);
    const sha256 = crypto.createHash('sha256').update(encrypted).digest('hex');
    const day = exportedAt.toISOString().slice(0, 10);
    const stamp = exportedAt.toISOString().replace(/[:.]/g, '-');
    const folder = `${DROPBOX_SOCIAL_ROOT}/Backups/${day}`;
    await ensureFolderTree(folder);
    const backupPath = `${folder}/social-command-${stamp}.json.gz.enc`;
    const uploaded = await uploadFile(backupPath, encrypted);
    if (uploaded?.error) throw new Error(uploaded.error);
    const manifest = {
      schema_version: 1,
      exported_at: exportedAt.toISOString(),
      encryption: 'AES-256-GCM',
      compression: 'gzip',
      sha256,
      backup_path: uploaded.path || backupPath,
      counts: Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])),
    };
    await mirrorJson(`${folder}/social-command-${stamp}.manifest.json`, manifest);
    schedulerState.backup.last_result = manifest;
    return manifest;
  } catch (error) {
    schedulerState.backup.last_error = error.message;
    throw error;
  } finally {
    schedulerState.backup.running = false;
    schedulerState.backup.last_finished_at = new Date().toISOString();
  }
}

function startSocialCommandSchedulers() {
  const publisher = setInterval(() => void runPublisherCycle().catch((error) => console.warn('[social-command] publisher:', error.message)), SOCIAL_SCHEDULER_INTERVAL_MS);
  publisher.unref?.();
  const backup = setInterval(() => void runEncryptedBackup().catch((error) => console.warn('[social-command] backup:', error.message)), SOCIAL_BACKUP_INTERVAL_MS);
  backup.unref?.();
  setTimeout(() => void runEncryptedBackup().catch(() => null), 30_000).unref?.();
  return {
    started: true,
    publish_enabled: SOCIAL_PUBLISH_ENABLED,
    publisher_interval_ms: SOCIAL_SCHEDULER_INTERVAL_MS,
    backup_interval_ms: SOCIAL_BACKUP_INTERVAL_MS,
    encrypted_backup_ready: Boolean(SOCIAL_BACKUP_SECRET),
  };
}

module.exports = {
  router,
  publicRouter,
  schedulerState,
  startSocialCommandSchedulers,
  runPublisherCycle,
  runEncryptedBackup,
  extractVisualManifest,
  trackingUrl,
};
