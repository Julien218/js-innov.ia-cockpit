const express = require('express');
const { createHash } = require('node:crypto');
const { ROLE_LEVEL } = require('./server-security.cjs');
const { postgresRest } = require('./server-postgres.cjs');
const { ensureClientInvitation } = require('./server-client-onboarding.cjs');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FINAL_STATES = new Set(['approved', 'changes_requested']);
const COMPARISON_TEMPLATE_URL = process.env.SIGNAGE_COMPARISON_TEMPLATE_URL || 'https://canva.link/vps9laitxuyp8c8';
const clean = (value, max = 1000) => String(value || '').trim().slice(0, max);
const isAdmin = req => (ROLE_LEVEL[req.user?.role] || 0) >= ROLE_LEVEL.admin;

function viewerReference(email) {
  return createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex').slice(0, 10).toUpperCase();
}

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
      action: 'publication.staff_approved',
      entity_type: 'publication',
      entity_id: publication.id,
      details: {
        requestId: request.id,
        reviewId: review.id,
        mediaId: media.id,
        selectedProposal: review.selected_proposal || null,
      }
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
    const [requests, assets, reviews, proposals] = await Promise.all([
      db(`client_signage_requests?select=*&owner_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=200`),
      db(`client_signage_request_assets?select=*&owner_email=eq.${encodeURIComponent(email)}&order=created_at.asc&limit=500`),
      db(`client_content_reviews?select=*&owner_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=200`),
      db(`client_content_review_proposals?select=*&owner_email=eq.${encodeURIComponent(email)}&order=proposal_slot.asc&limit=600`),
    ]);
    res.json({
      requests: requests || [], assets: assets || [], reviews: reviews || [], proposals: proposals || [],
      previewProtection: {
        watermarkText: 'JS-Innov.IA - APERÇU CLIENT',
        viewerReference: viewerReference(email),
        downloadDisabled: true,
        pictureInPictureDisabled: true,
      },
      comparisonTemplate: {
        provider: 'canva',
        url: COMPARISON_TEMPLATE_URL,
        durationSeconds: 53,
        proposalSlots: 3,
        proposalDurationSeconds: 8,
        finalOutput: 'selected_proposal_only',
      }
    });
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
    const allowed = new Set(['submitted', 'in_production', 'awaiting_client', 'client_choice_submitted', 'changes_requested', 'approved', 'approved_waiting_publication', 'publication_scheduled', 'completed', 'cancelled']);
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
    const mediaIds = Array.isArray(req.body?.mediaIds) ? req.body.mediaIds : [req.body?.mediaId].filter(Boolean);
    if (mediaIds.length !== 3 || new Set(mediaIds).size !== 3) {
      return res.status(400).json({ error: 'Choisissez exactement trois vidéos différentes' });
    }
    const media = await ensureOwnedMedia(owner(req), mediaIds);
    if (media.length !== 3 || media.some(item => !String(item.mime_type || '').startsWith('video/'))) {
      return res.status(400).json({ error: 'Les trois propositions doivent être des vidéos' });
    }
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
    const review = rows?.[0];
    for (let index = 0; index < media.length; index += 1) {
      await db('client_content_review_proposals', {
        method: 'POST',
        body: JSON.stringify({
          review_id: review.id,
          request_id: request.id,
          owner_email: owner(req),
          media_id: media[index].id,
          proposal_slot: index + 1,
        })
      });
    }
    await db(`client_signage_requests?id=eq.${encodeURIComponent(request.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'awaiting_client', updated_at: new Date().toISOString() })
    });
    res.status(201).json({ review, proposals: media.map((item, index) => ({ proposal_slot: index + 1, media_id: item.id })) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/reviews/:id/proposals/:slot/viewed', async (req, res) => {
  try {
    const email = owner(req);
    const proposalSlot = Math.trunc(Number(req.params.slot));
    if (proposalSlot < 1 || proposalSlot > 3) return res.status(400).json({ error: 'Proposition invalide' });
    const reviews = await db(`client_content_reviews?select=id,request_id,status&id=eq.${encodeURIComponent(req.params.id)}&owner_email=eq.${encodeURIComponent(email)}&limit=1`);
    const review = reviews?.[0];
    if (!review) return res.status(404).json({ error: 'Validation introuvable' });
    const proposals = await db(`client_content_review_proposals?select=media_id,proposal_slot&review_id=eq.${encodeURIComponent(review.id)}&owner_email=eq.${encodeURIComponent(email)}&proposal_slot=eq.${encodeURIComponent(proposalSlot)}&limit=1`);
    const proposal = proposals?.[0];
    if (!proposal) return res.status(404).json({ error: 'Proposition introuvable' });
    await db('signage_audit_events', {
      method: 'POST',
      body: JSON.stringify({
        owner_email: email,
        actor_email: req.user?.email || email,
        action: 'proposal.preview_opened',
        entity_type: 'client_content_review',
        entity_id: review.id,
        details: {
          requestId: review.request_id,
          mediaId: proposal.media_id,
          proposalSlot,
          viewerReference: viewerReference(email),
        }
      })
    });
    res.json({ success: true, viewerReference: viewerReference(email) });
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
    if (review.status !== 'awaiting_client') return res.status(409).json({ error: 'Cette sélection n’attend plus de décision client' });
    const rawDecision = clean(req.body?.decision, 40);
    const decision = rawDecision === 'approved' ? 'selected' : rawDecision;
    if (!['selected', 'changes_requested'].includes(decision)) return res.status(400).json({ error: 'Décision invalide' });
    const request = await ownedRequest(req, review.request_id);
    const now = new Date().toISOString();
    if (decision === 'changes_requested') {
      const updated = await db(`client_content_reviews?id=eq.${encodeURIComponent(review.id)}&owner_email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          status: 'changes_requested',
          client_comment: clean(req.body?.comment, 2000) || null,
          decided_at: now,
          updated_at: now,
        })
      });
      await db(`client_signage_requests?id=eq.${encodeURIComponent(request.id)}&owner_email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH', body: JSON.stringify({ status: 'changes_requested', updated_at: now })
      });
      return res.json({ review: updated?.[0], requestStatus: 'changes_requested' });
    }

    const proposalSlot = Math.trunc(Number(req.body?.proposalSlot || 1));
    const proposals = await db(`client_content_review_proposals?select=*&review_id=eq.${encodeURIComponent(review.id)}&owner_email=eq.${encodeURIComponent(email)}&proposal_slot=eq.${encodeURIComponent(proposalSlot)}&limit=1`);
    const proposal = proposals?.[0] || (proposalSlot === 1 && review.media_id ? { media_id: review.media_id } : null);
    if (!proposal) return res.status(400).json({ error: 'La proposition choisie est introuvable' });
    const updated = await db(`client_content_reviews?id=eq.${encodeURIComponent(review.id)}&owner_email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'client_selected',
        client_comment: clean(req.body?.comment, 2000) || null,
        selected_proposal: proposalSlot,
        selected_media_id: proposal.media_id,
        client_selected_at: now,
        decided_at: now,
        updated_at: now,
      })
    });
    await db(`client_signage_requests?id=eq.${encodeURIComponent(request.id)}&owner_email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'client_choice_submitted', updated_at: now })
    });
    res.json({ review: updated?.[0], selectedProposal: proposalSlot, requestStatus: 'client_choice_submitted' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/reviews/:id/finalize', requireAdmin, async (req, res) => {
  try {
    const email = owner(req);
    const rows = await db(`client_content_reviews?select=*&id=eq.${encodeURIComponent(req.params.id)}&owner_email=eq.${encodeURIComponent(email)}&limit=1`);
    const review = rows?.[0];
    if (!review) return res.status(404).json({ error: 'Validation introuvable' });
    if (review.status !== 'client_selected' || !review.selected_media_id) {
      return res.status(409).json({ error: 'Le client doit d’abord choisir une proposition' });
    }
    const request = await ownedRequest(req, review.request_id);
    const mediaRows = await db(`signage_media?select=*&id=eq.${encodeURIComponent(review.selected_media_id)}&owner_email=eq.${encodeURIComponent(email)}&limit=1`);
    const media = mediaRows?.[0];
    if (!media) return res.status(404).json({ error: 'La vidéo choisie est introuvable' });

    let publication = null;
    let publicationBlockedReason = null;
    if (review.publish_on_approval) {
      const result = await scheduleApprovedMedia({ req, request, review, media });
      publication = result.publication;
      publicationBlockedReason = result.reason;
    }
    const now = new Date().toISOString();
    const updated = await db(`client_content_reviews?id=eq.${encodeURIComponent(review.id)}&owner_email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'approved',
        staff_approved_at: now,
        staff_approved_by: clean(req.user?.email, 254),
        publication_id: publication?.id || null,
        updated_at: now,
      })
    });
    const requestStatus = publication
      ? 'publication_scheduled'
      : publicationBlockedReason ? 'approved_waiting_publication' : 'approved';
    await db(`client_signage_requests?id=eq.${encodeURIComponent(request.id)}&owner_email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH', body: JSON.stringify({ status: requestStatus, updated_at: now })
    });
    res.json({ review: updated?.[0], publication, publicationBlockedReason, requestStatus });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
module.exports.owner = owner;
module.exports.viewerReference = viewerReference;
module.exports.scheduleApprovedMedia = scheduleApprovedMedia;
