-- Sépare la présence du runtime Android de la boucle de lecture.
-- Additif uniquement : aucun jeton, provisioning ou contenu existant n'est modifié.
alter table public.signage_players
  add column if not exists runtime_last_seen_at timestamptz,
  add column if not exists runtime_version text,
  add column if not exists runtime_diagnostics jsonb not null default '{}'::jsonb;

create index if not exists signage_players_runtime_last_seen_idx
  on public.signage_players(runtime_last_seen_at desc);
