const express = require('express');
const crypto = require('node:crypto');
const {
  chooseProvider, validateJobInput, resolveCostScope, buildProviderRequest, xaiUsdFromUsage,
  estimateSoraUsd, publicConfig, isCanonicalUuid, findCanonicalClient,
} = require('./server-video-generation-core.cjs');
const { encodeVideoPackage } = require('./server-video-provenance-core.cjs');
const { finalizeVideoBuffer, archiveFinalizedVideo } = require('./server-video-provenance.cjs');
const { createCostEvent } = require('./server-client-costs.cjs');
const { sourceToEurMinor } = require('./server-cost-accounting-core.cjs');
const { getDocumentBufferForUser } = require('./server-documents.cjs');

const router = express.Router();
const CRM_URL = process.env.SUPABASE_CRM_URL || 'https://gfjpryakxzdzwnazlsfz.supabase.co';
const CRM_KEY = process.env.SUPABASE_CRM_KEY || '';
const CRM_PROXY_URL = process.env.SUPABASE_CRM_PROXY_URL || '';
const CRM_PROXY_TOKEN = process.env.SUPABASE_CRM_PROXY_TOKEN || '';
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL || process.env.VITE_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.JSINNOVIA_AGENT_KEY || process.env.AGENT_API_KEY || '';
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

async function patchLinkedExecution(path, payload, organisation = 'jsinnovia') {
  if (!AGENT_KEY) throw new Error('Clé Agent manquante pour synchroniser la tâche vidéo.');
  const response = await fetch(`${AGENT_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-agent-key': AGENT_KEY, 'x-organisation-id': organisation },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Synchronisation vidéo HTTP ${response.status}`);
  return data;
}

async function completeLinkedExecution(job, finalJob) {
  const taskId = String(job?.metadata?.task_id || '').trim();
  const runId = String(job?.metadata?.agent_run_id || '').trim();
  if (!taskId || !runId) return { linked: false };
  const organisation = String(job?.metadata?.organisation || 'jsinnovia');
  const proof = {
    video_job_id: finalJob.id,
    provider_job_id: finalJob.provider_job_id,
    journal_id: `video-generation-${finalJob.id}`,
    dropbox_path: finalJob.dropbox_path,
    sidecar_path: finalJob.sidecar_path,
    sha256: finalJob.sha256,
    cost_event_id: finalJob.cost_event_id,
    completed_at: finalJob.completed_at,
  };
  await patchLinkedExecution(`/agent-runs/${encodeURIComponent(runId)}`, { status: 'completed', result: proof, error: null, completed_at: finalJob.completed_at }, organisation);
  await patchLinkedExecution(`/data/Tache/${encodeURIComponent(taskId)}`, {
    statut: 'terminee',
    notes: `Génération vidéo finalisée avec preuve.\nrun_id=${runId}\njournal=${proof.journal_id}\nDropbox=${proof.dropbox_path}\nSHA-256=${proof.sha256}`.slice(0, 4000),
  }, organisation);
  return { linked: true, task_id: taskId, run_id: runId };
}

async function failLinkedExecution(job, error) {
  const taskId = String(job?.metadata?.task_id || '').trim();
  const runId = String(job?.metadata?.agent_run_id || '').trim();
  if (!taskId || !runId) return { linked: false };
  const organisation = String(job?.metadata?.organisation || 'jsinnovia');
  const message = String(error?.message || error || 'Échec vidéo').slice(0, 1000);
  await patchLinkedExecution(`/agent-runs/${encodeURIComponent(runId)}`, { status: 'failed', error: message, completed_at: new Date().toISOString() }, organisation);
  await patchLinkedExecution(`/data/Tache/${encodeURIComponent(taskId)}`, { statut: 'bloquee', notes: `Blocage d’exécution réel: ${message}\nrun_id=${runId}`.slice(0, 4000) }, organisation);
  return { linked: true, task_id: taskId, run_id: runId };
}

function normalizedName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonicalClientName(client = {}) {
  return String(client.denomination_legale || client.entreprise || [client.prenom, client.nom].filter(Boolean).join(' ') || client.nom || '').trim();
}

function normalizeClientRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  throw new Error('La source clients du Cockpit a retourné un format inattendu.');
}

