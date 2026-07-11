-- =============================================================================
-- VilleConnect Copilot OS — Schéma PostgreSQL v2
-- Tables : 11 (liste définitive, vérifiée)
-- Rollback : migrations/001_rollback.sql
-- =============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. vc_cities
CREATE TABLE IF NOT EXISTS public.vc_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, slug text NOT NULL UNIQUE, region text,
  country text NOT NULL DEFAULT 'BE', config jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. vc_conversations
CREATE TABLE IF NOT EXISTS public.vc_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.vc_cities(id) ON DELETE CASCADE,
  user_id uuid, session_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('web','mobile','telegram','whatsapp')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','archived')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vc_conv_city ON public.vc_conversations(city_id);

-- 3. vc_messages (embeddings HNSW cosinus)
CREATE TABLE IF NOT EXISTS public.vc_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.vc_conversations(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES public.vc_cities(id) ON DELETE CASCADE,
  user_id uuid, role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL, embedding vector(1536), tokens_used int, model_used text,
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vc_msg_conv ON public.vc_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_vc_msg_city ON public.vc_messages(city_id);
CREATE INDEX IF NOT EXISTS idx_vc_msg_emb ON public.vc_messages
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- 4. vc_announcements
CREATE TABLE IF NOT EXISTS public.vc_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.vc_cities(id) ON DELETE CASCADE,
  author_id uuid, title text NOT NULL, content text NOT NULL,
  category text NOT NULL DEFAULT 'info' CHECK (category IN ('info','event','alert','commercial')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_validation','published','archived','rejected')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  publish_at timestamptz, expires_at timestamptz,
  ai_generated boolean NOT NULL DEFAULT false, ai_draft jsonb,
  validated_by uuid, validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vc_ann_city   ON public.vc_announcements(city_id);
CREATE INDEX IF NOT EXISTS idx_vc_ann_status ON public.vc_announcements(status);

-- 5. vc_campaigns
CREATE TABLE IF NOT EXISTS public.vc_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.vc_cities(id) ON DELETE CASCADE,
  creator_id uuid, name text NOT NULL, description text,
  type text NOT NULL CHECK (type IN ('awareness','promotion','event','survey')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_validation','active','paused','completed','cancelled')),
  target_audience jsonb NOT NULL DEFAULT '{}', content jsonb NOT NULL DEFAULT '{}',
  budget numeric(12,2), start_date timestamptz, end_date timestamptz,
  ai_generated boolean NOT NULL DEFAULT false, ai_recommendations jsonb,
  validated_by uuid, validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vc_camp_city ON public.vc_campaigns(city_id);

-- 6. vc_bug_reports
CREATE TABLE IF NOT EXISTS public.vc_bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.vc_cities(id) ON DELETE CASCADE,
  reporter_id uuid, title text NOT NULL, description text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','triaged','in_progress','resolved','closed')),
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('ui','api','data','performance','security','other')),
  affected_feature text, reproduction_steps text, ai_triage jsonb,
  assigned_to uuid, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vc_bug_city ON public.vc_bug_reports(city_id);

-- 7. vc_tasks
CREATE TABLE IF NOT EXISTS public.vc_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.vc_cities(id) ON DELETE CASCADE,
  created_by uuid, assigned_to uuid, title text NOT NULL, description text,
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','blocked','done','cancelled')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  category text NOT NULL DEFAULT 'admin'
    CHECK (category IN ('content','technical','admin','communication','legal')),
  due_date timestamptz, ai_suggested boolean NOT NULL DEFAULT false, ai_context jsonb,
  parent_task_id uuid REFERENCES public.vc_tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vc_tasks_city ON public.vc_tasks(city_id);

-- 8. vc_recommendations
CREATE TABLE IF NOT EXISTS public.vc_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.vc_cities(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('announcement','campaign','task','general')),
  target_id uuid, recommendation text NOT NULL, reasoning text,
  confidence_score float CHECK (confidence_score BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','ignored')),
  created_by_agent text NOT NULL, reviewed_by uuid, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vc_rec_city ON public.vc_recommendations(city_id);

-- 9. ai_action_logs (machine d etats + HITL)
-- Etats : draft → pending_validation → approved/rejected → executing → succeeded/failed/cancelled
-- idempotency_key garantit qu une action approved n est executee qu une seule fois
CREATE TABLE IF NOT EXISTS public.ai_action_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id           uuid REFERENCES public.vc_cities(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','pending_validation','approved','rejected',
                                        'executing','succeeded','failed','cancelled')),
  action_type       text NOT NULL,
  entity_type       text NOT NULL,
  entity_id         uuid,
  agent_name        text NOT NULL,
  run_id            text,
  run_state         jsonb,
  interruption_data jsonb,
  input_summary     text NOT NULL,
  output_summary    text,
  risk_level        text NOT NULL DEFAULT 'low'
                      CHECK (risk_level IN ('low','medium','high','critical')),
  validated_by      uuid,
  validated_at      timestamptz,
  rejection_reason  text,
  n8n_execution_id  text,
  idempotency_key   text UNIQUE,
  duration_ms       int,
  tokens_used       int,
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_action_logs_city   ON public.ai_action_logs(city_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_status ON public.ai_action_logs(status);
CREATE INDEX IF NOT EXISTS idx_action_logs_risk   ON public.ai_action_logs(risk_level);
CREATE INDEX IF NOT EXISTS idx_action_logs_run_id ON public.ai_action_logs(run_id) WHERE run_id IS NOT NULL;

-- 10. vc_memory_vectors (HNSW cosinus)
CREATE TABLE IF NOT EXISTS public.vc_memory_vectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.vc_cities(id) ON DELETE CASCADE,
  entity_type text NOT NULL, entity_id uuid,
  content text NOT NULL, embedding vector(1536), metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vc_mem_city ON public.vc_memory_vectors(city_id);
CREATE INDEX IF NOT EXISTS idx_vc_mem_emb ON public.vc_memory_vectors
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- 11. vc_n8n_webhooks
CREATE TABLE IF NOT EXISTS public.vc_n8n_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid REFERENCES public.vc_cities(id) ON DELETE SET NULL,
  workflow_name text NOT NULL, webhook_url text NOT NULL, action_type text NOT NULL,
  is_active boolean NOT NULL DEFAULT true, last_called_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['vc_cities','vc_conversations','vc_announcements',
    'vc_campaigns','vc_bug_reports','vc_tasks','ai_action_logs']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_upd ON public.%I; CREATE TRIGGER trg_%I_upd BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t,t,t,t);
  END LOOP;
END $$;

-- Fonction RAG (HNSW cosinus)
CREATE OR REPLACE FUNCTION public.match_memory_vectors(
  query_embedding vector(1536), city_id_filter uuid,
  match_threshold float DEFAULT 0.70, match_count int DEFAULT 5
) RETURNS TABLE(id uuid, content text, metadata jsonb, entity_type text, entity_id uuid, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT v.id, v.content, v.metadata, v.entity_type, v.entity_id,
         1 - (v.embedding <=> query_embedding) AS similarity
  FROM public.vc_memory_vectors v
  WHERE v.city_id = city_id_filter
    AND 1 - (v.embedding <=> query_embedding) >= match_threshold
  ORDER BY v.embedding <=> query_embedding LIMIT match_count;
$$;

-- Transition atomique machine d etats
CREATE OR REPLACE FUNCTION public.transition_action_status(
  p_id uuid, p_from text, p_to text,
  p_validated_by uuid DEFAULT NULL, p_rejection_reason text DEFAULT NULL, p_n8n_id text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.ai_action_logs SET
    status = p_to, updated_at = now(),
    validated_by = COALESCE(p_validated_by, validated_by),
    validated_at = CASE WHEN p_validated_by IS NOT NULL THEN now() ELSE validated_at END,
    rejection_reason = COALESCE(p_rejection_reason, rejection_reason),
    n8n_execution_id = COALESCE(p_n8n_id, n8n_execution_id)
  WHERE id = p_id AND status = p_from
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

-- RLS
ALTER TABLE public.vc_cities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vc_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vc_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vc_announcements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vc_campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vc_bug_reports     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vc_tasks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vc_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_action_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vc_memory_vectors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vc_n8n_webhooks    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_cities_read     ON public.vc_cities;
DROP POLICY IF EXISTS p_ann_published   ON public.vc_announcements;
DROP POLICY IF EXISTS p_conv_own        ON public.vc_conversations;
DROP POLICY IF EXISTS p_msg_own         ON public.vc_messages;
DROP POLICY IF EXISTS p_logs_admin      ON public.ai_action_logs;

CREATE POLICY p_cities_read   ON public.vc_cities FOR SELECT USING (is_active = true);
CREATE POLICY p_ann_published ON public.vc_announcements FOR SELECT USING (status = 'published');
CREATE POLICY p_conv_own      ON public.vc_conversations FOR ALL USING (user_id = auth.uid());
CREATE POLICY p_msg_own       ON public.vc_messages FOR SELECT USING (user_id = auth.uid());
CREATE POLICY p_logs_admin    ON public.ai_action_logs FOR ALL
  USING ((auth.jwt() ->> 'role')::text IN ('admin','superadmin'));

-- Donnee initiale DourConnect
INSERT INTO public.vc_cities (name, slug, region, country, config)
VALUES ('DourConnect', 'dourconnect', 'Hainaut', 'BE',
  '{"language":"fr","timezone":"Europe/Brussels","features":["chat","announcements","campaigns","bug_reports","tasks"]}')
ON CONFLICT (slug) DO NOTHING;

COMMIT;
