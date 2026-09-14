import { useAuth } from '@/lib/AuthContext';
import FloatingAgent from '@/components/FloatingAgent';
import ClientCompanion from '@/components/ClientCompanion';
import LocalAgentQueueBridge from '@/components/LocalAgentQueueBridge';
import ElyneaBrandScope from '@/components/ElyneaBrandScope';

export default function RoleAwareFloatingAgent() {
  const { user, authChecked } = useAuth();
  if (!authChecked || !user) return null;

  if (user.role === 'client') {
    return (
      <ElyneaBrandScope>
        <ClientCompanion />
      </ElyneaBrandScope>
    );
  }

  return (
    <ElyneaBrandScope>
      <LocalAgentQueueBridge />
      <FloatingAgent />
    </ElyneaBrandScope>
  );
}
