const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const targetsSource = read('server-publisya-targets.cjs');
const reviewSource = read('server-publisya-review.cjs');
const oauthSource = read('server-publisya-oauth.cjs');
const clientSource = read('src', 'lib', 'publisyaClient.js');
const connectionsSource = read('src', 'components', 'publisya', 'PublisyaConnections.jsx');
const dockerSource = read('Dockerfile');

const {
  LINKEDIN_VERSION_RE,
  tokenAlreadyExpired,
  linkedInOrganizationUrn,
} = require('../server-publisya-targets.cjs');

test('target verification is a manually triggered GET and remains read-only', () => {
  assert.match(targetsSource, /router\.get\('\/accounts\/:accountId'/);
  assert.match(clientSource, /verifyPublisyaTargets/);
  assert.match(clientSource, /\/targets\/accounts\//);
  assert.match(connectionsSource, /Vérifier les cibles/);
  assert.match(connectionsSource, /verifyPublisyaTargets\(account\.id\)/);
  assert.doesNotMatch(targetsSource, /router\.(post|put|patch|delete)\(/);
  assert.doesNotMatch(targetsSource, /publisya_publication_jobs/);
  assert.match(targetsSource, /publish_ready: false/);
  assert.match(targetsSource, /publishing_enabled: false/);
});

test('target account lookup is tenant and client scoped before token decryption', () => {
  assert.match(targetsSource, /resolveTenant\(req\)/);
  assert.match(targetsSource, /tenant_id=eq\.\$\{encodeURIComponent\(tenantId\)\}/);
  assert.match(targetsSource, /client_id=eq\.\$\{encodeURIComponent\(clientId\)\}/);
  assert.match(targetsSource, /connection_status=eq\.connected/);
  assert.match(targetsSource, /tokenVault\.decrypt/);
  assert.match(targetsSource, /:\$\{account\.provider\}:\$\{account\.provider_account_id\}:access/);
});

test('TikTok and YouTube identity verification uses read-only official profile endpoints', () => {
  assert.match(targetsSource, /https:\/\/open\.tiktokapis\.com\/v2\/user\/info\/\?fields=open_id,display_name/);
  assert.match(targetsSource, /https:\/\/www\.googleapis\.com\/youtube\/v3\/channels\?part=id,snippet&mine=true&maxResults=1/);
  assert.match(targetsSource, /String\(user\.open_id\) !== String\(account\.provider_account_id\)/);
  assert.match(targetsSource, /String\(channel\.id\) !== String\(account\.provider_account_id\)/);
});

test('LinkedIn organization discovery is version-gated and never equated with publish permission', () => {
  assert.equal(LINKEDIN_VERSION_RE.test('202609'), true);
  assert.equal(LINKEDIN_VERSION_RE.test('v202609'), false);
  assert.match(targetsSource, /PUBLISYA_LINKEDIN_VERSION/);
  assert.match(targetsSource, /https:\/\/api\.linkedin\.com\/rest\/organizationAcls\?q=roleAssignee&state=APPROVED/);
  assert.match(targetsSource, /X-Restli-Protocol-Version': '2\.0\.0'/);
  assert.match(targetsSource, /Linkedin-Version': version/);
  assert.match(targetsSource, /permission_verified: false/);
  assert.match(targetsSource, /Une autorisation de publication devra encore être vérifiée avant tout envoi/);
});

test('Meta target discovery remains fail-closed instead of guessing Page or Instagram bindings', () => {
  assert.match(targetsSource, /La sélection Page Facebook \/ compte Instagram professionnel reste volontairement verrouillée/);
  assert.doesNotMatch(targetsSource, /\/me\/accounts/);
  assert.match(oauthSource, /PUBLISYA_META_GRAPH_VERSION/);
  assert.match(oauthSource, /direct_publish: false/);
});

test('expired access tokens are reported without automatic refresh in target verification', () => {
  assert.equal(tokenAlreadyExpired({ token_expires_at: new Date(Date.now() - 60_000).toISOString() }), true);
  assert.equal(tokenAlreadyExpired({ token_expires_at: new Date(Date.now() + 60_000).toISOString() }), false);
  assert.equal(tokenAlreadyExpired({ token_expires_at: null }), false);
  assert.match(targetsSource, /Aucun rafraîchissement automatique n’est activé dans ce lot/);
});

test('LinkedIn organization URNs are normalized without inventing names', () => {
  assert.equal(linkedInOrganizationUrn({ organizationTarget: 'urn:li:organization:123' }), 'urn:li:organization:123');
  assert.equal(linkedInOrganizationUrn({ organization: 'urn:li:organization:456' }), 'urn:li:organization:456');
  assert.equal(linkedInOrganizationUrn({}), '');
});

test('OAuth callback notice keeps only bounded internal status and clears it from the browser URL', () => {
  assert.match(connectionsSource, /safeOAuthNotice/);
  assert.match(connectionsSource, /\^\[A-Z0-9_\]\{1,80\}\$/);
  assert.match(connectionsSource, /clearOAuthQuery/);
  assert.match(connectionsSource, /window\.history\.replaceState/);
  assert.match(connectionsSource, /oauth_status/);
  assert.doesNotMatch(connectionsSource, /access_token|refresh_token|token_ciphertext/);
});

test('target verification is mounted under the protected Publisya router and packaged in Docker', () => {
  assert.match(reviewSource, /router\.use\('\/targets', publisyaTargets\.router\)/);
  assert.match(reviewSource, /require\('\.\/server-publisya-targets\.cjs'\)/);
  assert.match(dockerSource, /COPY --from=builder \/app\/server-publisya-targets\.cjs \.\/server-publisya-targets\.cjs/);
  assert.match(dockerSource, /test -f \/app\/server-publisya-targets\.cjs/);
  assert.match(dockerSource, /node --check \/app\/server-publisya-targets\.cjs/);
});
