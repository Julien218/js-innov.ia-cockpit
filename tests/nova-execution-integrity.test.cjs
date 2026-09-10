const test = require('node:test');
const assert = require('node:assert/strict');
const { executeTaskBatch, sanitizeTaskBatchPayload } = require('../server-task-batch.cjs');

function memoryAgent({ failures = 0, reused = false } = {}) {
  const tasks = [{ id: 't1', titre: 'Contrôle', description: 'Analyser les factures et leur rattachement', notes: 'Historique conservé', statut: 'a_faire', client_id: 'c1' }];
  const runs = [];
  let patches = 0;
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const fetcher = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.startsWith('/data/Tache?')) return response(tasks);
    if (url.startsWith('/agent-runs?')) return response(runs);
    if (url === '/agent-runs' && options.method === 'POST') {
      const run = { ...body, id: 'r1', ...(reused ? { reused: true } : {}) };
      runs.push(run);
      return response(run);
    }
    if (url === '/agent-runs/r1' && options.method === 'PATCH') {
      patches++;
      if (patches <= failures) return response({}, 502);
      if (body.status === 'completed' && (body.result?.proof_status !== 'verified' || !body.result?.evidence?.length)) return response({ error: 'completion_proof_required' }, 400);
      Object.assign(runs[0], body);
      return response(runs[0]);
    }
    if (url === '/data/Tache/t1') {
      if (options.method === 'PATCH') Object.assign(tasks[0], body);
      return response(tasks[0]);
    }
    throw new Error(`Unexpected ${options.method || 'GET'} ${url}`);
  };
  return { tasks, runs, fetcher, patches: () => patches };
}

const batch = (db, handler, extra = {}) => executeTaskBatch({
  payload: sanitizeTaskBatchPayload({ tasks: [{ task_id: 't1', titre: 'Contrôle' }] }),
  token: 'stable-request', tenant: 'jsinnovia', user: { id: 'owner' }, agentFetch: db.fetcher,
  executionHandlers: { business: handler }, ...extra,
});

test('existing task uses stored description and preserves history', async () => {
  const db = memoryAgent();
  let seen;
  const result = await batch(db, async task => { seen = task; return { completed: true, result: { checked_at: new Date().toISOString(), invoices_count: 3 } }; });
  assert.equal(result.results[0].status, 'completed');
  assert.equal(seen.client_id, 'c1');
  assert.match(seen.description, /factures/);
  assert.match(db.tasks[0].notes, /Historique conservé/);
  assert.equal(db.runs[0].result.proof_status, 'verified');
  assert.ok(db.runs[0].result.evidence.length);
});

test('transient run PATCH 502 retries persistence, never business execution', async () => {
  const db = memoryAgent({ failures: 1 });
  let calls = 0;
  const result = await batch(db, async () => { calls++; return { completed: true, result: { checked_at: new Date().toISOString(), invoices_count: 3 } }; });
  assert.equal(calls, 1);
  assert.equal(result.results[0].status, 'completed');
  assert.equal(db.patches(), 2);
});

test('an atomic claim reused by the backend never executes again', async () => {
  const db = memoryAgent({ reused: true });
  let calls = 0;
  const result = await batch(db, async () => { calls++; return { completed: true }; });
  assert.equal(calls, 0);
  assert.equal(result.results[0].status, 'already_running');
});

test('an ongoing job stays RUNNING and is not awaiting authorization', async () => {
  const db = memoryAgent();
  const result = await batch(db, async () => ({ completed: false, in_progress: true, result: { video_job_id: 'v1' } }));
  assert.equal(db.runs[0].status, 'running');
  assert.equal(result.results[0].operational_status, 'RUNNING');
});

test('missing input is distinct from failed execution and authorization', async () => {
  const db = memoryAgent();
  const result = await batch(db, async () => ({ completed: false, reason: 'generation_video_incomplete:source_document_id', result: { missing_fields: ['source_document_id'] } }));
  assert.equal(result.results[0].operational_status, 'WAITING_INPUT');
});

test('same title with different clients remains two objectives', () => {
  const p = sanitizeTaskBatchPayload({ tasks: [{ titre: 'Audit', client_id: 'a' }, { titre: 'Audit', client_id: 'b' }] });
  assert.equal(p.tasks.length, 2);
});

test('completion without evidence is never DONE', async () => {
  const db = memoryAgent();
  const result = await batch(db, async () => ({ completed: true }));
  assert.notEqual(db.tasks[0].statut, 'terminee');
  assert.equal(result.results[0].operational_status, 'TECHNICAL_ERROR');
});

test('persistent 502 preserves the active claim and never replays the effect', async () => {
  const db = memoryAgent({ failures: 20 });
  let calls = 0;
  const result = await batch(db, async () => { calls++; return { completed: true, result: { checked: 1 } }; });
  assert.equal(calls, 1);
  assert.equal(db.runs[0].status, 'running');
  assert.equal(result.results[0].operational_status, 'TECHNICAL_ERROR');
  await batch(db, async () => { calls++; });
  assert.equal(calls, 1);
});

