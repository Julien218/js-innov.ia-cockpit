const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { testOpenAICostConnection, createDiagnosticRouter } = require('../server-openai-cost-diagnostic.cjs');

const secret = 'audit-only-secret-not-a-real-key';
const env = { OPENAI_ADMIN_KEY: secret };
const now = () => Date.parse('2026-08-31T19:00:00Z');
const page = () => new Response(JSON.stringify({ object: 'page', data: [] }), { status: 200 });

test('missing admin key never falls back to the inference key or calls OpenAI', async () => {
  let calls = 0;
  const outcome = await testOpenAICostConnection({
    env: { OPENAI_API_KEY: secret }, fetchImpl: async () => { calls++; return page(); },
  });
  assert.equal(outcome.status, 'missing_key');
  assert.equal(calls, 0);
});

test('makes one bounded GET to fixed OpenAI costs endpoint, with no persistence or generation', async () => {
  let calls = 0;
  const outcome = await testOpenAICostConnection({ env, now, fetchImpl: async (input, options) => {
    calls++;
    const url = new URL(input);
    assert.equal(url.origin + url.pathname, 'https://api.openai.com/v1/organization/costs');
    assert.equal(url.searchParams.get('start_time'), String(Date.parse('2026-08-30T00:00:00Z') / 1000));
    assert.equal(url.searchParams.get('end_time'), String(Date.parse('2026-08-31T00:00:00Z') / 1000));
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(url.searchParams.get('bucket_width'), '1d');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + secret);
    assert.ok(options.signal);
    return page();
  } });
  assert.equal(calls, 1);
  assert.equal(outcome.status, 'connected');
  assert.equal(outcome.provider_http_status, 200);
  assert.equal(outcome.read_only, true);
  assert.equal(JSON.stringify(outcome).includes(secret), false);
  assert.equal('data' in outcome, false);
});

for (const [httpStatus, expected] of [[401, 'invalid_key'], [403, 'forbidden'], [429, 'provider_rate_limit'], [503, 'provider_unavailable'], [400, 'unexpected_response']]) {
  test('classifies HTTP ' + httpStatus + ' without leaking provider body or credentials', async () => {
    const outcome = await testOpenAICostConnection({
      env, fetchImpl: async () => new Response(JSON.stringify({ error: { message: secret } }), { status: httpStatus }),
    });
    assert.equal(outcome.status, expected);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.provider_http_status, httpStatus);
    assert.equal(JSON.stringify(outcome).includes(secret), false);
  });
}

test('ignores monetary and unexpected secret fields in a successful response', async () => {
  const outcome = await testOpenAICostConnection({
    env, fetchImpl: async () => new Response(JSON.stringify({ object: 'page', data: [{ amount: 9999, secret }] })),
  });
  assert.equal(outcome.ok, true);
  assert.doesNotMatch(JSON.stringify(outcome), /9999|audit-only-secret/);
});

test('rejects malformed success JSON and wrong schema', async () => {
  for (const body of ['not-json', '{}', '{"object":"page","data":null}']) {
    const outcome = await testOpenAICostConnection({ env, fetchImpl: async () => new Response(body) });
    assert.equal(outcome.status, 'unexpected_response');
  }
});

test('network exceptions and timeouts are sanitized', async () => {
  const outcome = await testOpenAICostConnection({ env, fetchImpl: async () => { throw new Error(secret); } });
  assert.equal(outcome.status, 'network_error');
  assert.equal(JSON.stringify(outcome).includes(secret), false);
  const expired = await testOpenAICostConnection({
    env, signal: AbortSignal.abort(), fetchImpl: async () => { throw new DOMException(secret, 'AbortError'); },
  });
  assert.equal(expired.status, 'timeout');
  assert.equal(JSON.stringify(expired).includes(secret), false);
});

async function serve(t, user, fetchImpl = async () => page()) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/diagnostic', createDiagnosticRouter({ env, now, fetchImpl }));
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return 'http://127.0.0.1:' + server.address().port + '/diagnostic/connection-test';
}

for (const [role, granted, status] of [[null, false, 401], ['client', true, 403], ['collaborateur', true, 403], ['admin', false, 403], ['admin', true, 200], ['superadmin', false, 200]]) {
  test('HTTP guard: ' + role + ', permission=' + granted + ' -> ' + status, async t => {
    let providerCalls = 0;
    const user = role ? { id: 'test-user', role, permission_overrides: granted ? [{ permission_code: 'ai_cost_control', enabled: true }] : [] } : null;
    const url = await serve(t, user, async () => { providerCalls++; return page(); });
    const response = await fetch(url, { method: 'POST' });
    assert.equal(response.status, status);
    assert.equal(providerCalls, status === 200 ? 1 : 0);
    assert.doesNotMatch(await response.text(), /audit-only-secret/);
  });
}

test('cross-origin request cannot trigger the provider', async t => {
  let calls = 0;
  const url = await serve(t, { role: 'superadmin' }, async () => { calls++; return page(); });
  const response = await fetch(url, { method: 'POST', headers: { Origin: 'https://untrusted.example' } });
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test('manual POST only; repeated requests throttled without provider calls or response caching', async t => {
  let calls = 0;
  const url = await serve(t, { role: 'superadmin' }, async () => { calls++; return page(); });
  assert.equal((await fetch(url)).status, 404);
  const first = await fetch(url, { method: 'POST' });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const second = await fetch(url, { method: 'POST' });
  assert.equal(second.status, 429);
  assert.equal(second.headers.get('retry-after'), '15');
  assert.equal(calls, 1);
});

test('runtime packaging, protected mount and UI contain the diagnostic, not a key input', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  assert.match(read('Dockerfile'), /COPY --from=builder \/app\/server-openai-cost-diagnostic.cjs/);
  assert.match(read('server.cjs'), /app.use\('\/api\/client-costs\/accounting\/openai', require\('\.\/server-openai-cost-diagnostic.cjs'\).createDiagnosticRouter\(\)\)/);
  const component = read('src/components/OpenAICostConnectionTest.jsx');
  assert.match(component, /Tester la connexion OpenAI/);
  assert.match(component, /role="status"/);
  assert.doesNotMatch(component, /<input|OPENAI_ADMIN_KEY|localStorage|sessionStorage/);
  const backend = read('server-openai-cost-diagnostic.cjs');
  assert.doesNotMatch(backend, /console\.|importOpenAICharges|createCostEvent|crmInsert/);
});
