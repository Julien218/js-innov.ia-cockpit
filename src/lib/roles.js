// â”€â”€â”€ CONFIGURATION DES RÃ”LES JS-INNOV.IA COCKPIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const ROLES = {
  SUPERADMIN: "superadmin",
  ADMIN: "admin",
  COLLABORATEUR: "collaborateur",
  CLIENT: "client",
};

// HiÃ©rarchie des rÃ´les (plus le niveau est Ã©levÃ©, plus on a de droits)
export const ROLE_LEVEL = {
  superadmin: 4,
  admin: 3,
  collaborateur: 2,
  client: 1,
};

// Labels affichÃ©s dans l'interface
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

// Routes accessibles par rÃ´le
export const ROLE_ROUTES = {
  superadmin: [
    "/", "/clients", "/leads", "/projets", "/taches", "/demandes",
    "/services", "/devis", "/factures", "/commissions",
    "/validations", "/logs", "/agent", "/agents-ia", "/local-ai", "/invitations"
  ],
  admin: [
    "/", "/clients", "/leads", "/projets", "/taches", "/demandes",
    "/services", "/devis", "/factures", "/commissions",
    "/validations", "/agent", "/agents-ia", "/local-ai", "/invitations"
  ],
  collaborateur: [
    "/", "/projets", "/taches", "/demandes", "/agents-ia"
  ],
  client: [
    "/", "/mes-projets", "/mes-devis", "/mes-factures", "/demandes", "/agents-ia"
  ],
};

// VÃ©rifier si un rÃ´le a accÃ¨s Ã  une route
export const hasRouteAccess = (role, path) => {
  const routes = ROLE_ROUTES[role] || [];
  return routes.includes(path);
};

// VÃ©rifier si un rÃ´le a au moins le niveau d'un autre rÃ´le
export const hasMinRole = (userRole, requiredRole) => {
  return (ROLE_LEVEL[userRole] || 0) >= (ROLE_LEVEL[requiredRole] || 0);
};

