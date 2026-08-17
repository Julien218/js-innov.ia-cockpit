-- Additive scheduling for Digital Signage players.
-- Backward compatible: players with no schedule remain allowed at all times.

create table if not exists public.signage_player_schedule_settings (
  player_id uuid primary key references public.signage_players(id) on delete cascade,
  owner_email text not null,
  timezone text not null default 'Europe/Brussels',
  configured boolean not null default false,
  block_belgian_holidays boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists signage_player_schedule_settings_owner_idx
  on public.signage_player_schedule_settings(lower(owner_email));

create table if not exists public.signage_player_schedule_ranges (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.signage_players(id) on delete cascade,
  owner_email text not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);
create index if not exists signage_player_schedule_ranges_lookup_idx
  on public.signage_player_schedule_ranges(player_id, day_of_week, start_time, end_time);

create table if not exists public.signage_player_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.signage_players(id) on delete cascade,
  owner_email text not null,
  exception_date date not null,
  mode text not null check (mode in ('closed', 'special_hours', 'normal')),
  ranges jsonb not null default '[]'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(player_id, exception_date)
);
create index if not exists signage_player_schedule_exceptions_lookup_idx
  on public.signage_player_schedule_exceptions(player_id, exception_date);

create table if not exists public.signage_schedule_audit (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.signage_players(id) on delete cascade,
  publication_id uuid references public.signage_publications(id) on delete set null,
  owner_email text not null,
  evaluated_at timestamptz not null default now(),
  ads_allowed boolean not null,
  reason text not null,
  next_change_at timestamptz,
  details jsonb not null default '{}'::jsonb
);
create index if not exists signage_schedule_audit_player_idx
  on public.signage_schedule_audit(player_id, evaluated_at desc);

alter table public.signage_player_schedule_settings enable row level security;
alter table public.signage_player_schedule_ranges enable row level security;
alter table public.signage_player_schedule_exceptions enable row level security;
alter table public.signage_schedule_audit enable row level security;

comment on table public.signage_player_schedule_settings is 'Per-player signage scheduling settings. configured=false preserves legacy always-allowed behavior.';
comment on table public.signage_player_schedule_ranges is 'Weekly ad display windows. day_of_week follows JS getDay(): Sunday=0 through Saturday=6.';
comment on table public.signage_player_schedule_exceptions is 'Date-specific override: closed, special_hours, or normal (ignore holiday and use weekly schedule).';
comment on table public.signage_schedule_audit is 'Server-side record of ad-allowance decisions returned to players.';
