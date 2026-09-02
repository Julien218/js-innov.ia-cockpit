create table if not exists signelya_notification_contacts (
  email text primary key,
  phone_e164 text not null,
  role text not null check (role in ('client','collaborateur','superadmin')),
  enabled boolean not null default true,
  whatsapp_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists signelya_client_commercial_assignments (
  client_email text primary key,
  client_name text,
  commercial_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists signelya_notification_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  owner_email text,
  event_type text not null,
  audience text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists signelya_device_alert_state (
  player_id text primary key,
  owner_email text not null,
  state text not null default 'unknown',
  offline_since timestamptz,
  last_notified_at timestamptz,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists signelya_whatsapp_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references signelya_notification_events(id) on delete set null,
  recipient_email text,
  recipient_phone text not null,
  recipient_role text not null,
  template_name text not null,
  meta_message_id text,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists signelya_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references signelya_notification_events(id) on delete set null,
  recipient_email text not null,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists signelya_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  role text not null check (role in ('superadmin')),
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists signelya_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references signelya_notification_events(id) on delete set null,
  subscription_id uuid references signelya_push_subscriptions(id) on delete set null,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now()
);

create index if not exists signelya_notification_events_owner_created_idx
  on signelya_notification_events(owner_email, created_at desc);
create index if not exists signelya_whatsapp_deliveries_message_idx
  on signelya_whatsapp_deliveries(meta_message_id);
create index if not exists signelya_assignments_commercial_idx
  on signelya_client_commercial_assignments(commercial_email);
