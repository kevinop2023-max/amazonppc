CREATE TABLE IF NOT EXISTS public.ad_group_performance (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL,
  ad_group_id BIGINT NOT NULL,
  campaign_id BIGINT,
  date DATE NOT NULL,
  ad_group_name TEXT,
  impressions INT DEFAULT 0, clicks INT DEFAULT 0,
  spend_cents INT DEFAULT 0, sales_cents INT DEFAULT 0,
  orders INT DEFAULT 0, units INT DEFAULT 0,
  CONSTRAINT uq_ad_group_performance UNIQUE (profile_id, ad_group_id, date)
);
CREATE INDEX IF NOT EXISTS idx_agp_camp ON public.ad_group_performance (profile_id, campaign_id, date);
CREATE INDEX IF NOT EXISTS idx_agp_ag   ON public.ad_group_performance (profile_id, ad_group_id, date);

CREATE TABLE IF NOT EXISTS public.placement_performance (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  date DATE NOT NULL,
  placement TEXT NOT NULL,
  impressions INT DEFAULT 0, clicks INT DEFAULT 0,
  spend_cents INT DEFAULT 0, sales_cents INT DEFAULT 0,
  orders INT DEFAULT 0, units INT DEFAULT 0,
  CONSTRAINT uq_placement_performance UNIQUE (profile_id, campaign_id, date, placement)
);
CREATE INDEX IF NOT EXISTS idx_pp_camp ON public.placement_performance (profile_id, campaign_id, date);

ALTER TABLE public.ad_group_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placement_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all_agp ON public.ad_group_performance;
CREATE POLICY service_all_agp ON public.ad_group_performance FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS agp_own ON public.ad_group_performance;
CREATE POLICY agp_own ON public.ad_group_performance FOR ALL TO public USING (profile_id IN (SELECT my_profile_ids()));
DROP POLICY IF EXISTS service_all_pp ON public.placement_performance;
CREATE POLICY service_all_pp ON public.placement_performance FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS pp_own ON public.placement_performance;
CREATE POLICY pp_own ON public.placement_performance FOR ALL TO public USING (profile_id IN (SELECT my_profile_ids()));
