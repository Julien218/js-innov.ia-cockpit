// ============================================================
// server-auth.cjs — Authentification backend (Variante A)
//
// Endpoints:
//   POST /api/auth/login    — login public (email + password)
//   GET  /api/auth/session  — validation de session (cookie)
//   POST /api/auth/logout   — déconnexion (cookie)
//
// Sécurité:
//   - password_hash jamais retourné au frontend
//   - service_role jamais exposée
//   - token opaque stocké en clair dans cockpit_sessions.token (Variante A)
//   - cookie HttpOnly + Secure + SameSite=Lax
//   - rate limiting par IP (Map en mémoire)
//   - messages d'erreur génériques (ne révèle pas si l'email existe)
//   - journalisation sans données sensibles
// ============================================================

const express = require('express');
const crypto = require('crypto');
const { applyRolePolicy } = require('./server-role-policy.cjs');
const cookie = require('cookie');

const router = express.Router();

// ─── Configuration ────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://rzvvwcwyaddzsaattwqt.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_KEY) {
  console.error('[auth] SUPABASE_SERVICE_ROLE_KEY manquant — auth backend non fonctionnel');
}

// Domaine attendu pour validation d'origine (configurable)
const COCKPIT_URL = process.env.COCKPIT_URL || 'https://cockpit.jsinnovia.com';

// Durée de session: 30 jours
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // ms
const SESSION_COOKIE_MAX_AGE = 2592000; // secondes (30 jours)

// Salt historique (compatibilité SHA-256 — ne pas changer)
const LEGACY_SALT = 'jsinnovia_salt_2026';

// Rate limiting (Map en mémoire — reset au redémarrage)
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 min
const RATE_LIMIT_MAX = 5; // 5 tentatives par fenêtre
const rateLimitMap = new Map();

function getClientIP(req) {
  return req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || (now - entry.firstAttempt) > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true, retryAfter: 0 };
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.firstAttempt + RATE_LIMIT_WINDOW - now) / 1000);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }

  return { allowed: true, retryAfter: 0 };
}

function clearRateLimit(ip) {
  rateLimitMap.delete(ip);
}

// ─── Helpers Supabase (service_role) ──────────────────────────────────────────
// Returns an array (default) or null on 406 (0 rows with pgrst.object)
async function supabaseSelect(path) {
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error('Service role key not configured');
  }

  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase error ${res.status}`);
  }

  if (res.status === 204 || !body) return [];
  return JSON.parse(body); // Always returns an array
}

async function supabaseInsert(path, data) {
  if (!SUPABASE_SERVICE_KEY) throw new Error('Service role key not configured');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase insert error ${res.status}`);
  }
  return null;
}

async function supabaseUpdate(path, data) {
  if (!SUPABASE_SERVICE_KEY) throw new Error('Service role key not configured');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    throw new Error(`Supabase update error ${res.status}`);
  }
  return null;
}

