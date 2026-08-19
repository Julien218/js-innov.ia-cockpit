const express = require('express');
const { requireSession } = require('./server-security.cjs');
const { postgresRest } = require('./server-postgres.cjs');

const router = express.Router();
const encode = value => encodeURIComponent(String(value || ''));
const nowMs = () => Date.now();
const ONLINE_WINDOW_MS = 90_000;

async function db(resource, options = {}) { return postgresRest(resource, options); }

function selectedOwner(req) {
  const requested = String(req.headers['x-client-email'] || '').trim().toLowerCase();
  return requested || String(req.user?.email || '').trim().toLowerCase();
}

function activeMode(display) {
  if (!display || typeof display !== 'object') return null;
  const width = Number(display.width);
  const height = Number(display.height);
  const refreshRate = Number(display.refreshRate);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    modeId: display.modeId == null ? null : Number(display.modeId),
    width,
    height,
    refreshRate: Number.isFinite(refreshRate) ? refreshRate : null,
    hdr: typeof display.hdr === 'boolean' ? display.hdr : null,
  };
}

function supportedModes(display) {
  return Array.isArray(display?.supportedModes) ? display.supportedModes
    .map(mode => ({
      id: Number(mode?.id),
      width: Number(mode?.width),
      height: Number(mode?.height),
      refreshRate: Number(mode?.refreshRate),
    }))
    .filter(mode => Number.isFinite(mode.id) && Number.isFinite(mode.width) && Number.isFinite(mode.height) && Number.isFinite(mode.refreshRate)) : [];
}

function sameMode(mode, width, height, refresh) {
  if (!mode) return false;
  const refreshMatches = refresh == null || !Number.isFinite(Number(refresh)) || Math.abs(Number(mode.refreshRate) - Number(refresh)) < 0.6;
  return Number(mode.width) === Number(width) && Number(mode.height) === Number(height) && refreshMatches;
}

function ageMs(timestamp) {
  if (!timestamp) return null;
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, nowMs() - parsed);
}

function displayHealth(player, profile, publication, scheduleDecision) {
  const diagnostics = player?.diagnostics && typeof player.diagnostics === 'object' ? player.diagnostics : {};
  const runtimeDiagnostics = player?.runtime_diagnostics && typeof player.runtime_diagnostics === 'object' ? player.runtime_diagnostics : {};
  const display = diagnostics.display && typeof diagnostics.display === 'object' ? diagnostics.display : {};
  const playback = diagnostics.playback && typeof diagnostics.playback === 'object' ? diagnostics.playback : {};
  const playbackHeartbeatAgeMs = ageMs(player?.last_seen_at);
  const runtimeHeartbeatAgeMs = ageMs(player?.runtime_last_seen_at);
  const playbackOnline = player?.status === 'online' && playbackHeartbeatAgeMs !== null && playbackHeartbeatAgeMs < ONLINE_WINDOW_MS;
  const runtimeOnline = runtimeHeartbeatAgeMs !== null && runtimeHeartbeatAgeMs < ONLINE_WINDOW_MS;
  const deviceOnline = runtimeOnline || playbackOnline;
  const runtimeCapable = Boolean(player?.runtime_version || player?.runtime_last_seen_at);
  const scheduleAllowed = scheduleDecision?.ads_allowed;
  const hasPublication = Boolean(publication);
  const acked = Boolean(publication?.acknowledged_at) || publication?.status === 'active';
  const playing = playback.contentPlaying === true;
  const connected = typeof display.connected === 'boolean' ? display.connected : null;
  const mode = activeMode(display);
  const expectedMismatch = profile && profile.mode !== 'AUTO' && profile.preferred_width && profile.preferred_height && mode
    ? !sameMode(mode, profile.preferred_width, profile.preferred_height, profile.preferred_refresh_hz)
    : false;

  const checks = {
    runtime: runtimeOnline ? 'OK' : runtimeCapable ? 'ERROR' : playbackOnline ? 'UNKNOWN' : 'ERROR',
    player: playbackOnline ? 'OK' : 'ERROR',
    network: deviceOnline ? 'OK' : 'ERROR',
    schedule: scheduleAllowed === false ? 'WARNING' : scheduleAllowed === true ? 'OK' : 'UNKNOWN',
    publication: !deviceOnline ? 'UNKNOWN' : !hasPublication ? 'WARNING' : acked ? 'OK' : 'WARNING',
    hdmi: connected === true ? 'OK' : connected === false ? 'ERROR' : 'UNKNOWN',
    displayMode: !mode ? 'UNKNOWN' : expectedMismatch ? 'WARNING' : 'OK',
    content: scheduleAllowed === false ? 'WARNING' : playing ? 'OK' : acked ? 'WARNING' : 'UNKNOWN',
  };

  let state = 'HEALTHY';
  let label = 'DISPLAY OK';
  if (!deviceOnline) { state = 'PLAYER_OFFLINE'; label = 'TVBOX / PLAYER OFFLINE'; }
  else if (runtimeOnline && !playbackOnline) { state = 'PLAYER_APP_ERROR'; label = 'TVBOX CONNECTÉ / PLAYER NON ACTIF'; }
  else if (connected === false) { state = 'DISPLAY_ERROR'; label = 'HDMI NON DÉTECTÉ'; }
  else if (expectedMismatch) { state = 'DISPLAY_MODE_WARNING'; label = 'HDMI DÉTECTÉ / MODE INCOMPATIBLE'; }
  else if (scheduleAllowed === false) { state = 'OUT_OF_SCHEDULE'; label = 'PLAYER ONLINE / HORS HORAIRES'; }
  else if (!hasPublication) { state = 'NO_PUBLICATION'; label = 'PLAYER ONLINE / PAS DE PUBLICATION'; }
  else if (!acked) { state = 'WAITING_ACK'; label = 'PUBLICATION ENVOYÉE / PAS D’ACK'; }
  else if (playing) { state = 'HEALTHY'; label = 'PUBLICATION ACK / CONTENU EN LECTURE'; }
  else { state = 'CONTENT_UNCONFIRMED'; label = 'PUBLICATION ACK / LECTURE NON CONFIRMÉE'; }

  return {
    state,
    label,
    checks,
    deviceOnline,
    runtimeOnline,
    playbackOnline,
    runtimeHeartbeatAgeMs,
    playbackHeartbeatAgeMs,
    currentMode: mode,
    runtime: runtimeDiagnostics,
  };
}

