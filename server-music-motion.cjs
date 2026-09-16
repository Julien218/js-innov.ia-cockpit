/* Authenticated, opt-in xAI bridge for Music Motion. One consent = one request.
 * No API key, prompt or temporary provider URL is returned in public job records.
 * Requires a persistent data directory. Unknown submission outcomes are never retried.
 */
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createAudioLibraryRouter } = require('./server-audio-library.cjs');

function createRouter({ fetchImpl = (...args) => fetch(...args), env = process.env } = {}) {
  const router = express.Router();
  if (typeof router.use === 'function') router.use('/audio', createAudioLibraryRouter({ fetchImpl, env }));
  const spaces = new Map(), active = new Set(), pollLocks = new Set();
  const models = { image: env.MUSIC_MOTION_XAI_IMAGE_MODEL || 'grok-imagine-image-2.0', video: env.MUSIC_MOTION_XAI_VIDEO_MODEL || 'grok-imagine-video-1.5' };
  const ready = () => Boolean(env.XAI_API_KEY && env.MUSIC_MOTION_DATA_DIR);
  const core = () => import('./local-agent/music-motion-engine.mjs');
  const error = (message, status = 400) => Object.assign(new Error(message), { status });
  const expose = job => ({ id: job.id, type: job.type, status: job.status, stage: job.stage, error: job.error,
    result: job.result, model: job.model, created_at: job.created_at, updated_at: job.updated_at,
    billing: { authorization: 'one_request', actual_cost: null, currency: 'USD', note: 'Montant réel à vérifier dans le compte fournisseur.' } });
  async function userSpace(req) {
    if (!req.user?.id) throw error('Session requise.', 401);
    if (!ready()) throw error('Configurer XAI_API_KEY et MUSIC_MOTION_DATA_DIR sur un volume persistant avant toute génération payante.', 503);
    const id = crypto.createHash('sha256').update(String(req.user.id)).digest('hex');
    if (!spaces.has(id)) spaces.set(id, core().then(async ({ Workspace }) => { const ws = await new Workspace(path.join(env.MUSIC_MOTION_DATA_DIR, id)).init(); await ws.recover(); return ws; }));
    return { id, ws: await spaces.get(id) };
  }
  async function api(endpoint, body) {
    const r = await fetchImpl('https://api.x.ai/v1' + endpoint, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body ? 180000 : 30000), redirect: 'error' });
    if (!r.ok) { await r.body?.cancel(); throw error(`Fournisseur xAI HTTP ${r.status}. Aucune nouvelle soumission automatique.`, 502); }
    const value = await r.json();
    return value;
  }
  async function boundedResponse(response, maximum) {
    if (!response.ok || Number(response.headers.get('content-length')) > maximum) throw error('Résultat distant invalide ou trop volumineux.', 502);
    const chunks = []; let length = 0;
    for await (const c of response.body) { length += c.length; if (length > maximum) { throw error('Résultat distant trop volumineux.', 413); } chunks.push(c); }
    return Buffer.concat(chunks);
  }
  async function download(url) {
    const u = new URL(url);
    // Exact hosts only, no redirects, private IPs, user URLs, cookies or API credentials.
    const allowed = new Set(['vidgen.x.ai', 'imgen.x.ai']);
    for (const h of String(env.MUSIC_MOTION_XAI_MEDIA_HOSTS || '').split(',').filter(Boolean)) if (/^[a-z0-9.-]+\.x\.ai$/.test(h.trim())) allowed.add(h.trim());
    if (u.protocol !== 'https:' || u.port || u.username || u.password || !allowed.has(u.hostname)) throw error('Hôte du média fournisseur non autorisé. Vérifier la configuration serveur, sans réexécuter la génération.', 502);
    return boundedResponse(await fetchImpl(u.href, { redirect: 'error', signal: AbortSignal.timeout(120000) }), 256 * 1024 * 1024);
  }
  async function finish(ws, job, bytes, name) {
    const { probe } = await core();
    const asset = await ws.putAsset(bytes, name);
    if (job.type === 'video' && !asset.mime.startsWith('video/')) throw error('Le fournisseur n’a pas produit une vidéo.', 502);
    if (job.type === 'image' && !asset.mime.startsWith('image/')) throw error('Le fournisseur n’a pas produit une image.', 502);
    const metadata = job.type === 'video' ? await probe((await ws.asset(asset.id)).path) : {};
    if (job.type === 'video' && (!metadata.has_video || !(metadata.duration_seconds > 0))) throw error('Vidéo distante non décodable.', 502);
    job.status = 'completed'; job.result = { asset: { ...asset, ...metadata }, kind: `generated-${job.type}` }; job.stage = 'Média récupéré et conservé sur le serveur.';
    await ws.saveJob(job);
  }
  async function poll(ws, job) {
    const lock = ws.root + ':' + job.id;
    if (pollLocks.has(lock) || job.status !== 'submitted') return job;
    pollLocks.add(lock);
    try {
      const result = await api('/videos/' + encodeURIComponent(job.provider_request_id));
      if (result.status === 'done') {
        if (result.video?.respect_moderation === false) throw error('Génération refusée par le fournisseur.', 422);
        await finish(ws, job, await download(result.video?.url), 'generation.mp4');
      } else if (['failed','expired'].includes(result.status)) { job.status = 'failed'; job.error = 'Le fournisseur a terminé sans vidéo exploitable (' + result.status + ').'; await ws.saveJob(job); }
    } catch (e) { job.stage = 'Récupération à vérifier : ' + e.message; await ws.saveJob(job); }
    finally { pollLocks.delete(lock); }
    return job;
  }
  async function submit(ws, job, source) {
    try {
      job.status = 'running'; job.stage = 'Soumission unique au fournisseur.'; await ws.saveJob(job);
      const image = source ? { url: source } : undefined;
      if (job.type === 'video') {
        const result = await api('/videos/generations', { model: job.model, prompt: job.input.prompt, image, duration: job.input.duration_seconds, resolution: '720p', ...(job.model === 'grok-imagine-video-1.5' ? { generate_audio: false } : {}) });
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(result.request_id || '')) throw error('Réponse sans identifiant de traitement. Vérifier le compte fournisseur avant de relancer.', 502);
        job.provider_request_id = result.request_id; job.status = 'submitted'; job.stage = 'Génération chez xAI ; récupération automatique en cours.'; await ws.saveJob(job);
        for (let n = 0; n < 180 && job.status === 'submitted'; n++) { await new Promise(r => setTimeout(r, 5000)); job = await poll(ws, await ws.job(job.id)); }
      } else {
        const result = await api(image ? '/images/edits' : '/images/generations', { model: job.model, prompt: job.input.prompt, n: 1, response_format: 'b64_json', aspect_ratio: job.input.format, ...(image ? { image } : {}) });
        const item = result.data?.[0];
        if (!item || item.respect_moderation === false) throw error('Aucune image autorisée reçue.', 502);
        const bytes = item.b64_json ? Buffer.from(item.b64_json, 'base64') : await download(item.url);
        await finish(ws, job, bytes, 'generation.jpg');
      }
    } catch (e) {
      // Fail closed even after an ambiguous timeout: never issue a second paid POST.
      job.status = job.provider_request_id ? 'submitted' : 'failed'; job.error = e.message; await ws.saveJob(job);
    } finally { active.delete(ws.root + ':' + job.id); }
  }
  const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Traitement Music Motion indisponible.' }); } };
  router.get('/capabilities', (req, res) => res.json({ provider: 'xai', available: ready(), models, price_known: false, max_requests_per_consent: 1,
    warning: ready() ? 'Chaque génération est facturable. Prix réel à vérifier chez xAI ; aucun lot automatique.' : 'API ou stockage persistant non configurés. Aucune génération payante disponible.' }));
  router.post('/jobs', wrap(async (req, res) => {
    const { id, ws } = await userSpace(req), b = req.body || {};
    if (!['image','video'].includes(b.type) || typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 24000) throw error('Type ou prompt invalide.');
    if (b.consent?.paid !== true || b.consent?.external_transfer !== true || b.consent?.one_request !== true) throw error('Autorisation explicite requise : une demande payante et transfert de la référence à xAI.', 403);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(b.request_id || '')) throw error('Identifiant idempotent requis.');
    if (b.type === 'video' && (!Number.isInteger(b.duration_seconds) || b.duration_seconds < 1 || b.duration_seconds > 15)) throw error('Durée requise entre 1 et 15 secondes.');
    if (b.image_data_url && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.image_data_url) || b.image_data_url.length > 18 * 1024 * 1024)) throw error('Référence image invalide ou supérieure à 13 Mo.');
    if (b.type === 'video' && !b.image_data_url) throw error('Image de départ requise.');
    if (b.image_data_url) { const {detectMedia}=await core(); const mime=detectMedia(Buffer.from(b.image_data_url.split(',')[1],'base64'),'reference')[0]; if(!mime.startsWith('image/'))throw error('Les octets de la référence ne sont pas une image.'); }
    const input = { request_id: b.request_id, type: b.type, prompt: b.prompt, duration_seconds: b.duration_seconds || null, format: ['16:9','9:16','1:1'].includes(b.format) ? b.format : '16:9', source_sha256: b.image_data_url ? crypto.createHash('sha256').update(b.image_data_url).digest('hex') : null, consent: { paid:true, external_transfer:true, one_request:true } };
    const admission = 'admission:' + id; if (active.has(admission)) throw error('Une soumission est déjà en cours.',409); active.add(admission);
    try {
    // Quota is a request-count ceiling, not a claimed monetary budget. No automatic retries.
    const today = new Date().toISOString().slice(0,10); let count = 0;
    for (const file of await fs.readdir(path.join(ws.root, 'jobs'))) { if (file.endsWith('.json')) { const j = await ws.job(file.slice(0,-5)); if (j.created_at?.startsWith(today)) count++; if (j.id !== input.request_id && ['queued','running','submitted'].includes(j.status)) throw error('Une demande payante est déjà en cours pour ce compte.', 409); } }
    const max = Math.max(1, Math.min(100, Number(env.MUSIC_MOTION_DAILY_REQUEST_LIMIT) || 20));
    if (count >= max) { const old = await ws.job(input.request_id).catch(() => null); if (!old) throw error('Plafond journalier de demandes atteint.', 429); }
      const { job, created } = await ws.createJob(input);
      if (created) { job.model = models[b.type]; await ws.saveJob(job); const key = ws.root + ':' + job.id; active.add(key); void submit(ws, job, b.image_data_url || null); }
      res.status(created ? 202 : 200).json(expose(job));
    } finally { active.delete(admission); }
  }));
  router.get('/jobs/:id', wrap(async (req, res) => { const { ws } = await userSpace(req); let job = await ws.job(req.params.id); if (job.status === 'submitted' && !active.has(ws.root+':'+job.id)) job = await poll(ws,job); res.json(expose(job)); }));
  router.get('/jobs/:id/media', wrap(async (req,res) => { const { ws } = await userSpace(req), job = await ws.job(req.params.id); if (job.status !== 'completed') throw error('Le média n’est pas prêt.',409); const asset = await ws.asset(job.result.asset.id); res.set({ 'Content-Type':asset.mime, 'Content-Length':asset.bytes, 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store' }); createReadStream(asset.path).pipe(res); }));
  return router;
}
module.exports = { createRouter, router: createRouter() };