async function supabaseDelete(path) {
  if (!SUPABASE_SERVICE_KEY) throw new Error('Service role key not configured');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Prefer': 'return=minimal',
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase delete error ${res.status}`);
  }
  return null;
}

// ─── Hash compat (SHA-256 + salt statique) ───────────────────────────────────
function sha256Legacy(password) {
  return crypto
    .createHash('sha256')
    .update(password + LEGACY_SALT)
    .digest('hex');
}

function safeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function inviteTokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────
function setSessionCookie(res, token) {
  // Manual Set-Cookie to always include Secure (production = always HTTPS via Railway)
  const cookieStr = cookie.serialize('session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
  res.setHeader('Set-Cookie', cookieStr);
}

function clearSessionCookie(res) {
  const cookieStr = cookie.serialize('session', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  res.setHeader('Set-Cookie', cookieStr);
}

function getSessionToken(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const parsed = cookie.parse(cookieHeader);
  return parsed.session || null;
}

// ─── Validation origine ──────────────────────────────────────────────────────
function validateOrigin(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  // En dev (localhost), autoriser
  if (!COCKPIT_URL) return true;

  if (!origin) return true; // Same-origin, pas d'Origin header → OK
  try {
    const url = new URL(origin);
    return url.origin === COCKPIT_URL || url.origin === 'http://localhost:5173' || url.origin === 'http://localhost:3000';
  } catch {
    return false;
  }
}

// ─── Body size limit ─────────────────────────────────────────────────────────
router.use(express.json({ limit: '2kb' }));

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login — PUBLIC (pas de x-agent-key requis)
// ══════════════════════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  const ip = getClientIP(req);

  // Rate limiting
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return res.status(429).set('Retry-After', String(rateCheck.retryAfter)).json({
      error: 'Trop de tentatives. Réessayez dans quelques minutes.',
    });
  }

  // Validation origine
  if (!validateOrigin(req)) {
    return res.status(403).json({ error: 'Origine non autorisée.' });
  }

  const { email, password } = req.body || {};

  // Validation basique
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  if (password.length > 128) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }

  // Email format basique
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }

  const emailLower = email.toLowerCase().trim();

  try {
    // Recherche utilisateur (service_role) — returns array, NOT single object
    const rows = await supabaseSelect(
      `cockpit_users?select=id,email,full_name,role,avatar_url,organisation,is_active,password_hash&email=eq.${encodeURIComponent(emailLower)}&is_active=eq.true&limit=1`
    );

    if (!rows || rows.length === 0 || !rows[0].password_hash) {
      // Message identique pour user inexistant et mauvais password
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    const user = applyRolePolicy(rows[0]);

    // Vérification du mot de passe (SHA-256 legacy)
    const pwHash = sha256Legacy(password);
    if (!safeCompare(pwHash, user.password_hash)) {
      console.warn(`[auth] login failed ip=${ip}`);
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    // Login réussi — reset rate limit
    clearRateLimit(ip);

    // Générer token opaque (32 bytes → 64 chars hex)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE).toISOString();

    // Créer session en base (service_role)
    await supabaseInsert('cockpit_sessions', {
      user_id: user.id,
      token: token,
      expires_at: expiresAt,
    });

    // Mettre à jour last_login (non bloquant)
    try {
      await supabaseUpdate(`cockpit_users?id=eq.${user.id}`, {
        last_login_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[auth] last_login update failed:', e.message);
    }

    // Poser le cookie HttpOnly
    setSessionCookie(res, token);

    // Réponse — profil public SANS password_hash
    console.log(`[auth] login ok ip=${ip} user=${user.id}`);

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
        organisation: user.organisation,
      },
    });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur. Réessayez.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/auth/session — valider la session via cookie
// ══════════════════════════════════════════════════════════════════════════════
router.get('/invite', async (req, res) => {
  const token = String(req.query?.token || '');
  if (!/^[A-Za-z0-9_-]{40,160}$/.test(token)) return res.status(400).json({ valid: false });
  try {
    const rows = await supabaseSelect(`cockpit_invites?select=user_id,expires_at,used_at&token_hash=eq.${inviteTokenHash(token)}&limit=1`);
    const invite = rows?.[0];
    return res.json({ valid: Boolean(invite && !invite.used_at && new Date(invite.expires_at) > new Date()) });
  } catch (err) {
    console.error('[auth] invite validation error:', err.message);
    return res.status(503).json({ valid: false });
  }
});

router.post('/activate', async (req, res) => {
  if (!validateOrigin(req)) return res.status(403).json({ error: 'Origine non autorisée.' });
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (!/^[A-Za-z0-9_-]{40,160}$/.test(token)) return res.status(400).json({ error: 'Invitation invalide ou expirée.' });
  if (password.length < 12 || password.length > 128) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 12 caractères.' });
  try {
    const rows = await supabaseSelect(`cockpit_invites?select=id,user_id,expires_at,used_at&token_hash=eq.${inviteTokenHash(token)}&limit=1`);
    const invite = rows?.[0];
    if (!invite || invite.used_at || new Date(invite.expires_at) <= new Date()) return res.status(400).json({ error: 'Invitation invalide ou expirée.' });
    const now = new Date().toISOString();
    await supabaseUpdate(`cockpit_users?id=eq.${invite.user_id}`, { password_hash: sha256Legacy(password), is_active: true, updated_at: now });
    await supabaseUpdate(`cockpit_invites?user_id=eq.${invite.user_id}&used_at=is.null`, { used_at: now });
    return res.json({ success: true });
  } catch (err) {
    console.error('[auth] activation error:', err.message);
    return res.status(500).json({ error: 'Activation impossible. Réessayez.' });
  }
});

router.get('/session', async (req, res) => {
  const token = getSessionToken(req);

  if (!token) {
    return res.json({ valid: false });
  }

  try {
    // Vérifier session (service_role) — returns array
    const sessionRows = await supabaseSelect(
      `cockpit_sessions?select=user_id,expires_at&token=eq.${encodeURIComponent(token)}&limit=1`
    );

    if (!sessionRows || sessionRows.length === 0) {
      clearSessionCookie(res);
      return res.json({ valid: false });
    }

    const session = sessionRows[0];

    // Vérifier expiration
    if (new Date(session.expires_at) <= new Date()) {
      // Session expirée — nettoyer
      try {
        await supabaseDelete(`cockpit_sessions?token=eq.${encodeURIComponent(token)}`);
      } catch (e) {}
      clearSessionCookie(res);
      return res.json({ valid: false });
    }

    // Récupérer profil utilisateur (service_role) — returns array
    const userRows = await supabaseSelect(
      `cockpit_users?select=id,email,full_name,role,avatar_url,organisation,is_active&id=eq.${session.user_id}&is_active=eq.true&limit=1`
    );

    if (!userRows || userRows.length === 0) {
      // User désactivé ou supprimé — invalider session
      try {
        await supabaseDelete(`cockpit_sessions?token=eq.${encodeURIComponent(token)}`);
      } catch (e) {}
      clearSessionCookie(res);
      return res.json({ valid: false });
    }

    const user = applyRolePolicy(userRows[0]);

    return res.json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
        organisation: user.organisation,
      },
    });
  } catch (err) {
    console.error('[auth] session error:', err.message);
    return res.status(500).json({ valid: false });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/auth/logout — déconnexion
// ══════════════════════════════════════════════════════════════════════════════
router.post('/logout', async (req, res) => {
  const token = getSessionToken(req);

  if (token) {
    try {
      await supabaseDelete(`cockpit_sessions?token=eq.${encodeURIComponent(token)}`);
    } catch (e) {
      // Non bloquant — on efface le cookie dans tous les cas
    }
  }

  clearSessionCookie(res);
  return res.json({ success: true });
});

module.exports = router;
