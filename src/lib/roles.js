// ─── CONFIGURATION DES RÔLES JS-INNOV.IA COCKPIT ─────────────────────────────

export const ROLES = {
  SUPERADMIN: "superadmin",
  ADMIN: "admin",
  COLLABORATEUR: "collaborateur",
  CLIENT: "client",
};

// Hiérarchie des rôles (plus le niveau est élevé, plus on a de droits)
export const ROLE_LEVEL = {
  superadmin: 4,
  admin: 3,
  collaborateur: 2,
  client: 1,
};

// Labels affichés dans l'interface
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

// Routes accessibles par rôle — PRODUCTION
// Les routes masquées (Commissions, Commercants, Logs, Video, etc.)
// restent dans le code mais ne sont pas dans le menu ni dans ROLE_ROUTES.
// Elles restent accessibles par URL directe (dev preview) mais invisibles dans le menu.
export const ROLE_ROUTES = {
  superadmin: [
    "/", "/clients", "/leads", "/projets", "/taches", "/demandes",
    "/services", "/devis", "/factures",
    "/validations", "/agent", "/agents-ia", "/invitations",
    "/portfolio", "/automations", "/emails", "/parametres"
  ],
  admin: [
    "/", "/clients", "/leads", "/projets", "/taches", "/demandes",
    "/services", "/devis", "/factures",
    "/validations", "/agent", "/agents-ia", "/invitations",
    "/portfolio", "/automations", "/emails", "/parametres"
  ],
  collaborateur: [
    "/", "/projets", "/taches", "/demandes", "/agents-ia"
  ],
  client: [
    "/", "/mes-projets", "/mes-devis", "/mes-factures", "/demandes", "/agents-ia"
  ],
};

// Vérifier si un rôle a accès à une route
export const hasRouteAccess = (role, path) => {
  const routes = ROLE_ROUTES[role] || [];
  return routes.includes(path);
};

// Vérifier si un rôle a au moins le niveau d'un autre rôle
export const hasMinRole = (userRole, requiredRole) => {
  return (ROLE_LEVEL[userRole] || 0) >= (ROLE_LEVEL[requiredRole] || 0);
};
