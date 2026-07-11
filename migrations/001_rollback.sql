-- =============================================================================
-- VilleConnect Copilot OS — Rollback migration 001
-- ATTENTION : détruit toutes les données VilleConnect. Ne jamais exécuter en prod
--             sans sauvegarde complète préalable.
-- =============================================================================
BEGIN;
DROP TABLE IF EXISTS public.vc_n8n_webhooks     CASCADE;
DROP TABLE IF EXISTS public.vc_memory_vectors   CASCADE;
DROP TABLE IF EXISTS public.ai_action_logs      CASCADE;
DROP TABLE IF EXISTS public.vc_recommendations  CASCADE;
DROP TABLE IF EXISTS public.vc_tasks            CASCADE;
DROP TABLE IF EXISTS public.vc_bug_reports      CASCADE;
DROP TABLE IF EXISTS public.vc_campaigns        CASCADE;
DROP TABLE IF EXISTS public.vc_announcements    CASCADE;
DROP TABLE IF EXISTS public.vc_messages         CASCADE;
DROP TABLE IF EXISTS public.vc_conversations    CASCADE;
DROP TABLE IF EXISTS public.vc_cities           CASCADE;
DROP FUNCTION IF EXISTS public.match_memory_vectors CASCADE;
DROP FUNCTION IF EXISTS public.transition_action_status CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at CASCADE;
COMMIT;
