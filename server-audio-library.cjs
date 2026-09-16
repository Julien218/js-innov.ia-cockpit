const express = require('express');
const path = require('node:path');
const { Readable } = require('node:stream');
const {
  getAccessToken,
  uploadFile,
  ensureFolderTree,
  downloadFile,
  dropboxApiArg,
} = require('./server-dropbox-helper.cjs');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.opus']);
const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
};
const PLAYLIST_LIMIT = 100;
const TRACKS_PER_PLAYLIST_LIMIT = 500;
const MAX_AUDIO_UPLOAD_BYTES = 80 * 1024 * 1024;

function normalizeRoot(env = process.env) {
  const explicit = String(env.ELYNEA_AUDIO_DROPBOX_PATH || '').trim();
  if (explicit) return `/${explicit.split('/').filter(Boolean).join('/')}`;
  const base = String(env.DROPBOX_ROOT_PATH || '/JS-Innov.IA/Cockpit').replace(/\/+$/, '');
  return `${base}/Elynea Audio Studio`;
}

function safeFilename(value, fallback = 'audio.mp3') {
  const base = path.basename(String(value || fallback));
  const clean = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return clean || fallback;
}

function safePlaylistName(value) {
  const clean = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (!clean) throw Object.assign(new Error('Nom de playlist requis.'), { status: 400 });
  return clean;
}

function audioExtension(filename) {
  return path.extname(String(filename || '')).toLowerCase();
}

function assertAudioFilename(filename) {
  const safe = safeFilename(filename);
  const extension = audioExtension(safe);
  if (!AUDIO_EXTENSIONS.has(extension)) {
    throw Object.assign(new Error(`Format audio non pris en charge (${extension || 'sans extension'}).`), { status: 415 });
  }
  return safe;
}

function isInside(folder, candidate) {
  const prefix = `${String(folder || '').replace(/\/+$/, '').toLowerCase()}/`;
  return String(candidate || '').toLowerCase().startsWith(prefix);
}

