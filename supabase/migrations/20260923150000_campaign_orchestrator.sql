create table if not exists public.campaign_brands (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null default 'jsinnovia',
  slug text not null,
  name text not null,
  site_url text,
  skill_key text,
  github_repository text,
  github_path text,
  github_ref text not null default 'main',
  brand_board_url text,
  tone text,
  palette jsonb not null default '{}'::jsonb,
  visual_rules jsonb not null default '{}'::jsonb,
  seo_keywords jsonb not null default '[]'::jsonb,
  hashtags_required jsonb not null default '[]'::jsonb,
  hashtags_recommended jsonb not null default '[]'::jsonb,
  hashtags_forbidden jsonb not null default '[]'::jsonb,
  image_provider text not null default 'base44',
  video_engine text not null default 'auto' check (video_engine in ('auto','local','api')),
  local_workflow_id text,
  api_provider text not null default 'xai',
  fallback_to_api boolean not null default false,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, slug)
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null default 'jsinnovia',
  brand_id uuid not null references public.campaign_brands(id) on delete cascade,
  name text not null,
  objective text,
  phase text not null default 'preparation',
  status text not null default 'draft' check (status in ('draft','active','paused','completed','archived')),
  start_date date,
  end_date date,
  cta text,
  landing_url text,
  channels jsonb not null default '["facebook","instagram","tiktok"]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_posts (
  id uuid primary key default gen_random_uuid(),
  organisation_id text not null default 'jsinnovia',
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  brief text,
  status text not null default 'draft' check (status in ('draft','prepared','image_review','image_approved','video_generating','video_review','ready','published','rejected')),
  platforms jsonb not null default '["facebook","instagram","tiktok"]'::jsonb,
  copy jsonb not null default '{}'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  hashtags jsonb not null default '{}'::jsonb,
  image_prompt text,
  image_url text,
  image_status text not null default 'none' check (image_status in ('none','generating','review','approved','rejected','failed')),
  image_approved_at timestamptz,
  video_prompt text,
  video_engine text check (video_engine is null or video_engine in ('auto','local','api')),
  video_provider text,
  video_job_id text,
  video_status text not null default 'none' check (video_status in ('none','queued','generating','completed','failed','rejected')),
  video_url text,
  video_approved_at timestamptz,
  adn_source jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  published_at timestamptz,
  analytics jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaign_brands_org_idx on public.campaign_brands(organisation_id, active);
create index if not exists campaigns_brand_status_idx on public.campaigns(brand_id, status, created_at desc);
create index if not exists campaign_posts_campaign_status_idx on public.campaign_posts(campaign_id, status, created_at desc);

alter table public.campaign_brands enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_posts enable row level security;
revoke all on table public.campaign_brands, public.campaigns, public.campaign_posts from anon, authenticated;
grant select, insert, update, delete on table public.campaign_brands, public.campaigns, public.campaign_posts to service_role;

drop policy if exists campaign_brands_service_role_all on public.campaign_brands;
create policy campaign_brands_service_role_all on public.campaign_brands for all to service_role using (true) with check (true);
drop policy if exists campaigns_service_role_all on public.campaigns;
create policy campaigns_service_role_all on public.campaigns for all to service_role using (true) with check (true);
drop policy if exists campaign_posts_service_role_all on public.campaign_posts;
create policy campaign_posts_service_role_all on public.campaign_posts for all to service_role using (true) with check (true);

insert into public.campaign_brands
  (organisation_id, slug, name, site_url, skill_key, tone, palette, visual_rules, seo_keywords, hashtags_required, hashtags_recommended, video_engine, fallback_to_api, metadata)
