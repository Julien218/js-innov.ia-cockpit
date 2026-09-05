const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const appSource = read('src', 'App.jsx');
const pageSource = read('src', 'pages', 'Publisya.jsx');
const wizardSource = read('src', 'components', 'publisya', 'CampaignWizard.jsx');
const reviewUiSource = read('src', 'components', 'publisya', 'CampaignReview.jsx');
const clientSource = read('src', 'lib', 'publisyaClient.js');
const sidebarSource = read('src', 'components', 'layout', 'Sidebar.jsx');
const serverSource = read('server.cjs');
const publisyaServerSource = read('server-publisya.cjs');
const publisyaAiSource = read('server-publisya-ai.cjs');
const publisyaReviewSource = read('server-publisya-review.cjs');
const dockerSource = read('Dockerfile');
const migrationSource = read('supabase', 'migrations', '20260905141500_publisya_foundation.sql');

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
  assert.match(publisyaServerSource, /publishing_enabled: false/);
  assert.match(publisyaServerSource, /direct_publish: false/);
  assert.match(publisyaReviewSource, /publishing_enabled: false/);
  assert.doesNotMatch(publisyaReviewSource, /publisya_publication_jobs/);

  const { PROVIDERS, startPublisyaScheduler } = require('../server-publisya.cjs');
  assert.deepEqual(PROVIDERS.map((provider) => provider.id), ['facebook', 'instagram', 'tiktok', 'linkedin', 'youtube']);
  assert.equal(startPublisyaScheduler().started, false);
});

test('campaign access is tenant-scoped server-side', () => {
  assert.match(publisyaServerSource, /resolveTenant\(req\)/);
  assert.match(publisyaServerSource, /tenant_id=eq\.\$\{encodeURIComponent\(tenantId\)\}/);
  assert.match(publisyaServerSource, /client_id=eq\.\$\{encodeURIComponent\(clientId\)\}/);
  assert.match(publisyaReviewSource, /resolveTenant\(req\)/);
  assert.match(publisyaReviewSource, /tenant_id=eq\.\$\{encodeURIComponent\(tenantId\)\}/);
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

test('AI analysis minimizes source data and forces structured non-stored output', () => {
  assert.match(publisyaAiSource, /store: false/);
  assert.match(publisyaAiSource, /type: 'json_schema'/);
  assert.match(publisyaAiSource, /strict: true/);
  assert.match(publisyaAiSource, /type: 'input_image'/);
  assert.match(publisyaAiSource, /detail: 'low'/);
  assert.match(publisyaAiSource, /gpt-4o-mini-transcribe/);
  assert.match(publisyaAiSource, /authorizeUsage/);
  assert.match(publisyaAiSource, /recordUsage/);
  assert.match(publisyaAiSource, /risk_flags/);
  assert.match(publisyaServerSource, /status: 'awaiting_approval'/);
});

test('human review edits variants independently and approval never publishes', () => {
  assert.match(publisyaReviewSource, /router\.patch\('\/campaigns\/:campaignId\/variants\/:variantId'/);
  assert.match(publisyaReviewSource, /router\.post\('\/campaigns\/:campaignId\/request-changes'/);
  assert.match(publisyaReviewSource, /router\.post\('\/campaigns\/:campaignId\/approve'/);
  assert.match(publisyaReviewSource, /variant_snapshot: variant/);
  assert.match(publisyaReviewSource, /status: 'approved'/);
  assert.match(reviewUiSource, /Facebook/);
  assert.match(reviewUiSource, /Instagram/);
  assert.match(reviewUiSource, /TikTok/);
  assert.match(reviewUiSource, /LinkedIn/);
  assert.match(reviewUiSource, /YouTube/);
  assert.match(reviewUiSource, /Cela ne publie rien/);
  assert.match(clientSource, /approvePublisyaCampaign/);
  assert.match(clientSource, /requestPublisyaChanges/);
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

test('Docker runtime contains every Publisya server module', () => {
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya\.cjs \.\/server-publisya\.cjs/);
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya-ai\.cjs \.\/server-publisya-ai\.cjs/);
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya-review\.cjs \.\/server-publisya-review\.cjs/);
  assert.match(dockerSource, /node --check \/app\/server-publisya-review\.cjs/);
});
