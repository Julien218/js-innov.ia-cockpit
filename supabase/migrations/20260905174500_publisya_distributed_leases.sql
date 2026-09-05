-- PUBLISYA — distributed publication leases foundation
-- Aucun scheduler n'est activé par cette migration. Elle prépare seulement une réclamation atomique de jobs.

BEGIN;

ALTER TABLE public.publisya_publication_jobs
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS publisya_jobs_lease_expiry_idx
  ON public.publisya_publication_jobs (lease_expires_at)
  WHERE status = 'locked';

CREATE OR REPLACE FUNCTION public.publisya_claim_publication_jobs(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 1,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS SETOF public.publisya_publication_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 1), 1), 20);
  v_lease_seconds INTEGER := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 15), 300);
  v_worker_id TEXT := LEFT(BTRIM(COALESCE(p_worker_id, '')), 160);
BEGIN
  IF v_worker_id = '' THEN
    RAISE EXCEPTION 'worker_id_required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
    FROM public.publisya_publication_jobs AS j
    JOIN public.publisya_campaigns AS c
      ON c.id = j.campaign_id
     AND c.tenant_id = j.tenant_id
     AND c.client_id = j.client_id
    JOIN public.publisya_post_variants AS v
      ON v.id = j.post_variant_id
     AND v.campaign_id = j.campaign_id
     AND v.tenant_id = j.tenant_id
     AND v.client_id = j.client_id
    JOIN public.publisya_social_accounts AS a
      ON a.id = j.social_account_id
     AND a.tenant_id = j.tenant_id
     AND a.client_id = j.client_id
    WHERE j.attempt_count < j.max_attempts
      AND c.status IN ('approved', 'scheduled', 'publishing')
      AND v.status = 'approved'
      AND a.connection_status = 'connected'
      AND (
        (
          j.status IN ('queued', 'retry_wait')
          AND j.scheduled_at <= now()
          AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= now())
        )
        OR (
          j.status = 'locked'
          AND j.lease_expires_at IS NOT NULL
          AND j.lease_expires_at <= now()
        )
      )
    ORDER BY COALESCE(j.next_attempt_at, j.scheduled_at), j.created_at, j.id
    FOR UPDATE OF j SKIP LOCKED
    LIMIT v_limit
  ), claimed AS (
    UPDATE public.publisya_publication_jobs AS j
    SET status = 'locked',
        locked_at = now(),
        locked_by = v_worker_id,
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => v_lease_seconds),
        updated_at = now()
    FROM candidates
    WHERE j.id = candidates.id
    RETURNING j.*
  )
  SELECT * FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.publisya_renew_publication_lease(
  p_job_id UUID,
  p_lease_token UUID,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS public.publisya_publication_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_job public.publisya_publication_jobs;
  v_lease_seconds INTEGER := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 15), 300);
  v_worker_id TEXT := LEFT(BTRIM(COALESCE(p_worker_id, '')), 160);
BEGIN
  IF v_worker_id = '' OR p_job_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'lease_identity_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.publisya_publication_jobs AS j
  SET lease_expires_at = now() + make_interval(secs => v_lease_seconds),
      updated_at = now()
  WHERE j.id = p_job_id
    AND j.status IN ('locked', 'publishing', 'processing')
    AND j.locked_by = v_worker_id
    AND j.lease_token = p_lease_token
    AND j.lease_expires_at > now()
  RETURNING j.* INTO v_job;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'lease_not_owned_or_expired' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.publisya_release_publication_lease(
  p_job_id UUID,
  p_lease_token UUID,
  p_worker_id TEXT,
  p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.publisya_publication_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_job public.publisya_publication_jobs;
  v_worker_id TEXT := LEFT(BTRIM(COALESCE(p_worker_id, '')), 160);
BEGIN
  IF v_worker_id = '' OR p_job_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'lease_identity_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.publisya_publication_jobs AS j
  SET status = CASE WHEN p_next_attempt_at IS NULL THEN 'queued' ELSE 'retry_wait' END,
      next_attempt_at = p_next_attempt_at,
      locked_at = NULL,
      locked_by = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE j.id = p_job_id
    AND j.status = 'locked'
    AND j.locked_by = v_worker_id
    AND j.lease_token = p_lease_token
    AND j.lease_expires_at > now()
  RETURNING j.* INTO v_job;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'lease_not_owned_or_expired' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_job;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publisya_claim_publication_jobs(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.publisya_renew_publication_lease(UUID, UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.publisya_release_publication_lease(UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.publisya_claim_publication_jobs(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.publisya_renew_publication_lease(UUID, UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.publisya_release_publication_lease(UUID, UUID, TEXT, TIMESTAMPTZ) TO service_role;

COMMIT;
