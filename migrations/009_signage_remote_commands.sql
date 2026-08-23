-- File de commandes distante additive pour Pixelium Player.
-- Les commandes sont limitées au Player ciblé, expirent automatiquement et
-- ne contiennent jamais de jeton d'association ou de secret.
create table if not exists public.signage_player_commands (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  player_id uuid not null references public.signage_players(id) on delete cascade,
  command text not null check (command in (
    'restart_player', 'reload_content', 'pause_playback', 'resume_playback',
    'set_volume', 'set_brightness', 'set_orientation', 'set_display_mode',
    'update_now'
  )),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','delivered','succeeded','failed','expired')),
  created_by text not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  result jsonb not null default '{}'::jsonb
);

create index if not exists signage_player_commands_pending_idx
  on public.signage_player_commands(player_id, status, created_at);
create index if not exists signage_player_commands_owner_idx
  on public.signage_player_commands(lower(owner_email), created_at desc);

alter table public.signage_player_commands enable row level security;
