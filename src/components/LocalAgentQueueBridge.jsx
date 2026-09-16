import { useEffect } from 'react';
import {
  LOCAL_AGENT_STATUS_KEY,
  LOCAL_AUTOPILOT_LAST_RUN_KEY,
  syncLocalAgentQueue,
} from '@/lib/localAgentQueueBridge';

const BUSY_INTERVAL_MS = 30_000;
const IDLE_INTERVAL_MS = 5 * 60_000;
const HIDDEN_INTERVAL_MS = 15 * 60_000;
const OFFLINE_INTERVAL_MS = 5 * 60_000;
const ERROR_BACKOFF_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000];

function nextDelay(status, failures) {
  if (failures > 0) return ERROR_BACKOFF_MS[Math.min(failures - 1, ERROR_BACKOFF_MS.length - 1)];
  if (typeof document !== 'undefined' && document.hidden) return HIDDEN_INTERVAL_MS;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE_INTERVAL_MS;
  const active = Number(status?.runnable_tasks || 0) > 0
    || Number(status?.pending_results || 0) > 0
    || Number(status?.local_executed || 0) > 0;
  return active ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS;
}

export default function LocalAgentQueueBridge() {
  useEffect(() => {
    let stopped = false;
    let running = false;
    let timer = null;
    let failures = 0;

    const publishStatus = (status) => {
      if (typeof window === 'undefined') return;
      window.__NOVA_LOCAL_STATUS__ = status;
      window.dispatchEvent(new CustomEvent('nova-local-agent-status', { detail: status }));
    };

    const schedule = (delay) => {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), Math.max(5_000, delay));
    };

    const run = async ({ force = false } = {}) => {
      if (stopped || running) return;
      if (!force && typeof document !== 'undefined' && document.hidden) {
        schedule(HIDDEN_INTERVAL_MS);
        return;
      }
      running = true;
      let status = null;
      try {
        localStorage.setItem(LOCAL_AUTOPILOT_LAST_RUN_KEY, String(Date.now()));
        status = await syncLocalAgentQueue();
        failures = 0;
        publishStatus(status);
      } catch (error) {
        failures += 1;
        status = {
          ok: false,
          checked_at: new Date().toISOString(),
          error: String(error?.message || error || 'Agent local indisponible').slice(0, 500),
          adaptive_backoff: true,
        };
        try { localStorage.setItem(LOCAL_AGENT_STATUS_KEY, JSON.stringify(status)); } catch {}
        publishStatus(status);
      } finally {
        running = false;
        schedule(nextDelay(status, failures));
      }
    };

    // Empêche l'ancien widget historique de déclencher un second cycle au montage.
    try { localStorage.setItem(LOCAL_AUTOPILOT_LAST_RUN_KEY, String(Date.now())); } catch {}
    void run({ force: true });

    const wake = () => {
      window.clearTimeout(timer);
      void run({ force: true });
    };
    const onVisibility = () => {
      if (document.hidden) schedule(HIDDEN_INTERVAL_MS);
      else wake();
    };

    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('nova-local-agent-wakeup', wake);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('nova-local-agent-wakeup', wake);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
