const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const {
  validateEvidence,
  summarizeAccounting,
  buildSourceCoverage,
  accountingCompleteness,
  sourceToEurMinor,
  parseGitHubUsage,
  parseTwilioUsage,
} = require('../server-cost-accounting-core.cjs');
const { importGitHubCharges, importTwilioCharges, importVerifiedAdapterCharges } = require('../server-provider-cost-imports.cjs');
const { buildInvoiceLines } = require('../server-client-costs.cjs');
const { importRailwayCharges } = require('../server-cost-centers.cjs');

const fxEnv = { BILLING_EUR_PER_USD: '0.91', BILLING_FX_SOURCE: 'ECB 2026-08 monthly rate' };

test('sépare les dépenses réelles, manuelles, estimées et non vérifiées tout en gardant un total enregistré', () => {
  const result = summarizeAccounting([
    { source_type: 'github', actual_cost_minor: 100, billable_minor: 125, billable: true, metadata: { evidence_status: 'actual', verification_ref: 'gh:1' } },
    { source_type: 'railway', actual_cost_minor: 200, billable_minor: 200, billable: true, metadata: { evidence_status: 'manual_verified', verification_ref: 'invoice:1' } },
    { source_type: 'local_ai', actual_cost_minor: 50, billable_minor: 75, billable: true, metadata: { evidence_status: 'estimated', calculation_method: 'runtime', calculation_inputs: {} } },
    { source_type: 'dropbox', actual_cost_minor: 999, billable_minor: 999, billable: true, metadata: {} },
  ]);
  assert.equal(result.actual_cost_minor, 100);
  assert.equal(result.manual_verified_minor, 200);
  assert.equal(result.verified_cost_minor, 300);
  assert.equal(result.estimated_cost_minor, 50);
  assert.equal(result.supported_cost_minor, 350);
  assert.equal(result.unverified_events, 1);
  assert.equal(result.unverified_cost_minor, 999);
  assert.equal(result.recorded_cost_minor, 1349);
  assert.equal(result.total_recorded_cost_minor, 1349);
  assert.equal(result.billable_minor, 400);
});

test('les 12 familles du catalogue ne sont plus considérées comme 12 dépenses obligatoires', () => {
  const sources = buildSourceCoverage({}, [], []);
  const completeness = accountingCompleteness(sources);
  assert.equal(completeness.complete, true);
  assert.equal(completeness.applicable_sources, 0);
  assert.equal(completeness.gaps.length, 0);
  assert.ok(sources.every((source) => source.accounting_state === 'not_applicable'));
});

test('une source détectée mais non rattachée reste explicitement incomplète', () => {
  const sources = buildSourceCoverage({ GITHUB_TOKEN: 'secret' }, [], []);
  const completeness = accountingCompleteness(sources);
  const github = sources.find((source) => source.id === 'github');
  assert.equal(github.applicable, true);
  assert.equal(github.covered, false);
  assert.ok(github.missing_configuration.includes('rattachement client/projet'));
  assert.equal(completeness.complete, false);
  assert.ok(completeness.gaps.some((gap) => gap.id === 'github'));
});

test('une synchronisation fournisseur réussie couvre aussi un mois à 0 €', () => {
  const mappings = [{ id: 'gh-map-1', service_type: 'github_repo', external_id: 'Julien218/demo', is_active: true }];
  const events = [{
    source_type: 'github', actual_cost_minor: 0, billable_minor: 0, billable: false,
    metadata: { evidence_status: 'actual', verification_ref: 'provider-sync:github', coverage_marker: true },
  }];
  const sources = buildSourceCoverage({ GITHUB_TOKEN: 'secret' }, mappings, events);
  const github = sources.find((source) => source.id === 'github');
  assert.equal(github.synchronized, true);
  assert.equal(github.covered, true);
  assert.equal(accountingCompleteness(sources).complete, true);
  assert.equal(summarizeAccounting(events).recorded_cost_minor, 0);
});

test('tous les rattachements automatiques doivent être synchronisés, pas seulement un', () => {
  const mappings = [
    { id: 'gh-map-1', service_type: 'github_repo', external_id: 'Julien218/a', is_active: true },
    { id: 'gh-map-2', service_type: 'github_repo', external_id: 'Julien218/b', is_active: true },
  ];
  const events = [{
    source_type: 'github', actual_cost_minor: 0, billable_minor: 0, billable: false,
    metadata: { evidence_status: 'actual', verification_ref: 'provider-sync:github:a', coverage_marker: true },
  }];
  const github = buildSourceCoverage({ GITHUB_TOKEN: 'secret' }, mappings, events).find((source) => source.id === 'github');
  assert.equal(github.synchronized, false);
  assert.equal(github.covered, false);
});

