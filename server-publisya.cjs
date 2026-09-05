const express = require('express');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { resolveTenant } = require('./server-tenant.cjs');
const {
  ensureFolderTree,
  getAccessToken,
  dropboxApiArg,
  isSupportedMedia,
  safeUploadFilename,
} = require('./server-dropbox-helper.cjs');
const { isConfigured: aiConfigured, analyzeCampaignMedia } = require('./server-publisya-ai.cjs');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DROPBOX_ROOT = process.env.DROPBOX_ROOT_PATH || '/Cockpit';
const MAX_MEDIA_BYTES = 140 * 1024 * 1024;

const PROVIDERS = Object.freeze([
  { id: 'facebook', label: 'Facebook', group: 'meta', status: 'planned' },
  { id: 'instagram', label: 'Instagram', group: 'meta', status: 'planned' },
  { id: 'tiktok', label: 'TikTok', group: 'tiktok', status: 'planned' },
  { id: 'linkedin', label: 'LinkedIn', group: 'linkedin', status: 'planned' },
  { id: 'youtube', label: 'YouTube', group: 'google', status: 'planned' },
]);
const PLATFORM_IDS = Object.freeze(PROVIDERS.map((provider) => provider.id));
const PLATFORM_SET = new Set(PLATFORM_IDS);
const MODULE_VERSION = 'lot2-ai-validation-foundation';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dropboxConfigured() {
  return Boolean(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN);
}

function safeOrganisation(user) {
  return String(user?.organisation || '').trim() || null;
}

function requestContext(req) {
  const tenantId = resolveTenant(req);
  return {
    tenantId,
    clientId: tenantId,
    actor: String(req.user?.id || req.user?.email || 'unknown').slice(0, 200),
  };
}

function normalizePlatforms(input) {
  const source = Array.isArray(input) ? input : [];
  return [...new Set(source.map((value) => String(value || '').trim().toLowerCase()).filter((value) => PLATFORM_SET.has(value)))];
}

