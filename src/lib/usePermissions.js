// ─── HOOK DE PERMISSIONS JS-INNOV.IA ─────────────────────────────────────────
import { useAuth } from '@/lib/AuthContext';
import { hasMinRole, hasRouteAccess, ROLE_LEVEL } from '@/lib/roles';

export function usePermissions() {
  const { user } = useAuth();
  const role = user?.role || "client";

  return {
    role,
    isSuperAdmin: role === "superadmin",
    isAdmin: role === "admin" || role === "superadmin",
    isCollaborateur: role === "collaborateur",
    isClient: role === "client",
    canAccess: (path) => hasRouteAccess(role, path),
    hasMinRole: (requiredRole) => hasMinRole(role, requiredRole),
    // Raccourcis utiles
    canManageUsers: hasMinRole(role, "admin"),
    canViewFinance: hasMinRole(role, "admin"),
    canViewLogs: role === "superadmin",
    canInvite: hasMinRole(role, "admin"),
    canManageClients: hasMinRole(role, "collaborateur"),
  };
}