test('une dépense non vérifiée reste visible dans le total enregistré mais bloque la complétude', () => {
  const mappings = [{ id: 'gh-map-1', service_type: 'github_repo', external_id: 'Julien218/demo', is_active: true }];
  const events = [
    { source_type: 'github', actual_cost_minor: 0, billable_minor: 0, billable: false, metadata: { evidence_status: 'actual', verification_ref: 'provider-sync:github', coverage_marker: true } },
    { source_type: 'github', actual_cost_minor: 499, billable_minor: 0, billable: false, metadata: {} },
  ];
  const sources = buildSourceCoverage({ GITHUB_TOKEN: 'secret' }, mappings, events);
  const github = sources.find((source) => source.id === 'github');
  assert.equal(github.has_unverified, true);
  assert.equal(github.covered, false);
  assert.equal(github.accounting_state, 'evidence_required');
  assert.equal(accountingCompleteness(sources).complete, false);
  assert.equal(summarizeAccounting(events).recorded_cost_minor, 499);
});

test('refuse une dépense réelle sans justificatif et une dépense non vérifiée facturable', () => {
  assert.throws(() => validateEvidence({ status: 'actual' }), /verification_ref/);
  assert.throws(() => validateEvidence({ status: 'unverified', billable: true }), /ne peut pas être facturable/);
  assert.equal(validateEvidence({ status: 'manual_verified', verificationRef: 'invoice-42' }), 'manual_verified');
});

test('exige une méthode et les paramètres pour une estimation', () => {
  assert.throws(() => validateEvidence({ status: 'estimated', calculationMethod: 'runtime' }), /calculation_inputs/);
  assert.equal(validateEvidence({ status: 'estimated', calculationMethod: 'runtime', calculationInputs: { seconds: 12 } }), 'estimated');
});

test('une source configurée reste explicite sur ses prérequis de connexion', () => {
  const coverage = buildSourceCoverage({}, [], []);
  const github = coverage.find((source) => source.id === 'github');
  const railway = coverage.find((source) => source.id === 'railway');
  const dropbox = coverage.find((source) => source.id === 'dropbox');
  assert.equal(github.ready, false);
  assert.ok(github.missing_configuration.includes('GITHUB_BILLING_TOKEN ou GITHUB_TOKEN'));
  assert.ok(railway.missing_configuration.includes('RAILWAY_COSTS_ENDPOINT'));
  assert.equal(dropbox.accounting_state, 'not_applicable');
  assert.ok(dropbox.missing_configuration.includes('DROPBOX_COSTS_ENDPOINT'));
});

test('bloque la conversion USD sans taux ET source de change', () => {
  assert.throws(() => sourceToEurMinor(10, 'USD', { BILLING_EUR_PER_USD: '0.91' }), /BILLING_FX_SOURCE/);
  assert.deepEqual(sourceToEurMinor(10, 'USD', fxEnv), { totalMinor: 910, fxRate: 0.91, fxSource: 'ECB 2026-08 monthly rate' });
  assert.deepEqual(sourceToEurMinor(10, 'EUR', {}), { totalMinor: 1000, fxRate: 1, fxSource: 'provider_currency_eur' });
});

test('importe GitHub sur le montant net après remises et filtre le dépôt client', () => {
  const lines = parseGitHubUsage({ usageItems: [
    { date: '2026-08-10', product: 'Actions', sku: 'Actions Linux', grossAmount: 2, discountAmount: 0.5, netAmount: 1.5, repositoryName: 'Julien218/client-a' },
    { date: '2026-08-10', product: 'Actions', sku: 'Actions Linux', grossAmount: 4, discountAmount: 0, netAmount: 4, repositoryName: 'Julien218/other' },
  ] }, { service_type: 'github_repo', external_id: 'Julien218/client-a' }, '2026-08', fxEnv);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].total_minor, 137);
  assert.equal(lines[0].metadata.net_amount, 1.5);
  assert.equal(lines[0].metadata.evidence_status, 'actual');
  assert.match(lines[0].external_ref, /2026-08/);
});

test('distingue GitHub Actions, Packages et Copilot par dépôt', () => {
  const lines = parseGitHubUsage({ usageItems: [
    { date: '2026-08-10', product: 'Actions', sku: 'Linux', netAmount: 1, repositoryName: 'client-a' },
    { date: '2026-08-10', product: 'Packages', sku: 'Storage', netAmount: 2, repositoryName: 'Julien218/client-a' },
    { date: '2026-08-10', product: 'Copilot', sku: 'AI Credits', netAmount: 3, repositoryName: 'Julien218/client-a' },
  ] }, { service_type: 'github_repo', external_id: 'Julien218/client-a' }, '2026-08', fxEnv);
  assert.deepEqual(lines.map((line) => line.metadata.product_key), ['actions', 'packages', 'copilot']);
});

test('importe uniquement Twilio totalprice afin de ne pas additionner deux fois les catégories', () => {
  const lines = parseTwilioUsage({ usage_records: [
    { category: 'sms', price: '2.00', price_unit: 'eur' },
    { category: 'totalprice', price: '3.50', price_unit: 'eur', as_of: '2026-08-25T10:00:00Z' },
  ] }, { external_id: 'AC123' }, '2026-08', {});
  assert.equal(lines.length, 1);
  assert.equal(lines[0].total_minor, 350);
  assert.equal(lines[0].metadata.source_amount, 3.5);
});

