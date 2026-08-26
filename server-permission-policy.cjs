const catalog = require('./permission-catalog.json');

const ALL_PERMISSION_CODES = Object.freeze(catalog.map(item => item.code));
const CATALOG_BY_CODE = new Map(catalog.map(item => [item.code, item]));
const DEFAULT_BY_ROLE = Object.freeze({
  superadmin: ALL_PERMISSION_CODES,
  admin: ['dashboard'],
  collaborateur: ['dashboard'],
  client: ['dashboard', 'hainoflow', 'projects', 'quotes', 'invoices', 'nova'],
});

function roleAllowsPermission(role, code) {
  if (role === 'superadmin') return CATALOG_BY_CODE.has(code);
  return Boolean(CATALOG_BY_CODE.get(code)?.roles?.includes(role));
}

function effectivePermissions(user, overrides = user?.permission_overrides || []) {
  if (!user) return [];
  if (user.role === 'superadmin') return [...ALL_PERMISSION_CODES];
  const enabled = new Set(DEFAULT_BY_ROLE[user.role] || []);
  for (const row of overrides || []) {
    if (!row || !CATALOG_BY_CODE.has(row.permission_code)) continue;
    if (row.enabled && roleAllowsPermission(user.role, row.permission_code)) enabled.add(row.permission_code);
    else enabled.delete(row.permission_code);
  }
  return [...enabled].filter(code => roleAllowsPermission(user.role, code));
}

function hasPermission(user, code) {
  return user?.role === 'superadmin' || effectivePermissions(user).includes(code);
}

function sanitizePermissionUpdates(role, permissions) {
  const requested = new Set(Array.isArray(permissions) ? permissions.map(String) : []);
  return ALL_PERMISSION_CODES
    .filter(code => role !== 'superadmin' && roleAllowsPermission(role, code))
    .map(permission_code => ({ permission_code, enabled: permission_code === 'dashboard' || requested.has(permission_code) }));
}

module.exports = {
  catalog,
  ALL_PERMISSION_CODES,
  DEFAULT_BY_ROLE,
  roleAllowsPermission,
  effectivePermissions,
  hasPermission,
  sanitizePermissionUpdates,
};
