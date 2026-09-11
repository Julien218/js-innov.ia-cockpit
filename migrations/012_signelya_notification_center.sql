create table if not exists signelya_notification_reads (
  event_id uuid not null references signelya_notification_events(id) on delete cascade,
  user_email text not null,
  read_at timestamptz not null default now(),
  primary key (event_id, user_email)
);

create index if not exists signelya_notification_reads_user_idx
  on signelya_notification_reads(lower(user_email), read_at desc);
