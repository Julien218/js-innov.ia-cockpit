const express = require('express');
const { ensureClientInvitation } = require('./server-client-onboarding.cjs');
const { applyRolePolicy, normalizeStoredRole } = require('./server-role-policy.cjs');
const { catalog, effectivePermissions, sanitizePermissionUpdates } = require('./server-permission-policy.cjs');

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

async function permissionRowsForUsers(userIds) {
  if (!userIds.length) return [];
  return authDb(`cockpit_user_permissions?select=user_id,permission_code,enabled&user_id=in.(${userIds.map(encodeURIComponent).join(',')})`);
}

async function savePermissions({ userId, role, permissions, actorId }) {
  const rows = sanitizePermissionUpdates(role, permissions).map(row => ({
    user_id: userId,
    ...row,
    updated_at: new Date().toISOString(),
    updated_by: actorId,
  }));
  if (!rows.length) return [];
  await authDb('cockpit_user_permissions?on_conflict=user_id,permission_code', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  return rows;
}

router.get('/', async (_req, res) => {
  try {
    const rows = await authDb('cockpit_users?select=id,email,full_name,role,organisation,is_active&order=full_name.asc,email.asc&limit=500');
    const users = (rows || []).map(applyRolePolicy);
    const overrides = await permissionRowsForUsers(users.map(user => user.id));
    res.json({
      catalog,
      users: users.map(user => ({
        ...user,
        permissions: effectivePermissions(user, overrides.filter(row => row.user_id === user.id)),
      })),
    });
  } catch (error) { res.status(503).json({ error: error.message }); }
});

router.post('/invite', async (req, res) => {
  try {
    const role = normalizeStoredRole(req.body?.role);
    if (!ASSIGNABLE_ROLES.has(role) || role === 'superadmin') return res.status(400).json({ error: 'Rôle d’invitation invalide' });
    const result = await ensureClientInvitation({ email: req.body?.email, fullName: req.body?.fullName, organisation: req.body?.organisation, role });
    if (result.userId) await savePermissions({ userId: result.userId, role, permissions: req.body?.permissions, actorId: req.user.id });
    res.status(result.invited ? 201 : 200).json({ success: true, role, ...result });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

router.patch('/:id/permissions', async (req, res) => {
  try {
    const rows = await authDb(`cockpit_users?select=id,email,role,is_active&id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
    const target = applyRolePolicy(rows?.[0]);
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (target.role === 'superadmin') return res.status(409).json({ error: 'Le Super administrateur conserve tous les accès' });
    const saved = await savePermissions({ userId: target.id, role: target.role, permissions: req.body?.permissions, actorId: req.user.id });
    const permission_overrides = saved.map(({ permission_code, enabled }) => ({ permission_code, enabled }));
    console.info('[user-access] permissions changed', { actor: req.user.email, target: target.email, enabled: req.body?.permissions || [] });
    res.json({ success: true, permissions: effectivePermissions(target, permission_overrides) });
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
