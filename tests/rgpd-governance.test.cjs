const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const governanceSource = fs.readFileSync(path.join(root, 'server-governance.cjs'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.cjs'), 'utf8');
const dockerSource = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const migrationSource = fs.readFileSync(path.join(root, 'supabase/migrations/20260901120000_governance_tenant_and_rgpd_hardening.sql'), 'utf8');
const governanceExport = require('../lib/governance-export.cjs');

test('les routes de gouvernance bornent chaque lecture et mutation au tenant de session', () => {
  assert.match(governanceSource, /'Accept-Profile': 'governance', 'Content-Profile': 'governance'/);
  for (const table of ['processing_activity', 'subprocessor_registry', 'retention_policy']) {
    assert.match(governanceSource, new RegExp(`${table}\\?\\$\\{tenantParam\\(req\\)\\}`));
  }
  for (const table of ['processing_activity', 'subprocessor_registry', 'consent_record', 'data_subject_request', 'retention_policy']) {
    assert.match(governanceSource, new RegExp(`${table}\\?id=eq\\.\\$\\{encodeURIComponent\\(id\\)\\}&\\$\\{tenantParam\\(req\\)\\}`));
  }
  assert.ok((governanceSource.match(/const filters = \[tenantParam\(req\)\]/g) || []).length >= 3);
  assert.match(governanceSource, /tenant_id=eq\.\$\{encodeURIComponent\(tenant\)\}&status=eq\.active/);
  assert.doesNotMatch(governanceSource, /audit_log\?select=id&limit=1/);
});

test('l’export personnel sélectionne uniquement les documents du client et minimise les champs', () => {
  assert.match(governanceSource, /DocumentIndex\?tenant_id=eq\.\$\{encodeURIComponent\(tenant\)\}&client_id=eq\.\$\{encodeURIComponent\(client\.id\)\}&deleted_at=is\.null/);

  const personal = governanceExport.pickExportFields([{
    id: 'client-1', email: 'personne@example.test', nom: 'Personne',
    organisation_id: 'tenant-a', password_hash: 'secret', internal_note: 'private',
  }], 'Client');
  assert.deepEqual(personal, [{ id: 'client-1', nom: 'Personne', email: 'personne@example.test' }]);

  const tenant = governanceExport.sanitizeTenantExport([{ id: 1, token: 'secret', dropbox_path: '/private', label: 'ok', metadata: { api_key: 'nested-secret', safe: true } }]);
  assert.deepEqual(tenant, [{ id: 1, label: 'ok', metadata: { safe: true } }]);
  assert.match(dockerSource, /lib\/governance-export\.cjs/);
});

test('la preuve de consentement public est authentifiée, idempotente et liée au registre', () => {
  assert.match(serverSource, /governanceRouter\.publicRouter/);
  assert.match(governanceSource, /authorizedSiteKey/);
  assert.match(governanceSource, /submission_id=eq\.\$\{encodeURIComponent\(submissionId\)\}/);
  assert.match(governanceSource, /external_key=eq\.public_website_contact/);
  assert.match(governanceSource, /processing_activity_id: activities\[0\]\.id/);
  assert.match(governanceSource, /createHash\('sha256'\)\.update\(consentText/);
  assert.match(governanceSource, /createHmac\('sha256', secret\)/);
});

test('la migration RGPD applique les délais belges et durcit Supabase', () => {
  assert.match(migrationSource, /INTERVAL '1 month'/);
  assert.match(migrationSource, /extended_due_date <= due_date \+ INTERVAL '2 months'/);
  assert.match(migrationSource, /retention_period_days = 3650/);
  assert.match(migrationSource, /10 ans \(obligation comptable belge\)/);
  assert.match(migrationSource, /security_invoker = true/);
  assert.match(migrationSource, /TO service_role USING \(true\) WITH CHECK \(true\)/);
  assert.match(migrationSource, /consent_record_tenant_submission_uq/);
  assert.match(migrationSource, /REVOKE ALL ON FUNCTION governance\.log_action/);
});
