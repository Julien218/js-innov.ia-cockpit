const express = require('express');
const { requireSession } = require('./server-security.cjs');
const { postgresRest } = require('./server-postgres.cjs');

const router = express.Router();
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN || '';
const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY || '';
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET || '';
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || '';
let dropboxTokenCache = { value: DROPBOX_ACCESS_TOKEN, expiresAt: DROPBOX_ACCESS_TOKEN ? Number.MAX_SAFE_INTEGER : 0 };

const cleanEmail = value => String(value || '').trim().toLowerCase();
const encode = value => encodeURIComponent(String(value || ''));
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
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
  if (!response.ok || !data.access_token) throw new Error('Connexion Dropbox indisponible pour la suppression.');
  dropboxTokenCache = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 14400) * 1000 };
  return data.access_token;
}

async function deleteDropboxPath(dropboxPath) {
  if (!dropboxPath) return;
  const accessToken = await getDropboxToken();
  if (!accessToken) throw new Error('Dropbox non configuré pour supprimer le fichier.');
  const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
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

function playlistContainsMedia(playlist, mediaId) {
  return Array.isArray(playlist?.items) && playlist.items.some(item => String(item?.mediaId || item?.media_id || '') === mediaId);
}

function manifestContainsMedia(publication, mediaId) {
  const items = publication?.manifest?.items;
  return Array.isArray(items) && items.some(item => String(item?.media?.id || item?.mediaId || '') === mediaId);
}

router.delete('/manage/media/:id', requireSession('client'), rejectCommercial, async (req, res) => {
  try {
    const mediaId = String(req.params.id || '');
    if (!isUuid(mediaId)) return res.status(400).json({ error: 'Média invalide' });
    const ownerEmail = managedOwner(req);
    const mediaRows = await db(`signage_media?select=id,name,dropbox_path&owner_email=eq.${encode(ownerEmail)}&id=eq.${encode(mediaId)}&limit=1`);
    const media = mediaRows?.[0];
    if (!media) return res.status(404).json({ error: 'Média introuvable' });

    const [players, publications, playlists] = await Promise.all([
      db(`signage_players?select=id,current_publication_id&owner_email=eq.${encode(ownerEmail)}`),
      db(`signage_publications?select=id,status,manifest&owner_email=eq.${encode(ownerEmail)}&order=created_at.desc&limit=250`),
      db(`signage_playlists?select=id,name,items,revision&owner_email=eq.${encode(ownerEmail)}&order=created_at.desc&limit=250`)
    ]);

    const currentPublicationIds = new Set((players || []).map(player => String(player.current_publication_id || '')).filter(Boolean));
    const blockingPublication = (publications || []).find(publication =>
      manifestContainsMedia(publication, mediaId) && (publication.status === 'pending' || currentPublicationIds.has(String(publication.id)))
    );
    if (blockingPublication) {
      return res.status(409).json({ error: 'Ce média est encore utilisé par une diffusion active ou en attente. Retirez-le de la diffusion avant de le supprimer.' });
    }

    const affectedPlaylists = (playlists || []).filter(playlist => playlistContainsMedia(playlist, mediaId));
    for (const playlist of affectedPlaylists) {
      const remainingItems = (playlist.items || []).filter(item => String(item?.mediaId || item?.media_id || '') !== mediaId);
      if (remainingItems.length) {
        await db(`signage_playlists?id=eq.${encode(playlist.id)}&owner_email=eq.${encode(ownerEmail)}`, {
          method: 'PATCH',
          body: JSON.stringify({ items: remainingItems, revision: Number(playlist.revision || 1) + 1, updated_at: new Date().toISOString() })
        });
      } else {
        await db(`signage_playlists?id=eq.${encode(playlist.id)}&owner_email=eq.${encode(ownerEmail)}`, { method: 'DELETE' });
      }
    }

    await deleteDropboxPath(media.dropbox_path);
    await db(`signage_media?id=eq.${encode(mediaId)}&owner_email=eq.${encode(ownerEmail)}`, { method: 'DELETE' });

    await db('signage_audit_events', {
      method: 'POST',
      body: JSON.stringify({
        owner_email: ownerEmail,
        actor_email: cleanEmail(req.user?.email) || 'device',
        action: 'media.deleted',
        entity_type: 'media',
        entity_id: mediaId,
        details: { name: media.name, adjustedPlaylists: affectedPlaylists.length }
      })
    }).catch(() => {});

    res.json({ success: true, mediaId, adjustedPlaylists: affectedPlaylists.length });
  } catch (error) {
    console.error('[signage][media-delete]', error.message);
    res.status(502).json({ error: error.message });
  }
});

module.exports = router;
