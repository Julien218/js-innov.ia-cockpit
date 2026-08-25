const test = require('node:test');
const assert = require('node:assert/strict');

const { executeProjectTask, executeSiteTask, executeVideoTask, isBase44QuotaError, isReadOnlySiteTask, projectPatchFromTask, resolveNovaExecutor, siteExecutorForTask } = require('../server-nova-executors.cjs');
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
    const projectMatch = path.match(/^\/data\/Projet\/([^/]+)$/);
    if (projectMatch && method === 'PATCH') {
      const project = state.projects.find((item) => item.id === projectMatch[1]);
      Object.assign(project, body);
      return jsonResponse(project);
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
  assert.equal(siteExecutorForTask({ titre: 'SEO automatique — jsinnovia.store' }).id, 'base44-site:jsinnov-agent');
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

test('un diagnostic de site reste en lecture seule même si le modèle omet le drapeau', () => {
  assert.equal(isReadOnlySiteTask({ titre: 'Diagnostic DNS complet — assurances-dour.be' }), true);
  assert.equal(isReadOnlySiteTask({ titre: 'Audit SEO technique — assurances-dour.be' }), true);
  assert.equal(isReadOnlySiteTask({ titre: 'Corriger le TLS — assurances-dour.be' }), false);
});

test('le quota Base44 déclenche un diagnostic Cockpit prouvé sans simuler une correction', async () => {
  const executor = siteExecutorForTask({ titre: 'Diagnostic DNS — assurances-dour.be' });
  const result = await executeSiteTask(executor, { titre: 'Diagnostic DNS — assurances-dour.be' }, {
    dispatch: async () => { throw new Error('You have reached your limit of messages for this month. Please upgrade to a paid plan to continue.'); },
    analyze: async (domain) => ({ tool: 'cockpit_domain_probe', run_id: 'domain-proof-1', checked_at: '2026-08-25T12:00:00Z', domain, dns: { apex: { a: ['192.0.2.1'] } }, http: {}, tls: {}, seo: {}, issues: [] }),
  });
  assert.equal(isBase44QuotaError(result.result.base44_fallback.error), true);
  assert.equal(result.completed, true);
  assert.equal(result.provider, 'cockpit-server');
  assert.equal(result.result.run_id, 'domain-proof-1');
  assert.equal(result.result.base44_fallback.status, 'quota_exhausted');
});

test('NOVA attribue Windows et les données métier à ses exécuteurs internes', () => {
  assert.equal(resolveNovaExecutor({ titre: 'Contrôler ComfyUI et les workflows MiniMax' }).id, 'nova-windows-local');
  assert.equal(resolveNovaExecutor({ titre: 'Compléter les numéros BCE des clients' }).id, 'nova-business-data');
  assert.equal(resolveNovaExecutor({ titre: 'Compléter les détails du projet VilleConnectOs' }).id, 'nova-project-data');
  assert.equal(resolveNovaExecutor({ titre: 'Création vidéo Proxiled — écran géant' }).id, 'nova-video-production');
  assert.equal(resolveNovaExecutor({ titre: 'Créer une vidéo pour jsinnovia.com' }).id, 'nova-video-production');
  assert.equal(resolveNovaExecutor({ titre: 'Écrire une nouvelle application inconnue' }).kind, 'unsupported');
});

test('l’exécuteur vidéo exige le client et la source annoncée avant lancement', async () => {
  const agentRequest = async () => [{ id: 'client-proxiled', denomination_legale: 'Proxiled' }];
  const result = await executeVideoTask({
    titre: 'Création vidéo Proxiled — écran géant',
    description: 'Créer une vidéo de huit secondes à partir de l’image fournie pour l’écran géant.',
  }, agentRequest, async () => { throw new Error('ne doit pas être appelée'); });
  assert.equal(result.completed, false);
  assert.deepEqual(result.result.missing_fields, ['source_document_id']);
});

test('l’exécuteur vidéo lance un job traçable quand les entrées sont complètes', async () => {
  const agentRequest = async () => [{ id: 'client-proxiled', denomination_legale: 'Proxiled' }];
  let payload = null;
  const result = await executeVideoTask({
    titre: 'Création vidéo Proxiled — écran géant',
    client_id: 'client-proxiled',
    description: 'Créer une vidéo de huit secondes à partir de l’image fournie. Index Cockpit: media-source-1234',
  }, agentRequest, async (input) => {
    payload = input;
    return { job: { id: 'video-job-1', status: 'queued' }, journal_id: 'video-generation-video-job-1' };
  }, { taskId: 'task-video-1', runId: 'run-video-1' });
  assert.equal(payload.source_document_id, 'media-source-1234');
  assert.equal(payload.client_id, 'client-proxiled');
  assert.equal(payload.task_id, 'task-video-1');
  assert.equal(payload.agent_run_id, 'run-video-1');
  assert.equal(result.reason, 'generation_video_en_cours');
  assert.equal(result.result.journal_id, 'video-generation-video-job-1');
});

test('NOVA extrait uniquement les champs projet explicitement fournis', () => {
  const patch = projectPatchFromTask({
    description: 'Statut: en cours\nPriorité: haute\nObjectif de lancement: 1er octobre 2026\nCréateur/concepteur: Julien\nProgression: 40',
  }, { notes: 'Projet interne' });
  assert.deepEqual(patch, {
    statut: 'en_cours',
    date_fin_prevue: '2026-10-01',
    notes: 'Projet interne\nPriorité: haute\nProgression: 40 %\nCréateur/concepteur: Julien',
  });
  assert.deepEqual(projectPatchFromTask({ description: 'Complète ce projet au mieux.' }), {});
});

test('l’exécuteur Projet met à jour une cible unique et journalise les champs', async () => {
  const { state, fetcher } = memoryAgent();
  state.projects.push({ id: 'project-ville', nom: 'VilleConnectOs', statut: 'a_faire', notes: '' });
  const agentRequest = async (path, options = {}) => {
    const response = await fetcher(path, { ...options, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
    return response.json();
  };
  const result = await executeProjectTask({
    titre: 'Compléter les détails du projet VilleConnectOs',
    description: 'Statut: en cours\nPriorité: haute\nObjectif de lancement: 1er octobre 2026',
  }, agentRequest);
  assert.equal(result.completed, true);
  assert.deepEqual(result.result.updated_fields, ['statut', 'date_fin_prevue', 'notes']);
  assert.equal(state.projects[0].date_fin_prevue, '2026-10-01');
  assert.match(state.projects[0].notes, /Priorité: haute/);
});

test('l’exécuteur Projet refuse une mise à jour sans valeurs explicites', async () => {
  const { state, fetcher } = memoryAgent();
  state.projects.push({ id: 'project-ville', nom: 'VilleConnectOs', statut: 'a_faire' });
  const agentRequest = async (path, options = {}) => (await fetcher(path, options)).json();
  const result = await executeProjectTask({ titre: 'Compléter les détails du projet VilleConnectOs' }, agentRequest);
  assert.equal(result.completed, false);
  assert.equal(result.reason, 'donnees_de_mise_a_jour_projet_absentes');
  assert.equal(state.projects[0].statut, 'a_faire');
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
