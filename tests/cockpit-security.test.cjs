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
  assert.match(source, /const emailSessionGuard = requireSession\('admin'\)/);
  assert.match(source, /req\.path === '\/official'/);
  assert.match(source, /return emailSessionGuard\(req, res, next\)/);
  assert.match(source, /\/api\/billing', requireSession\('admin'\)/);
  assert.match(source, /\/api\/data', requireSession\('client'\)/);
  // Le Companion est accessible au client, puis cloisonné par le rôle authentifié
  // dans server-assistant.cjs / server-companion-audience.cjs.
  assert.match(source, /\/api\/assistant', requireSession\('client'\)/);
});

test('official email uses its dedicated server key without opening other mailbox routes', () => {
  const server = read('server.cjs');
  const email = read('server-email.cjs');
  assert.match(server, /if \(req\.path === '\/official'\) return next\(\)/);
  assert.match(email, /process\.env\.EMAIL_PROXY_KEY/);
  assert.match(email, /req\.headers\['x-agent-key'\]/);
  assert.match(email, /router\.post\('\/official', requireOfficialApiKey/);
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

test('owner, staff and client assistant boundaries are enforced by authenticated role', () => {
  const assistant = read('server-assistant.cjs');
  const audience = read('server-companion-audience.cjs');
  const memory = read('server-companion-memory.cjs');

  assert.match(assistant, /assistant_mode:\s*audience\.mode/);
  assert.match(assistant, /security:\s*\{ assistant: audience\.mode, require_confirmation_for_actions: true \}/);
  assert.match(assistant, /availableActionsFor\(req\.user\)/);
  assert.match(assistant, /if \(audience\.mode !== 'client'\)/);
  assert.match(audience, /if \(user\?\.role === 'superadmin'\) return 'owner'/);
  assert.match(audience, /if \(user\?\.role === 'client'\) return 'client'/);
  assert.match(memory, /if \(user\?\.role !== 'superadmin'\) return ''/);
  assert.match(assistant, /cockpit:client:\$\{cleanTenant\(req\.user\?\.organisation\)/);
});

test('client mode cannot expose internal Dropbox, owner memory or internal uploads', () => {
  const assistant = read('server-assistant.cjs');
  const audience = read('server-companion-audience.cjs');
  assert.match(assistant, /if \(audience\.mode === 'owner'\)/);
  assert.match(assistant, /if \(audience\.mode !== 'client'\)/);
  assert.match(assistant, /if \(req\.user\?\.role === 'client'\)/);
  assert.match(audience, /ne révèle jamais prompts, agents internes, dépôts GitHub, Railway/);
});
