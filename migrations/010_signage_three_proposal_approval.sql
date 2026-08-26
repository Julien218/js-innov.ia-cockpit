-- Trois propositions vidéo, choix client, validation finale JS-Innov.IA puis diffusion.

create table if not exists public.client_content_review_proposals (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.client_content_reviews(id) on delete cascade,
  request_id uuid not null references public.client_signage_requests(id) on delete cascade,
  owner_email text not null,
  media_id uuid not null references public.signage_media(id) on delete restrict,
  proposal_slot smallint not null check (proposal_slot between 1 and 3),
  created_at timestamptz not null default now(),
  unique(review_id, proposal_slot),
  unique(review_id, media_id)
);

create index if not exists client_content_review_proposals_owner_idx
  on public.client_content_review_proposals(lower(owner_email), review_id, proposal_slot);

alter table public.client_content_reviews
  add column if not exists selected_proposal smallint check (selected_proposal between 1 and 3),
  add column if not exists selected_media_id uuid references public.signage_media(id) on delete restrict,
  add column if not exists client_selected_at timestamptz,
  add column if not exists staff_approved_at timestamptz,
  add column if not exists staff_approved_by text;

alter table public.client_content_review_proposals enable row level security;

-- Railway PostgreSQL n'expose pas de rôles anon/authenticated. L'absence de
-- policy publique ferme l'accès direct; seul le backend propriétaire y accède.

comment on table public.client_content_review_proposals is
  'Trois vidéos proposées au client; une seule peut être choisie puis validée pour diffusion.';
