create table if not exists public.google_mail_accounts (
  id uuid primary key default gen_random_uuid(),
  organisation text not null default 'jsinnovia',
  provider text not null default 'google' check (provider = 'google'),
  email text not null,
  label text,
  brand text not null default 'js-innov-ia' check (brand in ('js-innov-ia', 'assurances-dour')),
  refresh_token_encrypted text not null,
  scopes text[] not null default '{}'::text[],
  active boolean not null default true,
  auto_trash_promotions boolean not null default false,
  promotion_retention_days integer not null default 2 check (promotion_retention_days between 1 and 30),
  protected_senders text[] not null default '{}'::text[],
  connected_by text,
  connected_at timestamptz not null default now(),
  last_scan_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation, provider, email)
);

create table if not exists public.google_mail_cleanup_log (
  id uuid primary key default gen_random_uuid(),
  organisation text not null default 'jsinnovia',
  account_id uuid not null references public.google_mail_accounts(id) on delete cascade,
  message_id text not null,
  thread_id text,
  sender text,
  subject text,
  action text not null check (action in ('trashed', 'restored', 'skipped')),
  reason text not null,
  confidence numeric(4,3) not null default 0,
  acted_at timestamptz not null default now(),
  restored_at timestamptz,
  acted_by text,
  metadata jsonb not null default '{}'::jsonb,
  unique (account_id, message_id, action)
);

create index if not exists google_mail_accounts_active_idx on public.google_mail_accounts (organisation, active);
create index if not exists google_mail_cleanup_recent_idx on public.google_mail_cleanup_log (organisation, acted_at desc);

alter table public.google_mail_accounts enable row level security;
alter table public.google_mail_cleanup_log enable row level security;
create policy "server only google mail accounts" on public.google_mail_accounts for all to anon, authenticated using (false) with check (false);
create policy "server only google mail cleanup" on public.google_mail_cleanup_log for all to anon, authenticated using (false) with check (false);
revoke all on table public.google_mail_accounts from anon, authenticated;
revoke all on table public.google_mail_cleanup_log from anon, authenticated;
grant select, insert, update, delete on table public.google_mail_accounts to service_role;
grant select, insert, update, delete on table public.google_mail_cleanup_log to service_role;
