const express = require('express');
const router = express.Router();

const BASE = String(process.env.SIGNAGE_API_URL || 'https://olivier-signage-cockpit-production.up.railway.app').replace(/\/$/, '');
const TOKEN = String(process.env.SIGNAGE_API_TOKEN || '').trim();

async function upstream(path) {
  const headers = { accept: 'application/json' };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const r = await fetch(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(8000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Signage ${r.status}: ${text.slice(0,180)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function playersOf(data) {
  if (Array.isArray(data)) return data;
  return data?.players || data?.data?.players || data?.installations || data?.data || [];
}
function lastSeen(p) { return p?.last_seen_at || p?.lastSeenAt || p?.last_heartbeat_at || p?.lastHeartbeatAt || p?.updated_at || null; }
function ageMs(ts) { const n = ts ? Date.parse(ts) : NaN; return Number.isFinite(n) ? Date.now() - n : Infinity; }
function measured(v) { return v === undefined || v === null || v === '' ? 'unmeasured' : (v ? 'ok' : 'error'); }
function normalizePlayer(p) {
  const seen = lastSeen(p);
  const online = ageMs(seen) <= 90000;
  const publication = p?.publication ?? p?.active_publication ?? p?.current_publication ?? null;
  const hdmi = p?.hdmi_ok ?? p?.hdmi_connected ?? p?.display?.hdmi_connected ?? null;
  return {
    id: p?.id || p?.player_id || p?.uuid,
    name: p?.name || p?.label || p?.installation_name || 'Écran',
    installation: p?.installation || p?.installation_name || p?.site_name || null,
    version: p?.app_version || p?.version || p?.player_version || null,
    lastSeen: seen,
    online,
    currentMedia: p?.current_media || p?.currentMedia || publication?.current_media || null,
    nextMedia: p?.next_media || p?.nextMedia || null,
    schedule: p?.schedule || p?.schedule_status || null,
    content: p?.content || p?.content_status || null,
    diagnostics: {
      player: online ? 'ok' : 'error',
      network: online ? 'ok' : 'error',
      schedule: measured(p?.schedule_ok ?? (p?.schedule_status === 'ok' ? true : null)),
      publication: measured(p?.publication_ok ?? (p?.publication_status === 'ok' ? true : null)),
      hdmi: measured(hdmi),
      content: measured(p?.content_ok ?? (p?.content_status === 'ok' ? true : null)),
    },
    raw: p,
  };
}

router.get('/overview', async (_req, res) => {
  try {
    const dashboard = await upstream('/api/signage/manage/dashboard');
    const players = playersOf(dashboard).map(normalizePlayer);
    res.set('Cache-Control', 'no-store');
    res.json({ source: 'signage-railway', generatedAt: new Date().toISOString(), players });
  } catch (e) {
    res.status(502).json({ error: 'signage_upstream_unavailable', message: e.message });
  }
});

module.exports = router;
