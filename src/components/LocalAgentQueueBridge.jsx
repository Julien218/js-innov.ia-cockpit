import { useEffect } from 'react';
import {
  LOCAL_AGENT_STATUS_KEY,
  LOCAL_AUTOPILOT_LAST_RUN_KEY,
  syncLocalAgentQueue,
} from '@/lib/localAgentQueueBridge';

const POLL_INTERVAL_MS = 30_000;

export default function LocalAgentQueueBridge() {
  useEffect(() => {
    let stopped = false;
    let running = false;

    const publishStatus = (status) => {
      if (typeof window === 'undefined') return;
      window.__NOVA_LOCAL_STATUS__ = status;
      window.dispatchEvent(new CustomEvent('nova-local-agent-status', { detail: status }));
    };

    const run = async () => {
      if (stopped || running) return;
      running = true;
      try {
        localStorage.setItem(LOCAL_AUTOPILOT_LAST_RUN_KEY, String(Date.now()));
        const status = await syncLocalAgentQueue();
        publishStatus(status);
      } catch (error) {
        const status = {
          ok: false,
          checked_at: new Date().toISOString(),
          error: String(error?.message || error || 'Agent local indisponible').slice(0, 500),
        };
        try { localStorage.setItem(LOCAL_AGENT_STATUS_KEY, JSON.stringify(status)); } catch {}
        publishStatus(status);
      } finally {
        running = false;
      }
    };

    // Le widget historique possède encore un minuteur. Cette marque immédiate
    // évite qu’il lance en parallèle une seconde exécution locale au montage.
    try { localStorage.setItem(LOCAL_AUTOPILOT_LAST_RUN_KEY, String(Date.now())); } catch {}
    void run();
    const timer = window.setInterval(() => void run(), POLL_INTERVAL_MS);
    const onOnline = () => void run();
    window.addEventListener('online', onOnline);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return null;
}
