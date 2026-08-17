const express = require('express');
const crypto = require('crypto');
const { postgresRest } = require('./server-postgres.cjs');
const { evaluatePlayerAdSchedule } = require('./server-signage-schedule.cjs');

const router = express.Router();
const BLACK_PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';
const BLACK_MEDIA_ID = '00000000-0000-4000-8000-000000000002';
const BLACK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const BLACK_SHA256 = crypto.createHash('sha256').update(BLACK_PNG).digest('hex');
const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const encode = value => encodeURIComponent(String(value || ''));

async function db(resource, options = {}) {
  return postgresRest(resource, options);
}

router.get('/player/schedule-black.png', (req, res) => {
  res.set({
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=86400, immutable',
    'X-Content-Type-Options': 'nosniff'
  });
  res.send(BLACK_PNG);
});

async function restoreCurrentPublicationIfNeeded(player, previousDecision) {
  if (!previousDecision || previousDecision.ads_allowed !== false || !player.current_publication_id) return;

  const current = await db(`signage_publications?select=*&id=eq.${encode(player.current_publication_id)}&player_id=eq.${encode(player.id)}&limit=1`);
  const publication = current?.[0];
  if (!publication?.manifest) return;

  // Re-queue the last real publication exactly once on the blocked -> allowed
  // transition. This intentionally does not depend on other future pending jobs:
  // the legacy 0.3 Player must leave the black compatibility screen immediately.
  await db('signage_publications', {
    method: 'POST',
    body: JSON.stringify({
      owner_email: player.owner_email,
      player_id: player.id,
      playlist_id: publication.playlist_id,
      status: 'pending',
      manifest: publication.manifest,
      previous_publication_id: publication.id,
      scheduled_at: new Date().toISOString(),
      recurrence: { type: 'none' }
    })
  });
}

function sameDecision(previousDecision, decision) {
  if (!previousDecision) return false;
  return Boolean(previousDecision.ads_allowed) === Boolean(decision.adsAllowed)
    && String(previousDecision.reason || '') === String(decision.reason || '')
    && String(previousDecision.next_change_at || '') === String(decision.nextChangeAt || '');
}

async function auditDecision(player, decision, previousDecision) {
  if (sameDecision(previousDecision, decision)) return;
  await db('signage_schedule_audit', {
    method: 'POST',
    body: JSON.stringify({
      player_id: player.id,
      publication_id: player.current_publication_id || null,
      owner_email: player.owner_email,
      evaluated_at: new Date().toISOString(),
      ads_allowed: Boolean(decision.adsAllowed),
      reason: String(decision.reason || 'schedule'),
      next_change_at: decision.nextChangeAt || null,
      details: { compatibilityMode: true }
    })
  }).catch(error => console.error('[signage][schedule-audit]', error.message));
}

function blackoutPublication(req, decision) {
  const base = `${req.protocol}://${req.get('host')}`;
  return {
    id: BLACK_PUBLICATION_ID,
    status: 'active',
    scheduled_at: new Date().toISOString(),
    manifest: {
      version: 1,
      revision: 1,
      playlistId: 'schedule-blackout',
      createdAt: new Date().toISOString(),
      items: [{
        durationSeconds: 300,
        media: {
          id: BLACK_MEDIA_ID,
          name: 'schedule-black.png',
          mime_type: 'image/png',
          url: `${base}/api/signage/player/schedule-black.png`,
          checksum_sha256: BLACK_SHA256,
          rendition: { state: 'ready', profile: 'schedule-blackout' }
        }
      }],
      schedule: {
        adsAllowed: false,
        reason: decision.reason,
        nextChangeAt: decision.nextChangeAt
      }
    }
  };
}

// Compatibility layer for already-installed 0.3 Players. It deliberately runs
// before the scheduling guard and legacy runtime. Old Players receive a black
// image when ads are forbidden; when the schedule reopens, the last active
// publication is re-queued. The Player token and association are never changed.
router.post('/player/heartbeat', async (req, res, next) => {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!bearer) return next();

  try {
    const rows = await db(`signage_players?select=id,owner_email,current_publication_id&token_hash=eq.${hash(bearer)}&limit=1`);
    const player = rows?.[0];
    if (!player) return next();

    const recent = await db(`signage_schedule_audit?select=ads_allowed,reason,next_change_at&player_id=eq.${encode(player.id)}&order=evaluated_at.desc&limit=1`);
    const previousDecision = recent?.[0] || null;
    const decision = await evaluatePlayerAdSchedule({ db, playerId: player.id, ownerEmail: player.owner_email, now: new Date() });

    if (decision.adsAllowed) await restoreCurrentPublicationIfNeeded(player, previousDecision);
    await auditDecision(player, decision, previousDecision);

    const originalJson = res.json.bind(res);
    res.json = body => {
      const outgoing = { ...(body || {}) };
      if (!decision.adsAllowed) outgoing.publication = blackoutPublication(req, decision);
      return originalJson(outgoing);
    };
    next();
  } catch (error) {
    console.error('[signage][schedule-compat]', error.message);
    next();
  }
});

module.exports = router;
