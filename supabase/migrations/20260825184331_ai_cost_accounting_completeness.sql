-- AI Cost Control: paramètres comptables globaux, privés au backend.
create table if not exists public.cost_accounting_settings (
  settings_key text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.cost_accounting_settings enable row level security;

revoke all on table public.cost_accounting_settings from anon, authenticated;
grant select, insert, update, delete on table public.cost_accounting_settings to service_role;

drop policy if exists service_role_all_cost_accounting_settings on public.cost_accounting_settings;
create policy service_role_all_cost_accounting_settings
  on public.cost_accounting_settings
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.cost_accounting_settings is
  'Paramètres privés AI Cost Control, dont puissance du poste, prix du kWh et coût horaire machine.';
