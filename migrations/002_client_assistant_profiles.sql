-- Client-adaptive Companion profiles.
-- Server/service-role only: no public RLS policy is created.

create table if not exists public.client_assistant_profiles (
  organisation_id text primary key,
  assistant_name text not null default 'NOVA',
  public_brand_name text,
  preferred_tone text not null default 'professionnel, clair et orienté solution',
  preferred_language text not null default 'fr-BE',
  greeting text,
  public_context jsonb not null default '{}'::jsonb,
  expose_modules boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_assistant_profiles_organisation_id_chk
    check (organisation_id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  constraint client_assistant_profiles_name_chk
    check (char_length(assistant_name) between 1 and 80),
  constraint client_assistant_profiles_language_chk
    check (char_length(preferred_language) between 2 and 30),
  constraint client_assistant_profiles_public_context_chk
    check (jsonb_typeof(public_context) = 'object')
);

alter table public.client_assistant_profiles enable row level security;

comment on table public.client_assistant_profiles is
  'Public-safe behavioural profile for the JS-Innov.IA client Companion. Internal prompts, secrets and implementation details must never be stored in public_context.';

comment on column public.client_assistant_profiles.public_context is
  'Only client-visible facts/preferences. Never store prompts, keys, internal workflows, repositories, costs or proprietary implementation details.';
