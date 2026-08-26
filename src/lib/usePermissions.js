// ─── HOOK DE PERMISSIONS JS-INNOV.IA ─────────────────────────────────────────
import { useAuth } from '@/lib/AuthContext';
import { hasMinRole, hasRouteAccess, ROLE_LEVEL } from '@/lib/roles';

export function usePermissions() {
  const { user } = useAuth();
  const role = user?.role || "client";
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const hasPermission = code => role === 'superadmin' || permissions.includes(code);

  return {
    role,
    isSuperAdmin: role === "superadmin",
    isAdmin: role === "admin" || role === "superadmin",
    isCollaborateur: role === "collaborateur",
    isClient: role === "client",
    permissions,
    hasPermission,
    canAccess: (path) => hasRouteAccess(role, path, permissions),
    hasMinRole: (requiredRole) => hasMinRole(role, requiredRole),
    // Raccourcis utiles
    canManageUsers: role === "superadmin",
    canViewFinance: hasPermission('invoices'),
    canViewLogs: hasPermission('logs'),
    canInvite: role === "superadmin",
    canManageClients: hasPermission('clients'),
  };
}
