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
  for (const action of ['create_project', 'create_client', 'create_quote', 'send_quote', 'create_invoice', 'send_invoice', 'send_email', 'set_auto_publish']) {
    assert.match(source, new RegExp(`${action}:`));
  }
  assert.match(source, /pendingCompletions/);
  assert.match(source, /router\.post\('\/complete'/);
  assert.match(source, /clientAction: '\/api\/emails\/send'/);
});

test('assistant business actions retain role, input and automation safeguards', () => {
  const source = read('server-assistant.cjs');
  assert.match(source, /validEmail/);
  assert.match(source, /sanitizeLines/);
  assert.match(source, /ADMIN_ROLES/);
  assert.match(source, /request_automation_reactivation/);
  assert.match(source, /roles: \['superadmin'\]/);
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE/);
});

test('public and personal assistant boundaries remain distinct', () => {
  const source = read('server-assistant.cjs');
  assert.match(source, /assistant: 'personal'/);
  assert.match(source, /cockpit:\$\{req\.user\.id\}/);
});