function textField(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function decodeFileName(value) {
  try {
    return decodeURIComponent(String(value || 'media'));
  } catch {
    return String(value || 'media');
  }
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_SECRET) {
    const error = new Error('Clé serveur Supabase non configurée.');
    error.code = 'PUBLISYA_DATABASE_NOT_CONFIGURED';
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET,
      Authorization: `Bearer ${SUPABASE_SECRET}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`Supabase ${response.status}: ${body.slice(0, 220)}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body ? JSON.parse(body) : [];
}

function schemaNotReady(error) {
  const text = `${error?.body || ''} ${error?.message || ''}`;
  return error?.code === 'PUBLISYA_DATABASE_NOT_CONFIGURED'
    || error?.status === 404
    || /PGRST205|publisya_campaigns|relation .* does not exist/i.test(text);
}

async function dataStoreReady() {
  try {
    await supabaseRequest('publisya_campaigns?select=id&limit=1');
    return true;
  } catch {
    return false;
  }
}

async function listCampaignsFor(req, { limit = 100 } = {}) {
  const { tenantId, clientId } = requestContext(req);
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
  const select = 'id,title,objective,status,target_platforms,human_approval_required,scheduled_at,timezone,created_at,updated_at';
  return supabaseRequest(
    `publisya_campaigns?select=${select}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&order=created_at.desc&limit=${safeLimit}`,
  );
}

async function getCampaignFor(req, campaignId) {
  if (!UUID_RE.test(String(campaignId || ''))) return null;
  const { tenantId, clientId } = requestContext(req);
  const rows = await supabaseRequest(
    `publisya_campaigns?select=*&id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&limit=1`,
  );
  return rows[0] || null;
}

async function updateCampaignFor(req, campaignId, patch) {
  const { tenantId, clientId } = requestContext(req);
  const rows = await supabaseRequest(
    `publisya_campaigns?id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  );
  return rows[0] || null;
}

async function sourceMediaFor(req, campaignId) {
  const { tenantId, clientId } = requestContext(req);
  const rows = await supabaseRequest(
    `publisya_media_assets?select=*&campaign_id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&asset_role=eq.source&order=created_at.desc&limit=1`,
  );
  return rows[0] || null;
}

async function variantVersionsFor(req, campaignId) {
  const { tenantId, clientId } = requestContext(req);
  return supabaseRequest(
    `publisya_post_variants?select=platform,version&campaign_id=eq.${encodeURIComponent(campaignId)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}`,
  );
}

function nextVersions(rows) {
  const versions = Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, 1]));
  for (const row of rows || []) {
    if (!PLATFORM_SET.has(row.platform)) continue;
    versions[row.platform] = Math.max(versions[row.platform], Number(row.version || 0) + 1);
  }
  return versions;
}

function generatedVariantRow({ campaign, platform, variant, version, media, tenantId, clientId, actor, model }) {
  const base = {
    tenant_id: tenantId,
    client_id: clientId,
    campaign_id: campaign.id,
    social_account_id: null,
    platform,
    version,
    status: 'generated',
    caption: null,
    title: null,
    description: null,
    hashtags: [],
    tags: [],
    call_to_action: null,
    destination_url: null,
    alt_text: null,
    cover_text: null,
    chapters: [],
    provider_options: {},
    media_asset_ids: media?.id ? [media.id] : [],
    generated_by: `openai:${model}`,
    generated_at: new Date().toISOString(),
    last_edited_by: actor,
  };

  if (platform === 'youtube') {
    return {
      ...base,
      title: textField(variant?.title, 200),
      description: textField(variant?.description, 5000),
      tags: Array.isArray(variant?.tags) ? variant.tags.map((item) => textField(item, 80)).filter(Boolean).slice(0, 20) : [],
      cover_text: textField(variant?.thumbnail_text, 120),
    };
  }

  const providerOptions = platform === 'tiktok' && variant?.hook ? { hook: textField(variant.hook, 240) } : {};
  return {
    ...base,
    caption: textField(variant?.caption, 5000),
    hashtags: Array.isArray(variant?.hashtags) ? variant.hashtags.map((item) => textField(item, 100)).filter(Boolean).slice(0, 20) : [],
    call_to_action: textField(variant?.cta, 500),
    alt_text: textField(variant?.alt_text, 1000),
    cover_text: textField(variant?.cover_text, 240),
    provider_options: providerOptions,
  };
}

function publicStatus({ databaseReady = false } = {}) {
  const mediaUploadReady = databaseReady && dropboxConfigured();
  const aiReady = mediaUploadReady && aiConfigured();
  return {
    module: 'publisya',
    product_name: 'PUBLISYA',
    signature: 'Un contenu. Chaque réseau. Le bon message.',
    version: MODULE_VERSION,
    ready: true,
    publishing_enabled: false,
    human_approval_required: true,
    timezone: 'Europe/Brussels',
    providers: PROVIDERS,
    infrastructure: {
      database_ready: databaseReady,
      media_storage_ready: dropboxConfigured(),
      ai_ready: aiConfigured(),
    },
    limits: {
      media_upload_bytes: MAX_MEDIA_BYTES,
      media_upload_mb: 140,
    },
    capabilities: {
      campaigns: databaseReady,
      media_upload: mediaUploadReady,
      ai_analysis: aiReady,
      network_variants: aiReady,
      approval_workflow: databaseReady,
      scheduling: false,
      direct_publish: false,
      analytics: false,
    },
  };
}

async function streamMediaToDropbox(req, storageKey) {
  const token = await getAccessToken();
  if (!token) throw new Error('Dropbox non configuré');

  const declaredSize = Number(req.headers['content-length'] || 0);
  if (declaredSize <= 0) {
    const error = new Error('Aucun média reçu.');
    error.status = 400;
    throw error;
  }
  if (declaredSize > MAX_MEDIA_BYTES) {
    const error = new Error('Le média dépasse la limite de 140 Mo.');
    error.status = 413;
    throw error;
  }

  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_MEDIA_BYTES) {
        const error = new Error('Le média dépasse la limite de 140 Mo.');
        error.status = 413;
        callback(error);
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': dropboxApiArg({ path: storageKey, mode: 'add', autorename: true, mute: true }),
    },
    body: req.pipe(meter),
    duplex: 'half',
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_summary || `Dropbox ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (bytes === 0) {
    const error = new Error('Aucun média reçu.');
    error.status = 400;
    throw error;
  }

  return { path: data.path_display || storageKey, id: data.id || null, size: bytes, sha256: hash.digest('hex') };
}

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

router.get('/status', async (req, res) => {
  const databaseReady = await dataStoreReady();
  res.json({
    ...publicStatus({ databaseReady }),
    organisation: safeOrganisation(req.user),
    tenant_id: requestContext(req).tenantId,
  });
});

router.get('/dashboard', async (req, res) => {
  try {
    const campaigns = await listCampaignsFor(req, { limit: 200 });
    const counts = { draft: 0, awaiting_approval: 0, scheduled: 0, publishing: 0, published: 0, failed: 0 };
    for (const campaign of campaigns) if (Object.hasOwn(counts, campaign.status)) counts[campaign.status] += 1;
    res.json({
      campaigns: counts,
      connections: { connected: 0, reconnect_required: 0, total_supported: PROVIDERS.length },
      foundation_mode: true,
      database_ready: true,
    });
  } catch (error) {
    if (!schemaNotReady(error)) console.error('[publisya] dashboard:', error.message);
    res.json({
      campaigns: { draft: 0, awaiting_approval: 0, scheduled: 0, publishing: 0, published: 0, failed: 0 },
      connections: { connected: 0, reconnect_required: 0, total_supported: PROVIDERS.length },
      foundation_mode: true,
      database_ready: false,
    });
  }
});

router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await listCampaignsFor(req, { limit: req.query.limit });
    res.json({ campaigns });
  } catch (error) {
    console.error('[publisya] list campaigns:', error.message);
    res.status(503).json({
      error: schemaNotReady(error) ? 'Le stockage Publisya doit encore être initialisé.' : 'Les campagnes Publisya sont momentanément indisponibles.',
      code: schemaNotReady(error) ? 'PUBLISYA_SCHEMA_NOT_READY' : 'PUBLISYA_CAMPAIGNS_UNAVAILABLE',
    });
  }
});

