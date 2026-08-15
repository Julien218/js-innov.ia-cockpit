const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adapter = fs.readFileSync(path.join(root, 'server-postgres.cjs'), 'utf8');
const commerce = fs.readFileSync(path.join(root, 'server-commerce.cjs'), 'utf8');
const signage = fs.readFileSync(path.join(root, 'server-signage.cjs'), 'utf8');
const signagePage = fs.readFileSync(path.join(root, 'src', 'pages', 'DigitalSignage.jsx'), 'utf8');
const androidPlayer = fs.readFileSync(path.join(root, 'player-android', 'app', 'src', 'main', 'java', 'ia', 'jsinnov', 'pixeliumplayer', 'MainActivity.java'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

test('PostgreSQL staging uses DATABASE_URL and an advisory migration lock', () => {
  assert.match(adapter, /process\.env\.DATABASE_URL/);
  assert.match(adapter, /pg_advisory_lock/);
  assert.match(adapter, /pilot_schema_migrations/);
  assert.match(adapter, /004_pilot_sponsorship\.sql/);
  assert.match(adapter, /PILOT_GRANT_EMAIL/);
  assert.match(adapter, /PILOT_USAGE_BILLING_ACCOUNT/);
});

test('pilot grants are free while usage is assigned to a billing account', () => {
  assert.match(commerce, /router\.post\('\/pilot-grant'/);
  assert.match(commerce, /grant_reason: 'pilot_gift'/);
  assert.match(commerce, /recurring_fee_cents: 0/);
  assert.match(commerce, /usage_billing_enabled: true/);
});

test('only pilot tables are accepted by the REST compatibility adapter', () => {
  assert.match(adapter, /ALLOWED_TABLES/);
  assert.match(adapter, /Table non autorisee/);
  assert.match(adapter, /PATCH sans filtre refuse/);
});

test('PostgreSQL adapter serializes every Signage JSONB column explicitly', () => {
  assert.match(adapter, /const JSON_COLUMNS = new Map/);
  for (const column of ['diagnostics', 'rendition', 'items', 'manifest']) {
    assert.match(adapter, new RegExp(`['"]${column}['"]`));
  }
  assert.match(adapter, /JSON\.stringify\(value\)/);
  assert.match(adapter, /postgresValue\(table,c,row\[c\]\)/);
  assert.match(adapter, /postgresValue\(table,k,v\)/);
});

test('commerce and signage prefer Railway PostgreSQL when configured', () => {
  assert.match(commerce, /if \(process\.env\.DATABASE_URL\) return postgresRest/);
  assert.match(signage, /if \(process\.env\.DATABASE_URL\) return postgresRest/);
});

test('production image contains the SQL migrations used at startup', () => {
  assert.match(dockerfile, /COPY --from=builder \/app\/migrations \.\/migrations/);
});

test('signage uses the configured Dropbox root and temporary Player links', () => {
  assert.match(signage, /DROPBOX_ROOT_PATH/);
  assert.match(signage, /get_temporary_upload_link/);
  assert.match(signage, /get_temporary_link/);
  assert.match(signage, /expiresIn:14400/);
  assert.match(signage, /DROPBOX_REFRESH_TOKEN/);
  assert.match(signage, /grant_type: 'refresh_token'/);
  assert.match(signage, /dropboxTokenCache/);
});

test('offline players can rotate to an easy-to-enter secure token', () => {
  assert.match(signage, /randomBytes\(12\).*toString\('hex'\).*toUpperCase/);
  assert.match(signage, /\/manage\/players\/:id\/rotate-token/);
  assert.match(signagePage, /Générer un nouveau jeton/);
});

test('Android validates a token before persisting it or opening the player', () => {
  assert.match(signage, /\/player\/verify/);
  assert.match(androidPlayer, /\/api\/signage\/player\/verify/);
  assert.match(androidPlayer, /Vérifier et associer ce Player/);
  assert.match(androidPlayer, /HTTP 401/);
});

test('signage page reports non-JSON responses without exposing parser errors', () => {
  assert.match(signagePage, /content-type/);
  assert.match(signagePage, /Le service du cockpit est momentanément indisponible/);
  assert.doesNotMatch(signagePage, /await response\.json\(\)/);
});

test('Dropbox media upload handles non-JSON failures and proxies binary through the cockpit', () => {
  assert.match(signage, /async function dropboxJson/);
  assert.match(signage, /const raw = await response\.text\(\)/);
  assert.match(signage, /réponse non JSON/);
  assert.match(signage, /La connexion Dropbox du cockpit doit être renouvelée/);
  assert.match(signage, /api\.dropboxapi\.com\/2\/files\/get_temporary_upload_link/);
  assert.doesNotMatch(signage, /content\.dropboxapi\.com\/2\/files\/get_temporary_upload_link/);
  assert.match(signage, /content\.dropboxapi\.com\/2\/files\/upload/);
  assert.match(signage, /express\.raw\(\{type:'application\/octet-stream',limit:MAX_MEDIA_BYTES\}\)/);
  assert.match(signage, /Le média dépasse la limite de 150 Mo/);
  assert.match(signagePage, /\/manage\/media\/upload\?name=/);
  assert.doesNotMatch(signagePage, /session\.uploadUrl/);
  assert.match(signagePage, /setRequestHeader\("Content-Type", "application\/octet-stream"\)/);
  assert.doesNotMatch(signagePage, /Dropbox-API-Arg/);
  assert.match(dockerfile, /client_max_body_size 150m/);
});

test('signage cockpit exposes upload progress and a durable completion state', () => {
  assert.match(signagePage, /new XMLHttpRequest\(\)/);
  assert.match(signagePage, /xhr\.upload\.onprogress/);
  assert.match(signagePage, /role="progressbar"/);
  assert.match(signagePage, /Transfert vers Dropbox et indexation/);
  assert.match(signagePage, /Téléchargement terminé et média indexé/);
  assert.match(signagePage, /aria-valuenow=\{transfer\.percent\}/);
});

