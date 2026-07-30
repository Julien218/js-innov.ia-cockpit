-- ════════════════════════════════════════════════════════════════════════════
-- Migration : Task Dispatch to Agent
-- Date : 2026-07-30
-- Tables : agent_runs, agent_approvals
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Table agent_runs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  base44_agent_id TEXT,
  base44_conv_id  TEXT,
  base44_msg_id   TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending', 'dispatched', 'running',
                      'awaiting_approval', 'completed', 'failed', 'cancelled'
                    )),
  execution_mode  TEXT NOT NULL DEFAULT 'approval_required'
                    CHECK (execution_mode IN ('prepare_only', 'approval_required', 'autonomous')),
  input           JSONB DEFAULT '{}'::jsonb,
  result          JSONB DEFAULT '{}'::jsonb,
  error           TEXT,
  idempotency_key TEXT NOT NULL,
  requested_by    TEXT NOT NULL,
  organisation    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Index ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id      ON public.agent_runs (task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status        ON public.agent_runs (status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_requested_by  ON public.agent_runs (requested_by);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at     ON public.agent_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_organisation   ON public.agent_runs (organisation);

-- Contrainte unique d'idempotence — un seul run par clé
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_idempotency_key
  ON public.agent_runs (idempotency_key);

-- ─── 2. Table agent_approvals ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id    UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at     TIMESTAMPTZ,
  approved_by     TEXT,
  rejected_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_approvals_run_id   ON public.agent_approvals (agent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_status    ON public.agent_approvals (status);

-- Une seule approbation pending par run
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_approvals_pending_per_run
  ON public.agent_approvals (agent_run_id)
  WHERE status = 'pending';

-- ─── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_approvals ENABLE ROW LEVEL SECURITY;

-- service_role : accès complet (backend uniquement)
CREATE POLICY "service_role_all_agent_runs" ON public.agent_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_agent_approvals" ON public.agent_approvals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- authenticated : lecture de ses propres runs uniquement (défense en profondeur)
CREATE POLICY "auth_read_own_runs" ON public.agent_runs
  FOR SELECT TO authenticated
  USING (requested_by = current_setting('request.jwt.claims', true)::json->>'email');

-- ─── 4. Trigger updated_at ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_runs_updated_at ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_updated_at
  BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. Commentaires ─────────────────────────────────────────────────────────
COMMENT ON TABLE public.agent_runs IS 'Suivi des exécutions agent dispatchées depuis le cockpit';
COMMENT ON TABLE public.agent_approvals IS 'Validations humaines pour exécutions agent en mode approval_required';
COMMENT ON COLUMN public.agent_runs.idempotency_key IS 'Clé unique empêchant les doublons (double clic, retry)';
COMMENT ON COLUMN public.agent_runs.base44_agent_id IS 'ID Base44 de l agent';
COMMENT ON COLUMN public.agent_runs.base44_conv_id IS 'ID de conversation Base44';
COMMENT ON COLUMN public.agent_runs.organisation IS 'Périmètre multi-tenant';

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ════════════════════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS public.agent_approvals CASCADE;
-- DROP TABLE IF EXISTS public.agent_runs CASCADE;
-- DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
-- DROP POLICY IF EXISTS "service_role_all_agent_runs" ON public.agent_runs;
-- DROP POLICY IF EXISTS "service_role_all_agent_approvals" ON public.agent_approvals;
-- DROP POLICY IF EXISTS "auth_read_own_runs" ON public.agent_runs;
-- DROP INDEX IF EXISTS public.uq_agent_runs_idempotency_key;
-- DROP INDEX IF EXISTS public.uq_agent_approvals_pending_per_run;
