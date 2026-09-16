import { useAuth } from '@/lib/AuthContext';
import FloatingAgent from '@/components/FloatingAgent';
import ClientCompanion from '@/components/ClientCompanion';
import LocalAgentQueueBridge from '@/components/LocalAgentQueueBridge';
import ElyneaContinuousVoice from '@/components/ElyneaContinuousVoice';
import ElyneaAudioDock from '@/components/audio/ElyneaAudioDock';
import ElyneaBrandScope, { ELYNEA_COMPANION, OFFICIAL_ELYNEA_AVATAR } from '@/components/ElyneaBrandScope';

/**
 * Compatibilité visuelle transitoire pour les composants historiques qui rendent
 * encore une balise <img alt="NOVA">. L'avatar affiché reste toujours Elynea 3D.
 */
function LegacyAvatarCompatibility() {
  return <style>{`
    img[alt="NOVA"], img[alt="Elynea"] {
      content: url('${OFFICIAL_ELYNEA_AVATAR}');
    }
  `}</style>;
}

/**
 * Companion unique du Cockpit.
 *
 * - client : interface conversationnelle client, toujours sous l'identité Elynea ;
 * - équipe/admin : Elynea complète + pont vers ses outils locaux ;
 * - ElyneaContinuousVoice ajoute le dialogue mains libres sans créer un second agent ;
 * - ElyneaAudioDock ajoute le lecteur global et la bibliothèque Dropbox pour les admins ;
 * - aucune seconde identité IA n'est rendue par ce composant.
 */
export default function ElyneaCockpitCompanion() {
  const { user, authChecked } = useAuth();
  if (!authChecked || !user) return null;

  if (user.role === 'client') {
    return (
      <ElyneaBrandScope>
        <ClientCompanion />
        <ElyneaContinuousVoice />
        <LegacyAvatarCompatibility />
      </ElyneaBrandScope>
    );
  }

  const audioEnabled = user.role === 'admin' || user.role === 'superadmin';

  return (
    <ElyneaBrandScope>
      <LocalAgentQueueBridge />
      <FloatingAgent />
      <ElyneaContinuousVoice />
      {audioEnabled && <ElyneaAudioDock />}
      <LegacyAvatarCompatibility />
      <span
        aria-hidden="true"
        data-companion-name={ELYNEA_COMPANION.name}
        data-companion-role={ELYNEA_COMPANION.role}
        style={{ display: 'none' }}
      />
    </ElyneaBrandScope>
  );
}
