-- JS-Innov.IA — intégrité client/facturation et registre unifié des coûts refacturables.
-- Règle métier : toute Facture/Devis appartient à exactement un Client canonique.
-- Un Client peut posséder plusieurs Factures/Devis/Projets.
-- Les projets internes JS-Innov.IA peuvent rester sans client_id.

-- ---------------------------------------------------------------------------
-- 1. Rattachement canonique des sous-systèmes Cost Center au Client CRM
-- ---------------------------------------------------------------------------
alter table if exists public.client_cost_centers
  add column if not exists client_id text;

alter table if exists public.client_invoices
  add column if not exists client_id text,
  add column if not exists facture_id text;

alter table if exists public.client_invoice_lines
  add column if not exists client_id text;

alter table if exists public.client_cost_imports
  add column if not exists client_id text;

create index if not exists idx_ccc_client_id on public.client_cost_centers(client_id);
create index if not exists idx_ci_client_id on public.client_invoices(client_id);
create index if not exists idx_cil_client_id on public.client_invoice_lines(client_id);
create index if not exists idx_cci_client_id on public.client_cost_imports(client_id);

-- Les lignes mensuelles restent extensibles, mais les domaines annuels restent exclus.
alter table if exists public.client_invoice_lines
  drop constraint if exists client_invoice_lines_line_type_check;
alter table if exists public.client_invoice_lines
  add constraint client_invoice_lines_line_type_check
  check (line_type in (
    'forfait', 'railway', 'llm_api', 'local_ai', 'github', 'storage',
    'communications', 'api', 'media_ai', 'other'
  ));

-- ---------------------------------------------------------------------------
-- 2. Politique de refacturation par client et type de coût
-- ---------------------------------------------------------------------------
create table if not exists public.client_billing_rules (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  cost_type text not null,
  enabled boolean not null default true,
  billing_mode text not null default 'percent'
    check (billing_mode in ('percent', 'at_cost', 'fixed', 'included')),
  markup_percent numeric(8,3) not null default 0 check (markup_percent >= 0),
  fixed_fee_minor integer not null default 0 check (fixed_fee_minor >= 0),
  minimum_minor integer not null default 0 check (minimum_minor >= 0),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, cost_type)
);

create index if not exists idx_cbr_client on public.client_billing_rules(client_id);

