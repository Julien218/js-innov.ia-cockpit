import permissionCatalog from '../../permission-catalog.json' with { type: 'json' };

// ─── CONFIGURATION DES RÔLES JS-INNOV.IA COCKPIT ─────────────────────────────

export const ROLES = {
  SUPERADMIN: "superadmin",
  ADMIN: "admin",
  COLLABORATEUR: "collaborateur",
  CLIENT: "client",
};

export const ROLE_LEVEL = {
  superadmin: 4,
  admin: 3,
  collaborateur: 2,
  client: 1,
};

export const ROLE_LABELS = {
  superadmin: "Super Admin",
  admin: "Admin",
  collaborateur: "Commercial",
  client: "Client",
};

export const ROLE_COLORS = {
  superadmin: { bg: "#1a0a2e", text: "#a855f7", badge: "#a855f7" },
  admin:      { bg: "#001a3d", text: "#D4AF37", badge: "#D4AF37" },
  collaborateur: { bg: "#001a14", text: "#10b981", badge: "#10b981" },
  client:     { bg: "#1a0d00", text: "#f97316", badge: "#f97316" },
};

const OWNER_ROUTES = [
  "/", "/hainoflow", "/assurances", "/documents", "/clients", "/leads", "/demandes", "/projets", "/donnees-projets", "/taches",
  "/devis", "/factures", "/emails", "/emails-core", "/cost-centers", "/ai-cost", "/villeconnect",
  "/production", "/ecran-geant", "/pilotyasign", "/avatar-factory", "/portfolio", "/apps-agents", "/automations", "/domaines", "/rangement", "/parametres",
  "/services", "/validations", "/agent", "/agents-ia", "/mobile-hub", "/ai-cost-control", "/invitations", "/gouvernance", "/confidentialite",
  // Studio / production média
  "/video-studio", "/video-studio/*", "/ai-video", "/thumbnail", "/dour-campaign",
  "/exports", "/exported-videos", "/templates", "/calendar",
];

export const ROLE_ROUTES = {
  superadmin: OWNER_ROUTES,
  admin: OWNER_ROUTES.filter(route => route !== "/assurances"),
  collaborateur: [
    "/", "/hainoflow", "/ecran-geant", "/pilotyasign", "/clients", "/leads", "/documents", "/projets", "/donnees-projets", "/taches", "/demandes", "/devis", "/agent", "/agents-ia"
  ],
  // Le client ne reçoit que les vues tenant-scopées et les modules produit autorisés.
  // Aucun accès aux agents internes, demandes globales, outils de production ou routes owner.
  client: [
    "/", "/hainoflow", "/ecran-geant", "/mes-projets", "/donnees-projets", "/mes-devis", "/mes-factures", "/confidentialite"
  ],
};

export const PERMISSION_CATALOG = permissionCatalog;

const routeMatches = (route, path) => {
  if (route === path) return true;
  if (!route.endsWith("/*")) return false;
  const prefix = route.slice(0, -2);
  return path.startsWith(`${prefix}/`);
};

export const permissionForPath = path => permissionCatalog.find(permission =>
  permission.routes.some(route => routeMatches(route, path))
);

export const hasRouteAccess = (role, path, permissions) => {
  const modulePermission = permissionForPath(path);
  if (!modulePermission) return false;
  if (role === 'superadmin') return true;
  if (Array.isArray(permissions)) {
    return modulePermission.roles.includes(role) && permissions.includes(modulePermission.code);
  }
  const routes = ROLE_ROUTES[role] || [];
  return routes.some(route => routeMatches(route, path));
};

export const hasMinRole = (userRole, requiredRole) => {
  return (ROLE_LEVEL[userRole] || 0) >= (ROLE_LEVEL[requiredRole] || 0);
};