test('les collecteurs GitHub et Twilio utilisent les preuves API officielles', async () => {
  const github = await importGitHubCharges(
    { service_type: 'github_user', external_id: 'Julien218' }, 2026, 8,
    { env: { ...fxEnv, GITHUB_BILLING_TOKEN: 'secret' }, fetchImpl: async () => new Response(JSON.stringify({ usageItems: [{ date: '2026-08-01', product: 'Actions', sku: 'Linux', netAmount: 1, repositoryName: 'Julien218/demo' }] }), { status: 200 }) },
  );
  assert.equal(github.lines.length, 1);
  assert.equal(github.evidenceStatus, 'actual');

  const twilio = await importTwilioCharges(
    { service_type: 'twilio_account', external_id: 'ACclient' }, 2026, 8,
    { env: { TWILIO_ACCOUNT_SID: 'ACmaster', TWILIO_AUTH_TOKEN: 'secret' }, fetchImpl: async () => new Response(JSON.stringify({ usage_records: [{ category: 'totalprice', price: '2', price_unit: 'eur' }] }), { status: 200 }) },
  );
  assert.equal(twilio.lines[0].total_minor, 200);
});

test('importe Railway par service sans attribuer les autres services', async () => {
  const result = await importRailwayCharges(
    { service_type: 'railway_service', external_id: 'service-a', metadata: { project_id: 'project-1' } }, 2026, 8,
    { env: { ...fxEnv, RAILWAY_API_TOKEN: 'secret', RAILWAY_COSTS_ENDPOINT: 'https://costs.example.test/railway' }, fetchImpl: async (url) => {
      assert.equal(url.searchParams.get('project_id'), 'project-1');
      assert.equal(url.searchParams.get('service_id'), 'service-a');
      return new Response(JSON.stringify({ accounting_status: 'actual', costs: [
        { service_id: 'service-a', service: 'web', amount: 4, currency: 'EUR', verification_ref: 'railway-invoice:1' },
        { service_id: 'service-b', service: 'worker', amount: 9, currency: 'EUR', verification_ref: 'railway-invoice:1' },
      ] }), { status: 200 });
    } },
  );
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].metadata.service_id, 'service-a');
});

test('importe Supabase, Dropbox et vidéo seulement avec une preuve monétaire', async () => {
  const result = await importVerifiedAdapterCharges(
    { service_type: 'media_provider', external_id: 'grok-video' }, 2026, 8,
    { env: { MEDIA_COSTS_ENDPOINT: 'https://costs.example.test/media', COST_IMPORT_ADAPTER_TOKEN: 'secret', ...fxEnv }, fetchImpl: async () => new Response(JSON.stringify({
      accounting_status: 'actual',
      costs: [{ id: 'gen-1', name: 'Grok vidéo', amount: 5, currency: 'USD', verification_ref: 'provider:gen-1', generation_id: 'gen-1' }],
    }), { status: 200 }) },
  );
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].metadata.generation_id, 'gen-1');
  assert.equal(result.lines[0].metadata.evidence_status, 'actual');
});

test('exclut les anciennes lignes sans preuve et les marqueurs de couverture lors de la génération de facture', () => {
  const lines = buildInvoiceLines([
    { source_type: 'github', actual_cost_minor: 100, billable_minor: 125, billable: true, metadata: { evidence_status: 'actual', verification_ref: 'gh:1' } },
    { source_type: 'github', actual_cost_minor: 0, billable_minor: 0, billable: false, metadata: { evidence_status: 'actual', verification_ref: 'provider-sync:1', coverage_marker: true } },
    { source_type: 'dropbox', actual_cost_minor: 999, billable_minor: 999, billable: true, metadata: {} },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].total, 1.25);
});

test('l’interface et l’image Railway embarquent la vue comptable complète', () => {
  const ui = read('src/pages/AICostControl.jsx');
  const docker = read('Dockerfile');
  const server = read('server-client-costs.cjs');
  assert.match(ui, /Couverture comptable par fournisseur/);
  assert.match(ui, /Total dépenses enregistrées/);
  assert.match(ui, /Une source non utilisée n’est pas considérée comme une dépense manquante/);
  assert.match(ui, /Stockage \/ sauvegarde/);
  assert.match(ui, /Fournisseur communications/);
  assert.match(ui, /Autre fournisseur technique/);
  assert.match(server, /accounting\/overview/);
  assert.match(server, /accounting\/sync/);
  assert.match(server, /coverage_marker/);
  assert.match(server, /accounting\/cost-centers/);
  assert.match(ui, /Créer le centre/);
  assert.match(ui, /Synchroniser les coûts/);
  assert.match(ui, /Total comptable incomplet/);
  assert.match(ui, /Manuel vérifié/);
  assert.match(ui, /Enregistrer les tarifs locaux/);
  assert.match(server, /accounting\/local-rates/);
  assert.match(server, /local_ai_rates_unconfigured/);
  assert.match(docker, /server-cost-accounting-core\.cjs/);
  assert.match(docker, /server-provider-cost-imports\.cjs/);
  const migration = read('supabase/migrations/20260825184331_ai_cost_accounting_completeness.sql');
  assert.match(migration, /cost_accounting_settings/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /revoke all .* from anon, authenticated/);
});
