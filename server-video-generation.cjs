const express = require('express');
const crypto = require('node:crypto');
const {
  chooseProvider, validateJobInput, buildProviderRequest, xaiUsdFromUsage,
  estimateSoraUsd, publicConfig,
} = require('./server-video-generation-core.cjs');
const { encodeVideoPackage } = require('./server-video-provenance-core.cjs');
const { finalizeVideoBuffer, archiveFinalizedVideo } = require('./server-video-provenance.cjs');
const { createCostEvent } = require('./server-client-costs.cjs');
const { sourceToEurMinor } = require('./server-cost-accounting-core.cjs');

const router = express.Router();
const CRM_URL = process.env.SUPABASE_CRM_URL || 'https://gfjpryakxzdzwnazlsfz.supabase.co';
const CRM_KEY = process.env.SUPABASE_CRM_KEY || '';
const CRM_PROXY_URL = process.env.SUPABASE_CRM_PROXY_URL || '';
const CRM_PROXY_TOKEN = process.env.SUPABASE_CRM_PROXY_TOKEN || '';
const active = new Set();
let scheduler = null;

function headers(key = CRM_KEY) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function crmKeys(env = process.env) {
  return [...new Set([
    env.SUPABASE_CRM_KEY,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_SECRET_KEY,
  ].map((value) => String(value || '').trim()).filter(Boolean))];
}

