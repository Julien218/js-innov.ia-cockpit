const express = require('express');
const crypto = require('crypto');

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
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

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
  const response = await fetch(baseUrl + endpoint, {
    method,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      ...(body !== undefined && !headers['Content-Type'] ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body } : {}),
  });
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

function collectionRoutes(path, table, filters, sanitize) {
  router.get(path, async (req, res) => {
    try {
      return res.json(await listRows(table, req, filters));
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get(path + '/:id', async (req, res) => {
    const id = validId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
      const row = await findRow(table, id);
      return row ? res.json(row) : res.status(404).json({ error: 'Ressource introuvable.' });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post(path, async (req, res) => {
    try {
      const row = await createRow(table, sanitize(req.body, { req }));
      return row ? res.status(201).json(row) : res.status(502).json({ error: 'Création non confirmée.' });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.patch(path + '/:id', async (req, res) => {
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

  router.delete(path + '/:id', async (req, res) => {
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
      if (existing.response.ok) return;
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

router.post(
  '/upload',
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  async (req, res) => {
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!body.length) return res.status(400).json({ error: 'Fichier vide.' });
      if (body.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'Fichier trop volumineux (100 Mo maximum).' });

      const originalName = decodeFileName(req.get('x-file-name'));
      const extension = extensionOf(originalName);
      const storagePath = 'media/' + new Date().toISOString().slice(0, 10) + '/' + crypto.randomUUID() + extension;
      await ensureStorageBucket();
      await request(
        SUPABASE_URL,
        '/storage/v1/object/' + encodeURIComponent(STORAGE_BUCKET) + '/' + encodedStoragePath(storagePath),
        {
          method: 'POST',
          body,
          headers: {
            'Content-Type': req.get('content-type') || 'application/octet-stream',
            'x-upsert': 'false',
          },
          key: SUPABASE_KEY,
        },
      );
      const publicUrl = SUPABASE_URL
        + '/storage/v1/object/public/'
        + encodeURIComponent(STORAGE_BUCKET)
        + '/'
        + encodedStoragePath(storagePath);
      return res.status(201).json({
        url: publicUrl,
        file_url: publicUrl,
        path: storagePath,
        bucket: STORAGE_BUCKET,
        name: originalName,
        mime_type: req.get('content-type') || 'application/octet-stream',
        size: body.length,
      });
    } catch (error) {
      return sendError(res, error);
    }
  },
);

module.exports = router;