async function assertPlayerOwner(playerId, ownerEmail) {
  const rows = await db(`signage_players?select=id,owner_email,name,status,last_seen_at,current_publication_id,app_version,diagnostics,site_id,runtime_last_seen_at,runtime_version,runtime_diagnostics&id=eq.${encode(playerId)}&owner_email=eq.${encode(ownerEmail)}&limit=1`);
  return rows?.[0] || null;
}

async function latestPublication(playerId) {
  const rows = await db(`signage_publications?select=id,status,scheduled_at,activated_at,acknowledged_at,error,created_at&player_id=eq.${encode(playerId)}&order=created_at.desc&limit=1`);
  return rows?.[0] || null;
}

async function latestScheduleDecision(playerId) {
  const rows = await db(`signage_schedule_audit?select=ads_allowed,reason,next_change_at,evaluated_at&player_id=eq.${encode(playerId)}&order=evaluated_at.desc&limit=1`).catch(() => []);
  return rows?.[0] || null;
}

async function getProfile(playerId, ownerEmail) {
  const rows = await db(`signage_display_profiles?select=*&player_id=eq.${encode(playerId)}&owner_email=eq.${encode(ownerEmail)}&limit=1`);
  return rows?.[0] || null;
}

router.use('/manage/display', requireSession('admin'));