values
  ('jsinnovia','jsinnovia','JS-Innov.IA','https://www.jsinnovia.com','jsinnov-agent',
   'humain, premium, technologique, clair',
   '{"primary":"#D4AF37","dark":"#0B0B0F","night":"#0F172A","violet":"#7C3AED","cyan":"#06B6D4"}'::jsonb,
   '{"must":["technologie au service de l’humain","composition premium"],"avoid":["faux logo","surcharge visuelle"]}'::jsonb,
   '["JS-Innov.IA","automatisation intelligente","agent IA","cockpit IA"]'::jsonb,
   '["#JSInnovIA"]'::jsonb,
   '["#IntelligenceArtificielle","#Automatisation","#Innovation"]'::jsonb,
   'auto', false, '{"seed":"campaign-orchestrator-v1"}'::jsonb),
  ('jsinnovia','miss-mister-dour','Miss & Mister Dour','https://missetmisterdour.be','miss-mister-dour',
   'élégant, humain, premium, chaleureux, cinématographique',
   '{"dark":"#080A12","night":"#0F172A","gold":"#D4AF37","blue":"#1D4ED8"}'::jsonb,
   '{"must":["élégance","plume discrète si pertinente","lumière bleu nuit et or"],"avoid":["kitsch","couronnes excessives","comparaison physique des candidats"]}'::jsonb,
   '["Miss & Mister Dour","Miss & Mister Dour 2027","inscription Miss Dour","inscription Mister Dour","candidature 2027"]'::jsonb,
   '["#MissMisterDour","#MissMisterDour2027"]'::jsonb,
   '["#Dour","#Hainaut","#Borinage","#Belgique"]'::jsonb,
   'auto', false, '{"seed":"campaign-orchestrator-v1"}'::jsonb),
  ('jsinnovia','synergie-dour','Synergie Dour','https://synergiedour.be','synergie-dour',
   'local, professionnel, positif, commerçant',
   '{}'::jsonb,
   '{"must":["ancrage local","mise en valeur du commerce"],"avoid":["promesse non vérifiée"]}'::jsonb,
   '["Synergie Dour","commerce Dour","commerçants Dour"]'::jsonb,
   '["#SynergieDour"]'::jsonb,
   '["#Dour","#CommerceLocal","#Hainaut"]'::jsonb,
   'auto', false, '{"seed":"campaign-orchestrator-v1"}'::jsonb),
  ('jsinnovia','signelya','Signelya','https://signelya.jsinnovia.com','signelya',
   'premium, commercial, technologique, direct',
   '{}'::jsonb,
   '{"must":["lisibilité écran","message immédiat"],"avoid":["texte minuscule","surcharge"]}'::jsonb,
   '["Signelya","affichage dynamique","écran publicitaire"]'::jsonb,
   '["#Signelya"]'::jsonb,
   '["#AffichageDynamique","#DigitalSignage","#Dour"]'::jsonb,
   'local', false, '{"seed":"campaign-orchestrator-v1"}'::jsonb),
  ('jsinnovia','fashionistart','Fashionist’Art','https://fashionistartdour.be','fashionistart',
   'artistique, élégant, contemporain',
   '{}'::jsonb,
   '{"must":["mise en valeur de l’artiste ou de l’œuvre"],"avoid":["surcharge commerciale"]}'::jsonb,
   '["FashionistArt","art Dour","galerie Dour"]'::jsonb,
   '["#FashionistArt"]'::jsonb,
   '["#Art","#Dour","#Hainaut"]'::jsonb,
   'auto', false, '{"seed":"campaign-orchestrator-v1"}'::jsonb),
  ('jsinnovia','tour-de-dour','Le Tour de Dour','https://letourdedour.com','site-olivier',
   'local, vivant, accessible, événementiel',
   '{}'::jsonb,
   '{"must":["Dour","dynamisme local"],"avoid":["faux lieu","fausse information historique"]}'::jsonb,
   '["Le Tour de Dour","Dour","événement Dour"]'::jsonb,
   '["#LeTourDeDour"]'::jsonb,
   '["#Dour","#Hainaut","#Borinage"]'::jsonb,
   'auto', false, '{"seed":"campaign-orchestrator-v1"}'::jsonb)
on conflict (organisation_id, slug) do nothing;
