function cleanTenant(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

  // Identifiant canonique unique pour la société, quelle que soit la façon
  // dont son nom est écrit dans le profil utilisateur ou dans les anciennes données.
  if (['jsinnovia', 'js-innovia', 'js-innov-ia'].includes(normalized)) return 'jsinnovia';
  return normalized;
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
