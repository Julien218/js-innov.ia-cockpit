alter table public.client_module_entitlements
  add column if not exists grant_reason text,
  add column if not exists recurring_fee_cents integer not null default 0,
  add column if not exists usage_billing_account text,
  add column if not exists usage_billing_enabled boolean not null default false,
  add column if not exists expires_at timestamptz;

comment on column public.client_module_entitlements.grant_reason is 'Motif commercial du droit, par exemple pilot_gift.';
comment on column public.client_module_entitlements.recurring_fee_cents is 'Frais fixes mensuels du module, hors consommations variables.';
comment on column public.client_module_entitlements.usage_billing_account is 'Compte payeur des consommations variables LLM et services tiers.';