async function listVideoClients(organisation = 'jsinnovia') {
  if (!AGENT_KEY) throw new Error('Clé Agent manquante pour charger les clients du Cockpit.');
  const response = await fetch(`${AGENT_URL}/data/Client?limit=2000`, {
    headers: { 'x-agent-key': AGENT_KEY, 'x-organisation-id': String(organisation || 'jsinnovia') },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Chargement des clients impossible (${response.status}).`);
  const clients = normalizeClientRows(payload);
  const centers = await crm('client_cost_centers?select=id,client_id,product_code,metadata&is_active=eq.true&limit=2000').catch(() => []);
  return clients
    .filter((client) => client?.id)
    .map((client) => ({
      id: client.id,
      name: canonicalClientName(client) || `Client ${client.id}`,
      cost_centers: (Array.isArray(centers) ? centers : [])
        .filter((center) => String(center.client_id) === String(client.id))
        .map((center) => ({
          id: center.id,
          product_code: center.product_code,
          project_id: String(center.metadata?.project_id || '').trim() || null,
        })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

async function resolveClientInput(input = {}, organisation = 'jsinnovia') {
  const requestedId = String(input.client_id || '').trim();
  const requestedName = String(input.client_name || '').trim();
  if (!requestedId && !requestedName) return input;
  // video_generation_jobs stores a text snapshot, but every CRM reference must
  // be canonical before cost-center lookup or task synchronization.
  if (requestedId && isCanonicalUuid(requestedId)) return input;
  if (!AGENT_KEY) throw new Error('Impossible de retrouver le client : clé Agent Cockpit manquante.');
  const response = await fetch(`${AGENT_URL}/data/Client?limit=2000`, {
    headers: {
      'x-agent-key': AGENT_KEY,
      'x-organisation-id': String(organisation || 'jsinnovia'),
    },
  });
  const payload = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`Recherche client impossible (${response.status}).`);
  const clients = normalizeClientRows(payload);
  const client = findCanonicalClient(clients, { clientId: requestedId, clientName: requestedName });
  if (!client?.id) {
    throw new Error(requestedId
      ? `Identifiant client « ${requestedId} » non canonique ou introuvable dans le Cockpit.`
      : `Client « ${requestedName} » introuvable dans le Cockpit : créez ou sélectionnez sa fiche avant de générer.`);
  }
  return { ...input, client_id: client.id, client_name: canonicalClientName(client) };
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

async function loadImageDocument(documentId) {
  const { record, buffer } = await getDocumentBufferForUser({ role: 'superadmin' }, documentId);
  if (!String(record.mime_type || '').toLowerCase().startsWith('image/')) throw new Error(`Le média ${documentId} n’est pas une image exploitable.`);
  return { record, dataUri: `data:${record.mime_type};base64,${buffer.toString('base64')}` };
}

async function submit(job) {
  if (job.provider !== 'xai' && (job.metadata?.source_document_id || (job.metadata?.reference_document_ids || []).length)) {
    throw new Error('La génération depuis des images Cockpit nécessite Grok Imagine.');
  }

  let imageDataUri = null;
  let referenceImageDataUris = [];
  const referenceIds = Array.isArray(job.metadata?.reference_document_ids)
    ? job.metadata.reference_document_ids.filter(Boolean)
    : [];

  if (referenceIds.length > 1) {
    const loaded = await Promise.all(referenceIds.map(loadImageDocument));
    referenceImageDataUris = loaded.map((item) => item.dataUri);
  } else if (job.metadata?.source_document_id) {
    const loaded = await loadImageDocument(job.metadata.source_document_id);
    imageDataUri = loaded.dataUri;
  }

  const request = buildProviderRequest(job.provider, job.prompt, { imageDataUri, referenceImageDataUris });
  const data = await providerJson(request.url, job.provider, { method: 'POST', body: JSON.stringify(request.body) });
  const providerJobId = data.request_id || data.id;
  if (!providerJobId) throw new Error('Le fournisseur n’a retourné aucun identifiant d’exécution.');
  return patchJob(job.id, {
    status: 'submitted',
    provider_job_id: providerJobId,
    provider_payload: {
      request: {
        ...request.body,
        ...(request.body.image ? { image: { source_document_id: job.metadata.source_document_id, data_uri_redacted: true } } : {}),
        ...(request.body.reference_images ? {
          reference_images: referenceIds.map((documentId, index) => ({ document_id: documentId, position: index, data_uri_redacted: true })),
        } : {}),
      },
      response: data,
    },
    progress: Number(data.progress || 0),
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
  const finalJob = await patchJob(job.id, {
    status: 'completed', progress: 100, result_payload: completed.data, cost_usd: usd,
    cost_eur_minor: converted.totalMinor, cost_evidence_status: evidence, cost_event_id: costEvent.id || null,
    dropbox_path: archived.videoUpload.path, sidecar_path: archived.jsonUpload.path, sha256: finalized.sha256,
    metadata: { ...job.metadata, final: finalized.metadata, index_warning: archived.indexWarning }, completed_at: new Date().toISOString(), error: null,
  });
  await completeLinkedExecution(job, finalJob).catch((error) => console.warn('[video-generation] task sync:', error.message));
  return finalJob;
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
    await failLinkedExecution(job, error).catch((syncError) => console.warn('[video-generation] failed task sync:', syncError.message));
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
router.get('/clients', async (req, res) => {
  try {
    return res.json({ clients: await listVideoClients(req.user?.organisation || 'jsinnovia') });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});
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

async function createVideoGenerationJob(body, user = {}) {
  const resolvedBody = await resolveClientInput(body, user?.organisation || body?.organisation || 'jsinnovia');
  const preliminaryInput = validateJobInput(resolvedBody);
  const centers = await crm(`client_cost_centers?select=id,client_id,metadata&client_id=eq.${encodeURIComponent(preliminaryInput.clientId)}&is_active=eq.true&limit=100`);
  const input = validateJobInput(resolveCostScope(resolvedBody, centers));
  const provider = chooseProvider(resolvedBody.provider);
  const referenceIds = input.referenceDocumentIds || [];
  const sourceIds = referenceIds.length ? referenceIds : (input.sourceDocumentId ? [input.sourceDocumentId] : []);
  const sourceDocuments = [];

  if (sourceIds.length) {
    if (provider !== 'xai') throw new Error('Les images source Cockpit nécessitent Grok Imagine.');
    for (const documentId of sourceIds) {
      const sourceDocument = await getDocumentBufferForUser(user, documentId);
      if (!String(sourceDocument.record.mime_type || '').toLowerCase().startsWith('image/')) throw new Error(`Le document ${documentId} n’est pas une image.`);
      sourceDocuments.push({ documentId, ...sourceDocument });
    }
  }

  const referenceMode = referenceIds.length > 1;
  const request = buildProviderRequest(provider, input.prompt, { referenceImageDataUris: referenceMode ? sourceDocuments.map(() => 'data:image/placeholder;base64,') : [] });
  const job = await insertJob({
    client_id: input.clientId, client_name: input.clientName, project_id: input.projectId, cost_center_id: input.costCenterId,
    provider, model: request.model, status: 'queued', prompt: input.prompt, campaign_name: input.campaign,
    duration_seconds: 8, resolution: provider === 'xai' ? (referenceMode ? '720p' : '1080p') : '1280x720', aspect_ratio: '16:9', version: input.version,
    metadata: {
      sector: input.sector,
      usage_rights: input.usageRights,
      rights_confirmed: input.rightsConfirmed,
      requested_by: user?.id || user?.email || null,
      task_id: String(resolvedBody.task_id || '').trim() || null,
      agent_run_id: String(resolvedBody.agent_run_id || '').trim() || null,
      organisation: String(user?.organisation || 'jsinnovia'),
      source_document_id: input.sourceDocumentId,
      end_source_document_id: input.endSourceDocumentId,
      reference_document_ids: referenceIds,
      reference_mode: referenceMode,
      source_media: sourceDocuments.map((source) => ({ document_id: source.documentId, filename: source.record.filename, dropbox_path: source.record.dropbox_path })),
    },
    created_by: user?.id || user?.email || null,
  });
  processJob(job).catch(() => {});
  return { job, journal_id: `video-generation-${job.id}` };
}

router.post('/jobs', async (req, res) => {
  try {
    return res.status(202).json(await createVideoGenerationJob(req.body, req.user));
  } catch (error) { return res.status(400).json({ error: error.message }); }
});

module.exports = { router, startVideoGenerationScheduler, sweep, processJob, crmKeys, resolveClientInput, canonicalClientName, normalizeClientRows, listVideoClients, createVideoGenerationJob, completeLinkedExecution, failLinkedExecution };
