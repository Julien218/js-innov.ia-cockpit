create table if not exists public.cockpit_user_permissions (
  user_id uuid not null references public.cockpit_users(id) on delete cascade,
  permission_code text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.cockpit_users(id) on delete set null,
  primary key (user_id, permission_code),
  constraint cockpit_user_permissions_code_check check (permission_code ~ '^[a-z][a-z0-9_]{1,63}$')
);

create index if not exists cockpit_user_permissions_updated_by_idx
  on public.cockpit_user_permissions(updated_by);

alter table public.cockpit_user_permissions enable row level security;
revoke all on table public.cockpit_user_permissions from anon, authenticated;
grant select, insert, update, delete on table public.cockpit_user_permissions to service_role;

comment on table public.cockpit_user_permissions is
  'Server-only per-user Cockpit permission overrides. No browser role receives direct access.';
