const express = require('express');
const crypto = require('crypto');
const { requireSession } = require('./server-security.cjs');
const { postgresRest } = require('./server-postgres.cjs');
const { evaluatePlayerAdSchedule } = require('./server-signage-schedule.cjs');

const router = express.Router();
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cleanEmail = value => String(value || '').trim().toLowerCase();
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const isTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
const rejectCommercial = (req, res, next) => req.user?.role === 'collaborateur'
  ? res.status(403).json({ error: 'La programmation de l’écran nécessite un administrateur' })
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

async function verifyPlayerOwner(req, res) {
  const playerId = String(req.params.id || '');
  const ownerEmail = managedOwner(req);
  if (!isUuid(playerId)) {
    res.status(400).json({ error: 'Player invalide' });
    return null;
  }
  const rows = await db(`signage_players?select=id,owner_email&owner_email=eq.${encodeURIComponent(ownerEmail)}&id=eq.${encodeURIComponent(playerId)}&limit=1`);
  if (!rows?.[0]) {
    res.status(404).json({ error: 'Player introuvable' });
    return null;
  }
  return { playerId, ownerEmail };
}

function normalizeRanges(input, { requireDay = false } = {}) {
  if (!Array.isArray(input)) throw new Error('Plages horaires invalides');
  return input.map((range, index) => {
    const start = String(range.start_time ?? range.startTime ?? '').slice(0, 5);
    const end = String(range.end_time ?? range.endTime ?? '').slice(0, 5);
    if (!isTime(start) || !isTime(end) || start >= end) throw new Error(`Plage horaire ${index + 1} invalide`);
    if (!requireDay) return { start_time: start, end_time: end };
    const day = Number(range.day_of_week ?? range.dayOfWeek);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error(`Jour invalide pour la plage ${index + 1}`);
    return { day_of_week: day, start_time: start, end_time: end };
  });
}

router.use('/manage/players/:id/schedule', requireSession('client'), rejectCommercial);
router.use('/manage/players/:id/exceptions', requireSession('client'), rejectCommercial);

router.get('/manage/players/:id/schedule', async (req, res) => {
  try {
    const scope = await verifyPlayerOwner(req, res); if (!scope) return;
    const pid = encodeURIComponent(scope.playerId), email = encodeURIComponent(scope.ownerEmail);
    const [settings, ranges, exceptions] = await Promise.all([
      db(`signage_player_schedule_settings?select=*&player_id=eq.${pid}&owner_email=eq.${email}&limit=1`),
      db(`signage_player_schedule_ranges?select=*&player_id=eq.${pid}&owner_email=eq.${email}&order=day_of_week.asc`),
      db(`signage_player_schedule_exceptions?select=*&player_id=eq.${pid}&owner_email=eq.${email}&order=exception_date.asc`)
    ]);
    res.json({
      settings: settings?.[0] || { player_id: scope.playerId, owner_email: scope.ownerEmail, timezone: 'Europe/Brussels', configured: false, block_belgian_holidays: true },
      ranges: ranges || [],
      exceptions: exceptions || []
    });
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.put('/manage/players/:id/schedule', async (req, res) => {
  try {
    const scope = await verifyPlayerOwner(req, res); if (!scope) return;
    const ranges = normalizeRanges(req.body?.ranges || [], { requireDay: true });
    const configured = req.body?.configured !== false;
    const blockHolidays = req.body?.blockBelgianHolidays !== false;
    const now = new Date().toISOString();
    const pid = encodeURIComponent(scope.playerId), email = encodeURIComponent(scope.ownerEmail);

    await db(`signage_player_schedule_settings?on_conflict=player_id`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ player_id: scope.playerId, owner_email: scope.ownerEmail, timezone: 'Europe/Brussels', configured, block_belgian_holidays: blockHolidays, updated_at: now })
    });
    await db(`signage_player_schedule_ranges?player_id=eq.${pid}&owner_email=eq.${email}`, { method: 'DELETE' });
    if (ranges.length) {
      await db('signage_player_schedule_ranges', {
        method: 'POST',
        body: JSON.stringify(ranges.map(range => ({ ...range, player_id: scope.playerId, owner_email: scope.ownerEmail, updated_at: now })))
      });
    }
    const decision = await evaluatePlayerAdSchedule({ db, playerId: scope.playerId, ownerEmail: scope.ownerEmail, now: new Date() });
    res.json({ success: true, configured, ranges, decision });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/manage/players/:id/exceptions', async (req, res) => {
  try {
    const scope = await verifyPlayerOwner(req, res); if (!scope) return;
    const date = String(req.body?.date || req.body?.exception_date || '');
    const mode = String(req.body?.mode || 'closed');
    if (!isDate(date)) return res.status(400).json({ error: 'Date invalide' });
    if (!['closed', 'special_hours', 'normal'].includes(mode)) return res.status(400).json({ error: 'Mode invalide' });
    const ranges = mode === 'special_hours' ? normalizeRanges(req.body?.ranges || []) : [];
    const note = String(req.body?.note || '').slice(0, 240) || null;
    const now = new Date().toISOString();
    const rows = await db('signage_player_schedule_exceptions?on_conflict=player_id,exception_date', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ player_id: scope.playerId, owner_email: scope.ownerEmail, exception_date: date, mode, ranges, note, updated_at: now })
    });
    res.status(201).json(rows?.[0] || { player_id: scope.playerId, exception_date: date, mode, ranges, note });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/manage/players/:id/exceptions/:exceptionId', requireSession('client'), rejectCommercial, async (req, res) => {
  try {
    const scope = await verifyPlayerOwner(req, res); if (!scope) return;
    if (!isUuid(req.params.exceptionId)) return res.status(400).json({ error: 'Exception invalide' });
    await db(`signage_player_schedule_exceptions?id=eq.${encodeURIComponent(req.params.exceptionId)}&player_id=eq.${encodeURIComponent(scope.playerId)}&owner_email=eq.${encodeURIComponent(scope.ownerEmail)}`, { method: 'DELETE' });
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Heartbeat guard mounted before the legacy Signage router. It preserves the
// existing token and heartbeat implementation while stripping publications
// whenever the server-side schedule forbids advertising.
router.post('/player/heartbeat', async (req, res, next) => {
  try {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!bearer) return next();
    const players = await db(`signage_players?select=id,owner_email&token_hash=eq.${hash(bearer)}&limit=1`);
    const player = players?.[0];
    if (!player) return next();
    const decision = await evaluatePlayerAdSchedule({ db, playerId: player.id, ownerEmail: player.owner_email, now: new Date() });
    const originalJson = res.json.bind(res);
    res.json = body => originalJson({
      ...(body || {}),
      publication: decision.adsAllowed ? (body?.publication ?? null) : null,
      adsAllowed: decision.adsAllowed,
      reason: decision.reason,
      nextChangeAt: decision.nextChangeAt
    });
    next();
  } catch (e) {
    // A configured schedule must fail closed rather than accidentally display ads.
    res.status(503).json({ error: 'Planification indisponible', adsAllowed: false, reason: 'schedule_error', publication: null, nextChangeAt: null });
  }
});

module.exports = router;
