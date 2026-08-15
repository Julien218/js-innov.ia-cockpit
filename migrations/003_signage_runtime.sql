-- Runtime multi-client pour le pilote Digital Signage + Video
create table if not exists public.signage_players (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  name text not null,
  token_hash text not null unique,
  resolution text not null default '1920x1080',
  status text not null default 'provisioning',
  last_seen_at timestamptz,
  current_publication_id uuid,
  app_version text,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists signage_players_owner_idx on public.signage_players(lower(owner_email));

create table if not exists public.signage_media (
  id uuid primary key default gen_random_uuid(), owner_email text not null, name text not null,
  mime_type text not null, dropbox_path text not null, size_bytes bigint,
  duration_seconds numeric, checksum_sha256 text, status text not null default 'uploaded',
  rendition jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists signage_media_owner_idx on public.signage_media(lower(owner_email));

create table if not exists public.signage_playlists (
  id uuid primary key default gen_random_uuid(), owner_email text not null, name text not null,
  items jsonb not null default '[]'::jsonb, revision integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.signage_publications (
  id uuid primary key default gen_random_uuid(), owner_email text not null,
  player_id uuid not null references public.signage_players(id) on delete cascade,
  playlist_id uuid not null references public.signage_playlists(id) on delete restrict,
  status text not null default 'pending', manifest jsonb not null default '{}'::jsonb,
  previous_publication_id uuid references public.signage_publications(id),
  activated_at timestamptz, acknowledged_at timestamptz, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.signage_players add constraint signage_players_current_publication_fk
  foreign key (current_publication_id) references public.signage_publications(id) deferrable initially deferred;

create table if not exists public.camera_gateways (
  id uuid primary key default gen_random_uuid(), owner_email text not null, name text not null,
  token_hash text not null unique, status text not null default 'provisioning',
  last_seen_at timestamptz, diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.cameras (
  id uuid primary key default gen_random_uuid(), owner_email text not null,
  gateway_id uuid not null references public.camera_gateways(id) on delete cascade,
  name text not null, model text, local_stream_key text not null,
  enabled boolean not null default true, created_at timestamptz not null default now()
);

alter table public.signage_players enable row level security;
alter table public.signage_media enable row level security;
alter table public.signage_playlists enable row level security;
alter table public.signage_publications enable row level security;
alter table public.camera_gateways enable row level security;
alter table public.cameras enable row level security;
