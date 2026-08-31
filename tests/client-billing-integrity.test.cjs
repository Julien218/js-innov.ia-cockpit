const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { applyBillingRule, summarize, buildInvoiceLines, monthWindow, costEventLookupPath } = require('../server-client-costs.cjs');

test('un oui/ok/confirme consomme la confirmation existante sans repasser par le LLM', () => {
  const source = read('src/lib/assistantConfirmationBridge.js');
  assert.match(source, /AFFIRMATIVE/);
  assert.match(source, /pending && isAffirmativeIntent\(intent\)/);
  assert.match(source, /\/api\/assistant\/confirm/);
  assert.match(source, /state\.delete\(key\)/);
  assert.match(source, /action exécutée une seule fois/);
});

test('le bridge est installé avant le rendu du Cockpit', () => {
  const source = read('src/main.jsx');
  assert.match(source, /installAssistantConfirmationBridge/);
  assert.match(source, /installAssistantConfirmationBridge\(\)/);
});

test('la migration impose client_id aux factures/devis et propage le client aux coûts', () => {
  const source = read('supabase/migrations/20260819165000_client_billing_integrity_and_cost_ledger.sql');
  assert.match(source, /trg_facture_client_integrity/);
  assert.match(source, /trg_devis_client_integrity/);
  assert.match(source, /assert_client_exists/);
  assert.match(source, /client_cost_events/);
  assert.match(source, /client_billing_rules/);
  assert.match(source, /propagate_cost_invoice_client/);
  assert.match(source, /prevent_linked_client_delete/);
});

test('la marge est séparée du coût réel et peut être incluse ou à prix coûtant', () => {
  assert.deepEqual(applyBillingRule(1000, { billing_mode: 'at_cost', minimum_minor: 0 }), {
    actual: 1000, billable: 1000, markupPercent: 0, billableEnabled: true, mode: 'at_cost',
  });
  assert.deepEqual(applyBillingRule(1000, { billing_mode: 'included' }), {
    actual: 1000, billable: 0, markupPercent: 0, billableEnabled: false, mode: 'included',
  });
  const percent = applyBillingRule(1000, { billing_mode: 'percent', markup_percent: 20, minimum_minor: 0 });
  assert.equal(percent.actual, 1000);
  assert.equal(percent.billable, 1200);
  assert.equal(percent.markupPercent, 20);
});

test('le résumé client conserve coût réel, refacturation et marge', () => {
  const result = summarize([
    { source_type: 'llm_api', actual_cost_minor: 100, billable_minor: 130, billable: true, metadata: { evidence_status: 'actual', verification_ref: 'api:1' } },
    { source_type: 'railway', actual_cost_minor: 200, billable_minor: 200, billable: true, metadata: { evidence_status: 'actual', verification_ref: 'api:2' } },
    { source_type: 'github', actual_cost_minor: 50, billable_minor: 0, billable: false, metadata: { evidence_status: 'actual', verification_ref: 'api:3' } },
  ]);
  assert.equal(result.actual_cost_minor, 350);
  assert.equal(result.billable_minor, 330);
  assert.equal(result.margin_minor, 0); // une dépense incluse reste un coût interne, pas une marge négative facturée
  assert.equal(result.by_source.length, 3);
});

test('les lignes de facture regroupent uniquement les coûts refacturables', () => {
  const lines = buildInvoiceLines([
    { source_type: 'llm_api', billable: true, billable_minor: 150, metadata: { evidence_status: 'actual', verification_ref: 'provider:1' } },
    { source_type: 'llm_api', billable: true, billable_minor: 50, metadata: { evidence_status: 'estimated', calculation_method: 'tokens', calculation_inputs: {} } },
    { source_type: 'llm_api', billable: true, billable_minor: 999, metadata: {} },
    { source_type: 'local_ai', billable: false, billable_minor: 100 },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].total, 2);
  assert.match(lines[0].description, /LLM API/);
});

test('monthWindow borne correctement une période mensuelle', () => {
  const window = monthWindow('2026-08');
  assert.equal(window.start.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-09-01T00:00:00.000Z');
});

test('une reprise vidéo retrouve le coût idempotent existant avec sa vraie clé', () => {
  const path = costEventLookupPath('media_ai', 'video-generation:openai:video_123');
  assert.equal(path, 'client_cost_events?select=*&source_type=eq.media_ai&external_ref=eq.video-generation%3Aopenai%3Avideo_123&limit=1');
  const source = read('server-client-costs.cjs');
  assert.match(source, /if \(inserted\?\.\[0\]\) return inserted\[0\]/);
  assert.match(source, /crmSelect\(costEventLookupPath\(type, row\.external_ref\)\)/);
});

test('le coût LLM client est attribué au Client.id canonique, jamais à un simple nom', () => {
  const source = read('server-ai-cost-attribution.cjs');
  assert.match(source, /client_key: String\(client\.id\)/);
  assert.match(source, /canonical_client_id/);
  assert.match(source, /billable: true/);
  assert.match(source, /mode === 'client'/);
});

test('la route client-costs est réservée aux admins', () => {
  const source = read('server.cjs');
  assert.match(source, /const adminGuard = requireSession\('admin'\)/);
  assert.match(source, /app\.use\('\/api\/client-costs', adminGuard, requirePermission\('ai_cost_control', 'admin'\), aiCostLedgerAggregateRouter\)/);
  assert.match(source, /app\.use\('\/api\/client-costs', adminGuard, requirePermission\('ai_cost_control', 'admin'\), clientCostsRouter\)/);
});

test('AI Cost Control reste interdit aux clients même avec une permission forcée', () => {
  const { hasPermission } = require('../server-permission-policy.cjs');
  const permission_overrides = [{ permission_code: 'ai_cost_control', enabled: true }];
  for (const role of ['client', 'collaborateur']) {
    assert.equal(hasPermission({ role, permission_overrides }, 'ai_cost_control'), false);
  }
  assert.equal(hasPermission({ role: 'admin', permission_overrides }, 'ai_cost_control'), true);
  assert.equal(hasPermission({ role: 'superadmin' }, 'ai_cost_control'), true);
  assert.match(read('server.cjs'), /app\.use\('\/api\/ai-cost', requireSession\('admin'\), requirePermission\('ai_cost_control', 'admin'\), aiCostRouter\)/);
});

test('Mes factures indique explicitement la réservation administrative d’AI Cost Control', () => {
  assert.match(read('src/pages/ClientRecords.jsx'), /kind === 'invoices' && \(\s*<p[^>]*>\s*AI Cost Control est réservé à l’administration\./);
});
