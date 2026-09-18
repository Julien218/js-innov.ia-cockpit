-- Rollback migration 002
-- ATTENTION : ne pas executer en production sans validation.
DROP FUNCTION IF EXISTS increment_rate_limit(text, timestamptz);
DROP TABLE IF EXISTS vc_rate_limits CASCADE;
DROP TABLE IF EXISTS vc_n8n_idempotency CASCADE;
