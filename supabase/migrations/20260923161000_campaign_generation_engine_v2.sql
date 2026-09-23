alter table public.campaign_brands
  add column if not exists image_engine text not null default 'auto',
  add column if not exists local_image_checkpoint text,
  add column if not exists fallback_image_to_api boolean not null default false;

alter table public.campaign_brands
  drop constraint if exists campaign_brands_image_engine_check;
alter table public.campaign_brands
  add constraint campaign_brands_image_engine_check check (image_engine in ('auto','local','api'));

alter table public.campaign_posts
  add column if not exists image_engine text,
  add column if not exists image_provider text,
  add column if not exists image_job_id text,
  add column if not exists image_storage_path text,
  add column if not exists image_error text,
  add column if not exists video_storage_path text,
  add column if not exists video_error text;

alter table public.campaign_posts
  drop constraint if exists campaign_posts_image_engine_check;
alter table public.campaign_posts
  add constraint campaign_posts_image_engine_check check (image_engine is null or image_engine in ('auto','local','api'));

alter table public.campaign_posts
  drop constraint if exists campaign_posts_image_status_check;
alter table public.campaign_posts
  add constraint campaign_posts_image_status_check check (image_status in ('none','queued','generating','review','approved','rejected','failed'));

create table if not exists public.campaign_local_workers (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null default 'jsinnovia',
  user_id text not null,
  name text not null default 'Elynea Local Worker',
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active','disabled')),
  version text,
  capabilities jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null default 'jsinnovia',
  user_id text not null,
  post_id uuid not null references public.campaign_posts(id) on delete cascade,
  kind text not null check (kind in ('image','video')),
  engine text not null check (engine in ('local','api')),
  provider text,
  status text not null default 'queued' check (status in ('queued','claimed','submitting','submitted','running','completed','failed','unknown','cancelled')),
  worker_id uuid references public.campaign_local_workers(id) on delete set null,
  provider_job_id text,
  payload jsonb not null default '{}'::jsonb,
  result_url text,
  storage_path text,
  error text,
  paid_consent boolean not null default false,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaign_local_workers_user_seen_idx
  on public.campaign_local_workers(organisation_id,user_id,status,last_seen_at desc);
create index if not exists campaign_generation_jobs_local_queue_idx
  on public.campaign_generation_jobs(engine,status,organisation_id,user_id,created_at);
create index if not exists campaign_generation_jobs_provider_idx
  on public.campaign_generation_jobs(provider,provider_job_id) where provider_job_id is not null;
create index if not exists campaign_generation_jobs_post_idx
  on public.campaign_generation_jobs(post_id,created_at desc);
create unique index if not exists campaign_generation_jobs_one_active_per_kind
  on public.campaign_generation_jobs(post_id,kind)
  where status in ('queued','claimed','submitting','submitted','running');

alter table public.campaign_local_workers enable row level security;
alter table public.campaign_generation_jobs enable row level security;
revoke all on table public.campaign_local_workers, public.campaign_generation_jobs from anon, authenticated;
grant select, insert, update, delete on table public.campaign_local_workers, public.campaign_generation_jobs to service_role;

drop policy if exists campaign_local_workers_service_role_all on public.campaign_local_workers;
create policy campaign_local_workers_service_role_all on public.campaign_local_workers
  for all to service_role using (true) with check (true);
drop policy if exists campaign_generation_jobs_service_role_all on public.campaign_generation_jobs;
create policy campaign_generation_jobs_service_role_all on public.campaign_generation_jobs
  for all to service_role using (true) with check (true);

update public.campaign_brands
set image_engine = coalesce(image_engine,'auto'),
    fallback_image_to_api = coalesce(fallback_image_to_api,false),
    updated_at = now()
where organisation_id = 'jsinnovia';
