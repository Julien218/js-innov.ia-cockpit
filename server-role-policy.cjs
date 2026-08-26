const ROLE_LEVEL = { client: 1, collaborateur: 2, admin: 3, superadmin: 4 };

const splitEmails = value => new Set(String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
const superAdmins = splitEmails(process.env.COCKPIT_SUPERADMIN_EMAILS || 'julien.pagin.pv@gmail.com');
const administrators = splitEmails(process.env.COCKPIT_ADMIN_EMAILS || 'olivier.trevis@outlook.be');
const commercials = splitEmails(process.env.COCKPIT_COMMERCIAL_EMAILS || '');

function normalizeStoredRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'commercial') return 'collaborateur';
  return ROLE_LEVEL[normalized] ? normalized : 'client';
}

function applyRolePolicy(user) {
  if (!user) return user;
  const email = String(user.email || '').trim().toLowerCase();
  const storedRole = normalizeStoredRole(user.role);
  let enforcedRole = storedRole;
  if (superAdmins.has(email)) enforcedRole = 'superadmin';
  else if (administrators.has(email) && ROLE_LEVEL[storedRole] < ROLE_LEVEL.admin) enforcedRole = 'admin';
  else if (commercials.has(email) && ROLE_LEVEL[storedRole] < ROLE_LEVEL.collaborateur) enforcedRole = 'collaborateur';
  return { ...user, role: enforcedRole };
}

module.exports = { ROLE_LEVEL, applyRolePolicy, normalizeStoredRole };
