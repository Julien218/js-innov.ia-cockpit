import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { hasRouteAccess } from '@/lib/roles';
import { useCommerceEntitlements } from '@/lib/useCommerceEntitlements';

const CLIENT_ROUTE_MODULES = {
  '/ecran-geant': 'digital_signage',
  '/videosurveillance': 'videosurveillance',
  '/agents-ia': 'ai_agents',
};

const Spinner = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a14]">
    <div className="w-8 h-8 border-4 border-[#D4AF37]/20 border-t-[#D4AF37] rounded-full animate-spin"></div>
  </div>
);

export default function ProtectedRoute({ requiredRole }) {
  const { isAuthenticated, isLoadingAuth, authChecked, user, checkUserAuth } = useAuth();
  const location = useLocation();
  const { hasModule, isLoading: entitlementsLoading } = useCommerceEntitlements();

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) checkUserAuth();
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  if (isLoadingAuth || !authChecked) return <Spinner />;

  // Pas connecté → login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Vérification d'accès à la route
  const role = user?.role || "client";
  if (!hasRouteAccess(role, location.pathname)) {
    // Rediriger vers la première route accessible
    const homeRoute = role === "client" ? "/" : "/";
    return <Navigate to={homeRoute} replace />;
  }

  const requiredModule = CLIENT_ROUTE_MODULES[location.pathname];
  if (role === 'client' && requiredModule) {
    if (entitlementsLoading) return <Spinner />;
    if (!hasModule(requiredModule)) return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

