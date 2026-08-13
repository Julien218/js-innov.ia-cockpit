-- Registre des références de secrets IA. Aucune clé brute n'est stockée ici.
create table if not exists public.ai_key_attributions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  project_id text not null,
  client_name text not null,
  project_name text not null,
  provider text not null default 'openai',
  secret_ref text not null,
  status text not null default 'a_creer' check (status in ('a_creer', 'configuree', 'active', 'erreur')),
  monthly_budget_usd numeric(14,2) not null default 0 check (monthly_budget_usd >= 0),
  hard_limit_usd numeric(14,2) not null default 0 check (hard_limit_usd >= 0),
  alert_thresholds integer[] not null default array[50,75,90],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (client_id, project_id, provider),
  unique (secret_ref)
);

create index if not exists ai_key_attributions_client_idx on public.ai_key_attributions (client_id);
create index if not exists ai_key_attributions_project_idx on public.ai_key_attributions (project_id);
alter table public.ai_key_attributions enable row level security;
comment on table public.ai_key_attributions is 'Références nominatives de secrets IA par client/projet; ne contient jamais la valeur des clés.';
