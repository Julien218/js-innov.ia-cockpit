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
  sourceToEurMinor,
  parseGitHubUsage,
  parseTwilioUsage,
} = require('../server-cost-accounting-core.cjs');
const { importGitHubCharges, importTwilioCharges } = require('../server-provider-cost-imports.cjs');
const { buildInvoiceLines } = require('../server-client-costs.cjs');

const fxEnv = { BILLING_EUR_PER_USD: '0.91', BILLING_FX_SOURCE: 'ECB 2026-08 monthly rate' };

test('sépare les dépenses réelles, manuelles, estimées et non vérifiées', () => {
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
  assert.equal(result.unverified_events, 1);
  assert.equal(result.billable_minor, 400);
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

test('une source non configurée reste explicitement à configurer, jamais implicitement à zéro', () => {
  const coverage = buildSourceCoverage({}, [], []);
  const github = coverage.find((source) => source.id === 'github');
  const railway = coverage.find((source) => source.id === 'railway');
  const dropbox = coverage.find((source) => source.id === 'dropbox');
  assert.equal(github.ready, false);
  assert.ok(github.missing_configuration.includes('GITHUB_BILLING_TOKEN ou GITHUB_TOKEN'));
  assert.ok(railway.missing_configuration.includes('RAILWAY_COSTS_ENDPOINT'));
  assert.equal(dropbox.accounting_state, 'invoice_required');
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

test('exclut les anciennes lignes sans preuve lors de la génération de facture', () => {
  const lines = buildInvoiceLines([
    { source_type: 'github', actual_cost_minor: 100, billable_minor: 125, billable: true, metadata: { evidence_status: 'actual', verification_ref: 'gh:1' } },
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
  assert.match(ui, /Une source absente ou non connectée n’est jamais comptée comme 0 €/);
  assert.match(server, /accounting\/overview/);
  assert.match(server, /accounting\/sync/);
  assert.match(server, /accounting\/cost-centers/);
  assert.match(ui, /Créer le centre/);
  assert.match(ui, /Synchroniser les coûts/);
  assert.match(server, /local_ai_rates_unconfigured/);
  assert.match(docker, /server-cost-accounting-core\.cjs/);
  assert.match(docker, /server-provider-cost-imports\.cjs/);
});
