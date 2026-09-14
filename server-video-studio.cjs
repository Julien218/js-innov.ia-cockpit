const express = require('express');
const crypto = require('crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('stream');

const router = express.Router();

const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://rzvvwcwyaddzsaattwqt.supabase.co'
).replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const CRM_URL = String(process.env.SUPABASE_CRM_URL || SUPABASE_URL).replace(/\/+$/, '');
const CRM_KEY = process.env.SUPABASE_CRM_KEY || SUPABASE_KEY;
const STORAGE_BUCKET = 'video-studio';
const SINGLE_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000;
const uploadSessions = new Map();

let bucketReadyPromise = null;

const PROJECT_JSON_FIELDS = new Set(['clips', 'texts', 'template_tracks', 'metadata']);
const PROJECT_TEXT_FIELDS = new Set([
  'title',
  'audio_url',
  'audio_name',
  'transition',
  'status',
  'project_id',
  'ai_prompt',
  'drive_url',
  'drive_file_id',
  'template_format',
]);
const PROJECT_NUMBER_FIELDS = new Set(['audio_duration_seconds', 'template_duration']);
const EXPORT_TEXT_FIELDS = new Set(['video_project_id', 'title', 'format', 'export_type', 'file_url']);
const EXPORT_NUMBER_FIELDS = new Set(['file_size_mb', 'duration_seconds']);

function configurationError() {
  const error = new Error('Stockage vidéo non configuré côté serveur.');
  error.status = 503;
  return error;
}

function requireConfiguration(key = SUPABASE_KEY) {
  if (!key) throw configurationError();
}

function asText(value, fallback = null, max = 10000) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text ? text.slice(0, max) : fallback;
}

function asNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function validId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : null;
}

function queryValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function encodedStoragePath(value) {
  return String(value).split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function request(baseUrl, endpoint, {
  method = 'GET',
  body,
  headers = {},
  key = SUPABASE_KEY,
  allowError = false,
} = {}) {
  requireConfiguration(key);
  const streamBody = body && typeof body.pipe === 'function';
  const fetchOptions = {
    method,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      ...(body !== undefined && !headers['Content-Type'] ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
    ...(streamBody ? { duplex: 'half' } : {}),
  };
  const response = await fetch(baseUrl + endpoint, fetchOptions);
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!response.ok && !allowError) {
    const message = data && typeof data === 'object'
      ? data.message || data.error_description || data.error
      : data;
    const error = new Error('Supabase ' + response.status + (message ? ' : ' + String(message).slice(0, 300) : ''));
    error.status = response.status >= 500 ? 502 : response.status;
    throw error;
  }
  return { response, data };
}

async function rest(baseUrl, table, options = {}) {
  const [tableName, query = ''] = String(table).split('?');
  const endpoint = '/rest/v1/' + encodeURIComponent(tableName) + (query ? '?' + query : '');
  const result = await request(baseUrl, endpoint, options);
  return result.data;
}

function jsonBody(value) {
  return JSON.stringify(value);
}

function actor(req) {
  return String(req.user?.id || req.user?.email || 'cockpit').slice(0, 240);
}

function projectPayload(body = {}, { partial = false, req } = {}) {
  const output = {};
  for (const field of PROJECT_TEXT_FIELDS) {
    if (!partial || hasOwn(body, field)) {
      output[field] = field === 'title' && partial && !String(body[field] || '').trim()
        ? 'Nouveau montage'
        : asText(body[field], partial ? null : field === 'title' ? 'Nouveau montage' : '', field === 'ai_prompt' ? 100000 : 10000);
    }
  }
  for (const field of PROJECT_NUMBER_FIELDS) {
    if (!partial || hasOwn(body, field)) output[field] = asNumber(body[field], partial ? null : 0);
  }
  for (const field of PROJECT_JSON_FIELDS) {
    if (!partial || hasOwn(body, field)) {
      const value = body[field];
      if (field === 'clips' || field === 'texts') output[field] = Array.isArray(value) ? value : [];
      else if (value && typeof value === 'object' && !Array.isArray(value)) output[field] = value;
      else if (field === 'template_tracks') output[field] = Array.isArray(value) ? value : [];
      else output[field] = {};
    }
  }
  if (!partial) {
    output.transition = output.transition || 'fade';
    output.status = output.status || 'draft';
    output.created_by = actor(req);
  }
  return output;
}

function exportPayload(body = {}, { partial = false, req } = {}) {
  const output = {};
  for (const field of EXPORT_TEXT_FIELDS) {
    if (!partial || hasOwn(body, field)) {
      output[field] = field === 'video_project_id'
        ? asText(body[field], null, 160)
        : asText(body[field], partial ? null : '', field === 'file_url' ? 2000 : 10000);
    }
  }
  for (const field of EXPORT_NUMBER_FIELDS) {
    if (!partial || hasOwn(body, field)) output[field] = asNumber(body[field], partial ? null : 0);
  }
  if (!partial) output.created_by = actor(req);
  return output;
}

async function listRows(table, req, allowedFilters = []) {
  const query = new URLSearchParams({
    select: '*',
    order: 'created_date.desc',
    limit: '100',
  });
  for (const field of allowedFilters) {
    const value = queryValue(req.query?.[field]);
    if (value === undefined || value === null || value === '') continue;
    const safe = validId(value);
    if (!safe) {
      const error = new Error('Filtre invalide.');
      error.status = 400;
      throw error;
    }
    query.set(field, 'eq.' + safe);
  }
  const rows = await rest(SUPABASE_URL, table + '?' + query.toString(), { key: SUPABASE_KEY });
  return Array.isArray(rows) ? rows : [];
}

async function findRow(table, id) {
  const query = new URLSearchParams({ select: '*', id: 'eq.' + id, limit: '1' });
  const rows = await rest(SUPABASE_URL, table + '?' + query.toString(), { key: SUPABASE_KEY });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function createRow(table, payload) {
  const rows = await rest(SUPABASE_URL, table, {
    method: 'POST',
    body: jsonBody(payload),
    headers: { Prefer: 'return=representation' },
    key: SUPABASE_KEY,
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function updateRow(table, id, payload) {
  const rows = await rest(SUPABASE_URL, table + '?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    body: jsonBody(payload),
    headers: { Prefer: 'return=representation' },
    key: SUPABASE_KEY,
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

function sendError(res, error) {
  console.error('[video-studio]', error?.message || error);
  return res.status(error?.status || 502).json({
    error: error?.message || 'Erreur du studio vidéo.',
  });
}

function collectionRoutes(routePath, table, filters, sanitize) {
  router.get(routePath, async (req, res) => {
    try {
      return res.json(await listRows(table, req, filters));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get(routePath + '/:id', async (req, res) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
      const row = await findRow(table, id);
      return row ? res.json(row) : res.status(404).json({ error: 'Ressource introuvable.' });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post(routePath, async (req, res) => {
    try {
      const row = await createRow(table, sanitize(req.body, { req }));
      return row ? res.status(201).json(row) : res.status(502).json({ error: 'Création non confirmée.' });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.patch(routePath + '/:id', async (req, res) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
      const row = await updateRow(table, id, {
        ...sanitize(req.body, { partial: true, req }),
        updated_date: new Date().toISOString(),
      });
      return row ? res.json(row) : res.status(404).json({ error: 'Ressource introuvable.' });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.delete(routePath + '/:id', async (req, res) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
      await rest(SUPABASE_URL, table + '?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        key: SUPABASE_KEY,
      });
      return res.status(204).end();
    } catch (error) {
      return sendError(res, error);
    }
  });
}

collectionRoutes('/projects', 'VideoProject', ['id', 'project_id'], projectPayload);
collectionRoutes('/exports', 'VideoExport', ['id', 'video_project_id'], exportPayload);

router.get('/source-projects', async (req, res) => {
  try {
    requireConfiguration(CRM_KEY);
    const projectId = queryValue(req.query?.id);
    const query = new URLSearchParams({ select: '*', order: 'created_at.desc', limit: '100' });
    if (projectId) {
      const safeProjectId = validId(projectId);
      if (!safeProjectId) return res.status(400).json({ error: 'Identifiant de projet invalide.' });
      query.set('id', 'eq.' + safeProjectId);
    }
    const projects = await rest(CRM_URL, 'Projet?' + query.toString(), { key: CRM_KEY });
    const rows = Array.isArray(projects) ? projects : [];
    const mapped = await Promise.all(rows.map(async (project) => {
      const result = {
        ...project,
        project_name: project.project_name || project.nom || '',
        artworks_images: [],
      };
      if (!project.id) return result;
      const assetsQuery = new URLSearchParams({
        select: 'fichier_url,type_media',
        projet_id: 'eq.' + project.id,
        limit: '100',
      });
      const assets = await rest(CRM_URL, 'Asset?' + assetsQuery.toString(), { key: CRM_KEY }).catch(() => []);
      result.artworks_images = (Array.isArray(assets) ? assets : [])
        .filter((asset) => !asset.type_media || /image/i.test(asset.type_media))
        .map((asset) => asset.fichier_url)
        .filter(Boolean);
      return result;
    }));
    return res.json(mapped);
  } catch (error) {
    return sendError(res, error);
  }
});

async function ensureStorageBucket() {
  requireConfiguration();
  if (!bucketReadyPromise) {
    bucketReadyPromise = (async () => {
      const existing = await request(
        SUPABASE_URL,
        '/storage/v1/bucket/' + encodeURIComponent(STORAGE_BUCKET),
        { key: SUPABASE_KEY, allowError: true },
      );
      if (existing.response.ok) {
        const update = await request(
          SUPABASE_URL,
          '/storage/v1/bucket/' + encodeURIComponent(STORAGE_BUCKET),
          {
            method: 'PUT',
            body: jsonBody({ public: true, file_size_limit: MAX_UPLOAD_BYTES }),
            key: SUPABASE_KEY,
            allowError: true,
          },
        );
        if (!update.response.ok) console.warn('[video-studio] limite du bucket non mise à jour:', update.response.status);
        return;
      }
      if (existing.response.status !== 404) {
        const error = new Error('Vérification du bucket Storage impossible.');
        error.status = 502;
        throw error;
      }
      const created = await request(SUPABASE_URL, '/storage/v1/bucket', {
        method: 'POST',
        body: jsonBody({
          id: STORAGE_BUCKET,
          name: STORAGE_BUCKET,
          public: true,
          file_size_limit: MAX_UPLOAD_BYTES,
        }),
        key: SUPABASE_KEY,
        allowError: true,
      });
      if (!created.response.ok && created.response.status !== 409) {
        const error = new Error('Création du bucket Storage impossible.');
        error.status = 502;
        throw error;
      }
    })().catch((error) => {
      bucketReadyPromise = null;
      throw error;
    });
  }
  return bucketReadyPromise;
}

function decodeFileName(value) {
  const raw = String(value || 'media.bin');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function extensionOf(fileName) {
  const match = String(fileName).toLowerCase().match(/(\.[a-z0-9]{1,12})$/);
  return match ? match[1] : '';
}

function validStoragePath(value) {
  const storagePath = String(value || '').trim();
  return /^media\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}(?:\.[a-z0-9]{1,12})?$/.test(storagePath)
    ? storagePath
    : null;
}

function mediaProxyUrl(storagePath, { download = false } = {}) {
  return '/api/video-studio/media?path=' + encodeURIComponent(storagePath) + (download ? '&download=1' : '');
}

function mediaResponse(storagePath, originalName, mimeType, size) {
  const publicUrl = SUPABASE_URL
    + '/storage/v1/object/public/'
    + encodeURIComponent(STORAGE_BUCKET)
    + '/'
    + encodedStoragePath(storagePath);
  const mediaUrl = mediaProxyUrl(storagePath);
  return {
    url: mediaUrl,
    file_url: mediaUrl,
    media_url: mediaUrl,
    download_url: mediaProxyUrl(storagePath, { download: true }),
    public_url: publicUrl,
    path: storagePath,
    bucket: STORAGE_BUCKET,
    name: originalName,
    mime_type: mimeType || 'application/octet-stream',
    size,
  };
}

async function removeUploadSession(id) {
  const item = uploadSessions.get(id);
  uploadSessions.delete(id);
  if (item?.tempPath) await fsp.rm(item.tempPath, { force: true }).catch(() => null);
}

async function cleanupExpiredUploadSessions() {
  const now = Date.now();
  await Promise.all([...uploadSessions.entries()]
    .filter(([, item]) => item.expiresAt < now)
    .map(([id]) => removeUploadSession(id)));
}

function uploadSessionFor(req) {
  const id = validId(req.params.id);
  const item = id ? uploadSessions.get(id) : null;
  if (!item) return { error: 'Session d’upload absente ou expirée.', status: 404 };
  if (item.userId !== actor(req)) return { error: 'Cette session d’upload appartient à un autre compte.', status: 403 };
  if (item.expiresAt < Date.now()) {
    removeUploadSession(id).catch(() => null);
    return { error: 'Session d’upload expirée. Relancez l’import.', status: 410 };
  }
  return { id, item };
}

router.get('/media', async (req, res) => {
  const storagePath = validStoragePath(req.query?.path);
  if (!storagePath) return res.status(400).json({ error: 'Chemin média invalide.' });
  try {
    requireConfiguration();
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
    };
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(
      SUPABASE_URL
        + '/storage/v1/object/'
        + encodeURIComponent(STORAGE_BUCKET)
        + '/'
        + encodedStoragePath(storagePath),
      { headers },
    );
    if (!upstream.ok && upstream.status !== 206) {
      const error = new Error('Média introuvable dans le stockage (' + upstream.status + ').');
      error.status = upstream.status === 404 ? 404 : 502;
      throw error;
    }

    res.status(upstream.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (String(req.query?.download || '') === '1') {
      const extension = extensionOf(storagePath) || '.bin';
      res.setHeader('Content-Disposition', 'attachment; filename="music-motion' + extension + '"');
    }
    if (upstream.body && typeof Readable.fromWeb === 'function') {
      return Readable.fromWeb(upstream.body).pipe(res);
    }
    return res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    return sendError(res, error);
  }
});

// Petit fichier : chemin historique, conservé pour compatibilité.
router.post(
  '/upload',
  express.raw({ type: () => true, limit: SINGLE_UPLOAD_BYTES }),
  async (req, res) => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!body.length) return res.status(400).json({ error: 'Fichier vide.' });
      if (body.length > SINGLE_UPLOAD_BYTES) return res.status(413).json({ error: 'Fichier supérieur à 100 Mo : utilisez l’upload segmenté du Studio.' });

      const originalName = decodeFileName(req.get('x-file-name'));
      const mimeType = req.get('content-type') || 'application/octet-stream';
      const storagePath = 'media/' + new Date().toISOString().slice(0, 10) + '/' + crypto.randomUUID() + extensionOf(originalName);
      await ensureStorageBucket();
      await request(
        SUPABASE_URL,
        '/storage/v1/object/' + encodeURIComponent(STORAGE_BUCKET) + '/' + encodedStoragePath(storagePath),
        {
          method: 'POST',
          body,
          headers: { 'Content-Type': mimeType, 'x-upsert': 'false' },
          key: SUPABASE_KEY,
        },
      );
      return res.status(201).json(mediaResponse(storagePath, originalName, mimeType, body.length));
    } catch (error) {
      return sendError(res, error);
    }
  },
);

// Gros fichier : le navigateur envoie des blocs de 8 Mo. Aucun buffer géant n’est gardé en RAM.
router.post('/upload-session', async (req, res) => {
  try {
    await cleanupExpiredUploadSessions();
    const originalName = asText(req.body?.name || req.body?.file_name, 'media.bin', 240);
    const mimeType = asText(req.body?.mime_type, 'application/octet-stream', 160);
    const size = Number(req.body?.size || 0);
    if (!Number.isSafeInteger(size) || size <= 0) return res.status(400).json({ error: 'Taille de fichier invalide.' });
    if (size > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Fichier trop volumineux (1 Go maximum par import).' });

    const id = crypto.randomUUID();
    const tempPath = path.join(os.tmpdir(), `jsinnovia-video-${id}.part`);
    await fsp.writeFile(tempPath, Buffer.alloc(0));
    uploadSessions.set(id, {
      userId: actor(req),
      originalName,
      mimeType,
      size,
      received: 0,
      tempPath,
      expiresAt: Date.now() + UPLOAD_SESSION_TTL_MS,
    });
    return res.status(201).json({
      upload_id: id,
      chunk_size: UPLOAD_CHUNK_BYTES,
      max_size: MAX_UPLOAD_BYTES,
      received: 0,
      size,
      expires_in: Math.floor(UPLOAD_SESSION_TTL_MS / 1000),
    });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post(
  '/upload-session/:id/chunk',
  express.raw({ type: () => true, limit: UPLOAD_CHUNK_BYTES + 64 * 1024 }),
  async (req, res) => {
    const resolved = uploadSessionFor(req);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!body.length) return res.status(400).json({ error: 'Bloc vide.' });
      if (body.length > UPLOAD_CHUNK_BYTES) return res.status(413).json({ error: 'Bloc trop volumineux.' });
      const offset = Number(req.get('x-upload-offset') || resolved.item.received);
      if (!Number.isSafeInteger(offset) || offset !== resolved.item.received) {
        return res.status(409).json({ error: 'Décalage d’upload incorrect.', expected_offset: resolved.item.received });
      }
      if (resolved.item.received + body.length > resolved.item.size) {
        return res.status(413).json({ error: 'Le fichier reçu dépasse la taille annoncée.' });
      }
      await fsp.appendFile(resolved.item.tempPath, body);
      resolved.item.received += body.length;
      resolved.item.expiresAt = Date.now() + UPLOAD_SESSION_TTL_MS;
      return res.json({ upload_id: resolved.id, received: resolved.item.received, size: resolved.item.size });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

router.post('/upload-session/:id/complete', async (req, res) => {
  const resolved = uploadSessionFor(req);
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  const { item, id } = resolved;
  try {
    if (item.received !== item.size) {
      return res.status(409).json({ error: 'Upload incomplet.', received: item.received, size: item.size });
    }
    const stat = await fsp.stat(item.tempPath);
    if (stat.size !== item.size) throw new Error('La taille assemblée ne correspond pas au fichier attendu.');

    await ensureStorageBucket();
    const storagePath = 'media/' + new Date().toISOString().slice(0, 10) + '/' + crypto.randomUUID() + extensionOf(item.originalName);
    const stream = fs.createReadStream(item.tempPath);
    await request(
      SUPABASE_URL,
      '/storage/v1/object/' + encodeURIComponent(STORAGE_BUCKET) + '/' + encodedStoragePath(storagePath),
      {
        method: 'POST',
        body: stream,
        headers: {
          'Content-Type': item.mimeType,
          'Content-Length': String(item.size),
          'x-upsert': 'false',
        },
        key: SUPABASE_KEY,
      },
    );
    const payload = mediaResponse(storagePath, item.originalName, item.mimeType, item.size);
    await removeUploadSession(id);
    return res.status(201).json(payload);
  } catch (error) {
    return sendError(res, error);
  }
});

router.delete('/upload-session/:id', async (req, res) => {
  const resolved = uploadSessionFor(req);
  if (resolved.error && resolved.status !== 404) return res.status(resolved.status).json({ error: resolved.error });
  if (resolved.id) await removeUploadSession(resolved.id);
  return res.status(204).end();
});

module.exports = router;
module.exports.uploadLimits = {
  single: SINGLE_UPLOAD_BYTES,
  chunk: UPLOAD_CHUNK_BYTES,
  max: MAX_UPLOAD_BYTES,
};
