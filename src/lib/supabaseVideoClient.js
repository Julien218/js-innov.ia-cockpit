// ─── Supabase Client — Studio Vidéo JS-Innov.IA ───────────────────────────
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://rzvvwcwyaddzsaattwqt.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6InJ6dnZ3Y3d5YWRkenNhYXR0d3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNTU4NjAsImV4cCI6MjA5NjY5MTg2MH0.VOEFK5BG_dxCnijcz2RexqMg1yDGoXdw58-2Ud_a7hM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const videoDb = {
  VideoProject: {
    list: (order = '-created_date', limit = 50) =>
      supabase.from('VideoProject').select('*').order('created_date', { ascending: false }).limit(limit),
    get: (id) => supabase.from('VideoProject').select('*').eq('id', id).single(),
    filter: (filters) => supabase.from('VideoProject').select('*').match(filters),
    create: (data) => supabase.from('VideoProject').insert({ ...data, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }).select().single(),
    update: (id, data) => supabase.from('VideoProject').update({ ...data, updated_date: new Date().toISOString() }).eq('id', id).select().single(),
    delete: (id) => supabase.from('VideoProject').delete().eq('id', id),
  },
  AIVideoReport: {
    list: (order = '-created_date', limit = 20) =>
      supabase.from('AIVideoReport').select('*').order('created_date', { ascending: false }).limit(limit),
    get: (id) => supabase.from('AIVideoReport').select('*').eq('id', id).single(),
    filter: (filters) => supabase.from('AIVideoReport').select('*').match(filters),
    create: (data) => supabase.from('AIVideoReport').insert({ ...data, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }).select().single(),
    update: (id, data) => supabase.from('AIVideoReport').update({ ...data, updated_date: new Date().toISOString() }).eq('id', id).select().single(),
    delete: (id) => supabase.from('AIVideoReport').delete().eq('id', id),
  },
  VideoExport: {
    list: (order = '-created_date', limit = 100) =>
      supabase.from('VideoExport').select('*').order('created_date', { ascending: false }).limit(limit),
    get: (id) => supabase.from('VideoExport').select('*').eq('id', id).single(),
    filter: (filters) => supabase.from('VideoExport').select('*').match(filters),
    create: (data) => supabase.from('VideoExport').insert({ ...data, created_date: new Date().toISOString(), updated_date: new Date().toISOString() }).select().single(),
    update: (id, data) => supabase.from('VideoExport').update({ ...data, updated_date: new Date().toISOString() }).eq('id', id).select().single(),
    delete: (id) => supabase.from('VideoExport').delete().eq('id', id),
  },
};

const unwrapSupabase = async (operation, { label = 'Opération Supabase', fallback = null, required = false } = {}) => {
  const { data, error } = await operation;
  if (error) throw new Error(`${label} : ${error.message}`);
  if (required && (data === null || data === undefined)) throw new Error(`${label} : la base a renvoyé une réponse vide.`);
  return data ?? fallback;
};

const VIDEO_API_BASE = '/api/video-studio';
const videoExportSubscribers = new Set();
const CHUNKED_UPLOAD_THRESHOLD = 90 * 1024 * 1024;