-- ---------------------------------------------------------------------------
-- 3. Ledger auditable : coût réel séparé du montant refacturé
-- ---------------------------------------------------------------------------
create table if not exists public.client_cost_events (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  project_id text,
  cost_center_id uuid references public.client_cost_centers(id) on delete set null,
  source_type text not null,
  provider text,
  description text not null,
  actual_cost_minor integer not null default 0 check (actual_cost_minor >= 0),
  markup_percent numeric(8,3) not null default 0 check (markup_percent >= 0),
  billable_minor integer not null default 0 check (billable_minor >= 0),
  currency text not null default 'EUR',
  billable boolean not null default true,
  external_ref text,
  incurred_at timestamptz not null default now(),
  invoice_id uuid references public.client_invoices(id) on delete set null,
  facture_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_cce_client_period on public.client_cost_events(client_id, incurred_at desc);
create index if not exists idx_cce_unbilled on public.client_cost_events(client_id, invoice_id) where billable = true and invoice_id is null;
create unique index if not exists idx_cce_external_unique
  on public.client_cost_events(source_type, external_ref)
  where external_ref is not null;

-- ---------------------------------------------------------------------------
-- 4. Validation générique d'un Client.id même si les types SQL historiques
--    diffèrent entre tables (comparaison via ::text).
-- ---------------------------------------------------------------------------
create or replace function public.assert_client_exists(p_client_id text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if nullif(trim(coalesce(p_client_id, '')), '') is null then
    raise exception 'client_id obligatoire' using errcode = '23502';
  end if;
  if not exists (select 1 from public."Client" c where c.id::text = p_client_id::text) then
    raise exception 'client_id % inexistant', p_client_id using errcode = '23503';
  end if;
end;
$$;

create or replace function public.enforce_document_client()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.assert_client_exists(new.client_id::text);
  return new;
end;
$$;

-- Facture et Devis : client_id obligatoire et existant, même hors Companion.
drop trigger if exists trg_facture_client_integrity on public."Facture";
create trigger trg_facture_client_integrity
before insert or update of client_id on public."Facture"
for each row execute function public.enforce_document_client();

drop trigger if exists trg_devis_client_integrity on public."Devis";
create trigger trg_devis_client_integrity
before insert or update of client_id on public."Devis"
for each row execute function public.enforce_document_client();

-- Projet : le client est optionnel pour les produits/projets internes, mais s'il existe il doit être valide.
create or replace function public.enforce_optional_client()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(trim(coalesce(new.client_id::text, '')), '') is not null then
    perform public.assert_client_exists(new.client_id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projet_client_integrity on public."Projet";
create trigger trg_projet_client_integrity
before insert or update of client_id on public."Projet"
for each row execute function public.enforce_optional_client();

-- ---------------------------------------------------------------------------
-- 5. Cost center : client source de vérité + snapshots synchronisés
-- ---------------------------------------------------------------------------
create or replace function public.enforce_cost_center_client()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c public."Client"%rowtype;
begin
  perform public.assert_client_exists(new.client_id);
  select * into c from public."Client" where id::text = new.client_id limit 1;

  new.client_name := coalesce(nullif(trim(c.denomination_legale), ''), nullif(trim(c.entreprise), ''), trim(concat_ws(' ', c.prenom, c.nom)), c.id::text);
  new.client_email := coalesce(nullif(trim(c.email_facturation), ''), nullif(trim(c.email), ''));
  new.client_address := trim(concat_ws(', ', nullif(trim(c.adresse), ''), nullif(trim(concat_ws(' ', c.code_postal, c.ville)), ''), nullif(trim(c.pays), '')));
  new.client_vat_number := coalesce(nullif(trim(c.numero_tva), ''), nullif(trim(c.numero_entreprise), ''));
  return new;
end;
$$;

drop trigger if exists trg_cost_center_client_integrity on public.client_cost_centers;
create trigger trg_cost_center_client_integrity
before insert or update of client_id on public.client_cost_centers
for each row execute function public.enforce_cost_center_client();

create or replace function public.propagate_cost_invoice_client()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_client text;
begin
  select client_id into expected_client from public.client_cost_centers where id = new.cost_center_id;
  if expected_client is null then
    raise exception 'Cost center % sans client_id canonique', new.cost_center_id using errcode = '23503';
  end if;
  if new.client_id is not null and new.client_id <> expected_client then
    raise exception 'client_id de facture incohérent avec le cost center' using errcode = '23514';
  end if;
  new.client_id := expected_client;
  perform public.assert_client_exists(new.client_id);
  return new;
end;
$$;

drop trigger if exists trg_cost_invoice_client on public.client_invoices;
create trigger trg_cost_invoice_client
before insert or update of cost_center_id, client_id on public.client_invoices
for each row execute function public.propagate_cost_invoice_client();

create or replace function public.propagate_cost_line_client()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_client text;
begin
  select client_id into expected_client from public.client_invoices where id = new.invoice_id;
  if expected_client is null then
    raise exception 'Facture coûts % sans client_id', new.invoice_id using errcode = '23503';
  end if;
  if new.client_id is not null and new.client_id <> expected_client then
    raise exception 'client_id de ligne incohérent avec la facture' using errcode = '23514';
  end if;
  new.client_id := expected_client;
  return new;
end;
$$;

drop trigger if exists trg_cost_line_client on public.client_invoice_lines;
create trigger trg_cost_line_client
before insert or update of invoice_id, client_id on public.client_invoice_lines
for each row execute function public.propagate_cost_line_client();

create or replace function public.propagate_cost_import_client()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_client text;
begin
  select client_id into expected_client from public.client_cost_centers where id = new.cost_center_id;
  if expected_client is null then
    raise exception 'Cost center % sans client_id canonique', new.cost_center_id using errcode = '23503';
  end if;
  new.client_id := expected_client;
  return new;
end;
$$;

drop trigger if exists trg_cost_import_client on public.client_cost_imports;
create trigger trg_cost_import_client
before insert or update of cost_center_id on public.client_cost_imports
for each row execute function public.propagate_cost_import_client();

create or replace function public.enforce_cost_event_client()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_client text;
begin
  if new.cost_center_id is not null then
    select client_id into expected_client from public.client_cost_centers where id = new.cost_center_id;
    if expected_client is null then
      raise exception 'Cost center % sans client_id canonique', new.cost_center_id using errcode = '23503';
    end if;
    if new.client_id is not null and new.client_id <> expected_client then
      raise exception 'client_id du coût incohérent avec le cost center' using errcode = '23514';
    end if;
    new.client_id := expected_client;
  end if;
  perform public.assert_client_exists(new.client_id);
  return new;
end;
$$;

drop trigger if exists trg_cost_event_client on public.client_cost_events;
create trigger trg_cost_event_client
before insert or update of client_id, cost_center_id on public.client_cost_events
for each row execute function public.enforce_cost_event_client();

-- ---------------------------------------------------------------------------
-- 6. Pas de suppression d'un Client référencé : on archive le Client à la place.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_linked_client_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public."Facture" where client_id::text = old.id::text)
     or exists (select 1 from public."Devis" where client_id::text = old.id::text)
     or exists (select 1 from public."Projet" where client_id::text = old.id::text)
     or exists (select 1 from public.client_cost_centers where client_id = old.id::text)
  then
    raise exception 'Client référencé : suppression interdite, utiliser le statut inactif/archivé' using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_prevent_linked_client_delete on public."Client";
create trigger trg_prevent_linked_client_delete
before delete on public."Client"
for each row execute function public.prevent_linked_client_delete();

-- ---------------------------------------------------------------------------
-- 7. Séquence de factures coûts globale, sans collision entre clients
-- ---------------------------------------------------------------------------
create sequence if not exists public.client_invoice_global_seq start 1;

-- ---------------------------------------------------------------------------
-- 8. RLS : tables de coûts privées, backend service_role uniquement
-- ---------------------------------------------------------------------------
alter table public.client_billing_rules enable row level security;
alter table public.client_cost_events enable row level security;

drop policy if exists service_role_all_cbr on public.client_billing_rules;
create policy service_role_all_cbr on public.client_billing_rules
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists service_role_all_cce on public.client_cost_events;
create policy service_role_all_cce on public.client_cost_events
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

comment on table public.client_cost_events is 'Ledger auditable : coût réel, marge et montant refacturable, toujours rattachés au Client.id canonique.';
comment on table public.client_billing_rules is 'Règles de refacturation par client et type de coût (à prix coûtant, marge %, fixe ou inclus).';
