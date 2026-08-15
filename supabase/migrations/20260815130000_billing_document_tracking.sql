-- Billing document lifecycle fields used by the Cockpit PDF archive.
-- Idempotent so existing production databases remain safe.

do $$
declare
  table_name text;
begin
  foreach table_name in array array['Facture', 'Devis']
  loop
    execute format('alter table %I add column if not exists pdf_document_id text', table_name);
    execute format('alter table %I add column if not exists pdf_dropbox_path text', table_name);
    execute format('alter table %I add column if not exists pdf_dropbox_file_id text', table_name);
    execute format('alter table %I add column if not exists pdf_sha256 text', table_name);
    execute format('alter table %I add column if not exists pdf_version text', table_name);
    execute format('alter table %I add column if not exists pdf_genere_at timestamptz', table_name);
    execute format('alter table %I add column if not exists pdf_genere_par text', table_name);
    execute format('alter table %I add column if not exists date_premier_envoi timestamptz', table_name);
    execute format('alter table %I add column if not exists date_dernier_envoi timestamptz', table_name);
    execute format('alter table %I add column if not exists nombre_envois integer not null default 0', table_name);
    execute format('alter table %I add column if not exists dernier_destinataire text', table_name);
    execute format('alter table %I add column if not exists dernier_message_id text', table_name);
    execute format('alter table %I add column if not exists date_dernier_telechargement timestamptz', table_name);
    execute format('alter table %I add column if not exists nombre_telechargements integer not null default 0', table_name);
    execute format('alter table %I add column if not exists historique_documents jsonb not null default ''[]''::jsonb', table_name);
  end loop;
end
$$;
