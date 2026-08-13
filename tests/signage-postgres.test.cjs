const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adapter = fs.readFileSync(path.join(root, 'server-postgres.cjs'), 'utf8');
const commerce = fs.readFileSync(path.join(root, 'server-commerce.cjs'), 'utf8');
const signage = fs.readFileSync(path.join(root, 'server-signage.cjs'), 'utf8');

test('PostgreSQL staging uses DATABASE_URL and an advisory migration lock', () => {
  assert.match(adapter, /process\.env\.DATABASE_URL/);
  assert.match(adapter, /pg_advisory_lock/);
  assert.match(adapter, /pilot_schema_migrations/);
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
