const express = require('express');
const cookie = require('cookie');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || '';
const AGENT_URL = process.env.JSINNOVIA_AGENT_URL
  || process.env.VITE_AGENT_URL
  || '';
const AGENT_KEY = process.env.AGENT_API_KEY || process.env.JSINNOVIA_AGENT_KEY || '';
const COCKPIT_URL = process.env.COCKPIT_URL || 'https://cockpit.jsinnovia.com';
const OLIVIER_EMAIL = 'olivier.trevis@pv.be';
const SUPERADMIN_ROLES = new Set(['superadmin', 'super_admin']);
const UPSTREAM_TIMEOUT_MS = Number(process.env.INSURANCE_PROXY_TIMEOUT_MS || 15000);

function parseSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return '';
  return cookie.parse(header).session || '';
}

function validOrigin(req) {
  const origin = req.headers.origin || '';
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return url.origin === COCKPIT_URL
      || url.origin === 'http://localhost:5173'
      || url.origin === 'http://localhost:3000';
  } catch {
    return false;
  }
}

async function supabaseRows(path) {
  if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SERVICE_KEY manquante');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}`);
  const body = await response.text();
  return body ? JSON.parse(body) : [];
}

async function requireInsuranceAccess(req, res, next) {
  if (!validOrigin(req)) return res.status(403).json({ error: 'Origine non autorisée.' });

  const token = parseSessionToken(req);
  if (!token) return res.status(401).json({ error: 'Session requise.' });

  try {
    const sessions = await supabaseRows(
      `cockpit_sessions?select=user_id,expires_at&token=eq.${encodeURIComponent(token)}&limit=1`,
    );
    const session = sessions[0];
    if (!session || new Date(session.expires_at) <= new Date()) {
      return res.status(401).json({ error: 'Session invalide ou expirée.' });
    }

    const users = await supabaseRows(
      `cockpit_users?select=id,email,role,is_active&id=eq.${encodeURIComponent(session.user_id)}&is_active=eq.true&limit=1`,
    );
    const user = users[0];
    const email = String(user?.email || '').toLowerCase();
    const role = String(user?.role || '').toLowerCase();
    const allowed = SUPERADMIN_ROLES.has(role) || email === OLIVIER_EMAIL;
    if (!allowed) return res.status(403).json({ error: 'Accès assurances non autorisé.' });

    req.insuranceUser = { id: user.id, email, role };
    return next();
  } catch (error) {
    console.error('[insurance proxy] session validation failed:', error.message);
    return res.status(503).json({ error: 'Vérification de session indisponible.' });
  }
}

router.use(requireInsuranceAccess);

router.use(async (req, res) => {
  if (!AGENT_URL) return res.status(503).json({ error: 'URL du backend assurances manquante.' });
  if (!AGENT_KEY) return res.status(503).json({ error: 'Clé backend assurances manquante.' });

  const allowedMethod = ['GET', 'PATCH', 'POST'].includes(req.method);
  if (!allowedMethod) return res.status(405).json({ error: 'Méthode non autorisée.' });

  const target = `${AGENT_URL.replace(/\/$/, '')}/insurance${req.url}`;
  const options = {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'x-agent-key': AGENT_KEY,
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  };
  if (['PATCH', 'POST'].includes(req.method)) options.body = JSON.stringify(req.body || {});

  try {
    const response = await fetch(target, options);
    const text = await response.text();
    res.status(response.status);
    res.set('Content-Type', response.headers.get('content-type') || 'application/json');
    return text ? res.send(text) : res.end();
  } catch (error) {
    console.error('[insurance proxy] upstream unavailable:', error.message);
    return res.status(502).json({ error: 'Service assurances indisponible.' });
  }
});

module.exports = router;
