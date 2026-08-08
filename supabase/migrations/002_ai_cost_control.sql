-- ============================================================
-- AI Cost Control — registre de consommation, budgets et routage
-- Les tables sont volontairement privées : accès via backend service_role.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.ai_cost_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider text not null default 'openai',
  model text not null,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_usd numeric(16,8) not null default 0 check (cost_usd >= 0),
  cost_estimated boolean not null default true,
  pricing_key text,
  pricing_warning text,
  processing_mode text not null default 'standard'
    check (processing_mode in ('standard', 'batch', 'priority', 'data_residency')),
  project_key text,
  project_name text,
  client_key text,
  client_name text,
  source text not null default 'unknown',
  request_id text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_by text
);

create index if not exists ai_cost_usage_created_at_idx on public.ai_cost_usage (created_at desc);
create index if not exists ai_cost_usage_model_idx on public.ai_cost_usage (model);
create index if not exists ai_cost_usage_project_idx on public.ai_cost_usage (project_key) where project_key is not null;
create index if not exists ai_cost_usage_client_idx on public.ai_cost_usage (client_key) where client_key is not null;
create index if not exists ai_cost_usage_source_idx on public.ai_cost_usage (source);

create table if not exists public.ai_cost_budgets (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('global', 'project', 'client')),
  scope_key text not null,
  scope_name text,
  monthly_budget_usd numeric(14,2) not null default 0 check (monthly_budget_usd >= 0),
  hard_limit_usd numeric(14,2) not null default 0 check (hard_limit_usd >= 0),
  alert_thresholds integer[] not null default array[50,75,90],
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (scope_type, scope_key)
);

create table if not exists public.ai_cost_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Aucun budget arbitraire n'est activé par défaut : l'administrateur choisit son plafond.
insert into public.ai_cost_budgets (
  scope_type, scope_key, scope_name, monthly_budget_usd, hard_limit_usd, alert_thresholds, enabled
) values (
  'global', 'global', 'Budget OpenAI global', 0, 0, array[50,75,90], false
)
on conflict (scope_type, scope_key) do nothing;

insert into public.ai_cost_settings (key, value)
values (
  'routing_policy',
  '{
    "auto_route": true,
    "default_model": "gpt-5.6-terra",
    "simple_model": "gpt-5.6-luna",
    "balanced_model": "gpt-5.6-terra",
    "complex_model": "gpt-5.6-sol",
    "max_request_usd": 2
  }'::jsonb
)
on conflict (key) do nothing;

alter table public.ai_cost_usage enable row level security;
alter table public.ai_cost_budgets enable row level security;
alter table public.ai_cost_settings enable row level security;

comment on table public.ai_cost_usage is 'Consommation IA détaillée par requête pour AI Cost Control.';
comment on table public.ai_cost_budgets is 'Budgets mensuels et hard limits globaux, par projet ou par client.';
comment on table public.ai_cost_settings is 'Configuration AI Cost Control, notamment la politique de routage.';
