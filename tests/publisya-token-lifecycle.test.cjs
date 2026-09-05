const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const lifecycleSource = read('server-publisya-token-lifecycle.cjs');
const reviewSource = read('server-publisya-review.cjs');
const clientSource = read('src', 'lib', 'publisyaClient.js');
const connectionsSource = read('src', 'components', 'publisya', 'PublisyaConnections.jsx');
const dockerSource = read('Dockerfile');

const {
  refreshConfig,
  expiresAt,
  refreshExpirySeconds,
  safeRefreshAccount,
} = require('../server-publisya-token-lifecycle.cjs');

test('manual refresh supports only explicitly configured providers and keeps Meta fail-closed', () => {
  assert.equal(refreshConfig('tiktok').endpoint, 'https://open.tiktokapis.com/v2/oauth/token/');
  assert.equal(refreshConfig('tiktok').clientIdParam, 'client_key');
  assert.equal(refreshConfig('youtube').endpoint, 'https://oauth2.googleapis.com/token');
  assert.equal(refreshConfig('linkedin').endpoint, 'https://www.linkedin.com/oauth/v2/accessToken');
  assert.equal(refreshConfig('meta'), null);
  assert.equal(refreshConfig('facebook'), null);
  assert.match(lifecycleSource, /PUBLISYA_REFRESH_UNSUPPORTED_PROVIDER/);
});

