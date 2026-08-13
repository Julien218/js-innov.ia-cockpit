const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adapter = fs.readFileSync(path.join(root, 'server-postgres.cjs'), 'utf8');
const commerce = fs.readFileSync(path.join(root, 'server-commerce.cjs'), 'utf8');
const signage = fs.readFileSync(path.join(root, 'server-signage.cjs'), 'utf8');
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
});

