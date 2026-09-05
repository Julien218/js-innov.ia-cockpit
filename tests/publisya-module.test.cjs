const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'src', 'pages', 'Publisya.jsx'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'src', 'components', 'layout', 'Sidebar.jsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const dockerSource = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const migrationSource = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260905141500_publisya_foundation.sql'), 'utf8');

async function loadRoles() {
  return import(pathToFileURL(path.join(root, 'src', 'lib', 'roles.js')).href);
}

test('Publisya is an opt-in product application', async () => {
  const { hasRouteAccess } = await loadRoles();
  assert.equal(hasRouteAccess('superadmin', '/publisya', []), true);
  assert.equal(hasRouteAccess('admin', '/publisya', []), false);
  assert.equal(hasRouteAccess('client', '/publisya', []), false);
  assert.equal(hasRouteAccess('admin', '/publisya', ['publisya']), true);
  assert.equal(hasRouteAccess('collaborateur', '/publisya', ['publisya']), true);
  assert.equal(hasRouteAccess('client', '/publisya', ['publisya']), true);
  assert.match(sidebarSource, /label: "Applications produits"/);
  assert.match(sidebarSource, /label: "Publisya"/);
  assert.match(appSource, /path="\/publisya"/);
  assert.match(appSource, /canAccess\('\/publisya'\)/);
});

test('Publisya foundation keeps external publishing disabled', () => {
  assert.match(pageSource, /Publication réelle désactivée au Lot 1/);
  assert.match(serverSource, /requirePermission\('publisya', 'client'\)/);
  assert.match(dockerSource, /server-publisya\.cjs/);

  const { PROVIDERS, startPublisyaScheduler } = require('../server-publisya.cjs');
  assert.deepEqual(PROVIDERS.map(provider => provider.id), ['facebook', 'instagram', 'tiktok', 'linkedin', 'youtube']);
  const worker = startPublisyaScheduler();
  assert.equal(worker.started, false);
});

test('Publisya schema requires tenant ownership and idempotent publication jobs', () => {
  assert.match(migrationSource, /public\.publisya_campaigns/);
  assert.match(migrationSource, /tenant_id TEXT NOT NULL/);
  assert.match(migrationSource, /client_id TEXT NOT NULL/);
  assert.match(migrationSource, /human_approval_required BOOLEAN NOT NULL DEFAULT true/);
  assert.match(migrationSource, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(migrationSource, /REVOKE ALL ON TABLE public\.publisya_campaigns FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migrationSource, /CREATE SCHEMA IF NOT EXISTS publisya/);
});
