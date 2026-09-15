const cookie = require('cookie');
const { ROLE_LEVEL, applyRolePolicy } = require('./server-role-policy.cjs');
const { effectivePermissions, hasPermission } = require('./server-permission-policy.cjs');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Elynea publique est consommée par plusieurs sites JS-Innov.IA. On autorise
// uniquement leurs origines explicites : jamais de CORS global ni de wildcard.
const DEFAULT_ELYNEA_PUBLIC_ORIGINS = Object.freeze([
  'https://cockpit.jsinnovia.com',
  'https://jsinnovia.com',
  'https://www.jsinnovia.com',
  'https://missetmisterdour.be',
  'https://www.missetmisterdour.be',
  'https://miss-mister-dour.be',
  'https://www.miss-mister-dour.be',
  'https://miss-mister-dour-web-production.up.railway.app',
  'https://fashionistartdour.be',
  'https://www.fashionistartdour.be',
  'https://signelya.jsinnovia.com',
  'https://app.signelya.jsinnovia.com',
  'https://signage.jsinnovia.com',
  'http://localhost:5173',
  'http://localhost:3000',
]);

function elyneaPublicOrigins() {
  const configured = String(process.env.ELYNEA_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ELYNEA_PUBLIC_ORIGINS, ...configured]);
}

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
  const user = applyRolePolicy(users[0] || null);
  if (!user) return null;
  const permission_overrides = await select(`cockpit_user_permissions?select=permission_code,enabled&user_id=eq.${encodeURIComponent(user.id)}`);
  return { ...user, permission_overrides, permissions: effectivePermissions(user, permission_overrides) };
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

function requirePermission(permissionCode, minRole = 'client') {
  return async (req, res, next) => {
    const sessionGuard = requireSession(minRole);
    return sessionGuard(req, res, () => {
      if (!hasPermission(req.user, permissionCode)) {
        return res.status(403).json({ error: 'Accès à ce module non autorisé' });
      }
      next();
    });
  };
}

function requireSameOrigin(req, res, next) {
  const pathname = String(req.originalUrl || req.url || '');

  // Le chat public doit pouvoir être appelé depuis les sites gérés, mais cette
  // exception reste confinée au namespace public Elynea et à une allowlist.
  if (pathname.startsWith('/api/public/elynea')) {
    const origin = String(req.headers.origin || '').trim();
    if (!origin) return next(); // appels serveur-à-serveur / probes internes
    if (!elyneaPublicOrigins().has(origin)) {
      return res.status(403).json({ error: 'Origine Elynea non autorisée' });
    }

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Elynea-Site-Key');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  }

  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const expected = process.env.COCKPIT_URL || 'https://cockpit.jsinnovia.com';
  if ([expected, 'http://localhost:5173', 'http://localhost:3000'].includes(origin)) return next();
  return res.status(403).json({ error: 'Origine non autorisée' });
}

module.exports = {
  requireSession,
  requirePermission,
  requireSameOrigin,
  resolveSession,
  ROLE_LEVEL,
  elyneaPublicOrigins,
};
