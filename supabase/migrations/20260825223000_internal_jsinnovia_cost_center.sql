do $$
declare
  internal_client_id uuid;
begin
  select id into internal_client_id
  from public."Client"
  where type_client = 'interne_jsinnovia'
  order by created_at asc
  limit 1;

  if internal_client_id is null then
    insert into public."Client" (
      nom, entreprise, denomination_legale, type_client, statut, organisation_id,
      facturation_statut, notes, created_by, updated_by
    ) values (
      'JS-Innov.IA — interne', 'JS-Innov.IA', 'JS-Innov.IA', 'interne_jsinnovia',
      'actif', 'jsinnovia', 'a_verifier',
      'Entité comptable interne pour suivre les coûts des essais et projets propres sans les refacturer à un client externe.',
      'migration:internal_jsinnovia_cost_center', 'migration:internal_jsinnovia_cost_center'
    ) returning id into internal_client_id;
  end if;

  if not exists (
    select 1 from public.client_cost_centers
    where product_code = 'JSINNOVIA_INTERNAL' and is_active = true
  ) then
    insert into public.client_cost_centers (
      product_code, client_id, client_name, monthly_fee_minor, currency, is_active, metadata
    ) values (
      'JSINNOVIA_INTERNAL', internal_client_id::text, 'JS-Innov.IA', 0, 'EUR', true,
      jsonb_build_object('internal_project', true, 'billable', false, 'created_from', 'video_factory')
    );
  end if;

  insert into public.client_billing_rules (
    client_id, cost_type, enabled, billing_mode, markup_percent, fixed_fee_minor, minimum_minor, notes, metadata
  ) values (
    internal_client_id::text, 'all', true, 'included', 0, 0, 0,
    'Coûts internes JS-Innov.IA suivis mais jamais refacturés à un client externe.',
    jsonb_build_object('internal_project', true)
  ) on conflict (client_id, cost_type) do update set
    enabled = true, billing_mode = 'included', markup_percent = 0,
    fixed_fee_minor = 0, minimum_minor = 0, updated_at = now();
end $$;
