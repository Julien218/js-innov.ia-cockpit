begin;

create table if not exists public."VideoProject" (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Nouveau montage',
  audio_url text default '',
  audio_name text default '',
  audio_duration_seconds numeric,
  transition text not null default 'fade',
  status text not null default 'draft',
  project_id text,
  clips jsonb not null default '[]'::jsonb,
  texts jsonb not null default '[]'::jsonb,
  ai_prompt text,
  drive_url text,
  drive_file_id text,
  template_tracks jsonb,
  template_format text,
  template_duration numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create index if not exists video_project_created_date_idx
  on public."VideoProject"(created_date desc);
create index if not exists video_project_source_project_idx
  on public."VideoProject"(project_id);

create table if not exists public."VideoExport" (
  id uuid primary key default gen_random_uuid(),
  video_project_id uuid,
  title text not null default 'Export vidéo',
  format text not null default 'WebM',
  export_type text not null default 'simple',
  file_url text not null default '',
  file_size_mb numeric not null default 0,
  duration_seconds numeric not null default 0,
  created_by text,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

create index if not exists video_export_created_date_idx
  on public."VideoExport"(created_date desc);
create index if not exists video_export_project_idx
  on public."VideoExport"(video_project_id);

alter table public."VideoProject" enable row level security;
alter table public."VideoExport" enable row level security;

revoke all on table public."VideoProject", public."VideoExport" from anon, authenticated;
grant all on table public."VideoProject", public."VideoExport" to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('video-studio', 'video-studio', true, 104857600)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

notify pgrst, 'reload schema';

commit;
