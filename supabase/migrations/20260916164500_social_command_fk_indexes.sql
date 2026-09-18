-- Social Command — indexation des clés étrangères utilisées pour les jointures, suppressions et analytics.
CREATE INDEX IF NOT EXISTS social_accounts_brand_idx ON public.social_accounts(brand_id);
CREATE INDEX IF NOT EXISTS social_campaigns_brand_idx ON public.social_campaigns(brand_id);
CREATE INDEX IF NOT EXISTS social_assets_brand_idx ON public.social_assets(brand_id);
CREATE INDEX IF NOT EXISTS social_assets_campaign_idx ON public.social_assets(campaign_id);
CREATE INDEX IF NOT EXISTS social_posts_brand_idx ON public.social_posts(brand_id);
CREATE INDEX IF NOT EXISTS social_posts_campaign_idx ON public.social_posts(campaign_id);
CREATE INDEX IF NOT EXISTS social_posts_account_idx ON public.social_posts(account_id);
CREATE INDEX IF NOT EXISTS social_publish_jobs_post_idx ON public.social_publish_jobs(post_id);
CREATE INDEX IF NOT EXISTS social_conversions_post_idx ON public.social_conversions(post_id);
CREATE INDEX IF NOT EXISTS social_ai_decisions_campaign_idx ON public.social_ai_decisions(campaign_id);
CREATE INDEX IF NOT EXISTS social_ai_decisions_post_idx ON public.social_ai_decisions(post_id);
