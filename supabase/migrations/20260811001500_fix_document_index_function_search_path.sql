-- Sécurise la fonction trigger DocumentIndex contre un search_path mutable.
ALTER FUNCTION public.set_document_index_updated_at()
  SET search_path = public, pg_temp;
