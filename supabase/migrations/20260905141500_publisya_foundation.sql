-- PUBLISYA — fondation multi-tenant
-- Migration additive. Elle prépare les données sans activer aucune publication externe.
-- Les tables restent dans public avec préfixe publisya_ afin de réutiliser le PostgREST
-- déjà employé par le Cockpit, sans exposer un schéma Supabase supplémentaire.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.publisya_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.publisya_social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('meta', 'facebook', 'instagram', 'tiktok', 'linkedin', 'youtube')),
  provider_account_id TEXT NOT NULL,
  account_name TEXT,
  account_type TEXT,
  connection_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (connection_status IN ('pending', 'connected', 'reconnect_required', 'revoked', 'error')),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_ciphertext TEXT,
  refresh_token_ciphertext TEXT,
  token_expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  connected_by TEXT,
  disconnected_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_id, provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS public.publisya_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  brand_profile_id TEXT,
  title TEXT NOT NULL,
  objective TEXT,
  source_language TEXT NOT NULL DEFAULT 'fr',
  target_platforms TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'analyzing', 'generated', 'awaiting_approval', 'needs_changes',
      'approved', 'scheduled', 'publishing', 'published', 'partially_published',
      'failed', 'canceled', 'expired'
    )),
  human_approval_required BOOLEAN NOT NULL DEFAULT true,
  instructions TEXT,
  analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'Europe/Brussels',
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.publisya_media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  campaign_id UUID NOT NULL REFERENCES public.publisya_campaigns(id) ON DELETE CASCADE,
  parent_asset_id UUID REFERENCES public.publisya_media_assets(id) ON DELETE SET NULL,
  asset_role TEXT NOT NULL DEFAULT 'source'
    CHECK (asset_role IN ('source', 'master', 'variant', 'thumbnail', 'subtitle', 'cover')),
  platform TEXT,
  storage_provider TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes BIGINT,
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC,
  sha256 TEXT,
  media_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, storage_provider, storage_key)
);

CREATE TABLE IF NOT EXISTS public.publisya_post_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  campaign_id UUID NOT NULL REFERENCES public.publisya_campaigns(id) ON DELETE CASCADE,
  social_account_id UUID REFERENCES public.publisya_social_accounts(id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'tiktok', 'linkedin', 'youtube')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generated', 'needs_changes', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'canceled')),
  caption TEXT,
  title TEXT,
  description TEXT,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  call_to_action TEXT,
  destination_url TEXT,
  alt_text TEXT,
  cover_text TEXT,
  chapters JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  media_asset_ids UUID[] NOT NULL DEFAULT '{}',
  generated_by TEXT,
  generated_at TIMESTAMPTZ,
  last_edited_by TEXT,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  remote_post_id TEXT,
  remote_post_url TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, platform, version)
);

CREATE TABLE IF NOT EXISTS public.publisya_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  campaign_id UUID NOT NULL REFERENCES public.publisya_campaigns(id) ON DELETE CASCADE,
  post_variant_id UUID REFERENCES public.publisya_post_variants(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'changes_requested', 'approval_revoked')),
  comment TEXT,
  variant_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  acted_by TEXT NOT NULL,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.publisya_publication_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  campaign_id UUID NOT NULL REFERENCES public.publisya_campaigns(id) ON DELETE CASCADE,
  post_variant_id UUID NOT NULL REFERENCES public.publisya_post_variants(id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL REFERENCES public.publisya_social_accounts(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'locked', 'publishing', 'processing', 'published', 'retry_wait', 'failed', 'canceled')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Brussels',
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 4 CHECK (max_attempts > 0),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  next_attempt_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  remote_publish_id TEXT,
  remote_post_id TEXT,
  completed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.publisya_publication_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  publication_job_id UUID NOT NULL REFERENCES public.publisya_publication_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IN ('success', 'processing', 'retryable_error', 'permanent_error')),
  http_status INTEGER,
  provider_error_code TEXT,
  provider_error_message TEXT,
  request_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INTEGER,
  UNIQUE (publication_job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS public.publisya_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  post_variant_id UUID NOT NULL REFERENCES public.publisya_post_variants(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  impressions BIGINT,
  reach BIGINT,
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  shares BIGINT,
  saves BIGINT,
  clicks BIGINT,
  watch_time_seconds NUMERIC,
  raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_variant_id, metric_date)
);

