import { useAuth } from '@/lib/AuthContext';
import FloatingAgent from '@/components/FloatingAgent';
import ClientCompanion from '@/components/ClientCompanion';
import LocalAgentQueueBridge from '@/components/LocalAgentQueueBridge';

const OFFICIAL_JSINNOVIA_COMPANION = 'https://www.jsinnovia.com/brand/companion/companion-avatar-256.webp';

export default function RoleAwareFloatingAgent() {
  const { user, authChecked } = useAuth();
  if (!authChecked || !user) return null;

  if (user.role === 'client') return <ClientCompanion />;

  return (
    <>
      <LocalAgentQueueBridge />
      <FloatingAgent />
      <style>{`
        img[alt="NOVA"] {
          content: url('${OFFICIAL_JSINNOVIA_COMPANION}');
        }
      `}</style>
    </>
  );
}
