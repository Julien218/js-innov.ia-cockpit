-- ============================================================
-- 001_data_governance_rgpd.sql
-- Data Governance & RGPD — Cockpit JS-Innov.IA
-- Cible: Supabase gfjpryakxzdzwnazlsfz (donnees metier)
-- Version: v1.0.0 — 2026-08-13
-- Statut: A VALIDER JURIDIQUEMENT pour les durees et bases legales
-- ============================================================

BEGIN;

-- 0. Schema de governance
CREATE SCHEMA IF NOT EXISTS governance;

-- 1. audit_log — Journal d audit general
CREATE TABLE IF NOT EXISTS governance.audit_log (
  id              BIGSERIAL PRIMARY KEY,
  actor_id        TEXT,
  actor_email     TEXT,
  actor_role      TEXT,
  actor_ip_hash   TEXT,
  actor_ua        TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  tenant_id       TEXT DEFAULT 'jsinnovia',
  description     TEXT,
  metadata        JSONB DEFAULT '{}'::jsonb,
  severity        TEXT DEFAULT 'info' CHECK (severity IN ('info','warning','error','critical')),
  source          TEXT DEFAULT 'cockpit',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON governance.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON governance.audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON governance.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant  ON governance.audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON governance.audit_log(created_at DESC);

-- 2. data_classification — Referentiel
CREATE TABLE IF NOT EXISTS governance.data_classification (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  color       TEXT,
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO governance.data_classification (id, label, description, color, sort_order) VALUES
  ('public',       'Public',       'Donnees librement communicables',                     '#10b981', 1),
  ('internal',     'Interne',      'Usage interne JS-Innov.IA, pas de diffusion externe',  '#3b82f6', 2),
  ('personal',     'Personnel',    'Donnees personnelles identifiantes',                    '#f59e0b', 3),
  ('confidential', 'Confidentiel', 'Acces restreint — donnees business sensibles',         '#ef4444', 4),
  ('sensitive',    'Sensible',     'Donnees tres sensibles (sante, finances, secrets)',     '#9911aa', 5)
ON CONFLICT (id) DO NOTHING;

-- 3. processing_activity — Registre des traitements (Art. 30 RGPD)
CREATE TABLE IF NOT EXISTS governance.processing_activity (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  purpose                 TEXT NOT NULL,
  categories_of_persons   TEXT,
  categories_of_data      TEXT,
  legal_basis             TEXT,
  legal_basis_note        TEXT,
  recipients              TEXT,
  subprocessors           TEXT,
  transfers_outside_eee   BOOLEAN DEFAULT false,
  transfer_mechanism      TEXT,
  retention_period        TEXT,
  security_measures       TEXT,
  owner                   TEXT,
  legal_validation_status TEXT DEFAULT 'pending' CHECK (legal_validation_status IN ('pending','validated','rejected')),
  validated_by            TEXT,
  validated_at            TIMESTAMPTZ,
  tenant_id               TEXT DEFAULT 'jsinnovia',
  is_active               BOOLEAN DEFAULT true,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pa_tenant ON governance.processing_activity(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pa_status ON governance.processing_activity(legal_validation_status);

-- 4. subprocessor_registry — Registre des sous-traitants (Art. 28)
CREATE TABLE IF NOT EXISTS governance.subprocessor_registry (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name         TEXT NOT NULL,
  service_purpose       TEXT NOT NULL,
  categories_of_data    TEXT,
  processing_location   TEXT,
  dpa_signed            BOOLEAN DEFAULT false,
  dpa_date              DATE,
  transfer_mechanism    TEXT,
  sub_subprocessors     TEXT,
  validation_status     TEXT DEFAULT 'pending' CHECK (validation_status IN ('pending','validated','rejected')),
  owner                 TEXT,
  last_verified         DATE,
  tenant_id             TEXT DEFAULT 'jsinnovia',
  is_active             BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

INSERT INTO governance.subprocessor_registry (provider_name, service_purpose, categories_of_data, processing_location, dpa_signed, transfer_mechanism, validation_status) VALUES
  ('Railway',  'Hebergement backend + DB',      'Toutes donnees metier',        'USA/UE',  false, 'pending',  'pending'),
  ('Supabase', 'Base PostgreSQL + Auth',       'Utilisateurs, donnees metier', 'UE',      false, 'adequacy', 'pending'),
  ('Dropbox',  'Coffre documentaire',          'Documents, factures, devis',   'USA',     false, 'scc',      'pending'),
  ('OpenAI',   'Modeles IA (GPT)',             'Prompts, resumes, analyses',   'USA',     false, 'scc',      'pending'),
  ('xAI',      'Modeles IA (Grok)',            'Prompts, resumes, analyses',   'USA',     false, 'scc',      'pending'),
  ('IONOS',    'Email professionnel IMAP/SMTP','Emails, metadonnees',           'UE',      false, 'adequacy', 'pending'),
  ('Stripe',   'Paiements',                     'Donnees de paiement',          'USA/UE',  false, 'scc',      'pending'),
  ('Peppol',   'Facturation electronique B2B',  'Factures XML',                 'UE',      false, 'adequacy', 'pending'),
  ('Google',   'Drive, Calendar, OAuth',        'Fichiers, calendrier',         'Global',  false, 'scc',      'pending'),
  ('Base44',   'Plateforme agent IA',           'Conversations, memoire',      'USA/UE',  false, 'scc',      'pending')
ON CONFLICT DO NOTHING;

-- 5. consent_record — Registre des consentements
CREATE TABLE IF NOT EXISTS governance.consent_record (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_email            TEXT NOT NULL,
  person_name             TEXT,
  person_id               TEXT,
  purpose                 TEXT NOT NULL,
  text_version            TEXT,
  text_hash               TEXT,
  given_at                TIMESTAMPTZ DEFAULT now(),
  withdrawn_at            TIMESTAMPTZ,
  method                  TEXT DEFAULT 'web_form',
  status                  TEXT DEFAULT 'active' CHECK (status IN ('active','withdrawn','expired')),
  proof_metadata          JSONB DEFAULT '{}'::jsonb,
  tenant_id               TEXT DEFAULT 'jsinnovia',
  processing_activity_id  UUID REFERENCES governance.processing_activity(id),
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_email   ON governance.consent_record(person_email);
CREATE INDEX IF NOT EXISTS idx_consent_status  ON governance.consent_record(status);
CREATE INDEX IF NOT EXISTS idx_consent_purpose ON governance.consent_record(purpose);
CREATE INDEX IF NOT EXISTS idx_consent_tenant  ON governance.consent_record(tenant_id);

-- 6. data_subject_request — Demandes RGPD
CREATE TABLE IF NOT EXISTS governance.data_subject_request (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type            TEXT NOT NULL CHECK (request_type IN (
    'access','rectification','erasure','restriction','objection','portability','withdraw_consent'
  )),
  requester_name          TEXT,
  requester_email         TEXT NOT NULL,
  requester_phone         TEXT,
  requester_id            TEXT,
  tenant_id               TEXT DEFAULT 'jsinnovia',
  description             TEXT,
  scope                   TEXT,
  status                  TEXT DEFAULT 'received' CHECK (status IN (
    'received','in_review','processing','completed','rejected','partially_completed'
  )),
  assigned_to             TEXT,
  received_at             TIMESTAMPTZ DEFAULT now(),
  due_date                TIMESTAMPTZ DEFAULT (now() + INTERVAL '1 month'),
  completed_at            TIMESTAMPTZ,
  resolution_summary      TEXT,
  rejection_reason        TEXT,
  legal_retention_note    TEXT,
  metadata                JSONB DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsr_status   ON governance.data_subject_request(status);
CREATE INDEX IF NOT EXISTS idx_dsr_email    ON governance.data_subject_request(requester_email);
CREATE INDEX IF NOT EXISTS idx_dsr_type     ON governance.data_subject_request(request_type);
CREATE INDEX IF NOT EXISTS idx_dsr_tenant   ON governance.data_subject_request(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dsr_due_date ON governance.data_subject_request(due_date);

-- 7. retention_policy — Politiques de conservation
CREATE TABLE IF NOT EXISTS governance.retention_policy (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category                TEXT NOT NULL,
  category_label          TEXT,
  retention_period_days   INTEGER,
  retention_description   TEXT,
  action_on_expiry        TEXT DEFAULT 'anonymize' CHECK (action_on_expiry IN ('delete','anonymize','archive','review')),
  justification            TEXT,
  legal_reference          TEXT,
  validation_status       TEXT DEFAULT 'pending' CHECK (validation_status IN ('pending','validated','rejected')),
  validated_by            TEXT,
  validated_at            TIMESTAMPTZ,
  tenant_id               TEXT DEFAULT 'jsinnovia',
  last_reviewed_at        TIMESTAMPTZ,
  is_active               BOOLEAN DEFAULT true,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

INSERT INTO governance.retention_policy (category, category_label, retention_period_days, retention_description, action_on_expiry, justification, legal_reference, validation_status) VALUES
  ('invoices',        'Factures',         3650, '10 ans (obligation comptable belge)',                          'review',    'Conservation des livres et pièces justificatives', 'Code de droit économique, art. III.86', 'pending'),
  ('quotes',          'Devis',            730,  '2 ans',                                                        'review',    'Delai raisonnable suivi commercial',               NULL,                                 'pending'),
  ('client_data',     'Donnees client',   NULL, 'Tant que relation commerciale dure + delai prescription',       'review',    'Base legale: execution du contrat',               'Art. 6(1)(b) RGPD — A VALIDER',     'pending'),
  ('leads',           'Leads/prospects',  1095, '3 ans',                                                        'anonymize', 'Duree raisonnable prospection',                   'Art. 6(1)(f) RGPD — A VALIDER',     'pending'),
  ('logs',            'Logs audit',       365,  '1 an',                                                         'review',    'Conservation securite et tracabilite',             NULL,                                 'pending'),
  ('documents',       'Documents',       NULL, 'Lie a la politique categorie parente',                         'review',    'Depend du type de document',                      NULL,                                 'pending'),
  ('consent_records', 'Consentements',   1095, '3 ans apres retrait',                                         'review',    'Preuve du consentement',                          'Art. 7(1) RGPD',                     'pending'),
  ('email_metadata',  'Metadonnees email', 365, '1 an',                                                        'anonymize', 'Tracabilite communication',                        NULL,                                 'pending'),
  ('agent_runs',      'Executions agents IA', 90, '90 jours',                                                    'review',    'Tracabilite des actions IA',                      NULL,                                 'pending')
ON CONFLICT DO NOTHING;

-- 8. Ajout colonnes multi-tenant sur tables metier existantes
ALTER TABLE public."Client"     ADD COLUMN IF NOT EXISTS organisation_id TEXT DEFAULT 'jsinnovia';
ALTER TABLE public."Client"     ADD COLUMN IF NOT EXISTS created_by     TEXT;
ALTER TABLE public."Client"     ADD COLUMN IF NOT EXISTS updated_by      TEXT;

ALTER TABLE public."Lead"       ADD COLUMN IF NOT EXISTS organisation_id TEXT DEFAULT 'jsinnovia';
ALTER TABLE public."Lead"       ADD COLUMN IF NOT EXISTS created_by      TEXT;
ALTER TABLE public."Lead"       ADD COLUMN IF NOT EXISTS updated_by       TEXT;

ALTER TABLE public."Demande"    ADD COLUMN IF NOT EXISTS organisation_id TEXT DEFAULT 'jsinnovia';
ALTER TABLE public."Demande"    ADD COLUMN IF NOT EXISTS created_by      TEXT;
ALTER TABLE public."Demande"    ADD COLUMN IF NOT EXISTS updated_by       TEXT;

ALTER TABLE public."Devis"      ADD COLUMN IF NOT EXISTS organisation_id TEXT DEFAULT 'jsinnovia';
ALTER TABLE public."Devis"      ADD COLUMN IF NOT EXISTS created_by     TEXT;
ALTER TABLE public."Devis"      ADD COLUMN IF NOT EXISTS updated_by      TEXT;

ALTER TABLE public."Facture"    ADD COLUMN IF NOT EXISTS organisation_id TEXT DEFAULT 'jsinnovia';
ALTER TABLE public."Facture"    ADD COLUMN IF NOT EXISTS created_by     TEXT;
ALTER TABLE public."Facture"    ADD COLUMN IF NOT EXISTS updated_by      TEXT;

ALTER TABLE public."Projet"     ADD COLUMN IF NOT EXISTS organisation_id TEXT DEFAULT 'jsinnovia';
ALTER TABLE public."Projet"     ADD COLUMN IF NOT EXISTS created_by     TEXT;
ALTER TABLE public."Projet"     ADD COLUMN IF NOT EXISTS updated_by      TEXT;

ALTER TABLE public."Tache"      ADD COLUMN IF NOT EXISTS organisation_id TEXT DEFAULT 'jsinnovia';
ALTER TABLE public."Tache"      ADD COLUMN IF NOT EXISTS created_by      TEXT;
ALTER TABLE public."Tache"      ADD COLUMN IF NOT EXISTS updated_by       TEXT;

ALTER TABLE public."Service"    ADD COLUMN IF NOT EXISTS organisation_id TEXT DEFAULT 'jsinnovia';
ALTER TABLE public."Commission" ADD COLUMN IF NOT EXISTS organisation_id TEXT DEFAULT 'jsinnovia';

-- 9. Index multi-tenant
CREATE INDEX IF NOT EXISTS idx_client_org  ON public."Client"(organisation_id);
CREATE INDEX IF NOT EXISTS idx_lead_org    ON public."Lead"(organisation_id);
CREATE INDEX IF NOT EXISTS idx_demande_org ON public."Demande"(organisation_id);
CREATE INDEX IF NOT EXISTS idx_devis_org   ON public."Devis"(organisation_id);
CREATE INDEX IF NOT EXISTS idx_facture_org ON public."Facture"(organisation_id);
CREATE INDEX IF NOT EXISTS idx_projet_org  ON public."Projet"(organisation_id);
CREATE INDEX IF NOT EXISTS idx_tache_org   ON public."Tache"(organisation_id);

-- 10. RLS sur tables de governance (service_role uniquement)
ALTER TABLE governance.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.data_classification ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.processing_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.subprocessor_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.consent_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.data_subject_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.retention_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gov_audit_sr" ON governance.audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "gov_dc_sr"    ON governance.data_classification FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "gov_pa_sr"    ON governance.processing_activity FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "gov_sr_sr"    ON governance.subprocessor_registry FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "gov_cr_sr"    ON governance.consent_record FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "gov_dsr_sr"   ON governance.data_subject_request FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "gov_rp_sr"    ON governance.retention_policy FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 11. Vue audit_log_recent
CREATE OR REPLACE VIEW governance.audit_log_recent WITH (security_invoker = true) AS
SELECT * FROM governance.audit_log ORDER BY created_at DESC LIMIT 1000;

-- 12. Fonction helper: log_action
CREATE OR REPLACE FUNCTION governance.log_action(
  p_action TEXT, p_entity_type TEXT DEFAULT NULL, p_entity_id TEXT DEFAULT NULL,
  p_actor_id TEXT DEFAULT NULL, p_actor_email TEXT DEFAULT NULL, p_actor_role TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb,
  p_severity TEXT DEFAULT 'info', p_source TEXT DEFAULT 'cockpit', p_tenant_id TEXT DEFAULT 'jsinnovia'
) RETURNS governance.audit_log AS $$
DECLARE v_row governance.audit_log;
BEGIN
  INSERT INTO governance.audit_log (action, entity_type, entity_id, actor_id, actor_email, actor_role, description, metadata, severity, source, tenant_id)
  VALUES (p_action, p_entity_type, p_entity_id, p_actor_id, p_actor_email, p_actor_role, p_description, p_metadata, p_severity, p_source, p_tenant_id)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION governance.log_action(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION governance.log_action(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
