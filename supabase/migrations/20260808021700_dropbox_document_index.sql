-- JS-Innov.IA Cockpit — index documentaire Dropbox
-- Les fichiers restent dans Dropbox. Supabase ne conserve que les métadonnées.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public."DocumentIndex" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  organisation text NOT NULL,
  brand text NOT NULL DEFAULT 'general',
  client_id text,
  category text NOT NULL DEFAULT 'documents',
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  dropbox_path text NOT NULL,
  dropbox_file_id text NOT NULL,
  content_hash text,
  source text NOT NULL DEFAULT 'cockpit',
  email_message_id text,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS document_index_dropbox_file_id_uq
  ON public."DocumentIndex" (dropbox_file_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS document_index_org_created_idx
  ON public."DocumentIndex" (organisation, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS document_index_client_created_idx
  ON public."DocumentIndex" (organisation, client_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS document_index_brand_category_idx
  ON public."DocumentIndex" (organisation, brand, category, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public."DocumentIndex" ENABLE ROW LEVEL SECURITY;

-- Aucun accès direct navigateur n'est accordé. Le backend Cockpit utilise la clé serveur.
-- La service_role Supabase contourne RLS conformément au modèle de sécurité existant.

CREATE OR REPLACE FUNCTION public.set_document_index_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_index_updated_at ON public."DocumentIndex";
CREATE TRIGGER document_index_updated_at
BEFORE UPDATE ON public."DocumentIndex"
FOR EACH ROW EXECUTE FUNCTION public.set_document_index_updated_at();

COMMENT ON TABLE public."DocumentIndex" IS
  'Index de métadonnées pour les documents stockés dans Dropbox. Aucun contenu binaire n est stocké dans Supabase.';
