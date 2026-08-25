-- PostgREST ne peut pas inférer un index unique partiel pour
-- on_conflict=source_type,external_ref. Les valeurs NULL restent multiples
-- nativement dans PostgreSQL, donc l'index complet conserve le comportement
-- attendu tout en rendant les upserts fournisseur réellement idempotents.
drop index if exists public.uq_cost_event_external_ref;

create unique index if not exists uq_cost_event_external_ref
  on public.client_cost_events(source_type, external_ref);
