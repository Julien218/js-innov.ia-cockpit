import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { usePermissions } from '@/lib/usePermissions';

export function useDemandes() {
  const { user } = useAuth();
  const { canAccess } = usePermissions();
  return useQuery({
    queryKey: ['demandes', user?.organisation_id || '', user?.id || user?.email || ''],
    queryFn: () => base44.entities.Demande.list('-created_at'),
    enabled: Boolean(user) && canAccess('/demandes'),
    staleTime: 15000,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
}
