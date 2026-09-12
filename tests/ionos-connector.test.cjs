const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const core = require('../server-ionos-connector.cjs');
const { createRouters } = require('../server-ionos.cjs');
const MASKED = '[masqué]';
const syntheticValue = require('node:crypto').randomUUID();

test('IONOS rejects writes, unknown tools, malformed IDs and extra arguments', () => {
  for (const tool of ['dns_update_record', 'dns_delete_record', 'corevps_stop_server', 'constructor']) {
    assert.throws(() => core.validate(tool, {}), /non autorisée/);
  }
  assert.throws(() => core.validate('cloud_read', { datacenter_id: '../secret' }));
  assert.throws(() => core.validate('cloud_read', { server_id: 'server' }));
  assert.throws(() => core.validate('dns_get_zones', { url: 'https://example.com' }));
  assert.throws(() => core.validate('domains_list_domains', { limit: 101 }));
  assert.throws(() => core.validate('domains_list_domains', { offset: -1 }));
});

test('IONOS status reports configuration, never secret values or a verified connection', () => {
  const before = process.env.IONOS_PAT;
  process.env.IONOS_PAT = 'test-pat-for-unit-test';
  try {
    assert.equal(core.configuration().hosting_configured, true);
    assert.equal(core.configuration().connection_verified, false);
    assert.ok(!JSON.stringify(core.configuration()).includes(process.env.IONOS_PAT));
    assert.equal(core.redact({ auth_info: syntheticValue, nested: { password: syntheticValue }, text: process.env.IONOS_PAT }).text, MASKED);
    assert.equal(core.redact({ auth_info: syntheticValue }).auth_info, MASKED);
  } finally { if (before === undefined) delete process.env.IONOS_PAT; else process.env.IONOS_PAT = before; }
});

test('NOVA routes infrastructure and blocks administration without swallowing email triage', () => {
  assert.equal(core.chatIntent('Liste mes domaines IONOS'), 'domains_list_domains');
  assert.equal(core.chatIntent('Affiche les VPS IONOS'), 'corevps_list_contracts');
  assert.equal(core.chatIntent('Supprime le serveur IONOS'), 'write_unsupported');
  assert.equal(core.chatIntent('Trie mes emails IONOS'), null);
  assert.equal(core.chatIntent('Bonjour NOVA'), null);
});

test('Cloud reads enforce host, GET, no redirect, credentials and response redaction', async () => {
  const before = process.env.IONOS_CLOUD_TOKEN;
  process.env.IONOS_CLOUD_TOKEN = 'cloud-test-token';
  try {
    let called = false;
    const result = await core.read('cloud_read', { datacenter_id: 'dc', server_id: 'vm' }, { fetchImpl: async (url, init) => {
      called = true;
      assert.equal(url, 'https://api.ionos.com/cloudapi/v6/datacenters/dc/servers/vm?depth=2');
      assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bearer cloud-test-token');
      return new Response(JSON.stringify({ id: 'vm', properties: { ram: 4096, password: syntheticValue } }));
    } });
    assert.equal(called, true); assert.equal(result.data.properties.password, MASKED);
  } finally { if (before === undefined) delete process.env.IONOS_CLOUD_TOKEN; else process.env.IONOS_CLOUD_TOKEN = before; }
});

test('Missing credentials never trigger network calls', async () => {
  const before = process.env.IONOS_PAT; delete process.env.IONOS_PAT;
  try { await assert.rejects(core.read('dns_get_zones', {}, { fetchImpl: () => { throw new Error('network should not run'); } }), /IONOS_PAT/); }
  finally { if (before !== undefined) process.env.IONOS_PAT = before; }
});

test('Hosting uses real SDK initialize and tools/call with fixed Bearer endpoint', async () => {
  const before = process.env.IONOS_PAT; process.env.IONOS_PAT = 'hosting-test-token';
  const methods = [];
  try {
    const result = await core.read('dns_get_zones', {}, { fetchImpl: async (url, init) => {
      assert.equal(String(url), 'https://mcp.ionos.com/mcp');
      assert.equal(init.redirect, 'error');
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer hosting-test-token');
      if (init.method === 'GET') return new Response('', { status: 405 });
      const body = JSON.parse(init.body); methods.push(body.method);
      if (!body.id && body.id !== 0) return new Response(null, { status: 202 });
      const data = body.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'test-ionos', version: '1' } }
        : { content: [{ type: 'text', text: JSON.stringify([{ id: 'zone', name: 'example.test' }]) }] };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: data }), { headers: { 'Content-Type': 'application/json' } });
    } });
    assert.ok(methods.includes('initialize')); assert.ok(methods.includes('tools/call'));
    assert.equal(core.rows(result.data)[0].name, 'example.test');
  } finally { if (before === undefined) delete process.env.IONOS_PAT; else process.env.IONOS_PAT = before; }
});

test('HTTP routes deny non-owners and unauthenticated users; owner reads and NOVA retain provenance', async () => {
  let calls = 0;
  const service = { ...core, read: async (tool) => { calls++; return { tool, checked_at: '2026-09-12T12:00:00Z', data: [{ name: 'example.test' }], read_only: true }; } };
  const { router, chatRouter } = createRouters(service);
  const app = express(); app.use(express.json());
  // Test-only user injection. Production uses the existing server-side session middleware.
  app.use((req, _res, next) => { if (req.headers['x-test-role']) req.user = { id: 'test', role: req.headers['x-test-role'] }; next(); });
  app.use('/api/ionos', router); app.use('/api/assistant', chatRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(url + '/api/ionos/status')).status, 401);
    for (const role of ['admin', 'client', 'collaborateur']) {
      assert.equal((await fetch(url + '/api/ionos/status', { headers: { 'x-test-role': role } })).status, 403);
    }
    const headers = { 'Content-Type': 'application/json', 'x-test-role': 'superadmin' };
    const response = await fetch(url + '/api/assistant/chat', { method: 'POST', headers, body: JSON.stringify({ message: 'Liste mes domaines IONOS' }) });
    const body = await response.json(); assert.equal(response.status, 200); assert.match(body.message, /example.test/); assert.equal(body.inspection_only, true);
    await fetch(url + '/api/assistant/chat', { method: 'POST', headers, body: JSON.stringify({ message: 'Supprime IONOS' }) });
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
