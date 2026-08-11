-- Agent Réseaux IA → AI Cost Control
-- Enregistre automatiquement chaque génération éditoriale terminée dans le registre
-- ai_cost_usage, attribuée au bon client et à la bonne version du contenu.

create or replace function public.record_social_agent_ai_cost()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  usage_json jsonb;
  input_tokens bigint := 0;
  cached_tokens bigint := 0;
  output_tokens bigint := 0;
  uncached_tokens bigint := 0;
  input_price numeric := 0;
  cached_price numeric := 0;
  output_price numeric := 0;
  computed_cost numeric(16,8) := 0;
  pricing_key text := null;
  pricing_warning text := null;
  client_name_value text := null;
begin
  -- Une génération est comptée uniquement au passage generating → review.
  -- Cela évite de recompter les validations, callbacks vidéo ou modifications ultérieures.
  if old.status is distinct from 'generating' or new.status is distinct from 'review' then
    return new;
  end if;

  usage_json := coalesce(new.metadata -> 'openai_usage', '{}'::jsonb);
  if new.generation_model is null or usage_json = '{}'::jsonb then
    return new;
  end if;

  input_tokens := greatest(0, coalesce((usage_json ->> 'input_tokens')::bigint, (usage_json ->> 'prompt_tokens')::bigint, 0));
  cached_tokens := greatest(0, coalesce(
    (usage_json #>> '{input_tokens_details,cached_tokens}')::bigint,
    (usage_json #>> '{prompt_tokens_details,cached_tokens}')::bigint,
    0
  ));
  cached_tokens := least(input_tokens, cached_tokens);
  output_tokens := greatest(0, coalesce((usage_json ->> 'output_tokens')::bigint, (usage_json ->> 'completion_tokens')::bigint, 0));
  uncached_tokens := greatest(0, input_tokens - cached_tokens);

  -- Tarifs embarqués cohérents avec le catalogue AI Cost Control de cette version.
  -- USD / 1M tokens : input / cached input / output.
  if lower(new.generation_model) = 'gpt-5.6-terra' or lower(new.generation_model) like 'gpt-5.6-terra-%' then
    input_price := 2.5; cached_price := 0.25; output_price := 15; pricing_key := 'gpt-5.6-terra';
  elsif lower(new.generation_model) = 'gpt-5.6-luna' or lower(new.generation_model) like 'gpt-5.6-luna-%' then
    input_price := 1; cached_price := 0.1; output_price := 6; pricing_key := 'gpt-5.6-luna';
  elsif lower(new.generation_model) in ('gpt-5.6', 'gpt-5.6-sol') or lower(new.generation_model) like 'gpt-5.6-sol-%' then
    input_price := 5; cached_price := 0.5; output_price := 30; pricing_key := 'gpt-5.6-sol';
  else
    pricing_warning := 'model_unpriced';
  end if;

  computed_cost := round((
    (uncached_tokens * input_price) +
    (cached_tokens * cached_price) +
    (output_tokens * output_price)
  ) / 1000000.0, 8);

  new.generation_cost_usd := computed_cost;

  select p.display_name
    into client_name_value
    from public.social_agent_profiles p
   where p.id = new.profile_id
   limit 1;

  insert into public.ai_cost_usage (
    provider,
    model,
    input_tokens,
    cached_input_tokens,
    output_tokens,
    cost_usd,
    cost_estimated,
    pricing_key,
    pricing_warning,
    processing_mode,
    project_key,
    project_name,
    client_key,
    client_name,
    source,
    request_id,
    metadata,
    created_by
  ) values (
    coalesce(new.generation_provider, 'openai'),
    new.generation_model,
    input_tokens,
    cached_tokens,
    output_tokens,
    computed_cost,
    true,
    pricing_key,
    pricing_warning,
    'standard',
    'social-content-agent',
    'Agent Réseaux IA',
    new.client_id,
    coalesce(client_name_value, new.client_id),
    'social-content-agent',
    'social-content:' || new.id::text || ':v' || new.version::text,
    jsonb_build_object(
      'content_id', new.id,
      'profile_id', new.profile_id,
      'editorial_series', new.editorial_series,
      'topic', new.topic,
      'version', new.version
    ),
    'social-content-agent'
  )
  on conflict (request_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_social_agent_ai_cost on public.social_content_items;
create trigger trg_social_agent_ai_cost
before update on public.social_content_items
for each row execute function public.record_social_agent_ai_cost();

comment on function public.record_social_agent_ai_cost() is
  'Enregistre automatiquement le coût des générations Agent Réseaux IA dans AI Cost Control.';
