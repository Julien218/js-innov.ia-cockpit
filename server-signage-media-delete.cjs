const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { requireSession } = require('./server-security.cjs');
const { postgresRest } = require('./server-postgres.cjs');
const { fetchWithPathRoot } = require('./server-signage-dropbox-scope.cjs');

const router = express.Router();
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN || '';
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY || '';
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET || '';
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || '';
const FFMPEG_PROFILE = { video_codec: 'h264', pixel_format: 'yuv420p', audio_codec: 'aac', container: 'mp4', faststart: true };
const repairLocks = new Set();
let pendingSweepPromise = null;
let lastPendingSweepAt = 0;
let dropboxTokenCache = { value: DROPBOX_ACCESS_TOKEN, expiresAt: DROPBOX_ACCESS_TOKEN ? Number.MAX_SAFE_INTEGER : 0 };

const cleanEmail = value => String(value || '').trim().toLowerCase();
const encode = value => encodeURIComponent(String(value || ''));
const hash = value => crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const isVideo = media => String(media?.mime_type || '').startsWith('video/') || /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(String(media?.name || ''));
const rejectCommercial = (req, res, next) => req.user?.role === 'collaborateur'
  ? res.status(403).json({ error: 'La suppression de médias nécessite un administrateur' })
  : next();

async function db(resource, options = {}) {
  return postgresRest(resource, options);
}

function managedOwner(req) {
  const sessionEmail = cleanEmail(req.user?.email);
  if (!['admin', 'superadmin'].includes(req.user?.role)) return sessionEmail;
  const requested = cleanEmail(req.headers['x-client-email']);
  return requested || sessionEmail;
}

async function getDropboxToken() {
  if (dropboxTokenCache.value && Date.now() < dropboxTokenCache.expiresAt - 60000) return dropboxTokenCache.value;
  if (!DROPBOX_APP_KEY || !DROPBOX_APP_SECRET || !DROPBOX_REFRESH_TOKEN) return '';
  const credentials = Buffer.from(`${DROPBOX_APP_KEY}:${DROPBOX_APP_SECRET}`).toString('base64');
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: DROPBOX_REFRESH_TOKEN })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error('Connexion Dropbox indisponible.');
  dropboxTokenCache = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 14400) * 1000 };
  return data.access_token;
}

async function deleteDropboxPath(dropboxPath) {
  if (!dropboxPath) return;
  const accessToken = await getDropboxToken();
  if (!accessToken) throw new Error('Dropbox non configuré pour supprimer le fichier.');
  const response = await fetchWithPathRoot('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dropboxPath })
  });
  if (response.ok) return;
  const data = await response.json().catch(() => ({}));
  const summary = String(data.error_summary || '');
  if (summary.startsWith('path_lookup/not_found')) return;
  throw new Error(summary || 'Dropbox a refusé la suppression du fichier.');
}