CREATE INDEX IF NOT EXISTS publisya_campaigns_tenant_client_status_idx
  ON public.publisya_campaigns (tenant_id, client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS publisya_variants_campaign_platform_idx
  ON public.publisya_post_variants (campaign_id, platform, version DESC);
CREATE INDEX IF NOT EXISTS publisya_jobs_due_idx
  ON public.publisya_publication_jobs (status, scheduled_at, next_attempt_at)
  WHERE status IN ('queued', 'retry_wait');
CREATE INDEX IF NOT EXISTS publisya_attempts_job_idx
  ON public.publisya_publication_attempts (publication_job_id, attempt_number DESC);

DROP TRIGGER IF EXISTS publisya_social_accounts_updated_at ON public.publisya_social_accounts;
CREATE TRIGGER publisya_social_accounts_updated_at BEFORE UPDATE ON public.publisya_social_accounts
FOR EACH ROW EXECUTE FUNCTION public.publisya_set_updated_at();

DROP TRIGGER IF EXISTS publisya_campaigns_updated_at ON public.publisya_campaigns;
CREATE TRIGGER publisya_campaigns_updated_at BEFORE UPDATE ON public.publisya_campaigns
FOR EACH ROW EXECUTE FUNCTION public.publisya_set_updated_at();

DROP TRIGGER IF EXISTS publisya_media_assets_updated_at ON public.publisya_media_assets;
CREATE TRIGGER publisya_media_assets_updated_at BEFORE UPDATE ON public.publisya_media_assets
FOR EACH ROW EXECUTE FUNCTION public.publisya_set_updated_at();

DROP TRIGGER IF EXISTS publisya_post_variants_updated_at ON public.publisya_post_variants;
CREATE TRIGGER publisya_post_variants_updated_at BEFORE UPDATE ON public.publisya_post_variants
FOR EACH ROW EXECUTE FUNCTION public.publisya_set_updated_at();

DROP TRIGGER IF EXISTS publisya_publication_jobs_updated_at ON public.publisya_publication_jobs;
CREATE TRIGGER publisya_publication_jobs_updated_at BEFORE UPDATE ON public.publisya_publication_jobs
FOR EACH ROW EXECUTE FUNCTION public.publisya_set_updated_at();

ALTER TABLE public.publisya_social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publisya_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publisya_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publisya_post_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publisya_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publisya_publication_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publisya_publication_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publisya_metrics_daily ENABLE ROW LEVEL SECURITY;

-- Le navigateur n'accède jamais directement aux tables Publisya.
REVOKE ALL ON TABLE public.publisya_social_accounts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.publisya_campaigns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.publisya_media_assets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.publisya_post_variants FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.publisya_approvals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.publisya_publication_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.publisya_publication_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.publisya_metrics_daily FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.publisya_set_updated_at() FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.publisya_social_accounts TO service_role;
GRANT ALL ON TABLE public.publisya_campaigns TO service_role;
GRANT ALL ON TABLE public.publisya_media_assets TO service_role;
GRANT ALL ON TABLE public.publisya_post_variants TO service_role;
GRANT ALL ON TABLE public.publisya_approvals TO service_role;
GRANT ALL ON TABLE public.publisya_publication_jobs TO service_role;
GRANT ALL ON TABLE public.publisya_publication_attempts TO service_role;
GRANT ALL ON TABLE public.publisya_metrics_daily TO service_role;
GRANT EXECUTE ON FUNCTION public.publisya_set_updated_at() TO service_role;

COMMIT;
