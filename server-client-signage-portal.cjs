const express = require('express');
const { ROLE_LEVEL } = require('./server-security.cjs');
const { postgresRest } = require('./server-postgres.cjs');
const { ensureClientInvitation } = require('./server-client-onboarding.cjs');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FINAL_STATES = new Set(['approved', 'changes_requested']);
const clean = (value, max = 1000) => String(value || '').trim().slice(0, max);
const isAdmin = req => (ROLE_LEVEL[req.user?.role] || 0) >= ROLE_LEVEL.admin;

async function db(resource, options = {}) {
  return postgresRest(resource, options);
}

function owner(req) {
  const requested = isAdmin(req) ? clean(req.headers['x-client-email'], 254).toLowerCase() : '';
  const email = requested || clean(req.user?.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('Client invalide');
  return email;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Cette action nécessite un administrateur' });
  next();
}

async function ownedRequest(req, requestId) {
  const rows = await db(`client_signage_requests?select=*&id=eq.${encodeURIComponent(requestId)}&owner_email=eq.${encodeURIComponent(owner(req))}&limit=1`);
  return rows?.[0] || null;
}

async function ensureOwnedMedia(email, mediaIds) {
  const uniqueIds = [...new Set((mediaIds || []).map(value => clean(value, 80)).filter(Boolean))].slice(0, 12);
  const media = [];
  for (const id of uniqueIds) {
    const rows = await db(`signage_media?select=id,name,mime_type,status,rendition&id=eq.${encodeURIComponent(id)}&owner_email=eq.${encodeURIComponent(email)}&limit=1`);
    if (!rows?.[0]) throw new Error('Un média joint est introuvable ou appartient à un autre client');
    media.push(rows[0]);
  }
  return media;
}

async function scheduleApprovedMedia({ req, request, review, media }) {
  const email = owner(req);
  const entitlements = await db(`client_module_entitlements?select=id&email=eq.${encodeURIComponent(email)}&module_code=eq.digital_signage&enabled=eq.true&limit=1`);
  if (!entitlements?.[0]) return { publication: null, reason: 'digital_signage_non_active' };
  if (media.status !== 'ready' || media.rendition?.state !== 'ready') {
    return { publication: null, reason: 'media_non_prepare' };
  }
  const players = await db(`signage_players?select=*&owner_email=eq.${encodeURIComponent(email)}&order=last_seen_at.desc&limit=20`);
  const player = (players || []).find(row => row.status === 'online' && row.last_seen_at && Date.now() - new Date(row.last_seen_at).getTime() < 120000)
    || players?.[0];
  if (!player) return { publication: null, reason: 'player_non_associe' };

  const items = [{ mediaId: media.id, durationSeconds: Number(request.duration_seconds || 8) }];
  const playlists = await db('signage_playlists', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ owner_email: email, name: `Validation client — ${clean(request.title, 80)}`, items })
  });
  const playlist = playlists?.[0];
  const manifest = {
    version: 1,
    revision: playlist.revision || 1,
    playlistId: playlist.id,
    items,
    profile: { video_codec: 'h264', pixel_format: 'yuv420p', audio_codec: 'aac', container: 'mp4', faststart: true },
    clientReviewId: review.id,
    createdAt: new Date().toISOString()
  };
  const publications = await db('signage_publications', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      owner_email: email,
      player_id: player.id,
      playlist_id: playlist.id,
      status: 'pending',
      manifest,
      previous_publication_id: player.current_publication_id || null,
      scheduled_at: new Date().toISOString(),
      recurrence: { type: 'none' }
    })
  });
  const publication = publications?.[0];
  await db('signage_audit_events', {
    method: 'POST',
    body: JSON.stringify({
      owner_email: email,
      actor_email: req.user.email,
      action: 'publication.client_approved',
      entity_type: 'publication',
      entity_id: publication.id,
      details: { requestId: request.id, reviewId: review.id, mediaId: media.id }
    })
  });
  return { publication, reason: null };
}