async function crm(path, options = {}) {
  if (CRM_PROXY_URL && CRM_PROXY_TOKEN) {
    const response = await fetch(CRM_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cockpit-proxy-token': CRM_PROXY_TOKEN },
      body: JSON.stringify({ path, method: options.method || 'GET', headers: options.headers || {}, body: options.body || null }),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(data?.message || data?.error || `Relais CRM ${response.status}`);
    return data;
  }
  const candidates = crmKeys();
  if (!candidates.length) throw new Error('Clé serveur Supabase CRM manquante');
  let lastError = 'Clé Supabase CRM refusée';
  for (const key of candidates) {
    const response = await fetch(`${CRM_URL}/rest/v1/${path}`, { ...options, headers: { ...headers(key), ...(options.headers || {}) } });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (response.ok) return data;
    lastError = data?.message || data?.error || `Supabase ${response.status}`;
    if (![401, 403].includes(response.status)) break;
  }
  throw new Error(lastError);
}

async function insertJob(row) {
  const rows = await crm('video_generation_jobs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  return rows[0];
}

async function patchJob(id, values) {
  const rows = await crm(`video_generation_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...values, updated_at: new Date().toISOString() }),
  });
  return rows[0];
}

async function listJobs(query = '') {
  return crm(`video_generation_jobs?select=*&${query || 'order=created_at.desc&limit=50'}`, { method: 'GET' });
}

function providerHeaders(provider) {
  const key = provider === 'xai' ? process.env.XAI_API_KEY : process.env.OPENAI_API_KEY;
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function providerJson(url, provider, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...providerHeaders(provider), ...(options.headers || {}) } });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text.slice(0, 2000) }; }
  if (!response.ok) throw new Error(`${provider === 'xai' ? 'Grok' : 'Sora'} HTTP ${response.status}: ${data?.error?.message || data?.error || data?.message || 'requête refusée'}`);
  return data;
}

async function submit(job) {
  const request = buildProviderRequest(job.provider, job.prompt);
  const data = await providerJson(request.url, job.provider, { method: 'POST', body: JSON.stringify(request.body) });
  const providerJobId = data.request_id || data.id;
  if (!providerJobId) throw new Error('Le fournisseur n’a retourné aucun identifiant d’exécution.');
  return patchJob(job.id, {
    status: 'submitted', provider_job_id: providerJobId, provider_payload: { request: request.body, response: data }, progress: Number(data.progress || 0),
  });
}

async function poll(job) {
  const url = job.provider === 'xai'
    ? `https://api.x.ai/v1/videos/${encodeURIComponent(job.provider_job_id)}`
    : `https://api.openai.com/v1/videos/${encodeURIComponent(job.provider_job_id)}`;
  const data = await providerJson(url, job.provider, { method: 'GET' });
  const status = String(data.status || '').toLowerCase();
  const failed = ['failed', 'cancelled', 'expired', 'error'].includes(status) || data.error;
  if (failed) throw new Error(data?.error?.message || data?.error || `Génération ${status}`);
  const videoUrl = data?.video?.url || data?.data?.video?.url || data?.output?.url || data?.url;
  const completed = ['completed', 'succeeded', 'done'].includes(status) || Boolean(videoUrl);
  if (!completed) {
    await patchJob(job.id, { status: 'in_progress', progress: Math.max(1, Math.round(Number(data.progress || job.progress || 1))), result_payload: data });
    return null;
  }
  return { data, videoUrl };
}

async function downloadVideo(job, completed) {
  const url = job.provider === 'xai'
    ? completed.videoUrl
    : `https://api.openai.com/v1/videos/${encodeURIComponent(job.provider_job_id)}/content`;
  if (!url) throw new Error('Le fournisseur a terminé sans URL vidéo.');
  const response = await fetch(url, { headers: job.provider === 'openai' ? providerHeaders(job.provider) : {} });
  if (!response.ok) throw new Error(`Téléchargement vidéo impossible (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function complete(job, completed) {
  const sourceBuffer = await downloadVideo(job, completed);
  const uniqueId = crypto.randomUUID();
  const metadata = {
    clientId: job.client_id, client: job.client_name, campaign: job.campaign_name,
    campaignId: job.id, prompt: job.prompt, durationSeconds: 8, width: 1920, height: 1080,
    resolutionLabel: '1080p', version: job.version || 'v01', uniqueId,
    sector: job.metadata?.sector || 'innovation numérique', sourceMedia: job.metadata?.source_media || [],
    rightsConfirmed: job.metadata?.rights_confirmed === true, usageRights: job.metadata?.usage_rights,
    source: `JS-Innov.IA® Signage Campaign — ${job.provider === 'xai' ? 'Grok Imagine' : 'Sora'}`,
    exportParameters: { fps: 25, provider: job.provider, provider_job_id: job.provider_job_id },
  };
  const finalized = await finalizeVideoBuffer(encodeVideoPackage(metadata, sourceBuffer));
  const archived = await archiveFinalizedVideo(finalized, { user: { role: 'superadmin', organisation: 'jsinnovia', id: 'video-generation-worker' } });

  const usd = job.provider === 'xai' ? xaiUsdFromUsage(completed.data) : estimateSoraUsd({ seconds: 8 });
  if (!(usd >= 0)) throw new Error('Le fournisseur n’a pas retourné un coût vérifiable.');
  const converted = sourceToEurMinor(usd, 'USD');
  const evidence = job.provider === 'xai' ? 'actual' : 'estimated';
  const verificationRef = job.provider === 'xai' ? `xai-video:${job.provider_job_id}` : null;
  const calculationMethod = job.provider === 'openai' ? '8 secondes × 0,10 USD/seconde (tarif officiel Sora 2 1280×720)' : null;
  const calculationInputs = job.provider === 'openai' ? { seconds: 8, usd_per_second: 0.10, usd, fx_rate: converted.fxRate, fx_source: converted.fxSource } : null;
  const costEvent = await createCostEvent({
    clientId: job.client_id, projectId: job.project_id, costCenterId: job.cost_center_id,
    sourceType: 'media_ai', provider: job.provider === 'xai' ? 'xai' : 'openai',
    description: `Vidéo 8 s — ${job.campaign_name}`, actualCostMinor: converted.totalMinor,
    externalRef: `video-generation:${job.provider}:${job.provider_job_id}`,
    evidenceStatus: evidence, verificationRef, calculationMethod, calculationInputs,
    metadata: { video_job_id: job.id, provider_job_id: job.provider_job_id, cost_usd: usd, dropbox_path: archived.videoUpload.path },
  });
  return patchJob(job.id, {
    status: 'completed', progress: 100, result_payload: completed.data, cost_usd: usd,
    cost_eur_minor: converted.totalMinor, cost_evidence_status: evidence, cost_event_id: costEvent.id || null,
    dropbox_path: archived.videoUpload.path, sidecar_path: archived.jsonUpload.path, sha256: finalized.sha256,
    metadata: { ...job.metadata, final: finalized.metadata, index_warning: archived.indexWarning }, completed_at: new Date().toISOString(), error: null,
  });
}

async function processJob(job) {
  if (!job?.id || active.has(job.id) || ['completed', 'failed', 'cancelled'].includes(job.status)) return;
  active.add(job.id);
  try {
    const current = job.provider_job_id ? job : await submit(job);
    const completed = await poll(current);
    if (completed) await complete(current, completed);
  } catch (error) {
    console.error('[video-generation]', job.id, error.message);
    await patchJob(job.id, { status: 'failed', error: String(error.message || error).slice(0, 2000) }).catch(() => {});
  } finally {
    active.delete(job.id);
  }
}

async function sweep() {
  const jobs = await listJobs('status=in.(queued,submitted,in_progress)&order=created_at.asc&limit=10').catch((error) => {
    console.warn('[video-generation] sweep:', error.message); return [];
  });
  await Promise.all((jobs || []).map(processJob));
}

function startVideoGenerationScheduler() {
  if (scheduler) return { started: false, reason: 'already_started' };
  scheduler = setInterval(() => sweep().catch(() => {}), 10_000);
  scheduler.unref?.();
  setTimeout(() => sweep().catch(() => {}), 1_000).unref?.();
  return { started: true, interval_ms: 10_000 };
}

router.get('/config', (_req, res) => res.json(publicConfig()));
router.get('/jobs', async (req, res) => {
  try {
    const client = req.query.client_id ? `client_id=eq.${encodeURIComponent(req.query.client_id)}&` : '';
    res.json({ jobs: await listJobs(`${client}order=created_at.desc&limit=100`) });
  } catch (error) { res.status(503).json({ error: error.message }); }
});
router.get('/jobs/:id', async (req, res) => {
  try {
    const rows = await listJobs(`id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    if (!rows[0]) return res.status(404).json({ error: 'Génération introuvable.' });
    if (['queued', 'submitted', 'in_progress'].includes(rows[0].status)) processJob(rows[0]).catch(() => {});
    return res.json({ job: rows[0] });
  } catch (error) { return res.status(503).json({ error: error.message }); }
});
router.post('/jobs', async (req, res) => {
  try {
    const input = validateJobInput(req.body);
    const provider = chooseProvider(req.body.provider);
    const request = buildProviderRequest(provider, input.prompt);
    const job = await insertJob({
      client_id: input.clientId, client_name: input.clientName, project_id: input.projectId, cost_center_id: input.costCenterId,
      provider, model: request.model, status: 'queued', prompt: input.prompt, campaign_name: input.campaign,
      duration_seconds: 8, resolution: provider === 'xai' ? '720p' : '1280x720', aspect_ratio: '16:9', version: input.version,
      metadata: { sector: input.sector, usage_rights: input.usageRights, rights_confirmed: input.rightsConfirmed, requested_by: req.user?.id || req.user?.email || null },
      created_by: req.user?.id || req.user?.email || null,
    });
    processJob(job).catch(() => {});
    return res.status(202).json({ job, journal_id: `video-generation-${job.id}` });
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

module.exports = { router, startVideoGenerationScheduler, sweep, processJob, crmKeys };
