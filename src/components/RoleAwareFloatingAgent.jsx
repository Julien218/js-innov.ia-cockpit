import { useAuth } from '@/lib/AuthContext';
import FloatingAgent from '@/components/FloatingAgent';
import ClientCompanion from '@/components/ClientCompanion';
import LocalAgentQueueBridge from '@/components/LocalAgentQueueBridge';
import ElyneaBrandScope from '@/components/ElyneaBrandScope';

const OFFICIAL_JSINNOVIA_COMPANION = 'https://www.jsinnovia.com/brand/companion/companion-avatar-256.webp';

function LegacyAvatarCompatibility() {
  return <style>{`
    img[alt="NOVA"], img[alt="Elynea"] {
      content: url('${OFFICIAL_JSINNOVIA_COMPANION}');
    }
  `}</style>;
}

export default function RoleAwareFloatingAgent() {
  const { user, authChecked } = useAuth();
  if (!authChecked || !user) return null;

  if (user.role === 'client') {
    return (
      <ElyneaBrandScope>
        <ClientCompanion />
        <LegacyAvatarCompatibility />
      </ElyneaBrandScope>
    );
  }

  return (
    <ElyneaBrandScope>
      <LocalAgentQueueBridge />
      <FloatingAgent />
      <LegacyAvatarCompatibility />
    </ElyneaBrandScope>
  );
}
