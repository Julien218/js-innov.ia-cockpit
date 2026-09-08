const express = require('express');
const crypto = require('crypto');
const { requireSession } = require('./server-security.cjs');
const { getPool, ensureReady } = require('./server-postgres.cjs');

const router = express.Router();
const sessions = new Map();
const MAX_SESSION_AGE_MS = 2 * 60 * 60 * 1000;
const FRAME_LIMIT = 80;
const FRAME_BYTES_LIMIT = 700 * 1024;

const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const nowIso = () => new Date().toISOString();
const safeEmail = value => String(value || '').trim().toLowerCase();
const isAdmin = req => ['admin', 'superadmin'].includes(req.user?.role);

function cleanupSessions() {
  const cutoff = Date.now() - MAX_SESSION_AGE_MS;
  for (const [id, session] of sessions) {
    if (new Date(session.createdAt).getTime() < cutoff) sessions.delete(id);
  }
}

function owner(req) {
  const own = safeEmail(req.user?.email);
  if (!isAdmin(req)) return own;
  const requested = safeEmail(req.headers['x-client-email']);
  return requested && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requested) ? requested : own;
}

async function query(text, values = []) {
  await ensureReady();
  return (await getPool().query(text, values)).rows;
}

async function gatewayFromRequest(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!bearer) return null;
  const rows = await query('select * from camera_gateways where token_hash=$1 limit 1', [hash(bearer)]);
  return rows[0] || null;
}

function parseItems(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function mediaIdOf(item) {
  return String(item?.mediaId || item?.media_id || item?.media?.id || '');
}

function durationOf(item, media) {
  const rendition = parseJson(media?.rendition);
  const mimeType = String(media?.mime_type || item?.media?.mime_type || '');
  const isVideo = mimeType.startsWith('video/');
  const candidates = isVideo
    ? [
        media?.duration_seconds,
        rendition?.durationSeconds,
        rendition?.duration_seconds,
      ]
    : [
        item?.durationSeconds,
        item?.duration_seconds,
        media?.duration_seconds,
        rendition?.durationSeconds,
        rendition?.duration_seconds,
      ];
  for (const candidate of candidates) {
    const seconds = Number(candidate || 0);
    if (Number.isFinite(seconds) && seconds > 0) return { seconds: Math.max(1, seconds), estimated: false };
  }
  return { seconds: 8, estimated: true };
}

async function buildProgram(ownerEmail) {
  const players = await query(
    `select id,name,status,last_seen_at,current_publication_id,diagnostics
       from signage_players where lower(owner_email)=lower($1)
       order by last_seen_at desc nulls last, created_at asc limit 10`,
    [ownerEmail]
  );
  const player = players.find(row => row.status === 'online' && row.last_seen_at && Date.now() - new Date(row.last_seen_at).getTime() < 120000) || players[0];
  if (!player) throw new Error('Aucun Player associé à ce client');

  let publication = null;
  if (player.current_publication_id) {
    const rows = await query('select * from signage_publications where id=$1 and lower(owner_email)=lower($2) limit 1', [player.current_publication_id, ownerEmail]);
    publication = rows[0] || null;
  }
  if (!publication) {
    const rows = await query(
      `select * from signage_publications
       where lower(owner_email)=lower($1) and player_id=$2 and status='active'
       order by acknowledged_at desc nulls last, created_at desc limit 1`,
      [ownerEmail, player.id]
    );
    publication = rows[0] || null;
  }
  if (!publication) throw new Error('Aucune publication active à analyser');

  const playlists = await query('select id,name,items,revision from signage_playlists where id=$1 and lower(owner_email)=lower($2) limit 1', [publication.playlist_id, ownerEmail]);
  const playlist = playlists[0];
  if (!playlist) throw new Error('Playlist active introuvable');
  const rawItems = parseItems(playlist.items);
  if (!rawItems.length) throw new Error('La playlist active est vide');

  const expected = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const item = rawItems[index];
    const mediaId = mediaIdOf(item);
    let media = null;
    if (mediaId) {
      const rows = await query('select id,name,mime_type,duration_seconds,rendition from signage_media where id=$1 and lower(owner_email)=lower($2) limit 1', [mediaId, ownerEmail]);
      media = rows[0] || null;
    }
    const duration = durationOf(item, media);
    expected.push({
      index,
      order: index + 1,
      mediaId,
      mediaName: media?.name || item?.media?.name || `Annonce ${index + 1}`,
      mimeType: media?.mime_type || item?.media?.mime_type || '',
      durationSeconds: duration.seconds,
      durationEstimated: duration.estimated,
    });
  }

  const playback = parseJson(parseJson(player.diagnostics).playback);
  const anchorMediaId = String(playback.currentMediaId || '');
  const anchorIndex = expected.findIndex(item => item.mediaId && item.mediaId === anchorMediaId);
  const anchorStartedAt = Number(playback.currentMediaStartedAt || 0);
  const loopSeconds = expected.reduce((sum, item) => sum + Number(item.durationSeconds || 0), 0);

  return {
    player: { id: player.id, name: player.name, lastSeenAt: player.last_seen_at },
    publication: { id: publication.id, playlistId: publication.playlist_id },
    playlist: { id: playlist.id, name: playlist.name, revision: playlist.revision },
    expected,
    loopSeconds,
    anchor: {
      mediaId: anchorMediaId || null,
      mediaName: playback.currentMediaName || null,
      startedAt: anchorStartedAt > 0 ? new Date(anchorStartedAt).toISOString() : null,
      index: anchorIndex >= 0 ? anchorIndex : null,
    },
  };
}

