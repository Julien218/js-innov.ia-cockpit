-- ════════════════════════════════════════════════════════════════════════════
-- Migration: Task Dispatch to Agent (v2 — async + idempotence par intention)
-- Date: 2026-07-30
-- Tables: agent_runs, agent_approvals
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Table: agent_runs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         TEXT NOT NULL,
    agent_id        TEXT NOT NULL,                     -- rôle fonctionnel (ex: developer-agent)
    functional_role TEXT,                              -- libellé du rôle (ex: Développement)
    provider_agent_id TEXT,                            -- Base44 agent ID réel (ex: 6a1845e1...)
    provider_name   TEXT,                              -- nom du provider (ex: NOVA JS-Innov.IA)
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'dispatching', 'dispatched', 'running',
                                      'awaiting_approval', 'completed', 'failed', 'cancelled')),
    execution_mode  TEXT NOT NULL DEFAULT 'approval_required'
                    CHECK (execution_mode IN ('prepare_only', 'approval_required', 'autonomous')),
    input           JSONB,
    result          JSONB,
    error           TEXT,
    idempotency_key TEXT NOT NULL,                     -- UUID fourni par le frontend (par intention)
    requested_by    TEXT NOT NULL,                     -- email de l'utilisateur
    organisation    TEXT,                               -- organisation (multi-tenant)
    base44_agent_id TEXT,                               -- Base44 agent ID utilisé
    base44_conv_id  TEXT,                               -- Base44 conversation ID
    base44_msg_id   TEXT,                               -- Base44 message ID
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Contrainte UNIQUE sur idempotency_key (idempotence par intention) ──────
-- Un même clientKey (UUID frontend) = un seul run, définitivement.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_idempotency_key
    ON public.agent_runs (idempotency_key);

-- ─── Index pour les requêtes fréquentes ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agent_runs_task_id    ON public.agent_runs (task_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status     ON public.agent_runs (status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_requested   ON public.agent_runs (requested_by);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created     ON public.agent_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_organisation ON public.agent_runs (organisation);

-- ─── Trigger updated_at ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_agent_runs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_runs_updated ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_updated
    BEFORE UPDATE ON public.agent_runs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_agent_runs_updated_at();

-- ─── Table: agent_approvals ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_approvals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_run_id    UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by     TEXT,
    rejected_by     TEXT,
    approved_at     TIMESTAMPTZ,
    rejected_at     TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une seule approbation pending par run
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_approvals_pending
    ON public.agent_approvals (agent_run_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_approvals_run ON public.agent_approvals (agent_run_id);

-- ─── RLS (Row Level Security) ────────────────────────────────────────────────
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_approvals ENABLE ROW LEVEL SECURITY;

-- service_role : accès complet
CREATE POLICY "agent_runs_service_all" ON public.agent_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "agent_approvals_service_all" ON public.agent_approvals
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- authenticated : lecture de ses propres runs uniquement
CREATE POLICY "agent_runs_auth_read_own" ON public.agent_runs
    FOR SELECT TO authenticated
    USING (requested_by = (auth.jwt() ->> 'email')::text);

COMMENT ON TABLE public.agent_runs IS 'Exécutions de tâches dispatchées vers des agents IA (v2 — async + idempotence par intention)';
COMMENT ON COLUMN public.agent_runs.idempotency_key IS 'UUID fourni par le frontend à chaque intention de dispatch. Contrainte UNIQUE garantit qu''un même clientKey = un seul run. Retry/double-clic → même run. Refresh/relance → nouveau clientKey → nouveau run.';
COMMENT ON COLUMN public.agent_runs.provider_agent_id IS 'Base44 agent ID réel (provider). Sert à l''exécution technique. Le frontend n''affiche que functional_role.';
COMMENT ON COLUMN public.agent_runs.functional_role IS 'Rôle fonctionnel affiché à l''utilisateur (ex: Développement, Communication). Différent du provider réel.';
COMMENT ON COLUMN public.agent_runs.status IS 'pending → dispatching → dispatched → running → awaiting_approval → completed/failed/cancelled';

-- ─── ROLLBACK ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.agent_approvals CASCADE;
-- DROP TABLE IF EXISTS public.agent_runs CASCADE;
-- DROP FUNCTION IF EXISTS public.update_agent_runs_updated_at() CASCADE;

COMMIT;
