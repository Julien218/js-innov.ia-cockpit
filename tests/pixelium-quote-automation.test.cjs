const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Pixelium migration protects Julien P attribution and idempotent requests', () => {
  const sql = read('migrations/012_pixelium_quote_automation.sql');
  assert.match(sql, /VALUES \('JP'/);
  assert.match(sql, /Julien P\./);
  assert.match(sql, /"protected":true/);
  assert.match(sql, /external_id text NOT NULL UNIQUE/);
  assert.match(sql, /pixelium_commissions/);
  assert.match(sql, /pixelium_email_jobs/);
});

test('Pixelium requests schedule the quote 35 minutes later and use persistent jobs', () => {
  const server = read('server-pixelium.cjs');
  assert.match(server, /QUOTE_DELAY_MINUTES = 35/);
  assert.match(server, /QUOTE_DELAY_MINUTES \* 60_000/);
  assert.match(server, /confirmation.*pending.*now\(\)/);
  assert.match(server, /quote.*pending/);
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
  assert.match(main, /app\.use.*pixeliumRouter/);
});

test('migration 012 is part of cockpit startup migrations', () => {
  const postgres = read('server-postgres.cjs');
  assert.match(postgres, /012_pixelium_quote_automation\.sql/);
});

test('POST /commercials creates new commercial with admin-only protection', () => {
  const server = read('server-pixelium.cjs');
  
  // Vérifier que la route POST /commercials existe
  assert.match(server, /router\.post.*\/commercials/);
  
  // Vérifier la protection requireSession('admin')
  assert.match(server, /router\.post\(.*\/commercials.*requireSession.*admin/);
  
  // Vérifier la validation du code (2-20 caractères majuscules/chiffres/tiret)
  assert.match(server, /COMMERCIAL_CODE_REGEX/);
  assert.match(server, /A-Z0-9-/);
  assert.match(server, /2,20/);
  
  // Vérifier la création avec metadata source=admin
  assert.match(server, /source.*admin/);
});

test('POST /commercials validates code format and rejects duplicates', () => {
  const server = read('server-pixelium.cjs');
  
  // Validation du format de code
  assert.match(server, /Code commercial invalide/);
  assert.match(server, /2-20 caractères majuscules/);
  
  // Conflit 409 pour code existant
  assert.match(server, /409/);
  assert.match(server, /Code commercial déjà existant/);
});

test('PATCH /commercials/:code protects JP from deactivation and name change', () => {
  const server = read('server-pixelium.cjs');
  
  // Vérifier la protection contre la désactivation de JP
  assert.match(server, /code === 'JP' && active === false/);
  assert.match(server, /Julien P\. est un commercial protégé/);
  assert.match(server, /ne peut pas être désactivé/);
  
  // Vérifier la protection contre le changement de nom de JP
  assert.match(server, /code === 'JP' && displayName/);
  assert.match(server, /displayName !== 'Julien P\.'/);
  assert.match(server, /Le nom.*Julien P\..*ne peut pas être modifié/);
});

test('PATCH /commercials/:code allows commission rate modification', () => {
  const server = read('server-pixelium.cjs');
  
  // Vérifier que le taux de commission reste modifiable
  assert.match(server, /commission_rate_bps/);
  assert.match(server, /rateProvided/);
  
  // Vérifier la validation du taux
  assert.match(server, /Number\.isInteger\(rate\)/);
  assert.match(server, /rate < 0 \|\| rate > 10000/);
});