router.post('/campaigns', async (req, res) => {
  const title = textField(req.body?.title, 120);
  const objective = textField(req.body?.objective, 500);
  const instructions = textField(req.body?.instructions, 2000);
  const targetPlatforms = normalizePlatforms(req.body?.target_platforms || req.body?.targetPlatforms);

  if (!title) return res.status(400).json({ error: 'Le titre de la campagne est obligatoire.' });
  if (targetPlatforms.length === 0) return res.status(400).json({ error: 'Sélectionnez au moins un réseau.' });

  const { tenantId, clientId, actor } = requestContext(req);
  const payload = {
    tenant_id: tenantId,
    client_id: clientId,
    title,
    objective: objective || null,
    source_language: 'fr',
    target_platforms: targetPlatforms,
    status: 'draft',
    human_approval_required: true,
    instructions: instructions || null,
    timezone: 'Europe/Brussels',
    created_by: actor,
  };

  try {
    const rows = await supabaseRequest('publisya_campaigns', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    res.status(201).json({ campaign: rows[0] });
  } catch (error) {
    console.error('[publisya] create campaign:', error.message);
    res.status(503).json({
      error: schemaNotReady(error) ? 'Le stockage Publisya doit encore être initialisé.' : 'Impossible de créer la campagne pour le moment.',
      code: schemaNotReady(error) ? 'PUBLISYA_SCHEMA_NOT_READY' : 'PUBLISYA_CAMPAIGN_CREATE_FAILED',
    });
  }
});

router.get('/campaigns/:campaignId', async (req, res) => {
  try {
    const campaign = await getCampaignFor(req, req.params.campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });

    const { tenantId, clientId } = requestContext(req);
    const media = await supabaseRequest(
      `publisya_media_assets?select=id,asset_role,platform,storage_provider,storage_key,mime_type,file_size_bytes,width,height,duration_seconds,sha256,created_at&campaign_id=eq.${encodeURIComponent(campaign.id)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&order=created_at.asc`,
    );
    const variants = await supabaseRequest(
      `publisya_post_variants?select=id,platform,version,status,caption,title,description,hashtags,tags,call_to_action,alt_text,cover_text,provider_options,created_at,updated_at&campaign_id=eq.${encodeURIComponent(campaign.id)}&tenant_id=eq.${encodeURIComponent(tenantId)}&client_id=eq.${encodeURIComponent(clientId)}&order=platform.asc,version.desc`,
    );
    res.json({ campaign, media, variants });
  } catch (error) {
    console.error('[publisya] campaign detail:', error.message);
    res.status(schemaNotReady(error) ? 503 : 500).json({
      error: schemaNotReady(error) ? 'Le stockage Publisya doit encore être initialisé.' : 'Impossible de charger la campagne.',
    });
  }
});

