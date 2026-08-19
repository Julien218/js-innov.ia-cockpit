create extension if not exists pgcrypto;

create table if not exists public.finops_policies (
  id uuid primary key default gen_random_uuid(),
  client_key text not null,
  entity_key text not null,
  client_name text,
  entity_name text,
  policy text not null check (policy in ('standard_margin','fixed_plus_overage','technical_costs_only','custom')),
  markup_percent numeric(10,4) not null default 50,
  minimum_margin_percent numeric(10,4) not null default 30,
  minimum_invoice_eur numeric(14,6) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique(client_key, entity_key)
);

create table if not exists public.finops_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_key text not null,
  client_name text,
  entity_key text not null,
  entity_name text,
  project_key text not null,
  project_name text,
  service_key text not null,
  job_key text,
  category text not null check (category in ('llm_cloud','llm_local','gpu_local','cpu_local','electricity','machine_amortization','storage','railway','github','voice','image','video','3d','email_sms','human_time','other')),
  provider text,
  model text,
  quantity numeric(20,8) not null default 0,
  unit text,
  cost_eur numeric(20,8) not null default 0,
  billable_eur numeric(20,8) not null default 0,
  billing_policy text not null,
  metadata jsonb not null default '{}'::jsonb,
  source text not null default 'unknown',
  event_key text unique,
  created_by text
);

create index if not exists finops_events_created_at_idx on public.finops_events(created_at desc);
create index if not exists finops_events_client_idx on public.finops_events(client_key, entity_key, project_key);
create index if not exists finops_events_category_idx on public.finops_events(category);

alter table public.finops_events enable row level security;
alter table public.finops_policies enable row level security;

-- No browser-facing policies are intentionally created. Access is server-side only
-- through the service-role protected Cockpit API.

insert into public.finops_policies (client_key, entity_key, client_name, entity_name, policy, markup_percent, minimum_margin_percent, metadata)
values ('olivier', 'default', 'Olivier', 'Entité à ventiler', 'technical_costs_only', 0, 0, '{"note":"Remplacer default par chaque société/ASBL réelle avant facturation"}'::jsonb)
on conflict (client_key, entity_key) do nothing;
