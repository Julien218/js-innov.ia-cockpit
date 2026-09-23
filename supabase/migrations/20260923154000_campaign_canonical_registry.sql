-- Aligne les profils Campagnes sur le registre ADN canonique du Cockpit.
-- Les champs GitHub restent des métadonnées de lecture; server-brand-canonical.cjs
-- résout toujours la source via brand/brand-registry.json en mode fail-closed.

update public.campaign_brands
set slug = 'fashionist-art', updated_at = now()
where organisation_id = 'jsinnovia' and slug = 'fashionistart'
  and not exists (
    select 1 from public.campaign_brands b
    where b.organisation_id = 'jsinnovia' and b.slug = 'fashionist-art'
  );

insert into public.campaign_brands
  (organisation_id, slug, name, site_url, skill_key, github_repository, github_path, github_ref, tone, video_engine, fallback_to_api, metadata)
values
  ('jsinnovia','jsinnovia','JS-Innov.IA','https://www.jsinnovia.com','jsinnov-agent','Julien218/jsinnovia','brand/brand.manifest.json','main','humain, premium, technologique, clair','auto',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','miss-mister-dour','Miss & Mister Dour','https://missetmisterdour.be','miss-mister-dour','Julien218/miss2026','brand/brand.manifest.json','rescue/recovered-production-source','élégant, humain, premium, chaleureux, cinématographique','auto',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','synergie-dour','Synergie Dour','https://synergiedour.be','synergie-dour','Julien218/synergie-dour','docs/brand-kit/2026/AGENT_INDEX.json','main','local, professionnel, positif, commerçant','auto',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','signelya','SIGNELYA','https://signelya.jsinnovia.com','signelya','Julien218/js-innov.ia','brand/brand.manifest.json','feature/digital-signage-product-release','premium, commercial, technologique, direct','local',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','fashionist-art','Fashionist''ART','https://fashionistartdour.be','fashionistart','Julien218/fashionist-art','brand/brand.manifest.json','main','artistique, élégant, contemporain','auto',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','tour-de-dour','Le Tour de Dour','https://letourdedour.com','site-olivier','Julien218/letourdedour-site-_s7N','brand/brand.manifest.json','main','local, vivant, accessible, événementiel','auto',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','assurances-dour','Assurances-Dour.be','https://assurances-dour.be','assurances-dour','Julien218/PV_Agence_de_Dour','brand-system/AGENT_INDEX.json','main',null,'auto',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','olivier-trevis','Olivier Trevis','https://oliviertrevis.be','site-olivier','Julien218/oliviertrevis-site','brand/brand.manifest.json','main',null,'auto',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','hainoflow','HainoFlow','https://hainoflow.jsinnovia.com','jsinnov-agent','Julien218/hainoflow-landing','brand/brand.manifest.json','main',null,'auto',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','pilotyasign-pro','PilotyaSign Pro','https://pilotyasign.jsinnovia.com','jsinnov-agent','Julien218/jsinnovia','brand/brand.manifest.json','pilotyasign-pro',null,'auto',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','eternity-melodies','Eternity Melodies','https://eternity-melodies-web-production.up.railway.app','jsinnov-agent','Julien218/eternity-melodies','brand/brand.manifest.json','renovation-offre-complete',null,'auto',false,'{"canonical_registry":true}'::jsonb),
  ('jsinnovia','villeconnect-os','VilleConnect OS','https://villeconnect-production.up.railway.app','villeconnect','Julien218/villeconnect','docs/brand/brand.manifest.json','main',null,'auto',false,'{"canonical_registry":true}'::jsonb)
on conflict (organisation_id, slug) do update set
  name = excluded.name,
  site_url = excluded.site_url,
  skill_key = excluded.skill_key,
  github_repository = excluded.github_repository,
  github_path = excluded.github_path,
  github_ref = excluded.github_ref,
  metadata = coalesce(public.campaign_brands.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();
