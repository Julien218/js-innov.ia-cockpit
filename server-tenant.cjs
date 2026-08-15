function cleanTenant(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 80);
}

function resolveTenant(req) {
  const ownTenant = cleanTenant(req.user?.organisation) || 'jsinnovia';
  const requested = cleanTenant(req.headers['x-managed-organisation']);
  if (requested && req.user?.role !== 'superadmin') {
    const error = new Error('Seul le superadministrateur peut changer d’organisation gérée.');
    error.status = 403;
    throw error;
  }
  return requested || ownTenant;
}

module.exports = { cleanTenant, resolveTenant };

