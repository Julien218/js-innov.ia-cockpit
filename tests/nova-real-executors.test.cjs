const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveNovaExecutor, siteExecutorForTask } = require('../server-nova-executors.cjs');
const { base44ErrorMessage } = require('../server-domain-ops.cjs');
const { executeTaskBatch, sanitizeTaskBatchPayload } = require('../server-task-batch.cjs');

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function memoryAgent() {
  const state = { tasks: [], runs: [], clients: [], invoices: [], projects: [] };
  const fetcher = async (path, options = {}) => {
    const method = options.method || 'GET';
    if (path.startsWith('/data/Tache?')) return jsonResponse(state.tasks);
    if (path.startsWith('/data/Client?')) return jsonResponse(state.clients);
    if (path.startsWith('/data/Facture?')) return jsonResponse(state.invoices);
    if (path.startsWith('/data/Projet?')) return jsonResponse(state.projects);
    if (path.startsWith('/agent-runs?')) {
      const taskId = new URL(`https://local${path}`).searchParams.get('task_id');
      return jsonResponse(state.runs.filter((run) => !taskId || run.task_id === taskId));
    }
    const body = options.body ? JSON.parse(options.body) : {};
    if (path === '/data/Tache' && method === 'POST') {
      const task = { id: `task-${state.tasks.length + 1}`, ...body };
      state.tasks.push(task);
      return jsonResponse(task, 201);
    }
    if (path === '/agent-runs' && method === 'POST') {
      const run = { id: `run-${state.runs.length + 1}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body };
      state.runs.push(run);
      return jsonResponse(run, 201);
    }
    const taskMatch = path.match(/^\/data\/Tache\/([^/]+)$/);
    if (taskMatch && method === 'PATCH') {
      const task = state.tasks.find((item) => item.id === taskMatch[1]);
      Object.assign(task, body);
      return jsonResponse(task);
    }
    const runMatch = path.match(/^\/agent-runs\/([^/]+)$/);
    if (runMatch && method === 'PATCH') {
      const run = state.runs.find((item) => item.id === runMatch[1]);
      Object.assign(run, body, { updated_at: new Date().toISOString() });
      return jsonResponse(run);
    }
    return jsonResponse({ error: `unhandled ${method} ${path}` }, 404);
  };
  return { state, fetcher };
}

test('NOVA réserve chaque agent Base44 au site dont il est responsable', () => {
  const js = siteExecutorForTask({ titre: 'Réparation IA — jsinnovia.com' });
  const assurances = siteExecutorForTask({ titre: 'SEO automatique — assurances-dour.be' });
  const synergie = siteExecutorForTask({ titre: 'SEO — synergiedour.be' });
  assert.equal(js.provider, 'base44');
  assert.equal(js.id, 'base44-site:jsinnov-agent');
  assert.equal(js.domain, 'jsinnovia.com');
  assert.equal(assurances.id, 'base44-site:assurances-dour');
  assert.equal(assurances.provider_agent_id, '6a008b3e1571ea9f6ac3839d');
  assert.equal(assurances.domain, 'assurances-dour.be');
  assert.equal(synergie.id, 'base44-site:synergie-dour');
  assert.equal(siteExecutorForTask({ titre: 'Mettre à jour tous les clients' }), null);
  assert.equal(siteExecutorForTask({ titre: 'Contrôler MiniMax dans ComfyUI' }), null);
  assert.equal(siteExecutorForTask({ titre: 'Contrôler video-studio.jsinnovia.com' }).id, 'base44-site:generatvideopro');
});

test('les erreurs Base44 conservent le détail exploitable du fournisseur', () => {
  assert.equal(
    base44ErrorMessage({ message: 'Agent tools are not enabled for this operation' }, 400, 'agent'),
    'Base44 agent HTTP 400: Agent tools are not enabled for this operation',
  );
});

test('NOVA attribue Windows et les données métier à ses exécuteurs internes', () => {
  assert.equal(resolveNovaExecutor({ titre: 'Contrôler ComfyUI et les workflows MiniMax' }).id, 'nova-windows-local');
  assert.equal(resolveNovaExecutor({ titre: 'Compléter les numéros BCE des clients' }).id, 'nova-business-data');
  assert.equal(resolveNovaExecutor({ titre: 'Écrire une nouvelle application inconnue' }).kind, 'unsupported');
});

test('une proposition Base44 ne peut pas détourner une tâche Windows vers Base44', () => {
  const payload = sanitizeTaskBatchPayload({ tasks: [{ titre: 'Contrôler ComfyUI', provider: 'base44', provider_agent_id: 'malveillant' }] });
  assert.equal(resolveNovaExecutor(payload.tasks[0].record).provider, 'local-agent');
});

test('le batch crée un run pending pour Windows et jamais un faux running', async () => {
  const { state, fetcher } = memoryAgent();
  const payload = sanitizeTaskBatchPayload({ tasks: [{ titre: 'Contrôler ComfyUI et les workflows locaux' }] });
  const result = await executeTaskBatch({ payload, token: 'test', user: { id: 'owner' }, tenant: 'jsinnovia', agentFetch: fetcher });
  assert.equal(result.results[0].status, 'queued_local');
  assert.equal(result.results[0].executor, 'nova-windows-local');
  assert.equal(state.runs[0].status, 'pending');
  assert.equal(state.runs[0].execution_mode, 'autonomous');
  assert.equal(state.tasks[0].statut, 'en_cours');
});

test('un audit métier est réellement exécuté et clôturé avec son résultat', async () => {
  const { state, fetcher } = memoryAgent();
  state.clients.push({ id: 'client-1', denomination_legale: 'Exemple', numero_entreprise: '0123', numero_tva: 'BE0123', adresse: 'Rue', code_postal: '7000', ville: 'Mons' });
  state.invoices.push({ id: 'invoice-1' });
  const payload = sanitizeTaskBatchPayload({ tasks: [{ titre: 'Analyser les factures et leur rattachement' }] });
  const result = await executeTaskBatch({ payload, token: 'audit', user: { id: 'owner' }, tenant: 'jsinnovia', agentFetch: fetcher });
  assert.equal(result.results[0].status, 'completed');
  assert.equal(state.runs[0].status, 'completed');
  assert.equal(state.runs[0].result.invoices_count, 1);
  assert.deepEqual(state.runs[0].result.invoices_without_client, ['invoice-1']);
  assert.equal(state.tasks[0].statut, 'terminee');
});

test('un site appelle son exécuteur réel avant toute clôture', async () => {
  const { state, fetcher } = memoryAgent();
  let call = null;
  const payload = sanitizeTaskBatchPayload({ tasks: [{ titre: 'Réparation IA — jsinnovia.com' }] });
  const result = await executeTaskBatch({
    payload, token: 'site', user: { id: 'owner' }, tenant: 'jsinnovia', agentFetch: fetcher,
    executionHandlers: { site: async (executor, task) => { call = { executor, task }; return { completed: true, result: { verified: true } }; } },
  });
  assert.equal(call.executor.id, 'base44-site:jsinnov-agent');
  assert.equal(result.results[0].status, 'completed');
  assert.equal(state.runs[0].provider_name, 'base44');
});
