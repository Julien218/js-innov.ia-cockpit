-- Additive Display / HDMI Manager schema. No player token or provisioning change.
create table if not exists public.signage_sites (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  name text not null,
  processor_type text not null default 'generic_hdmi',
  processor_model text,
  location_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists signage_sites_owner_idx on public.signage_sites(lower(owner_email));

alter table public.signage_players add column if not exists site_id uuid references public.signage_sites(id) on delete set null;

create table if not exists public.signage_display_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  player_id uuid not null unique references public.signage_players(id) on delete cascade,
  site_id uuid references public.signage_sites(id) on delete set null,
  mode text not null default 'AUTO' check (mode in ('AUTO','PROFILE','MANUAL')),
  profile_name text,
  processor_type text not null default 'generic_hdmi',
  preferred_width integer,
  preferred_height integer,
  preferred_refresh_hz numeric,
  hdr_enabled boolean,
  fallback_modes jsonb not null default '[]'::jsonb,
  last_stable_mode jsonb,
  control_capability text not null default 'observe_only' check (control_capability in ('observe_only','request_supported','system_managed')),
  max_attempts integer not null default 2 check (max_attempts between 1 and 5),
  rollback_timeout_seconds integer not null default 15 check (rollback_timeout_seconds between 5 and 60),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists signage_display_profiles_owner_idx on public.signage_display_profiles(lower(owner_email));

alter table public.signage_sites enable row level security;
alter table public.signage_display_profiles enable row level security;
