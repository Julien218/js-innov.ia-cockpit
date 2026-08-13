const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateCost,
  normalizeUsage,
  evaluateBudget,
  recommendModel,
  DEFAULT_ROUTING,
  buildSecretRef,
  sanitizeAttribution,
} = require('../server-ai-cost.cjs');

test('calculates Luna standard cost with cached input', () => {
  const result = calculateCost({
    model: 'gpt-5.6-luna',
    inputTokens: 1000,
    cachedInputTokens: 100,
    outputTokens: 500,
  });
  assert.equal(result.priced, true);
  assert.equal(result.costUsd, 0.00391);
});

test('generates a nominative normalized secret reference', () => {
  assert.equal(buildSecretRef('openai', 'Synergie Dour', 'Auto-publish été'), 'OPENAI_API_KEY_SYNERGIE_DOUR_AUTO_PUBLISH_ETE');
});

test('stores attribution metadata without accepting a raw key', () => {
  const value = sanitizeAttribution({
    client_id: 'client-1', project_id: 'project-1', client_name: 'Client X', project_name: 'Projet 1', provider: 'openai',
  });
  assert.equal(value.secret_ref, 'OPENAI_API_KEY_CLIENT_X_PROJET_1');
  assert.equal(Object.hasOwn(value, 'api_key'), false);
  assert.throws(() => sanitizeAttribution({ ...value, api_key: 'sk-secret' }), /clé brute/i);
});

test('maps client_id and project_id into the cost attribution keys', () => {
  const row = normalizeUsage({ model: 'gpt-5.6-luna', client_id: 'client-1', project_id: 'project-1' });
  assert.equal(row.client_key, 'client-1');
  assert.equal(row.project_key, 'project-1');
  assert.equal(row.provider, 'openai');
});

test('applies priority processing multiplier', () => {
  const result = calculateCost({
    model: 'gpt-5.6-terra',
    inputTokens: 1000,
    outputTokens: 1000,
    processingMode: 'priority',
  });
  assert.equal(result.costUsd, 0.035);
});

test('normalizes Chat Completions style token usage', () => {
  const row = normalizeUsage({
    model: 'gpt-5.6-terra',
    usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      prompt_tokens_details: { cached_tokens: 20 },
    },
    source: 'unit-test',
  }, 'tester@example.com');
  assert.equal(row.input_tokens, 120);
  assert.equal(row.cached_input_tokens, 20);
  assert.equal(row.output_tokens, 30);
  assert.equal(row.source, 'unit-test');
  assert.equal(row.created_by, 'tester@example.com');
  assert.equal(row.cost_estimated, true);
});

test('explicit cost takes precedence over token estimate', () => {
  const row = normalizeUsage({
    model: 'gpt-5.6-sol',
    input_tokens: 5000,
    output_tokens: 2000,
    cost_usd: 0.12345678,
  });
  assert.equal(row.cost_usd, 0.12345678);
  assert.equal(row.cost_estimated, false);
});

test('evaluates thresholds and hard limit', () => {
  const state = evaluateBudget(92, {
    monthly_budget_usd: 100,
    hard_limit_usd: 90,
    alert_thresholds: [50, 75, 90],
    enabled: true,
  });
  assert.equal(state.percent, 92);
  assert.deepEqual(state.reached_thresholds, [50, 75, 90]);
  assert.equal(state.blocked, true);
});

test('routes simple, balanced and complex workloads', () => {
  assert.equal(recommendModel('simple', DEFAULT_ROUTING), 'gpt-5.6-luna');
  assert.equal(recommendModel('balanced', DEFAULT_ROUTING), 'gpt-5.6-terra');
  assert.equal(recommendModel('complex', DEFAULT_ROUTING), 'gpt-5.6-sol');
});
