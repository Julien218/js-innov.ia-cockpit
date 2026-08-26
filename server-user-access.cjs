const express = require('express');
const { ensureClientInvitation } = require('./server-client-onboarding.cjs');
const { applyRolePolicy, normalizeStoredRole } = require('./server-role-policy.cjs');

const router = express.Router();
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const ASSIGNABLE_ROLES = new Set(['client', 'collaborateur', 'admin', 'superadmin']);

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

router.get('/', async (_req, res) => {
  try {
    const rows = await authDb('cockpit_users?select=id,email,full_name,role,organisation,is_active&order=full_name.asc,email.asc&limit=500');
    res.json({ users: (rows || []).map(applyRolePolicy) });
  } catch (error) { res.status(503).json({ error: error.message }); }
});

router.post('/invite', async (req, res) => {
  try {
    const role = normalizeStoredRole(req.body?.role);
    if (!ASSIGNABLE_ROLES.has(role) || role === 'superadmin') return res.status(400).json({ error: 'Rôle d’invitation invalide' });
    const result = await ensureClientInvitation({ email: req.body?.email, fullName: req.body?.fullName, organisation: req.body?.organisation, role });
    res.status(result.invited ? 201 : 200).json({ success: true, role, ...result });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const role = normalizeStoredRole(req.body?.role);
    if (!ASSIGNABLE_ROLES.has(role)) return res.status(400).json({ error: 'Rôle invalide' });
    const rows = await authDb(`cockpit_users?select=id,email,role,is_active&id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    const target = rows?.[0];
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (target.id === req.user.id && role !== 'superadmin') return res.status(409).json({ error: 'Vous ne pouvez pas retirer votre propre accès Super administrateur' });
    const updated = await authDb(`cockpit_users?id=eq.${encodeURIComponent(target.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ role, updated_at: new Date().toISOString() }) });
    console.info('[user-access] role changed', { actor: req.user.email, target: target.email, role });
    res.json({ user: applyRolePolicy(updated?.[0] || { ...target, role }) });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

module.exports = router;
module.exports.ASSIGNABLE_ROLES = ASSIGNABLE_ROLES;
