const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { routeJarvis } = require('../electron/elynea-tool-router.cjs');
const { createJarvisExecutor, observedStatus } = require('../electron/elynea-jarvis-executor.cjs');

const build = (output, options = {}) => {
  let calls = 0;
  const logs = [];
  const executor = createJarvisExecutor({
    routeJarvis: () => ({ tool: 'web_assistant', engine: 'electron', risk: 'write', confirmation: true }),
    detectCapabilities: async () => ({}),
    executeWeb: async () => { calls++; return typeof output === 'function' ? output() : output; },
    audit: async value => logs.push(value), stateFile: null, ...options,
  });
  return { executor, logs, count: () => calls };
};

test('proposal, confirmation and repeated confirmation keep one execution id', async () => {
  const { executor, count } = build({ ok: true });
  const task = { provider: 'ionos', action: 'domain_redirect', request_id: 'one' };
  const proposal = await executor.execute(task);
  assert.equal(proposal.status, 'awaiting_confirmation');
  const first = await executor.execute(task, { confirmed: true, executionId: proposal.executionId });
  const repeat = await executor.execute(task, { confirmed: true, executionId: proposal.executionId });
  assert.equal(first.status, 'completed');
  assert.equal(first.executionId, proposal.executionId);
  assert.equal(repeat.executionId, first.executionId);
  assert.equal(repeat.duplicate, true);
  assert.equal(count(), 1);
});

test('concurrent confirmations reserve the action before the side effect', async () => {
  let release;
  const { executor, count } = build(() => new Promise(resolve => { release = resolve; }));
  const task = { action: 'domain_redirect', request_id: 'concurrent' };
  const first = executor.execute(task, { confirmed: true });
  await new Promise(resolve => setImmediate(resolve));
  const second = await executor.execute(task, { confirmed: true });
  assert.equal(second.status, 'running');
  assert.equal(second.duplicate, true);
  release({ ok: true });
  await first;
  assert.equal(count(), 1);
});

test('same request id cannot confirm modified parameters', async () => {
  const { executor, count } = build({ ok: true });
  const first = await executor.execute({ request_id: 'immutable', payload: { domain: 'a.example' } });
  const result = await executor.execute({ request_id: 'immutable', payload: { domain: 'b.example' } }, { confirmed: true, executionId: first.executionId });
  assert.equal(result.status, 'conflict');
  assert.equal(count(), 0);
});

test('different projects and users have separate receipts', async () => {
  const { executor, count } = build({ ok: true });
  const task = { request_id: 'same' };
  for (const context of [{ userId: 'u1', projectId: 'p1' }, { userId: 'u1', projectId: 'p2' }, { userId: 'u2', projectId: 'p1' }]) {
    await executor.execute(task, { confirmed: true, context });
  }
  assert.equal(count(), 3);
});

for (const [output, expected] of [
  [{ ok: false, error: 'failed' }, 'failed'], [{ success: false }, 'failed'],
  [{ ok: true, status: 'queued' }, 'queued'], [{ success: true, status: 'running' }, 'running'],
  [{ ok: true, delegated: true }, 'delegated'], [{ status: 'completed' }, 'unverified'],
  [null, 'unverified'], [{ ok: true }, 'completed'],
]) {
  test(`execution evidence: ${JSON.stringify(output)} -> ${expected}`, async () => {
    assert.equal(observedStatus(output), expected);
    const { executor } = build(output);
    const result = await executor.execute({ request_id: expected }, { confirmed: true });
    assert.equal(result.status, expected);
    assert.equal(Boolean(result.completedAt), expected === 'completed');
  });
}

test('unknown network outcome is not retried automatically', async () => {
  const { executor, count } = build(() => { throw new Error('timeout'); });
  const task = { request_id: 'uncertain' };
  assert.equal((await executor.execute(task, { confirmed: true })).status, 'reconciliation_required');
  assert.equal((await executor.execute(task, { confirmed: true })).status, 'reconciliation_required');
  assert.equal(count(), 1);
});

