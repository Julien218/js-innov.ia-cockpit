-- ELYNEA SOCIAL COMMAND — données multi-marques, multi-projets, sécurisées côté backend.
-- Supabase/Postgres reste la source transactionnelle. Dropbox reçoit les assets et backups chiffrés.

BEGIN;

CREATE TABLE IF NOT EXISTS public.social_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  project_id text,
  client_id text,
  name text NOT NULL,
  slug text NOT NULL,
  canonical_url text NOT NULL,
  manifest_version integer NOT NULL DEFAULT 1 CHECK (manifest_version >= 1),
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_fingerprint text,
  dropbox_path text,
  last_synced_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS public.social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  brand_id uuid REFERENCES public.social_brands(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('facebook','instagram','tiktok')),
  provider_account_id text,
  display_name text,
  username text,
  connection_status text NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('disconnected','pending','connected','expired','revoked','error')),
  credential_ref text,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_at timestamptz,
  expires_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS public.social_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  project_id text,
  client_id text,
  brand_id uuid NOT NULL REFERENCES public.social_brands(id) ON DELETE RESTRICT,
  name text NOT NULL,
  objective text,
  audience text,
  landing_url text,
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  autonomy_mode text NOT NULL DEFAULT 'assisted' CHECK (autonomy_mode IN ('assisted','semi_auto','autopilot')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','planning','active','paused','completed','cancelled')),
  brief text,
  start_at timestamptz,
  end_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dropbox_path text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  project_id text,
  client_id text,
  brand_id uuid REFERENCES public.social_brands(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.social_campaigns(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image','video','audio','thumbnail','document','other')),
  title text,
  source text,
  file_url text,
  dropbox_path text,
  mime_type text,
  width integer,
  height integer,
  duration_seconds numeric(12,3),
  sha256 text,
  generation_provider text,
  generation_model text,
  prompt_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  project_id text,
  client_id text,
  brand_id uuid NOT NULL REFERENCES public.social_brands(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES public.social_campaigns(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('facebook','instagram','tiktok')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generating','ready','awaiting_review','approved','scheduled','publishing','published','retrying','failed','rejected','cancelled','expired')),
  title text,
  caption text,
  hashtags jsonb NOT NULL DEFAULT '[]'::jsonb,
  cta_text text,
  target_url text,
  tracking_url text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at timestamptz,
  published_at timestamptz,
  provider_post_id text,
  provider_status text,
  idempotency_key text,
  approval jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.social_publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('facebook','instagram','tiktok')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','awaiting_provider','publishing','published','retrying','failed','cancelled')),
  idempotency_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_attempt_at timestamptz,
  provider_job_id text,
  error text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.social_post_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  post_id uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  impressions bigint,
  reach bigint,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  clicks bigint,
  raw_metrics jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.social_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  campaign_id uuid REFERENCES public.social_campaigns(id) ON DELETE SET NULL,
  post_id uuid REFERENCES public.social_posts(id) ON DELETE SET NULL,
  conversion_type text NOT NULL,
  external_id text,
  source text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, conversion_type, external_id)
);

CREATE TABLE IF NOT EXISTS public.social_ai_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  campaign_id uuid REFERENCES public.social_campaigns(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.social_posts(id) ON DELETE CASCADE,
  decision_type text NOT NULL,
  reason text,
  source_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposal jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_run_id text,
  created_by text NOT NULL DEFAULT 'elynea',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  provider text NOT NULL,
  provider_event_id text,
  event_type text,
  verified boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS social_brands_tenant_idx ON public.social_brands(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS social_campaigns_tenant_status_idx ON public.social_campaigns(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS social_posts_tenant_schedule_idx ON public.social_posts(tenant_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS social_jobs_due_idx ON public.social_publish_jobs(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS social_metrics_post_idx ON public.social_post_metrics(post_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS social_conversions_campaign_idx ON public.social_conversions(campaign_id, occurred_at DESC);

ALTER TABLE public.social_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publish_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_ai_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.social_brands, public.social_accounts, public.social_campaigns, public.social_assets,
  public.social_posts, public.social_publish_jobs, public.social_post_metrics, public.social_conversions,
  public.social_ai_decisions, public.social_webhook_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_brands, public.social_accounts, public.social_campaigns,
  public.social_assets, public.social_posts, public.social_publish_jobs, public.social_post_metrics,
  public.social_conversions, public.social_ai_decisions, public.social_webhook_events TO service_role;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'social_brands','social_accounts','social_campaigns','social_assets','social_posts',
    'social_publish_jobs','social_post_metrics','social_conversions','social_ai_decisions','social_webhook_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_service_role_all ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

COMMIT;
