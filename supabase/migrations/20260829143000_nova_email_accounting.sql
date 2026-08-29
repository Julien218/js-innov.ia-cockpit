create table if not exists public.email_accounting_items (
  id uuid primary key default gen_random_uuid(),
  organisation text not null default 'jsinnovia',
  mailbox text not null,
  message_uid text not null,
  message_id text,
  sender text,
  subject text,
  received_at timestamptz,
  category text not null check (category in ('invoice','subscription_invoice','request_or_quote','other')),
  confidence numeric(4,3) not null default 0,
  status text not null default 'reported' check (status in ('awaiting_review','approved','ignored','reported','failed')),
  provider text,
  invoice_number text,
  amount_minor bigint,
  currency text not null default 'EUR',
  client_id text,
  project_id text,
  document_id text,
  document_filename text,
  dropbox_path text,
  cost_event_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation, mailbox, message_uid)
);

create index if not exists email_accounting_items_status_idx on public.email_accounting_items (organisation, status, received_at desc);

create table if not exists public.email_daily_reports (
  id uuid primary key default gen_random_uuid(),
  organisation text not null default 'jsinnovia',
  report_date date not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  recipient text not null,
  subject text not null,
  summary text not null,
  counters jsonb not null default '{}'::jsonb,
  message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation, report_date)
);

alter table public.email_accounting_items enable row level security;
alter table public.email_daily_reports enable row level security;
create policy "server only email accounting" on public.email_accounting_items for all to anon, authenticated using (false) with check (false);
create policy "server only daily email reports" on public.email_daily_reports for all to anon, authenticated using (false) with check (false);
revoke all on table public.email_accounting_items from anon, authenticated;
revoke all on table public.email_daily_reports from anon, authenticated;
grant all on table public.email_accounting_items to service_role;
grant all on table public.email_daily_reports to service_role;
