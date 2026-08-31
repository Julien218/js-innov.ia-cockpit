const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.SUPABASE_CRM_URL = 'https://crm.example.test';
process.env.SUPABASE_CRM_KEY = 'test-only';
process.env.SUPABASE_URL = 'https://usage.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.JSINNOVIA_AGENT_URL = 'https://agent.example.test';
process.env.JSINNOVIA_AGENT_KEY = 'test-only';
process.env.BILLING_EUR_PER_USD = '1';
process.env.BILLING_FX_SOURCE = 'test-only';
const { router, upsertLedgerGroup, monthWindow } = require('../server-ai-cost-ledger-aggregate.cjs');
const nativeFetch = global.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

async function runImport(t, { usage = [], legacy = [], previous = [], projects = [], failLookup = false, rule = null } = {}) {
  const writes = [];
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => { global.fetch = nativeFetch; server.close(); });
  global.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (options.method === 'POST' || options.method === 'PATCH') { const row = JSON.parse(options.body); writes.push(row); return json([row]); }
    if (url.host === 'agent.example.test') return json(url.pathname.endsWith('/Client/client') ? { id: 'client' } : projects);
    if (url.host === 'usage.example.test') {
      const offset = Number(url.searchParams.get('offset') || 0);
      return json(usage.slice(offset, offset + 1000));
    }
    if (url.pathname.endsWith('/client_billing_rules')) return json(rule ? [rule] : []);
    if (url.searchParams.has('or')) return json(legacy);
    if (url.searchParams.get('select') === 'external_ref') return json(previous);
    if (failLookup && url.pathname.endsWith('/client_cost_events')) return json({ message: 'lookup failed' }, 503);
    return json([]);
  };
  const result = await nativeFetch(`http://127.0.0.1:${server.address().port}/clients/client/import-ai-usage`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ month: '2026-08' }),
  });
  return { status: result.status, body: await result.json(), writes };
}

test('route conserve deux projets et leur client dans les écritures', async (t) => {
  const result = await runImport(t, {
    usage: ['miss', 'tour'].map((project) => ({ client_key: 'client', project_key: project, provider: 'openai', model: 'test', cost_usd: 1 })),
    projects: ['miss', 'tour'].map((id) => ({ id, client_id: 'client' })),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.writes.map((row) => row.project_id), ['miss', 'tour']);
  assert.equal(new Set(result.writes.map((row) => row.external_ref)).size, 2);
  assert.ok(result.writes.every((row) => row.client_id === 'client'));
});
test('route pagine les usages au-delà de 1000 lignes et ne facture pas sans projet', async (t) => {
  const result = await runImport(t, { usage: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), client_key: 'client', cost_usd: 0.001 })) });
  assert.equal(result.status, 200);
  assert.equal(result.body.requests, 1001);
  assert.equal(result.writes[0].billable, false);
  assert.equal(result.writes[0].billable_minor, 0);
});
test('route refuse tout écrit si le mois contient des totaux historiques', async (t) => {
  const result = await runImport(t, { legacy: [{ id: 'legacy' }] });
  assert.equal(result.status, 409);
  assert.equal(result.writes.length, 0);
});
test('route refuse une ancienne attribution devenue absente', async (t) => {
  const result = await runImport(t, { previous: [{ external_ref: 'old-scope' }] });
  assert.equal(result.status, 409);
  assert.equal(result.writes.length, 0);
});
test('route refuse un projet étranger avant toute écriture', async (t) => {
  const result = await runImport(t, { usage: [{ client_key: 'client', project_key: 'foreign', cost_usd: 1 }], projects: [{ id: 'foreign', client_id: 'other' }] });
  assert.equal(result.status, 503);
  assert.equal(result.writes.length, 0);
});
test('une panne de détection de doublon ne devient pas une autorisation d’insérer', async (t) => {
  const result = await runImport(t, { usage: [{ client_key: 'client', cost_usd: 1 }], failLookup: true });
  assert.equal(result.status, 503);
  assert.equal(result.writes.length, 0);
});
test('un minimum mensuel ne se multiplie pas automatiquement par projet', async (t) => {
  const result = await runImport(t, { usage: ['miss', 'tour'].map((project_key) => ({ client_key: 'client', project_key, cost_usd: 1 })), projects: ['miss', 'tour'].map((id) => ({ id, client_id: 'client' })), rule: { cost_type: 'llm_api', billing_mode: 'percent', minimum_minor: 1000 } });
  assert.equal(result.status, 422);
  assert.equal(result.writes.length, 0);
});
for (const lock of ['facture_id', 'invoice_id']) {
  test(`une ligne ${lock} reste intangible`, async (t) => {
    t.after(() => { global.fetch = nativeFetch; });
    global.fetch = async (_url, options) => { assert.equal(options.method, 'GET'); return json([{ id: 'locked', [lock]: 'invoice' }]); };
    const result = await upsertLedgerGroup('client', monthWindow('2026-08'), { costUsd: 1, billable: true, projectId: 'miss' }, null);
    assert.equal(result.status, 'locked_invoiced');
  });
}
test('la mise à jour concurrente reste conditionnée à l’absence des deux types de facture', async (t) => {
  t.after(() => { global.fetch = nativeFetch; });
  global.fetch = async (input, options) => {
    if (options.method === 'GET') return json([{ id: 'pending' }]);
    if (options.method === 'POST') { assert.match(options.headers.Prefer, /ignore-duplicates/); return json([]); }
    const url = new URL(input);
    assert.equal(url.searchParams.get('facture_id'), 'is.null');
    assert.equal(url.searchParams.get('invoice_id'), 'is.null');
    return json([]);
  };
  const result = await upsertLedgerGroup('client', monthWindow('2026-08'), { costUsd: 1, billable: true, projectId: 'miss' }, null);
  assert.equal(result.status, 'locked_invoiced');
});
