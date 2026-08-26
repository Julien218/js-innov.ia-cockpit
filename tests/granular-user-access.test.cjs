const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const {
  ALL_PERMISSION_CODES,
  effectivePermissions,
  roleAllowsPermission,
  sanitizePermissionUpdates,
} = require('../server-permission-policy.cjs');

test('superadmin keeps every module while administrators start with a safe minimum', () => {
  assert.deepEqual(effectivePermissions({ role: 'superadmin' }).sort(), [...ALL_PERMISSION_CODES].sort());
  assert.deepEqual(effectivePermissions({ role: 'admin' }), ['dashboard']);
  assert.deepEqual(effectivePermissions({ role: 'collaborateur' }), ['dashboard']);
});

test('per-user overrides can grant and revoke modules without exceeding the role ceiling', () => {
  const admin = { role: 'admin' };
  assert.deepEqual(effectivePermissions(admin, [
    { permission_code: 'dashboard', enabled: false },
    { permission_code: 'signage', enabled: true },
    { permission_code: 'user_access', enabled: true },
  ]), ['signage']);
  assert.equal(roleAllowsPermission('admin', 'user_access'), false);
  assert.equal(roleAllowsPermission('collaborateur', 'invoices'), false);
});

test('permission updates persist an explicit checkbox state for every module allowed by the role', () => {
  const rows = sanitizePermissionUpdates('admin', ['signage', 'production']);
  assert.equal(rows.find(row => row.permission_code === 'dashboard')?.enabled, true);
  assert.equal(rows.find(row => row.permission_code === 'signage')?.enabled, true);
  assert.equal(rows.find(row => row.permission_code === 'production')?.enabled, true);
  assert.equal(rows.find(row => row.permission_code === 'emails')?.enabled, false);
  assert.equal(rows.some(row => row.permission_code === 'user_access'), false);
});

test('frontend and API routes both use the same granular permission policy', () => {
  const server = read('server.cjs');
  const security = read('server-security.cjs');
  const frontend = read('src/components/ProtectedRoute.jsx');
  const access = read('src/pages/Invitations.jsx');
  assert.match(security, /function requirePermission/);
  for (const code of ['emails', 'documents', 'clients', 'ai_cost_control', 'domains', 'signage', 'production', 'tasks', 'nova']) {
    assert.match(server, new RegExp("requirePermission\\('" + code + "'"));
  }
  assert.match(frontend, /user\?\.permissions/);
  assert.match(access, /Enregistrer les accès/);
  assert.match(access, /Le rôle fixe un plafond/);
});

test('permission storage is server-only with RLS and explicit service-role grants', () => {
  const migration = read('supabase/migrations/20260826113000_cockpit_user_permissions.sql');
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all.*anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete.*service_role/);
});

test('the production image embeds the permission runtime and shared catalog', () => {
  const dockerfile = read('Dockerfile');
  for (const file of ['server-permission-policy.cjs', 'permission-catalog.json']) {
    const escaped = file.replace('.', '\\.');
    assert.match(dockerfile, new RegExp('COPY --from=builder /app/' + escaped));
    assert.match(dockerfile, new RegExp('test -f /app/' + escaped));
  }
});
