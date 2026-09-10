-- =============================================================================
-- Migration 002 — vc_n8n_idempotency + vc_rate_limits
-- Projet : VilleConnect Copilot OS
-- AVERTISSEMENT : STAGING uniquement. Ne pas executer en production sans PR validee.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. vc_n8n_idempotency
--    PRIMARY KEY sur key = garantie atomique entre instances et redemarrages.
--    Le Set memoire en application est une optimisation locale uniquement.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vc_n8n_idempotency (
  key         text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  city_id     uuid        REFERENCES vc_cities(id) ON DELETE CASCADE,
  workflow    text,
  CONSTRAINT vc_n8n_idempotency_pkey PRIMARY KEY (key)
);

COMMENT ON TABLE  vc_n8n_idempotency IS
  'Cles d idempotence pour webhooks n8n. Garantit une seule execution par cle meme entre redemarrages ou instances multiples.';
COMMENT ON COLUMN vc_n8n_idempotency.key IS
  'Cle unique fournie par n8n. Format recommande : <action_log_id>:<n8n_execution_id>:<unix_ts>';
COMMENT ON COLUMN vc_n8n_idempotency.expires_at IS
  'Expiration. Purgeable par job CRON : DELETE FROM vc_n8n_idempotency WHERE expires_at < now()';

-- Index pour la purge par expiration (job maintenance)
CREATE INDEX IF NOT EXISTS idx_vc_n8n_idempotency_expires_at
  ON vc_n8n_idempotency (expires_at);

-- Index pour audit par ville
CREATE INDEX IF NOT EXISTS idx_vc_n8n_idempotency_city_id
  ON vc_n8n_idempotency (city_id) WHERE city_id IS NOT NULL;

-- RLS : service_role uniquement (backend only)
ALTER TABLE vc_n8n_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only_idempotency" ON vc_n8n_idempotency;
CREATE POLICY "service_role_only_idempotency" ON vc_n8n_idempotency
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- Aucune politique pour anon/authenticated = refus implicite (fail closed)


-- -----------------------------------------------------------------------------
-- 2. vc_rate_limits
--    Compteurs de fenetres glissantes 60s par (key, window_start).
--    Fail CLOSED si table indisponible (contrairement a l ancienne version fail-open).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vc_rate_limits (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 1
                           CONSTRAINT vc_rate_limits_count_positive CHECK (count > 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vc_rate_limits_pkey PRIMARY KEY (key, window_start)
);

COMMENT ON TABLE  vc_rate_limits IS
  'Compteurs rate-limit par fenetre 60s. Purgeable : DELETE FROM vc_rate_limits WHERE window_start < now() - INTERVAL ''2 minutes''';
COMMENT ON COLUMN vc_rate_limits.key IS
  'Format : "user:<user_id>" ou "city:<city_id>"';

-- Index pour purge des fenetres expirees
CREATE INDEX IF NOT EXISTS idx_vc_rate_limits_window_start
  ON vc_rate_limits (window_start);

-- RLS : service_role uniquement
ALTER TABLE vc_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only_rate_limits" ON vc_rate_limits;
CREATE POLICY "service_role_only_rate_limits" ON vc_rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- -----------------------------------------------------------------------------
-- 3. increment_rate_limit() — incrémentation atomique
--    Remplace l ancienne RPC qui n existait pas encore.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_key          text,
  p_window_start timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO vc_rate_limits (key, window_start, count, updated_at)
    VALUES (p_key, p_window_start, 1, now())
  ON CONFLICT (key, window_start)
    DO UPDATE SET count = vc_rate_limits.count + 1, updated_at = now()
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION increment_rate_limit IS
  'Incrementation atomique du compteur rate-limit. Retourne le nouveau count.';


-- -----------------------------------------------------------------------------
-- 4. Rollback partiel (pour annulation de cette migration uniquement)
-- Voir 002_rollback.sql
-- -----------------------------------------------------------------------------
