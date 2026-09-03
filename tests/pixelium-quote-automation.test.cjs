const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Pixelium migration protects Julien P attribution and idempotent requests', () => {
  const sql = read('migrations/012_pixelium_quote_automation.sql');
  assert.match(sql, /VALUES \('JP', 'Julien P\.', NULL/);
  assert.match(sql, /"protected":true/);
  assert.match(sql, /external_id text NOT NULL UNIQUE/);
  assert.match(sql, /pixelium_commissions/);
  assert.match(sql, /pixelium_email_jobs/);
});

test('Pixelium requests schedule the quote 35 minutes later and use persistent jobs', () => {
  const server = read('server-pixelium.cjs');
  assert.match(server, /QUOTE_DELAY_MINUTES = 35/);
  assert.match(server, /QUOTE_DELAY_MINUTES \* 60_000/);
  assert.match(server, /'confirmation','pending',now\(\)/);
  assert.match(server, /'quote','pending'/);
  assert.match(server, /for update of j skip locked/i);
});

test('Pixelium quote autosend is blocked until explicit pricing and mailbox configuration', () => {
  const server = read('server-pixelium.cjs');
  assert.match(server, /PIXELIUM_QUOTE_AUTOSEND_ENABLED/);
  assert.match(server, /PIXELIUM_PRICE_MONTHLY_CENTS/);
  assert.match(server, /PIXELIUM_PRICE_ANNUAL_CENTS/);
  assert.match(server, /PIXELIUM_PRICE_TAX_MODE/);
  assert.match(server, /PIXELIUM_EMAIL_ADDRESS/);
  assert.match(server, /PIXELIUM_EMAIL_PASSWORD/);
  assert.match(server, /Configuration e-mail Pixelium manquante/);
  assert.match(server, /Tarification Pixelium incomplète/);
});

test('Pixelium request endpoint is protected server-to-server and mounted in cockpit', () => {
  const pixelium = read('server-pixelium.cjs');
  const main = read('server.cjs');
  assert.match(pixelium, /x-commerce-key/);
  assert.match(pixelium, /COMMERCE_BRIDGE_KEY/);
  assert.match(main, /app\.use\('\/api\/pixelium', pixeliumRouter\)/);
});

test('migration 012 is part of cockpit startup migrations', () => {
  const postgres = read('server-postgres.cjs');
  assert.match(postgres, /012_pixelium_quote_automation\.sql/);
});