async function downloadDropboxPath(dropboxPath) {
  const accessToken = await getDropboxToken();
  if (!accessToken) throw new Error('Dropbox non configuré pour valider le média.');
  const response = await fetchWithPathRoot('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath })
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Lecture Dropbox impossible (HTTP ${response.status})${text ? `: ${text.slice(0, 180)}` : ''}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function overwriteDropboxPath(dropboxPath, body) {
  const accessToken = await getDropboxToken();
  if (!accessToken) throw new Error('Dropbox non configuré pour enregistrer le média validé.');
  const response = await fetchWithPathRoot('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath, mode: 'overwrite', autorename: false, mute: true, strict_conflict: false })
    },
    body
  });
  if (response.ok) return;
  const data = await response.json().catch(() => ({}));
  throw new Error(String(data.error_summary || '') || `Écriture Dropbox impossible (HTTP ${response.status}).`);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('La validation vidéo a dépassé 4 minutes.'));
    }, 240000);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
    child.once('error', error => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg indisponible: ${error.message}`));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`Validation vidéo impossible (FFmpeg ${code}): ${stderr.slice(-900)}`));
    });
  });
}

async function normalizeVideoBody(input) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'signelya-repair-'));
  const source = path.join(work, 'source.bin');
  const output = path.join(work, 'player.mp4');
  try {
    await fs.writeFile(source, input);
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', source,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1',
      '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-profile:v', 'main', '-level:v', '4.1', '-pix_fmt', 'yuv420p',
      '-maxrate', '8M', '-bufsize', '16M', '-g', '60',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart',
      output
    ]);
    return await fs.readFile(output);
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

async function audit(ownerEmail, actorEmail, action, entityId, details = {}) {
  await db('signage_audit_events', {
    method: 'POST',
    body: JSON.stringify({
      owner_email: ownerEmail,
      actor_email: actorEmail || 'system',
      action,
      entity_type: 'media',
      entity_id: entityId || null,
      details
    })
  }).catch(() => {});
}

async function repairLegacyMedia(media, ownerEmail, actorEmail = 'system') {
  try {
    const sourceBody = await downloadDropboxPath(media.dropbox_path);
    const video = isVideo(media);
    const finalBody = video ? await normalizeVideoBody(sourceBody) : sourceBody;
    if (video) await overwriteDropboxPath(media.dropbox_path, finalBody);
    const rendition = video
      ? {
          profile: FFMPEG_PROFILE,
          state: 'ready',
          transcoded: true,
          repairedFromLegacy: true,
          sourceBytes: sourceBody.length,
          outputBytes: finalBody.length,
          resolution: '1920x1080',
          frameRate: 30
        }
      : {
          profile: FFMPEG_PROFILE,
          state: 'ready',
          transcoded: false,
          repairedFromLegacy: true
        };
    await db(`signage_media?id=eq.${encode(media.id)}&owner_email=eq.${encode(ownerEmail)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'ready',
        size_bytes: finalBody.length,
        checksum_sha256: hash(finalBody),
        rendition,
        updated_at: new Date().toISOString()
      })
    });
    await audit(ownerEmail, actorEmail, 'media.auto_validated', media.id, { name: media.name, previousStatus: media.status, sizeBytes: finalBody.length });
    console.log(`[signage][media-auto-validate] ready ${media.id} ${media.name}`);
    return true;
  } catch (error) {
    const message = String(error.message || 'Validation automatique impossible').slice(0, 500);
    await db(`signage_media?id=eq.${encode(media.id)}&owner_email=eq.${encode(ownerEmail)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'failed',
        rendition: { profile: FFMPEG_PROFILE, state: 'failed', repairedFromLegacy: true, error: message },
        updated_at: new Date().toISOString()
      })
    }).catch(() => {});
    await audit(ownerEmail, actorEmail, 'media.auto_validation_failed', media.id, { name: media.name, error: message });
    console.error(`[signage][media-auto-validate] ${media.id} ${media.name}: ${message}`);
    return false;
  }
}

async function repairPendingMediaForOwner(ownerEmail, actorEmail = 'system') {
  if (!ownerEmail || repairLocks.has(ownerEmail)) return;
  repairLocks.add(ownerEmail);
  try {
    const rows = await db(`signage_media?select=id,name,mime_type,dropbox_path,size_bytes,status,rendition,created_at&owner_email=eq.${encode(ownerEmail)}&order=created_at.asc&limit=250`);
    const pending = (rows || []).filter(media => ['uploaded', 'processing'].includes(String(media.status || ''))).slice(0, 3);
    for (const media of pending) await repairLegacyMedia(media, ownerEmail, actorEmail);
  } finally {
    repairLocks.delete(ownerEmail);
  }
}

function playlistContainsMedia(playlist, mediaId) {
  return Array.isArray(playlist?.items) && playlist.items.some(item => String(item?.mediaId || item?.media_id || '') === mediaId);
}

function manifestContainsMedia(publication, mediaId) {
  const items = publication?.manifest?.items;
  return Array.isArray(items) && items.some(item => String(item?.media?.id || item?.mediaId || '') === mediaId);
}

async function sweepBrokenPendingPublications() {
  if (pendingSweepPromise) return pendingSweepPromise;
  if (Date.now() - lastPendingSweepAt < 20000) return;
  pendingSweepPromise = (async () => {
    const publications = await db('signage_publications?select=id,owner_email,status,manifest,created_at&status=eq.pending&order=created_at.asc&limit=250');
    let repaired = 0;
    for (const publication of publications || []) {
      const items = Array.isArray(publication?.manifest?.items) ? publication.manifest.items : [];
      const mediaIds = [...new Set(items.map(item => String(item?.mediaId || item?.media_id || item?.media?.id || '')).filter(Boolean))];
      let invalidReason = '';
      for (const mediaId of mediaIds) {
        const rows = await db(`signage_media?select=id,status,rendition&owner_email=eq.${encode(publication.owner_email)}&id=eq.${encode(mediaId)}&limit=1`);
        const media = rows?.[0];
        if (!media) {
          invalidReason = `média ${mediaId} introuvable`;
          break;
        }
        if (media.status === 'failed' || media.rendition?.state === 'failed') {
          invalidReason = `média ${mediaId} invalide`;
          break;
        }
      }
      if (!invalidReason) continue;
      await db(`signage_publications?id=eq.${encode(publication.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'failed',
          error: `Publication neutralisée automatiquement : ${invalidReason}.`,
          updated_at: new Date().toISOString()
        })
      });
      repaired += 1;
      console.warn(`[signage][publication-repair] ${publication.id}: ${invalidReason}`);
    }
    lastPendingSweepAt = Date.now();
    if (repaired) console.log(`[signage][publication-repair] ${repaired} publication(s) pending obsolète(s) neutralisée(s)`);
  })().finally(() => { pendingSweepPromise = null; });
  return pendingSweepPromise;
}

