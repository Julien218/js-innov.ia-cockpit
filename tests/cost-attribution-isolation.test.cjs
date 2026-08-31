const test = require('node:test');
const assert = require('node:assert/strict');
const { selectUnambiguousClient } = require('../server-ai-cost-attribution.cjs');
const { resolveCostAttribution } = require('../server-nova-routing.cjs');
const { aggregateAiUsage, ledgerReference, validateGroupScope } = require('../server-ai-cost-ledger-aggregate.cjs');
const { parseGitHubUsage, mappingConflict } = require('../server-cost-accounting-core.cjs');
const { importRailwayCharges } = require('../server-cost-centers.cjs');

const clients = [
  { id: 'starlight', organisation_id: 'jsinnovia', email: 'same@example.test' },
  { id: 'pixelium', organisation_id: 'jsinnovia', email: 'same@example.test' },
];
test('un email commun à plusieurs clients ne choisit jamais le premier', () => {
  assert.equal(selectUnambiguousClient(clients, 'jsinnovia', 'same@example.test'), null);
  assert.equal(selectUnambiguousClient(clients, 'jsinnovia', 'missing@example.test'), null);
  assert.equal(selectUnambiguousClient(clients.slice(0, 1), 'other', 'same@example.test'), null);
  assert.equal(selectUnambiguousClient(clients.slice(0, 1), 'jsinnovia', ' SAME@example.test ').id, 'starlight');
});
test('un client ne peut imposer un autre client dans le corps de sa demande', () => {
  assert.equal(resolveCostAttribution({ audience: { mode: 'client' }, body: { client_id: 'victim' } }).client_key, null);
  assert.equal(resolveCostAttribution({ audience: { mode: 'client', client_id: 'own' }, body: { client_id: 'victim' } }).client_key, 'own');
});
test('agrégation et références séparent clients, projets, centres et usages inclus', () => {
  const base = { client_key: 'starlight', provider: 'openai', model: 'test', project_key: 'miss', cost_usd: 1 };
  const { groups } = aggregateAiUsage([
    base, { ...base, project_key: 'tour' }, { ...base, client_key: 'pixelium' },
    { ...base, metadata: { cost_center_id: 'center' } }, { ...base, metadata: { billable: false } },
  ]);
  assert.equal(groups.length, 5);
  assert.equal(new Set(groups.map((g) => ledgerReference(g.clientId, '2026-08', g))).size, 5);
  assert.equal(groups.reduce((total, g) => total + g.costUsd, 0), 5);
});
test('un usage sans projet reste non facturable et conserve son coût', () => {
  const { groups } = aggregateAiUsage([{ client_key: 'starlight', cost_usd: 2 }]);
  assert.equal(groups[0].projectId, null);
  assert.equal(groups[0].billable, false);
  assert.equal(groups[0].costUsd, 2);
});
test('les identifiants de projet et centre doivent appartenir au client', () => {
  const group = { clientId: 'starlight', projectId: 'miss', costCenterId: 'center' };
  const projects = [{ id: 'miss', client_id: 'starlight' }];
  const centers = [{ id: 'center', client_id: 'starlight', metadata: { project_id: 'miss' } }];
  assert.doesNotThrow(() => validateGroupScope(group, 'starlight', projects, centers));
  assert.throws(() => validateGroupScope(group, 'pixelium', projects, centers), /Client/);
  assert.throws(() => validateGroupScope(group, 'starlight', [], centers), /Projet/);
  assert.throws(() => validateGroupScope(group, 'starlight', projects, []), /Centre/);
});
test('une ligne GitHub possède la même identité via le compte et le dépôt', () => {
  const data = { usageItems: [{ date: '2026-08-01', product: 'Actions', sku: 'Linux', repositoryName: 'miss', netAmount: 1 }] };
  const env = { BILLING_EUR_PER_USD: '1', BILLING_FX_SOURCE: 'test' };
  const account = parseGitHubUsage(data, { service_type: 'github_user', external_id: 'Julien218' }, '2026-08', env)[0];
  const repo = parseGitHubUsage(data, { service_type: 'github_repo', external_id: 'Julien218/miss' }, '2026-08', env)[0];
  assert.equal(account.external_ref, repo.external_ref);
  data.usageItems[0].netAmount = 2;
  assert.equal(parseGitHubUsage(data, { service_type: 'github_repo', external_id: 'Julien218/miss' }, '2026-08', env)[0].external_ref, repo.external_ref);
});
test('les comptes/projets ne peuvent chevaucher leurs dépôts/services', () => {
  const gh = { id: '1', service_type: 'github_repo', external_id: 'Julien218/miss' };
  assert.ok(mappingConflict({ service_type: 'github_user', external_id: 'Julien218' }, [gh]));
  assert.equal(mappingConflict(gh, [gh]), null);
  assert.equal(mappingConflict({ service_type: 'github_repo', external_id: 'Julien218/tour' }, [gh]), null);
  const rw = { service_type: 'railway_service', external_id: 'web', metadata: { project_id: 'miss' } };
  assert.ok(mappingConflict({ service_type: 'railway_project', external_id: 'miss' }, [rw]));
  assert.equal(mappingConflict({ service_type: 'railway_service', external_id: 'db', metadata: { project_id: 'miss' } }, [rw]), null);
});
test('Railway exige le service de la preuve et déduplique projet/service', async () => {
  const env = { RAILWAY_API_TOKEN: 'test', RAILWAY_COSTS_ENDPOINT: 'https://costs.example.test' };
  const item = { service_id: 'web', service: 'web', amount: 1, currency: 'EUR', verification_ref: 'invoice-1' };
  const options = { env, fetchImpl: async () => new Response(JSON.stringify({ accounting_status: 'actual', costs: [item] })) };
  const account = await importRailwayCharges({ service_type: 'railway_project', external_id: 'miss' }, 2026, 8, options);
  const service = await importRailwayCharges({ service_type: 'railway_service', external_id: 'web', metadata: { project_id: 'miss' } }, 2026, 8, options);
  assert.equal(account.lines[0].external_ref, service.lines[0].external_ref);
  delete item.service_id;
  const bad = await importRailwayCharges({ service_type: 'railway_service', external_id: 'web', metadata: { project_id: 'miss' } }, 2026, 8, options);
  assert.equal(bad.lines.length, 0);
  assert.match(bad.error, /service_id requis/);
});
test('le build expose seulement les paramètres publics autorisés', async () => {
  const { publicEnvDefinitions } = await import('../scripts/public-env.mjs');
  const result = publicEnvDefinitions({ VITE_AGENT_KEY: 'private-test', VITE_BASE44_API_KEY: 'private-test', OPENAI_ADMIN_KEY: 'private-test' });
  assert.ok(!JSON.stringify(result).includes('private-test'));
  const jwt = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;
  assert.doesNotThrow(() => publicEnvDefinitions({ VITE_SUPABASE_ANON_KEY: jwt('anon') }));
  assert.throws(() => publicEnvDefinitions({ VITE_SUPABASE_ANON_KEY: jwt('service_role') }), /publique/);
  assert.throws(() => publicEnvDefinitions({ VITE_SUPABASE_ANON_KEY: 'private-test' }), /publique/);
});
