import { useEffect, useState } from 'react';
import ElyneaAudioDock from '@/components/audio/ElyneaAudioDock';

const RECENT_MEDIA_KEY = 'nova_recent_media_v1';

export default function ElyneaAudioDockSynced() {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refreshWhenAudioChanged = () => {
      try {
        const recent = JSON.parse(localStorage.getItem(RECENT_MEDIA_KEY) || 'null');
        const isAudio = String(recent?.mediaType || '').toLowerCase() === 'audio'
          || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i.test(String(recent?.fileName || recent?.originalFileName || ''));
        if (isAudio) setRevision(value => value + 1);
      } catch {
        setRevision(value => value + 1);
      }
    };

    window.addEventListener('cockpit-documents-changed', refreshWhenAudioChanged);
    return () => window.removeEventListener('cockpit-documents-changed', refreshWhenAudioChanged);
  }, []);

  return <ElyneaAudioDock key={revision} />;
}
