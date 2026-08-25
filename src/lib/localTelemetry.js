const LOCAL_TELEMETRY_URLS = [
  'http://127.0.0.1:8788',
  'http://127.0.0.1:8787',
];

/** @returns {Promise<any>} */
async function fetchFromLocalAgent(path, options = {}) {
  let lastError = null;
  for (const baseUrl of LOCAL_TELEMETRY_URLS) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(options.timeoutMs || 4500),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.telemetry) throw new Error(data?.error || `Agent local ${response.status}`);
      return { ...data, local_agent_url: baseUrl };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(lastError?.message || 'Télémétrie Windows indisponible');
}

export async function getLocalTelemetryCurrent() {
  return fetchFromLocalAgent('/api/telemetry/current');
}

/**
 * @param {{startedAt?: string, completedAt?: string, runtimeSeconds?: number}} [options]
 * @returns {Promise<any>}
 */
export async function getLocalTelemetrySummary({ startedAt, completedAt, runtimeSeconds } = {}) {
  const params = new URLSearchParams();
  if (startedAt) params.set('started_at', startedAt);
  if (completedAt) params.set('completed_at', completedAt);
  if (Number(runtimeSeconds) > 0) params.set('runtime_seconds', String(Number(runtimeSeconds)));
  return fetchFromLocalAgent(`/api/telemetry/summary?${params.toString()}`, { timeoutMs: 5000 });
}

export { LOCAL_TELEMETRY_URLS };
