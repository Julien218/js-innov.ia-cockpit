const express = require('express');
const path = require('path');
const { Readable } = require('node:stream');
const { dropboxApiArg } = require('./server-dropbox-helper.cjs');

const router = express.Router();

const DROPBOX_ROOT_PATH = process.env.DROPBOX_ROOT_PATH || '/JS-Innov.IA/Cockpit';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LIST_LIMIT = 200;

const SUPABASE_URL = process.env.SUPABASE_CRM_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_CRM_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const AGENT_URL = process.env.VITE_AGENT_URL || process.env.JSINNOVIA_AGENT_URL || 'https://jsinnovia-agent-production.up.railway.app';
const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif',
  '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'
]);
const PORTFOLIO_MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif',
  '.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v',
]);

let tokenCache = { token: '', expiresAt: 0 };

function assertSupabaseConfigured() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase CRM non configuré pour l’index documentaire');
  }
}

function isDropboxConfigured() {
  return Boolean(
    process.env.DROPBOX_ACCESS_TOKEN ||
    (process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN)
  );
}

function sanitizeSegment(value, fallback = 'general') {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '-')
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return clean || fallback;
}

function sanitizeFilename(filename) {
  const base = path.basename(String(filename || 'document'));
  const clean = sanitizeSegment(base, 'document');
  const ext = path.extname(clean).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Type de fichier non autorisé (${ext || 'sans extension'})`);
  }
  return clean.slice(0, 180);
}

function validateBuffer(filename, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Fichier vide ou invalide');
  if (buffer.length > MAX_FILE_BYTES) throw new Error('Fichier trop volumineux (maximum 10 Mo)');
  sanitizeFilename(filename);
}

function resolveOrganisation(user, requested) {
  if (user?.role === 'superadmin' && requested) return sanitizeSegment(requested, 'jsinnovia');
  return sanitizeSegment(user?.organisation || 'jsinnovia', 'jsinnovia');
}

async function agentDocumentRequest(resource, options = {}) {
  if (!AGENT_KEY) throw new Error('Clé Agent API manquante pour l’index documentaire');
  const method = options.method || 'GET';
  const [table, rawQuery = ''] = resource.split('?');
  if (table !== 'DocumentIndex') throw new Error('Ressource documentaire non autorisée');

  let target = `${AGENT_URL.replace(/\/$/, '')}/data/DocumentIndex`;
  if (method === 'GET') {
    const params = new URLSearchParams(rawQuery);
    const idFilter = params.get('id');
    if (idFilter?.startsWith('eq.')) {
      target += `/${encodeURIComponent(idFilter.slice(3))}`;
    } else {
      const query = new URLSearchParams();
      const mappings = [
        ['organisation', 'organisation'],
        ['brand', 'brand'],
        ['client_id', 'client_id'],
        ['category', 'category'],
      ];
      for (const [source, destination] of mappings) {
        const value = params.get(source);
        if (value?.startsWith('eq.')) query.set(destination, value.slice(3));
      }
      query.set('sort', 'created_at');
      query.set('order', 'desc');
      query.set('limit', params.get('limit') || '200');
      target += `?${query.toString()}`;
    }
  }

  const response = await fetch(target, {
    ...options,
    headers: {
      'x-agent-key': AGENT_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Agent DocumentIndex HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
  if (!text) return null;
  const data = JSON.parse(text);
  return Array.isArray(data) ? data.filter((row) => !row.deleted_at) : data;
}

async function supabaseRequest(resource, options = {}) {
  if (AGENT_KEY) return agentDocumentRequest(resource, options);
  assertSupabaseConfigured();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase DocumentIndex HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

async function getDropboxAccessToken() {
  if (process.env.DROPBOX_ACCESS_TOKEN) return process.env.DROPBOX_ACCESS_TOKEN;
  if (!isDropboxConfigured()) throw new Error('Dropbox non configuré sur Railway');
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
  });
  const basic = Buffer.from(`${process.env.DROPBOX_APP_KEY}:${process.env.DROPBOX_APP_SECRET}`).toString('base64');
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Dropbox OAuth HTTP ${response.status}`);
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in || 14400)) * 1000,
  };
  return tokenCache.token;
}

function buildDropboxPath({ organisation, brand, clientId, category, filename }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const segments = [
    DROPBOX_ROOT_PATH.replace(/\/$/, ''),
    sanitizeSegment(brand || 'general'),
    sanitizeSegment(organisation || 'jsinnovia'),
    sanitizeSegment(clientId || '_general'),
    sanitizeSegment(category || 'documents'),
    `${stamp}-${sanitizeFilename(filename)}`,
  ];
  return segments.join('/').replace(/\/+/g, '/');
}

async function uploadToDropbox(buffer, dropboxPath) {
  const token = await getDropboxAccessToken();
  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: dropboxPath,
        mode: 'add',
        autorename: true,
        mute: true,
        strict_conflict: false,
      }),
    },
    body: buffer,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) throw new Error(`Dropbox upload HTTP ${response.status}`);
  return data;
}