test('refresh endpoint is explicit, same-session and never automatic', () => {
  assert.match(lifecycleSource, /router\.post\('\/accounts\/:accountId\/refresh'/);
  assert.match(reviewSource, /router\.use\('\/tokens', publisyaTokenLifecycle\.router\)/);
  assert.match(clientSource, /refreshPublisyaAccount/);
  assert.match(clientSource, /\/tokens\/accounts\/\$\{encodeURIComponent\(accountId\)\}\/refresh/);
  assert.match(connectionsSource, /Renouveler l’accès/);
  assert.match(connectionsSource, /Renouvellement manuel\. Aucun cron ni rafraîchissement automatique/);
  assert.doesNotMatch(lifecycleSource, /setInterval|setTimeout\([^,]+,\s*60_000|cron|scheduler/i);
  assert.match(lifecycleSource, /automatic_refresh_enabled: false/);
  assert.match(lifecycleSource, /manual_refresh_only: true/);
  assert.match(lifecycleSource, /publishing_enabled: false/);
  assert.doesNotMatch(lifecycleSource, /publisya_publication_jobs/);
});

test('token refresh is tenant-scoped before encrypted refresh token access', () => {
  assert.match(lifecycleSource, /resolveTenant\(req\)/);
  assert.match(lifecycleSource, /tenant_id=eq\.\$\{encodeURIComponent\(tenantId\)\}/);
  assert.match(lifecycleSource, /client_id=eq\.\$\{encodeURIComponent\(clientId\)\}/);
  assert.match(lifecycleSource, /refresh_token_ciphertext/);
  assert.match(lifecycleSource, /tokenVault\.decrypt\(account\.refresh_token_ciphertext, refreshAad\(account\)\)/);
  assert.match(lifecycleSource, /:\$\{account\.provider\}:\$\{account\.provider_account_id\}:refresh/);
});

test('provider refresh requests are form encoded and never log tokens', () => {
  assert.match(lifecycleSource, /grant_type: 'refresh_token'/);
  assert.match(lifecycleSource, /refresh_token: refreshToken/);
  assert.match(lifecycleSource, /Content-Type': 'application\/x-www-form-urlencoded'/);
  assert.doesNotMatch(lifecycleSource, /console\.(log|error)\([^\n]*(access_token|refreshToken|refresh_token|clientSecret)/);
});

test('refreshed identity is verified before the new encrypted credentials are persisted', () => {
  assert.match(lifecycleSource, /async function verifyRefreshedIdentity/);
  assert.match(lifecycleSource, /open\.tiktokapis\.com\/v2\/user\/info\/\?fields=open_id/);
  assert.match(lifecycleSource, /youtube\/v3\/channels\?part=id&mine=true&maxResults=1/);
  assert.match(lifecycleSource, /verifyLinkedInIdentity\(account, accessToken\)/);
  const verifyIndex = lifecycleSource.indexOf('const identityMatches = await verifyRefreshedIdentity');
  const persistIndex = lifecycleSource.indexOf('return persistRefresh(account, tokenBody, refreshToken)', verifyIndex);
  assert.ok(verifyIndex >= 0 && persistIndex > verifyIndex, 'identity verification must happen before persistence');
  assert.match(lifecycleSource, /PUBLISYA_REFRESH_IDENTITY_MISMATCH/);
});

test('rotating refresh tokens replace the old encrypted value while stable ones are preserved', () => {
  assert.match(lifecycleSource, /tokenBody\.refresh_token \|\| previousRefreshToken/);
  assert.match(lifecycleSource, /refresh_token_rotated: Boolean\(tokenBody\.refresh_token && tokenBody\.refresh_token !== previousRefreshToken\)/);
  assert.match(lifecycleSource, /refresh_token_ciphertext: tokenVault\.encrypt\(newRefreshToken, refreshAad\(account\)\)/);
  assert.match(lifecycleSource, /token_ciphertext: tokenVault\.encrypt\(tokenBody\.access_token, accessAad\(account\)\)/);
});

test('expiry helpers preserve provider refresh expiry without inventing values', () => {
  const base = Date.parse('2026-09-05T12:00:00Z');
  assert.equal(expiresAt(3600, base), '2026-09-05T13:00:00.000Z');
  assert.equal(expiresAt(null, base), null);
  assert.equal(refreshExpirySeconds({ refresh_expires_in: 123 }), 123);
  assert.equal(refreshExpirySeconds({ refresh_token_expires_in: 456 }), 456);
  assert.equal(refreshExpirySeconds({}), null);
});

test('only invalid_grant marks a connection as requiring reauthorization', () => {
  assert.match(lifecycleSource, /error\.providerCode === 'invalid_grant'/);
  assert.doesNotMatch(lifecycleSource, /\['invalid_grant', 'invalid_request'\]/);
  assert.match(lifecycleSource, /connection_status: 'reconnect_required'/);
});

test('concurrent refreshes for the same tenant account are refused', () => {
  assert.match(lifecycleSource, /const refreshInFlight = new Map\(\)/);
  assert.match(lifecycleSource, /const lockKey = `\$\{tenantId\}:\$\{clientId\}:\$\{accountId\}`/);
  assert.match(lifecycleSource, /refreshInFlight\.has\(lockKey\)/);
  assert.match(lifecycleSource, /PUBLISYA_REFRESH_ALREADY_RUNNING/);
  assert.match(lifecycleSource, /refreshInFlight\.delete\(lockKey\)/);
});

test('safe refresh response excludes encrypted and raw credentials', () => {
  const safe = safeRefreshAccount({
    id: 'a',
    provider: 'youtube',
    provider_account_id: 'channel',
    account_name: 'Channel',
    connection_status: 'connected',
    scopes: ['scope-a'],
    token_expires_at: '2026-09-05T13:00:00Z',
    last_verified_at: '2026-09-05T12:00:00Z',
    token_ciphertext: 'SECRET_ACCESS',
    refresh_token_ciphertext: 'SECRET_REFRESH',
    metadata: { refresh_token_present: true, refresh_expires_at: null },
  });
  assert.equal(safe.token_ciphertext, undefined);
  assert.equal(safe.refresh_token_ciphertext, undefined);
  assert.equal(JSON.stringify(safe).includes('SECRET_ACCESS'), false);
  assert.equal(JSON.stringify(safe).includes('SECRET_REFRESH'), false);
  assert.match(lifecycleSource, /account: safeRefreshAccount\(account\)/);
});

test('frontend offers refresh only when a refresh token exists and never for Meta', () => {
  assert.match(connectionsSource, /account\.provider !== 'meta' && account\.metadata\?\.refresh_token_present/);
  assert.match(connectionsSource, /refreshPublisyaAccount\(account\.id\)/);
  assert.doesNotMatch(connectionsSource, /refresh_token_ciphertext|token_ciphertext/);
});

test('Docker runtime packages and syntax checks token lifecycle', () => {
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya-token-lifecycle\.cjs \.\/server-publisya-token-lifecycle\.cjs/);
  assert.match(dockerSource, /test -f \/app\/server-publisya-token-lifecycle\.cjs/);
  assert.match(dockerSource, /node --check \/app\/server-publisya-token-lifecycle\.cjs/);
});
