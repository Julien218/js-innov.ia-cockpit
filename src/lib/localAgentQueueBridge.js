const DEFAULT_LOCAL_URLS = ['http://127.0.0.1:8787', 'http://127.0.0.1:8788'];

export const LOCAL_TASK_SNAPSHOT_KEY = 'nova_local_task_snapshot_v1';
export const LOCAL_AUTOPILOT_LAST_RUN_KEY = 'nova_local_autopilot_last_run_v1';
export const LOCAL_PENDING_RESULTS_KEY = 'nova_local_pending_results_v2';
export const LOCAL_AGENT_STATUS_KEY = 'nova_local_agent_status_v2';

const OPEN_STATUSES = new Set(['', 'a_faire', 'en_cours']);
const CLOSED_STATUSES = new Set(['terminee', 'terminée', 'completed', 'done', 'annulee', 'annulée', 'cancelled', 'canceled']);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function statusOf(task) {
  return normalize(task?.statut || task?.status).replace(/\s+/g, '_');
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

export function canonicalLocalTaskTitle(value) {
  return normalize(value)
    .replace(/\b(delegation automatique|duplicata|copie)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function preferredTask(current, candidate) {
  if (!current) return candidate;
  const currentStatus = statusOf(current);
  const candidateStatus = statusOf(candidate);
  const score = (status) => status === 'en_cours' ? 2 : status === 'a_faire' || status === '' ? 1 : 0;
  if (score(candidateStatus) !== score(currentStatus)) return score(candidateStatus) > score(currentStatus) ? candidate : current;
  const currentChanged = timestamp(current.updated_at || current.created_at);
  const candidateChanged = timestamp(candidate.updated_at || candidate.created_at);
  return candidateChanged >= currentChanged ? candidate : current;
}

export function selectCanonicalOpenTasks(payload) {
  const groups = new Map();
  for (const task of rowsFrom(payload)) {
    const status = statusOf(task);
    if (CLOSED_STATUSES.has(status) || !OPEN_STATUSES.has(status)) continue;
    const id = String(task?.id || '').trim();
    const key = canonicalLocalTaskTitle(task?.titre || task?.title || task?.nom);
    if (!id || !key) continue;
    groups.set(key, preferredTask(groups.get(key), task));
  }
  return [...groups.values()]
    .sort((a, b) => timestamp(a.created_at) - timestamp(b.created_at))
    .map((task) => ({
      id: task.id,
      titre: task.titre || task.title || task.nom,
      description: task.description || '',
      notes: task.notes || '',
      statut: task.statut || task.status || 'a_faire',
      priorite: task.priorite || task.priority || 'moyenne',
      date_echeance: task.date_echeance || task.due_date || null,
      projet_id: task.projet_id || task.project_id || null,
      client_id: task.client_id || null,
      updated_at: task.updated_at || null,
      created_at: task.created_at || null,
    }));
}

function storageGet(storage, key, fallback) {
  try {
    const parsed = JSON.parse(storage?.getItem(key) || 'null');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function storageSet(storage, key, value) {
  try { storage?.setItem(key, JSON.stringify(value)); } catch {}
}

function pendingResults(storage) {
  const pending = storageGet(storage, LOCAL_PENDING_RESULTS_KEY, []);
  return Array.isArray(pending) ? pending : [];
}

function mergePendingResults(existing, incoming) {
  const merged = new Map();
  for (const item of [...existing, ...incoming]) {
    const taskId = String(item?.task_id || '').trim();
    if (taskId) merged.set(taskId, item);
  }
  return [...merged.values()].slice(0, 250);
}

async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || fallback || `HTTP ${response.status}`);
  return data;
}

async function flushPending({ fetchImpl, storage }) {
  const pending = pendingResults(storage);
  if (!pending.length) return { attempted: 0, synced: 0, remaining: [] };
  const response = await fetchImpl('/api/task-autopilot/local-results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ task_results: pending }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await readJson(response, `Synchronisation locale HTTP ${response.status}`);
  const failedIds = new Set((Array.isArray(data?.results) ? data.results : [])
    .filter((item) => item?.error)
    .map((item) => String(item.task_id || '')));
  const remaining = pending.filter((item) => failedIds.has(String(item.task_id || '')));
  storageSet(storage, LOCAL_PENDING_RESULTS_KEY, remaining);
  return { attempted: pending.length, synced: pending.length - remaining.length, remaining, response: data };
}

async function cloudSnapshot({ fetchImpl, storage, now }) {
  const response = await fetchImpl('/api/data/Tache?limit=1000', {
    credentials: 'include',
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await readJson(response, `Lecture tâches HTTP ${response.status}`);
  const tasks = selectCanonicalOpenTasks(payload);
  const snapshot = { synced_at: new Date(now).toISOString(), tasks };
  storageSet(storage, LOCAL_TASK_SNAPSHOT_KEY, snapshot);
  return snapshot;
}

async function localRun({ fetchImpl, localUrls, snapshot }) {
  let lastError = null;
  for (const localUrl of localUrls) {
    try {
      const healthResponse = await fetchImpl(`${localUrl}/health`, { signal: AbortSignal.timeout(8_000) });
      const health = await readJson(healthResponse, `Santé locale HTTP ${healthResponse.status}`);
      const response = await fetchImpl(`${localUrl}/api/tasks/autopilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_snapshot: snapshot }),
        signal: AbortSignal.timeout(180_000),
      });
      const result = await readJson(response, `Agent local HTTP ${response.status}`);
      return { localUrl, health, result };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Agent local Windows injoignable');
}

export async function syncLocalAgentQueue({
  fetchImpl = fetch,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  online = typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  localUrls = DEFAULT_LOCAL_URLS,
  now = Date.now(),
} = {}) {
  try { storage?.setItem(LOCAL_AUTOPILOT_LAST_RUN_KEY, String(now)); } catch {}

  let flushedBefore = { attempted: 0, synced: 0, remaining: pendingResults(storage) };
  if (online && flushedBefore.remaining.length) flushedBefore = await flushPending({ fetchImpl, storage });

  let snapshot = storageGet(storage, LOCAL_TASK_SNAPSHOT_KEY, { synced_at: null, tasks: [] });
  let cloudError = null;
  if (online) {
    try { snapshot = await cloudSnapshot({ fetchImpl, storage, now }); }
    catch (error) { cloudError = String(error.message || error); }
  }

  const alreadyPending = new Set(pendingResults(storage).map((item) => String(item.task_id || '')));
  const runnableSnapshot = {
    ...snapshot,
    tasks: (Array.isArray(snapshot?.tasks) ? snapshot.tasks : []).filter((task) => !alreadyPending.has(String(task.id || ''))),
  };

  const local = await localRun({ fetchImpl, localUrls, snapshot: runnableSnapshot });
  const localResults = Array.isArray(local.result?.task_results) ? local.result.task_results : [];
  const merged = mergePendingResults(pendingResults(storage), localResults);
  storageSet(storage, LOCAL_PENDING_RESULTS_KEY, merged);

  let flushedAfter = { attempted: 0, synced: 0, remaining: merged };
  if (online && merged.length) flushedAfter = await flushPending({ fetchImpl, storage });

  const status = {
    ok: true,
    checked_at: new Date(now).toISOString(),
    endpoint: local.localUrl,
    agent_version: local.health?.agent?.version || null,
    ollama_online: local.health?.services?.ollama?.online === true,
    ffmpeg_online: local.health?.services?.ffmpeg?.online === true,
    ffprobe_online: local.health?.services?.ffprobe?.online === true,
    snapshot_tasks: Array.isArray(snapshot?.tasks) ? snapshot.tasks.length : 0,
    runnable_tasks: runnableSnapshot.tasks.length,
    local_examined: Number(local.result?.examined || 0),
    local_executed: Number(local.result?.executed || 0),
    synced_results: flushedBefore.synced + flushedAfter.synced,
    pending_results: flushedAfter.remaining.length,
    cloud_error: cloudError,
  };
  storageSet(storage, LOCAL_AGENT_STATUS_KEY, status);
  return status;
}

export function localAgentStatus(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  return storageGet(storage, LOCAL_AGENT_STATUS_KEY, null);
}