router.post('/invitations', requireAdmin, async (req, res) => {
  try {
    const result = await ensureClientInvitation({
      email: req.body?.email,
      fullName: req.body?.fullName,
      organisation: req.body?.organisation,
    });
    res.status(result.invited ? 201 : 200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.use(async (req, res, next) => {
  try {
    if (isAdmin(req)) return next();
    const rows = await db(`client_module_entitlements?select=id&email=eq.${encodeURIComponent(owner(req))}&module_code=eq.digital_signage&enabled=eq.true&limit=1`);
    if (!rows?.[0]) return res.status(403).json({ error: 'Le service Écran géant n’est pas actif pour ce compte' });
    next();
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.get('/requests', async (req, res) => {
  try {
    const email = owner(req);
    const [requests, assets, reviews] = await Promise.all([
      db(`client_signage_requests?select=*&owner_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=200`),
      db(`client_signage_request_assets?select=*&owner_email=eq.${encodeURIComponent(email)}&order=created_at.asc&limit=500`),
      db(`client_content_reviews?select=*&owner_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=200`),
    ]);
    res.json({ requests: requests || [], assets: assets || [], reviews: reviews || [] });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

router.post('/requests', async (req, res) => {
  try {
    const email = owner(req);
    const title = clean(req.body?.title, 160);
    const brief = clean(req.body?.brief, 5000);
    if (!title || !brief) return res.status(400).json({ error: 'Titre et description requis' });
    const media = await ensureOwnedMedia(email, req.body?.mediaIds);
    const duration = Math.min(120, Math.max(1, Number(req.body?.durationSeconds || 8)));
    const desiredAt = req.body?.desiredAt ? new Date(req.body.desiredAt) : null;
    if (desiredAt && !Number.isFinite(desiredAt.getTime())) return res.status(400).json({ error: 'Date souhaitée invalide' });
    const rows = await db('client_signage_requests', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        owner_email: email,
        title,
        brief,
        request_type: clean(req.body?.requestType || 'giant_screen_video', 80),
        format: clean(req.body?.format || '16:9', 30),
        duration_seconds: duration,
        desired_at: desiredAt?.toISOString() || null,
        publish_after_approval: isAdmin(req) && req.body?.publishAfterApproval === true,
      })
    });
    const request = rows?.[0];
    for (const item of media) {
      await db('client_signage_request_assets', {
        method: 'POST',
        body: JSON.stringify({ request_id: request.id, owner_email: email, media_id: item.id, asset_role: 'source' })
      });
    }
    res.status(201).json({ request, media });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.patch('/requests/:id', requireAdmin, async (req, res) => {
  try {
    const request = await ownedRequest(req, req.params.id);
    if (!request) return res.status(404).json({ error: 'Demande introuvable' });
    const allowed = new Set(['submitted', 'in_production', 'awaiting_client', 'approved', 'publication_scheduled', 'completed', 'cancelled']);
    const status = clean(req.body?.status, 60);
    if (!allowed.has(status)) return res.status(400).json({ error: 'Statut invalide' });
    const rows = await db(`client_signage_requests?id=eq.${encodeURIComponent(request.id)}&owner_email=eq.${encodeURIComponent(owner(req))}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
    res.json({ request: rows?.[0] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/requests/:id/reviews', requireAdmin, async (req, res) => {
  try {
    const request = await ownedRequest(req, req.params.id);
    if (!request) return res.status(404).json({ error: 'Demande introuvable' });
    const media = await ensureOwnedMedia(owner(req), [req.body?.mediaId]);
    const existing = await db(`client_content_reviews?select=version&request_id=eq.${encodeURIComponent(request.id)}&owner_email=eq.${encodeURIComponent(owner(req))}&order=version.desc&limit=1`);
    const rows = await db('client_content_reviews', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        request_id: request.id,
        owner_email: owner(req),
        media_id: media[0].id,
        version: Number(existing?.[0]?.version || 0) + 1,
        publish_on_approval: req.body?.publishOnApproval === true,
      })
    });
    await db(`client_signage_requests?id=eq.${encodeURIComponent(request.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'awaiting_client', updated_at: new Date().toISOString() })
    });
    res.status(201).json({ review: rows?.[0] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/reviews/:id/decision', async (req, res) => {
  try {
    const email = owner(req);
    const rows = await db(`client_content_reviews?select=*&id=eq.${encodeURIComponent(req.params.id)}&owner_email=eq.${encodeURIComponent(email)}&limit=1`);
    const review = rows?.[0];
    if (!review) return res.status(404).json({ error: 'Validation introuvable' });
    if (FINAL_STATES.has(review.status)) return res.status(409).json({ error: 'Cette version a déjà reçu une décision' });
    const decision = clean(req.body?.decision, 40);
    if (!['approved', 'changes_requested'].includes(decision)) return res.status(400).json({ error: 'Décision invalide' });
    const request = await ownedRequest(req, review.request_id);
    const mediaRows = await db(`signage_media?select=*&id=eq.${encodeURIComponent(review.media_id)}&owner_email=eq.${encodeURIComponent(email)}&limit=1`);
    const now = new Date().toISOString();
    let publication = null;
    let publicationBlockedReason = null;
    if (decision === 'approved' && review.publish_on_approval) {
      const result = await scheduleApprovedMedia({ req, request, review, media: mediaRows?.[0] || {} });
      publication = result.publication;
      publicationBlockedReason = result.reason;
    }
    const updated = await db(`client_content_reviews?id=eq.${encodeURIComponent(review.id)}&owner_email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: decision,
        client_comment: clean(req.body?.comment, 2000) || null,
        decided_at: now,
        publication_id: publication?.id || null,
        updated_at: now,
      })
    });
    const requestStatus = decision === 'changes_requested'
      ? 'changes_requested'
      : publication ? 'publication_scheduled' : publicationBlockedReason ? 'approved_waiting_publication' : 'approved';
    await db(`client_signage_requests?id=eq.${encodeURIComponent(request.id)}&owner_email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: requestStatus, updated_at: now })
    });
    res.json({ review: updated?.[0], publication, publicationBlockedReason, requestStatus });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
module.exports.owner = owner;
module.exports.scheduleApprovedMedia = scheduleApprovedMedia;