function itemAt(session, capturedAt) {
  const expected = session.expected || [];
  if (!expected.length) return null;
  const anchor = session.anchor || {};
  if (!Number.isInteger(anchor.index) || !anchor.startedAt) return null;
  const loopMs = expected.reduce((sum, item) => sum + Number(item.durationSeconds || 0) * 1000, 0);
  if (!loopMs) return null;
  const anchorStart = new Date(anchor.startedAt).getTime();
  const captureTime = new Date(capturedAt).getTime();
  if (!Number.isFinite(anchorStart) || !Number.isFinite(captureTime)) return null;
  let elapsed = captureTime - anchorStart;
  elapsed = ((elapsed % loopMs) + loopMs) % loopMs;
  let index = anchor.index;
  for (let guard = 0; guard < expected.length + 1; guard += 1) {
    const durationMs = Number(expected[index]?.durationSeconds || 8) * 1000;
    if (elapsed < durationMs) return expected[index];
    elapsed -= durationMs;
    index = (index + 1) % expected.length;
  }
  return expected[anchor.index] || null;
}

function publicSession(session) {
  const perItem = session.expected.map(item => {
    const frames = session.frames.filter(frame => frame.itemIndex === item.index);
    const representative = frames[Math.floor(frames.length / 2)] || frames[0] || null;
    return {
      ...item,
      visualStatus: frames.length ? 'confirmed' : 'not_seen',
      screenshotCount: frames.length,
      representativeFrameId: representative?.id || null,
      representativeAt: representative?.capturedAt || null,
      brightness: representative?.brightness ?? null,
      changeScore: representative?.changeScore ?? null,
    };
  });
  const observed = perItem.filter(item => item.screenshotCount > 0).length;
  const scores = session.frames.map(frame => Number(frame.changeScore)).filter(Number.isFinite);
  const frozenSuspected = session.expected.length > 1 && scores.length >= 4 && scores.filter(score => score >= 5).length <= 1;
  return {
    id: session.id,
    status: session.status,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    durationSeconds: session.durationSeconds,
    intervalSeconds: session.intervalSeconds,
    loopSeconds: session.loopSeconds,
    camera: session.camera,
    player: session.player,
    playlist: session.playlist,
    publication: session.publication,
    anchor: session.anchor,
    alignment: Number.isInteger(session.anchor?.index) && session.anchor?.startedAt ? 'player_timeline' : 'unconfirmed',
    expectedCount: perItem.length,
    observedCount: observed,
    allSeen: observed === perItem.length && perItem.length > 0,
    frozenSuspected,
    framesCaptured: session.frames.length,
    items: perItem,
    error: session.error || null,
  };
}

router.use('/manage/screen-analysis', requireSession('client'));

