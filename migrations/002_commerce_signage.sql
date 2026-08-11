-- Digital Signage / Vidéosurveillance commerce provisioning
create extension if not exists pgcrypto;

create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'jsinnovia-site',
  status text not null default 'intake',
  package_id text not null,
  company text not null,
  vat_number text,
  contact_name text not null,
  email text not null,
  phone text not null,
  installation_address text not null,
  questionnaire jsonb not null default '{}'::jsonb,
  stripe_checkout_session_id text unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  last_stripe_event_type text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_orders_email_idx on public.commerce_orders (lower(email));
create index if not exists commerce_orders_status_idx on public.commerce_orders (status, created_at desc);
create index if not exists commerce_orders_subscription_idx on public.commerce_orders (stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists public.commerce_events (
  event_id text primary key,
  event_type text not null,
  livemode boolean not null default false,
  stripe_created_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now()
);

create table if not exists public.client_module_entitlements (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  client_id uuid,
  module_code text not null,
  enabled boolean not null default true,
  source_order_id uuid references public.commerce_orders(id) on delete set null,
  activated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(email, module_code)
);

create table if not exists public.commerce_onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete cascade,
  task_code text not null,
  title text not null,
  status text not null default 'a_faire',
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, task_code)
);

alter table public.commerce_orders enable row level security;
alter table public.commerce_events enable row level security;
alter table public.client_module_entitlements enable row level security;
alter table public.commerce_onboarding_tasks enable row level security;

comment on table public.commerce_orders is 'Questionnaires et commandes Digital Signage / Vidéosurveillance. Accès backend service_role uniquement.';
comment on table public.commerce_events is 'Journal idempotent des webhooks Stripe commerce.';
comment on table public.client_module_entitlements is 'Modules cockpit activés à la suite d’une commande payée.';
comment on table public.commerce_onboarding_tasks is 'Checklist d’onboarding générée automatiquement après paiement.';