async function videoApiRequest(endpoint, { method = 'GET', body } = {}) {
  const response = await fetch(VIDEO_API_BASE + endpoint, {
    method,
    credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Requête du studio vidéo impossible.');
  return data;
}

function queryParams(filters = {}, order = '', limit = '') {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  if (order) params.set('order', String(order));
  if (limit) params.set('limit', String(limit));
  const encoded = params.toString();
  return encoded ? '?' + encoded : '';
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function notifyVideoExport(type, data) {
  const event = { type, id: data?.id, data };
  for (const callback of videoExportSubscribers) {
    try { callback(event); } catch (error) { console.warn('[VideoExport subscribe]', error); }
  }
}

function makeVideoStudioEntity(resource, { subscribable = false } = {}) {
  const entity = {
    list: async (order = '-created_date', limit = 100) => asArray(await videoApiRequest('/' + resource + queryParams({}, order, limit))),
    get: (id) => videoApiRequest('/' + resource + '/' + encodeURIComponent(id)),
    filter: async (filters = {}, order = '', limit = 100) => asArray(await videoApiRequest('/' + resource + queryParams(filters, order, limit))),
    create: async (data) => {
      const created = await videoApiRequest('/' + resource, { method: 'POST', body: data });
      if (subscribable) notifyVideoExport('create', created);
      return created;
    },
    update: async (id, data) => {
      const updated = await videoApiRequest('/' + resource + '/' + encodeURIComponent(id), { method: 'PATCH', body: data });
      if (subscribable) notifyVideoExport('update', updated);
      return updated;
    },
    delete: async (id) => {
      await videoApiRequest('/' + resource + '/' + encodeURIComponent(id), { method: 'DELETE' });
      if (subscribable) notifyVideoExport('delete', { id });
      return { id };
    },
  };
  if (subscribable) {
    entity.subscribe = (callback) => {
      if (typeof callback !== 'function') return () => {};
      videoExportSubscribers.add(callback);
      return () => videoExportSubscribers.delete(callback);
    };
  }
  return entity;
}

const sourceProjectEntity = {
  list: async (order = '-created_at', limit = 100) => asArray(await videoApiRequest('/source-projects' + queryParams({}, order, limit))),
  filter: async (filters = {}) => asArray(await videoApiRequest('/source-projects' + queryParams(filters))),
  get: async (id) => {
    const rows = asArray(await videoApiRequest('/source-projects' + queryParams({ id })));
    return rows[0] || null;
  },
};

const legacyReportEntity = {
  list: (order, limit) => unwrapSupabase(videoDb.AIVideoReport.list(order, limit), { label: 'Chargement des rapports vidéo IA', fallback: [] }),
  filter: (filters) => unwrapSupabase(videoDb.AIVideoReport.filter(filters), { label: 'Recherche du rapport vidéo IA', fallback: [] }),
  create: (data) => unwrapSupabase(videoDb.AIVideoReport.create(data), { label: 'Création du rapport vidéo IA', required: true }),
  update: (id, data) => unwrapSupabase(videoDb.AIVideoReport.update(id, data), { label: 'Mise à jour du rapport vidéo IA', required: true }),
  delete: (id) => unwrapSupabase(videoDb.AIVideoReport.delete(id), { label: 'Suppression du rapport vidéo IA' }),
};

async function normalUpload(file, fileName) {
  const response = await fetch(VIDEO_API_BASE + '/upload', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(fileName) },
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Upload média impossible.');
  return data;
}

async function chunkedUpload(file, fileName, onProgress) {
  const sessionResponse = await fetch(VIDEO_API_BASE + '/upload-session', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: fileName, mime_type: file.type || 'application/octet-stream', size: file.size }),
  });
  const session = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok || !session?.upload_id) throw new Error(session?.error || 'Initialisation de l’upload segmenté impossible.');

  const uploadId = session.upload_id;
  const chunkSize = Math.max(1024 * 1024, Number(session.chunk_size) || 8 * 1024 * 1024);
  let offset = Number(session.received) || 0;
  try {
    while (offset < file.size) {
      const end = Math.min(file.size, offset + chunkSize);
      const response = await fetch(`${VIDEO_API_BASE}/upload-session/${encodeURIComponent(uploadId)}/chunk`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'x-upload-offset': String(offset) },
        body: file.slice(offset, end),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || `Upload interrompu à ${Math.round(offset / 1024 / 1024)} Mo.`);
      offset = Number(result.received);
      if (!Number.isFinite(offset)) throw new Error('Progression d’upload invalide.');
      onProgress?.(Math.min(100, Math.round(offset / file.size * 100)));
    }

    const completeResponse = await fetch(`${VIDEO_API_BASE}/upload-session/${encodeURIComponent(uploadId)}/complete`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const completed = await completeResponse.json().catch(() => ({}));
    if (!completeResponse.ok) throw new Error(completed?.error || 'Finalisation de l’upload impossible.');
    onProgress?.(100);
    return completed;
  } catch (error) {
    fetch(`${VIDEO_API_BASE}/upload-session/${encodeURIComponent(uploadId)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null);
    throw error;
  }
}

export async function uploadToStorage(file, bucket = 'video-studio', path = null, options = {}) {
  if (!file || typeof file.slice !== 'function') throw new Error('Aucun fichier média à envoyer.');
  const fileName = path || file.name || 'media.bin';
  if (file.size > 1024 * 1024 * 1024) throw new Error('Fichier supérieur à 1 Go.');
  return file.size >= CHUNKED_UPLOAD_THRESHOLD
    ? chunkedUpload(file, fileName, options.onProgress)
    : normalUpload(file, fileName);
}

export const base44Shim = {
  entities: {
    VideoProject: makeVideoStudioEntity('projects'),
    AIVideoReport: legacyReportEntity,
    VideoExport: makeVideoStudioEntity('exports', { subscribable: true }),
    Project: sourceProjectEntity,
  },
  integrations: {
    Core: {
      GenerateImage: async ({ prompt }) => {
        const res = await fetch('https://js-innov-command-center-production.up.railway.app/api/nova', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate_image', prompt }),
        });
        if (!res.ok) throw new Error('Génération d’image impossible (' + res.status + ').');
        const data = await res.json();
        return { url: data.image_url || data.url || '' };
      },
      UploadFile: async ({ file, fileName = file?.name, onProgress }) => {
        const uploaded = await uploadToStorage(file, 'video-studio', fileName, { onProgress });
        return {
          ...uploaded,
          url: uploaded.media_url || uploaded.file_url || uploaded.url || '',
          file_url: uploaded.media_url || uploaded.file_url || uploaded.url || '',
        };
      },
    },
  },
};
