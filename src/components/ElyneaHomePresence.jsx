import { useSyncExternalStore } from 'react';
import ElyneaJarvisPresence from './ElyneaJarvisPresence';
import { getJarvisMode, subscribeJarvisMode } from '@/lib/jarvisPresenceStore';

export default function ElyneaHomePresence({ callLabel = 'Parler à Elynea' }) {
  const mode = useSyncExternalStore(subscribeJarvisMode, getJarvisMode, () => 'idle');
  return (
    <div className="elynea-home-presence">
      <ElyneaJarvisPresence mode={mode} />
      <button type="button" className="jarvis-home-chip" onClick={() => window.dispatchEvent(new CustomEvent('elynea:open', { detail: { prompt: '' } }))}>
        {callLabel}
      </button>
    </div>
  );
}