router.post('/manage/screen-analysis', async (req, res) => {
  try {
    cleanupSessions();
    const ownerEmail = owner(req);
    const cameraId = String(req.body?.cameraId || '');
    if (!cameraId) return res.status(400).json({ error: 'Caméra requise' });
    const cameras = await query(
      `select c.id,c.name,c.model,c.status,c.last_seen_at,c.gateway_id,g.status as gateway_status,g.last_seen_at as gateway_last_seen_at
       from cameras c join camera_gateways g on g.id=c.gateway_id
       where c.id=$1 and lower(c.owner_email)=lower($2) and c.enabled=true limit 1`,
      [cameraId, ownerEmail]
    );
    const camera = cameras[0];
    if (!camera) return res.status(404).json({ error: 'Caméra de contrôle introuvable' });
    if (camera.gateway_status !== 'online' || !camera.gateway_last_seen_at || Date.now() - new Date(camera.gateway_last_seen_at).getTime() > 120000) {
      return res.status(409).json({ error: 'La passerelle caméra doit être en ligne pour lancer l’analyse' });
    }

    const program = await buildProgram(ownerEmail);
    const requestedInterval = Number(req.body?.intervalSeconds || 4);
    const intervalSeconds = Math.min(8, Math.max(2, Number.isFinite(requestedInterval) ? requestedInterval : 4));
    const durationSeconds = Math.min(180, Math.max(30, Math.ceil(program.loopSeconds + 12)));
    const id = crypto.randomUUID();
    const session = {
      id,
      ownerEmail,
      gatewayId: camera.gateway_id,
      cameraId: camera.id,
      camera: { id: camera.id, name: camera.name, model: camera.model },
      player: program.player,
      publication: program.publication,
      playlist: program.playlist,
      expected: program.expected,
      loopSeconds: program.loopSeconds,
      anchor: program.anchor,
      durationSeconds,
      intervalSeconds,
      status: 'queued',
      createdAt: nowIso(),
      startedAt: null,
      completedAt: null,
      frames: [],
      error: null,
    };
    sessions.set(id, session);
    res.status(201).json(publicSession(session));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/manage/screen-analysis/:id', async (req, res) => {
  cleanupSessions();
  const session = sessions.get(String(req.params.id));
  if (!session || session.ownerEmail !== owner(req)) return res.status(404).json({ error: 'Analyse introuvable ou expirée' });
  if (['queued', 'running'].includes(session.status)) {
    const base = new Date(session.startedAt || session.createdAt).getTime();
    if (Date.now() - base > (session.durationSeconds + 90) * 1000) {
      session.status = 'failed';
      session.completedAt = nowIso();
      session.error = 'La passerelle n’a pas terminé l’analyse dans le délai prévu';
    }
  }
  res.json(publicSession(session));
});

router.get('/manage/screen-analysis/:id/frames/:frameId', async (req, res) => {
  cleanupSessions();
  const session = sessions.get(String(req.params.id));
  if (!session || session.ownerEmail !== owner(req)) return res.status(404).json({ error: 'Analyse introuvable ou expirée' });
  const frame = session.frames.find(item => item.id === String(req.params.frameId));
  if (!frame) return res.status(404).json({ error: 'Capture introuvable' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.send(frame.body);
});

router.post('/gateway/screen-analysis/next', async (req, res) => {
  try {
    cleanupSessions();
    const gateway = await gatewayFromRequest(req);
    if (!gateway) return res.status(401).json({ error: 'Passerelle non autorisée' });
    const session = [...sessions.values()].find(item => item.gatewayId === gateway.id && item.status === 'queued');
    if (!session) return res.json({ analysis: null, nextPollSeconds: 30 });
    session.status = 'running';
    session.startedAt = nowIso();
    res.json({
      analysis: {
        id: session.id,
        cameraId: session.cameraId,
        durationSeconds: session.durationSeconds,
        intervalSeconds: session.intervalSeconds,
      },
      nextPollSeconds: 30,
    });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

const analysisFrameBody = express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: FRAME_BYTES_LIMIT });
router.post('/gateway/screen-analysis/:id/frame', (req, res, next) => analysisFrameBody(req, res, error => error ? res.status(413).json({ error: 'Capture d’analyse trop volumineuse' }) : next()), async (req, res) => {
  try {
    const gateway = await gatewayFromRequest(req);
    if (!gateway) return res.status(401).json({ error: 'Passerelle non autorisée' });
    const session = sessions.get(String(req.params.id));
    if (!session || session.gatewayId !== gateway.id || session.status !== 'running') return res.status(404).json({ error: 'Analyse inactive' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Capture vide' });
    if (session.frames.length >= FRAME_LIMIT) return res.status(202).json({ accepted: false, reason: 'frame_limit' });
    const capturedAt = String(req.query.capturedAt || nowIso());
    const expectedItem = itemAt(session, capturedAt);
    const brightness = Number(req.query.brightness);
    const changeScore = Number(req.query.changeScore);
    session.frames.push({
      id: crypto.randomUUID(),
      capturedAt,
      itemIndex: expectedItem?.index ?? null,
      mediaId: expectedItem?.mediaId || null,
      mediaName: expectedItem?.mediaName || null,
      brightness: Number.isFinite(brightness) ? brightness : null,
      changeScore: Number.isFinite(changeScore) ? changeScore : null,
      body: Buffer.from(req.body),
    });
    res.status(202).json({ accepted: true, expectedMedia: expectedItem?.mediaName || null });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

router.post('/gateway/screen-analysis/:id/complete', express.json({ limit: '64kb' }), async (req, res) => {
  try {
    const gateway = await gatewayFromRequest(req);
    if (!gateway) return res.status(401).json({ error: 'Passerelle non autorisée' });
    const session = sessions.get(String(req.params.id));
    if (!session || session.gatewayId !== gateway.id) return res.status(404).json({ error: 'Analyse introuvable' });
    session.status = req.body?.ok === false ? 'failed' : 'completed';
    session.completedAt = nowIso();
    session.error = req.body?.error ? String(req.body.error).slice(0, 300) : null;
    const summary = publicSession(session);
    await query(
      `insert into signage_audit_events(owner_email,actor_email,action,entity_type,entity_id,details)
       values($1,'camera-gateway','screen_analysis.completed','screen_analysis',$2,$3::jsonb)`,
      [session.ownerEmail, session.id, JSON.stringify({
        cameraId: session.cameraId,
        playlistId: session.playlist?.id,
        expectedCount: summary.expectedCount,
        observedCount: summary.observedCount,
        allSeen: summary.allSeen,
        frozenSuspected: summary.frozenSuspected,
        durationSeconds: session.durationSeconds,
        framesCaptured: session.frames.length,
      })]
    ).catch(() => {});
    res.json({ accepted: true, status: session.status });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

module.exports = router;
