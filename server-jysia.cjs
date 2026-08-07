// server-jysia.cjs — proxy privé Cockpit -> JYSIA
// Les clés JYSIA restent exclusivement côté serveur.
const express = require('express');
const cookie = require('cookie');

const router = express.Router();

const JYSIA_API_URL = (process.env.JYSIA_API_URL || '').replace(/\/$/, '');
const JYSIA_API_KEY = process.env.JYSIA_API_KEY || '';
const JYSIA_APPROVAL_KEY = process.env.JYSIA_APPROVAL_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const COCKPIT_URL = process.env.COCKPIT_URL || 'https://cockpit.jsinnovia.com';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimits = new Map();

function configurationReady() {
  return Boolean(JYSIA_API_URL && JYSIA_API_KEY && SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

function validUpstreamUrl() {
  if (!JYSIA_API_URL) return false;
  try {
    const url = new URL(JYSIA_API_URL);
    return url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}

function clientIp(req) {
  return req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';
}

function validateOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const raw = req.headers.origin || req.headers.referer || '';
  if (!raw) return false;
  try {
    const origin = new URL(raw).origin;
    return origin === COCKPIT_URL ||
      origin === 'http://localhost:5173' ||
      origin === 'http://localhost:3000';
  } catch {
    return false;
  }
}

function getSessionToken(req) {
  const parsed = cookie.parse(req.headers.cookie || '');
  return parsed.session || null;
}

async function supabaseSelect(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Supabase session lookup failed: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

async function requireAdminSession(req, res, next) {
  if (!configurationReady() || !validUpstreamUrl()) {
    return res.status(503).json({ error: 'JYSIA n’est pas encore configurée.' });
  }
  if (!validateOrigin(req)) {
    return res.status(403).json({ error: 'Origine non autorisée.' });
  }

  const token = getSessionToken(req);
  if (!token) return res.status(401).json({ error: 'Session requise.' });

  try {
    const sessions = await supabaseSelect(
      `cockpit_sessions?select=user_id,expires_at&token=eq.${encodeURIComponent(token)}&limit=1`
    );
    const session = sessions[0];
    if (!session || new Date(session.expires_at) <= new Date()) {
      return res.status(401).json({ error: 'Session invalide.' });
    }

    const users = await supabaseSelect(
      `cockpit_users?select=id,email,full_name,role,is_active&id=eq.${encodeURIComponent(session.user_id)}&is_active=eq.true&limit=1`
    );
    const user = users[0];
    if (!user) return res.status(401).json({ error: 'Session invalide.' });
    if (!['admin', 'superadmin'].includes(user.role)) {
      return res.status(403).json({ error: 'Accès administrateur requis.' });
    }

    const key = `${user.id}:${clientIp(req)}`;
    const now = Date.now();
    const recent = (rateLimits.get(key) || []).filter((stamp) => now - stamp < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      return res.status(429).set('Retry-After', '60').json({ error: 'Trop de requêtes.' });
    }
    recent.push(now);
    rateLimits.set(key, recent);

    req.cockpitUser = user;
    next();
  } catch (error) {
    console.error('[jysia] session validation failed');
    return res.status(503).json({ error: 'Validation de session indisponible.' });
  }
}

function safeActionId(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

async function callJysia(path, { method = 'GET', body, approval = false, idempotencyKey } = {}) {
  const headers = {
    Accept: 'application/json',
    'X-Jysia-Key': JYSIA_API_KEY,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (approval) headers['X-Jysia-Approval-Key'] = JYSIA_APPROVAL_KEY;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const response = await fetch(`${JYSIA_API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: 'Réponse JYSIA invalide.' };
    }
  }
  return { response, data };
}

function sendUpstream(res, response, data) {
  if (response.ok) return res.status(response.status).json(data);
  const detail = data?.detail || data?.error;
  return res.status(response.status).json({
    error: typeof detail === 'string' ? detail : 'JYSIA a refusé la requête.',
  });
}

router.use((req, res, next) => {
  const length = Number(req.headers['content-length'] || 0);
  if (length > 262_144) return res.status(413).json({ error: 'Requête trop volumineuse.' });
  next();
});
router.use(requireAdminSession);

router.get('/health', async (req, res) => {
  try {
    const response = await fetch(`${JYSIA_API_URL}/health`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'JYSIA est indisponible.' });
  }
});

router.get('/capabilities', async (req, res) => {
  try {
    const { response, data } = await callJysia('/v1/capabilities');
    return sendUpstream(res, response, data);
  } catch {
    return res.status(502).json({ error: 'JYSIA est indisponible.' });
  }
});

router.post('/agent/run', async (req, res) => {
  const allowedTasks = new Set([
    'audit', 'product_offer', 'lead_qualification', 'campaign',
    'email_draft', 'site_review', 'objection', 'general',
  ]);
  const task = allowedTasks.has(req.body?.task) ? req.body.task : 'general';
  const payload = {
    task,
    objective: String(req.body?.objective || '').slice(0, 1000),
    target: String(req.body?.target || 'Prospects et clients JS-Innov.IA').slice(0, 500),
    product: String(req.body?.product || 'Catalogue JS-Innov.IA').slice(0, 500),
    context: String(req.body?.context || '').slice(0, 20_000),
    known_facts: Array.isArray(req.body?.known_facts)
      ? req.body.known_facts.slice(0, 100).map((item) => String(item).slice(0, 500))
      : [],
    locale: 'fr-BE',
    requested_by: `${req.cockpitUser.full_name || req.cockpitUser.email} (cockpit)`.slice(0, 200),
  };

  if (payload.objective.length < 3) {
    return res.status(400).json({ error: 'Objectif trop court.' });
  }

  try {
    const { response, data } = await callJysia('/v1/agent/run', { method: 'POST', body: payload });
    return sendUpstream(res, response, data);
  } catch {
    return res.status(502).json({ error: 'JYSIA est indisponible.' });
  }
});

router.post('/actions/email', async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    return res.status(400).json({ error: 'Idempotency-Key invalide.' });
  }
  const payload = {
    ...req.body,
    requested_by: `${req.cockpitUser.full_name || req.cockpitUser.email} (cockpit)`.slice(0, 200),
  };
  try {
    const { response, data } = await callJysia('/v1/actions/email', {
      method: 'POST',
      body: payload,
      idempotencyKey,
    });
    return sendUpstream(res, response, data);
  } catch {
    return res.status(502).json({ error: 'JYSIA est indisponible.' });
  }
});

router.get('/approvals', async (req, res) => {
  const status = typeof req.query.status === 'string' && /^[a-z_]{1,20}$/.test(req.query.status)
    ? req.query.status
    : '';
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const query = new URLSearchParams({ limit: String(limit) });
  if (status) query.set('status', status);
  try {
    const { response, data } = await callJysia(`/v1/approvals?${query.toString()}`);
    return sendUpstream(res, response, data);
  } catch {
    return res.status(502).json({ error: 'JYSIA est indisponible.' });
  }
});

router.post('/approvals/:id/approve', async (req, res) => {
  if (!safeActionId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  if (!JYSIA_APPROVAL_KEY) return res.status(503).json({ error: 'Clé d’approbation non configurée.' });
  const actor = `${req.cockpitUser.full_name || req.cockpitUser.email} (cockpit)`.slice(0, 200);
  try {
    const { response, data } = await callJysia(`/v1/approvals/${req.params.id}/approve`, {
      method: 'POST', body: { actor }, approval: true,
    });
    return sendUpstream(res, response, data);
  } catch {
    return res.status(502).json({ error: 'JYSIA est indisponible.' });
  }
});

router.post('/approvals/:id/reject', async (req, res) => {
  if (!safeActionId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  if (!JYSIA_APPROVAL_KEY) return res.status(503).json({ error: 'Clé d’approbation non configurée.' });
  const actor = `${req.cockpitUser.full_name || req.cockpitUser.email} (cockpit)`.slice(0, 200);
  const reason = String(req.body?.reason || '').slice(0, 1000) || null;
  try {
    const { response, data } = await callJysia(`/v1/approvals/${req.params.id}/reject`, {
      method: 'POST', body: { actor, reason }, approval: true,
    });
    return sendUpstream(res, response, data);
  } catch {
    return res.status(502).json({ error: 'JYSIA est indisponible.' });
  }
});

router.post('/approvals/:id/execute', async (req, res) => {
  if (!safeActionId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
  if (!JYSIA_APPROVAL_KEY) return res.status(503).json({ error: 'Clé d’approbation non configurée.' });
  try {
    const { response, data } = await callJysia(`/v1/approvals/${req.params.id}/execute`, {
      method: 'POST', approval: true,
    });
    return sendUpstream(res, response, data);
  } catch {
    return res.status(502).json({ error: 'JYSIA est indisponible.' });
  }
});

module.exports = router;