// Self-heal stale historical publications before the real Player heartbeat route.
// This prevents one deleted legacy media from returning HTTP 503 forever.
router.use('/player/heartbeat', async (_req, _res, next) => {
  try {
    await sweepBrokenPendingPublications();
  } catch (error) {
    console.error('[signage][publication-repair]', error.message);
  }
  next();
});

// Compatibility/self-healing pass: old upload-session clients could leave a row
// in uploaded/processing. Before returning the dashboard, validate those files
// with the exact Player profile so only ready media can be programmed.
router.use('/manage/dashboard', requireSession('client'), async (req, _res, next) => {
  try {
    await repairPendingMediaForOwner(managedOwner(req), cleanEmail(req.user?.email) || 'system');
    await sweepBrokenPendingPublications();
  } catch (error) {
    console.error('[signage][media-auto-validate]', error.message);
  }
  next();
});

router.delete('/manage/media/:id', requireSession('client'), rejectCommercial, async (req, res) => {
  try {
    const mediaId = String(req.params.id || '');
    if (!isUuid(mediaId)) return res.status(400).json({ error: 'Média invalide' });
    const ownerEmail = managedOwner(req);
    const mediaRows = await db(`signage_media?select=id,name,dropbox_path,status&owner_email=eq.${encode(ownerEmail)}&id=eq.${encode(mediaId)}&limit=1`);
    const media = mediaRows?.[0];
    if (!media) return res.status(404).json({ error: 'Média introuvable' });

    const [players, publications, playlists] = await Promise.all([
      db(`signage_players?select=id,name,status,last_seen_at,current_publication_id&owner_email=eq.${encode(ownerEmail)}`),
      db(`signage_publications?select=id,status,manifest,playlist_id,player_id&owner_email=eq.${encode(ownerEmail)}&order=created_at.desc&limit=500`),
      db(`signage_playlists?select=id,name,items,revision&owner_email=eq.${encode(ownerEmail)}&order=created_at.desc&limit=500`)
    ]);

    const currentPublicationIds = new Set((players || [])
      .filter(player => player.status !== 'retired')
      .map(player => String(player.current_publication_id || ''))
      .filter(Boolean));
    const currentPublication = (publications || []).find(publication =>
      currentPublicationIds.has(String(publication.id)) && manifestContainsMedia(publication, mediaId)
    );
    if (currentPublication) {
      return res.status(409).json({
        error: `« ${media.name} » est encore chargé dans la diffusion actuelle du Player. Publiez d’abord un programme sans ce média, puis supprimez-le.`,
        code: 'MEDIA_IN_CURRENT_PUBLICATION',
        publicationId: currentPublication.id
      });
    }

    const pendingPublications = (publications || []).filter(publication =>
      publication.status === 'pending' && manifestContainsMedia(publication, mediaId)
    );
    for (const publication of pendingPublications) {
      await db(`signage_publications?id=eq.${encode(publication.id)}&owner_email=eq.${encode(ownerEmail)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'rolled_back',
          error: `Annulée automatiquement : le média « ${media.name} » a été supprimé avant diffusion.`,
          updated_at: new Date().toISOString()
        })
      });
    }

    let preservedEmptyPlaylists = 0;
    const affectedPlaylists = (playlists || []).filter(playlist => playlistContainsMedia(playlist, mediaId));
    for (const playlist of affectedPlaylists) {
      const remainingItems = (playlist.items || []).filter(item => String(item?.mediaId || item?.media_id || '') !== mediaId);
      await db(`signage_playlists?id=eq.${encode(playlist.id)}&owner_email=eq.${encode(ownerEmail)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          items: remainingItems,
          revision: Number(playlist.revision || 1) + 1,
          updated_at: new Date().toISOString()
        })
      });
      if (!remainingItems.length) preservedEmptyPlaylists += 1;
    }

    await deleteDropboxPath(media.dropbox_path);
    await db(`signage_media?id=eq.${encode(mediaId)}&owner_email=eq.${encode(ownerEmail)}`, { method: 'DELETE' });

    await audit(ownerEmail, cleanEmail(req.user?.email) || 'device', 'media.deleted', mediaId, {
      name: media.name,
      adjustedPlaylists: affectedPlaylists.length,
      cancelledPendingPublications: pendingPublications.length,
      preservedEmptyPlaylists
    });

    res.json({
      success: true,
      mediaId,
      adjustedPlaylists: affectedPlaylists.length,
      cancelledPendingPublications: pendingPublications.length,
      preservedEmptyPlaylists
    });
  } catch (error) {
    console.error('[signage][media-delete]', error.message);
    res.status(502).json({ error: error.message });
  }
});

module.exports = router;