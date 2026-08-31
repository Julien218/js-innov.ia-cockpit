-- Data Governance & RGPD hardening
-- Additive migration: tenant integrity, consent proof, Belgian retention and DSR deadlines.

BEGIN;

-- A governance row without a tenant cannot be safely exposed by a service-role backend.
UPDATE governance.audit_log SET tenant_id = 'jsinnovia' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';
UPDATE governance.processing_activity SET tenant_id = 'jsinnovia' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';
UPDATE governance.subprocessor_registry SET tenant_id = 'jsinnovia' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';
UPDATE governance.consent_record SET tenant_id = 'jsinnovia' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';
UPDATE governance.data_subject_request SET tenant_id = 'jsinnovia' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';
UPDATE governance.retention_policy SET tenant_id = 'jsinnovia' WHERE tenant_id IS NULL OR btrim(tenant_id) = '';

ALTER TABLE governance.audit_log ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE governance.processing_activity ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE governance.subprocessor_registry ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE governance.consent_record ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE governance.data_subject_request ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE governance.retention_policy ALTER COLUMN tenant_id SET NOT NULL;

-- Article 12(3): one calendar month, with a documented extension of up to two months.
ALTER TABLE governance.data_subject_request
  ALTER COLUMN due_date SET DEFAULT (now() + INTERVAL '1 month'),
  ADD COLUMN IF NOT EXISTS deadline_extended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extended_due_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extension_reason TEXT,
  ADD COLUMN IF NOT EXISTS extension_notified_at TIMESTAMPTZ;

UPDATE governance.data_subject_request
SET due_date = received_at + INTERVAL '1 month',
    updated_at = now()
WHERE status NOT IN ('completed', 'rejected', 'partially_completed')
  AND due_date = received_at + INTERVAL '30 days';

ALTER TABLE governance.data_subject_request
  DROP CONSTRAINT IF EXISTS data_subject_request_extension_check;
ALTER TABLE governance.data_subject_request
  ADD CONSTRAINT data_subject_request_extension_check CHECK (
    (extended_due_date IS NULL AND extension_reason IS NULL)
    OR (
      extended_due_date IS NOT NULL
      AND extension_reason IS NOT NULL
      AND btrim(extension_reason) <> ''
      AND extended_due_date > due_date
      AND extended_due_date <= due_date + INTERVAL '2 months'
    )
  );

-- Belgian accounting supporting documents: ten years.
UPDATE governance.retention_policy
SET retention_period_days = 3650,
    retention_description = '10 ans (obligation comptable belge)',
    justification = 'Conservation des livres et pièces justificatives comptables en Belgique',
    legal_reference = 'Code de droit économique, art. III.86 et SPF Finances',
    updated_at = now()
WHERE category = 'invoices';

-- Versioned, idempotent evidence for public form consent.
ALTER TABLE governance.consent_record
  ADD COLUMN IF NOT EXISTS submission_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE governance.processing_activity
  ADD COLUMN IF NOT EXISTS external_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS processing_activity_tenant_external_key_uq
  ON governance.processing_activity(tenant_id, external_key)
  WHERE external_key IS NOT NULL;

INSERT INTO governance.processing_activity (
  external_key, name, purpose, categories_of_persons, categories_of_data,
  legal_basis, recipients, retention_period, security_measures, owner,
  legal_validation_status, tenant_id
) VALUES (
  'public_website_contact',
  'Formulaires de contact du site public',
  'Répondre aux demandes, préparer un devis et assurer le suivi commercial demandé',
  'Prospects, visiteurs et représentants de clients potentiels',
  'Identité, coordonnées, société, contenu de la demande et preuve de consentement',
  'Consentement pour le suivi demandé; mesures précontractuelles pour la réponse initiale',
  'Personnel habilité et sous-traitants techniques inscrits au registre',
  'Demande et prospection: 3 ans après le dernier contact; preuve du consentement: 3 ans après retrait',
  'Contrôle d’accès, cloisonnement tenant, chiffrement en transit, journalisation et minimisation',
  'privacy@js-innov.ai',
  'pending',
  'jsinnovia'
)
ON CONFLICT (tenant_id, external_key) WHERE external_key IS NOT NULL DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS consent_record_tenant_submission_uq
  ON governance.consent_record(tenant_id, submission_id)
  WHERE submission_id IS NOT NULL;

-- Views use the caller's RLS context on PostgreSQL 15+.
CREATE OR REPLACE VIEW governance.audit_log_recent
WITH (security_invoker = true) AS
SELECT * FROM governance.audit_log ORDER BY created_at DESC LIMIT 1000;

-- RLS is defense in depth. The application still filters tenants because service_role bypasses RLS.
DROP POLICY IF EXISTS gov_audit_sr ON governance.audit_log;
DROP POLICY IF EXISTS gov_dc_sr ON governance.data_classification;
DROP POLICY IF EXISTS gov_pa_sr ON governance.processing_activity;
DROP POLICY IF EXISTS gov_sr_sr ON governance.subprocessor_registry;
DROP POLICY IF EXISTS gov_cr_sr ON governance.consent_record;
DROP POLICY IF EXISTS gov_dsr_sr ON governance.data_subject_request;
DROP POLICY IF EXISTS gov_rp_sr ON governance.retention_policy;

CREATE POLICY gov_audit_sr ON governance.audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY gov_dc_sr ON governance.data_classification FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY gov_pa_sr ON governance.processing_activity FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY gov_sr_sr ON governance.subprocessor_registry FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY gov_cr_sr ON governance.consent_record FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY gov_dsr_sr ON governance.data_subject_request FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY gov_rp_sr ON governance.retention_policy FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON FUNCTION governance.log_action(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION governance.log_action(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
