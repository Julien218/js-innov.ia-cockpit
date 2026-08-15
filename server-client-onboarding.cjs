const crypto = require('crypto');
const nodemailer = require('nodemailer');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const COCKPIT_URL = String(process.env.COCKPIT_URL || 'https://cockpit.jsinnovia.com').replace(/\/$/, '');

async function authDb(resource, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Auth Supabase non configurée');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    ...options,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Auth Supabase HTTP ${response.status}`);
  return text ? JSON.parse(text) : [];
}

function inviteHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function mailTransport() {
  const user = process.env.EMAIL_STORE_ADDRESS || 'info@jsinnovia.store';
  const pass = process.env.EMAIL_STORE_PASSWORD || '';
  if (!pass) throw new Error('SMTP invitation non configuré');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST_STORE || process.env.SMTP_HOST || 'smtp.ionos.fr',
    port: Number(process.env.SMTP_PORT_STORE || process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
    auth: { user, pass },
    tls: { rejectUnauthorized: process.env.SMTP_ALLOW_INVALID_CERT !== 'true' }
  });
}

async function ensureClientInvitation({ email, fullName, organisation }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Email client invalide');
  let users = await authDb(`cockpit_users?select=id,email,is_active&email=eq.${encodeURIComponent(normalized)}&limit=1`);
  let user = users?.[0];
  if (user?.is_active) return { status: 'active', invited: false };
  if (!user) {
    users = await authDb('cockpit_users', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ email: normalized, full_name: String(fullName || normalized).slice(0, 160), role: 'client', organisation: String(organisation || '').slice(0, 160) || null, is_active: false, password_hash: null }) });
    user = users?.[0];
  }
  if (!user?.id) throw new Error('Compte client non créé');
  const pending = await authDb(`cockpit_invites?select=id,expires_at,used_at&user_id=eq.${encodeURIComponent(user.id)}&used_at=is.null&limit=1`);
  if (pending?.[0] && new Date(pending[0].expires_at).getTime() > Date.now()) return { status: 'pending', invited: false };

  const rawToken = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const invites = await authDb('cockpit_invites', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ user_id: user.id, token_hash: inviteHash(rawToken), expires_at: expiresAt }) });
  const invite = invites?.[0];
  if (!invite?.id) throw new Error('Invitation non créée');
  const activationUrl = `${COCKPIT_URL}/register?token=${encodeURIComponent(rawToken)}`;
  const greetingName = String(fullName || '').trim() || 'et bienvenue';
  try {
    const from = process.env.EMAIL_STORE_ADDRESS || 'info@jsinnovia.store';
    await mailTransport().sendMail({
      from: `JS-Innov.IA <${from}>`,
      to: normalized,
      subject: 'Activez votre cockpit JS-Innov.IA',
      text: `Bonjour ${greetingName},\n\nVotre cockpit client est prêt. Activez votre accès dans les 7 jours :\n${activationUrl}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message.`,
      html: `<p>Bonjour ${escapeHtml(greetingName)},</p><p>Votre cockpit client est prêt.</p><p><a href="${activationUrl}">Activer mon accès</a></p><p>Ce lien est personnel et expire dans 7 jours.</p>`
    });
  } catch (error) {
    await authDb(`cockpit_invites?id=eq.${encodeURIComponent(invite.id)}`, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
  return { status: 'invited', invited: true };
}

module.exports = { ensureClientInvitation };

