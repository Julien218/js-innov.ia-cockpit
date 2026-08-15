import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';

export function useCommerceEntitlements() {
  const { user } = useAuth();
  const isClient = user?.role === 'client';

  const query = useQuery({
    queryKey: ['commerce-entitlements', user?.email || 'anonymous'],
    enabled: Boolean(user?.email) && isClient,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch('/api/commerce/me', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Impossible de charger les modules du client');
      return response.json();
    },
  });

  const enabledModules = new Set(
    (query.data?.entitlements || [])
      .filter((item) => item.enabled)
      .map((item) => item.module_code)
  );

  const hasModule = (moduleCode) => {
    if (!isClient) return true;
    if (moduleCode === 'ai_agents') {
      return enabledModules.has('ai_agents')
        || [...enabledModules].some((code) => code.startsWith('ai_agent:'));
    }
    return enabledModules.has(moduleCode);
  };

  return {
    ...query,
    hasModule,
    enabledModules,
    orders: query.data?.orders || [],
  };
}

