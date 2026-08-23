const express = require('express');
const crypto = require('crypto');
const { requireSession } = require('./server-security.cjs');
const { postgresRest, getPool } = require('./server-postgres.cjs');

const router = express.Router();
const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const encode = value => encodeURIComponent(String(value || ''));
const ALLOWED = new Set([
  'restart_player', 'reload_content', 'pause_playback', 'resume_playback',
  'set_volume', 'set_brightness', 'set_orientation', 'set_display_mode', 'update_now'
]);

async function db(resource, options = {}) { return postgresRest(resource, options); }

function selectedOwner(req) {
  return String(req.headers['x-client-email'] || req.user?.email || '').trim().toLowerCase();
}

function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

function cleanPayload(command, input) {
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (command === 'set_volume') {
    const percent = Number(payload.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Volume attendu entre 0 et 100');
    return { percent: Math.round(percent) };
  }
  if (command === 'set_brightness') {
    const percent = Number(payload.percent);
    if (!Number.isFinite(percent) || percent < 5 || percent > 100) throw new Error('Luminosité attendue entre 5 et 100');
    return { percent: Math.round(percent) };
  }
  if (command === 'set_orientation') {
    const orientation = String(payload.orientation || '').toLowerCase();
    if (!['landscape', 'portrait', 'sensor'].includes(orientation)) throw new Error('Orientation invalide');
    return { orientation };
  }
  if (command === 'set_display_mode') {
    const width = Number(payload.width), height = Number(payload.height), refreshRate = Number(payload.refreshRate);
    if (![width, height, refreshRate].every(Number.isFinite)) throw new Error('Mode HDMI incomplet');
    return { width: Math.round(width), height: Math.round(height), refreshRate };
  }
  return {};
}

async function authenticatedPlayer(req) {
  const token = bearer(req);
  if (!token) return null;
  const rows = await db(`signage_players?select=id,owner_email&token_hash=eq.${hash(token)}&limit=1`);
  return rows?.[0] || null;
}

async function claimNextCommand(playerId) {
  const pool = getPool();
  if (!pool) throw new Error('Base de commandes distante indisponible');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      "update signage_player_commands set status='expired', acknowledged_at=now() where player_id=$1 and status in ('pending','delivered') and expires_at<=now()",
      [playerId]
    );
    const claimed = await client.query(
      `select id,command,payload,created_at,expires_at
       from signage_player_commands
       where player_id=$1 and status='pending' and expires_at>now()
       order by created_at asc
       for update skip locked
       limit 1`,
      [playerId]
    );
    const command = claimed.rows[0] || null;
    if (command) {
      await client.query("update signage_player_commands set status='delivered', delivered_at=now() where id=$1", [command.id]);
    }
    await client.query('commit');
    return command;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally { client.release(); }
}

router.use('/manage/remote-control', requireSession('admin'));

router.get('/manage/remote-control/players/:id/commands', async (req, res) => {
  try {
    const ownerEmail = selectedOwner(req);
    const players = await db(`signage_players?select=id&owner_email=eq.${encode(ownerEmail)}&id=eq.${encode(req.params.id)}&limit=1`);
    if (!players?.[0]) return res.status(404).json({ error: 'Player introuvable pour ce client' });
    const commands = await db(`signage_player_commands?select=id,command,payload,status,created_by,created_at,delivered_at,acknowledged_at,expires_at,result&player_id=eq.${encode(req.params.id)}&owner_email=eq.${encode(ownerEmail)}&order=created_at.desc&limit=30`);
    res.json({ commands: commands || [] });
  } catch (error) { res.status(503).json({ error: error.message }); }
});

router.post('/manage/remote-control/players/:id/commands', async (req, res) => {
  try {
    if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'Super Admin requis pour commander un Player' });
    const ownerEmail = selectedOwner(req);
    const command = String(req.body?.command || '').trim();
    if (!ALLOWED.has(command)) return res.status(400).json({ error: 'Commande distante non autorisée' });
    const players = await db(`signage_players?select=id,owner_email&owner_email=eq.${encode(ownerEmail)}&id=eq.${encode(req.params.id)}&limit=1`);
    if (!players?.[0]) return res.status(404).json({ error: 'Player introuvable pour ce client' });
    const payload = cleanPayload(command, req.body?.payload);
    const rows = await db('signage_player_commands', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ owner_email: ownerEmail, player_id: req.params.id, command, payload, created_by: String(req.user.email || '').toLowerCase() })
    });
    await db('signage_audit_events', { method: 'POST', body: JSON.stringify({
      owner_email: ownerEmail, actor_email: String(req.user.email || '').toLowerCase(),
      action: 'player.remote_command.created', entity_type: 'player', entity_id: req.params.id,
      details: { command, commandId: rows?.[0]?.id || null }
    }) }).catch(() => {});
    res.status(201).json({ command: rows?.[0] || null });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/player/commands/next', async (req, res) => {
  try {
    const player = await authenticatedPlayer(req);
    if (!player) return res.status(401).json({ error: 'Player non autorisé' });
    res.json({ command: await claimNextCommand(player.id) });
  } catch (error) { res.status(503).json({ error: error.message }); }
});

router.post('/player/commands/:id/ack', async (req, res) => {
  try {
    const player = await authenticatedPlayer(req);
    if (!player) return res.status(401).json({ error: 'Player non autorisé' });
    const rows = await db(`signage_player_commands?select=id&player_id=eq.${encode(player.id)}&id=eq.${encode(req.params.id)}&limit=1`);
    if (!rows?.[0]) return res.status(404).json({ error: 'Commande introuvable' });
    const succeeded = req.body?.status === 'succeeded';
    const result = req.body?.result && typeof req.body.result === 'object' ? req.body.result : {};
    const now = new Date().toISOString();
    await db(`signage_player_commands?id=eq.${encode(req.params.id)}&player_id=eq.${encode(player.id)}`, {
      method: 'PATCH', body: JSON.stringify({ status: succeeded ? 'succeeded' : 'failed', result, acknowledged_at: now })
    });
    res.json({ success: true });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

module.exports = { router, claimNextCommand };
