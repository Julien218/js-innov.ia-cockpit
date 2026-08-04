const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('frontend bundles contain no privileged agent credential', () => {
  const files = [
    'src/api/base44Client.js', 'src/pages/Agent.jsx', 'src/pages/Emails.jsx',
    'src/pages/Devis.jsx', 'src/pages/Factures.jsx', 'src/components/layout/Sidebar.jsx'
  ];
  const source = files.map(read).join('\n');
  assert.doesNotMatch(source, /VITE_AGENT_KEY|x-agent-key|agentHeaders/);
});

test('sensitive server routes require an authenticated session', () => {
  const source = read('server.cjs');
  assert.match(source, /\/api\/emails', requireSession\('admin'\)/);
  assert.match(source, /\/api\/billing', requireSession\('admin'\)/);
  assert.match(source, /\/api\/data', requireSession\('client'\)/);
  assert.match(source, /\/api\/assistant', requireSession\('collaborateur'\)/);
});

test('personal assistant actions are allowlisted, confirmed and audited', () => {
  const source = read('server-assistant.cjs');
  assert.match(source, /ALLOWED_ACTIONS/);
  assert.match(source, /pending\.set/);
  assert.match(source, /router\.post\('\/confirm'/);
  assert.match(source, /LogAction/);
  assert.match(source, /idempotency-key/);
});

test('public and personal assistant boundaries remain distinct', () => {
  const source = read('server-assistant.cjs');
  assert.match(source, /assistant: 'personal'/);
  assert.match(source, /cockpit:\$\{req\.user\.id\}/);
});
