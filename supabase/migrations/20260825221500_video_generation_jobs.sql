create table if not exists public.video_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  client_name text not null,
  project_id text,
  cost_center_id uuid references public.client_cost_centers(id) on delete set null,
  provider text not null check (provider in ('xai', 'openai')),
  model text not null,
  status text not null default 'queued' check (status in ('queued','submitted','in_progress','completed','failed','cancelled')),
  provider_job_id text,
  prompt text not null,
  campaign_name text not null,
  duration_seconds integer not null default 8 check (duration_seconds between 1 and 15),
  resolution text not null,
  aspect_ratio text not null default '16:9',
  version text not null default 'v01',
  progress integer not null default 0 check (progress between 0 and 100),
  provider_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error text,
  cost_usd numeric(14,6),
  cost_eur_minor integer check (cost_eur_minor is null or cost_eur_minor >= 0),
  cost_evidence_status text check (cost_evidence_status is null or cost_evidence_status in ('actual','estimated','manual_verified','unverified')),
  cost_event_id uuid references public.client_cost_events(id) on delete set null,
  dropbox_path text,
  sidecar_path text,
  sha256 text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists video_generation_jobs_provider_run_unique
  on public.video_generation_jobs(provider, provider_job_id) where provider_job_id is not null;
create index if not exists video_generation_jobs_status_created_idx
  on public.video_generation_jobs(status, created_at);
create index if not exists video_generation_jobs_client_created_idx
  on public.video_generation_jobs(client_id, created_at desc);

alter table public.video_generation_jobs enable row level security;
revoke all on table public.video_generation_jobs from anon, authenticated;
grant select, insert, update, delete on table public.video_generation_jobs to service_role;

drop policy if exists video_generation_jobs_service_role_all on public.video_generation_jobs;
create policy video_generation_jobs_service_role_all on public.video_generation_jobs
  for all to service_role using (true) with check (true);
