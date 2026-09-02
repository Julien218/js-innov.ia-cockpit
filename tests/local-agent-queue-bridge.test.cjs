const assert = require('node:assert/strict');
const { test } = require('node:test');

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    snapshot() { return Object.fromEntries(values); },
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function bridge() {
  return import('../src/lib/localAgentQueueBridge.js');
}

function proof(taskId, title = 'Tâche locale') {
  return {
    task_id: taskId,
    title,
    completed: true,
    tool_runs: [{
      id: `${taskId.padEnd(8, 'a').slice(0, 8)}-bbbb-cccc-dddd-eeeeeeeeeeee`,
      tool: 'find_local_workflows',
      success: true,
      started_at: '2026-09-02T10:00:00Z',
      completed_at: '2026-09-02T10:00:01Z',
      exit_code: 0,
      output: 'ok',
    }],
  };
}

test('la file locale conserve un seul objectif canonique actif', async () => {
  const { selectCanonicalOpenTasks } = await bridge();
  const tasks = selectCanonicalOpenTasks([
    { id: 'ancien', titre: 'Achever l’avatar JS-Innov.IA en local', statut: 'a_faire', created_at: '2026-08-20T10:00:00Z' },
    { id: 'courant', titre: 'Achever l avatar JS-Innov.IA en local', statut: 'en_cours', created_at: '2026-08-21T10:00:00Z', updated_at: '2026-09-02T10:00:00Z' },
    { id: 'bloque', titre: 'Achever l avatar JS-Innov.IA en local', statut: 'bloquee', created_at: '2026-08-22T10:00:00Z' },
    { id: 'fini', titre: 'Documentation workflows locaux', statut: 'terminee' },
  ]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 'courant');
});

test('la passerelle préfère le service courant, exécute une fois et synchronise la preuve', async () => {
  const {
    LOCAL_PENDING_RESULTS_KEY,
    syncLocalAgentQueue,
  } = await bridge();
  const storage = createStorage();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url === '/api/data/Tache?limit=1000') {
      return jsonResponse([
        { id: 't1', titre: 'Contrôler la persistance des workflows vidéo IA', statut: 'a_faire', created_at: '2026-08-20T10:00:00Z' },
        { id: 't2', titre: 'Contrôler la persistance des workflows vidéo IA', statut: 'en_cours', created_at: '2026-08-21T10:00:00Z', updated_at: '2026-09-02T10:00:00Z' },
      ]);
    }
    if (url === 'http://127.0.0.1:8788/health') {
      return jsonResponse({ agent: { version: '1.5.0' }, services: { ollama: { online: true }, ffmpeg: { online: true }, ffprobe: { online: true } } });
    }
    if (url === 'http://127.0.0.1:8788/api/tasks/autopilot') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.task_snapshot.tasks.length, 1);
      assert.equal(payload.task_snapshot.tasks[0].id, 't2');
      return jsonResponse({ examined: 1, executed: 1, task_results: [proof('t2', payload.task_snapshot.tasks[0].titre)] });
    }
    if (url === '/api/task-autopilot/local-results') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.task_results.length, 1);
      assert.equal(payload.task_results[0].task_id, 't2');
      return jsonResponse({ received: 1, synced: 1, results: [{ task_id: 't2', run_id: 'run-1' }] });
    }
    throw new Error(`URL inattendue: ${url}`);
  };

  const status = await syncLocalAgentQueue({ fetchImpl, storage, online: true, now: Date.parse('2026-09-02T10:00:00Z') });
  assert.equal(status.ok, true);
  assert.equal(status.endpoint, 'http://127.0.0.1:8788');
  assert.equal(status.snapshot_tasks, 1);
  assert.equal(status.local_executed, 1);
  assert.equal(status.local_completed, 1);
  assert.equal(status.synced_results, 1);
  assert.equal(status.pending_results, 0);
  assert.deepEqual(JSON.parse(storage.getItem(LOCAL_PENDING_RESULTS_KEY)), []);
  assert.equal(calls.filter((call) => call.url.endsWith('/api/tasks/autopilot')).length, 1);
});

test('hors ligne, la passerelle utilise la dernière copie et garde la preuve à resynchroniser', async () => {
  const {
    LOCAL_PENDING_RESULTS_KEY,
    LOCAL_TASK_SNAPSHOT_KEY,
    syncLocalAgentQueue,
  } = await bridge();
  const storage = createStorage({
    [LOCAL_TASK_SNAPSHOT_KEY]: JSON.stringify({ synced_at: '2026-09-02T09:00:00Z', tasks: [{ id: 'local-1', titre: 'Vérifier les workflows Minimax en local', statut: 'en_cours' }] }),
  });
  const fetchImpl = async (url, options = {}) => {
    if (url === 'http://127.0.0.1:8788/health') return jsonResponse({ agent: { version: '1.5.0' }, services: { ollama: { online: false }, ffmpeg: { online: true }, ffprobe: { online: true } } });
    if (url === 'http://127.0.0.1:8788/api/tasks/autopilot') {
      const payload = JSON.parse(options.body);
      return jsonResponse({ examined: 1, executed: 1, task_results: [proof('local-1', payload.task_snapshot.tasks[0].titre)] });
    }
    throw new Error(`Le cloud ne devait pas être appelé hors ligne: ${url}`);
  };

  const status = await syncLocalAgentQueue({ fetchImpl, storage, online: false, now: Date.parse('2026-09-02T10:00:00Z') });
  assert.equal(status.ok, true);
  assert.equal(status.snapshot_tasks, 1);
  assert.equal(status.pending_results, 1);
  const pending = JSON.parse(storage.getItem(LOCAL_PENDING_RESULTS_KEY));
  assert.equal(pending[0].task_id, 'local-1');
});

test('une preuve non reconnue par le serveur reste en attente au lieu d’être perdue', async () => {
  const {
    LOCAL_PENDING_RESULTS_KEY,
    syncLocalAgentQueue,
  } = await bridge();
  const storage = createStorage({
    [LOCAL_PENDING_RESULTS_KEY]: JSON.stringify([proof('attente-1')]),
  });
  let syncCalls = 0;
  const fetchImpl = async (url) => {
    if (url === '/api/task-autopilot/local-results') {
      syncCalls += 1;
      return jsonResponse({ received: 1, synced: 0, results: [{ task_id: 'attente-1', error: 'preuve refusée' }] });
    }
    if (url === '/api/data/Tache?limit=1000') return jsonResponse([]);
    if (url === 'http://127.0.0.1:8788/health') return jsonResponse({ agent: { version: '1.5.0' }, services: { ollama: { online: true }, ffmpeg: { online: true }, ffprobe: { online: true } } });
    if (url === 'http://127.0.0.1:8788/api/tasks/autopilot') return jsonResponse({ examined: 0, executed: 0, task_results: [] });
    throw new Error(`URL inattendue: ${url}`);
  };

  const status = await syncLocalAgentQueue({ fetchImpl, storage, online: true, now: Date.parse('2026-09-02T10:00:00Z') });
  assert.equal(syncCalls, 2);
  assert.equal(status.pending_results, 1);
  assert.equal(JSON.parse(storage.getItem(LOCAL_PENDING_RESULTS_KEY))[0].task_id, 'attente-1');
});
