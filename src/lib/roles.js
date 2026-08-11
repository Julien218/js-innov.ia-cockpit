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
  collaborateur: "Collaborateur",
  client: "Client",
};

export const ROLE_COLORS = {
  superadmin: { bg: "#1a0a2e", text: "#a855f7", badge: "#a855f7" },
  admin:      { bg: "#001a3d", text: "#D4AF37", badge: "#D4AF37" },
  collaborateur: { bg: "#001a14", text: "#10b981", badge: "#10b981" },
  client:     { bg: "#1a0d00", text: "#f97316", badge: "#f97316" },
};

export const ROLE_ROUTES = {
  superadmin: [
    "/", "/assurances", "/documents", "/clients", "/leads", "/demandes", "/projets", "/taches",
    "/devis", "/factures", "/emails", "/emails-core", "/cost-centers", "/ai-cost",
    "/production", "/portfolio", "/apps-agents",
    "/automations", "/domaines", "/rangement", "/parametres",
    "/services", "/validations", "/agent", "/agents-ia", "/ai-cost-control", "/invitations"
  ],
  admin: [
    "/", "/documents", "/clients", "/leads", "/demandes", "/projets", "/taches",
    "/devis", "/factures", "/emails", "/emails-core", "/cost-centers", "/ai-cost",
    "/production", "/portfolio", "/apps-agents",
    "/automations", "/domaines", "/rangement", "/parametres",
    "/services", "/validations", "/agent", "/agents-ia", "/ai-cost-control", "/invitations"
  ],
  collaborateur: [
    "/", "/documents", "/projets", "/taches", "/demandes", "/agent", "/agents-ia"
  ],
  client: [
    "/", "/mes-projets", "/mes-devis", "/mes-factures", "/demandes", "/agents-ia"
  ],
};

export const hasRouteAccess = (role, path) => {
  const routes = ROLE_ROUTES[role] || [];
  return routes.includes(path);
};

export const hasMinRole = (userRole, requiredRole) => {
  return (ROLE_LEVEL[userRole] || 0) >= (ROLE_LEVEL[requiredRole] || 0);
};
