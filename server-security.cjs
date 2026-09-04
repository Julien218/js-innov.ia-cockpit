const cookie = require('cookie');
const { ROLE_LEVEL, applyRolePolicy } = require('./server-role-policy.cjs');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function select(path) {
  if (!SUPABASE_SECRET) throw new Error('Supabase server secret not configured');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SECRET, Authorization: `Bearer ${SUPABASE_SECRET}` }
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json();
}

async function resolveSession(req) {
  const token = cookie.parse(req.headers.cookie || '').session;
  if (!token) return null;
  const sessions = await select(`cockpit_sessions?select=user_id,expires_at&token=eq.${encodeURIComponent(token)}&limit=1`);
  const session = sessions[0];
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  const users = await select(`cockpit_users?select=id,email,full_name,role,organisation,is_active&id=eq.${encodeURIComponent(session.user_id)}&is_active=eq.true&limit=1`);
  return applyRolePolicy(users[0] || null);
}

function requireSession(minRole = 'client') {
  return async (req, res, next) => {
    try {
      const user = req.user || await resolveSession(req);
      if (!user) return res.status(401).json({ error: 'Session requise' });
      if ((ROLE_LEVEL[user.role] || 0) < (ROLE_LEVEL[minRole] || 0)) {
        return res.status(403).json({ error: 'Droits insuffisants' });
      }
      req.user = user;
      res.setHeader('Cache-Control', 'no-store');
      next();
    } catch (error) {
      console.error('[security] session validation failed:', error.message);
      res.status(503).json({ error: 'Validation de session indisponible' });
    }
  };
}

function normalizeOrigin(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try {
    return new URL(candidate).origin.toLowerCase();
  } catch {
    return '';
  }
}

function splitConfiguredOrigins(value) {
  return String(value || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
}

function getRequestOrigins(req) {
  const host = String(req.headers.host || req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim();
  if (!host) return [];

  const forwardedProtocol = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const protocols = new Set([
    forwardedProtocol,
    String(req.protocol || '').trim(),
    'https',
  ].filter(Boolean));

  return [...protocols]
    .map(protocol => normalizeOrigin(`${protocol}://${host}`))
    .filter(Boolean);
}

function requireSameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

  const rawOrigin = req.headers.origin;
  if (!rawOrigin) return next();

  const origin = normalizeOrigin(rawOrigin);
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN
    ? normalizeOrigin(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
    : '';

  const allowedOrigins = new Set([
    normalizeOrigin(process.env.COCKPIT_URL || 'https://cockpit.jsinnovia.com'),
    normalizeOrigin(process.env.SIGNELYA_APP_URL),
    normalizeOrigin(process.env.PUBLIC_BASE_URL),
    railwayDomain,
    ...getRequestOrigins(req),
    ...splitConfiguredOrigins(process.env.COCKPIT_ALLOWED_ORIGINS),
    'http://localhost:5173',
    'http://localhost:3000',
  ].filter(Boolean));

  if (origin && allowedOrigins.has(origin)) return next();

  console.warn(
    `[security] blocked origin=${rawOrigin} host=${req.headers.host || '-'} method=${req.method} path=${req.originalUrl || req.url}`
  );
  return res.status(403).json({ error: 'Origine non autorisée' });
}

module.exports = { requireSession, requireSameOrigin, ROLE_LEVEL };
