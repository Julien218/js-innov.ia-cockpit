const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const page = read('src/pages/AgentsIA.jsx');
const sidebar = read('src/components/layout/Sidebar.jsx');
const guard = read('src/components/ProtectedRoute.jsx');
const server = read('server-agents.cjs');
const appServer = read('server.cjs');

test('the dedicated cockpit hides Agents IA while direct routes remain gated', () => {
  assert.doesNotMatch(sidebar, /path: "\/agents-ia"/);
  assert.match(guard, /'\/agents-ia': 'ai_agents'/);
  assert.match(guard, /!hasModule\(requiredModule\)/);
});

test('clients only see individually subscribed agents', () => {
  assert.match(page, /enabledModules\.has\(`ai_agent:\$\{agent\.id\}`\)/);
  assert.match(page, /Aucun agent IA n’est actuellement inclus dans votre abonnement/);
  assert.match(page, /!isClient && <div/);
});

test('Base44 workspace key never reaches the browser', () => {
  assert.doesNotMatch(page, /VITE_BASE44_API_KEY|WORKSPACE_API_KEY|api_key/);
  assert.match(page, /fetch\(`\/api\/agents\/\$\{agent\.id\}\/conversations`/);
  const keyName = ['BASE44', 'API', 'KEY'].join('_');
  assert.ok(server.includes(`const ${keyName} = process.env.${keyName} || '';`));
});

test('server enforces the purchased agent on every Base44 request', () => {
  assert.match(server, /router\.use\(requireSession\('client'\)\)/);
  assert.match(server, /clientCanUseAgent/);
  assert.match(server, /module_code=eq\.\$\{encodeURIComponent\(code\)\}/);
  assert.match(server, /requireAgentAccess/);
  assert.match(server, /Agent non inclus dans votre abonnement/);
  assert.match(appServer, /app\.use\('\/api\/agents', agentsRouter\)/);
});

