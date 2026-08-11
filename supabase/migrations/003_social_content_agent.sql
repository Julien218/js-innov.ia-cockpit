-- Social Content Agent SaaS — multi-tenant, validation humaine obligatoire
-- Les secrets API ne sont jamais stockés ici. Les colonnes *_secret_ref contiennent
-- uniquement des noms de variables/identifiants de coffre côté serveur.

create extension if not exists pgcrypto;

create table if not exists public.social_agent_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  slug text not null unique,
  display_name text not null,
  vertical text not null default 'general',
  locale text not null default 'fr-BE',
  timezone text not null default 'Europe/Brussels',
  brand_voice jsonb not null default '{}'::jsonb,
  visual_dna jsonb not null default '{}'::jsonb,
  editorial_rules jsonb not null default '{}'::jsonb,
  weekly_schedule jsonb not null default '{}'::jsonb,
  channels jsonb not null default '[]'::jsonb,
  approval_channel text not null default 'whatsapp',
  approver_name text,
  approver_phone text,
  whatsapp_from text,
  content_generator text not null default 'openai',
  video_generator text not null default 'webhook',
  video_generator_secret_ref text,
  publishing_secret_ref text,
  require_human_approval boolean not null default true,
  auto_publish_after_approval boolean not null default true,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_agent_profiles_client_idx
  on public.social_agent_profiles(client_id);

create table if not exists public.social_content_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.social_agent_profiles(id) on delete cascade,
  client_id text not null,
  editorial_series text,
  topic text not null,
  scheduled_for timestamptz,
  status text not null default 'draft'
    check (status in ('draft','research','generating','review','pending_approval','approved','changes_requested','rejected','publishing','published','failed')),
  research jsonb not null default '{}'::jsonb,
  script text,
  caption text,
  hashtags jsonb not null default '[]'::jsonb,
  storyboard jsonb not null default '[]'::jsonb,
  media_url text,
  thumbnail_url text,
  source_urls jsonb not null default '[]'::jsonb,
  generation_provider text,
  generation_model text,
  generation_cost_usd numeric(12,6) not null default 0,
  version integer not null default 1,
  approved_version integer,
  approval_code text unique,
  approved_by text,
  approved_at timestamptz,
  published_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_content_profile_status_idx
  on public.social_content_items(profile_id, status, scheduled_for);
create index if not exists social_content_client_idx
  on public.social_content_items(client_id, created_at desc);

create table if not exists public.social_approval_events (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.social_content_items(id) on delete cascade,
  profile_id uuid not null references public.social_agent_profiles(id) on delete cascade,
  event_type text not null check (event_type in ('sent','approved','changes_requested','rejected','expired','manual_override')),
  actor text,
  channel text not null default 'whatsapp',
  external_message_id text,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists social_approval_content_idx
  on public.social_approval_events(content_id, created_at desc);

create table if not exists public.social_publication_events (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.social_content_items(id) on delete cascade,
  profile_id uuid not null references public.social_agent_profiles(id) on delete cascade,
  channel text not null,
  status text not null check (status in ('queued','publishing','published','failed','skipped')),
  external_post_id text,
  external_url text,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists social_publication_content_idx
  on public.social_publication_events(content_id, channel);

create table if not exists public.social_content_metrics (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.social_content_items(id) on delete cascade,
  channel text not null,
  views bigint not null default 0,
  reach bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  watch_time_seconds numeric(14,2) not null default 0,
  followers_delta integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  measured_at timestamptz not null default now()
);

create index if not exists social_metrics_content_idx
  on public.social_content_metrics(content_id, measured_at desc);

-- updated_at sans dépendance à une fonction applicative existante
create or replace function public.set_social_agent_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_social_agent_profiles_updated_at on public.social_agent_profiles;
create trigger trg_social_agent_profiles_updated_at
before update on public.social_agent_profiles
for each row execute function public.set_social_agent_updated_at();

drop trigger if exists trg_social_content_items_updated_at on public.social_content_items;
create trigger trg_social_content_items_updated_at
before update on public.social_content_items
for each row execute function public.set_social_agent_updated_at();

alter table public.social_agent_profiles enable row level security;
alter table public.social_content_items enable row level security;
alter table public.social_approval_events enable row level security;
alter table public.social_publication_events enable row level security;
alter table public.social_content_metrics enable row level security;

-- Aucun accès anon/authenticated direct : l'application passe par le backend cockpit
-- et la service role. Les secrets restent donc côté serveur/Railway.
revoke all on public.social_agent_profiles from anon, authenticated;
revoke all on public.social_content_items from anon, authenticated;
revoke all on public.social_approval_events from anon, authenticated;
revoke all on public.social_publication_events from anon, authenticated;
revoke all on public.social_content_metrics from anon, authenticated;
