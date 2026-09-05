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
const connectionsUiSource = read('src', 'components', 'publisya', 'PublisyaConnections.jsx');
const clientSource = read('src', 'lib', 'publisyaClient.js');
const sidebarSource = read('src', 'components', 'layout', 'Sidebar.jsx');
const serverSource = read('server.cjs');
const publisyaServerSource = read('server-publisya.cjs');
const publisyaAiSource = read('server-publisya-ai.cjs');
const publisyaReviewSource = read('server-publisya-review.cjs');
const publisyaOauthSource = read('server-publisya-oauth.cjs');
const publisyaVaultSource = read('server-publisya-token-vault.cjs');
const dockerSource = read('Dockerfile');
const migrationSource = read('supabase', 'migrations', '20260905141500_publisya_foundation.sql');
const oauthMigrationSource = read('supabase', 'migrations', '20260905170000_publisya_oauth_foundation.sql');

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

test('Publisya keeps all external publishing disabled during OAuth foundation', () => {
  assert.match(pageSource, /Publication réelle toujours désactivée/);
  assert.match(serverSource, /requirePermission\('publisya', 'client'\)/);
  assert.match(publisyaServerSource, /publishing_enabled: false/);
  assert.match(publisyaServerSource, /direct_publish: false/);
  assert.match(publisyaReviewSource, /publishing_enabled: false/);
  assert.match(publisyaOauthSource, /publishing_enabled: false/);
  assert.match(publisyaOauthSource, /scheduling_enabled: false/);
  assert.doesNotMatch(publisyaReviewSource, /publisya_publication_jobs/);
  assert.doesNotMatch(publisyaOauthSource, /publisya_publication_jobs/);

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

test('OAuth token vault uses authenticated encryption bound to tenant and account', () => {
  const previous = process.env.PUBLISYA_TOKEN_ENCRYPTION_KEY;
  process.env.PUBLISYA_TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);
  const vault = require('../server-publisya-token-vault.cjs');
  const aad = 'tenant-a:tenant-a:tiktok:user-1:access';
  const ciphertext = vault.encrypt('secret-access-token', aad);
  assert.match(ciphertext, /^v1\./);
  assert.doesNotMatch(ciphertext, /secret-access-token/);
  assert.equal(vault.decrypt(ciphertext, aad), 'secret-access-token');
  assert.throws(() => vault.decrypt(ciphertext, 'tenant-b:tenant-b:tiktok:user-1:access'));
  if (previous === undefined) delete process.env.PUBLISYA_TOKEN_ENCRYPTION_KEY;
  else process.env.PUBLISYA_TOKEN_ENCRYPTION_KEY = previous;
  assert.match(publisyaVaultSource, /aes-256-gcm/);
  assert.match(publisyaVaultSource, /cipher\.setAAD/);
});

test('OAuth connectors use official code flows and Meta fails closed without an explicit Graph version', () => {
  const { providerConfig, providerConfigured, PROVIDER_IDS } = require('../server-publisya-oauth.cjs');
  assert.deepEqual(PROVIDER_IDS, ['meta', 'tiktok', 'linkedin', 'youtube']);
  assert.equal(providerConfig('tiktok').authorizeUrl, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(providerConfig('tiktok').tokenUrl, 'https://open.tiktokapis.com/v2/oauth/token/');
  assert.equal(providerConfig('linkedin').authorizeUrl, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(providerConfig('linkedin').tokenUrl, 'https://www.linkedin.com/oauth/v2/accessToken');
  assert.equal(providerConfig('youtube').authorizeUrl, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(providerConfig('youtube').tokenUrl, 'https://oauth2.googleapis.com/token');
  assert.equal(providerConfigured(providerConfig('meta')), false);
  assert.match(publisyaOauthSource, /PUBLISYA_META_GRAPH_VERSION/);
  assert.match(publisyaOauthSource, /validMetaVersion/);
  assert.match(publisyaOauthSource, /client_secret/);
  assert.match(publisyaOauthSource, /application\/x-www-form-urlencoded/);
});

test('OAuth state is hashed, tenant-scoped, expiring and single-use', () => {
  assert.match(oauthMigrationSource, /state_hash TEXT PRIMARY KEY/);
  assert.match(oauthMigrationSource, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(oauthMigrationSource, /used_at TIMESTAMPTZ/);
  assert.match(oauthMigrationSource, /REVOKE ALL ON TABLE public\.publisya_oauth_states FROM PUBLIC, anon, authenticated/);
  assert.match(publisyaOauthSource, /stateHash\(state\)/);
  assert.match(publisyaOauthSource, /used_at=is\.null/);
  assert.match(publisyaOauthSource, /expires_at=gt/);
  assert.match(publisyaOauthSource, /tenant_id=eq\.\$\{encodeURIComponent\(tenantId\)\}/);
  assert.match(publisyaOauthSource, /client_id=eq\.\$\{encodeURIComponent\(clientId\)\}/);
  assert.match(publisyaReviewSource, /router\.use\('\/oauth', publisyaOAuth\.router\)/);
});

test('frontend can manage connections but never receives OAuth ciphertext or client secrets', () => {
  assert.match(pageSource, /PublisyaConnections/);
  assert.match(connectionsUiSource, /Aucun mot de passe social/);
  assert.match(connectionsUiSource, /Jetons chiffrés côté serveur/);
  assert.match(clientSource, /getPublisyaConnections/);
  assert.match(clientSource, /connectPublisyaProvider/);
  assert.match(clientSource, /disconnectPublisyaAccount/);
  assert.doesNotMatch(clientSource, /token_ciphertext|refresh_token_ciphertext|CLIENT_SECRET|APP_SECRET/);
  assert.doesNotMatch(connectionsUiSource, /token_ciphertext|refresh_token_ciphertext|CLIENT_SECRET|APP_SECRET/);
  assert.match(publisyaOauthSource, /provider_revocation_required: true/);
  assert.match(publisyaOauthSource, /provider_revoked: false/);
});

test('Docker runtime contains every Publisya server module', () => {
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya\.cjs \.\/server-publisya\.cjs/);
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya-ai\.cjs \.\/server-publisya-ai\.cjs/);
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya-review\.cjs \.\/server-publisya-review\.cjs/);
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya-oauth\.cjs \.\/server-publisya-oauth\.cjs/);
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya-token-vault\.cjs \.\/server-publisya-token-vault\.cjs/);
  assert.match(dockerSource, /node --check \/app\/server-publisya-oauth\.cjs/);
  assert.match(dockerSource, /node --check \/app\/server-publisya-token-vault\.cjs/);
});
