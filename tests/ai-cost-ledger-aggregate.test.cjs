const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { aggregateAiUsage, applyExactRule, monthWindow } = require('../server-ai-cost-ledger-aggregate.cjs');

test('agrège les micro-coûts avant arrondi au centime', () => {
  const { groups, unpriced } = aggregateAiUsage([
    { provider: 'openai', model: 'gpt-4o-mini', cost_usd: 0.0019, input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 },
    { provider: 'openai', model: 'gpt-4o-mini', cost_usd: 0.0021, input_tokens: 20, cached_input_tokens: 5, output_tokens: 3 },
    { provider: 'openai', model: 'gpt-4o-mini', cost_usd: 0.0030, input_tokens: 30, cached_input_tokens: 10, output_tokens: 4 },
  ]);
  assert.equal(unpriced.length, 0);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].requests, 3);
  assert.equal(Number(groups[0].costUsd.toFixed(4)), 0.0070);
  assert.equal(groups[0].inputTokens, 60);
  assert.equal(groups[0].cachedInputTokens, 15);
  assert.equal(groups[0].outputTokens, 9);
});

test('bloque les usages non tarifés au lieu de les traiter comme coût zéro', () => {
  const { groups, unpriced } = aggregateAiUsage([
    { id: 'x1', provider: 'openai', model: 'future-model', pricing_warning: 'model_unpriced', cost_usd: 0 },
  ]);
  assert.equal(groups.length, 0);
  assert.deepEqual(unpriced, [{ id: 'x1', model: 'future-model' }]);
});

test('applique la règle at_cost sur la valeur précise avant arrondi de facture', () => {
  const result = applyExactRule(0.0092, { billing_mode: 'at_cost' });
  assert.equal(result.actualEur, 0.0092);
  assert.equal(result.billableEur, 0.0092);
  assert.equal(result.markupPercent, 0);
  assert.equal(result.billable, true);
});

test('applique une marge sur la valeur exacte et respecte included', () => {
  const margin = applyExactRule(1.234567, { billing_mode: 'percent', markup_percent: 25, minimum_minor: 0 });
  assert.equal(Number(margin.billableEur.toFixed(6)), 1.543209);
  const included = applyExactRule(1.234567, { billing_mode: 'included' });
  assert.equal(included.billableEur, 0);
  assert.equal(included.billable, false);
});

test('la période mensuelle reste en UTC', () => {
  const window = monthWindow('2026-08');
  assert.equal(window.start.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-09-01T00:00:00.000Z');
});

test('le routeur précis est monté avant le routeur historique', () => {
  const source = read('server.cjs');
  const precise = source.indexOf('aiCostLedgerAggregateRouter');
  const legacy = source.indexOf("const { router: clientCostsRouter }");
  assert.ok(precise >= 0);
  assert.ok(legacy > precise);
  assert.match(source, /agrégation IA précise/);
});

test('le Dockerfile embarque et valide le module précis', () => {
  const docker = read('Dockerfile');
  assert.match(docker, /server-ai-cost-ledger-aggregate\.cjs/);
  assert.match(docker, /node --check \/app\/server-ai-cost-ledger-aggregate\.cjs/);
});
