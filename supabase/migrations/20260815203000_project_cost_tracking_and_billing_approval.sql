-- Suivi des coûts par projet + validation humaine obligatoire avant envoi.
-- Les projets internes JS-Innov.IA sont en suivi uniquement et ne génèrent pas de facture.

alter table if exists public.client_invoices
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_by text,
  add column if not exists rejected_at timestamptz,
  add column if not exists approval_note text;

create index if not exists client_invoices_approval_idx
  on public.client_invoices (approval_status, status, created_at desc);

create table if not exists public.project_cost_scopes (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('internal', 'client')),
  client_id text,
  client_name text,
  project_id text not null,
  project_name text not null,
  billing_mode text not null default 'track_only'
    check (billing_mode in ('track_only', 'draft_for_approval')),
  cost_center_id uuid,
  currency text not null default 'EUR',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_type, project_id),
  check (
    (owner_type = 'internal' and billing_mode = 'track_only')
    or owner_type = 'client'
  )
);

create index if not exists project_cost_scopes_client_idx
  on public.project_cost_scopes (client_id) where client_id is not null;
create index if not exists project_cost_scopes_project_idx
  on public.project_cost_scopes (project_id);

create table if not exists public.project_cost_mappings (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.project_cost_scopes(id) on delete cascade,
  provider text not null,
  resource_type text not null default 'project',
  external_id text,
  secret_ref text,
  external_label text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (secret_ref is null or secret_ref ~ '^[A-Z][A-Z0-9_]{5,179}$')
);

create unique index if not exists project_cost_mappings_external_unique
  on public.project_cost_mappings(provider, resource_type, external_id)
  where is_active = true and external_id is not null;
create index if not exists project_cost_mappings_scope_idx
  on public.project_cost_mappings(scope_id);

create table if not exists public.project_cost_entries (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.project_cost_scopes(id) on delete cascade,
  period_month text not null check (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  provider text not null,
  source text not null default 'manual',
  description text,
  cost_usd numeric(16,8) not null default 0 check (cost_usd >= 0),
  cost_eur_minor integer not null default 0 check (cost_eur_minor >= 0),
  external_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (scope_id, external_ref)
);

create index if not exists project_cost_entries_period_idx
  on public.project_cost_entries(period_month, scope_id);

create or replace function public.touch_project_cost_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists project_cost_scopes_touch on public.project_cost_scopes;
create trigger project_cost_scopes_touch before update on public.project_cost_scopes
for each row execute function public.touch_project_cost_updated_at();

drop trigger if exists project_cost_mappings_touch on public.project_cost_mappings;
create trigger project_cost_mappings_touch before update on public.project_cost_mappings
for each row execute function public.touch_project_cost_updated_at();

alter table public.project_cost_scopes enable row level security;
alter table public.project_cost_mappings enable row level security;
alter table public.project_cost_entries enable row level security;

revoke all on public.project_cost_scopes from anon, authenticated;
revoke all on public.project_cost_mappings from anon, authenticated;
revoke all on public.project_cost_entries from anon, authenticated;

grant all on public.project_cost_scopes to service_role;
grant all on public.project_cost_mappings to service_role;
grant all on public.project_cost_entries to service_role;

comment on table public.project_cost_scopes is 'Centre de suivi des coûts par projet; internal=suivi uniquement, client=option facture brouillon.';
comment on table public.project_cost_mappings is 'Références fournisseur/Railway/API par projet; aucune valeur secrète brute.';
comment on table public.project_cost_entries is 'Coûts externes par projet et par mois (Railway, services, fournisseurs, manuel).';