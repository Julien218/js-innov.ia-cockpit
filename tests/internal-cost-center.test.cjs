const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { applyBillingRule } = require('../server-client-costs.cjs');

test('un coût interne est suivi mais jamais refacturé', () => {
  const priced = applyBillingRule(69, { billing_mode: 'included' });
  assert.equal(priced.actual, 69);
  assert.equal(priced.billable, 0);
  assert.equal(priced.billableEnabled, false);
});

test('la migration crée le centre interne et sa règle included de façon idempotente', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260825223000_internal_jsinnovia_cost_center.sql'), 'utf8');
  assert.match(sql, /interne_jsinnovia/);
  assert.match(sql, /JSINNOVIA_INTERNAL/);
  assert.match(sql, /returning id into internal_client_id/i);
  assert.match(sql, /if not exists/i);
  assert.match(sql, /on conflict .* do update/is);
  assert.match(sql, /billing_mode = 'included'/);
});
