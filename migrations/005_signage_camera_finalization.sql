alter table public.signage_publications
  add column if not exists scheduled_at timestamptz not null default now(),
  add column if not exists recurrence jsonb not null default '{"type":"none"}'::jsonb,
  add column if not exists rolled_back_at timestamptz;

create index if not exists signage_publications_due_idx
  on public.signage_publications(player_id, status, scheduled_at desc);

alter table public.camera_gateways
  add column if not exists app_version text;

alter table public.cameras
  add column if not exists status text not null default 'offline',
  add column if not exists last_seen_at timestamptz,
  add column if not exists snapshot_at timestamptz,
  add column if not exists retention_days integer not null default 14
    check (retention_days between 1 and 90);

create table if not exists public.camera_recordings (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  camera_id uuid not null references public.cameras(id) on delete cascade,
  name text not null,
  mime_type text not null default 'video/mp4',
  dropbox_path text not null,
  size_bytes bigint,
  duration_seconds integer,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'ready',
  created_at timestamptz not null default now()
);
create index if not exists camera_recordings_owner_created_idx
  on public.camera_recordings(lower(owner_email), created_at desc);
create index if not exists camera_recordings_expiry_idx
  on public.camera_recordings(expires_at);

create table if not exists public.signage_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists signage_audit_owner_created_idx
  on public.signage_audit_events(lower(owner_email), created_at desc);

alter table public.camera_recordings enable row level security;
alter table public.signage_audit_events enable row level security;

