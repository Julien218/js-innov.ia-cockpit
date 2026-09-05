const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'src', 'pages', 'Publisya.jsx'), 'utf8');
const wizardSource = fs.readFileSync(path.join(root, 'src', 'components', 'publisya', 'CampaignWizard.jsx'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'src', 'lib', 'publisyaClient.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'src', 'components', 'layout', 'Sidebar.jsx'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const publisyaServerSource = fs.readFileSync(path.join(root, 'server-publisya.cjs'), 'utf8');
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

test('Publisya keeps all external publishing disabled during Lot 2', () => {
  assert.match(pageSource, /Publication réelle désactivée au Lot 2/);
  assert.match(serverSource, /requirePermission\('publisya', 'client'\)/);
  assert.match(dockerSource, /server-publisya\.cjs/);

  const { PROVIDERS, startPublisyaScheduler } = require('../server-publisya.cjs');
  assert.deepEqual(PROVIDERS.map(provider => provider.id), ['facebook', 'instagram', 'tiktok', 'linkedin', 'youtube']);
  const worker = startPublisyaScheduler();
  assert.equal(worker.started, false);
  assert.match(publisyaServerSource, /publishing_enabled: false/);
  assert.match(publisyaServerSource, /direct_publish: false/);
});

test('campaign access is tenant-scoped server-side', () => {
  assert.match(publisyaServerSource, /resolveTenant\(req\)/);
  assert.match(publisyaServerSource, /tenant_id=eq\.\$\{encodeURIComponent\(tenantId\)\}/);
  assert.match(publisyaServerSource, /client_id=eq\.\$\{encodeURIComponent\(clientId\)\}/);
  assert.match(publisyaServerSource, /human_approval_required: true/);
  assert.match(publisyaServerSource, /status: 'draft'/);
});

test('media upload is streamed instead of buffered in Railway memory', () => {
  const { MAX_MEDIA_BYTES } = require('../server-publisya.cjs');
  assert.equal(MAX_MEDIA_BYTES, 140 * 1024 * 1024);
  assert.match(publisyaServerSource, /req\.pipe\(meter\)/);
  assert.match(publisyaServerSource, /createHash\('sha256'\)/);
  assert.doesNotMatch(publisyaServerSource, /express\.raw/);
  assert.match(wizardSource, /MAX_FILE_BYTES = 140 \* 1024 \* 1024/);
  assert.match(clientSource, /Content-Type': 'application\/octet-stream'/);
});

test('platform input is allowlisted and deduplicated', () => {
  const { normalizePlatforms } = require('../server-publisya.cjs');
  assert.deepEqual(normalizePlatforms(['facebook', 'youtube', 'facebook', 'invalid']), ['facebook', 'youtube']);
  assert.deepEqual(normalizePlatforms('facebook'), []);
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
