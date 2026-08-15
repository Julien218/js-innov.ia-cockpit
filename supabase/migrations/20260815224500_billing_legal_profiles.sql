-- Données légales vérifiées et intégrité des rattachements de facturation.
alter table public."Client"
  add column if not exists type_client text,
  add column if not exists denomination_legale text,
  add column if not exists numero_entreprise text,
  add column if not exists numero_tva text,
  add column if not exists pays text,
  add column if not exists email_facturation text,
  add column if not exists facturation_statut text not null default 'a_verifier',
  add column if not exists facturation_verifiee_at timestamptz,
  add column if not exists facturation_demande_at timestamptz,
  add column if not exists facturation_relance_at timestamptz,
  add column if not exists facturation_demande_message_id text,
  add column if not exists facturation_source text;

alter table public."Facture"
  add column if not exists client_denomination_legale text,
  add column if not exists client_adresse text,
  add column if not exists client_code_postal text,
  add column if not exists client_ville text,
  add column if not exists client_pays text,
  add column if not exists client_tva text,
  add column if not exists client_numero_entreprise text,
  add column if not exists pdf_conformite_statut text not null default 'a_verifier';

alter table public."Devis"
  add column if not exists client_denomination_legale text,
  add column if not exists client_adresse text,
  add column if not exists client_code_postal text,
  add column if not exists client_ville text,
  add column if not exists client_pays text,
  add column if not exists client_tva text,
  add column if not exists client_numero_entreprise text,
  add column if not exists pdf_conformite_statut text not null default 'a_verifier';

update public."Client"
set
  denomination_legale = coalesce(nullif(trim(denomination_legale), ''), nullif(trim(entreprise), '')),
  email_facturation = coalesce(nullif(trim(email_facturation), ''), nullif(trim(email), ''))
where denomination_legale is null or email_facturation is null;

update public."Facture"
set pdf_conformite_statut = 'incomplet'
where pdf_document_id is not null and coalesce(pdf_version, '') <> 'official-v3-legal';

update public."Devis"
set pdf_conformite_statut = 'incomplet'
where pdf_document_id is not null and coalesce(pdf_version, '') <> 'official-v3-legal';

create index if not exists idx_facture_client_id_integrity on public."Facture"(client_id);
create index if not exists idx_devis_client_id_integrity on public."Devis"(client_id);
create index if not exists idx_projet_client_id_integrity on public."Projet"(client_id);
