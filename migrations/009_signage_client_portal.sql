-- Portail client Signage: briefs, médias sources et validation avant diffusion.
-- Les accès publics restent interdits; le backend applique le cloisonnement par owner_email.

create table if not exists public.client_signage_requests (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  title text not null,
  brief text not null,
  request_type text not null default 'giant_screen_video',
  status text not null default 'submitted',
  format text not null default '16:9',
  duration_seconds integer not null default 8 check (duration_seconds between 1 and 120),
  desired_at timestamptz,
  publish_after_approval boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_signage_requests_owner_idx
  on public.client_signage_requests(lower(owner_email), created_at desc);

create table if not exists public.client_signage_request_assets (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.client_signage_requests(id) on delete cascade,
  owner_email text not null,
  media_id uuid not null references public.signage_media(id) on delete restrict,
  asset_role text not null default 'source',
  created_at timestamptz not null default now(),
  unique(request_id, media_id)
);
create index if not exists client_signage_request_assets_request_idx
  on public.client_signage_request_assets(request_id, created_at);

create table if not exists public.client_content_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.client_signage_requests(id) on delete cascade,
  owner_email text not null,
  media_id uuid not null references public.signage_media(id) on delete restrict,
  version integer not null default 1,
  status text not null default 'awaiting_client',
  publish_on_approval boolean not null default false,
  client_comment text,
  decided_at timestamptz,
  publication_id uuid references public.signage_publications(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(request_id, version)
);
create index if not exists client_content_reviews_owner_idx
  on public.client_content_reviews(lower(owner_email), created_at desc);

alter table public.client_signage_requests enable row level security;
alter table public.client_signage_request_assets enable row level security;
alter table public.client_content_reviews enable row level security;

-- Railway PostgreSQL does not define Supabase's anon/authenticated roles.
-- RLS without public policies still fails closed, while the backend connects
-- through DATABASE_URL as the table owner.

comment on table public.client_signage_requests is 'Demandes vidéo du portail client Signage, isolées par owner_email.';
comment on table public.client_content_reviews is 'Versions soumises à validation client; publication automatique uniquement si préautorisée.';
