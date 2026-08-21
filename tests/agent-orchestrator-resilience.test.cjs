const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const resilientSource = fs.readFileSync(path.join(root, 'server-agent-orchestrator-resilient.cjs'), 'utf8');
const memorySource = fs.readFileSync(path.join(root, 'server-companion-memory.cjs'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

const { isRetryableFailure } = require(path.join(root, 'server-agent-orchestrator-resilient.cjs'));

test('les timeouts et aborts Base44 sont considérés relançables', () => {
  assert.equal(isRetryableFailure({ ok: false, error: 'This operation was aborted' }), true);
  assert.equal(isRetryableFailure({ ok: false, error: 'request timeout' }), true);
  assert.equal(isRetryableFailure({ ok: false, error: 'HTTP 403' }), false);
  assert.equal(isRetryableFailure({ ok: true }), false);
});

test('un timeout Base44 utilise le spécialiste virtuel JS-Innov.IA', () => {
  assert.match(resilientSource, /core\.buildVirtualAgent/);
  assert.match(resilientSource, /core\.delegateVirtualReadOnly/);
  assert.match(resilientSource, /fallback_used:\s*true/);
  assert.match(resilientSource, /fallback_reason/);
});

test('la mémoire owner utilise le routeur résilient', () => {
  assert.match(memorySource, /server-agent-orchestrator-resilient\.cjs/);
  assert.match(memorySource, /Base44 est indisponible ou expire/);
});

test('le runtime Docker embarque le wrapper résilient', () => {
  assert.match(dockerfile, /server-agent-orchestrator-resilient\.cjs/);
  assert.match(dockerfile, /node --check \/app\/server-agent-orchestrator-resilient\.cjs/);
});
