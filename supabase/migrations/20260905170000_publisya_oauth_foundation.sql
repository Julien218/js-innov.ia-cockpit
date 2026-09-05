-- PUBLISYA — Lot 3 OAuth foundation
-- Stocke uniquement le hash du state anti-CSRF. Aucun code OAuth ou jeton en clair n'est persisté.

BEGIN;

CREATE TABLE IF NOT EXISTS public.publisya_oauth_states (
  state_hash TEXT PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('meta', 'tiktok', 'linkedin', 'youtube')),
  return_path TEXT NOT NULL DEFAULT '/publisya' CHECK (return_path = '/publisya'),
  created_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS publisya_oauth_states_lookup_idx
  ON public.publisya_oauth_states (tenant_id, client_id, provider, expires_at)
  WHERE used_at IS NULL;

ALTER TABLE public.publisya_oauth_states ENABLE ROW LEVEL SECURITY;

-- Comme toutes les données Publisya sensibles, cette table n'est jamais accessible depuis le navigateur.
REVOKE ALL ON TABLE public.publisya_oauth_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.publisya_oauth_states TO service_role;

COMMIT;