async function readRequestBuffer(req, maximum = MAX_AUDIO_UPLOAD_BYTES) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maximum) throw Object.assign(new Error('Fichier audio supérieur à 80 Mo.'), { status: 413 });
    return req.body;
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximum) throw Object.assign(new Error('Fichier audio supérieur à 80 Mo.'), { status: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

async function dropboxJson(endpoint, body, fetchImpl = (...args) => fetch(...args)) {
  const token = await getAccessToken();
  if (!token) throw Object.assign(new Error('Dropbox non configuré.'), { status: 503 });
  const response = await fetchImpl(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_summary || `Dropbox HTTP ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status === 409 ? 404 : 502 });
  }
  return data;
}

async function listFolderAll(folder, fetchImpl) {
  const entries = [];
  let result = await dropboxJson('files/list_folder', {
    path: folder,
    recursive: false,
    include_deleted: false,
    include_non_downloadable_files: false,
    limit: 2000,
  }, fetchImpl);
  entries.push(...(result.entries || []));
  while (result.has_more && result.cursor) {
    result = await dropboxJson('files/list_folder/continue', { cursor: result.cursor }, fetchImpl);
    entries.push(...(result.entries || []));
  }
  return entries;
}

async function ensureAudioTree(root) {
  for (const name of ['Bibliotheque', 'Playlists', 'Projets', 'Exports', 'Inbox', 'Archives']) {
    const result = await ensureFolderTree(`${root}/${name}`);
    if (result?.error) throw Object.assign(new Error(result.error), { status: 503 });
  }
}

function trackFromEntry(entry, root) {
  const displayPath = entry.path_display || entry.path_lower || '';
  const name = entry.name || path.basename(displayPath);
  const extension = audioExtension(name);
  if (entry['.tag'] !== 'file' || !AUDIO_EXTENSIONS.has(extension)) return null;
  return {
    id: entry.id || displayPath,
    name,
    path: displayPath,
    size: Number(entry.size || 0),
    modified_at: entry.server_modified || entry.client_modified || null,
    mime_type: AUDIO_MIME[extension] || 'application/octet-stream',
    stream_url: `/api/music-motion/audio/stream?path=${encodeURIComponent(displayPath)}`,
    source: 'dropbox',
    library_root: `${root}/Bibliotheque`,
  };
}

function createAudioLibraryRouter({ fetchImpl = (...args) => fetch(...args), env = process.env } = {}) {
  const router = express.Router();
  const root = normalizeRoot(env);
  const libraryFolder = `${root}/Bibliotheque`;
  const playlistsFolder = `${root}/Playlists`;

  const wrap = fn => async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      const status = Number(error?.status) || 500;
      res.status(status).json({ error: status >= 500 ? (error?.message || 'Bibliothèque audio indisponible.') : error.message });
    }
  };

  router.get('/status', wrap(async (_req, res) => {
    const token = await getAccessToken();
    res.json({
      available: Boolean(token),
      root,
      library: libraryFolder,
      playlists: playlistsFolder,
      formats: [...AUDIO_EXTENSIONS],
    });
  }));

  router.get('/tracks', wrap(async (_req, res) => {
    await ensureAudioTree(root);
    const entries = await listFolderAll(libraryFolder, fetchImpl);
    const tracks = entries
      .map(entry => trackFromEntry(entry, root))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    res.json({ tracks, count: tracks.length, root, library: libraryFolder });
  }));

  router.post('/upload', wrap(async (req, res) => {
    await ensureAudioTree(root);
    const contentType = String(req.headers?.['content-type'] || '').split(';', 1)[0].toLowerCase();
    if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      throw Object.assign(new Error('Type de fichier audio non pris en charge.'), { status: 415 });
    }
    const original = assertAudioFilename(req.query.filename || req.get?.('x-file-name') || 'audio.mp3');
    const body = await readRequestBuffer(req);
    if (!body.length) throw Object.assign(new Error('Fichier audio vide.'), { status: 400 });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = `${libraryFolder}/${stamp}-${original}`;
    const uploaded = await uploadFile(destination, body);
    if (uploaded?.error) throw Object.assign(new Error(uploaded.error), { status: 502 });
    const entry = {
      '.tag': 'file',
      id: uploaded.id,
      name: uploaded.name || path.basename(destination),
      path_display: uploaded.path || destination,
      size: uploaded.size || body.length,
      server_modified: new Date().toISOString(),
    };
    res.status(201).json({ track: trackFromEntry(entry, root) });
  }));

  router.get('/stream', wrap(async (req, res) => {
    const requestedPath = String(req.query.path || '');
    if (!requestedPath || !isInside(libraryFolder, requestedPath)) {
      throw Object.assign(new Error('Chemin audio non autorisé.'), { status: 403 });
    }
    assertAudioFilename(path.basename(requestedPath));

    const token = await getAccessToken();
    if (!token) throw Object.assign(new Error('Dropbox non configuré.'), { status: 503 });
    const headers = {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': dropboxApiArg({ path: requestedPath }),
    };
    const range = String(req.headers.range || '');
    if (/^bytes=(?:\d+-\d*|-\d+)$/i.test(range)) headers.Range = range;

    const upstream = await fetchImpl('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers,
      redirect: 'error',
    });
    if (!upstream.ok && upstream.status !== 206) {
      await upstream.body?.cancel?.();
      throw Object.assign(new Error(`Lecture Dropbox HTTP ${upstream.status}`), { status: upstream.status === 409 ? 404 : 502 });
    }

    const extension = audioExtension(requestedPath);
    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || AUDIO_MIME[extension] || 'application/octet-stream');
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const header of ['content-length', 'content-range', 'etag']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  }));

  router.get('/playlists', wrap(async (_req, res) => {
    await ensureAudioTree(root);
    const entries = (await listFolderAll(playlistsFolder, fetchImpl))
      .filter(entry => entry['.tag'] === 'file' && /\.json$/i.test(entry.name || ''))
      .slice(0, PLAYLIST_LIMIT);
    const playlists = [];
    for (const entry of entries) {
      const result = await downloadFile(entry.path_display || entry.path_lower);
      if (!result?.success || !result.buffer) continue;
      try {
        const parsed = JSON.parse(result.buffer.toString('utf8'));
        if (!parsed?.name || !Array.isArray(parsed.tracks)) continue;
        playlists.push({
          name: String(parsed.name).slice(0, 80),
          tracks: parsed.tracks.filter(trackPath => isInside(libraryFolder, trackPath)).slice(0, TRACKS_PER_PLAYLIST_LIMIT),
          updated_at: parsed.updated_at || entry.server_modified || null,
        });
      } catch {}
    }
    playlists.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    res.json({ playlists, count: playlists.length });
  }));

  router.post('/playlists', wrap(async (req, res) => {
    await ensureAudioTree(root);
    const name = safePlaylistName(req.body?.name);
    const tracks = [...new Set(Array.isArray(req.body?.tracks) ? req.body.tracks.map(value => String(value || '')) : [])]
      .filter(trackPath => isInside(libraryFolder, trackPath))
      .slice(0, TRACKS_PER_PLAYLIST_LIMIT);
    if (!tracks.length) throw Object.assign(new Error('Ajoutez au moins un morceau à la playlist.'), { status: 400 });
    const filename = `${safePlaylistName(name).replace(/\s+/g, '-')}.json`;
    const payload = Buffer.from(JSON.stringify({
      schema_version: 1,
      name,
      tracks,
      updated_at: new Date().toISOString(),
    }, null, 2), 'utf8');
    const uploaded = await uploadFile(`${playlistsFolder}/${filename}`, payload);
    if (uploaded?.error) throw Object.assign(new Error(uploaded.error), { status: 502 });
    res.status(201).json({ playlist: { name, tracks, updated_at: new Date().toISOString() } });
  }));

  return router;
}

module.exports = { createAudioLibraryRouter, normalizeRoot, AUDIO_EXTENSIONS };