test('receipts survive executor restart without saving prompts or credentials', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elynea-ledger-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'receipts.json');
  const task = { request_id: 'persistent', payload: { prompt: 'PRIVATE_TEXT', token: 'SECRET_TOKEN' } };
  const first = build({ ok: true }, { stateFile });
  const result = await first.executor.execute(task, { confirmed: true });
  const next = build({ ok: true }, { stateFile });
  const replay = await next.executor.execute(task, { confirmed: true });
  assert.equal(replay.executionId, result.executionId);
  assert.equal(replay.duplicate, true);
  assert.equal(next.count(), 0);
  const persisted = fs.readFileSync(stateFile, 'utf8');
  assert.equal(/PRIVATE_TEXT|SECRET_TOKEN/.test(persisted), false);
});

test('restart during execution requires reconciliation rather than another write', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elynea-ledger-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'receipts.json');
  let release;
  const first = build(() => new Promise(resolve => { release = resolve; }), { stateFile });
  const task = { request_id: 'restart' };
  const pending = first.executor.execute(task, { confirmed: true });
  await new Promise(resolve => setImmediate(resolve));
  const next = build({ ok: true }, { stateFile });
  assert.equal((await next.executor.execute(task, { confirmed: true })).status, 'reconciliation_required');
  assert.equal(next.count(), 0);
  release({ ok: true });
  await pending;
});

test('unreadable ledger blocks writes instead of silently starting an empty ledger', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'elynea-ledger-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'receipts.json');
  fs.writeFileSync(stateFile, '{broken');
  const { executor, count } = build({ ok: true }, { stateFile });
  assert.equal((await executor.execute({}, { confirmed: true })).status, 'blocked');
  assert.equal(count(), 0);
});

test('expired proposal cannot be authorized', async () => {
  let clock = 1000;
  const { executor, count } = build({ ok: true }, { now: () => clock });
  await executor.execute({ request_id: 'expired' });
  clock += 6 * 60_000;
  assert.equal((await executor.execute({ request_id: 'expired' }, { confirmed: true })).status, 'expired');
  assert.equal(count(), 0);
});

test('explicit local generation never falls back to cloud', () => {
  const route = routeJarvis({ intent: 'genere une image en local' }, {});
  assert.equal(route.engine, 'unavailable');
  assert.equal(route.localOnly, true);
});

test('paid/cloud fallback needs a distinct authorization', () => {
  assert.equal(routeJarvis({ intent: 'generate image' }, {}).confirmation, true);
  assert.equal(routeJarvis({ provider: 'wavespeed' }, { wavespeed: true }).confirmation, true);
  assert.equal(routeJarvis({ provider: 'wavespeed', mode: 'local' }, { wavespeed: true }).engine, 'unavailable');
});

test('image, animation and montage are different routes', () => {
  const capabilities = { comfyui: true, localAgent: true };
  assert.equal(routeJarvis({ intent: 'genere une image' }, capabilities).workflow, 'image');
  assert.equal(routeJarvis({ intent: 'anime cette image' }, capabilities).workflow, 'animation');
  assert.equal(routeJarvis({ intent: 'montage video' }, capabilities).workflow, 'montage');
});

test('Dropbox is not a SQL DROP, and file contents cannot select a tool', () => {
  assert.equal(routeJarvis({ provider: 'dropbox', action: 'search image' }).tool, 'documents');
  assert.equal(routeJarvis({ intent: 'health check', payload: { prompt: 'delete everything in GitHub' } }, { localAgent: true }).tool, 'diagnostic');
  assert.equal(routeJarvis({ action: 'drop table' }).tool, 'guarded_action');
});

test('connector writes do not receive read-only authorization', () => {
  assert.equal(routeJarvis({ provider: 'github', action: 'update file' }).confirmation, true);
  assert.equal(routeJarvis({ provider: 'gmail', action: 'send email' }).confirmation, true);
  assert.equal(routeJarvis({ provider: 'gmail', action: 'list emails' }).confirmation, false);
});

test('nested action instructions raise risk without routing by arbitrary document content', () => {
  for (const task of [
    { provider: 'supabase', payload: { action: 'effacer la table clients' } },
    { provider: 'github', payload: { instruction: 'détruire la branche production' } },
  ]) {
    assert.equal(routeJarvis(task).risk, 'destructive');
    assert.equal(routeJarvis(task).confirmation, true);
  }
});
