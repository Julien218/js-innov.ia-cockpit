-- JS-Innov.IA — cycle mensuel de facturation avec validation humaine avant envoi.
-- Le 1er du mois prépare un brouillon; aucune facture automatique ne peut être envoyée
-- sans relecture, empreinte comptable stable et validation explicite dans le Cockpit.

alter table if exists public."Facture"
  add column if not exists periode text,
  add column if not exists montant_tva numeric(14,2),
  add column if not exists auto_generation boolean not null default false,
  add column if not exists billing_fingerprint text,
  add column if not exists billing_review_status text,
  add column if not exists billing_generated_at timestamptz,
  add column if not exists billing_validated_at timestamptz,
  add column if not exists billing_validated_by text,
  add column if not exists billing_source_event_ids jsonb not null default '[]'::jsonb,
  add column if not exists billing_monthly_fee_centers jsonb not null default '[]'::jsonb,
  add column if not exists billing_blockers jsonb not null default '[]'::jsonb,
  add column if not exists billing_send_attempt_at timestamptz,
  add column if not exists billing_send_attempt_key text,
  add column if not exists billing_send_error text;

alter table if exists public."Facture"
  drop constraint if exists facture_billing_review_status_check;

alter table if exists public."Facture"
  add constraint facture_billing_review_status_check
  check (
    billing_review_status is null
    or billing_review_status in ('pending', 'blocked', 'approved', 'send_failed', 'sent')
  );

create unique index if not exists idx_facture_auto_month_unique
  on public."Facture" (client_id, periode)
  where auto_generation is true and coalesce(statut, 'brouillon') <> 'annulee';

create index if not exists idx_facture_billing_review
  on public."Facture" (billing_review_status, periode desc)
  where auto_generation is true;

create index if not exists idx_facture_billing_fingerprint
  on public."Facture" (billing_fingerprint)
  where billing_fingerprint is not null;

comment on column public."Facture".billing_fingerprint is
  'SHA-256 déterministe du ledger, forfaits, période et blocages vus lors de la dernière préparation.';
comment on column public."Facture".billing_review_status is
  'pending/blocked jusqu’à validation humaine; approved seulement pendant l’envoi; sent après confirmation SMTP.';