test('task update failure never overwrites an already persisted final proof', async () => {
  const db = memoryAgent();
  const fetcher = db.fetcher;
  db.fetcher = async (url, options = {}) => {
    if (options.method === 'PATCH' && url === '/data/Tache/t1' && JSON.parse(options.body).statut === 'terminee') return new Response('{}', { status: 502 });
    return fetcher(url, options);
  };
  await batch(db, async () => ({ completed: true, result: { checked: 1 } }));
  assert.equal(db.runs[0].status, 'completed');
  assert.equal(db.runs[0].result.proof_status, 'verified');
  let calls = 0;
  db.fetcher = fetcher;
  await batch(db, async () => { calls++; });
  assert.equal(calls, 0);
  assert.equal(db.tasks[0].statut, 'terminee');
});

test('all operational states are distinct', () => {
  const { operationalStatus } = require('../server-task-batch.cjs');
  for (const [outcome, expected] of [
    [{ requires_authorization: true }, 'WAITING_AUTHORIZATION'],
    [{ reason: 'media_source_absente_ou_non_exploitable' }, 'WAITING_INPUT'],
    [{ in_progress: true }, 'RUNNING'], [{ retrying: true }, 'RETRYING'],
    [{ completed: true }, 'DONE'], [{ reason: 'developpement_non_execute_preuve_de_livraison_absente' }, 'NO_EXECUTOR'],
    [{ technical_error: true }, 'TECHNICAL_ERROR'], [{ reason: 'verification_echouee' }, 'FAILED'],
  ]) assert.equal(operationalStatus(outcome), expected);
});

test('diagnostic of site features runs without authorization or development executor', async () => {
  const { executeSiteTask } = require('../server-nova-executors.cjs');
  const result = await executeSiteTask({ domain: 'jsinnovia.com' }, { titre: 'Analyser les fonctionnalités du site jsinnovia.com' }, { analyze: async domain => ({ domain, checked_at: new Date().toISOString(), healthy: true }) });
  assert.equal(result.completed, true);
});

test('stored historical notes do not hijack executor routing', () => {
  const { resolveNovaExecutor } = require('../server-nova-executors.cjs');
  assert.equal(resolveNovaExecutor({ titre: 'Compléter la fiche projet VilleConnectOs', notes: 'Ancien diagnostic ComfyUI' }).kind, 'project');
});

test('media references survive sanitization and present media is not reported missing', () => {
  const { resolveNovaExecutor } = require('../server-nova-executors.cjs');
  const task = sanitizeTaskBatchPayload({ tasks: [{ titre: 'Analyser une image', source_document_id: 'document-12345678' }] }).tasks[0].record;
  assert.match(task.description, /document-12345678/);
  assert.equal(resolveNovaExecutor(task).reason, 'aucun_executeur_media_enregistre');
});

test('completed historical task is never executed again', async () => {
  const db = memoryAgent(); db.tasks[0].statut = 'terminee';
  let calls = 0;
  await batch(db, async () => { calls++; });
  assert.equal(calls, 0);
  assert.equal(db.runs.length, 0);
});

test('canonical grouping never links different clients or projects', () => {
  const { duplicateTasksForCanonical } = require('../server-task-autopilot.cjs');
  const original = { id: 'a', titre: 'Audit', client_id: 'client-a', projet_id: 'project-a' };
  assert.deepEqual(duplicateTasksForCanonical([
    original, { ...original, id: 'b', titre: 'Audit (copie)' },
    { ...original, id: 'c', client_id: 'client-b' }, { ...original, id: 'd', projet_id: 'project-b' },
  ], original).map(t => t.id), ['b']);
});

test('UI distinguishes all persisted execution states and refuses unproven DONE', async () => {
  const { runOperationalStatus } = await import('../src/lib/taskStatus.js');
  for (const status of ['WAITING_AUTHORIZATION', 'WAITING_INPUT', 'RUNNING', 'RETRYING', 'NO_EXECUTOR', 'TECHNICAL_ERROR', 'FAILED']) {
    assert.equal(runOperationalStatus({ status: 'running', operational_status: status }), status);
  }
  assert.equal(runOperationalStatus({ status: 'completed' }), 'TECHNICAL_ERROR');
  assert.equal(runOperationalStatus({ status: 'completed', completed_at: '2026-09-11', proof_status: 'verified', has_evidence: true }), 'DONE');
});

test('unsupported routing cannot overwrite an active claim returned during a race', async () => {
  const db = memoryAgent({ reused: true });
  const outcome = await batch(db, async () => { throw new Error('must not execute'); }, { resolveExecutor: () => ({ kind: 'unsupported', id: 'none', reason: 'aucun_executeur_reel_enregistre_pour_ce_type_de_tache' }) });
  assert.equal(outcome.results[0].status, 'already_running');
  assert.equal(db.patches(), 0);
});

test('run summaries retain active executions older than the recent history window', async () => {
  const { taskRunSummaries } = require('../server-task-autopilot.cjs');
  const rows = await taskRunSummaries(async url => new Response(JSON.stringify(
    url.includes('status=pending') ? [{ id: 'old-active', task_id: 't1', status: 'pending', created_at: '2020-01-01' }]
    : url.includes('&status=') ? [] : [{ id: 'recent', task_id: 't2', status: 'cancelled', input: { secret_context: 'not returned' } }]
  )), 'jsinnovia');
  assert.ok(rows.some(run => run.id === 'old-active'));
  assert.equal(rows.length, 2);
  assert.ok(rows.every(run => !('input' in run)));
});