router.post('/campaigns/:campaignId/media', async (req, res) => {
  const campaignId = String(req.params.campaignId || '');
  if (!UUID_RE.test(campaignId)) return res.status(400).json({ error: 'Identifiant de campagne invalide.' });
  if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/octet-stream') {
    return res.status(415).json({ error: 'Le média doit être envoyé en flux binaire sécurisé.' });
  }

  const requestedName = decodeFileName(req.headers['x-file-name']);
  const fileName = safeUploadFilename(requestedName);
  const mimeType = textField(req.headers['x-file-type'] || 'application/octet-stream', 120) || 'application/octet-stream';
  if (!isSupportedMedia(fileName, mimeType)) {
    return res.status(415).json({ error: 'Format média non pris en charge. Utilisez une image ou une vidéo standard.' });
  }

  try {
    const campaign = await getCampaignFor(req, campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });
    if (!dropboxConfigured()) return res.status(503).json({ error: 'Le stockage média Publisya n’est pas encore configuré.' });

    const { tenantId, clientId, actor } = requestContext(req);
    const folderPath = `${DROPBOX_ROOT}/Publisya/${tenantId}/${campaignId}/Sources`;
    const folder = await ensureFolderTree(folderPath);
    if (folder?.error) throw new Error(`Dropbox folder: ${folder.error}`);

    const storedName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}-${fileName}`.slice(0, 220);
    const storageKey = `${folderPath}/${storedName}`;
    const uploaded = await streamMediaToDropbox(req, storageKey);

    const rows = await supabaseRequest('publisya_media_assets', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: tenantId,
        client_id: clientId,
        campaign_id: campaignId,
        asset_role: 'source',
        platform: null,
        storage_provider: 'dropbox',
        storage_key: uploaded.path,
        mime_type: mimeType,
        file_size_bytes: uploaded.size,
        sha256: uploaded.sha256,
        media_metadata: { original_filename: fileName, dropbox_file_id: uploaded.id, upload_mode: 'stream' },
        created_by: actor,
      }),
    });

    res.status(201).json({
      media: rows[0],
      upload: { file_name: fileName, mime_type: mimeType, file_size_bytes: uploaded.size, sha256: uploaded.sha256 },
    });
  } catch (error) {
    console.error('[publisya] media upload:', error.message);
    const status = error.status === 400 || error.status === 413 ? error.status : (schemaNotReady(error) ? 503 : 500);
    res.status(status).json({
      error: schemaNotReady(error) ? 'Le stockage Publisya doit encore être initialisé.' : error.status === 413 ? 'Le média dépasse la limite de 140 Mo.' : error.status === 400 ? error.message : 'Impossible d’enregistrer ce média.',
      code: schemaNotReady(error) ? 'PUBLISYA_SCHEMA_NOT_READY' : error.status === 413 ? 'PUBLISYA_MEDIA_TOO_LARGE' : 'PUBLISYA_MEDIA_UPLOAD_FAILED',
    });
  }
});

router.post('/campaigns/:campaignId/analyze', async (req, res) => {
  const campaignId = String(req.params.campaignId || '');
  if (!UUID_RE.test(campaignId)) return res.status(400).json({ error: 'Identifiant de campagne invalide.' });
  if (!aiConfigured()) return res.status(503).json({ error: 'Le moteur IA Publisya n’est pas encore configuré.' });

  let campaign;
  try {
    campaign = await getCampaignFor(req, campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campagne introuvable.' });
    const media = await sourceMediaFor(req, campaignId);
    if (!media) return res.status(400).json({ error: 'Ajoutez une image ou une vidéo avant de lancer l’analyse.' });
    if (['scheduled', 'publishing', 'published'].includes(campaign.status)) {
      return res.status(409).json({ error: 'Cette campagne ne peut plus être réanalysée dans son état actuel.' });
    }

    await updateCampaignFor(req, campaignId, { status: 'analyzing' });
    const { tenantId, clientId, actor } = requestContext(req);
    const result = await analyzeCampaignMedia({ campaign, media, tenantId, actor });
    const versions = nextVersions(await variantVersionsFor(req, campaignId));
    const selectedPlatforms = normalizePlatforms(campaign.target_platforms);
    const variantRows = selectedPlatforms.map((platform) => generatedVariantRow({
      campaign,
      platform,
      variant: result.variants?.[platform],
      version: versions[platform],
      media,
      tenantId,
      clientId,
      actor,
      model: result.model,
    }));

    const createdVariants = variantRows.length
      ? await supabaseRequest('publisya_post_variants', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(variantRows),
      })
      : [];

    const analysis = {
      ...(result.analysis || {}),
      transcript: result.transcript || '',
      generation_model: result.model,
      request_id: result.request_id || null,
      generated_at: new Date().toISOString(),
    };
    const updatedCampaign = await updateCampaignFor(req, campaignId, {
      status: 'awaiting_approval',
      analysis,
      risk_flags: Array.isArray(result.analysis?.risk_flags) ? result.analysis.risk_flags.slice(0, 30) : [],
    });

    res.json({ campaign: updatedCampaign, analysis, variants: createdVariants });
  } catch (error) {
    console.error('[publisya] analyze:', error.message);
    if (campaign?.id) await updateCampaignFor(req, campaign.id, { status: 'draft' }).catch(() => {});
    const status = error.status === 402 ? 402 : (schemaNotReady(error) ? 503 : 500);
    res.status(status).json({
      error: error.status === 402 ? error.message : schemaNotReady(error) ? 'Le stockage Publisya doit encore être initialisé.' : 'L’analyse Publisya n’a pas pu être terminée.',
      code: error.status === 402 ? 'PUBLISYA_AI_BUDGET_BLOCKED' : schemaNotReady(error) ? 'PUBLISYA_SCHEMA_NOT_READY' : 'PUBLISYA_AI_ANALYSIS_FAILED',
    });
  }
});

function startPublisyaScheduler() {
  return { started: false, reason: 'Lot 2 : publication externe volontairement désactivée' };
}

module.exports = {
  router,
  PROVIDERS,
  PLATFORM_IDS,
  MAX_MEDIA_BYTES,
  MODULE_VERSION,
  normalizePlatforms,
  nextVersions,
  schemaNotReady,
  startPublisyaScheduler,
};