router.get('/manage/display/players/:id', async (req, res) => {
  try {
    const ownerEmail = selectedOwner(req);
    const player = await assertPlayerOwner(req.params.id, ownerEmail);
    if (!player) return res.status(404).json({ error: 'Player introuvable pour ce client' });
    const [profile, publication, schedule] = await Promise.all([
      getProfile(player.id, ownerEmail), latestPublication(player.id), latestScheduleDecision(player.id)
    ]);
    const diagnostics = player.diagnostics || {};
    const display = diagnostics.display || {};
    res.json({
      player,
      runtime: player.runtime_diagnostics || null,
      device: diagnostics.device || player.runtime_diagnostics?.device || null,
      display: diagnostics.display || null,
      playback: diagnostics.playback || null,
      supportedModes: supportedModes(display),
      profile,
      publication,
      schedule,
      health: displayHealth(player, profile, publication, schedule),
      capabilities: {
        runtimeHeartbeat: 'SUPPORTED_FROM_0_5_3',
        hdmiDetection: 'PARTIALLY_SUPPORTED',
        activeResolution: 'SUPPORTED',
        activeRefreshRate: 'SUPPORTED',
        supportedModes: 'SUPPORTED',
        hdr: 'SUPPORTED_WHEN_REPORTED',
        edid: 'NOT_SUPPORTED_PUBLIC_SDK',
        resolutionChange: 'PARTIALLY_SUPPORTED_UNVERIFIED_FIRMWARE',
        refreshChange: 'PARTIALLY_SUPPORTED_UNVERIFIED_FIRMWARE',
        hdmiLossDetection: 'PARTIALLY_SUPPORTED',
        controlEnabled: false,
        reason: 'observe_only_until_real_device_modes_are_verified'
      }
    });
  } catch (error) { res.status(503).json({ error: error.message }); }
});

router.put('/manage/display/players/:id/profile', async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Super Admin requis pour modifier un profil vidéo' });
    const ownerEmail = selectedOwner(req);
    const player = await assertPlayerOwner(req.params.id, ownerEmail);
    if (!player) return res.status(404).json({ error: 'Player introuvable pour ce client' });

    const input = req.body || {};
    const mode = String(input.mode || 'AUTO').toUpperCase();
    if (!['AUTO', 'PROFILE', 'MANUAL'].includes(mode)) return res.status(400).json({ error: 'Mode Display invalide' });
    const width = input.preferredWidth == null ? null : Number(input.preferredWidth);
    const height = input.preferredHeight == null ? null : Number(input.preferredHeight);
    const refresh = input.preferredRefreshHz == null ? null : Number(input.preferredRefreshHz);
    const advertised = supportedModes(player.diagnostics?.display);

    if (mode === 'MANUAL') {
      if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(refresh)) {
        return res.status(400).json({ error: 'Le mode MANUAL exige une résolution et une fréquence annoncées par le Player' });
      }
      if (!advertised.some(item => sameMode(item, width, height, refresh))) {
        return res.status(409).json({ error: 'Ce mode n’est pas annoncé par le matériel. Aucun forçage ne sera effectué.' });
      }
    }

    if (mode === 'PROFILE' && Number.isFinite(width) && Number.isFinite(height) && advertised.length && !advertised.some(item => sameMode(item, width, height, refresh))) {
      return res.status(409).json({ error: 'Le profil demandé n’est pas compatible avec les modes actuellement annoncés par ce Player.' });
    }

    const fallbackModes = Array.isArray(input.fallbackModes) ? input.fallbackModes.slice(0, 8) : [];
    const payload = {
      owner_email: ownerEmail,
      player_id: player.id,
      site_id: player.site_id || null,
      mode,
      profile_name: String(input.profileName || '').slice(0, 120) || null,
      processor_type: String(input.processorType || 'generic_hdmi').slice(0, 80),
      preferred_width: Number.isFinite(width) ? Math.round(width) : null,
      preferred_height: Number.isFinite(height) ? Math.round(height) : null,
      preferred_refresh_hz: Number.isFinite(refresh) ? refresh : null,
      hdr_enabled: typeof input.hdrEnabled === 'boolean' ? input.hdrEnabled : null,
      fallback_modes: fallbackModes,
      last_stable_mode: activeMode(player.diagnostics?.display),
      control_capability: 'observe_only',
      max_attempts: 2,
      rollback_timeout_seconds: 15,
      updated_by: String(req.user.email || '').toLowerCase(),
      updated_at: new Date().toISOString()
    };
    const rows = await db('signage_display_profiles?on_conflict=player_id', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(payload)
    });
    await db('signage_audit_events', {
      method: 'POST', body: JSON.stringify({
        owner_email: ownerEmail,
        actor_email: String(req.user.email || '').toLowerCase(),
        action: 'display.profile.updated', entity_type: 'player', entity_id: player.id,
        details: { mode, profileName: payload.profile_name, observeOnly: true, preferred: { width: payload.preferred_width, height: payload.preferred_height, refreshHz: payload.preferred_refresh_hz } }
      })
    }).catch(() => {});
    res.json({ profile: rows?.[0] || payload, applied: false, controlCapability: 'observe_only' });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

module.exports = router;
