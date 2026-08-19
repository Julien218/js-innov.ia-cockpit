const express = require('express');
const crypto = require('crypto');
const { postgresRest } = require('./server-postgres.cjs');

const router = express.Router();
const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const PLAYBACK_ONLINE_WINDOW_MS = 90_000;
const MAX_DIAGNOSTICS_BYTES = 32 * 1024;

async function db(resource, options = {}) {
  return postgresRest(resource, options);
}

function bearerToken(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function cleanText(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function safeDiagnostics(value) {
  const diagnostics = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const encoded = JSON.stringify(diagnostics);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_DIAGNOSTICS_BYTES) {
    throw new Error('Diagnostic runtime trop volumineux');
  }
  return diagnostics;
}

function recent(timestamp, windowMs = PLAYBACK_ONLINE_WINDOW_MS) {
  if (!timestamp) return false;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) && Date.now() - parsed < windowMs;
}

router.post('/player/runtime-heartbeat', async (req, res) => {
  try {
    const bearer = bearerToken(req);
    if (!bearer) return res.status(401).json({ error: 'Jeton Player requis' });

    const rows = await db(`signage_players?select=id,owner_email,last_seen_at,current_publication_id,app_version,status&token_hash=eq.${hash(bearer)}&limit=1`);
    const player = rows?.[0];
    if (!player) return res.status(401).json({ error: 'Player non autorisé' });

    const now = new Date().toISOString();
    const runtimeVersion = cleanText(req.body?.runtimeVersion || 'unknown', 64);
    const diagnostics = safeDiagnostics(req.body?.diagnostics);

    await db(`signage_players?id=eq.${encodeURIComponent(player.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        runtime_last_seen_at: now,
        runtime_version: runtimeVersion,
        runtime_diagnostics: diagnostics,
        updated_at: now,
      }),
    });

    const playbackOnline = recent(player.last_seen_at);
    res.json({
      playerId: player.id,
      runtimeAccepted: true,
      runtimeServerTime: now,
      nextRuntimeHeartbeatSeconds: 30,
      playbackOnline,
      playbackLastSeenAt: player.last_seen_at || null,
      playbackAppVersion: player.app_version || null,
      currentPublicationId: player.current_publication_id || null,
      launchRequested: !playbackOnline,
    });
  } catch (error) {
    const status = /trop volumineux/i.test(error.message) ? 413 : 503;
    res.status(status).json({ error: error.message });
  }
});

module.exports = router;