async function deleteFromDropbox(reference) {
  const token = await getDropboxAccessToken();
  const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: reference }),
  });
  if (!response.ok) throw new Error(`Dropbox rollback HTTP ${response.status}`);
}

async function downloadFromDropbox(reference) {
  const response = await openDropboxDownload(reference);
  return Buffer.from(await response.arrayBuffer());
}

async function openDropboxDownload(reference, { range = '' } = {}) {
  const token = await getDropboxAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Dropbox-API-Arg': dropboxApiArg({ path: reference }),
  };
  if (/^bytes=(?:\d+-\d*|-\d+)$/i.test(String(range || ''))) headers.Range = range;
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers,
  });
  if (!response.ok) throw new Error(`Dropbox download HTTP ${response.status}`);
  return response;
}

function isPortfolioMedia(record = {}) {
  const mime = String(record.mime_type || '').toLowerCase();
  const extension = path.extname(String(record.filename || '')).toLowerCase();
  return mime.startsWith('image/') || mime.startsWith('video/') || PORTFOLIO_MEDIA_EXTENSIONS.has(extension);
}

async function indexDocument({ user, organisation, brand, clientId, category, filename, mimeType, sizeBytes, dropboxMeta, source = 'cockpit', emailMessageId = null }) {
  const payload = {
    tenant_id: organisation,
    organisation,
    brand: sanitizeSegment(brand || 'general'),
    client_id: clientId ? String(clientId).slice(0, 160) : null,
    category: sanitizeSegment(category || 'documents'),
    filename,
    mime_type: String(mimeType || 'application/octet-stream').slice(0, 160),
    size_bytes: Number(sizeBytes || 0),
    dropbox_path: dropboxMeta.path_display || dropboxMeta.path_lower,
    dropbox_file_id: dropboxMeta.id,
    content_hash: dropboxMeta.content_hash || null,
    source,
    email_message_id: emailMessageId,
    uploaded_by: user?.email || user?.id || 'system',
  };
  const rows = await supabaseRequest('DocumentIndex', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function storeBuffer({ user, organisation, brand, clientId, category, filename, mimeType, buffer, source, emailMessageId }) {
  if (!isDropboxConfigured()) throw new Error('Dropbox non configuré sur Railway');
  const safeFilename = sanitizeFilename(filename);
  validateBuffer(safeFilename, buffer);
  const resolvedOrganisation = resolveOrganisation(user, organisation);
  const dropboxPath = buildDropboxPath({
    organisation: resolvedOrganisation,
    brand,
    clientId,
    category,
    filename: safeFilename,
  });
  const dropboxMeta = await uploadToDropbox(buffer, dropboxPath);
  try {
    return await indexDocument({
      user,
      organisation: resolvedOrganisation,
      brand,
      clientId,
      category,
      filename: safeFilename,
      mimeType,
      sizeBytes: buffer.length,
      dropboxMeta,
      source,
      emailMessageId,
    });
  } catch (error) {
    try {
      await deleteFromDropbox(dropboxMeta.id || dropboxMeta.path_lower || dropboxMeta.path_display);
    } catch (rollbackError) {
      console.error('[documents] rollback Dropbox:', rollbackError.message);
    }
    throw error;
  }
}

function firstDocumentRecord(result) {
  if (Array.isArray(result)) return result[0] || null;
  if (result && typeof result === 'object' && !result.deleted_at && !result.error) return result;
  return null;
}

async function getDocumentRecord(id) {
  const result = await supabaseRequest(`DocumentIndex?select=*&id=eq.${encodeURIComponent(id)}&deleted_at=is.null&limit=1`);
  return firstDocumentRecord(result);
}

function assertDocumentAccess(user, record) {
  if (!record) throw new Error('Document introuvable');
  if (user?.role === 'superadmin') return;
  const org = sanitizeSegment(user?.organisation || 'jsinnovia', 'jsinnovia');
  if (String(record.organisation || '') !== org) throw new Error('Accès document non autorisé');
}

async function getDocumentBufferForUser(user, id) {
  const record = await getDocumentRecord(id);
  assertDocumentAccess(user, record);
  const ref = record.dropbox_file_id || record.dropbox_path;
  const buffer = await downloadFromDropbox(ref);
  validateBuffer(record.filename, buffer);
  return { record, buffer };
}

router.get('/status', (req, res) => {
  res.json({
    success: true,
    dropboxConfigured: isDropboxConfigured(),
    indexConfigured: Boolean(AGENT_KEY || (SUPABASE_URL && SUPABASE_KEY)),
    maxFileBytes: MAX_FILE_BYTES,
    storage: 'dropbox',
    publicLinks: false,
  });
});

router.get('/', async (req, res) => {
  try {
    const organisation = resolveOrganisation(req.user, req.query.organisation);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), MAX_LIST_LIMIT);
    const filters = [
      'select=id,organisation,brand,client_id,category,filename,mime_type,size_bytes,dropbox_file_id,source,email_message_id,uploaded_by,created_at',
      `organisation=eq.${encodeURIComponent(organisation)}`,
      'deleted_at=is.null',
    ];
    if (req.query.brand) filters.push(`brand=eq.${encodeURIComponent(sanitizeSegment(req.query.brand))}`);
    if (req.query.clientId) filters.push(`client_id=eq.${encodeURIComponent(String(req.query.clientId))}`);
    if (req.query.category) filters.push(`category=eq.${encodeURIComponent(sanitizeSegment(req.query.category))}`);
    filters.push('order=created_at.desc');
    filters.push(`limit=${limit}`);
    const rows = await supabaseRequest(`DocumentIndex?${filters.join('&')}`);
    res.json({ success: true, documents: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    console.error('[documents] list:', error.message);
    res.status(503).json({ success: false, error: error.message });
  }
});

router.post('/upload', async (req, res) => {
  try {
    const { filename, mimeType, base64, organisation, brand, clientId, category } = req.body || {};
    if (!filename || !base64) return res.status(400).json({ success: false, error: 'filename et base64 requis' });
    const raw = String(base64).replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    const buffer = Buffer.from(raw, 'base64');
    const document = await storeBuffer({
      user: req.user,
      organisation,
      brand,
      clientId,
      category,
      filename,
      mimeType,
      buffer,
      source: 'cockpit-upload',
    });
    res.status(201).json({ success: true, document });
  } catch (error) {
    console.error('[documents] upload:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Bibliothèque Asset : fichiers médias réellement archivés et indexés dans Dropbox.
// Aucun lien Dropbox public ni jeton n'est transmis au navigateur.
router.get('/portfolio-assets', async (req, res) => {
  try {
    if (!isDropboxConfigured()) {
      return res.json({ success: true, dropboxConfigured: false, assets: [] });
    }
    const organisation = resolveOrganisation(req.user, req.query.organisation);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 500);
    const filters = [
      'select=id,organisation,brand,client_id,category,filename,mime_type,size_bytes,dropbox_path,dropbox_file_id,content_hash,source,uploaded_by,created_at',
      `organisation=eq.${encodeURIComponent(organisation)}`,
      'deleted_at=is.null',
      'order=created_at.desc',
      `limit=${limit}`,
    ];
    const rows = await supabaseRequest(`DocumentIndex?${filters.join('&')}`);
    const assets = (Array.isArray(rows) ? rows : [])
      .filter(isPortfolioMedia)
      .map((record) => ({
        id: record.id,
        filename: record.filename,
        mime_type: record.mime_type,
        size_bytes: Number(record.size_bytes || 0),
        client_id: record.client_id || null,
        category: record.category || 'Media',
        brand: record.brand || 'general',
        source: record.source || 'dropbox',
        created_at: record.created_at || null,
        dropbox_path: record.dropbox_path || null,
        content_hash: record.content_hash || null,
      }));
    return res.json({ success: true, dropboxConfigured: true, assets });
  } catch (error) {
    console.error('[documents] portfolio assets:', error.message);
    return res.status(503).json({ success: false, error: error.message });
  }
});

router.get('/:id/content', async (req, res) => {
  try {
    const record = await getDocumentRecord(req.params.id);
    assertDocumentAccess(req.user, record);
    if (!isPortfolioMedia(record)) return res.status(415).json({ success: false, error: 'Ce fichier n’est pas un média du Portfolio' });
    const response = await openDropboxDownload(record.dropbox_file_id || record.dropbox_path, { range: req.headers.range });
    if (response.status === 206) res.status(206);
    res.setHeader('Content-Type', record.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(record.filename)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    const length = response.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    const contentRange = response.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    res.setHeader('Accept-Ranges', response.headers.get('accept-ranges') || 'bytes');
    if (!response.body) return res.status(502).json({ success: false, error: 'Flux Dropbox indisponible' });
    Readable.fromWeb(response.body).on('error', (error) => {
      console.error('[documents] portfolio stream:', error.message);
      if (!res.headersSent) res.status(502).end();
      else res.destroy(error);
    }).pipe(res);
  } catch (error) {
    console.error('[documents] portfolio content:', error.message);
    res.status(error.message.includes('autorisé') ? 403 : 404).json({ success: false, error: error.message });
  }
});

router.get('/:id/download', async (req, res) => {
  try {
    const { record, buffer } = await getDocumentBufferForUser(req.user, req.params.id);
    res.setHeader('Content-Type', record.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(record.filename)}`);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  } catch (error) {
    console.error('[documents] download:', error.message);
    res.status(error.message.includes('autorisé') ? 403 : 404).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.storeBuffer = storeBuffer;
module.exports.getDocumentBufferForUser = getDocumentBufferForUser;
module.exports.isDropboxConfigured = isDropboxConfigured;
module.exports.MAX_FILE_BYTES = MAX_FILE_BYTES;
module.exports.firstDocumentRecord = firstDocumentRecord;
module.exports.indexDocument = indexDocument;
module.exports.isPortfolioMedia = isPortfolioMedia;
